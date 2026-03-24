<template>
  <img v-if="avatarUrl" :src="avatarUrl" class="member-avatar" />
  <span v-else class="member-avatar member-avatar-placeholder">{{ name[0] }}</span>
</template>

<script setup lang="ts">
defineProps<{ avatarUrl?: string; name: string }>();
</script>
