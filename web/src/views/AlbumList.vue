<template>
  <div class="page">
    <div class="header-row">
      <div class="header-left">
        <router-link to="/" class="back">← Home</router-link>
        <h1>📸 Photo Albums</h1>
      </div>
      <div class="user-info" v-if="currentUser">
        <img v-if="currentUser.avatarUrl" :src="currentUser.avatarUrl" class="avatar" />
        <div class="avatar placeholder" v-else>{{ currentUser.displayName[0] }}</div>
        <span class="user-name">{{ currentUser.displayName }}</span>
        <button class="logout" @click="logout">Log out</button>
      </div>
    </div>

    <button class="btn-primary" @click="showModal = true" style="margin-bottom:20px">+ New Album</button>

    <p v-if="albums.length === 0" class="empty">No albums yet.</p>
    <router-link v-for="album in albums" :key="album.channelId" :to="`/album/${album.channelId}`" class="card">
      <h2>{{ album.groupName }}</h2>
      <p v-if="album.dateText" class="date">{{ album.dateText }}</p>
      <p v-if="album.location" class="meta">📍 {{ album.location }}</p>
      <div class="card-footer">
        <span class="meta">{{ album.photos.length }} photo(s)</span>
        <div v-if="album.members.length > 0" class="card-members">
          <div v-for="member in album.members" :key="member.userId" class="card-member-avatar" :title="member.firstName || member.displayName">
            <img v-if="member.avatarUrl" :src="member.avatarUrl" />
            <span v-else>{{ (member.firstName || member.displayName)[0] }}</span>
          </div>
          <span class="meta" style="margin-left:4px">{{ album.members.length }}</span>
        </div>
      </div>
    </router-link>
  </div>

  <!-- Create Album Modal -->
  <div class="modal-overlay" v-if="showModal">
    <div class="modal">
      <button class="modal-close" @click="closeModal">✕</button>
      <h2>New Album</h2>
      <div class="form-group">
        <label>Name</label>
        <input v-model="form.name" type="text" placeholder="e.g. Summer Trip" />
      </div>
      <div class="form-group">
        <label>Location</label>
        <input v-model="form.location" type="text" placeholder="e.g. Barcelona" />
      </div>
      <div class="form-group">
        <label>Start Date</label>
        <input v-model="form.startDate" type="date" />
      </div>
      <div class="form-group">
        <label>End Date</label>
        <div v-if="form.endDate" style="display:flex;gap:8px;align-items:center">
          <input v-model="form.endDate" type="date" style="flex:1" />
          <button type="button" class="btn-remove" @click="form.endDate = ''">remove</button>
        </div>
        <button v-else type="button" class="btn-secondary btn-small" @click="form.endDate = form.startDate">+ Add end date</button>
      </div>
      <div v-if="formError" class="error">{{ formError }}</div>
      <div class="modal-actions">
        <button class="btn-primary" @click="createAlbum" :disabled="creating">{{ creating ? "Creating…" : "Create" }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useCurrentUser } from "../composables/useCurrentUser";

interface Member { userId: string; displayName: string; firstName?: string; avatarUrl?: string }
interface Album { channelId: string; groupName: string; dateText?: string; location?: string; photos: { id: number }[]; members: Member[] }

const albums = ref<Album[]>([]);
const { currentUser, logout } = useCurrentUser();

const showModal = ref(false);
const creating = ref(false);
const formError = ref("");
const form = ref({ name: "", location: "", startDate: "", endDate: "" });

onMounted(async () => {
  const res = await fetch("/api/albums");
  albums.value = await res.json();
});

function closeModal() {
  showModal.value = false;
  formError.value = "";
  form.value = { name: "", location: "", startDate: "", endDate: "" };
}

async function createAlbum() {
  formError.value = "";
  if (!form.value.name.trim()) { formError.value = "Name is required."; return; }
  if (!form.value.location.trim()) { formError.value = "Location is required."; return; }
  if (!form.value.startDate) { formError.value = "Start date is required."; return; }
  creating.value = true;
  const session = localStorage.getItem("snek_session");
  const res = await fetch("/api/albums", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session}` },
    body: JSON.stringify({
      name: form.value.name.trim(),
      location: form.value.location.trim(),
      startDate: form.value.startDate,
      endDate: form.value.endDate || undefined,
    }),
  });
  creating.value = false;
  if (res.ok) {
    const album = await res.json();
    albums.value.unshift(album);
    closeModal();
  } else {
    formError.value = "Failed to create album. Try again.";
  }
}

</script>
