<template>
  <p v-if="loading" class="rv-loading">Loading…</p>
  <div v-else-if="!profile" class="rv-empty">
    <h2>Person not found</h2>
    <p><router-link to="/reviews">Back to all reviews</router-link></p>
  </div>
  <div v-else>
    <div class="rv-profile-head">
      <img v-if="profile.user.avatarUrl" :src="profile.user.avatarUrl" class="rv-avatar rv-avatar--xl" alt="" />
      <span v-else class="rv-avatar rv-avatar--xl">{{ name[0] }}</span>
      <div>
        <h2 class="rv-section-title" style="margin: 0">{{ isMe ? "My reviews" : name }}</h2>
        <p class="rv-hint" style="font-size: 0.95rem; margin-top: 4px">
          {{ profile.reviews.length }} review{{ profile.reviews.length === 1 ? "" : "s" }}
          <template v-if="profile.reviews.length"> · average {{ average }} ★</template>
        </p>
      </div>
    </div>

    <div v-if="!profile.reviews.length" class="rv-empty">
      <p>{{ isMe ? "You haven't reviewed anything yet." : `${name} hasn't reviewed anything yet.` }}</p>
      <p v-if="isMe" style="margin-top: 18px"><router-link to="/reviews/new" class="rv-btn">✎ Write a review</router-link></p>
    </div>

    <section v-for="g in groups" :key="g.typeId" class="rv-profile-group">
      <h3 class="rv-profile-group-title">
        <TypeChip :name="g.typeName" :icon="g.typeIcon" :color="g.typeColor" with-icon />
        <span class="rv-muted">{{ g.reviews.length }}</span>
      </h3>
      <div class="rv-table-wrap">
        <table class="rv-table rv-table--clickable">
          <thead>
            <tr>
              <th v-for="c in COLUMNS" :key="c.key" :class="[c.cls, { sorted: sortKey === c.key }]" :aria-sort="sortKey === c.key ? (sortAsc ? 'ascending' : 'descending') : 'none'">
                <button type="button" @click="sortBy(c.key)">{{ c.label }}<span class="rv-sort-arrow">{{ sortKey === c.key ? (sortAsc ? "▲" : "▼") : "" }}</span></button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in g.reviews" :key="r.id" @click="router.push(`/reviews/${r.id}`)">
              <td class="rv-table-title"><router-link :to="`/reviews/${r.id}`" @click.stop>{{ r.title }}</router-link></td>
              <td class="rv-muted">{{ r.creator ?? "" }}</td>
              <td class="rv-muted num">{{ r.year ?? "" }}</td>
              <td><StarRating :model-value="r.rating" /></td>
              <td><span class="rv-progress" :class="`rv-progress--${r.progress}`">{{ progressLabel(r.progress) }}</span></td>
              <td class="rv-muted rv-nowrap">{{ formatReviewDate(r.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { fetchReviewProfile, progressLabel, formatReviewDate, PROGRESS_OPTIONS, type Review, type ReviewProfile } from "./api";
import { useCurrentUser } from "../composables/useCurrentUser";
import StarRating from "./StarRating.vue";
import TypeChip from "./TypeChip.vue";

type SortKey = "title" | "creator" | "year" | "rating" | "progress" | "createdAt";
const COLUMNS: { key: SortKey; label: string; cls?: string }[] = [
  { key: "title", label: "Title" },
  { key: "creator", label: "By" },
  { key: "year", label: "Year", cls: "num" },
  { key: "rating", label: "Rating" },
  { key: "progress", label: "Progress" },
  { key: "createdAt", label: "Reviewed" },
];

const route = useRoute();
const router = useRouter();
const { currentUser } = useCurrentUser();
const profile = ref<ReviewProfile | null>(null);
const loading = ref(true);
const sortKey = ref<SortKey>("createdAt");
const sortAsc = ref(false);

const userId = computed(() => route.params.userId as string);
const isMe = computed(() => currentUser.value?.userId === userId.value);
const name = computed(() => profile.value ? profile.value.user.firstName || profile.value.user.displayName : "");
const average = computed(() => {
  const rs = profile.value?.reviews ?? [];
  return rs.length ? (rs.reduce((sum, r) => sum + r.rating, 0) / rs.length).toFixed(1) : "0";
});

function compare(a: Review, b: Review): number {
  switch (sortKey.value) {
    case "title": return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    // Blank creator/year sort after filled ones either way round.
    case "creator": return !a.creator !== !b.creator ? (a.creator ? -1 : 1) * (sortAsc.value ? 1 : -1) : (a.creator ?? "").localeCompare(b.creator ?? "", undefined, { sensitivity: "base" });
    case "year": return (a.year === null) !== (b.year === null) ? (a.year !== null ? -1 : 1) * (sortAsc.value ? 1 : -1) : (a.year ?? 0) - (b.year ?? 0);
    case "rating": return a.rating - b.rating;
    case "progress": return PROGRESS_OPTIONS.findIndex(p => p.value === a.progress) - PROGRESS_OPTIONS.findIndex(p => p.value === b.progress);
    case "createdAt": return a.createdAt.localeCompare(b.createdAt);
  }
}

// One table per type, biggest first; the same sort applies to every table.
const groups = computed(() => {
  const byType = new Map<number, { typeId: number; typeName: string; typeIcon: string; typeColor: string; reviews: Review[] }>();
  for (const r of profile.value?.reviews ?? []) {
    if (!byType.has(r.typeId)) byType.set(r.typeId, { typeId: r.typeId, typeName: r.typeName, typeIcon: r.typeIcon, typeColor: r.typeColor, reviews: [] });
    byType.get(r.typeId)!.reviews.push(r);
  }
  const dir = sortAsc.value ? 1 : -1;
  return [...byType.values()]
    .map(g => ({ ...g, reviews: [...g.reviews].sort((a, b) => dir * compare(a, b) || b.createdAt.localeCompare(a.createdAt)) }))
    .sort((a, b) => b.reviews.length - a.reviews.length || a.typeName.localeCompare(b.typeName));
});

function sortBy(key: SortKey) {
  if (sortKey.value === key) sortAsc.value = !sortAsc.value;
  else { sortKey.value = key; sortAsc.value = key === "title" || key === "creator" || key === "progress"; }
}

onMounted(async () => {
  profile.value = await fetchReviewProfile(userId.value);
  loading.value = false;
});
</script>
