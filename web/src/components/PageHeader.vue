<template>
  <div class="page-header">
    <router-link :to="backTo" class="page-back">‹</router-link>
    <div class="page-header-title">
      <div class="page-header-title-row">
        <h1>{{ title }}</h1>
      </div>
      <span v-if="subtitle" class="page-header-subtitle">{{ subtitle }}</span>
      <div v-if="groupTag" class="page-header-location" style="gap:6px">
        <span class="user-group-tag" :style="{ background: groupTag.color }">{{ groupTag.name }}</span>
        <template v-if="locationLine">📍 {{ locationLine }}</template>
      </div>
      <div v-else-if="locationLine" class="page-header-location">📍 {{ locationLine }}</div>
      <div v-else-if="locationCount" class="page-header-location page-header-location--mobile">📍 {{ locationCount }} Locations</div>
    </div>
    <div :class="['page-header-actions', { 'page-header-actions--stack': mobileStack }]">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ backTo: string; title: string; subtitle?: string; locationLine?: string; locationCount?: number; mobileStack?: boolean; groupTag?: { name: string; color: string } | null }>();
</script>
