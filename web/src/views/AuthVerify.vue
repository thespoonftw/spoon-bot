<template>
  <div class="page center">
    <p v-if="status === 'loading'" class="subtitle">Logging you in…</p>
    <template v-else-if="status === 'ok'">
      <h1>Logged in! ✅</h1>
      <p class="subtitle">Redirecting…</p>
    </template>
    <template v-else>
      <h1>Link expired ❌</h1>
      <p class="subtitle">This magic link is invalid or has already been used.</p>
      <router-link :to="`${base}/login`" class="back">← Back to login</router-link>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { verifyLoginToken } from "../composables/useLogin";
import { takeReturnPath } from "../utils/afterLogin";

const route = useRoute();
const router = useRouter();
const status = ref<"loading" | "ok" | "error">("loading");
// Links from the Photo Archives login land at /archives/auth/verify and go on to the photos page.
const base = route.path.startsWith("/archives/") ? "/archives" : "";

// Links from Discord commands (e.g. /event) say which page to open next.
const nextParam = typeof route.query.next === "string" ? route.query.next : "";
const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "";

onMounted(async () => {
  if (await verifyLoginToken(route.params.token as string)) {
    status.value = "ok";
    if (next) { router.replace(next); return; }
    setTimeout(() => router.push(takeReturnPath(base)), 1000);
    return;
  }
  // A command link opened a second time: already signed in from the first, so just carry on.
  if (next) {
    const signedIn = await fetch("/api/auth/check").then(r => r.ok).catch(() => false);
    if (signedIn) { router.replace(next); return; }
  }
  status.value = "error";
});
</script>
