<template>
  <div>
    <nav class="rv-filters">
      <button :class="{ active: !type }" @click="setType(null)">All</button>
      <button v-for="m in MEDIA_TYPES" :key="m.value" :class="{ active: type === m.value }" @click="setType(m.value)">{{ m.plural }}</button>
    </nav>

    <p v-if="loading && !reviews.length" class="rv-loading">Fetching the latest…</p>
    <p v-else-if="error" class="rv-error">{{ error }}</p>

    <div v-else-if="!reviews.length" class="rv-empty">
      <h2>Nothing here yet</h2>
      <p>Be the first to review {{ type ? `a ${mediaLabel(type).toLowerCase()}` : "something" }}.</p>
      <p style="margin-top: 18px"><router-link to="/reviews/new" class="rv-btn">✎ Write a review</router-link></p>
    </div>

    <div v-else class="rv-feed">
      <router-link v-for="r in reviews" :key="r.id" :to="`/reviews/${r.id}`" class="rv-card">
        <ReviewCover :image-url="r.imageUrl" :media-type="r.mediaType" :title="r.title" />
        <div class="rv-card-body">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">
            <span class="rv-type" :class="`rv-type--${r.mediaType}`">{{ mediaLabel(r.mediaType) }}</span>
            <span class="rv-progress" :class="`rv-progress--${r.progress}`">{{ progressLabel(r.progress) }}</span>
          </div>
          <h3 class="rv-card-title">{{ r.title }}</h3>
          <StarRating :model-value="r.rating" />
          <p v-if="r.summary" class="rv-card-summary">{{ r.summary }}</p>
          <div class="rv-card-foot">
            <img v-if="r.authorAvatarUrl" :src="r.authorAvatarUrl" class="rv-avatar" alt="" />
            <span v-else class="rv-avatar">{{ authorName(r)[0] }}</span>
            <span>{{ authorName(r) }} · {{ formatReviewDate(r.createdAt) }}</span>
          </div>
        </div>
      </router-link>
    </div>

    <div v-if="reviews.length < total" class="rv-more">
      <button class="rv-btn rv-btn--ghost" :disabled="loading" @click="load(false)">{{ loading ? "Loading…" : "Load more" }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { MEDIA_TYPES, mediaLabel, progressLabel, authorName, formatReviewDate, type MediaType, type Review } from "./api";
import ReviewCover from "./ReviewCover.vue";
import StarRating from "./StarRating.vue";

const PAGE = 30;
const route = useRoute();
const router = useRouter();
const type = ref<MediaType | null>(MEDIA_TYPES.some(m => m.value === route.query.type) ? route.query.type as MediaType : null);
const reviews = ref<Review[]>([]);
const total = ref(0);
const loading = ref(false);
const error = ref("");

async function load(reset: boolean) {
  loading.value = true;
  error.value = "";
  const params = new URLSearchParams({ limit: String(PAGE), offset: String(reset ? 0 : reviews.value.length) });
  if (type.value) params.set("type", type.value);
  try {
    const res = await fetch(`/api/reviews?${params}`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    reviews.value = reset ? data.reviews : [...reviews.value, ...data.reviews];
    total.value = data.total;
  } catch {
    error.value = "Couldn't load reviews — try refreshing.";
  }
  loading.value = false;
}

// The filter lives in the URL so back/refresh keep it; the layout re-mounts this view on URL change.
function setType(t: MediaType | null) {
  router.replace({ query: t ? { type: t } : {} });
}

onMounted(() => load(true));
</script>
