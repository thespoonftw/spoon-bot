<template>
  <div class="page">
    <div class="header-row">
      <h1>📸 Snek Photo Albums</h1>
      <button class="logout" @click="logout">Log out</button>
    </div>
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
import { useRouter } from "vue-router";

interface Album { channelId: string; groupName: string; dateText?: string; imageUrls: string[] }

const albums = ref<Album[]>([]);
const router = useRouter();

onMounted(async () => {
  albums.value = await fetch("/api/albums").then(r => r.json());
});

async function logout() {
  const session = localStorage.getItem("snek_session");
  await fetch("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${session}` } });
  localStorage.removeItem("snek_session");
  router.push("/login");
}
</script>
