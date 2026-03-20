<template>
  <div ref="appRoot">
    <router-view />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";

const appRoot = ref<HTMLElement | null>(null);

function applyZoom() {
  if (!appRoot.value) return;
  const w = window.innerWidth;
  const zoom = w > 1600 ? Math.min(w / 1600, 3) : 1;
  appRoot.value.style.zoom = String(zoom);
}

onMounted(() => {
  applyZoom();
  window.addEventListener("resize", applyZoom);
});

onUnmounted(() => {
  window.removeEventListener("resize", applyZoom);
});
</script>
