<template>
  <div class="rv-login">
    <p v-if="status === 'loading'" class="rv-loading">Signing you in…</p>
    <template v-else-if="status === 'ok'">
      <h2>You're in</h2>
      <p class="rv-login-sub">Taking you to the reviews…</p>
    </template>
    <template v-else>
      <h2>Link expired</h2>
      <p class="rv-login-sub">This login link is invalid or has already been used.</p>
      <p style="margin-top: 24px"><router-link to="/reviews/login" class="rv-btn">Get a new link</router-link></p>
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

onMounted(async () => {
  if (await verifyLoginToken(route.params.token as string)) {
    status.value = "ok";
    setTimeout(() => router.replace("/reviews"), 800);
  } else {
    status.value = "error";
  }
});
</script>
