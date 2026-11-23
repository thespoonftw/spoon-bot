<template>
  <!-- Create Event (/events/new, from /event in Discord) and Edit Event (/events/:channelId/edit, from an event's ⚙ button).
       Creating makes the event channel, posts its join card (public events) and DMs invites. -->
  <div class="page new-event">
    <p v-if="loading" class="subtitle">Loading the event…</p>
    <template v-else-if="loadError">
      <h1>Can't edit this event</h1>
      <div class="error">{{ loadError }}</div>
    </template>
    <template v-else-if="deleted">
      <h1>Event deleted</h1>
      <p class="subtitle">The channel{{ isPrivate ? " is" : " and its join card are" }} gone.</p>
    </template>
    <template v-else-if="created">
      <h1>Event created 🎉</h1>
      <p class="subtitle">
        Your channel <strong>#{{ created.channelName }}</strong> is ready{{ created.private ? "" : ", and the join card is up in brunch-events" }}.
        <template v-if="created.invited"> Invites went out to {{ created.invited }} {{ created.invited === 1 ? "person" : "people" }}.</template>
      </p>
      <div v-if="created.failedInvites.length" class="error">
        Couldn't DM {{ created.failedInvites.join(", ") }} — they have DMs from server members turned off. Send them the channel link yourself.
      </div>
      <router-link v-if="created.albumUrl" class="new-event-another" :to="created.albumUrl">View album</router-link>
      <button class="new-event-another" @click="reset">Create another</button>
    </template>
    <template v-else>
      <h1>{{ editing ? "Edit Event" : "Create Event" }}</h1>
      <div class="form-group">
        <label for="ev-name">Event name</label>
        <input id="ev-name" v-model="form.name" type="text" maxlength="100" placeholder="e.g. Sunday brunch" autofocus />
      </div>
      <div class="form-group">
        <label for="ev-desc">Description <span class="new-event-optional">optional · Discord formatting works</span></label>
        <textarea id="ev-desc" v-model="form.description" rows="6" maxlength="3500" placeholder="What's the plan? Links, what to bring, cost…"></textarea>
        <div v-if="form.description.length > 3000" class="new-event-count">{{ form.description.length }} / 3500</div>
      </div>
      <div class="form-group">
        <label for="ev-loc">Location <span class="new-event-optional">optional</span></label>
        <input id="ev-loc" v-model="form.location" type="text" maxlength="200" placeholder="TBC" />
      </div>

      <div class="new-event-row">
        <div class="form-group">
          <label for="ev-date">Date <span class="new-event-optional">leave empty for TBC</span></label>
          <input id="ev-date" v-model="form.date" type="date" :min="editing ? undefined : today" />
        </div>
        <div class="form-group">
          <label for="ev-time">Start time <span class="new-event-optional">empty = all day</span></label>
          <input id="ev-time" v-model="form.time" type="time" :disabled="!form.date" />
        </div>
      </div>

      <label v-if="form.date" class="new-event-check">
        <input v-model="hasEnd" type="checkbox" /> Has an end date or time
      </label>
      <div v-if="form.date && hasEnd" class="new-event-row">
        <div class="form-group">
          <label for="ev-end-date">End date</label>
          <input id="ev-end-date" v-model="form.endDate" type="date" :min="form.date" />
        </div>
        <div class="form-group">
          <label for="ev-end-time">End time <span class="new-event-optional">optional</span></label>
          <input id="ev-end-time" v-model="form.endTime" type="time" />
        </div>
      </div>

      <div class="form-group">
        <label>Image <span class="new-event-optional">optional · shown on the event card</span></label>
        <div v-if="imageUrl" class="new-event-image">
          <img :src="imageUrl" alt="" @error="imageBroken = true" @load="imageBroken = false" />
          <div v-if="imageBroken" class="new-event-image-broken">Can't load that image — check the link.</div>
          <button class="new-event-image-remove" @click="clearImage">✕ Remove</button>
        </div>
        <template v-else>
          <div class="new-event-tabs">
            <button :class="{ active: imageMode === 'upload' }" @click="imageMode = 'upload'">Upload</button>
            <button :class="{ active: imageMode === 'link' }" @click="imageMode = 'link'">Link</button>
          </div>
          <label v-if="imageMode === 'upload'" class="new-event-drop" :class="{ busy: uploading }">
            <input type="file" accept="image/*" :disabled="uploading" @change="onFile" />
            {{ uploading ? "Uploading…" : "Choose an image" }}
          </label>
          <div v-else class="new-event-link">
            <input v-model="linkInput" type="url" placeholder="https://…" @keydown.enter="useLink" />
            <button class="btn-primary" :disabled="!linkInput.trim()" @click="useLink">Use</button>
          </div>
        </template>
      </div>

      <div class="form-group">
        <label>Who can join</label>
        <div class="new-event-tabs">
          <button :class="{ active: !isPrivate }" @click="isPrivate = false">🌍 Public brunch event</button>
          <button :class="{ active: isPrivate }" @click="isPrivate = true">🔒 Private</button>
        </div>
        <div class="new-event-hint">{{ isPrivate
          ? "No join card in brunch-events. Only the people you invite can join."
          : "A join card goes up in brunch-events for anyone to join." }}</div>
      </div>
      <label v-if="editing && !isPrivate" class="new-event-check">
        <input v-model="joiningEnabled" type="checkbox" />
        <span>Joining open <span class="new-event-optional">Off: the join card stops taking new people.</span></span>
      </label>

      <div v-if="isPrivate" class="form-group">
        <label for="ev-invite">{{ editing ? "Invite more people" : "Invite people" }} <span class="new-event-optional">they get a DM with a Join button</span></label>
        <div v-if="invited.length" class="new-event-chips">
          <span v-for="p in invited" :key="p.id" class="member-chip">
            <img v-if="p.avatarUrl" :src="p.avatarUrl" class="member-avatar" alt="" />
            <span class="member-name">{{ p.name }}</span>
            <button class="new-event-chip-x" :aria-label="`Remove ${p.name}`" @click="uninvite(p.id)">✕</button>
          </span>
        </div>
        <div class="new-event-search">
          <input id="ev-invite" v-model="inviteQuery" type="text" autocomplete="off"
            :placeholder="peopleError || 'Search the server by name…'" :disabled="!!peopleError"
            @focus="loadPeople" @keydown.enter.prevent="matches[0] && invite(matches[0])" />
          <div v-if="inviteQuery.trim() && matches.length" class="new-event-results">
            <button v-for="p in matches" :key="p.id" @click="invite(p)">
              <img v-if="p.avatarUrl" :src="p.avatarUrl" class="member-avatar" alt="" />
              <span>{{ p.name }}</span><span class="new-event-optional">@{{ p.username }}</span>
            </button>
          </div>
          <div v-else-if="inviteQuery.trim() && people.length" class="new-event-noresults">No one matches.</div>
        </div>
      </div>

      <label class="new-event-check">
        <input v-model="rsvp" type="checkbox" />
        <span>RSVP buttons <span class="new-event-optional">Coming / Maybe / Decline / Lurking and +1. Off: joining the channel is enough.</span></span>
      </label>

      <div v-if="ev && ev.members.length" class="form-group">
        <label>People in the event <span class="new-event-optional">{{ rsvp ? "set anyone's RSVP and guests" : `${ev.members.length}` }}</span></label>
        <div class="new-event-people">
          <div v-for="m in ev.members" :key="m.id" class="new-event-person" :class="{ removing: removing.has(m.id) }">
            <img v-if="m.avatarUrl" :src="m.avatarUrl" class="member-avatar" alt="" />
            <span v-else class="member-avatar member-avatar-placeholder">{{ m.name.charAt(0) }}</span>
            <span class="new-event-person-name">{{ m.name }}</span>
            <template v-if="removing.has(m.id)">
              <span class="new-event-optional">removed when you save</span>
              <button class="new-event-inline" @click="toggleRemove(m.id)">Undo</button>
            </template>
            <template v-else-if="rsvp && rsvpEdits[m.id]">
              <select v-model="rsvpEdits[m.id].status" :aria-label="`${m.name}'s RSVP`">
                <option value="coming">✅ Coming</option>
                <option value="maybe">❔ Maybe</option>
                <option value="decline">❌ Declined</option>
                <option value="lurking">👀 Lurking</option>
              </select>
              <select v-model.number="rsvpEdits[m.id].plusOne" :aria-label="`${m.name}'s guests`" class="new-event-plus">
                <option v-for="n in 6" :key="n" :value="n - 1">{{ n === 1 ? "No +1" : `+${n - 1}` }}</option>
              </select>
            </template>
            <button v-if="!removing.has(m.id)" class="new-event-remove" :aria-label="`Remove ${m.name} from the event`"
              :title="`Remove ${m.name} from the event`" @click="toggleRemove(m.id)">✕</button>
          </div>
        </div>
      </div>
      <div v-if="ev?.albumUrl" class="new-event-check new-event-album">
        <span>📸 Photo album <span class="new-event-optional">
          <router-link :to="ev.albumUrl" class="new-event-inline">View album</router-link> ·
          <button class="new-event-inline danger" :disabled="busy" @click="deleteAlbum">Delete album and its photos</button>
        </span></span>
      </div>
      <label v-else class="new-event-check">
        <input v-model="album" type="checkbox" />
        <span>Photo album <span class="new-event-optional">a shared album on the site for everyone in the event</span></span>
      </label>

      <div v-if="error" class="error">{{ error }}</div>
      <div v-if="saved" class="new-event-saved">
        ✓ Saved.<template v-if="saved.invited"> Invites went out to {{ saved.invited }} {{ saved.invited === 1 ? "person" : "people" }}.</template>
        <template v-if="saved.failedInvites.length"> Couldn't DM {{ saved.failedInvites.join(", ") }} — they have DMs turned off.</template>
      </div>
      <button class="btn-primary new-event-submit" :disabled="creating" @click="submit">
        {{ editing ? (creating ? "Saving…" : "Save changes") : (creating ? "Creating…" : "Create event") }}
      </button>
      <div v-if="editing" class="new-event-danger">
        <button class="new-event-inline danger" :disabled="busy" @click="deleteEvent">Delete this event</button>
        <span class="new-event-optional">removes the channel, its messages and the join card</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import { authJsonHeaders } from "../utils/session";

interface Person { id: string; name: string; username: string; avatarUrl: string }
interface EventData {
  channelId: string; name: string; description: string; location: string;
  date: string; time: string; endDate: string; endTime: string; imageUrl: string;
  rsvp: boolean; private: boolean; joiningEnabled: boolean; albumUrl: string | null;
  members: Member[]; invitedIds: string[]; discordUrl: string;
}
type RsvpStatus = "coming" | "maybe" | "decline" | "lurking";
interface Member { id: string; name: string; avatarUrl: string; status: RsvpStatus; plusOne: number }
// The People list's RSVP and +1 pickers, by member ID; sent with Save.
const rsvpEdits = ref<Record<string, { status: RsvpStatus; plusOne: number }>>({});
// People marked with ✕ in the People list; they're taken out of the channel when the form is saved.
const removing = ref(new Set<string>());
function toggleRemove(id: string) {
  const next = new Set(removing.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  removing.value = next;
}

const route = useRoute();
const channelId = typeof route.params.channelId === "string" ? route.params.channelId : "";
const editing = !!channelId;
const loading = ref(editing);
const loadError = ref("");
const ev = ref<EventData | null>(null);
const joiningEnabled = ref(true);
const saved = ref<{ invited: number; failedInvites: string[] } | null>(null);
const deleted = ref(false);
const busy = ref(false);

const blank = () => ({ name: "", description: "", location: "", date: "", time: "", endDate: "", endTime: "" });
const form = ref(blank());
const hasEnd = ref(false);
const creating = ref(false);
const error = ref("");
const created = ref<{ channelName: string; discordUrl: string; albumUrl?: string; private: boolean; invited: number; failedInvites: string[] } | null>(null);
const isPrivate = ref(false);

// Invitees, picked from the Discord server's members (loaded the first time the search box is used).
const people = ref<Person[]>([]);
const peopleError = ref("");
let peopleLoading: Promise<void> | null = null;
const invited = ref<Person[]>([]);
const inviteQuery = ref("");
function loadPeople() {
  peopleLoading ??= fetch("/api/events/people").then(async r => {
    if (!r.ok) throw new Error();
    people.value = await r.json();
  }).catch(() => { peopleError.value = "Couldn't load the server members"; peopleLoading = null; });
}
const matches = computed(() => {
  const q = inviteQuery.value.trim().toLowerCase();
  if (!q) return [];
  const chosen = new Set([...invited.value.map(p => p.id), ...(ev.value?.members.map(m => m.id) ?? [])]);
  return people.value
    .filter(p => !chosen.has(p.id) && (p.name.toLowerCase().includes(q) || p.username.toLowerCase().includes(q)))
    .slice(0, 8);
});
function invite(p: Person) {
  invited.value.push(p);
  inviteQuery.value = "";
}
function uninvite(id: string) {
  invited.value = invited.value.filter(p => p.id !== id);
}
const imageMode = ref<"upload" | "link">("upload");
const imageUrl = ref("");
const imageBroken = ref(false);
const linkInput = ref("");
const uploading = ref(false);
const rsvp = ref(true);
const album = ref(false);

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  error.value = "";
  uploading.value = true;
  try {
    const res = await fetch("/api/events/image", { method: "POST", headers: { "Content-Type": file.type || "image/jpeg" }, body: file });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { error.value = data.error ?? "Upload failed. Try again."; return; }
    imageBroken.value = false;
    imageUrl.value = data.url;
  } catch {
    error.value = "Upload failed. Try again.";
  } finally {
    uploading.value = false;
  }
}

function useLink() {
  const url = linkInput.value.trim();
  if (!/^https?:\/\/\S+$/i.test(url)) { error.value = "The image link should start with https://"; return; }
  error.value = "";
  imageBroken.value = false;
  imageUrl.value = url;
}

function clearImage() {
  imageUrl.value = "";
  linkInput.value = "";
  imageBroken.value = false;
}

const d = new Date();
const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Picking an end time on the same day is the common case, so the end date starts as the start date.
watch(hasEnd, on => { if (on && !form.value.endDate) form.value.endDate = form.value.date; });
watch(() => form.value.date, date => { if (!date) { form.value.time = ""; hasEnd.value = false; } });

// Fills the form from the server's copy of the event (on load, and after each save).
function fill(data: EventData) {
  ev.value = data;
  form.value = { name: data.name, description: data.description, location: data.location, date: data.date, time: data.time, endDate: data.endDate, endTime: data.endTime };
  hasEnd.value = !!data.endDate;
  imageUrl.value = data.imageUrl;
  imageBroken.value = false;
  rsvp.value = data.rsvp;
  isPrivate.value = data.private;
  joiningEnabled.value = data.joiningEnabled;
  album.value = false;
  invited.value = [];
  removing.value = new Set();
  rsvpEdits.value = Object.fromEntries(data.members.map(m => [m.id, { status: m.status, plusOne: m.plusOne }]));
}

onMounted(async () => {
  if (!editing) return;
  try {
    const res = await fetch(`/api/events/${channelId}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { loadError.value = data.error ?? "Couldn't load the event."; return; }
    fill(data);
  } catch {
    loadError.value = "Couldn't reach the server.";
  } finally {
    loading.value = false;
  }
});

async function deleteAlbum() {
  if (!confirm("Delete this event's photo album and every photo in it? This can't be undone.")) return;
  busy.value = true;
  error.value = "";
  try {
    const res = await fetch(`/api/events/${channelId}/album`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { error.value = data.error ?? "Couldn't delete the album."; return; }
    if (ev.value) ev.value.albumUrl = null;
  } catch {
    error.value = "Couldn't reach the server.";
  } finally {
    busy.value = false;
  }
}

async function deleteEvent() {
  if (!confirm(`Delete "${ev.value?.name ?? "this event"}"? The channel and everything in it will be gone. This can't be undone.`)) return;
  busy.value = true;
  error.value = "";
  try {
    const res = await fetch(`/api/events/${channelId}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { error.value = data.error ?? "Couldn't delete the event."; return; }
    deleted.value = true;
  } catch {
    error.value = "Couldn't reach the server.";
  } finally {
    busy.value = false;
  }
}

async function submit() {
  error.value = "";
  saved.value = null;
  if (!form.value.name.trim()) { error.value = "Give the event a name."; return; }
  if (hasEnd.value && !form.value.endDate) { error.value = "Pick an end date, or untick the end option."; return; }
  if (uploading.value) { error.value = "Wait for the image to finish uploading."; return; }
  if (imageUrl.value && imageBroken.value) { error.value = "That image link doesn't load. Fix it or remove it."; return; }
  if (isPrivate.value && !invited.value.length && !editing
      && !confirm("This private event has no invites yet, so only you will be in it. Create it anyway?")) return;
  creating.value = true;
  try {
    const f = form.value;
    const res = await fetch(editing ? `/api/events/${channelId}` : "/api/events", {
      method: editing ? "PUT" : "POST",
      headers: authJsonHeaders(),
      body: JSON.stringify({
        name: f.name, description: f.description, location: f.location, date: f.date, time: f.time,
        endDate: hasEnd.value ? f.endDate : "", endTime: hasEnd.value ? f.endTime : "",
        imageUrl: imageUrl.value, rsvp: rsvp.value, album: album.value,
        private: isPrivate.value, invites: isPrivate.value ? invited.value.map(p => p.id) : [], joiningEnabled: joiningEnabled.value,
        rsvps: Object.entries(rsvpEdits.value).filter(([id]) => !removing.value.has(id)).map(([id, r]) => ({ id, ...r })),
        remove: [...removing.value],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { error.value = data.error ?? "Something went wrong. Try again."; return; }
    if (editing) {
      fill(data);
      saved.value = { invited: data.invited ?? 0, failedInvites: data.failedInvites ?? [] };
      return;
    }
    created.value = {
      channelName: data.channelName, discordUrl: data.discordUrl,
      albumUrl: data.albumUrl ? new URL(data.albumUrl).pathname : undefined,
      private: isPrivate.value, invited: data.invited ?? 0, failedInvites: data.failedInvites ?? [],
    };
  } catch {
    error.value = "Couldn't reach the server. Try again.";
  } finally {
    creating.value = false;
  }
}

function reset() {
  form.value = blank();
  hasEnd.value = false;
  created.value = null;
  clearImage();
  rsvp.value = true;
  album.value = false;
  isPrivate.value = false;
  invited.value = [];
  inviteQuery.value = "";
}
</script>

<style scoped>
.new-event { max-width: 560px; }
.form-group textarea { width: 100%; background: #313244; border: 1px solid #45475a; border-radius: 8px; padding: 10px 14px; color: #cdd6f4; font: inherit; font-size: 1rem; outline: none; resize: vertical; }
.form-group textarea:focus { border-color: #cba6f7; }
.form-group input:disabled { opacity: 0.5; }
.form-group input[type="time"]::-webkit-calendar-picker-indicator { filter: invert(1) opacity(0.5); }
.new-event-optional { color: #6c7086; margin-left: 6px; }
.new-event-count { color: #6c7086; font-size: 0.8em; text-align: right; margin-top: 4px; }
.new-event-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.new-event-check { display: flex; align-items: flex-start; gap: 8px; line-height: 1.4; color: #a6adc8; font-size: 0.9em; margin-bottom: 16px; cursor: pointer; }
.new-event-submit { width: 100%; padding: 13px; font-size: 1rem; }
.new-event-another { background: none; border: none; color: #89b4fa; cursor: pointer; font-size: 0.95rem; }
.new-event-check input { margin-top: 3px; }
.new-event-check .new-event-optional { display: block; margin-left: 0; font-size: 0.9em; }
.new-event-tabs { display: inline-flex; background: #313244; border-radius: 8px; padding: 3px; margin-bottom: 8px; }
.new-event-tabs button { background: none; border: none; color: #a6adc8; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 0.9rem; }
.new-event-tabs button.active { background: #45475a; color: #cdd6f4; }
.new-event-drop { display: block; text-align: center; border: 1px dashed #585b70; border-radius: 8px; padding: 22px; color: #a6adc8; cursor: pointer; }
.new-event-drop:hover { border-color: #cba6f7; color: #cdd6f4; }
.new-event-drop.busy { opacity: 0.6; cursor: default; }
.new-event-drop input { display: none; }
.new-event-link { display: flex; gap: 8px; }
.new-event-link input { flex: 1; min-width: 0; }
.new-event-image { position: relative; border-radius: 8px; overflow: hidden; background: #313244; }
.new-event-image img { display: block; width: 100%; max-height: 320px; object-fit: contain; }
.new-event-image-broken { padding: 20px; color: #f38ba8; text-align: center; }
.new-event-image-remove { position: absolute; top: 8px; right: 8px; background: rgba(17,17,27,0.8); color: #cdd6f4; border: none; border-radius: 6px; padding: 5px 10px; cursor: pointer; font-size: 0.85rem; }
.new-event-hint { color: #7f849c; font-size: 0.85em; }
.new-event-people { display: flex; flex-direction: column; gap: 6px; background: #313244; border-radius: 8px; padding: 8px 10px; }
.new-event-person { display: flex; align-items: center; gap: 8px; min-height: 32px; }
.new-event-person-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.new-event-person select { background: #1e1e2e; color: #cdd6f4; border: 1px solid #45475a; border-radius: 6px; padding: 4px 6px; font-size: 0.85rem; }
.new-event-person select:focus { outline: none; border-color: #cba6f7; }
.new-event-plus { width: 76px; }
.new-event-person.removing .new-event-person-name { text-decoration: line-through; color: #6c7086; }
.new-event-person.removing .member-avatar { opacity: 0.4; }
.new-event-remove { background: none; border: none; color: #6c7086; cursor: pointer; padding: 4px 6px; border-radius: 6px; font-size: 0.9rem; }
.new-event-remove:hover { color: #f38ba8; background: #45475a; }
.new-event-album { cursor: default; }
.new-event-inline { background: none; border: none; padding: 0; color: #89b4fa; cursor: pointer; font: inherit; text-decoration: none; }
.new-event-inline.danger { color: #f38ba8; }
.new-event-inline:disabled { opacity: 0.5; cursor: default; }
.new-event-saved { color: #a6e3a1; background: #313244; border-radius: 8px; padding: 10px 16px; margin-bottom: 16px; }
.new-event-danger { margin-top: 28px; padding-top: 16px; border-top: 1px solid #313244; font-size: 0.9em; }
.new-event-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.new-event-chip-x { background: none; border: none; color: #6c7086; cursor: pointer; padding: 0 0 0 4px; font-size: 0.85em; }
.new-event-chip-x:hover { color: #f38ba8; }
.new-event-search { position: relative; }
.new-event-results { position: absolute; z-index: 10; left: 0; right: 0; top: calc(100% + 4px); background: #313244; border: 1px solid #45475a; border-radius: 8px; overflow: hidden; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
.new-event-results button { display: flex; align-items: center; gap: 8px; width: 100%; background: none; border: none; color: #cdd6f4; padding: 8px 12px; cursor: pointer; font-size: 0.95rem; text-align: left; }
.new-event-results button:hover, .new-event-results button:first-child { background: #45475a; }
.new-event-noresults { color: #6c7086; font-size: 0.85em; margin-top: 6px; }
@media (max-width: 480px) { .new-event-row { grid-template-columns: 1fr; gap: 0; } }
</style>
