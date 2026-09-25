<template>
  <div v-if="editable" class="rv-stars rv-stars--input" role="radiogroup" aria-label="Rating">
    <button type="button" class="rv-stars-zero" :class="{ on: modelValue === 0 }" @click="set(0)" role="radio" :aria-checked="modelValue === 0">0 stars</button>
    <button
      v-for="n in 5" :key="n" type="button"
      :class="{ on: n <= (hover ?? modelValue ?? 0) }"
      @mouseenter="hover = n" @mouseleave="hover = null" @click="set(n)"
      role="radio" :aria-checked="modelValue === n" :aria-label="`${n} star${n > 1 ? 's' : ''}`"
    >★</button>
  </div>
  <span v-else class="rv-stars" :aria-label="`${modelValue} out of 5 stars`">
    <span v-for="n in 5" :key="n" :class="{ off: n > (modelValue ?? 0) }">★</span>
  </span>
</template>

<script setup lang="ts">
import { ref } from "vue";

defineProps<{ modelValue: number | null; editable?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: number] }>();
const hover = ref<number | null>(null);
const set = (n: number) => emit("update:modelValue", n);
</script>
