<template>
  <p v-if="loading" class="rv-loading">Loading…</p>
  <div v-else-if="!review" class="rv-empty">
    <h2>Review not found</h2>
    <p><router-link to="/reviews">Back to all reviews</router-link></p>
  </div>
  <article v-else class="rv-detail">
    <div>
      <ReviewCover :image-url="review.imageUrl" :icon="review.typeIcon" :title="review.title" large />
      <a v-if="review.wikiTitle" class="rv-wikilink" :href="`https://en.wikipedia.org/wiki/${encodeURIComponent(review.wikiTitle.replace(/ /g, '_'))}`" target="_blank" rel="noopener noreferrer">
        Wikipedia: {{ review.wikiTitle }} ↗
      </a>
    </div>
    <div>
      <TypeChip :name="review.typeName" :icon="review.typeIcon" :color="review.typeColor" with-icon />
      <h1 class="rv-detail-title">{{ review.title }}</h1>
      <p v-if="creditLine(review)" class="rv-credit rv-credit--large">{{ creditLine(review) }}</p>
      <div class="rv-detail-meta">
        <StarRating :model-value="review.rating" />
        <span class="rv-progress" :class="`rv-progress--${review.progress}`" style="font-size: 0.95rem">{{ progressLabel(review.progress) }}</span>
      </div>
      <div class="rv-byline">
        <img v-if="review.authorAvatarUrl" :src="review.authorAvatarUrl" class="rv-avatar rv-avatar--large" alt="" />
        <span v-else class="rv-avatar rv-avatar--large">{{ authorName(review)[0] }}</span>
        <span>
          Reviewed by <router-link :to="`/reviews/people/${review.userId}`"><strong>{{ authorName(review) }}</strong></router-link> · {{ formatReviewDate(review.createdAt) }}
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
import { progressLabel, creditLine, authorName, formatReviewDate, type Review } from "./api";
import ReviewCover from "./ReviewCover.vue";
import StarRating from "./StarRating.vue";
import TypeChip from "./TypeChip.vue";

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
