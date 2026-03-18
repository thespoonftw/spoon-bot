<template>
  <div class="page">
    <router-link to="/" class="back">← All Albums</router-link>
    <template v-if="album">
      <h1>{{ album.groupName }}</h1>
      <p v-if="album.dateText" class="date">{{ album.dateText }}</p>
      <p v-if="album.imageUrls.length === 0" class="empty">No photos yet.</p>
      <div class="gallery">
        <a v-for="url in album.imageUrls" :key="url" :href="url" target="_blank">
          <img :src="url" @error="($event.target as HTMLElement).parentElement!.style.display='none'" />
        </a>
      </div>
    </template>
    <p v-else class="empty">Album not found.</p>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute } from "vue-router";

interface Album { channelId: string; groupName: string; dateText?: string; imageUrls: string[] }

const route = useRoute();
const album = ref<Album | null>(null);
onMounted(async () => {
  const res = await fetch(`/api/album/${route.params.channelId}`);
  if (res.ok) album.value = await res.json();
});
</script>
