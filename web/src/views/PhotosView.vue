<template>
  <div class="page landing-page">
    <div class="landing-header">
      <PageHeader back-to="/" title="Photos" />
      <UserBadge class="landing-user-info" />
    </div>
    <div class="landing-grid">
      <router-link to="/albums" class="feature-card">
        <span class="feature-icon">📔</span>
        <h2>Albums</h2>
      </router-link>
      <router-link to="/search" class="feature-card">
        <span class="feature-icon">🔍</span>
        <h2>Search</h2>
      </router-link>
      <router-link to="/map" class="feature-card">
        <span class="feature-icon">🗺️</span>
        <h2>Map</h2>
      </router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import PageHeader from "../components/PageHeader.vue";
import UserBadge from "../components/UserBadge.vue";
</script>
