<template>
  <div class="page-header">
    <router-link :to="backTo" class="page-back">‹</router-link>
    <div class="page-header-title">
      <div class="page-header-title-row">
        <h1>{{ title }}</h1>
        <button v-if="editable" class="btn-icon page-header-edit-btn" @click="$emit('edit')" title="Edit">✏️</button>
      </div>
      <span v-if="subtitle" class="page-header-subtitle">{{ subtitle }}</span>
      <div v-if="locationLine" class="page-header-location">
        📍 {{ locationLine }}
        <button class="btn-icon page-header-edit-btn" @click="$emit('location-edit')" title="Edit location">✏️</button>
      </div>
      <div v-else-if="locationCount" class="page-header-location page-header-location--mobile">
        📍 {{ locationCount }} Locations
        <button class="btn-icon page-header-edit-btn" @click="$emit('location-edit')" title="Edit locations">✏️</button>
      </div>
    </div>
    <div :class="['page-header-actions', { 'page-header-actions--stack': mobileStack }]">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ backTo: string; title: string; subtitle?: string; editable?: boolean; locationLine?: string; locationCount?: number; mobileStack?: boolean }>();
defineEmits<{ edit: []; 'location-edit': [] }>();
</script>
