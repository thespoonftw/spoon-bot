<template>
  <div class="page-header">
    <router-link :to="backTo" class="page-back">‹</router-link>
    <div class="page-header-title">
      <div class="page-header-title-row">
        <h1>{{ title }}</h1>
        <button v-if="editable" class="btn-icon page-header-edit-btn" @click="$emit('edit')" title="Edit">✏️</button>
      </div>
      <span v-if="subtitle" class="page-header-subtitle">{{ subtitle }}</span>
      <div v-if="groupTag" class="page-header-location" style="gap:6px">
        <span class="user-group-tag" :style="{ background: groupTag.color }">{{ groupTag.name }}</span>
        <template v-if="locationLine">📍 {{ locationLine }}
          <button class="btn-icon page-header-edit-btn" @click="$emit('location-edit')" title="Edit location">✏️</button>
        </template>
        <template v-else-if="locationEditable && !locationCount">
          <button class="btn-icon page-header-edit-btn" @click="$emit('location-edit')" title="Add location">📍 ✏️</button>
        </template>
      </div>
      <div v-else-if="locationLine" class="page-header-location">
        📍 {{ locationLine }}
        <button class="btn-icon page-header-edit-btn" @click="$emit('location-edit')" title="Edit location">✏️</button>
      </div>
      <div v-else-if="locationCount" class="page-header-location page-header-location--mobile">
        📍 {{ locationCount }} Locations
        <button class="btn-icon page-header-edit-btn" @click="$emit('location-edit')" title="Edit locations">✏️</button>
      </div>
      <div v-else-if="locationEditable" class="page-header-location">
        <button class="btn-icon page-header-edit-btn" @click="$emit('location-edit')" title="Add location">📍 ✏️</button>
      </div>
    </div>
    <div :class="['page-header-actions', { 'page-header-actions--stack': mobileStack }]">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ backTo: string; title: string; subtitle?: string; editable?: boolean; locationLine?: string; locationCount?: number; locationEditable?: boolean; mobileStack?: boolean; groupTag?: { name: string; color: string } | null }>();
defineEmits<{ edit: []; 'location-edit': [] }>();
</script>
