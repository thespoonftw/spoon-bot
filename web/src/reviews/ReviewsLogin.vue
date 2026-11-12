<template>
  <div class="rv-login">
    <h2>Sign in</h2>
    <p class="rv-login-sub">Find your name and we'll send you a {{ what }}.</p>
    <p v-if="error" class="rv-error">{{ error }}</p>

    <template v-if="!confirming">
      <input v-model="query" class="rv-input" type="text" placeholder="Search by name…" autocomplete="off" autofocus />
      <div v-if="results.length" class="rv-login-list">
        <button v-for="u in results" :key="u.userId" type="button" class="rv-login-user" @click="confirming = u">
          <img v-if="u.avatarUrl" :src="u.avatarUrl" class="rv-avatar rv-avatar--large" alt="" />
          <span v-else class="rv-avatar rv-avatar--large">{{ nameOf(u)[0] }}</span>
          <span class="rv-login-user-text">
            <strong>{{ nameOf(u) }}</strong>
            <span v-if="u.firstName">{{ u.displayName }}</span>
          </span>
        </button>
      </div>
      <p v-else-if="query.trim() && !searching" class="rv-hint" style="margin-top: 12px">
        {{ query.trim().length < 3 ? "Keep typing, or enter the full name…" : "No matches found." }}
      </p>
    </template>

    <div v-else class="rv-login-confirm">
      <img v-if="confirming.avatarUrl" :src="confirming.avatarUrl" class="rv-avatar rv-avatar--xl" alt="" />
      <span v-else class="rv-avatar rv-avatar--xl">{{ nameOf(confirming)[0] }}</span>
      <p v-if="confirming.canDiscord && confirming.canEmail">
        How should we send the {{ what }} to <strong>{{ nameOf(confirming) }}</strong>?
      </p>
      <p v-else>
        We'll send a {{ what }} to <strong>{{ nameOf(confirming) }}</strong> via {{ confirming.canDiscord ? "Discord" : "email" }}.
      </p>
      <div class="rv-actions" style="justify-content: center">
        <button type="button" class="rv-btn rv-btn--ghost" @click="confirming = null">Cancel</button>
        <button v-if="confirming.canDiscord" type="button" class="rv-btn" :disabled="loading" @click="send(confirming, 'discord')">
          {{ loading ? "Sending…" : confirming.canEmail ? "Via Discord" : sendLabel }}
        </button>
        <button v-if="confirming.canEmail" type="button" class="rv-btn" :disabled="loading" @click="send(confirming, 'email')">
          {{ loading ? "Sending…" : confirming.canDiscord ? "Via email" : sendLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useLoginSearch, requestLoginLink, type LoginUser } from "../composables/useLogin";
import { isIos, isStandalone } from "../utils/reviewsApp";

const router = useRouter();
const { query, results, searching } = useLoginSearch();
const confirming = ref<LoginUser | null>(null);
const loading = ref(false);
const error = ref("");
const nameOf = (u: LoginUser) => u.firstName || u.displayName;

// The installed iPhone app gets a code to type in: a link would open Safari, which keeps its own
// cookies, and sign that in instead of the app. Everyone else gets the usual link.
const useCode = isIos() && isStandalone();
const what = useCode ? "login code" : "login link";
const sendLabel = useCode ? "Send code" : "Send link";

async function send(u: LoginUser, method: "discord" | "email") {
  loading.value = true;
  error.value = "";
  const { ok, maskedEmail, requestId } = await requestLoginLink(u.userId, method, "reviews", useCode);
  loading.value = false;
  if (ok) {
    router.push({ path: "/reviews/login/sent", query: { method, maskedEmail, r: requestId } });
  } else {
    error.value = `Couldn't send the ${what} — try again.`;
    confirming.value = null;
  }
}
</script>
