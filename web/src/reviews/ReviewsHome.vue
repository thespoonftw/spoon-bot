<template>
  <div>
    <nav v-if="filterTypes.length > 1" class="rv-filters">
      <button :class="{ active: !typeId }" @click="setType(null)">All</button>
      <button v-for="t in filterTypes" :key="t.id" :class="{ active: typeId === t.id }" @click="setType(t.id)">{{ t.icon }} {{ t.name }}</button>
    </nav>

    <p v-if="loading && !reviews.length" class="rv-loading">Fetching the latest…</p>
    <p v-else-if="error" class="rv-error">{{ error }}</p>

    <div v-else-if="!reviews.length" class="rv-empty">
      <h2>Nothing here yet</h2>
      <p>Be the first to review {{ activeType ? `something in ${activeType.name}` : "something" }}.</p>
      <p style="margin-top: 18px"><router-link to="/reviews/new" class="rv-btn">✎ Write a review</router-link></p>
    </div>

    <div v-else class="rv-feed">
      <router-link v-for="r in reviews" :key="r.id" :to="`/reviews/${r.id}`" class="rv-card">
        <ReviewCover :image-url="r.imageUrl" :icon="r.typeIcon" :title="r.title" />
        <div class="rv-card-body">
          <h3 class="rv-card-title">{{ r.title }}<span v-if="r.year" class="rv-card-year">{{ r.year }}</span></h3>
          <p v-if="r.season != null" class="rv-credit">Season {{ r.season }}</p>
          <StarRating :model-value="r.rating" />
          <p v-if="r.summary" class="rv-card-summary">{{ r.summary }}</p>
          <div class="rv-card-foot">
            <img v-if="r.authorAvatarUrl" :src="r.authorAvatarUrl" class="rv-avatar" alt="" />
            <span v-else class="rv-avatar">{{ authorName(r)[0] }}</span>
            <span>{{ authorName(r) }} · {{ formatReviewDate(r.createdAt) }}</span>
            <TypeChip class="rv-card-type" :name="r.typeName" :icon="r.typeIcon" :color="r.typeColor" />
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
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { authorName, formatReviewDate, fetchReviewTypes, type Review, type ReviewType } from "./api";
import ReviewCover from "./ReviewCover.vue";
import StarRating from "./StarRating.vue";
import TypeChip from "./TypeChip.vue";

const PAGE = 30;
const route = useRoute();
const router = useRouter();
const typeId = ref<number | null>(parseInt(route.query.type as string) || null);
const types = ref<ReviewType[]>([]);
const reviews = ref<Review[]>([]);
const total = ref(0);
const loading = ref(false);
const error = ref("");

// Only types that have reviews get a tab (plus the active one, so a filtered URL still shows its tab).
const filterTypes = computed(() => types.value.filter(t => t.reviewCount > 0 || t.id === typeId.value));
const activeType = computed(() => types.value.find(t => t.id === typeId.value) ?? null);

async function load(reset: boolean) {
  loading.value = true;
  error.value = "";
  const params = new URLSearchParams({ limit: String(PAGE), offset: String(reset ? 0 : reviews.value.length) });
  if (typeId.value) params.set("typeId", String(typeId.value));
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
function setType(id: number | null) {
  router.replace({ query: id ? { type: String(id) } : {} });
}

onMounted(async () => {
  await Promise.all([load(true), fetchReviewTypes().then(t => { types.value = t; })]);
});
</script>
