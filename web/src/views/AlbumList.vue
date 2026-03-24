<template>
  <div class="page">
    <router-link to="/" class="back">← Home</router-link>
    <h1>Albums</h1>

    <button class="btn-primary" @click="showModal = true" style="margin-bottom:20px">New Album</button>

    <p v-if="loading" class="empty">Loading…</p>
    <p v-else-if="albums.length === 0" class="empty">No albums yet.</p>
    <template v-for="group in albumsByYear" :key="group.year">
      <h2 class="year-header">{{ group.year }}</h2>
      <router-link v-for="album in group.items" :key="album.channelId" :to="`/album/${album.channelId}`" class="card">
        <h2>{{ album.groupName }}</h2>
        <p v-if="album.dateText" class="date">{{ stripYear(album.dateText) }}</p>
        <p v-if="album.location" class="meta">📍 {{ album.location }}</p>
        <div class="card-footer">
          <span class="meta">{{ album.photos.length }} photo(s)</span>
          <div v-if="album.members.length > 0" class="card-members">
            <div v-for="member in album.members" :key="member.userId" class="card-member-avatar" :title="member.firstName || member.displayName">
              <img v-if="member.avatarUrl" :src="member.avatarUrl" />
              <span v-else>{{ (member.firstName || member.displayName)[0] }}</span>
            </div>
            <span class="meta" style="margin-left:4px">{{ album.members.length }} 👥</span>
          </div>
        </div>
      </router-link>
    </template>
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
      <DateRangePicker v-model:start-date="form.startDate" v-model:end-date="form.endDate" />
      <div v-if="formError" class="error">{{ formError }}</div>
      <div class="modal-actions">
        <button class="btn-primary" @click="createAlbum" :disabled="creating">{{ creating ? "Creating…" : "Create" }}</button>
      </div>
    </div>
  </div>

</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useCurrentUser } from "../composables/useCurrentUser";
import { authJsonHeaders } from "../utils/session";
import DateRangePicker from "../components/DateRangePicker.vue";

interface Member { userId: string; displayName: string; firstName?: string; avatarUrl?: string }
interface Album { channelId: string; groupName: string; dateText?: string; location?: string; startDate?: string; createdAt: string; photos: { id: number }[]; members: Member[] }

const albums = ref<Album[]>([]);
const loading = ref(true);
useCurrentUser();

const showModal = ref(false);
const creating = ref(false);
const formError = ref("");
const form = ref({ name: "", location: "", startDate: "", endDate: "" });

const albumsByYear = computed(() => {
  const groups = new Map<string, Album[]>();
  for (const album of albums.value) {
    const year = album.startDate?.slice(0, 4)
      ?? /(\d{4})/.exec(album.dateText ?? "")?.[1]
      ?? album.createdAt.slice(0, 4);
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year)!.push(album);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([year, items]) => ({ year, items }));
});

function stripYear(dateText: string): string {
  return dateText.replace(/ \d{4}$/, "");
}

onMounted(async () => {
  const res = await fetch("/api/albums");
  albums.value = await res.json();
  loading.value = false;
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
  const res = await fetch("/api/albums", {
    method: "POST",
    headers: authJsonHeaders(),
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
