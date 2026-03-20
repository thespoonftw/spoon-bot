<template>
  <div class="page">
    <router-link to="/" class="back">← Home</router-link>
    <h1>Users</h1>

    <div class="user-list">
      <div v-for="user in discordUsers" :key="user.userId" class="user-row">
        <img v-if="user.avatarUrl" :src="user.avatarUrl" class="avatar" />
        <div class="avatar placeholder" v-else>{{ (user.firstName || user.displayName)[0] }}</div>
        <div class="user-row-info">
          <span class="user-row-name">{{ user.firstName || user.displayName }}</span>
          <span class="user-row-login">{{ user.displayName }}</span>
          <span class="user-row-login" v-if="user.lastLoginAt">Last login: {{ formatDate(user.lastLoginAt) }}</span>
          <span class="user-row-login never" v-else>Never logged in</span>
        </div>
        <button class="btn-icon" @click="openEdit(user)" title="Edit user">✏️</button>
      </div>
      <p v-if="discordUsers.length === 0" class="empty">No users yet.</p>
      <template v-if="guestUsers.length > 0">
        <p class="user-category" style="margin-top:20px">Not on Discord</p>
        <div v-for="user in guestUsers" :key="user.userId" class="user-row">
          <div class="avatar placeholder">{{ (user.firstName || user.displayName)[0] }}</div>
          <div class="user-row-info">
            <span class="user-row-name">{{ user.firstName || user.displayName }}</span>
          </div>
          <button class="btn-icon" @click="openEdit(user)" title="Edit user">✏️</button>
        </div>
      </template>
    </div>
  </div>

  <div class="modal-overlay" v-if="editingUser">
    <div class="modal">
      <button class="modal-close" @click="editingUser = null">✕</button>
      <h2>Edit User</h2>
      <p style="color:#a6adc8;font-size:0.85em;margin-bottom:20px">{{ editingUser.displayName }}</p>
      <div class="form-group">
        <label>Brunch Name</label>
        <input v-model="editFirstName" type="text" :placeholder="editingUser.displayName" />
      </div>
      <div v-if="saveError" class="error">{{ saveError }}</div>
      <div class="modal-actions">
        <button class="btn-primary" @click="saveEdit" :disabled="saving">{{ saving ? 'Saving…' : 'Save' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useCurrentUser } from "../composables/useCurrentUser";

interface SiteUser { userId: string; displayName: string; firstName?: string; avatarUrl?: string; lastLoginAt?: string }

const users = ref<SiteUser[]>([]);
const discordUsers = computed(() => users.value.filter(u => !u.userId.startsWith("guest_")));
const guestUsers = computed(() => users.value.filter(u => u.userId.startsWith("guest_")));
useCurrentUser();
const editingUser = ref<SiteUser | null>(null);
const editFirstName = ref("");
const saving = ref(false);
const saveError = ref("");

onMounted(async () => {
  const session = localStorage.getItem("snek_session");
  const res = await fetch("/api/site-users", { headers: { Authorization: `Bearer ${session}` } });
  if (res.ok) {
    const data: SiteUser[] = await res.json();
    users.value = data.sort((a, b) => {
      if (a.lastLoginAt && b.lastLoginAt) return b.lastLoginAt.localeCompare(a.lastLoginAt);
      if (a.lastLoginAt) return -1;
      if (b.lastLoginAt) return 1;
      return a.displayName.localeCompare(b.displayName);
    });
  }
});

function openEdit(user: SiteUser) {
  editingUser.value = user;
  editFirstName.value = user.firstName ?? "";
  saveError.value = "";
}

async function saveEdit() {
  if (!editingUser.value) return;
  saveError.value = "";
  const trimmed = editFirstName.value.trim();
  if (trimmed) {
    const duplicate = users.value.find(u =>
      u.userId !== editingUser.value!.userId &&
      u.firstName?.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (duplicate) {
      saveError.value = `"${trimmed}" is already taken by ${duplicate.displayName}`;
      return;
    }
  }
  saving.value = true;
  const session = localStorage.getItem("snek_session");
  const res = await fetch(`/api/site-users/${editingUser.value.userId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session}` },
    body: JSON.stringify({ firstName: trimmed || null }),
  });
  saving.value = false;
  if (res.ok) {
    editingUser.value.firstName = trimmed || undefined;
    editingUser.value = null;
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
</script>
