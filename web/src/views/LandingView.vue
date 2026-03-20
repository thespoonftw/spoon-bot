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
        <span class="feature-icon">📸</span>
        <h2>Albums</h2>
        <p>Browse and upload photo albums</p>
      </router-link>
      <router-link to="/users" class="feature-card">
        <span class="feature-icon">👥</span>
        <h2>Users</h2>
        <p>See who's in the community</p>
      </router-link>
      <router-link to="/status" class="feature-card">
        <span class="feature-icon">💾</span>
        <h2>Status</h2>
        <p>Storage and library stats</p>
      </router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useCurrentUser } from "../composables/useCurrentUser";
const { currentUser, logout } = useCurrentUser();
</script>
