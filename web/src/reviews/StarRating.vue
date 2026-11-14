<template>
  <div v-if="editable" class="rv-stars rv-stars--input" :class="{ 'rv-stars--full': full, 'rv-stars--quarter': quarter && !full }">
    <!-- Half-star steps: the left half of a star picks n − 0.5, the right half n (full star purists
         get whole stars only; quarter star connoisseurs pick by the quarter of the star). Clicking
         the rating already chosen, or the strip left of the first star, gives 0. Arrow keys step by
         the same amount. -->
    <div
      class="rv-stars-row" role="slider" tabindex="0" aria-label="Rating"
      aria-valuemin="0" aria-valuemax="5" :aria-valuenow="modelValue ?? undefined"
      :aria-valuetext="modelValue === null ? 'Not rated' : `${starsText(modelValue)} — ${ratingLabel(modelValue)}`"
      @mouseleave="hover = null" @keydown="onKey"
    >
      <span class="rv-stars-zero" aria-hidden="true" @mousemove="hover = 0" @click="set(0)"></span>
      <span
        v-for="n in 5" :key="n" class="rv-star" :class="fill(n, hover ?? modelValue)" :style="part(n, hover ?? modelValue)"
        @mousemove="hover = valueAt($event, n)" @click="pick(valueAt($event, n))"
      >★</span>
    </div>
    <span class="rv-rating-label" :class="{ 'rv-rating-label--hint': shownLabel === null }" aria-live="polite">
      {{ shownLabel ?? "Pick a rating" }}
    </span>
  </div>
  <span v-else class="rv-stars" :class="{ 'rv-stars--full': full, 'rv-stars--quarter': quarter && !full }" :aria-label="`${modelValue} out of 5 stars — ${ratingLabel(modelValue ?? 0)}`">
    <span v-for="n in 5" :key="n" :class="fill(n, modelValue) || 'off'" :style="part(n, modelValue)" aria-hidden="true">★</span>
  </span>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { ratingLabel, starsText } from "./api";

// full: a full star purist's rating — whole stars only, in orange. quarter: a quarter star
// connoisseur's — pale pink, and the picker steps by quarter stars.
const props = defineProps<{ modelValue: number | null; editable?: boolean; full?: boolean | number; quarter?: boolean | number }>();
const emit = defineEmits<{ "update:modelValue": [value: number] }>();
const hover = ref<number | null>(null);
const step = computed(() => props.full ? 1 : props.quarter ? 0.25 : 0.5);

// How full star n is for a rating: "on", "half" (partly filled: a quarter, half or three quarters)
// or "" (empty). part() gives a partly filled star how much of it to fill.
const fill = (n: number, value: number | null) => (value ?? 0) >= n ? "on" : (value ?? 0) > n - 1 ? "half" : "";
const part = (n: number, value: number | null) => {
  const f = (value ?? 0) - (n - 1);
  return f > 0 && f < 1 ? { "--p": `${f * 100}%` } : undefined;
};

// Which step of star n the pointer is over: the left half gives n − 0.5 and the right half n, or
// the same by quarters.
function valueAt(e: MouseEvent, n: number): number {
  const s = step.value;
  if (s >= 1) return n;
  const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const slot = Math.min(1 / s - 1, Math.floor((e.clientX - box.left) / box.width / s));
  return n - 1 + (slot + 1) * s;
}

function set(value: number) {
  emit("update:modelValue", value);
  hover.value = null;
}

// A second click on the chosen rating takes it down to 0 stars.
function pick(value: number) {
  set(value === props.modelValue ? 0 : value);
}

function onKey(e: KeyboardEvent) {
  const dir = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
  if (!dir) return;
  e.preventDefault();
  const s = step.value;
  const current = props.modelValue ?? (dir > 0 ? -s : 5 + s);
  // Snap onto the step first, so a purist editing an old 3.5 lands on 3 or 4.
  const next = dir > 0 ? Math.floor(current / s) * s + s : Math.ceil(current / s) * s - s;
  set(Math.min(5, Math.max(0, next)));
}

// While hovering, preview the word for that rating; otherwise show the chosen one (null = not rated yet).
const shownLabel = computed(() => {
  const value = hover.value ?? props.modelValue;
  return value === null ? null : ratingLabel(value);
});
</script>
