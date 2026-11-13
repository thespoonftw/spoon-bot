<template>
  <div class="page-header">
    <router-link :to="backTo" class="page-back">‹</router-link>
    <div ref="titleBox" class="page-header-title">
      <div class="page-header-title-row">
        <h1 ref="titleEl" class="page-header-h1">{{ title }}</h1>
      </div>
      <span v-if="subtitle" class="page-header-subtitle">{{ subtitle }}</span>
      <div v-if="groupTag" :class="['page-header-location', { 'page-header-location--tag-only': !locations?.length }]" style="gap:6px">
        <span class="user-group-tag page-header-group-tag" :style="{ background: groupTag.color }">{{ groupTag.name }}</span>
        <span v-if="locations?.length">📍 <template v-for="(loc, i) in locations" :key="loc.id">{{ i ? ", " : "" }}<span :class="{ 'page-header-location-link': locations.length > 1 }" @click="locations.length > 1 && $emit('location-click', loc.id)">{{ loc.name }}</span></template></span>
      </div>
      <div v-else-if="locations?.length" class="page-header-location">
        <span>📍 <template v-for="(loc, i) in locations" :key="loc.id">{{ i ? ", " : "" }}<span :class="{ 'page-header-location-link': locations.length > 1 }" @click="locations.length > 1 && $emit('location-click', loc.id)">{{ loc.name }}</span></template></span>
      </div>
    </div>
    <div :class="['page-header-actions', { 'page-header-actions--stack': mobileStack }]">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted } from "vue";
const props = defineProps<{ backTo: string; title: string; subtitle?: string; locations?: { id: number; name: string }[]; mobileStack?: boolean; groupTag?: { name: string; color: string } | null }>();
// With several locations, clicking one sorts the album photos by location, starting there.
defineEmits<{ 'location-click': [id: number] }>();
// The title always sits on one line: it starts at its normal CSS size and shrinks just enough to fit
// the space beside the back button (down to MIN_TITLE_PX, after which it ends in "…").
const MIN_TITLE_PX = 14;
const titleEl = ref<HTMLElement | null>(null);
const titleBox = ref<HTMLElement | null>(null);
function fitTitle() {
  const el = titleEl.value;
  if (!el) return;
  el.style.fontSize = "";
  const max = parseFloat(getComputedStyle(el).fontSize);
  let size = max;
  // Text width scales almost exactly with font size, so one proportional step lands close; a couple of
  // small nudges cover rounding.
  for (let i = 0; i < 4 && el.scrollWidth > el.clientWidth && size > MIN_TITLE_PX; i++) {
    size = Math.max(MIN_TITLE_PX, Math.floor(size * (el.clientWidth / el.scrollWidth) * 10) / 10 - (i ? 0.5 : 0));
    el.style.fontSize = size + "px";
  }
}
let resizeObserver: ResizeObserver | null = null;
onMounted(() => {
  fitTitle();
  document.fonts?.ready.then(fitTitle);
  // Watch the title column (not the title itself, whose size we change) for screen and layout changes.
  resizeObserver = new ResizeObserver(() => fitTitle());
  if (titleBox.value) resizeObserver.observe(titleBox.value);
});
onUnmounted(() => resizeObserver?.disconnect());
watch(() => props.title, () => nextTick(fitTitle));
</script>
