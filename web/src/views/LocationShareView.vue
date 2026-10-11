<template>
  <div class="page center">
    <h1>📍 Share location</h1>

    <p v-if="state === 'loading'" class="subtitle">Loading…</p>

    <template v-else-if="state === 'ended'">
      <p class="subtitle">{{ endedMessage }}</p>
    </template>

    <div v-else class="confirm-card">
      <p class="confirm-text">
        <template v-if="state === 'sharing'">Sharing your location in <b>#{{ info?.channelName }}</b></template>
        <template v-else>Share your location in <b>#{{ info?.channelName }}</b></template>
        until {{ formatClock(info!.expiresAt) }}.
      </p>

      <div v-if="error" class="error" style="margin:0">{{ error }}</div>

      <template v-if="state === 'sharing'">
        <div class="loc-status">
          <span class="loc-dot" :class="{ 'loc-dot--live': lastSent }"></span>
          <span v-if="lastSent">Sent {{ formatClock(lastSent) }} · within ~{{ Math.round(latest!.accuracy) }} m</span>
          <span v-else>Finding you…</span>
        </div>
        <p class="loc-note">Keep this page open. Your location stops updating if you close it or lock your phone.</p>
        <button class="btn-secondary" style="width:100%" @click="stop">Stop sharing</button>
      </template>

      <button v-else class="btn-primary" style="width:100%" @click="start">Start sharing</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { useRoute } from "vue-router";

interface Info { name: string; channelName: string; expiresAt: number }
interface Fix { lat: number; lng: number; accuracy: number }

const HEARTBEAT_MS = 20_000; // Resend the latest fix this often so the card's "Updated" stays fresh.
const MIN_GAP_MS = 5_000;    // Don't send new fixes more often than this.

const token = useRoute().params.token as string;
const state = ref<"loading" | "ready" | "sharing" | "ended">("loading");
const info = ref<Info | null>(null);
const error = ref("");
const endedMessage = ref("This link has ended. Use /location in Discord to share again.");
const latest = ref<Fix | null>(null);
const lastSent = ref<number | null>(null);

let watchId: number | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let wakeLock: { release(): Promise<void> } | null = null;

const formatClock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

onMounted(async () => {
  try {
    const res = await fetch(`/api/location/${token}`);
    if (!res.ok) { state.value = "ended"; return; }
    info.value = await res.json();
    state.value = "ready";
  } catch {
    state.value = "ended";
    endedMessage.value = "Couldn't reach the server. Try opening the link again.";
    return;
  }
  // If location permission was already given, there's nothing to tap through.
  try {
    const perm = await navigator.permissions?.query({ name: "geolocation" });
    if (perm?.state === "granted") start();
  } catch { /* permissions API missing: wait for the button */ }
});

onUnmounted(cleanUp);

function start() {
  if (!navigator.geolocation) { error.value = "This browser can't share its location."; return; }
  error.value = "";
  state.value = "sharing";
  watchId = navigator.geolocation.watchPosition(onFix, onError, { enableHighAccuracy: true, maximumAge: 10_000, timeout: 60_000 });
  heartbeat = setInterval(() => { if (latest.value) send(); }, HEARTBEAT_MS);
  keepAwake();
  document.addEventListener("visibilitychange", keepAwake);
}

function onFix(pos: GeolocationPosition) {
  latest.value = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
  error.value = "";
  if (!lastSent.value || Date.now() - lastSent.value >= MIN_GAP_MS) send();
}

function onError(err: GeolocationPositionError) {
  if (err.code === err.PERMISSION_DENIED) {
    cleanUp();
    state.value = "ready";
    error.value = "Location permission was denied. Allow it in your browser's settings, then try again.";
  } else {
    error.value = "Having trouble getting your location. Still trying…";
  }
}

async function send() {
  if (!latest.value) return;
  try {
    const res = await fetch(`/api/location/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(latest.value),
    });
    if (res.status === 404) { cleanUp(); state.value = "ended"; endedMessage.value = "Sharing has ended."; return; }
    if (res.ok) { lastSent.value = Date.now(); info.value = await res.json(); }
  } catch {
    error.value = "Couldn't reach the server. Still trying…";
  }
}

async function stop() {
  cleanUp();
  state.value = "ended";
  endedMessage.value = "You've stopped sharing your location.";
  try { await fetch(`/api/location/${token}/stop`, { method: "POST" }); } catch { /* it'll expire anyway */ }
}

// Stop the screen from sleeping while sharing, as most phones pause the page when it does.
// The lock is dropped whenever the page is hidden, so it's taken again on return.
async function keepAwake() {
  if (state.value !== "sharing" || document.visibilityState !== "visible") return;
  try {
    wakeLock = await (navigator as unknown as { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock?.request("screen") ?? null;
  } catch { /* not supported or refused: carry on without it */ }
}

function cleanUp() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
  document.removeEventListener("visibilitychange", keepAwake);
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}
</script>

<style scoped>
.loc-status { display: flex; align-items: center; gap: 8px; color: #cdd6f4; }
.loc-dot { width: 10px; height: 10px; border-radius: 50%; background: #6c7086; flex-shrink: 0; }
.loc-dot--live { background: #a6e3a1; box-shadow: 0 0 0 0 rgba(166, 227, 161, 0.6); animation: loc-pulse 2s infinite; }
@keyframes loc-pulse { 70% { box-shadow: 0 0 0 8px rgba(166, 227, 161, 0); } 100% { box-shadow: 0 0 0 0 rgba(166, 227, 161, 0); } }
.loc-note { color: #a6adc8; font-size: 0.85rem; line-height: 1.5; margin: 0; }
</style>
