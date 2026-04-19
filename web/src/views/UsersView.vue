<template>
  <div class="page">
    <PageHeader back-to="/" title="Users" />

    <div class="user-list">
      <div v-for="user in discordUsers" :key="user.userId" class="user-row">
        <img v-if="user.avatarUrl" :src="user.avatarUrl" class="avatar" />
        <div class="avatar placeholder" v-else>{{ (user.firstName || user.displayName)[0] }}</div>
        <div class="user-row-info">
          <div class="user-row-name-row">
            <span class="user-row-name">{{ user.firstName || user.displayName }}</span>
            <button class="btn-icon" @click="openEdit(user)" title="Edit user">✏️</button>
          </div>
          <span class="user-row-login">{{ user.displayName }}</span>
          <div v-if="user.groups?.length" class="user-row-groups">
            <span v-for="g in user.groups" :key="g" class="user-group-tag" :style="{ background: GROUP_COLORS[g] ?? '#585b70' }">{{ g }}</span>
          </div>
          <span class="user-row-login" v-if="user.lastSeenAt">Last seen: {{ formatDate(user.lastSeenAt) }}</span>
          <span class="user-row-login never" v-else>Never seen</span>
          <span class="user-row-stats" v-if="user.uploadCount !== undefined">
            📷 {{ user.uploadCount }} upload{{ user.uploadCount === 1 ? '' : 's' }}
            <span class="user-row-stats-sep desktop-only">&nbsp;·&nbsp;</span><span class="user-row-stats-tagged">👥 tagged {{ user.taggedCount }} time{{ user.taggedCount === 1 ? '' : 's' }}</span>
          </span>
        </div>
      </div>
      <p v-if="loading" class="empty">Loading…</p>
      <p v-else-if="discordUsers.length === 0" class="empty">No users yet.</p>
      <template v-if="guestUsers.length > 0">
        <p class="user-category" style="margin-top:20px">Not on Discord</p>
        <div v-for="user in guestUsers" :key="user.userId" class="user-row">
          <div class="avatar placeholder">{{ (user.firstName || user.displayName)[0] }}</div>
          <div class="user-row-info">
            <div class="user-row-name-row">
              <span class="user-row-name">{{ user.firstName || user.displayName }}</span>
              <button class="btn-icon" @click="openEdit(user)" title="Edit user">✏️</button>
            </div>
          </div>
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
        <label>Display Name</label>
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
import { authHeaders, authJsonHeaders } from "../utils/session";
import PageHeader from "../components/PageHeader.vue";

interface SiteUser { userId: string; displayName: string; firstName?: string; avatarUrl?: string; lastSeenAt?: string; uploadCount?: number; taggedCount?: number; groups?: string[] }

const GROUP_COLORS: Record<string, string> = {
  Brunch: '#e8950f',
  Void:   '#00aff0',
  UoB:    '#b5331e',
  Wright: '#1a5f9e',
};

const users = ref<SiteUser[]>([]);
const loading = ref(true);
const discordUsers = computed(() => users.value.filter(u => !u.userId.startsWith("guest_")));
const guestUsers = computed(() => users.value.filter(u => u.userId.startsWith("guest_")));
useCurrentUser();
const editingUser = ref<SiteUser | null>(null);
const editFirstName = ref("");
const saving = ref(false);
const saveError = ref("");

onMounted(async () => {
  const res = await fetch("/api/site-users", { headers: authHeaders() });
  if (res.ok) {
    const data: SiteUser[] = await res.json();
    users.value = data.sort((a, b) => {
      if (a.lastSeenAt && b.lastSeenAt) return b.lastSeenAt.localeCompare(a.lastSeenAt);
      if (a.lastSeenAt) return -1;
      if (b.lastSeenAt) return 1;
      return a.displayName.localeCompare(b.displayName);
    });
  }
  loading.value = false;
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
  const res = await fetch(`/api/site-users/${editingUser.value.userId}`, {
    method: "PUT",
    headers: authJsonHeaders(),
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
