<template>
  <!-- Add to calendar: linked from each event card's date line (/calendar?event=<channelId>).
       Every link is a subscription personal to whoever's signed in, so calendars follow date changes. -->
  <div class="page cal">
    <h1>Add to your calendar</h1>
    <p v-if="loading" class="subtitle">Loading your links…</p>
    <div v-else-if="error" class="error">{{ error }}</div>
    <template v-else-if="links">
      <p class="subtitle">These are subscriptions, so if an event's date or details change, your calendar updates too.</p>
      <div v-if="onPhone" class="cal-phone">
        📱 <strong>Using Google Calendar?</strong> Google only lets you add subscriptions on a computer. Open this page at
        calendar.google.com on a computer (or <button class="cal-reset cal-inline" @click="copy('page', pageUrl)">{{ copied === "page" ? "copied ✓" : "copy this page's link" }}</button>
        to send to yourself) and click Google there; it'll then show on your phone too. Apple and Outlook work fine from here.
      </div>

      <section v-for="opt in options" :key="opt.key" class="cal-option">
        <h2>{{ opt.title }}</h2>
        <p class="cal-desc">{{ opt.desc }}</p>
        <div class="cal-buttons">
          <a class="cal-btn" :href="opt.links.google" target="_blank" rel="noopener">Google</a>
          <a class="cal-btn" :href="opt.links.apple">Apple</a>
          <a class="cal-btn" :href="opt.links.outlook" target="_blank" rel="noopener">Outlook</a>
          <button class="cal-btn cal-copy" @click="copy(opt.key, opt.links.url)">{{ copied === opt.key ? "Copied ✓" : "Copy link" }}</button>
        </div>
      </section>

      <p class="cal-note">
        Google Calendar only re-checks subscriptions every few hours (sometimes up to a day), so changes can take a while to show there.
        Apple and Outlook usually catch up within the hour.
      </p>
      <p class="cal-note">
        These links are just for you. If you've shared one by mistake,
        <button class="cal-reset" :disabled="resetting" @click="reset">reset your links</button> —
        calendars using the old ones stop updating, and you'll need to add them again.
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRoute } from "vue-router";

interface FeedLinks { name: string; url: string; google: string; apple: string; outlook: string }
interface Links { event: (FeedLinks & { channelId: string; dated: boolean }) | null; joined: FeedLinks; all: FeedLinks }

const route = useRoute();
const eventId = typeof route.query.event === "string" ? route.query.event : "";
const links = ref<Links | null>(null);
const loading = ref(true);
const error = ref("");
const copied = ref("");
const resetting = ref(false);
// Google Calendar can't subscribe to a URL from its phone app or mobile site, so phones get told to use a computer.
const onPhone = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const pageUrl = location.href;

const options = computed(() => {
  const l = links.value;
  if (!l) return [];
  return [
    ...(l.event ? [{
      key: "event", links: l.event,
      title: `Just this event: ${l.event.name}`,
      desc: l.event.dated
        ? "Only this event. If its date or time changes, it moves in your calendar."
        : "Only this event. It doesn't have a date yet, so it'll appear in your calendar once it does.",
    }] : []),
    { key: "joined", links: l.joined, title: "Events I'm in", desc: "Every brunch event you've RSVP'd Going, Maybe or Lurking to. Events you join later get added; ones you decline or leave drop off." },
    { key: "all", links: l.all, title: "All brunch events", desc: "Every brunch event with a date, including ones you haven't joined or have declined." },
  ];
});

async function load(method: "GET" | "POST" = "GET") {
  const q = eventId ? `?event=${encodeURIComponent(eventId)}` : "";
  const res = await fetch(method === "POST" ? `/api/calendar/reset${q}` : `/api/calendar/links${q}`, { method });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Couldn't load your calendar links.");
  links.value = data;
}

onMounted(async () => {
  try { await load(); } catch (e) { error.value = (e as Error).message; } finally { loading.value = false; }
});

async function copy(key: string, url: string) {
  try {
    await navigator.clipboard.writeText(url);
    copied.value = key;
    setTimeout(() => { if (copied.value === key) copied.value = ""; }, 2000);
  } catch {
    prompt("Copy this link:", url);
  }
}

async function reset() {
  if (!confirm("Make new calendar links? Calendars using your old links will stop updating until you add the new ones.")) return;
  resetting.value = true;
  try { await load("POST"); } catch (e) { error.value = (e as Error).message; } finally { resetting.value = false; }
}
</script>

<style scoped>
.cal { max-width: 560px; }
.cal-option { background: #313244; border-radius: 10px; padding: 16px 18px; margin-bottom: 14px; }
.cal-option h2 { font-size: 1.05rem; color: #cdd6f4; margin: 0 0 4px; overflow-wrap: anywhere; }
.cal-desc { color: #a6adc8; font-size: 0.9em; line-height: 1.5; margin: 0 0 12px; }
.cal-buttons { display: flex; flex-wrap: wrap; gap: 8px; }
.cal-btn { background: #45475a; color: #cdd6f4; border: none; border-radius: 8px; padding: 8px 14px; font-size: 0.9rem; text-decoration: none; cursor: pointer; }
.cal-btn:hover { background: #585b70; }
.cal-copy { background: none; border: 1px solid #45475a; }
.cal-note { color: #7f849c; font-size: 0.85em; line-height: 1.5; margin-top: 12px; }
.cal-reset { background: none; border: none; padding: 0; color: #f38ba8; font: inherit; cursor: pointer; text-decoration: underline; }
.cal-reset:disabled { opacity: 0.5; cursor: default; }
.cal-inline { color: #89b4fa; }
.cal-phone { background: #313244; border-left: 3px solid #f9e2af; border-radius: 8px; padding: 12px 14px; margin-bottom: 16px; color: #cdd6f4; font-size: 0.9em; line-height: 1.5; }
</style>
