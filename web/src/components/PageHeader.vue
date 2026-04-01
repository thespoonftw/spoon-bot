<template>
  <div class="page-header">
    <router-link :to="backTo" class="page-back">←</router-link>
    <div class="page-header-title">
      <div class="page-header-title-row">
        <h1>{{ title }}</h1>
        <button v-if="editable" class="btn-icon page-header-edit-btn" @click="$emit('edit')" title="Edit">✏️</button>
      </div>
      <span v-if="subtitle" class="page-header-subtitle">{{ subtitle }}</span>
    </div>
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{ backTo: string; title: string; subtitle?: string; editable?: boolean }>();
defineEmits<{ edit: [] }>();
</script>
