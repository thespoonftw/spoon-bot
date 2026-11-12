<template>
  <div class="user-info" v-if="currentUser">
    <img v-if="currentUser.avatarUrl" :src="currentUser.avatarUrl" class="avatar" />
    <div class="avatar placeholder" v-else>{{ (currentUser.firstName || currentUser.displayName)[0] }}</div>
    <span class="user-name">{{ currentUser.firstName || currentUser.displayName }}</span>
    <button class="logout" @click="logout">Log out</button>
  </div>
</template>

<script setup lang="ts">
import { useCurrentUser } from "../composables/useCurrentUser";
const { currentUser, logout } = useCurrentUser();
</script>
