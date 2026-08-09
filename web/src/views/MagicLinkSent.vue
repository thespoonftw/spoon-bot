<template>
  <div class="page center">
    <h1 v-if="method === 'email'">Check your inbox 📧</h1>
    <h1 v-else>Check your DMs 💬</h1>
    <p class="subtitle" v-if="method === 'email'">A login link has been sent to your email address.<br>Click it to log in.</p>
    <p class="subtitle" v-else>A login link has been sent to you on Discord.<br>Click it to log in.</p>
    <router-link to="/login" class="back">← Try a different account</router-link>
  </div>
</template>

<script setup lang="ts">
import { useRoute } from "vue-router";

const route = useRoute();
const method = route.query.method as string | undefined;
</script>
