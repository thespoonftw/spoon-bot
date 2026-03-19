<template>
  <div class="page center">
    <h1>Snek</h1>
    <p class="subtitle">Select your account to log in</p>
    <div v-if="error" class="error">{{ error }}</div>

    <template v-if="!confirming">
      <template v-if="regulars.length">
        <p class="user-category">Regulars</p>
        <button v-for="user in regulars" :key="user.userId" class="user-card" @click="confirming = user">
          <img v-if="user.avatarUrl" :src="user.avatarUrl" class="avatar" />
          <div class="avatar placeholder" v-else>{{ user.displayName[0] }}</div>
          <span>{{ user.displayName }}</span>
        </button>
      </template>
      <template v-if="newcomers.length">
        <p class="user-category">Newcomers</p>
        <button v-for="user in newcomers" :key="user.userId" class="user-card" @click="confirming = user">
          <img v-if="user.avatarUrl" :src="user.avatarUrl" class="avatar" />
          <div class="avatar placeholder" v-else>{{ user.displayName[0] }}</div>
          <span>{{ user.displayName }}</span>
        </button>
      </template>
    </template>

    <template v-else>
      <div class="confirm-card">
        <img v-if="confirming.avatarUrl" :src="confirming.avatarUrl" class="avatar large" />
        <div class="avatar placeholder large" v-else>{{ confirming.displayName[0] }}</div>
        <p class="confirm-text">We'll send a login link to <strong>{{ confirming.displayName }}</strong> via Discord.</p>
        <div class="confirm-actions">
          <button class="btn-secondary" @click="confirming = null">Cancel</button>
          <button class="btn-primary" @click="requestLogin(confirming.userId)" :disabled="loading">
            {{ loading ? "Sending…" : "Send Link" }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";

interface UserInfo { userId: string; displayName: string; avatarUrl: string; lastLoginAt?: string }

const router = useRouter();
const users = ref<UserInfo[]>([]);
const loading = ref(false);
const error = ref("");
const confirming = ref<UserInfo | null>(null);

const regulars = computed(() =>
  users.value.filter(u => u.lastLoginAt).sort((a, b) => b.lastLoginAt!.localeCompare(a.lastLoginAt!))
);
const newcomers = computed(() =>
  users.value.filter(u => !u.lastLoginAt).sort((a, b) => a.displayName.localeCompare(b.displayName))
);

onMounted(async () => {
  users.value = await fetch("/api/users").then(r => r.json());
});

async function requestLogin(userId: string) {
  loading.value = true;
  error.value = "";
  const res = await fetch("/api/auth/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  loading.value = false;
  if (res.ok) {
    router.push({ path: "/login/sent", query: { userId } });
  } else {
    error.value = "Failed to send login link. Try again.";
    confirming.value = null;
  }
}
</script>
