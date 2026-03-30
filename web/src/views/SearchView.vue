<template>
  <div class="page">
    <router-link to="/" class="back">← Home</router-link>
    <h1>Search Photos</h1>

    <div class="search-filters">
      <select v-model="uploadedById" @change="resetAndFetch">
        <option value="">Any uploader</option>
        <option v-for="u in users" :key="u.userId" :value="u.userId">{{ u.firstName || u.displayName }}</option>
      </select>
      <select v-model="taggedUserId" @change="resetAndFetch">
        <option value="">Any tagged</option>
        <option v-for="u in users" :key="u.userId" :value="u.userId">{{ u.firstName || u.displayName }}</option>
      </select>
      <select v-model="sort" @change="resetAndFetch">
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
        <option value="top">Highest rated</option>
      </select>
      <span class="search-count" v-if="total !== null">{{ total }} photo{{ total === 1 ? '' : 's' }}</span>
    </div>

    <div v-if="loading" class="empty">Loading…</div>
    <div v-else-if="!photos.length" class="empty">No photos found.</div>

    <div v-else class="gallery">
      <div v-for="photo in photos" :key="photo.id" class="photo-item" @click="goToAlbum(photo)">
        <img :src="thumbUrl(photo.url)" loading="lazy" @error="($event.target as HTMLImageElement).src = photo.url" />
        <div class="photo-votes" @click.stop>
          <button class="vote-btn vote-fav" :class="{ active: getVoteState(photo).userVote === 'fav' }" @click="doVote(photo, 'fav')" title="Favourite">⭐</button>
          <button class="vote-btn vote-up" :class="{ active: getVoteState(photo).userVote === 'up' || getVoteState(photo).userVote === 'fav' }" @click="doVote(photo, 'up')" title="Upvote">👍</button>
          <button class="vote-btn vote-score">{{ getVoteState(photo).score }}</button>
          <button class="vote-btn vote-down" :class="{ active: getVoteState(photo).userVote === 'down' }" @click="doVote(photo, 'down')" title="Downvote">👎</button>
        </div>
      </div>
    </div>

    <div class="search-pagination" v-if="total !== null && total > pageSize">
      <button :disabled="page === 0" @click="changePage(page - 1)">← Prev</button>
      <span>Page {{ page + 1 }} of {{ totalPages }}</span>
      <button :disabled="page >= totalPages - 1" @click="changePage(page + 1)">Next →</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { authHeaders, authJsonHeaders } from "../utils/session";

interface User { userId: string; displayName: string; firstName?: string }
interface Photo { id: number; channelId: string; url: string; score?: number; userVote?: string | null }

const router = useRouter();
const users = ref<User[]>([]);
const photos = ref<Photo[]>([]);
const total = ref<number | null>(null);
const loading = ref(false);
const uploadedById = ref("");
const taggedUserId = ref("");
const sort = ref<"newest" | "oldest" | "top">("newest");
const page = ref(0);
const pageSize = 100;
const votes = ref<Record<number, { score: number; userVote: string | null }>>({});

const totalPages = computed(() => Math.ceil((total.value ?? 0) / pageSize));

function thumbUrl(url: string): string { return url.replace("/uploads/", "/thumbnails/"); }
function goToAlbum(photo: Photo) { router.push(`/album/${photo.channelId}`); }
function getVoteState(photo: Photo) {
  return votes.value[photo.id] ?? { score: photo.score ?? 0, userVote: photo.userVote ?? null };
}

async function doVote(photo: Photo, voteType: string) {
  const res = await fetch(`/api/album/${photo.channelId}/photos/${photo.id}/vote`, {
    method: "POST", headers: authJsonHeaders(), body: JSON.stringify({ voteType }),
  });
  if (res.ok) {
    const { score, userVote } = await res.json();
    votes.value = { ...votes.value, [photo.id]: { score, userVote } };
  }
}

async function fetchPhotos() {
  loading.value = true;
  const params = new URLSearchParams({ sort: sort.value, page: String(page.value) });
  if (uploadedById.value) params.set("uploadedById", uploadedById.value);
  if (taggedUserId.value) params.set("taggedUserId", taggedUserId.value);
  const res = await fetch(`/api/photos/search?${params}`, { headers: authHeaders() });
  if (res.ok) {
    const data = await res.json();
    photos.value = data.photos;
    total.value = data.total;
    votes.value = {};
  }
  loading.value = false;
}

function resetAndFetch() { page.value = 0; fetchPhotos(); }
function changePage(p: number) { page.value = p; fetchPhotos(); window.scrollTo(0, 0); }

onMounted(async () => {
  const res = await fetch("/api/site-users", { headers: authHeaders() });
  if (res.ok) users.value = await res.json();
  fetchPhotos();
});
</script>
