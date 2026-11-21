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
        <h2>Photo Archives</h2>
      </router-link>
      <!-- The apps' cards are dressed like the apps themselves: their colours and title lettering. -->
      <router-link to="/reviews" class="feature-card feature-card--reviews">
        <img class="feature-icon feature-icon--app" src="/reviews-app/icon-192.png" alt="" />
        <h2>Brunch Reviews</h2>
      </router-link>
      <a href="/snexercise/" class="feature-card feature-card--snexercise">
        <img class="feature-icon feature-icon--app" :src="'/snexercise/icons/icon-192.png'" alt="" />
        <h2>Sn<span>exercise</span></h2>
      </a>
      <a v-if="canChewsday" href="/chewsday" class="feature-card feature-card--chewsday">
        <img class="feature-icon feature-icon--app" :src="'/chewsday/app/icon-192.png'" alt="" />
        <h2>Chewsday</h2>
      </a>
      <div v-else class="feature-card feature-card--chewsday feature-card--disabled" aria-disabled="true">
        <img class="feature-icon feature-icon--app" :src="'/chewsday/app/icon-192.png'" alt="" />
        <h2>Chewsday</h2>
        <p>Gumsbolt &amp; Spoon only</p>
      </div>
      <router-link to="/snek" class="feature-card">
        <svg class="feature-icon feature-icon--discord" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.1 14.1 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
        <h2>Discord</h2>
      </router-link>
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
