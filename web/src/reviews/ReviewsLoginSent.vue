<template>
  <div class="rv-login">
    <h2>{{ method === "email" ? "Check your inbox" : "Check your DMs" }}</h2>
    <p class="rv-login-sub" v-if="method === 'email'">
      We've emailed a login link to <strong v-if="maskedEmail">{{ maskedEmail }}</strong><template v-else>your email address</template>.
    </p>
    <p class="rv-login-sub" v-else>We've sent you a login link on Discord.</p>
    <p class="rv-hint">The link expires in 15 minutes.</p>
    <p style="margin-top: 24px"><router-link to="/reviews/login" class="rv-btn rv-btn--ghost">← Use a different account</router-link></p>
  </div>
</template>

<script setup lang="ts">
import { useRoute } from "vue-router";

const route = useRoute();
const method = route.query.method as string | undefined;
const maskedEmail = route.query.maskedEmail as string | undefined;
</script>
