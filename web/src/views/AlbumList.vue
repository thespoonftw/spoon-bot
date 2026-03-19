<template>
  <div class="page">
    <div class="header-row">
      <h1>📸 Snek Photo Albums</h1>
      <div class="user-info" v-if="currentUser">
        <img v-if="currentUser.avatarUrl" :src="currentUser.avatarUrl" class="avatar" />
        <div class="avatar placeholder" v-else>{{ currentUser.displayName[0] }}</div>
        <span class="user-name">{{ currentUser.displayName }}</span>
        <button class="logout" @click="logout">Log out</button>
      </div>
    </div>

    <button class="btn-primary" @click="showModal = true">+ New Album</button>

    <p v-if="albums.length === 0" class="empty" style="margin-top:24px">No albums yet.</p>
    <router-link v-for="album in albums" :key="album.channelId" :to="`/album/${album.channelId}`" class="card">
      <h2>{{ album.groupName }}</h2>
      <p v-if="album.dateText" class="date">{{ album.dateText }}</p>
      <p v-if="album.location" class="meta">📍 {{ album.location }}</p>
      <p class="meta">{{ album.photos.length }} photo(s)</p>
    </router-link>
  </div>

  <!-- Create Album Modal -->
  <div class="modal-overlay" v-if="showModal" @click.self="closeModal">
    <div class="modal">
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
        <label>End Date <span class="optional">(optional)</span></label>
        <input v-model="form.endDate" type="date" />
      </div>
      <div v-if="formError" class="error">{{ formError }}</div>
      <div class="modal-actions">
        <button class="btn-secondary" @click="closeModal">Cancel</button>
        <button class="btn-primary" @click="createAlbum" :disabled="creating">
          {{ creating ? "Creating…" : "Create" }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";

interface Album { channelId: string; groupName: string; dateText?: string; location?: string; photos: { id: number }[] }
interface UserInfo { displayName: string; avatarUrl: string }

const albums = ref<Album[]>([]);
const currentUser = ref<UserInfo | null>(null);
const router = useRouter();

const showModal = ref(false);
const creating = ref(false);
const formError = ref("");
const form = ref({ name: "", location: "", startDate: "", endDate: "" });

onMounted(async () => {
  const session = localStorage.getItem("snek_session");
  const [albumsRes, userRes] = await Promise.all([
    fetch("/api/albums"),
    fetch("/api/auth/check", { headers: { Authorization: `Bearer ${session}` } }),
  ]);
  albums.value = await albumsRes.json();
  if (userRes.ok) {
    const data = await userRes.json();
    if (data.valid) currentUser.value = { displayName: data.displayName, avatarUrl: data.avatarUrl };
  }
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

async function logout() {
  const session = localStorage.getItem("snek_session");
  await fetch("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${session}` } });
  localStorage.removeItem("snek_session");
  router.push("/login");
}
</script>
