<template>
  <!-- Create Event: opened from /event in Discord. Makes the private event channel and posts its join card. -->
  <div class="page new-event">
    <template v-if="created">
      <h1>Event created 🎉</h1>
      <p class="subtitle">Your channel <strong>#{{ created.channelName }}</strong> is ready, and the join card is up in brunch-events.</p>
      <a class="btn-primary new-event-open" :href="created.discordUrl">Open in Discord</a>
      <button class="new-event-another" @click="reset">Create another</button>
    </template>
    <template v-else>
      <h1>Create Event</h1>
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
          <input id="ev-date" v-model="form.date" type="date" :min="today" />
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

      <div v-if="error" class="error">{{ error }}</div>
      <button class="btn-primary new-event-submit" :disabled="creating" @click="submit">{{ creating ? "Creating…" : "Create event" }}</button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { authJsonHeaders } from "../utils/session";

const blank = () => ({ name: "", description: "", location: "", date: "", time: "", endDate: "", endTime: "" });
const form = ref(blank());
const hasEnd = ref(false);
const creating = ref(false);
const error = ref("");
const created = ref<{ channelName: string; discordUrl: string } | null>(null);

const d = new Date();
const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Picking an end time on the same day is the common case, so the end date starts as the start date.
watch(hasEnd, on => { if (on && !form.value.endDate) form.value.endDate = form.value.date; });
watch(() => form.value.date, date => { if (!date) { form.value.time = ""; hasEnd.value = false; } });

async function submit() {
  error.value = "";
  if (!form.value.name.trim()) { error.value = "Give the event a name."; return; }
  if (hasEnd.value && !form.value.endDate) { error.value = "Pick an end date, or untick the end option."; return; }
  creating.value = true;
  try {
    const f = form.value;
    const res = await fetch("/api/events", {
      method: "POST",
      headers: authJsonHeaders(),
      body: JSON.stringify({
        name: f.name, description: f.description, location: f.location, date: f.date, time: f.time,
        endDate: hasEnd.value ? f.endDate : "", endTime: hasEnd.value ? f.endTime : "",
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { error.value = data.error ?? "Something went wrong. Try again."; return; }
    created.value = { channelName: data.channelName, discordUrl: data.discordUrl };
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
.new-event-check { display: flex; align-items: center; gap: 8px; color: #a6adc8; font-size: 0.9em; margin-bottom: 16px; cursor: pointer; }
.new-event-submit { width: 100%; padding: 13px; font-size: 1rem; }
.new-event-open { display: inline-block; text-decoration: none; margin-right: 12px; }
.new-event-another { background: none; border: none; color: #89b4fa; cursor: pointer; font-size: 0.95rem; }
@media (max-width: 480px) { .new-event-row { grid-template-columns: 1fr; gap: 0; } }
</style>
