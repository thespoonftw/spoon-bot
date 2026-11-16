<template>
  <div class="page">
    <PageHeader back-to="/archives" title="Search Photos" />

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
          <option value="ofMe">Photos of Me</option>
          <option value="uploadedBy">Uploaded By</option>
          <option v-if="TAGGING_ENABLED" value="taggedIn">Tagging</option>
        </select>
        <UserSelect v-if="filterMode === 'uploadedBy' || filterMode === 'taggedIn'" v-model="filterUserId" :users="pickerUsers" @change="resetAndFetch" />
        <span class="search-count" v-if="total !== null && !showOptIn">{{ total }} result{{ total === 1 ? '' : 's' }}</span>
        <div class="search-sort-group" v-if="!showOptIn">
          <span class="search-filter-label">Sort By:</span>
          <select v-model="sort" @change="resetAndFetch">
            <option v-if="query || filterMode === 'ofMe'" value="relevance">Best match</option>
            <option value="top">Highest rated</option>
            <option value="newest">Newest upload</option>
            <option value="oldest">Oldest upload</option>
            <option value="newest_taken">Newest taken</option>
            <option value="oldest_taken">Oldest taken</option>
          </select>
        </div>
      </div>
      <template v-if="filterMode === 'ofMe' && faces?.optedIn">
        <div class="faces-bar">
          <span>Matching your face from {{ faces.selfies }} selfie{{ faces.selfies === 1 ? '' : 's' }}.</span>
          <button v-if="faces.selfies < faces.maxSelfies" type="button" class="faces-link" :disabled="selfieBusy" @click="pickSelfies">
            {{ selfieBusy ? 'Adding…' : 'Add another' }}</button>
          <button type="button" class="faces-link" :disabled="selfieBusy" @click="optOut">Turn off</button>
        </div>
        <div v-if="scanNote" class="smart-search-note">{{ scanNote }}</div>
        <div v-if="selfieError" class="faces-error">{{ selfieError }}</div>
      </template>
    </div>

    <input ref="selfieInput" type="file" accept="image/*" multiple hidden @change="onSelfiesPicked" />

    <div v-if="showOptIn" class="faces-optin">
      <h2>Find the photos you're in</h2>
      <p>Add a selfie or two and we'll find every photo in the archives with your face in it.</p>
      <ul>
        <li>It's off until you turn it on, and only you can search for your own face.</li>
        <li>Your selfies aren't saved. We keep a face fingerprint (a list of numbers) made from each one.</li>
        <li>Turning it off deletes those fingerprints straight away.</li>
      </ul>
      <p class="faces-tip">For the best results, use clear photos of just you, taken straight on in good light. A few different ones (glasses on and off, different days) help.</p>
      <button class="btn-primary" :disabled="selfieBusy || !faces" @click="pickSelfies">{{ selfieBusy ? 'Checking your selfie…' : 'Add selfies and turn on' }}</button>
      <div v-if="selfieError" class="faces-error">{{ selfieError }}</div>
    </div>

    <template v-else>
    <div v-if="loading && !photos.length" class="empty">Loading…</div>
    <div v-else-if="searchError" class="empty">{{ searchError }}</div>
    <div v-else-if="!photos.length" class="empty">{{ emptyText }}</div>

    <PhotoGallery v-if="photos.length" :sections="[{ label: '', photos }]" :members="users" :album-map="albumMap"
      :can-load-more="photos.length < (total ?? 0)" :total-count="total ?? undefined" @load-more="loadMore" />

    <div class="search-show-more" v-if="photos.length < (total ?? 0)">
      <button class="btn-secondary" @click="loadMore" :disabled="loading">
        {{ loading ? 'Loading…' : 'Show more' }}
      </button>
    </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { authHeaders } from "../utils/session";
import { TAGGING_ENABLED } from "../utils/features";
import PhotoGallery from "../components/PhotoGallery.vue";
import UserSelect from "../components/UserSelect.vue";
import PageHeader from "../components/PageHeader.vue";

interface User { userId: string; displayName: string; firstName?: string; avatarUrl?: string; uploadCount?: number }
interface Photo { id: number; channelId: string; url: string; score?: number; userVote?: string | null }
interface AlbumInfo { groupName?: string; locations?: { id: number; name: string }[]; startDate?: string; endDate?: string }

