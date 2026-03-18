<template>
  <div class="page">
    <h1>📸 Snek Photo Albums</h1>
    <p class="subtitle">Select your account to log in</p>
    <div v-if="error" class="error">{{ error }}</div>
    <button
      v-for="user in users"
      :key="user.userId"
      class="user-card"
      :disabled="loading === user.userId"
      @click="requestLogin(user.userId)"
    >
      <img v-if="user.avatarUrl" :src="user.avatarUrl" class="avatar" />
      <div class="avatar placeholder" v-else>{{ user.displayName[0] }}</div>
      <span>{{ user.displayName }}</span>
      <span v-if="loading === user.userId" class="hint">Sending DM…</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";

interface UserInfo { userId: string; displayName: string; avatarUrl: string }

const router = useRouter();
const users = ref<UserInfo[]>([]);
const loading = ref<string | null>(null);
const error = ref("");

onMounted(async () => {
  users.value = await fetch("/api/users").then(r => r.json());
});

async function requestLogin(userId: string) {
  loading.value = userId;
  error.value = "";
  const res = await fetch("/api/auth/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  if (res.ok) {
    router.push({ path: "/login/sent", query: { userId } });
  } else {
    error.value = "Failed to send login link. Try again.";
    loading.value = null;
  }
}
</script>
