<template>
  <div class="page center">
    <h1>{{ inPhotos ? "brunchPhotos" : "Spoon Bot Photos" }}</h1>
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
          How should we send your {{ what }} to <strong>{{ confirming.firstName || confirming.displayName }}</strong>?
        </p>
        <p class="confirm-text" v-else>
          We'll send a {{ what }} to <strong>{{ confirming.firstName || confirming.displayName }}</strong> via {{ confirming.canDiscord ? "Discord" : "email" }}.
        </p>
        <div class="confirm-actions">
          <button class="btn-secondary" @click="confirming = null">Cancel</button>
          <button v-if="confirming.canDiscord" class="btn-primary" @click="requestLogin(confirming.userId, 'discord')" :disabled="loading">
            {{ loading ? "Sending…" : (confirming.canEmail ? "Via Discord" : sendLabel) }}
          </button>
          <button v-if="confirming.canEmail" class="btn-primary" @click="requestLogin(confirming.userId, 'email')" :disabled="loading">
            {{ loading ? "Sending…" : (confirming.canDiscord ? "Via Email" : sendLabel) }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useLoginSearch, requestLoginLink, type LoginUser } from "../composables/useLogin";
import { isIos, isStandalone } from "../utils/pwa";

const router = useRouter();
const route = useRoute();
const { query, results, searching } = useLoginSearch();
const loading = ref(false);
const error = ref("");
const confirming = ref<LoginUser | null>(null);

// Served at /login for the site and /photos/login for the brunchPhotos app, whose links land back in /photos.
const inPhotos = route.path.startsWith("/photos/");
const base = inPhotos ? "/photos" : "";
// The installed iPhone app gets a code to type in: a link would open Safari, which keeps its own
// cookies, and sign that in instead of the app. Everyone else gets the usual link.
const useCode = inPhotos && isIos() && isStandalone();
const what = useCode ? "login code" : "login link";
const sendLabel = useCode ? "Send Code" : "Send Link";

onMounted(() => {
  if (route.query.expired) error.value = "This login link has expired. Please request a new one.";
});

async function requestLogin(userId: string, method: "discord" | "email") {
  loading.value = true;
  error.value = "";
  const { ok, maskedEmail, requestId } = await requestLoginLink(userId, method, inPhotos ? "photos" : undefined, useCode);
  loading.value = false;
  if (ok) {
    router.push({ path: `${base}/login/sent`, query: { userId, method, maskedEmail, r: requestId } });
  } else {
    error.value = `Failed to send ${what}. Try again.`;
    confirming.value = null;
  }
}
</script>
