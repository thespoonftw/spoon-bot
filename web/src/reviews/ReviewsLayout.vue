<template>
  <div class="rv">
    <div class="rv-topbar">
      <nav v-if="!isPublic" class="rv-nav">
        <router-link to="/reviews" :class="{ active: route.path === '/reviews' }">All reviews</router-link>
        <router-link v-if="currentUser" :to="`/reviews/people/${currentUser.userId}`" :class="{ active: route.path === `/reviews/people/${currentUser.userId}` }">My reviews</router-link>
        <router-link v-if="(currentUser?.level ?? 0) >= 2" to="/reviews/types" class="rv-nav-desktop-only" :class="{ active: route.path === '/reviews/types' }">Types</router-link>
        <router-link v-if="showGetApp" to="/reviews/app" :class="{ active: route.path === '/reviews/app' }">Get the app</router-link>
      </nav>
      <div v-if="!isPublic && currentUser" class="rv-topbar-user">
        <img v-if="currentUser.avatarUrl" :src="currentUser.avatarUrl" class="rv-avatar" alt="" />
        <span v-else class="rv-avatar">{{ userName[0] }}</span>
        <span>{{ userName }}</span>
        <button type="button" class="rv-link-btn" @click="logout">Log out</button>
      </div>
    </div>
    <header class="rv-masthead">
      <h1><router-link :to="isPublic ? '/reviews/login' : '/reviews'">Brunch Reviews</router-link></h1>
      <!-- A single review offers "Write your own review for this" instead. -->
      <router-link v-if="!isPublic && route.path !== '/reviews/new' && !isReviewPage" :to="newReviewLink" class="rv-btn">✎ Write a review</router-link>
    </header>
    <router-view :key="route.fullPath" />
  </div>
</template>

<script setup lang="ts">
import { computed, watch, onMounted, onUnmounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useCurrentUser } from "../composables/useCurrentUser";
import { isStandalone, isIos, isAndroid } from "../utils/reviewsApp";
import "./reviews.css";

// "Get the app" is for phones (and tablets) that aren't already in the app.
const showGetApp = (isIos() || isAndroid()) && !isStandalone();

const route = useRoute();
const router = useRouter();
const { currentUser, reload } = useCurrentUser();
// Login pages drop the nav; pages open to all (the Get the app page) keep it for signed-in people.
const isPublic = computed(() => !!route.meta.public && !(route.meta.openToAll && currentUser.value));
const isReviewPage = computed(() => /^\/reviews\/\d+$/.test(route.path));
// On a type's tab (/reviews?type=<id>), the new review starts as that type.
const newReviewLink = computed(() => route.path === "/reviews" && /^\d+$/.test(String(route.query.type ?? "")) ? `/reviews/new?type=${route.query.type}` : "/reviews/new");
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
