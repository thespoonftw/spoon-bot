<template>
  <div class="page-header">
    <router-link :to="backTo" class="page-back">←</router-link>
    <h1>{{ title }}</h1>
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{ backTo: string; title: string }>();
</script>
