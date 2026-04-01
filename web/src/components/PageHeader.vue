<template>
  <div class="page-header">
    <router-link :to="backTo" class="page-back">←</router-link>
    <div class="page-header-title">
      <h1>{{ title }}</h1>
      <span v-if="subtitle" class="page-header-subtitle">{{ subtitle }}</span>
    </div>
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{ backTo: string; title: string; subtitle?: string }>();
</script>
