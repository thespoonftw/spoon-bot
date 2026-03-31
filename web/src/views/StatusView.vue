<template>
  <div class="page">
    <PageHeader back-to="/" title="Status" />

    <div v-if="status" class="status-grid">
      <div class="status-card storage-card">
        <h2 class="status-section-title">Storage</h2>
        <div class="donut-wrap">
          <svg viewBox="0 0 200 200" width="180" height="180">
            <circle cx="100" cy="100" r="75" fill="none" stroke="#313244" stroke-width="18"/>
            <circle cx="100" cy="100" r="75" fill="none"
              :stroke="usageColor"
              stroke-width="18"
              stroke-linecap="round"
              :stroke-dasharray="`${circumference} ${circumference}`"
              :stroke-dashoffset="dashOffset"
              transform="rotate(-90 100 100)"
              style="transition: stroke-dashoffset 0.8s ease"/>
            <text x="100" y="92" text-anchor="middle" fill="#cdd6f4" font-size="30" font-weight="bold" font-family="sans-serif">{{ usedPercent }}%</text>
            <text x="100" y="118" text-anchor="middle" fill="#a6adc8" font-size="13" font-family="sans-serif">used</text>
          </svg>
        </div>
        <div class="storage-stats">
          <div class="storage-stat">
            <span class="storage-stat-label">Used</span>
            <span class="storage-stat-value" :style="{ color: usageColor }">{{ fmt(status.used) }}</span>
          </div>
          <div class="storage-stat">
            <span class="storage-stat-label">Free</span>
            <span class="storage-stat-value">{{ fmt(status.available) }}</span>
          </div>
          <div class="storage-stat">
            <span class="storage-stat-label">Total</span>
            <span class="storage-stat-value">{{ fmt(status.total) }}</span>
          </div>
        </div>
      </div>

      <div class="status-card">
        <h2 class="status-section-title">Library</h2>
        <div class="lib-stats">
          <div class="lib-stat">
            <span class="lib-stat-number">{{ status.albumCount }}</span>
            <span class="lib-stat-label">Albums</span>
          </div>
          <div class="lib-stat">
            <span class="lib-stat-number">{{ status.photoCount }}</span>
            <span class="lib-stat-label">Photos</span>
          </div>
        </div>
      </div>
    </div>

    <p v-else-if="error" class="error">{{ error }}</p>
    <p v-else class="empty">Loading…</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { authHeaders } from "../utils/session";
import PageHeader from "../components/PageHeader.vue";

interface Status { total: number; used: number; available: number; photoCount: number; albumCount: number }

const status = ref<Status | null>(null);
const error = ref("");

const circumference = 2 * Math.PI * 75;

const usedPercent = computed(() => {
  if (!status.value) return 0;
  return Math.round((status.value.used / status.value.total) * 100);
});

const dashOffset = computed(() => {
  return circumference * (1 - usedPercent.value / 100);
});

const usageColor = computed(() => {
  const p = usedPercent.value;
  if (p >= 90) return "#f38ba8";
  if (p >= 75) return "#f9e2af";
  return "#cba6f7";
});

function fmt(bytes: number): string {
  if (bytes >= 1e12) return (bytes / 1e12).toFixed(1) + " TB";
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + " GB";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  return (bytes / 1e3).toFixed(0) + " KB";
}

onMounted(async () => {
  const res = await fetch("/api/status", { headers: authHeaders() });
  if (res.ok) status.value = await res.json();
  else error.value = "Failed to load status.";
});
</script>
