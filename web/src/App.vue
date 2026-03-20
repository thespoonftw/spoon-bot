<template>
  <router-view />
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";

function applyZoom() {
  const w = window.innerWidth;
  const zoom = w > 1600 ? Math.min(w / 1600, 3) : 1;
  document.body.style.zoom = String(zoom);
}

onMounted(() => {
  applyZoom();
  window.addEventListener("resize", applyZoom);
});

onUnmounted(() => {
  window.removeEventListener("resize", applyZoom);
});
</script>
