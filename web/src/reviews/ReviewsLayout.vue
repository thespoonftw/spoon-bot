<template>
  <div class="rv">
    <div class="rv-topbar">
      <router-link to="/">← Directory</router-link>
      <span v-if="currentUser">Signed in as {{ currentUser.firstName || currentUser.displayName }}</span>
    </div>
    <header class="rv-masthead">
      <div>
        <h1><router-link to="/reviews">Reviews</router-link></h1>
        <div class="rv-masthead-sub">Books, films &amp; series — what everyone's been getting through.</div>
      </div>
      <router-link v-if="route.path !== '/reviews/new'" to="/reviews/new" class="rv-btn">✎ Write a review</router-link>
    </header>
    <router-view :key="route.fullPath" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { useRoute } from "vue-router";
import { useCurrentUser } from "../composables/useCurrentUser";
import "./reviews.css";

const route = useRoute();
const { currentUser } = useCurrentUser();

// The body carries the section's palette and background, so overscroll and short pages match too.
onMounted(() => document.body.classList.add("rv-body"));
onUnmounted(() => document.body.classList.remove("rv-body"));
</script>
