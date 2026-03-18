<template>
  <div class="page">
    <div class="header-row">
      <h1>📸 Snek Photo Albums</h1>
      <div class="user-info" v-if="currentUser">
        <img v-if="currentUser.avatarUrl" :src="currentUser.avatarUrl" class="avatar" />
        <div class="avatar placeholder" v-else>{{ currentUser.displayName[0] }}</div>
        <span class="user-name">{{ currentUser.displayName }}</span>
        <button class="logout" @click="logout">Log out</button>
      </div>
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
interface UserInfo { displayName: string; avatarUrl: string }

const albums = ref<Album[]>([]);
const currentUser = ref<UserInfo | null>(null);
const router = useRouter();

onMounted(async () => {
  const session = localStorage.getItem("snek_session");
  const [albumsRes, userRes] = await Promise.all([
    fetch("/api/albums"),
    fetch("/api/auth/check", { headers: { Authorization: `Bearer ${session}` } }),
  ]);
  albums.value = await albumsRes.json();
  if (userRes.ok) {
    const data = await userRes.json();
    if (data.valid) currentUser.value = { displayName: data.displayName, avatarUrl: data.avatarUrl };
  }
});

async function logout() {
  const session = localStorage.getItem("snek_session");
  await fetch("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${session}` } });
  localStorage.removeItem("snek_session");
  router.push("/login");
}
</script>
