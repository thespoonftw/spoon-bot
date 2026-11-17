<template>
  <p v-if="loading" class="rv-loading">Loading…</p>
  <div v-else-if="!review" class="rv-empty">
    <h2>Review not found</h2>
    <p><router-link to="/reviews">Back to all reviews</router-link></p>
  </div>
  <article v-else class="rv-detail">
    <div>
      <ReviewCover :image-url="review.imageUrl" :icon="review.typeIcon" :title="review.title" large />
      <a v-if="source" class="rv-wikilink" :href="source.url" target="_blank" rel="noopener noreferrer">
        {{ source.name }}<template v-if="review.wikiTitle">: {{ review.wikiTitle }}</template> ↗
      </a>
    </div>
    <div>
      <div class="rv-detail-head">
        <h1 class="rv-detail-title">{{ review.title }}<span v-if="review.year" class="rv-detail-year">{{ review.year }}</span></h1>
        <TypeChip class="rv-detail-type" :name="review.typeName" :icon="review.typeIcon" :color="review.typeColor" />
      </div>
      <!-- A drink's location links to the map when it was picked from the place search. -->
      <p v-if="credits && review.location && review.locationUrl && credits === `at ${review.location}`" class="rv-credit rv-credit--large">
        at <a class="rv-credit-link" :href="review.locationUrl" target="_blank" rel="noopener noreferrer">{{ review.location }}</a>
      </p>
      <p v-else-if="credits" class="rv-credit rv-credit--large">{{ credits }}</p>
      <div class="rv-detail-meta">
        <StarRating :model-value="review.rating" :full="review.fullStars" :quarter="review.quarterStars" />
        <span v-if="hasProgress(review.typeName)" class="rv-progress" :class="`rv-progress--${review.progress}`" style="font-size: 0.95rem">{{ progressLabel(review.progress) }}</span>
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
      <div v-if="review.visitors?.length" class="rv-visitors">
        <span class="rv-visitors-label">Visited by</span>
        <router-link v-for="v in review.visitors" :key="v.userId" :to="`/reviews/people/${v.userId}`" class="rv-visitor" :title="`Visited ${formatReviewDate(v.visitedAt).toLowerCase()}`">
          <img v-if="v.avatarUrl" :src="v.avatarUrl" class="rv-avatar" alt="" />
          <span v-else class="rv-avatar">{{ (v.firstName || v.displayName)[0] }}</span>
          <span>{{ v.firstName || v.displayName }}</span>
        </router-link>
      </div>
      <div class="rv-actions">
        <router-link v-if="review.canEdit" :to="`/reviews/${review.id}/edit`" class="rv-btn rv-btn--ghost rv-btn--small">Edit</router-link>
        <!-- Someone else's review: offer theirs, or a new one pre-filled with the same thing. -->
        <router-link v-else-if="review.myReviewId" :to="`/reviews/${review.myReviewId}`" class="rv-btn rv-btn--small">See your review of this</router-link>
        <router-link v-else :to="`/reviews/new?from=${review.id}`" class="rv-btn rv-btn--small">✎ Write your own review for this</router-link>
        <button v-if="review.canDelete" class="rv-btn rv-btn--danger rv-btn--small" :disabled="deleting" @click="remove">Delete</button>
      </div>
    </div>
  </article>

  <section v-if="review?.others?.length" class="rv-others">
    <h2 class="rv-others-title">Other reviews for this</h2>
    <div class="rv-feed">
      <router-link v-for="o in review.others" :key="o.id" :to="`/reviews/${o.id}`" class="rv-card">
        <div class="rv-card-body">
          <div class="rv-card-rating">
            <StarRating :model-value="o.rating" :full="o.fullStars" :quarter="o.quarterStars" />
            <span v-if="hasProgress(o.typeName)" class="rv-progress" :class="`rv-progress--${o.progress}`">{{ progressLabel(o.progress) }}</span>
          </div>
          <p v-if="o.summary" class="rv-card-summary">{{ o.summary }}</p>
          <p v-if="o.hasBody" class="rv-card-more">Read the full review.</p>
          <div class="rv-card-foot">
            <img v-if="o.authorAvatarUrl" :src="o.authorAvatarUrl" class="rv-avatar" alt="" />
            <span v-else class="rv-avatar">{{ authorName(o)[0] }}</span>
            <span>{{ authorName(o) }}</span>
            <span class="rv-card-date">{{ formatReviewDate(o.createdAt) }}</span>
          </div>
        </div>
      </router-link>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { getCached, setCached, clearReviewCache, progressLabel, hasProgress, cardCredit, matchSource, authorName, formatReviewDate, type Review } from "./api";
import ReviewCover from "./ReviewCover.vue";
import StarRating from "./StarRating.vue";
import TypeChip from "./TypeChip.vue";

const route = useRoute();
const router = useRouter();
// Shown straight from the session cache when this review has been opened before.
const review = ref<Review | null>(getCached<Review>(`review:${route.params.id}`) ?? null);
const loading = ref(!review.value);
const deleting = ref(false);
const source = computed(() => review.value ? matchSource(review.value) : null);
// The same line as under the title on the feed cards ("by Daft Punk", "for Nintendo Switch", "Season 2").
const credits = computed(() => review.value ? cardCredit(review.value) : null);

onMounted(async () => {
  // Every opening counts as a visit (only someone else's first one is kept), and brings back the
  // current list of visitors, so it's fresh even when the review came from the cache.
  const id = route.params.id;
  const visit = fetch(`/api/reviews/${id}/visit`, { method: "POST" })
    .then(res => res.ok ? res.json() as Promise<{ visitors: Review["visitors"] }> : null).catch(() => null);
  if (!review.value) {
    const res = await fetch(`/api/reviews/${id}`);
    if (res.ok) review.value = await res.json();
    loading.value = false;
  }
  const visited = await visit;
  if (review.value && visited) review.value = { ...review.value, visitors: visited.visitors };
  if (review.value) setCached(`review:${id}`, review.value);
});

async function remove() {
  if (!review.value || !window.confirm(`Delete ${review.value.canEdit ? "your" : `${authorName(review.value)}'s`} review of "${review.value.title}"?`)) return;
  deleting.value = true;
  const res = await fetch(`/api/reviews/${review.value.id}`, { method: "DELETE" });
  if (res.ok) { clearReviewCache(); router.push("/reviews"); }
  else { deleting.value = false; window.alert("Couldn't delete the review."); }
}
</script>
