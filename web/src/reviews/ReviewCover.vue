<template>
  <div class="rv-cover" :class="{ 'rv-cover--large': large }">
    <img v-if="imageUrl && !failed" :src="imageUrl" :alt="title" loading="lazy" referrerpolicy="no-referrer" @error="failed = true" />
    <span v-else aria-hidden="true">{{ mediaIcon(mediaType) }}</span>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { mediaIcon, type MediaType } from "./api";

const props = defineProps<{ imageUrl: string | null; mediaType: MediaType; title: string; large?: boolean }>();
const failed = ref(false);
watch(() => props.imageUrl, () => { failed.value = false; });
</script>
