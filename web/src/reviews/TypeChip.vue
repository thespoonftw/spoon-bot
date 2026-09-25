<template>
  <span class="rv-type" :style="{ background: color }"><span v-if="withIcon" aria-hidden="true">{{ icon }}</span>{{ name }}</span>
</template>

<script setup lang="ts">
defineProps<{ name: string; icon: string; color: string; withIcon?: boolean }>();
</script>
