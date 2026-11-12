<template>
  <div class="page">
    <div class="landing-header">
      <h1>Directory</h1>
      <div class="user-info landing-user-info" v-if="currentUser">
        <img v-if="currentUser.avatarUrl" :src="currentUser.avatarUrl" class="avatar" />
        <div class="avatar placeholder" v-else>{{ (currentUser.firstName || currentUser.displayName)[0] }}</div>
        <span class="user-name">{{ currentUser.firstName || currentUser.displayName }}</span>
        <button class="logout" @click="logout">Log out</button>
      </div>
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
      <router-link to="/apps" class="feature-card">
        <span class="feature-icon">📱</span>
        <h2>Apps</h2>
      </router-link>
      <div class="landing-admin-cell">
        <button v-if="isAdmin" type="button" class="feature-card landing-card-button" :aria-expanded="adminOpen" @click="adminOpen = !adminOpen">
          <span class="feature-icon">🛠️</span>
          <h2>Admin</h2>
        </button>
        <div v-else class="feature-card feature-card--disabled" aria-disabled="true">
          <span class="feature-icon">🛠️</span>
          <h2>Admin</h2>
          <p>Admins only</p>
        </div>
        <div v-if="adminOpen" class="landing-submenu" role="menu">
          <router-link to="/status" class="landing-submenu-item" role="menuitem">📊 Stats</router-link>
          <router-link to="/database" class="landing-submenu-item" role="menuitem">🗄️ Database</router-link>
          <router-link to="/users" class="landing-submenu-item" role="menuitem">👥 Users</router-link>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from "vue";
import { useCurrentUser } from "../composables/useCurrentUser";
const { currentUser, logout } = useCurrentUser();

const CHEWSDAY_USERS = ["gumsbolt", "spoon"];
const canChewsday = computed(() => {
  const u = currentUser.value;
  if (!u) return false;
  return [u.displayName, u.firstName].some(n => n && CHEWSDAY_USERS.includes(n.trim().toLowerCase()));
});
const isAdmin = computed(() => (currentUser.value?.level ?? 0) >= 2);

const adminOpen = ref(false);
function closeOnOutside(e: MouseEvent) {
  if (adminOpen.value && !(e.target as HTMLElement).closest(".landing-admin-cell")) adminOpen.value = false;
}
function closeOnEscape(e: KeyboardEvent) { if (e.key === "Escape") adminOpen.value = false; }
onMounted(() => { document.addEventListener("click", closeOnOutside); document.addEventListener("keydown", closeOnEscape); });
onBeforeUnmount(() => { document.removeEventListener("click", closeOnOutside); document.removeEventListener("keydown", closeOnEscape); });
</script>
