<template>
  <div v-if="editable" class="rv-stars rv-stars--input" :class="{ 'rv-stars--full': full }">
    <!-- Half-star steps: the left half of a star picks n − 0.5, the right half n (full star purists
         get whole stars only). Clicking the rating already chosen, or the strip left of the first
         star, gives 0. Arrow keys step by a half (or a whole star). -->
    <div
      class="rv-stars-row" role="slider" tabindex="0" aria-label="Rating"
      aria-valuemin="0" aria-valuemax="5" :aria-valuenow="modelValue ?? undefined"
      :aria-valuetext="modelValue === null ? 'Not rated' : `${starsText(modelValue)} — ${ratingLabel(modelValue)}`"
      @mouseleave="hover = null" @keydown="onKey"
    >
      <span class="rv-stars-zero" aria-hidden="true" @mousemove="hover = 0" @click="set(0)"></span>
      <span
        v-for="n in 5" :key="n" class="rv-star" :class="fill(n, hover ?? modelValue)"
        @mousemove="hover = valueAt($event, n)" @click="pick(valueAt($event, n))"
      >★</span>
    </div>
    <span class="rv-rating-label" :class="{ 'rv-rating-label--hint': shownLabel === null }" aria-live="polite">
      {{ shownLabel ?? "Pick a rating" }}
    </span>
  </div>
  <span v-else class="rv-stars" :class="{ 'rv-stars--full': full }" :aria-label="`${modelValue} out of 5 stars — ${ratingLabel(modelValue ?? 0)}`">
    <span v-for="n in 5" :key="n" :class="fill(n, modelValue) || 'off'" aria-hidden="true">★</span>
  </span>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { ratingLabel, starsText } from "./api";

// full: a full star purist's rating — whole stars only, in orange.
const props = defineProps<{ modelValue: number | null; editable?: boolean; full?: boolean | number }>();
const emit = defineEmits<{ "update:modelValue": [value: number] }>();
const hover = ref<number | null>(null);
const step = computed(() => props.full ? 1 : 0.5);

// How full star n is for a rating: "on", "half" or "" (empty).
const fill = (n: number, value: number | null) => (value ?? 0) >= n ? "on" : (value ?? 0) >= n - 0.5 ? "half" : "";

function valueAt(e: MouseEvent, n: number): number {
  if (props.full) return n;
  const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
  return e.clientX - box.left < box.width / 2 ? n - 0.5 : n;
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
