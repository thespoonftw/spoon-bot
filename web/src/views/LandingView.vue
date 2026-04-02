<template>
  <div class="page">
    <div class="landing-header">
      <h1>Brunch Projects</h1>
      <div class="user-info landing-user-info" v-if="currentUser">
        <img v-if="currentUser.avatarUrl" :src="currentUser.avatarUrl" class="avatar" />
        <div class="avatar placeholder" v-else>{{ (currentUser.firstName || currentUser.displayName)[0] }}</div>
        <span class="user-name">{{ currentUser.firstName || currentUser.displayName }}</span>
        <button class="logout" @click="logout">Log out</button>
      </div>
    </div>

    <div class="landing-grid">
      <router-link to="/albums" class="feature-card">
        <span class="feature-icon">📔</span>
        <h2>Albums</h2>
      </router-link>
      <router-link to="/map" class="feature-card">
        <span class="feature-icon">🗺️</span>
        <h2>Map</h2>
      </router-link>
      <router-link to="/search" class="feature-card">
        <span class="feature-icon">🔍</span>
        <h2>Search</h2>
      </router-link>
      <router-link to="/users" class="feature-card">
        <span class="feature-icon">👥</span>
        <h2>Users</h2>
      </router-link>
      <router-link to="/status" class="feature-card">
        <span class="feature-icon">📊</span>
        <h2>Stats</h2>
      </router-link>
      <router-link to="/database" class="feature-card">
        <span class="feature-icon">🗄️</span>
        <h2>Database</h2>
      </router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useCurrentUser } from "../composables/useCurrentUser";
const { currentUser, logout } = useCurrentUser();
</script>
