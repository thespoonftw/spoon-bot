<template>
  <div class="page landing-page">
    <div class="landing-header">
      <PageHeader back-to="/" title="Admin" />
      <UserBadge class="landing-user-info" />
    </div>
    <div v-if="isAdmin" class="landing-grid">
      <router-link to="/status" class="feature-card">
        <span class="feature-icon">📊</span>
        <h2>Stats</h2>
      </router-link>
      <router-link to="/database" class="feature-card">
        <span class="feature-icon">🗄️</span>
        <h2>Database</h2>
      </router-link>
      <router-link to="/users" class="feature-card">
        <span class="feature-icon">👥</span>
        <h2>Users</h2>
      </router-link>
      <router-link to="/groups" class="feature-card">
        <span class="feature-icon">🏷️</span>
        <h2>Groups</h2>
      </router-link>
    </div>
    <p v-else-if="currentUser" class="empty">Admins only.</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import PageHeader from "../components/PageHeader.vue";
import UserBadge from "../components/UserBadge.vue";
import { useCurrentUser } from "../composables/useCurrentUser";
const { currentUser } = useCurrentUser();
const isAdmin = computed(() => (currentUser.value?.level ?? 0) >= 2);
</script>
