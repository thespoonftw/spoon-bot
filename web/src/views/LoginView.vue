<template>
  <div class="page center">
    <h1>Spoon Bot Photos</h1>
    <p class="subtitle">Search your name to log in</p>
    <div v-if="error" class="error">{{ error }}</div>

    <template v-if="!confirming">
      <input v-model="query" class="login-search" type="text" placeholder="Search by name…" autocomplete="off" autofocus />
      <div class="login-grid" v-if="results.length">
        <button v-for="user in results" :key="user.userId" class="user-card" @click="confirming = user">
          <img v-if="user.avatarUrl" :src="user.avatarUrl" class="avatar" />
          <div class="avatar placeholder" v-else>{{ (user.firstName || user.displayName)[0] }}</div>
          <div class="user-card-info">
            <span class="user-card-name">{{ user.firstName || user.displayName }}</span>
            <span class="user-card-subname">{{ user.displayName }}</span>
          </div>
        </button>
      </div>
      <p v-else-if="query.trim().length > 0 && !searching" class="empty">
        {{ query.trim().length < 3 ? "Keep typing, or enter the full name…" : "No matches found." }}
      </p>
    </template>

    <template v-else>
      <div class="confirm-card">
        <img v-if="confirming.avatarUrl" :src="confirming.avatarUrl" class="avatar large" />
        <div class="avatar placeholder large" v-else>{{ (confirming.firstName || confirming.displayName)[0] }}</div>
        <p class="confirm-text" v-if="confirming.canDiscord && confirming.canEmail">
          How should we send your login link to <strong>{{ confirming.firstName || confirming.displayName }}</strong>?
        </p>
        <p class="confirm-text" v-else>
          We'll send a login link to <strong>{{ confirming.firstName || confirming.displayName }}</strong> via {{ confirming.canDiscord ? "Discord" : "email" }}.
        </p>
        <div class="confirm-actions">
          <button class="btn-secondary" @click="confirming = null">Cancel</button>
          <button v-if="confirming.canDiscord" class="btn-primary" @click="requestLogin(confirming.userId, 'discord')" :disabled="loading">
            {{ loading ? "Sending…" : (confirming.canEmail ? "Via Discord" : "Send Link") }}
          </button>
          <button v-if="confirming.canEmail" class="btn-primary" @click="requestLogin(confirming.userId, 'email')" :disabled="loading">
            {{ loading ? "Sending…" : (confirming.canDiscord ? "Via Email" : "Send Link") }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { useRouter, useRoute } from "vue-router";

interface UserInfo { userId: string; displayName: string; firstName?: string; avatarUrl: string; canDiscord: boolean; canEmail: boolean }

const router = useRouter();
const route = useRoute();
const query = ref("");
const results = ref<UserInfo[]>([]);
const searching = ref(false);
const loading = ref(false);
const error = ref("");
const confirming = ref<UserInfo | null>(null);

let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(query, (q) => {
  if (searchTimer) clearTimeout(searchTimer);
  const trimmed = q.trim();
  if (!trimmed) { results.value = []; searching.value = false; return; }
  searching.value = true;
  searchTimer = setTimeout(async () => {
    try {
      results.value = await fetch(`/api/users/search?q=${encodeURIComponent(trimmed)}`).then(r => r.json());
    } finally {
      searching.value = false;
    }
  }, 250);
});

onMounted(() => {
  if (route.query.expired) error.value = "This login link has expired. Please request a new one.";
});

async function requestLogin(userId: string, method: "discord" | "email") {
  loading.value = true;
  error.value = "";
  const res = await fetch("/api/auth/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, method }),
  });
  loading.value = false;
  if (res.ok) {
    router.push({ path: "/login/sent", query: { userId, method } });
  } else {
    error.value = "Failed to send login link. Try again.";
    confirming.value = null;
  }
}
</script>
