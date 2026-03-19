<template>
  <div class="page">
    <div class="header-row">
      <div class="header-left">
        <router-link to="/" class="back">← Home</router-link>
        <h1>📸 Photo Albums</h1>
      </div>
      <div class="user-info" v-if="currentUser">
        <img v-if="currentUser.avatarUrl" :src="currentUser.avatarUrl" class="avatar" />
        <div class="avatar placeholder" v-else>{{ currentUser.displayName[0] }}</div>
        <span class="user-name">{{ currentUser.displayName }}</span>
        <button class="logout" @click="logout">Log out</button>
      </div>
    </div>

    <button class="btn-primary" @click="showModal = true" style="margin-bottom:20px">+ New Album</button>

    <p v-if="albums.length === 0" class="empty">No albums yet.</p>
    <template v-for="group in albumsByYear" :key="group.year">
      <h2 class="year-header">{{ group.year }}</h2>
      <router-link v-for="album in group.items" :key="album.channelId" :to="`/album/${album.channelId}`" class="card">
        <h2>{{ album.groupName }}</h2>
        <p v-if="album.dateText" class="date">{{ stripYear(album.dateText) }}</p>
        <p v-if="album.location" class="meta">📍 {{ album.location }}</p>
        <div class="card-footer">
          <span class="meta">{{ album.photos.length }} photo(s)</span>
          <div v-if="album.members.length > 0" class="card-members">
            <div v-for="member in album.members" :key="member.userId" class="card-member-avatar" :title="member.firstName || member.displayName">
              <img v-if="member.avatarUrl" :src="member.avatarUrl" />
              <span v-else>{{ (member.firstName || member.displayName)[0] }}</span>
            </div>
            <span class="meta" style="margin-left:4px">{{ album.members.length }}</span>
          </div>
        </div>
        <button class="card-share-btn" @click.prevent.stop="openShare(album)">Share</button>
      </router-link>
    </template>
  </div>

  <!-- Create Album Modal -->
  <div class="modal-overlay" v-if="showModal">
    <div class="modal">
      <button class="modal-close" @click="closeModal">✕</button>
      <h2>New Album</h2>
      <div class="form-group">
        <label>Name</label>
        <input v-model="form.name" type="text" placeholder="e.g. Summer Trip" />
      </div>
      <div class="form-group">
        <label>Location</label>
        <input v-model="form.location" type="text" placeholder="e.g. Barcelona" />
      </div>
      <div class="form-group">
        <label>Start Date</label>
        <input v-model="form.startDate" type="date" />
      </div>
      <div class="form-group">
        <label>End Date</label>
        <div v-if="form.endDate" style="display:flex;gap:8px;align-items:center">
          <input v-model="form.endDate" type="date" style="flex:1" />
          <button type="button" class="btn-remove" @click="form.endDate = ''">remove</button>
        </div>
        <button v-else type="button" class="btn-secondary btn-small" @click="form.endDate = form.startDate">+ Add end date</button>
      </div>
      <div v-if="formError" class="error">{{ formError }}</div>
      <div class="modal-actions">
        <button class="btn-primary" @click="createAlbum" :disabled="creating">{{ creating ? "Creating…" : "Create" }}</button>
      </div>
    </div>
  </div>

  <!-- Share Album Modal -->
  <div class="modal-overlay" v-if="sharingAlbum">
    <div class="modal">
      <button class="modal-close" @click="sharingAlbum = null">✕</button>
      <h2>Share Album</h2>
      <p style="color:#a6adc8;font-size:0.85em;margin-bottom:20px">{{ sharingAlbum.groupName }}</p>
      <template v-if="!shareUrl">
        <div class="form-group">
          <label>Password</label>
          <input v-model="sharePassword" type="password" placeholder="Set a password for this link" @keyup.enter="generateShareLink" autofocus />
        </div>
        <div class="modal-actions">
          <button class="btn-primary" @click="generateShareLink" :disabled="sharing || !sharePassword.trim()">
            {{ sharing ? "Generating…" : "Generate Link" }}
          </button>
        </div>
      </template>
      <template v-else>
        <p style="color:#a6adc8;font-size:0.85em;margin-bottom:12px">Share this link and tell them the password:</p>
        <div style="display:flex;gap:8px">
          <input type="text" :value="shareUrl" readonly class="share-link-input" />
          <button class="btn-secondary btn-small" @click="copyLink">{{ copied ? "✓ Copied" : "Copy" }}</button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useCurrentUser } from "../composables/useCurrentUser";

interface Member { userId: string; displayName: string; firstName?: string; avatarUrl?: string }
interface Album { channelId: string; groupName: string; dateText?: string; location?: string; startDate?: string; createdAt: string; photos: { id: number }[]; members: Member[] }

const albums = ref<Album[]>([]);
const { currentUser, logout } = useCurrentUser();

const showModal = ref(false);
const creating = ref(false);
const formError = ref("");
const form = ref({ name: "", location: "", startDate: "", endDate: "" });

const sharingAlbum = ref<Album | null>(null);
const sharePassword = ref("");
const shareUrl = ref("");
const sharing = ref(false);
const copied = ref(false);

const albumsByYear = computed(() => {
  const groups = new Map<string, Album[]>();
  for (const album of albums.value) {
    const year = album.startDate?.slice(0, 4)
      ?? /(\d{4})/.exec(album.dateText ?? "")?.[1]
      ?? album.createdAt.slice(0, 4);
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year)!.push(album);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([year, items]) => ({ year, items }));
});

function stripYear(dateText: string): string {
  return dateText.replace(/ \d{4}$/, "");
}

onMounted(async () => {
  const res = await fetch("/api/albums");
  albums.value = await res.json();
});

function closeModal() {
  showModal.value = false;
  formError.value = "";
  form.value = { name: "", location: "", startDate: "", endDate: "" };
}

async function createAlbum() {
  formError.value = "";
  if (!form.value.name.trim()) { formError.value = "Name is required."; return; }
  if (!form.value.location.trim()) { formError.value = "Location is required."; return; }
  if (!form.value.startDate) { formError.value = "Start date is required."; return; }
  creating.value = true;
  const session = localStorage.getItem("snek_session");
  const res = await fetch("/api/albums", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session}` },
    body: JSON.stringify({
      name: form.value.name.trim(),
      location: form.value.location.trim(),
      startDate: form.value.startDate,
      endDate: form.value.endDate || undefined,
    }),
  });
  creating.value = false;
  if (res.ok) {
    const album = await res.json();
    albums.value.unshift(album);
    closeModal();
  } else {
    formError.value = "Failed to create album. Try again.";
  }
}

function openShare(album: Album) {
  sharingAlbum.value = album;
  sharePassword.value = "";
  shareUrl.value = "";
  copied.value = false;
}

async function generateShareLink() {
  if (!sharingAlbum.value || !sharePassword.value.trim()) return;
  sharing.value = true;
  const session = localStorage.getItem("snek_session");
  const res = await fetch(`/api/album/${sharingAlbum.value.channelId}/share`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session}` },
    body: JSON.stringify({ password: sharePassword.value.trim() }),
  });
  sharing.value = false;
  if (res.ok) {
    const data = await res.json();
    shareUrl.value = data.url;
  }
}

function copyLink() {
  navigator.clipboard.writeText(shareUrl.value);
  copied.value = true;
  setTimeout(() => { copied.value = false; }, 2000);
}
</script>
