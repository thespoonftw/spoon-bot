<template>
  <div class="page center">
    <h1 v-if="method === 'email'">Check your inbox 📧</h1>
    <h1 v-else>Check your DMs 💬</h1>

    <!-- Only the installed iPhone app is sent a code (see LoginView); everyone else gets a link. -->
    <template v-if="requestId">
      <p class="subtitle" v-if="method === 'email'">A 6-digit login code has been sent to <strong v-if="maskedEmail">{{ maskedEmail }}</strong><template v-else>your email address</template>.</p>
      <p class="subtitle" v-else>A 6-digit login code has been sent to you on Discord.</p>
      <form class="login-code" @submit.prevent="submitCode">
        <input v-model="code" class="login-search login-code-input" type="text" inputmode="numeric"
               autocomplete="one-time-code" maxlength="7" placeholder="123456" :disabled="checking || expired" />
        <button type="submit" class="btn-primary" :disabled="checking || expired || digits.length !== 6">
          {{ checking ? "Checking…" : "Log in" }}
        </button>
      </form>
      <div v-if="codeError" class="error">{{ codeError }}</div>
      <p class="empty" style="margin-bottom: 20px">The code expires in 15 minutes.</p>
    </template>
    <template v-else>
      <p class="subtitle" v-if="method === 'email'">A login link has been sent to <strong v-if="maskedEmail">{{ maskedEmail }}</strong><template v-else>your email address</template>.<br>Click it to log in.</p>
      <p class="subtitle" v-else>A login link has been sent to you on Discord.<br>Click it to log in.</p>
    </template>

    <router-link :to="`${base}/login`" class="back">← Try a different account</router-link>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { verifyLoginCode } from "../composables/useLogin";

const route = useRoute();
const router = useRouter();
const method = route.query.method as string | undefined;
const maskedEmail = route.query.maskedEmail as string | undefined;
const requestId = route.query.r as string | undefined;
const base = route.path.startsWith("/photos/") ? "/photos" : "";

const code = ref("");
const digits = computed(() => code.value.replace(/\D/g, ""));
const checking = ref(false);
const expired = ref(false);
const codeError = ref("");

async function submitCode() {
  if (!requestId || digits.value.length !== 6) return;
  checking.value = true;
  codeError.value = "";
  const result = await verifyLoginCode(requestId, digits.value).catch(() => "error" as const);
  checking.value = false;
  if (result === "ok") { router.replace(base || "/"); return; }
  if (result === "expired") {
    expired.value = true;
    codeError.value = "This code has expired or had too many wrong tries. Request a new one below.";
  } else {
    codeError.value = result === "wrong" ? "That code isn't right. Check the message and try again." : "Couldn't check the code. Try again.";
  }
}
</script>

<style scoped>
.login-code { display: flex; gap: 8px; width: 100%; max-width: 400px; margin-bottom: 12px; }
.login-code-input { flex: 1; margin-bottom: 0; font-size: 1.3rem; letter-spacing: 0.2em; text-align: center; }
</style>
