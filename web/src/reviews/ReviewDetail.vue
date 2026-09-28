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
      <!-- Year sits after the title (as on the feed cards), so it's left out of this line. -->
      <p v-if="credits" class="rv-credit rv-credit--large">{{ credits }}</p>
      <div class="rv-detail-meta">
        <StarRating :model-value="review.rating" with-label />
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
            <StarRating :model-value="o.rating" />
            <span v-if="hasProgress(o.typeName)" class="rv-progress" :class="`rv-progress--${o.progress}`">{{ progressLabel(o.progress) }}</span>
          </div>
          <p v-if="o.summary" class="rv-card-summary">{{ o.summary }}</p>
          <div class="rv-card-foot">
            <img v-if="o.authorAvatarUrl" :src="o.authorAvatarUrl" class="rv-avatar" alt="" />
            <span v-else class="rv-avatar">{{ authorName(o)[0] }}</span>
            <span>{{ authorName(o) }} · {{ formatReviewDate(o.createdAt) }}</span>
          </div>
        </div>
      </router-link>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { progressLabel, hasProgress, creditLine, matchSource, authorName, formatReviewDate, type Review } from "./api";
import ReviewCover from "./ReviewCover.vue";
import StarRating from "./StarRating.vue";
import TypeChip from "./TypeChip.vue";

const route = useRoute();
const router = useRouter();
const review = ref<Review | null>(null);
const loading = ref(true);
const deleting = ref(false);
const source = computed(() => review.value ? matchSource(review.value) : null);
const credits = computed(() => review.value ? creditLine({ ...review.value, year: null }) : "");

onMounted(async () => {
  const res = await fetch(`/api/reviews/${route.params.id}`);
  if (res.ok) review.value = await res.json();
  loading.value = false;
});

async function remove() {
  if (!review.value || !window.confirm(`Delete ${review.value.canEdit ? "your" : `${authorName(review.value)}'s`} review of "${review.value.title}"?`)) return;
  deleting.value = true;
  const res = await fetch(`/api/reviews/${review.value.id}`, { method: "DELETE" });
  if (res.ok) router.push("/reviews");
  else { deleting.value = false; window.alert("Couldn't delete the review."); }
}
</script>
