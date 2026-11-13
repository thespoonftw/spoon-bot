<template>
  <div class="page landing-page">
    <div class="landing-header">
      <!-- The installed brunchPhotos app starts here, with no way back to the rest of Brunch Projects. -->
      <h1 v-if="inApp">brunchPhotos</h1>
      <PageHeader v-else back-to="/" title="Photos" />
      <UserBadge class="landing-user-info" />
    </div>
    <div class="landing-grid">
      <router-link to="/photos/albums" class="feature-card">
        <span class="feature-icon">📔</span>
        <h2>Albums</h2>
      </router-link>
      <router-link to="/photos/search" class="feature-card">
        <span class="feature-icon">🔍</span>
        <h2>Search</h2>
      </router-link>
      <router-link to="/photos/map" class="feature-card">
        <span class="feature-icon">🗺️</span>
        <h2>Map</h2>
      </router-link>
      <router-link v-if="!inApp" to="/photos/app" class="feature-card">
        <span class="feature-icon">📲</span>
        <h2>App</h2>
      </router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import PageHeader from "../components/PageHeader.vue";
import UserBadge from "../components/UserBadge.vue";
import { isStandalone } from "../utils/pwa";

const inApp = isStandalone();
</script>
