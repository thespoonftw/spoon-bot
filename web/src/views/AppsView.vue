<template>
  <div class="page">
    <PageHeader back-to="/" title="Apps" />
    <p class="apps-intro">Install these on your phone's home screen. They work on iPhone and Android and update themselves whenever the site does.</p>
    <div class="apps-list">
      <router-link v-for="app in apps" :key="app.to" :to="app.to" class="app-card">
        <img :src="app.icon" class="app-card-icon" alt="" />
        <div class="app-card-text">
          <h2>{{ app.name }}</h2>
          <p>{{ app.description }}</p>
        </div>
        <span class="app-card-get">Get</span>
      </router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import PageHeader from "../components/PageHeader.vue";

// Each app is a section of the site installed as a PWA; its "to" page explains how to install it.
const apps = [
  { name: "Brunch Reviews", description: "Read and write reviews of everything we read, watch, play, eat and drink.", icon: "/reviews-app/icon-192.png", to: "/reviews/app" },
  { name: "brunchPhotos", description: "Browse the albums, search the photos, see them on a map, and upload your own.", icon: "/photos-app/icon-192.png", to: "/photos/app" },
];
</script>

<style scoped>
.apps-intro { color: #a6adc8; margin: 0 0 20px; line-height: 1.5; }
.apps-list { display: flex; flex-direction: column; gap: 12px; }
.app-card { display: flex; align-items: center; gap: 16px; background: #313244; border-radius: 16px; padding: 16px 20px; text-decoration: none; color: inherit; transition: background 0.15s; }
.app-card:hover { background: #45475a; }
.app-card-icon { width: 64px; height: 64px; border-radius: 15px; flex-shrink: 0; }
.app-card-text { flex: 1; min-width: 0; }
.app-card-text h2 { color: #cba6f7; font-size: 1.2rem; margin: 0 0 4px; }
.app-card-text p { color: #a6adc8; margin: 0; font-size: 0.9rem; line-height: 1.4; }
.app-card-get { background: #cba6f7; color: #1e1e2e; font-weight: 700; border-radius: 999px; padding: 6px 16px; flex-shrink: 0; }
</style>
