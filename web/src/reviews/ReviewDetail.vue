<template>
  <p v-if="loading" class="rv-loading">Loading…</p>
  <div v-else-if="!review" class="rv-empty">
    <h2>Review not found</h2>
    <p><router-link to="/reviews">Back to all reviews</router-link></p>
  </div>
  <article v-else class="rv-detail">
    <div>
      <ReviewCover :image-url="review.imageUrl" :media-type="review.mediaType" :title="review.title" large />
      <a v-if="review.wikiTitle" class="rv-wikilink" :href="`https://en.wikipedia.org/wiki/${encodeURIComponent(review.wikiTitle.replace(/ /g, '_'))}`" target="_blank" rel="noopener noreferrer">
        Wikipedia: {{ review.wikiTitle }} ↗
      </a>
    </div>
    <div>
      <span class="rv-type" :class="`rv-type--${review.mediaType}`">{{ mediaIcon(review.mediaType) }} {{ mediaLabel(review.mediaType) }}</span>
      <h1 class="rv-detail-title">{{ review.title }}</h1>
      <div class="rv-detail-meta">
        <StarRating :model-value="review.rating" />
        <span class="rv-progress" :class="`rv-progress--${review.progress}`" style="font-size: 0.95rem">{{ progressLabel(review.progress) }}</span>
      </div>
      <div class="rv-byline">
        <img v-if="review.authorAvatarUrl" :src="review.authorAvatarUrl" class="rv-avatar rv-avatar--large" alt="" />
        <span v-else class="rv-avatar rv-avatar--large">{{ authorName(review)[0] }}</span>
        <span>
          Reviewed by <strong>{{ authorName(review) }}</strong> · {{ formatReviewDate(review.createdAt) }}
          <template v-if="review.updatedAt !== review.createdAt"> · edited {{ formatReviewDate(review.updatedAt).toLowerCase() }}</template>
        </span>
      </div>
      <blockquote v-if="review.summary" class="rv-pullquote">{{ review.summary }}</blockquote>
      <!-- bodyHtml is sanitised server-side on save (src/reviews.ts) -->
      <div v-if="review.bodyHtml" class="rv-prose" v-html="review.bodyHtml"></div>
      <div v-if="review.canEdit" class="rv-actions">
        <router-link :to="`/reviews/${review.id}/edit`" class="rv-btn rv-btn--ghost rv-btn--small">Edit</router-link>
        <button class="rv-btn rv-btn--danger rv-btn--small" :disabled="deleting" @click="remove">Delete</button>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { mediaIcon, mediaLabel, progressLabel, authorName, formatReviewDate, type Review } from "./api";
import ReviewCover from "./ReviewCover.vue";
import StarRating from "./StarRating.vue";

const route = useRoute();
const router = useRouter();
const review = ref<Review | null>(null);
const loading = ref(true);
const deleting = ref(false);

onMounted(async () => {
  const res = await fetch(`/api/reviews/${route.params.id}`);
  if (res.ok) review.value = await res.json();
  loading.value = false;
});

async function remove() {
  if (!review.value || !window.confirm(`Delete your review of "${review.value.title}"?`)) return;
  deleting.value = true;
  const res = await fetch(`/api/reviews/${review.value.id}`, { method: "DELETE" });
  if (res.ok) router.push("/reviews");
  else { deleting.value = false; window.alert("Couldn't delete the review."); }
}
</script>
