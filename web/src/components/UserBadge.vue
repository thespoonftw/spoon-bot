<template>
  <div class="user-info" v-if="currentUser">
    <img v-if="currentUser.avatarUrl" :src="currentUser.avatarUrl" class="avatar" />
    <div class="avatar placeholder" v-else>{{ (currentUser.firstName || currentUser.displayName)[0] }}</div>
    <span class="user-name">{{ currentUser.firstName || currentUser.displayName }}</span>
    <div ref="menuRoot" class="user-options">
      <button type="button" class="user-options-btn" aria-label="Options" aria-haspopup="menu" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
      </button>
      <div v-if="menuOpen" class="user-options-menu" role="menu">
        <button type="button" role="menuitem" @click="logout">Log out</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { useCurrentUser } from "../composables/useCurrentUser";
const { currentUser, logout } = useCurrentUser();

// The ⋮ options menu. Closes on a tap elsewhere or Escape.
const menuOpen = ref(false);
const menuRoot = ref<HTMLElement | null>(null);
function onDocPointer(e: PointerEvent) {
  if (menuOpen.value && menuRoot.value && !menuRoot.value.contains(e.target as Node)) menuOpen.value = false;
}
function onKey(e: KeyboardEvent) { if (e.key === "Escape") menuOpen.value = false; }
onMounted(() => { document.addEventListener("pointerdown", onDocPointer); document.addEventListener("keydown", onKey); });
onUnmounted(() => { document.removeEventListener("pointerdown", onDocPointer); document.removeEventListener("keydown", onKey); });
</script>
