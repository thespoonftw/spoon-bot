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

const route = useRoute();
const router = useRouter();
const status = ref<"loading" | "ok" | "error">("loading");
// Links from the brunchPhotos login land at /photos/auth/verify and go on to the photos page.
const base = route.path.startsWith("/photos/") ? "/photos" : "";

onMounted(async () => {
  if (await verifyLoginToken(route.params.token as string)) {
    status.value = "ok";
    setTimeout(() => router.push(base || "/"), 1000);
  } else {
    status.value = "error";
  }
});
</script>
