<template>
  <div class="page">
    <router-link to="/" class="back">← Home</router-link>
    <h1>Search Photos</h1>

    <div class="search-filters">
      <div class="search-filters-row">
        <span class="search-filter-label">Filter By:</span>
        <select v-model="filterMode" @change="onFilterModeChange">
          <option value="all">All Photos</option>
          <option value="uploadedBy">Uploaded By</option>
          <option value="taggedIn">Tagging</option>
        </select>
        <select v-if="filterMode !== 'all'" v-model="filterUserId" @change="resetAndFetch">
          <option v-for="u in users" :key="u.userId" :value="u.userId">{{ u.firstName || u.displayName }}</option>
        </select>
        <span class="search-count" v-if="total !== null">{{ total }} result{{ total === 1 ? '' : 's' }}</span>
      </div>
      <div class="search-filters-row">
        <span class="search-filter-label">Sort By:</span>
        <select v-model="sort" @change="resetAndFetch">
          <option value="top">Highest rated</option>
          <option value="newest">Newest upload</option>
          <option value="oldest">Oldest upload</option>
          <option value="newest_taken">Newest taken</option>
          <option value="oldest_taken">Oldest taken</option>
        </select>
      </div>
    </div>

    <div v-if="loading && !photos.length" class="empty">Loading…</div>
    <div v-else-if="!photos.length" class="empty">No photos found.</div>

    <PhotoGallery v-if="photos.length" :sections="[{ label: '', photos }]" :members="users" :album-map="albumMap"
      :can-load-more="photos.length < (total ?? 0)" @load-more="loadMore" />

    <div class="search-show-more" v-if="photos.length < (total ?? 0)">
      <button class="btn-secondary" @click="loadMore" :disabled="loading">
        {{ loading ? 'Loading…' : 'Show more' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { authHeaders } from "../utils/session";
import PhotoGallery from "../components/PhotoGallery.vue";

interface User { userId: string; displayName: string; firstName?: string; avatarUrl?: string }
interface Photo { id: number; channelId: string; url: string; score?: number; userVote?: string | null }
interface AlbumInfo { location?: string; startDate?: string; endDate?: string }

const SEARCH_MODE_KEY = "snek_search_mode";
const SEARCH_USER_KEY = "snek_search_user";
const SEARCH_SORT_KEY = "snek_search_sort";
const PAGE_SIZE = 40;

const users = ref<User[]>([]);
const photos = ref<Photo[]>([]);
const total = ref<number | null>(null);
const loading = ref(false);
const appending = ref(false);
const currentUserId = ref("");
const albumMap = ref<Record<string, AlbumInfo>>({});
const filterMode = ref<"all" | "uploadedBy" | "taggedIn">(
  (sessionStorage.getItem(SEARCH_MODE_KEY) as any) ?? "all"
);
const filterUserId = ref(sessionStorage.getItem(SEARCH_USER_KEY) ?? "");
const sort = ref<"newest" | "oldest" | "top" | "newest_taken" | "oldest_taken">(
  (sessionStorage.getItem(SEARCH_SORT_KEY) as any) ?? "top"
);
const page = ref(0);

async function fetchPhotos(append = false) {
  sessionStorage.setItem(SEARCH_MODE_KEY, filterMode.value);
  sessionStorage.setItem(SEARCH_USER_KEY, filterUserId.value);
  sessionStorage.setItem(SEARCH_SORT_KEY, sort.value);
  loading.value = true;
  const params = new URLSearchParams({ sort: sort.value, page: String(page.value), pageSize: String(PAGE_SIZE) });
  if (filterMode.value === "uploadedBy" && filterUserId.value) params.set("uploadedById", filterUserId.value);
  if (filterMode.value === "taggedIn" && filterUserId.value) params.set("taggedUserId", filterUserId.value);
  const res = await fetch(`/api/photos/search?${params}`, { headers: authHeaders() });
  if (res.ok) {
    const data = await res.json();
    photos.value = append ? [...photos.value, ...data.photos] : data.photos;
    total.value = data.total;
  }
  loading.value = false;
}

function onFilterModeChange() {
  filterUserId.value = filterMode.value !== "all" ? currentUserId.value : "";
  resetAndFetch();
}

function resetAndFetch() { page.value = 0; fetchPhotos(false); }

async function loadMore() {
  if (appending.value) return;
  appending.value = true;
  page.value++;
  await fetchPhotos(true);
  appending.value = false;
}

onMounted(async () => {
  const [usersRes, authRes, albumsRes] = await Promise.all([
    fetch("/api/site-users", { headers: authHeaders() }),
    fetch("/api/auth/check", { headers: authHeaders() }),
    fetch("/api/albums"),
  ]);
  if (usersRes.ok) users.value = await usersRes.json();
  if (authRes.ok) {
    const { userId } = await authRes.json();
    currentUserId.value = userId ?? "";
    if (filterMode.value !== "all" && !filterUserId.value) {
      filterUserId.value = currentUserId.value;
    }
  }
  if (albumsRes.ok) {
    const albums: { channelId: string; location?: string; startDate?: string; endDate?: string }[] = await albumsRes.json();
    albumMap.value = Object.fromEntries(albums.map(a => [a.channelId, { location: a.location, startDate: a.startDate, endDate: a.endDate }]));
  }
  fetchPhotos(false);
});
</script>
