<template>
  <div class="page">
    <h1>📸 Snek Photo Albums</h1>
    <p v-if="albums.length === 0" class="empty">No albums yet.</p>
    <router-link v-for="album in albums" :key="album.channelId" :to="`/album/${album.channelId}`" class="card">
      <h2>{{ album.groupName }}</h2>
      <p v-if="album.dateText" class="date">{{ album.dateText }}</p>
      <p class="meta">{{ album.imageUrls.length }} photo(s)</p>
    </router-link>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";

interface Album { channelId: string; groupName: string; dateText?: string; imageUrls: string[] }

const albums = ref<Album[]>([]);
onMounted(async () => {
  albums.value = await fetch("/api/albums").then(r => r.json());
});
</script>
