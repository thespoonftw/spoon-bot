<template>
  <div v-if="editable" class="rv-stars rv-stars--input">
    <div role="radiogroup" aria-label="Rating" @mouseleave="hover = null">
      <button
        v-for="n in 5" :key="n" type="button"
        :class="{ on: n <= (hover ?? modelValue ?? 0) }"
        @mouseenter="hover = n" @click="set(n)"
        role="radio" :aria-checked="modelValue === n" :aria-label="`${n} star${n > 1 ? 's' : ''} — ${RATING_LABELS[n]}`"
      >★</button>
    </div>
    <span class="rv-rating-label" :class="{ 'rv-rating-label--hint': shownLabel === null }" aria-live="polite">
      {{ shownLabel ?? "Pick a rating — click a star twice for 0" }}
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

// Clicking the star that's already selected drops the rating to 0.
function set(n: number) {
  emit("update:modelValue", props.modelValue === n ? 0 : n);
  hover.value = null;
}

// While hovering, preview the word for that rating; otherwise show the chosen one (null = not rated yet).
const shownLabel = computed(() => {
  const value = hover.value ?? props.modelValue;
  return value === null ? null : RATING_LABELS[value];
});
</script>
