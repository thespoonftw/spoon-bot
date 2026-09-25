<template>
  <div class="rv-cover" :class="{ 'rv-cover--large': large }">
    <img v-if="imageUrl && !failed" :src="imageUrl" :alt="title" loading="lazy" referrerpolicy="no-referrer" @error="failed = true" />
    <span v-else aria-hidden="true">{{ icon }}</span>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";

// `icon` is the review type's emoji, shown when there's no cover image.
const props = defineProps<{ imageUrl: string | null; icon: string; title: string; large?: boolean }>();
const failed = ref(false);
watch(() => props.imageUrl, () => { failed.value = false; });
</script>
