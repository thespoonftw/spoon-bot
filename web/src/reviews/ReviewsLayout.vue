<template>
  <div class="rv" :class="{ 'rv--write-bar': showWriteBar }">
    <header class="rv-masthead">
      <h1><router-link :to="isPublic ? '/reviews/login' : '/reviews'">Brunch Reviews</router-link></h1>
      <div v-if="!isPublic && currentUser" class="rv-masthead-user">
        <!-- Your name is the way to My reviews. -->
        <router-link :to="myReviewsLink" class="rv-me" :class="{ active: route.path === myReviewsLink }" title="My reviews">
          <img v-if="currentUser.avatarUrl" :src="currentUser.avatarUrl" class="rv-avatar" alt="" />
          <span v-else class="rv-avatar">{{ userName[0] }}</span>
          <span class="rv-me-name">{{ userName }}</span>
        </router-link>
        <div ref="menuRoot" class="rv-options">
          <button type="button" class="rv-options-btn" aria-label="Options" aria-haspopup="menu" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
          </button>
          <div v-if="menuOpen" class="rv-options-menu" role="menu">
            <router-link v-if="(currentUser.level ?? 0) >= 2" to="/reviews/types" role="menuitem">Types</router-link>
            <router-link v-if="showGetApp" to="/reviews/app" role="menuitem">Get the app</router-link>
            <button type="button" role="menuitemcheckbox" :aria-checked="darkMode" @click="darkMode = !darkMode">
              <span>Dark mode</span>
              <span class="rv-switch" :class="{ 'rv-switch--on': darkMode }" aria-hidden="true"></span>
            </button>
            <button type="button" role="menuitem" @click="logout">Log out</button>
          </div>
        </div>
      </div>
    </header>
    <router-view :key="route.fullPath" />
    <!-- Phones: "Write a review" stays at the bottom of the screen. On desktop the home page puts it
         beside the category tabs instead (ReviewsHome). -->
    <div v-if="showWriteBar" class="rv-write-bar">
      <router-link :to="newReviewLink" class="rv-btn">✎ Write a review</router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useCurrentUser } from "../composables/useCurrentUser";
import { isStandalone, isIos, isAndroid } from "../utils/reviewsApp";
import { darkMode, applyReviewsTheme, removeReviewsTheme } from "../utils/reviewsTheme";
import "./reviews.css";

// "Get the app" is for phones (and tablets) that aren't already in the app.
const showGetApp = (isIos() || isAndroid()) && !isStandalone();

const route = useRoute();
const router = useRouter();
const { currentUser, reload } = useCurrentUser();
// Login pages drop your name and the menu; pages open to all (the Get the app page) keep them for signed-in people.
const isPublic = computed(() => !!route.meta.public && !(route.meta.openToAll && currentUser.value));
const myReviewsLink = computed(() => currentUser.value ? `/reviews/people/${currentUser.value.userId}` : "/reviews");
// The phone's bottom "Write a review" bar shows on the feed and people's pages (a single review
// offers "Write your own review for this" instead; the editor and admin pages don't need it).
// CSS hides it on desktop.
const showWriteBar = computed(() => !isPublic.value && !!currentUser.value && (route.path === "/reviews" || route.path.startsWith("/reviews/people/")));
// On a type's tab (/reviews?type=<id>), the new review starts as that type.
const newReviewLink = computed(() => route.path === "/reviews" && /^\d+$/.test(String(route.query.type ?? "")) ? `/reviews/new?type=${route.query.type}` : "/reviews/new");
const userName = computed(() => currentUser.value?.firstName || currentUser.value?.displayName || "");

// The layout stays mounted across the login pages, so pick the user up once they're signed in.
watch(isPublic, (pub) => { if (!pub && !currentUser.value) reload(); });

// The ⋮ options menu: Types (admins), Get the app (phones), dark mode and log out. Closes on a tap elsewhere, Escape, or moving page.
const menuOpen = ref(false);
const menuRoot = ref<HTMLElement | null>(null);
function onDocPointer(e: PointerEvent) {
  if (menuOpen.value && menuRoot.value && !menuRoot.value.contains(e.target as Node)) menuOpen.value = false;
}
function onKey(e: KeyboardEvent) { if (e.key === "Escape") menuOpen.value = false; }
watch(() => route.fullPath, () => { menuOpen.value = false; });

async function logout() {
  menuOpen.value = false;
  await fetch("/api/auth/logout", { method: "POST" });
  currentUser.value = null;
  router.push("/reviews/login");
}

// The body carries the section's palette and background, so overscroll and short pages match too.
onMounted(() => {
  document.body.classList.add("rv-body");
  applyReviewsTheme(darkMode.value);
  document.addEventListener("pointerdown", onDocPointer);
  document.addEventListener("keydown", onKey);
});
onUnmounted(() => {
  document.body.classList.remove("rv-body");
  removeReviewsTheme();
  document.removeEventListener("pointerdown", onDocPointer);
  document.removeEventListener("keydown", onKey);
});
</script>
