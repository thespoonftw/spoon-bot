<template>
  <div class="rv">
    <div class="rv-topbar">
      <template v-if="!isPublic && currentUser">
        <img v-if="currentUser.avatarUrl" :src="currentUser.avatarUrl" class="rv-avatar" alt="" />
        <span v-else class="rv-avatar">{{ userName[0] }}</span>
        <span>{{ userName }}</span>
        <button type="button" class="rv-link-btn" @click="logout">Log out</button>
      </template>
    </div>
    <header class="rv-masthead">
      <div>
        <h1><router-link :to="isPublic ? '/reviews/login' : '/reviews'">Reviews</router-link></h1>
        <div class="rv-masthead-sub">Books, films &amp; series — what everyone's been getting through.</div>
      </div>
      <router-link v-if="!isPublic && route.path !== '/reviews/new'" to="/reviews/new" class="rv-btn">✎ Write a review</router-link>
    </header>
    <router-view :key="route.fullPath" />
  </div>
</template>

<script setup lang="ts">
import { computed, watch, onMounted, onUnmounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useCurrentUser } from "../composables/useCurrentUser";
import "./reviews.css";

const route = useRoute();
const router = useRouter();
const { currentUser, reload } = useCurrentUser();
const isPublic = computed(() => !!route.meta.public);
const userName = computed(() => currentUser.value?.firstName || currentUser.value?.displayName || "");

// The layout stays mounted across the login pages, so pick the user up once they're signed in.
watch(isPublic, (pub) => { if (!pub && !currentUser.value) reload(); });

async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  currentUser.value = null;
  router.push("/reviews/login");
}

// The body carries the section's palette and background, so overscroll and short pages match too.
onMounted(() => document.body.classList.add("rv-body"));
onUnmounted(() => document.body.classList.remove("rv-body"));
</script>
