<template>
  <div class="page">
    <router-link to="/" class="back">← Home</router-link>
    <h1>Search Photos</h1>

    <div class="search-filters">
      <div class="search-filters-row">
        <select v-model="filterMode" @change="onFilterModeChange">
          <option value="all">All Photos</option>
          <option value="uploadedBy">Uploaded By</option>
          <option value="taggedIn">Tagged In</option>
        </select>
        <select v-if="filterMode !== 'all'" v-model="filterUserId" @change="resetAndFetch">
          <option value="">Any person</option>
          <option v-for="u in users" :key="u.userId" :value="u.userId">{{ u.firstName || u.displayName }}</option>
        </select>
        <span class="search-count" v-if="total !== null">{{ total }} photo{{ total === 1 ? '' : 's' }}</span>
      </div>
      <div class="search-filters-row">
        <select v-model="sort" @change="resetAndFetch">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="top">Highest rated</option>
        </select>
      </div>
    </div>

    <div v-if="loading" class="empty">Loading…</div>
    <div v-else-if="!photos.length" class="empty">No photos found.</div>

    <PhotoGallery v-else :sections="[{ label: '', photos }]" :members="users" />

    <div class="search-pagination" v-if="total !== null && total > pageSize">
      <button :disabled="page === 0" @click="changePage(page - 1)">← Prev</button>
      <span>Page {{ page + 1 }} of {{ totalPages }}</span>
      <button :disabled="page >= totalPages - 1" @click="changePage(page + 1)">Next →</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { authHeaders } from "../utils/session";
import PhotoGallery from "../components/PhotoGallery.vue";

interface User { userId: string; displayName: string; firstName?: string; avatarUrl?: string }
interface Photo { id: number; channelId: string; url: string; score?: number; userVote?: string | null }

const SEARCH_MODE_KEY = "snek_search_mode";
const SEARCH_USER_KEY = "snek_search_user";
const SEARCH_SORT_KEY = "snek_search_sort";

const users = ref<User[]>([]);
const photos = ref<Photo[]>([]);
const total = ref<number | null>(null);
const loading = ref(false);
const filterMode = ref<"all" | "uploadedBy" | "taggedIn">(
  (sessionStorage.getItem(SEARCH_MODE_KEY) as any) ?? "all"
);
const filterUserId = ref(sessionStorage.getItem(SEARCH_USER_KEY) ?? "");
const sort = ref<"newest" | "oldest" | "top">(
  (sessionStorage.getItem(SEARCH_SORT_KEY) as any) ?? "newest"
);
const page = ref(0);
const pageSize = 100;
const totalPages = computed(() => Math.ceil((total.value ?? 0) / pageSize));

async function fetchPhotos() {
  sessionStorage.setItem(SEARCH_MODE_KEY, filterMode.value);
  sessionStorage.setItem(SEARCH_USER_KEY, filterUserId.value);
  sessionStorage.setItem(SEARCH_SORT_KEY, sort.value);
  loading.value = true;
  const params = new URLSearchParams({ sort: sort.value, page: String(page.value) });
  if (filterMode.value === "uploadedBy" && filterUserId.value) params.set("uploadedById", filterUserId.value);
  if (filterMode.value === "taggedIn" && filterUserId.value) params.set("taggedUserId", filterUserId.value);
  const res = await fetch(`/api/photos/search?${params}`, { headers: authHeaders() });
  if (res.ok) {
    const data = await res.json();
    photos.value = data.photos;
    total.value = data.total;
  }
  loading.value = false;
}

function onFilterModeChange() {
  filterUserId.value = "";
  resetAndFetch();
}

function resetAndFetch() { page.value = 0; fetchPhotos(); }
function changePage(p: number) { page.value = p; fetchPhotos(); window.scrollTo(0, 0); }

onMounted(async () => {
  const res = await fetch("/api/site-users", { headers: authHeaders() });
  if (res.ok) users.value = await res.json();
  fetchPhotos();
});
</script>
