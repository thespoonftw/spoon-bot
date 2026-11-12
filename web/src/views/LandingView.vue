<template>
  <div class="page">
    <div class="landing-header">
      <h1>Directory</h1>
      <UserBadge class="landing-user-info" />
    </div>

    <div class="landing-grid">
      <router-link to="/photos" class="feature-card">
        <span class="feature-icon">📷</span>
        <h2>Photos</h2>
      </router-link>
      <router-link to="/reviews" class="feature-card">
        <span class="feature-icon">⭐</span>
        <h2>Reviews</h2>
      </router-link>
      <router-link to="/snek" class="feature-card">
        <span class="feature-icon">💬</span>
        <h2>Discord</h2>
      </router-link>
      <div class="feature-card feature-card--disabled" aria-disabled="true">
        <span class="feature-icon">🏋️</span>
        <h2>Snexercise</h2>
        <p>Under construction</p>
      </div>
      <a v-if="canChewsday" href="/chewsday" class="feature-card">
        <span class="feature-icon">🍽️</span>
        <h2>Chewsday</h2>
      </a>
      <div v-else class="feature-card feature-card--disabled" aria-disabled="true">
        <span class="feature-icon">🍽️</span>
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
