<template>
  <div class="page">
    <PageHeader back-to="/photos" title="Search Photos" />

    <div class="search-filters">
      <form class="smart-search" @submit.prevent="submitQuery">
        <input v-model="queryInput" type="search" placeholder="Search for anything… a cat, the beach, birthday cake"
          enterkeyhint="search" maxlength="200" @input="onQueryInput" />
        <button v-if="queryInput" type="button" class="smart-search-clear" aria-label="Clear search" @click="clearQuery">×</button>
      </form>
      <div v-if="query && indexingNote" class="smart-search-note">{{ indexingNote }}</div>
      <div class="search-filters-row">
        <span class="search-filter-label">Filter By:</span>
        <select v-model="filterMode" @change="onFilterModeChange">
          <option value="all">All Photos</option>
          <option value="uploadedBy">Uploaded By</option>
          <option v-if="TAGGING_ENABLED" value="taggedIn">Tagging</option>
        </select>
        <select v-if="filterMode !== 'all'" v-model="filterUserId" @change="resetAndFetch">
          <option v-for="u in sortedUsers" :key="u.userId" :value="u.userId">{{ dropdownName(u, users) }}</option>
        </select>
        <span class="search-count" v-if="total !== null">{{ total }} result{{ total === 1 ? '' : 's' }}</span>
        <div class="search-sort-group">
          <span class="search-filter-label">Sort By:</span>
          <select v-model="sort" @change="resetAndFetch">
            <option v-if="query" value="relevance">Best match</option>
            <option value="top">Highest rated</option>
            <option value="newest">Newest upload</option>
            <option value="oldest">Oldest upload</option>
            <option value="newest_taken">Newest taken</option>
            <option value="oldest_taken">Oldest taken</option>
          </select>
        </div>
      </div>
    </div>

    <div v-if="loading && !photos.length" class="empty">Loading…</div>
    <div v-else-if="searchError" class="empty">{{ searchError }}</div>
    <div v-else-if="!photos.length" class="empty">{{ query ? `No photos of “${query}” found.` : 'No photos found.' }}</div>

    <PhotoGallery v-if="photos.length" :sections="[{ label: '', photos }]" :members="users" :album-map="albumMap"
      :can-load-more="photos.length < (total ?? 0)" :total-count="total ?? undefined" @load-more="loadMore" />

    <div class="search-show-more" v-if="photos.length < (total ?? 0)">
      <button class="btn-secondary" @click="loadMore" :disabled="loading">
        {{ loading ? 'Loading…' : 'Show more' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { authHeaders } from "../utils/session";
import { dropdownName, sortByName } from "../utils/names";
import { TAGGING_ENABLED } from "../utils/features";
import PhotoGallery from "../components/PhotoGallery.vue";
import PageHeader from "../components/PageHeader.vue";

interface User { userId: string; displayName: string; firstName?: string; surname?: string; avatarUrl?: string }
interface Photo { id: number; channelId: string; url: string; score?: number; userVote?: string | null }
interface AlbumInfo { groupName?: string; locations?: { id: number; name: string }[]; startDate?: string; endDate?: string }

const SEARCH_MODE_KEY = "snek_search_mode";
const SEARCH_USER_KEY = "snek_search_user";
const SEARCH_SORT_KEY = "snek_search_sort";
const SEARCH_QUERY_KEY = "snek_search_query";
const PAGE_SIZE = 40;

const users = ref<User[]>([]);
const sortedUsers = computed(() => sortByName(users.value));
const photos = ref<Photo[]>([]);
const total = ref<number | null>(null);
const loading = ref(false);
const appending = ref(false);
const currentUserId = ref("");
const albumMap = ref<Record<string, AlbumInfo>>({});
const savedMode = sessionStorage.getItem(SEARCH_MODE_KEY) as "all" | "uploadedBy" | "taggedIn" | null;
const filterMode = ref<"all" | "uploadedBy" | "taggedIn">(
  savedMode === "taggedIn" && !TAGGING_ENABLED ? "all" : savedMode ?? "all"
);
const filterUserId = ref(sessionStorage.getItem(SEARCH_USER_KEY) ?? "");
const query = ref(sessionStorage.getItem(SEARCH_QUERY_KEY) ?? "");
const queryInput = ref(query.value);
const sort = ref<"newest" | "oldest" | "top" | "newest_taken" | "oldest_taken" | "relevance">(
  (sessionStorage.getItem(SEARCH_SORT_KEY) as any) ?? "top"
);
if (sort.value === "relevance" && !query.value) sort.value = "top";
const page = ref(0);
const searchError = ref("");
const smartStatus = ref<{ indexed: number; total: number } | null>(null);
// Old photos are processed in the background after launch, so say so while that's still going.
const indexingNote = computed(() => {
  const s = smartStatus.value;
  if (!s || s.indexed >= s.total) return "";
  return `Smart search is still learning what's in the photos (${s.indexed.toLocaleString()} of ${s.total.toLocaleString()} so far), so some matches may be missing.`;
});
let fetchSeq = 0;

async function fetchPhotos(append = false) {
  sessionStorage.setItem(SEARCH_MODE_KEY, filterMode.value);
  sessionStorage.setItem(SEARCH_USER_KEY, filterUserId.value);
  sessionStorage.setItem(SEARCH_SORT_KEY, sort.value);
  sessionStorage.setItem(SEARCH_QUERY_KEY, query.value);
  const seq = ++fetchSeq;
  loading.value = true;
  const params = new URLSearchParams({ sort: sort.value, page: String(page.value), pageSize: String(PAGE_SIZE) });
  if (query.value) params.set("q", query.value);
  if (filterMode.value === "uploadedBy" && filterUserId.value) params.set("uploadedById", filterUserId.value);
  if (filterMode.value === "taggedIn" && filterUserId.value) params.set("taggedUserId", filterUserId.value);
  const res = await fetch(`/api/photos/search?${params}`, { headers: authHeaders() });
  if (seq !== fetchSeq) return; // a newer search has started; drop this one's results
  if (res.ok) {
    const data = await res.json();
    photos.value = append ? [...photos.value, ...data.photos] : data.photos;
    total.value = data.total;
    searchError.value = "";
  } else if (!append) {
    photos.value = [];
    total.value = null;
    searchError.value = res.status === 503 ? "Smart search is still starting up — try again in a minute." : "Search failed.";
  }
  loading.value = false;
}

let queryTimer: ReturnType<typeof setTimeout> | undefined;
function onQueryInput() {
  clearTimeout(queryTimer);
  queryTimer = setTimeout(submitQuery, 500);
}

function submitQuery() {
  clearTimeout(queryTimer);
  const q = queryInput.value.trim();
  if (q === query.value) return;
  const hadQuery = !!query.value;
  query.value = q;
  // Searching for something defaults to best match first; clearing it goes back to the usual sort.
  if (q && !hadQuery) sort.value = "relevance";
  if (!q && sort.value === "relevance") sort.value = "top";
  if (q) fetchSmartStatus();
  resetAndFetch();
}

function clearQuery() {
  queryInput.value = "";
  submitQuery();
}

async function fetchSmartStatus() {
  const res = await fetch("/api/photos/smart-search-status", { headers: authHeaders() });
  if (res.ok) smartStatus.value = await res.json();
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
    fetch("/api/site-users?associated=1", { headers: authHeaders() }),
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
    const albums: { channelId: string; groupName: string; locations?: { id: number; name: string }[]; startDate?: string; endDate?: string }[] = await albumsRes.json();
    albumMap.value = Object.fromEntries(albums.map(a => [a.channelId, { groupName: a.groupName, locations: a.locations, startDate: a.startDate, endDate: a.endDate }]));
  }
  fetchPhotos(false);
  if (query.value) fetchSmartStatus();
});
</script>
