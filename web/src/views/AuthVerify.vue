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
      <router-link to="/login" class="back">← Back to login</router-link>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";

const route = useRoute();
const router = useRouter();
const status = ref<"loading" | "ok" | "error">("loading");

onMounted(async () => {
  const token = route.params.token as string;
  const res = await fetch(`/api/auth/verify/${token}`);
  if (res.ok) {
    status.value = "ok";
    setTimeout(() => router.push("/"), 1000);
  } else {
    status.value = "error";
  }
});
</script>
