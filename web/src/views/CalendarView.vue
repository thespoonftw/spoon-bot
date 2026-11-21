<template>
  <div class="page cal-page">
    <PageHeader back-to="/" title="Brunch Calendar" />

    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="!data" class="empty">Loading…</p>
    <p v-else-if="!data.linked" class="empty">Your account isn't linked to a Discord account, so there are no events to show. Ask an admin to link it.</p>

    <template v-else>
      <p class="cal-intro">
        Subscribe once and the brunch events appear in your own calendar. Changes made in Discord (dates, times, cancellations) follow automatically,
        though calendar apps only check every so often: Apple within an hour or so, Outlook a few hours, Google up to a day.
      </p>

      <div class="cal-feeds">
        <section v-for="f in feedList" :key="f.key" class="cal-feed">
          <h2>{{ f.title }}</h2>
          <p class="cal-feed-desc">{{ f.desc }}</p>
          <div class="cal-buttons">
            <a class="btn-primary cal-btn" :href="googleUrl(f.url)" target="_blank" rel="noopener">Google Calendar</a>
            <a class="btn-secondary cal-btn" :href="webcalUrl(f.url)">Apple / iPhone</a>
            <a class="btn-secondary cal-btn" :href="outlookUrl(f.url, f.title)" target="_blank" rel="noopener">Outlook</a>
            <button class="btn-secondary cal-btn" @click="copy(f.key, f.url)">{{ copied === f.key ? "Copied!" : "Copy link" }}</button>
          </div>
        </section>
      </div>

      <h2 class="cal-heading">Coming up</h2>
      <p v-if="!data.events.length" class="empty">No upcoming events with a date yet.</p>
      <ul v-else class="cal-events">
        <li v-for="e in data.events" :key="e.channelId" class="cal-event">
          <div class="cal-event-main">
            <span class="cal-event-name">{{ e.name }}</span>
            <span class="cal-event-when">{{ e.dateText.replace(", All Day", "") }}<template v-if="e.endDateText"> – {{ e.endDateText.replace(", All Day", "") }}</template></span>
            <span v-if="e.location" class="cal-event-where">📍 {{ e.location }}</span>
          </div>
          <span v-if="e.myStatus" :class="['cal-badge', `cal-badge--${e.myStatus}`]">{{ e.myStatus === "coming" ? "Coming" : "Maybe" }}</span>
        </li>
      </ul>

      <p class="cal-reset">
        These links are private to you: anyone who has them can see the events.
        If you've shared them by mistake, <button class="cal-link-btn" :disabled="resetting" @click="reset">make new links</button>
        (calendars using the old ones will stop updating).
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import PageHeader from "../components/PageHeader.vue";

type CalEvent = { channelId: string; name: string; dateText: string; endDateText: string | null; location: string | null; myStatus: "coming" | "maybe" | null };
type CalData = { linked: boolean; feeds?: { all: string; mine: string }; events: CalEvent[] };

const data = ref<CalData | null>(null);
const error = ref("");
const copied = ref("");
const resetting = ref(false);

const feedList = computed(() => data.value?.feeds ? [
  { key: "mine", title: "My brunch events", desc: "Just the events you've said you're coming to (or maybe).", url: data.value.feeds.mine },
  { key: "all", title: "All brunch events", desc: "Every event in brunch-events, whether you're going or not.", url: data.value.feeds.all },
] : []);

const webcalUrl = (url: string) => url.replace(/^https?:\/\//, "webcal://");
const googleUrl = (url: string) => `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl(url))}`;
const outlookUrl = (url: string, name: string) => `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`;

async function load() {
  try {
    const res = await fetch("/api/calendar");
    if (!res.ok) throw new Error();
    data.value = await res.json();
  } catch { error.value = "Couldn't load the calendar."; }
}

async function copy(key: string, url: string) {
  try {
    await navigator.clipboard.writeText(url);
    copied.value = key;
    setTimeout(() => { if (copied.value === key) copied.value = ""; }, 2000);
  } catch { window.prompt("Copy this link:", url); }
}

async function reset() {
  if (!confirm("Make new calendar links? Any calendar subscribed with the old links will stop updating, so you'll need to subscribe again.")) return;
  resetting.value = true;
  try {
    const res = await fetch("/api/calendar/reset", { method: "POST" });
    if (!res.ok) throw new Error();
    const { feeds } = await res.json();
    if (data.value) data.value.feeds = feeds;
  } catch { alert("Couldn't make new links."); }
  resetting.value = false;
}

onMounted(load);
</script>

<style scoped>
.cal-page { max-width: 760px; }
.cal-intro { color: #a6adc8; line-height: 1.5; margin: 8px 0 20px; }
.cal-feeds { display: grid; gap: 16px; }
.cal-feed { background: #313244; border-radius: 10px; padding: 18px 20px; }
.cal-feed h2 { margin: 0 0 4px; font-size: 1.15rem; }
.cal-feed-desc { margin: 0 0 14px; color: #a6adc8; font-size: 0.92rem; }
.cal-buttons { display: flex; flex-wrap: wrap; gap: 8px; }
.cal-btn { text-decoration: none; font-size: 0.88rem; padding: 8px 14px; }
.cal-heading { margin: 28px 0 10px; font-size: 1.15rem; }
.cal-events { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
.cal-event { display: flex; align-items: center; gap: 12px; background: #313244; border-radius: 8px; padding: 10px 14px; }
.cal-event-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.cal-event-name { font-weight: 600; }
.cal-event-when, .cal-event-where { color: #a6adc8; font-size: 0.88rem; overflow-wrap: anywhere; }
.cal-badge { flex-shrink: 0; font-size: 0.78rem; font-weight: 600; padding: 3px 10px; border-radius: 999px; color: #1e1e2e; }
.cal-badge--coming { background: #a6e3a1; }
.cal-badge--maybe { background: #f9e2af; }
.cal-reset { margin-top: 28px; color: #6c7086; font-size: 0.85rem; line-height: 1.5; }
.cal-link-btn { background: none; border: none; padding: 0; color: #89b4fa; cursor: pointer; font: inherit; text-decoration: underline; }
.cal-link-btn:disabled { opacity: 0.6; cursor: default; }
@media (max-width: 600px) {
  .page.cal-page { padding: 20px 16px; }
}
</style>