const SEARCH_MODE_KEY = "snek_search_mode";
const SEARCH_USER_KEY = "snek_search_user";
const SEARCH_SORT_KEY = "snek_search_sort";
const SEARCH_QUERY_KEY = "snek_search_query";
const PAGE_SIZE = 40;

const users = ref<User[]>([]);
// "Uploaded By" only lists people who have uploaded something.
const pickerUsers = computed(() =>
  filterMode.value === "uploadedBy" ? users.value.filter(u => (u.uploadCount ?? 0) > 0) : users.value);
// Who the person picker starts on: you, if you're in its list; otherwise nobody (all photos).
const defaultFilterUser = () =>
  pickerUsers.value.some(u => u.userId === currentUserId.value) ? currentUserId.value : "";
const photos = ref<Photo[]>([]);
const total = ref<number | null>(null);
const loading = ref(false);
const appending = ref(false);
const currentUserId = ref("");
const albumMap = ref<Record<string, AlbumInfo>>({});
type FilterMode = "all" | "ofMe" | "uploadedBy" | "taggedIn";
const savedMode = sessionStorage.getItem(SEARCH_MODE_KEY) as FilterMode | null;
const filterMode = ref<FilterMode>(
  savedMode === "taggedIn" && !TAGGING_ENABLED ? "all" : savedMode ?? "all"
);
const filterUserId = ref(sessionStorage.getItem(SEARCH_USER_KEY) ?? "");
const query = ref(sessionStorage.getItem(SEARCH_QUERY_KEY) ?? "");
const queryInput = ref(query.value);
const sort = ref<"newest" | "oldest" | "top" | "newest_taken" | "oldest_taken" | "relevance">(
  (sessionStorage.getItem(SEARCH_SORT_KEY) as any) ?? "top"
);
if (sort.value === "relevance" && !query.value && filterMode.value !== "ofMe") sort.value = "top";
const page = ref(0);
const searchError = ref("");
const smartStatus = ref<{ indexed: number; total: number } | null>(null);
// Old photos are processed in the background after launch, so say so while that's still going.
const indexingNote = computed(() => {
  const s = smartStatus.value;
  if (!s || s.indexed >= s.total) return "";
  return `Smart search is still learning what's in the photos (${s.indexed.toLocaleString()} of ${s.total.toLocaleString()} so far), so some matches may be missing.`;
});
// Photos of me: opt-in face matching (src/faces.ts on the server).
interface FaceStatus { optedIn: boolean; selfies: number; maxSelfies: number; ready: boolean; scanned: number; total: number }
const faces = ref<FaceStatus | null>(null);
const selfieInput = ref<HTMLInputElement | null>(null);
const selfieBusy = ref(false);
const selfieError = ref("");
const showOptIn = computed(() => filterMode.value === "ofMe" && !faces.value?.optedIn);
const scanNote = computed(() => {
  const f = faces.value;
  if (!f || f.scanned >= f.total) return "";
  return `Still looking for faces in the archives (${f.scanned.toLocaleString()} of ${f.total.toLocaleString()} photos so far), so some of yours may be missing.`;
});
const emptyText = computed(() => {
  if (filterMode.value === "ofMe") return query.value ? `No photos of you and “${query.value}” found.` : "We haven't found any photos of you yet.";
  return query.value ? `No photos of “${query.value}” found.` : "No photos found.";
});

async function fetchFaces() {
  const res = await fetch("/api/faces/me", { headers: authHeaders() });
  if (res.ok) faces.value = await res.json();
}

function pickSelfies() {
  selfieError.value = "";
  selfieInput.value?.click();
}

async function onSelfiesPicked(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = "";
  if (!files.length) return;
  selfieBusy.value = true;
  selfieError.value = "";
  const wasOptedIn = !!faces.value?.optedIn;
  const problems: string[] = [];
  for (const file of files) {
    const res = await fetch("/api/faces/me/selfies", {
      method: "POST", headers: { ...authHeaders(), "Content-Type": file.type || "image/jpeg" }, body: file,
    }).catch(() => null);
    if (res?.ok) { faces.value = await res.json(); continue; }
    const msg: string | undefined = res ? (await res.json().catch(() => ({}))).error : undefined;
    problems.push(files.length > 1 ? `${file.name}: ${msg ?? "couldn't be added."}` : msg ?? "That selfie couldn't be added — try again.");
  }
  selfieError.value = problems.join(" ");
  selfieBusy.value = false;
  if (faces.value?.optedIn) {
    if (!wasOptedIn) sort.value = "relevance";
    resetAndFetch();
  }
}

