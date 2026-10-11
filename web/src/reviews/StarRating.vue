<template>
  <div v-if="editable" class="rv-stars rv-stars--input">
    <!-- Half-star steps: the left half of a star picks n − 0.5, the right half n. Arrow keys step by a half. -->
    <div
      class="rv-stars-row" role="slider" tabindex="0" aria-label="Rating"
      aria-valuemin="0.5" aria-valuemax="5" :aria-valuenow="modelValue ?? undefined"
      :aria-valuetext="modelValue === null ? 'Not rated' : `${starsText(modelValue)} — ${ratingLabel(modelValue)}`"
      @mouseleave="hover = null" @keydown="onKey"
    >
      <span
        v-for="n in 5" :key="n" class="rv-star" :class="fill(n, hover ?? modelValue)"
        @mousemove="hover = valueAt($event, n)" @click="set(valueAt($event, n))"
      >★</span>
    </div>
    <span class="rv-rating-label" :class="{ 'rv-rating-label--hint': shownLabel === null }" aria-live="polite">
      {{ shownLabel ?? "Pick a rating" }}
    </span>
  </div>
  <span v-else class="rv-stars" :aria-label="`${modelValue} out of 5 stars — ${ratingLabel(modelValue ?? 0)}`">
    <span v-for="n in 5" :key="n" :class="fill(n, modelValue) || 'off'" aria-hidden="true">★</span>
  </span>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { ratingLabel, starsText } from "./api";

const props = defineProps<{ modelValue: number | null; editable?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: number] }>();
const hover = ref<number | null>(null);

// How full star n is for a rating: "on", "half" or "" (empty).
const fill = (n: number, value: number | null) => (value ?? 0) >= n ? "on" : (value ?? 0) >= n - 0.5 ? "half" : "";

function valueAt(e: MouseEvent, n: number): number {
  const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
  return e.clientX - box.left < box.width / 2 ? n - 0.5 : n;
}

function set(value: number) {
  emit("update:modelValue", value);
  hover.value = null;
}

function onKey(e: KeyboardEvent) {
  const step = { ArrowRight: 0.5, ArrowUp: 0.5, ArrowLeft: -0.5, ArrowDown: -0.5 }[e.key];
  if (!step) return;
  e.preventDefault();
  set(Math.min(5, Math.max(0.5, (props.modelValue ?? (step > 0 ? 0 : 5.5)) + step)));
}

// While hovering, preview the word for that rating; otherwise show the chosen one (null = not rated yet).
const shownLabel = computed(() => {
  const value = hover.value ?? props.modelValue;
  return value === null ? null : ratingLabel(value);
});
</script>
