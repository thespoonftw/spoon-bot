<template>
  <div class="page landing-page">
    <div class="landing-header">
      <!-- The installed Photo Archives app starts here, with no way back to the rest of Brunch Projects. -->
      <h1 v-if="inApp">Photo Archives</h1>
      <PageHeader v-else back-to="/" title="Photo Archives" />
      <UserBadge class="landing-user-info" />
    </div>
    <div class="landing-grid landing-grid--pairs">
      <router-link to="/archives/timeline" class="feature-card">
        <span class="feature-icon">🕰️</span>
        <h2>Timeline</h2>
      </router-link>
      <router-link to="/archives/map" class="feature-card">
        <span class="feature-icon">🗺️</span>
        <h2>Map</h2>
      </router-link>
      <router-link to="/archives/search" class="feature-card">
        <span class="feature-icon">🔍</span>
        <h2>Search</h2>
      </router-link>
      <button type="button" class="feature-card feature-card--button" @click="creating = true">
        <span class="feature-icon">➕</span>
        <h2>Create Album</h2>
      </button>
      <!-- Installing only makes sense on a phone, and not from inside the app itself. -->
      <router-link v-if="onPhone && !inApp" to="/archives/app" class="feature-card">
        <span class="feature-icon">📲</span>
        <h2>App</h2>
      </router-link>
    </div>
    <CreateAlbumModal v-if="creating" @close="creating = false" />
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import PageHeader from "../components/PageHeader.vue";
import UserBadge from "../components/UserBadge.vue";
import CreateAlbumModal from "../components/CreateAlbumModal.vue";
import { isStandalone, isIos, isAndroid } from "../utils/pwa";

const inApp = isStandalone();
const onPhone = isIos() || isAndroid();
const creating = ref(false);
</script>
