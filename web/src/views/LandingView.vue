<template>
  <div class="page landing-page">
    <div class="landing-header">
      <h1>Brunch Projects</h1>
      <UserBadge class="landing-user-info" />
    </div>

    <!-- Snexercise and Chewsday are separate apps on the same site, so their icons are bound (:src) to keep Vite from looking for them in this build. -->
    <div class="landing-grid">
      <router-link to="/archives" class="feature-card">
        <img class="feature-icon feature-icon--app" src="/photos-app/icon-192.png" alt="" />
        <h2>Archives</h2>
      </router-link>
      <router-link to="/reviews" class="feature-card">
        <img class="feature-icon feature-icon--app" src="/reviews-app/icon-192.png" alt="" />
        <h2>Reviews</h2>
      </router-link>
      <router-link to="/snek" class="feature-card">
        <span class="feature-icon">💬</span>
        <h2>Discord</h2>
      </router-link>
      <a href="/snexercise/" class="feature-card">
        <img class="feature-icon feature-icon--app" :src="'/snexercise/icons/icon-192.png'" alt="" />
        <h2>Snexercise</h2>
      </a>
      <a v-if="canChewsday" href="/chewsday" class="feature-card">
        <img class="feature-icon feature-icon--app" :src="'/chewsday/app/icon-192.png'" alt="" />
        <h2>Chewsday</h2>
      </a>
      <div v-else class="feature-card feature-card--disabled" aria-disabled="true">
        <img class="feature-icon feature-icon--app" :src="'/chewsday/app/icon-192.png'" alt="" />
        <h2>Chewsday</h2>
        <p>Gumsbolt &amp; Spoon only</p>
      </div>
      <router-link v-if="isAdmin" to="/admin" class="feature-card">
        <span class="feature-icon">🛠️</span>
        <h2>Admin</h2>
      </router-link>
      <div v-else class="feature-card feature-card--disabled" aria-disabled="true">
        <span class="feature-icon">🛠️</span>
        <h2>Admin</h2>
        <p>Admins only</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import UserBadge from "../components/UserBadge.vue";
import { useCurrentUser } from "../composables/useCurrentUser";
const { currentUser } = useCurrentUser();

const CHEWSDAY_USERS = ["gumsbolt", "spoon"];
const canChewsday = computed(() => {
  const u = currentUser.value;
  if (!u) return false;
  return [u.displayName, u.firstName].some(n => n && CHEWSDAY_USERS.includes(n.trim().toLowerCase()));
});
const isAdmin = computed(() => (currentUser.value?.level ?? 0) >= 2);
</script>
