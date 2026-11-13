<template>
  <div class="page-header">
    <router-link :to="backTo" class="page-back">‹</router-link>
    <div class="page-header-title">
      <div class="page-header-title-row">
        <h1 :class="titleSize">{{ title }}</h1>
      </div>
      <span v-if="subtitle" class="page-header-subtitle">{{ subtitle }}</span>
      <div v-if="groupTag" :class="['page-header-location', { 'page-header-location--tag-only': !locations?.length }]" style="gap:6px">
        <span class="user-group-tag page-header-group-tag" :style="{ background: groupTag.color }">{{ groupTag.name }}</span>
        <span v-if="locations?.length">📍 <template v-for="(loc, i) in locations" :key="loc.id">{{ i ? ", " : "" }}<span :class="{ 'page-header-location-link': locations.length > 1 }" @click="locations.length > 1 && $emit('location-click', loc.id)">{{ loc.name }}</span></template></span>
      </div>
      <div v-else-if="locations?.length" class="page-header-location">
        <span>📍 <template v-for="(loc, i) in locations" :key="loc.id">{{ i ? ", " : "" }}<span :class="{ 'page-header-location-link': locations.length > 1 }" @click="locations.length > 1 && $emit('location-click', loc.id)">{{ loc.name }}</span></template></span>
      </div>
    </div>
    <div :class="['page-header-actions', { 'page-header-actions--stack': mobileStack }]">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{ backTo: string; title: string; subtitle?: string; locations?: { id: number; name: string }[]; mobileStack?: boolean; groupTag?: { name: string; color: string } | null }>();
// With several locations, clicking one sorts the album photos by location, starting there.
defineEmits<{ 'location-click': [id: number] }>();
// Longer titles get a smaller font on phones (see .page-title--long / --xlong), so they fit in a line or two.
const titleSize = computed(() => props.title.length > 32 ? "page-title--xlong" : props.title.length > 18 ? "page-title--long" : "");
</script>