async function optOut() {
  if (!confirm("Turn off Photos of Me? Your face fingerprints will be deleted, and you can turn it back on any time.")) return;
  const res = await fetch("/api/faces/me", { method: "DELETE", headers: authHeaders() });
  if (res.ok) faces.value = await res.json();
  selfieError.value = "";
  photos.value = [];
  total.value = null;
}

let fetchSeq = 0;

async function fetchPhotos(append = false) {
  sessionStorage.setItem(SEARCH_MODE_KEY, filterMode.value);
  sessionStorage.setItem(SEARCH_USER_KEY, filterUserId.value);
  sessionStorage.setItem(SEARCH_SORT_KEY, sort.value);
  sessionStorage.setItem(SEARCH_QUERY_KEY, query.value);
  const seq = ++fetchSeq;
  if (showOptIn.value) { photos.value = []; total.value = null; loading.value = false; return; }
  loading.value = true;
  const params = new URLSearchParams({ sort: sort.value, page: String(page.value), pageSize: String(PAGE_SIZE) });
  if (query.value) params.set("q", query.value);
  if (filterMode.value === "uploadedBy" && filterUserId.value) params.set("uploadedById", filterUserId.value);
  if (filterMode.value === "taggedIn" && filterUserId.value) params.set("taggedUserId", filterUserId.value);
  if (filterMode.value === "ofMe") params.set("me", "1");
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
  if (!q && sort.value === "relevance" && filterMode.value !== "ofMe") sort.value = "top";
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

async function onFilterModeChange() {
  const picksUser = filterMode.value === "uploadedBy" || filterMode.value === "taggedIn";
  filterUserId.value = picksUser ? defaultFilterUser() : "";
  selfieError.value = "";
  if (filterMode.value === "ofMe") {
    if (!query.value) sort.value = "relevance";
    await fetchFaces();
  } else if (sort.value === "relevance" && !query.value) sort.value = "top";
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
  }
  // A remembered pick may no longer be in the list (e.g. someone with no uploads).
  if ((filterMode.value === "uploadedBy" || filterMode.value === "taggedIn") && !pickerUsers.value.some(u => u.userId === filterUserId.value)) {
    filterUserId.value = defaultFilterUser();
  }
  if (albumsRes.ok) {
    const albums: { channelId: string; groupName: string; locations?: { id: number; name: string }[]; startDate?: string; endDate?: string }[] = await albumsRes.json();
    albumMap.value = Object.fromEntries(albums.map(a => [a.channelId, { groupName: a.groupName, locations: a.locations, startDate: a.startDate, endDate: a.endDate }]));
  }
  if (filterMode.value === "ofMe") await fetchFaces();
  fetchPhotos(false);
  if (query.value) fetchSmartStatus();
});
</script>

<style scoped>
.faces-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; color: #a6adc8; font-size: 0.85rem; }
.faces-link { background: none; border: none; padding: 0; color: #89b4fa; font-size: inherit; cursor: pointer; }
.faces-link:hover:not(:disabled) { text-decoration: underline; }
.faces-link:disabled { opacity: 0.6; cursor: default; }
.faces-error { color: #f38ba8; font-size: 0.85rem; margin-top: 10px; }
.faces-optin { max-width: 520px; margin: 24px auto; background: #313244; border-radius: 12px; padding: 20px 22px; color: #cdd6f4; }
.faces-optin h2 { margin: 0 0 8px; font-size: 1.15rem; }
.faces-optin p { margin: 0 0 12px; line-height: 1.45; }
.faces-optin ul { margin: 0 0 12px; padding-left: 20px; line-height: 1.5; color: #bac2de; font-size: 0.9rem; }
.faces-optin .faces-tip { color: #a6adc8; font-size: 0.85rem; }
</style>
