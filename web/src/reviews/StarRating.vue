<template>
  <div v-if="editable" class="rv-stars rv-stars--input">
    <div role="radiogroup" aria-label="Rating" class="rv-stars-row" @mouseleave="hover = null">
      <!-- Hidden 0-star option: an invisible strip just left of the first star. -->
      <button type="button" class="rv-stars-zero" role="radio" :aria-checked="modelValue === 0" :aria-label="`0 stars — ${RATING_LABELS[0]}`"
        @mouseenter="hover = 0" @click="set(0)"></button>
      <button
        v-for="n in 5" :key="n" type="button"
        :class="{ on: n <= (hover ?? modelValue ?? 0) }"
        @mouseenter="hover = n" @click="set(n)"
        role="radio" :aria-checked="modelValue === n" :aria-label="`${n} star${n > 1 ? 's' : ''} — ${RATING_LABELS[n]}`"
      >★</button>
    </div>
    <span class="rv-rating-label" :class="{ 'rv-rating-label--hint': shownLabel === null }" aria-live="polite">
      {{ shownLabel ?? "Pick a rating" }}
    </span>
  </div>
  <span v-else class="rv-stars" :aria-label="`${modelValue} out of 5 stars — ${RATING_LABELS[modelValue ?? 0]}`">
    <span v-for="n in 5" :key="n" :class="{ off: n > (modelValue ?? 0) }" aria-hidden="true">★</span>
    <span v-if="withLabel && modelValue !== null" class="rv-rating-label">{{ RATING_LABELS[modelValue] }}</span>
  </span>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { RATING_LABELS } from "./api";

const props = defineProps<{ modelValue: number | null; editable?: boolean; withLabel?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: number] }>();
const hover = ref<number | null>(null);

function set(n: number) {
  emit("update:modelValue", n);
  hover.value = null;
}

// While hovering, preview the word for that rating; otherwise show the chosen one (null = not rated yet).
const shownLabel = computed(() => {
  const value = hover.value ?? props.modelValue;
  return value === null ? null : RATING_LABELS[value];
});
</script>
