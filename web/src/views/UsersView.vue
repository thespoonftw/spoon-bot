<template>
  <div class="page">
    <PageHeader back-to="/" title="Users" />

    <div class="user-controls-row">
      <div style="display:flex;align-items:center;gap:8px">
        <label style="font-size:0.85em;color:#a6adc8">Sort:</label>
        <select v-model="sortBy" class="sort-select">
          <option value="tags">Most Tags</option>
          <option value="uploads">Most Uploads</option>
          <option value="lastSeen">Last Seen</option>
          <option value="alpha">Alphabetical</option>
        </select>
      </div>
      <button v-if="canEditGroups" class="btn-secondary btn-small" @click="addingUser = true">+ Add User</button>
    </div>

    <div class="user-list">
      <div v-for="user in sortedDiscordUsers" :key="user.userId" class="user-row">
        <img v-if="user.avatarUrl" :src="user.avatarUrl" class="avatar" />
        <div class="avatar placeholder" v-else>{{ (user.firstName || user.displayName)[0] }}</div>
        <div class="user-row-info">
          <div class="user-row-name-row">
            <span class="user-row-name">{{ user.firstName || user.displayName }}</span>
            <button class="btn-icon" @click="openEdit(user)" title="Edit user">✏️</button>
          </div>
          <span class="user-row-login">{{ user.displayName }}</span>
          <div v-if="user.groups?.length" class="user-row-groups">
            <span v-for="g in user.groups" :key="g.id" class="user-group-tag" :style="{ background: g.color }">{{ g.name }}</span>
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
      <p v-else-if="sortedDiscordUsers.length === 0" class="empty">No users yet.</p>
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

  <div class="modal-overlay" v-if="addingUser">
    <div class="modal">
      <button class="modal-close" @click="addingUser = false; addUserId = ''; addUserError = ''">✕</button>
      <h2>Add User</h2>
      <div class="form-group">
        <label>Discord User ID</label>
        <input v-model="addUserId" type="text" placeholder="e.g. 368680768832143362" @keydown.enter="addUser" />
      </div>
      <div v-if="addUserError" class="error">{{ addUserError }}</div>
      <div class="modal-actions">
        <button class="btn-primary" @click="addUser" :disabled="!addUserId.trim() || addUserLoading">{{ addUserLoading ? 'Adding…' : 'Add' }}</button>
      </div>
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
      <div class="form-group" v-if="canEditGroups">
        <label>Groups</label>
        <div class="user-row-groups" style="margin-top:6px">
          <button v-for="g in allGroups" :key="g.id"
            class="user-group-tag"
            :style="{ background: editGroups.includes(g.id) ? g.color : '#45475a', cursor: 'pointer', border: 'none', fontSize: '0.82em', padding: '4px 12px' }"
            @click="editGroups.includes(g.id) ? editGroups.splice(editGroups.indexOf(g.id), 1) : editGroups.push(g.id)">
            {{ g.name }}
          </button>
        </div>
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

interface SiteGroup { id: number; name: string; color: string }
interface SiteUser { userId: string; displayName: string; firstName?: string; avatarUrl?: string; lastSeenAt?: string; uploadCount?: number; taggedCount?: number; groups?: SiteGroup[]; level: number }

const allGroups = ref<SiteGroup[]>([]);

const users = ref<SiteUser[]>([]);
const loading = ref(true);
const sortBy = ref<'tags' | 'uploads' | 'lastSeen' | 'alpha'>('tags');
const sortedDiscordUsers = computed(() => {
  const list = users.value.filter(u => !u.userId.startsWith("guest_"));
  return [...list].sort((a, b) => {
    switch (sortBy.value) {
      case 'tags': return (b.taggedCount ?? 0) - (a.taggedCount ?? 0);
      case 'uploads': return (b.uploadCount ?? 0) - (a.uploadCount ?? 0);
      case 'lastSeen':
        if (a.lastSeenAt && b.lastSeenAt) return b.lastSeenAt.localeCompare(a.lastSeenAt);
        if (a.lastSeenAt) return -1;
        if (b.lastSeenAt) return 1;
        return 0;
      case 'alpha': return (a.firstName || a.displayName).localeCompare(b.firstName || b.displayName);
    }
  });
});
const guestUsers = computed(() => users.value.filter(u => u.userId.startsWith("guest_")));
const addingUser = ref(false);
const addUserId = ref('');
const addUserError = ref('');
const addUserLoading = ref(false);
const { currentUser } = useCurrentUser();
const canEditGroups = computed(() => (users.value.find(u => u.userId === currentUser.value?.userId)?.level ?? 0) >= 2);
const editingUser = ref<SiteUser | null>(null);
const editFirstName = ref("");
const editGroups = ref<number[]>([]);
const saving = ref(false);
const saveError = ref("");

onMounted(async () => {
  const gres = await fetch("/api/groups", { headers: authHeaders() });
  if (gres.ok) allGroups.value = await gres.json();
  const res = await fetch("/api/site-users", { headers: authHeaders() });
  if (res.ok) users.value = await res.json();
  loading.value = false;
});

async function addUser() {
  const id = addUserId.value.trim();
  if (!id) return;
  addUserLoading.value = true;
  addUserError.value = '';
  const res = await fetch('/api/site-users', {
    method: 'POST',
    headers: authJsonHeaders(),
    body: JSON.stringify({ userId: id }),
  });
  addUserLoading.value = false;
  if (res.ok) {
    const user: SiteUser = await res.json();
    users.value.push(user);
    addUserId.value = '';
    addingUser.value = false;
  } else {
    const err = await res.json().catch(() => ({}));
    addUserError.value = (err as any).error || 'Failed to add user';
  }
}

function openEdit(user: SiteUser) {
  editingUser.value = user;
  editFirstName.value = user.firstName ?? "";
  editGroups.value = (user.groups ?? []).map(g => g.id);
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
  const groupIds = editGroups.value;
  const res = await fetch(`/api/site-users/${editingUser.value.userId}`, {
    method: "PUT",
    headers: authJsonHeaders(),
    body: JSON.stringify({ firstName: trimmed || null, groups: groupIds }),
  });
  saving.value = false;
  if (res.ok) {
    editingUser.value.firstName = trimmed || undefined;
    editingUser.value.groups = allGroups.value.filter(g => groupIds.includes(g.id));
    editingUser.value = null;
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
</script>
