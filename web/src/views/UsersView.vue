<template>
  <div class="page">
    <div class="header-row">
      <div class="header-left">
        <router-link to="/" class="back">← Home</router-link>
        <h1>Users</h1>
      </div>
      <div class="user-info" v-if="currentUser">
        <img v-if="currentUser.avatarUrl" :src="currentUser.avatarUrl" class="avatar" />
        <div class="avatar placeholder" v-else>{{ currentUser.displayName[0] }}</div>
        <span class="user-name">{{ currentUser.displayName }}</span>
        <button class="logout" @click="logout">Log out</button>
      </div>
    </div>

    <div class="user-list">
      <div v-for="user in users" :key="user.userId" class="user-row">
        <img v-if="user.avatarUrl" :src="user.avatarUrl" class="avatar" />
        <div class="avatar placeholder" v-else>{{ user.displayName[0] }}</div>
        <div class="user-row-info">
          <span class="user-row-name">{{ user.displayName }}</span>
          <span class="user-row-login" v-if="user.lastLoginAt">Last login: {{ formatDate(user.lastLoginAt) }}</span>
          <span class="user-row-login never" v-else>Never logged in</span>
        </div>
      </div>
      <p v-if="users.length === 0" class="empty">No users yet.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useCurrentUser } from "../composables/useCurrentUser";

interface SiteUser { userId: string; displayName: string; avatarUrl?: string; lastLoginAt?: string }

const users = ref<SiteUser[]>([]);
const { currentUser, logout } = useCurrentUser();

onMounted(async () => {
  const session = localStorage.getItem("snek_session");
  const res = await fetch("/api/site-users", { headers: { Authorization: `Bearer ${session}` } });
  if (res.ok) {
    const data: SiteUser[] = await res.json();
    users.value = data.sort((a, b) => {
      if (a.lastLoginAt && b.lastLoginAt) return b.lastLoginAt.localeCompare(a.lastLoginAt);
      if (a.lastLoginAt) return -1;
      if (b.lastLoginAt) return 1;
      return a.displayName.localeCompare(b.displayName);
    });
  }
});

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
</script>
