<template>
  <div>
    <nav v-if="filterTypes.length > 1" ref="navEl" class="rv-filters">
      <!-- An invisible copy of every tab, measured to work out how many fit on the row. -->
      <div class="rv-filters-measure" aria-hidden="true">
        <div ref="measureEl" class="rv-filters">
          <button tabindex="-1">All</button>
          <button v-for="t in filterTypes" :key="t.id" tabindex="-1"><span class="rv-filter-icon">{{ t.icon }}</span></button>
          <button tabindex="-1"><span>More</span> ▾</button>
        </div>
      </div>
      <button :class="{ active: !typeId }" @click="setType(null)">All</button>
      <button v-for="t in shownTypes" :key="t.id" :class="{ active: typeId === t.id }" :style="typeId === t.id ? { borderBottomColor: t.color } : undefined" :title="pluralType(t.name)" :aria-label="pluralType(t.name)" @click="setType(t.id)">
        <span class="rv-filter-icon">{{ t.icon }}</span>
      </button>
      <!-- The types that don't fit, in a menu. When one of them is picked, the button shows its emoji. -->
      <div v-if="moreTypes.length" ref="moreEl" class="rv-filter-more">
        <button :class="{ active: activeInMore }" :style="activeInMore ? { borderBottomColor: activeType!.color } : undefined" :aria-expanded="moreOpen" aria-haspopup="menu" @click="moreOpen = !moreOpen">
          <span v-if="activeInMore" class="rv-filter-icon">{{ activeType!.icon }}</span>
          <span v-else>More</span> ▾
        </button>
        <div v-if="moreOpen" class="rv-filter-menu" role="menu">
          <button v-for="t in moreTypes" :key="t.id" role="menuitem" :class="{ active: typeId === t.id }" @click="setType(t.id)">
            <span class="rv-filter-icon">{{ t.icon }}</span> {{ pluralType(t.name) }}
          </button>
        </div>
      </div>
    </nav>
    <!-- The tabs are just emoji, so the selected type is named above the list ("All" needs no heading). -->
    <h2 v-if="activeType && filterTypes.length > 1" class="rv-filter-heading">{{ pluralType(activeType.name) }}</h2>

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
          <!-- On a type's own tab every card is that type, so the chip is left off. -->
          <TypeChip v-if="!typeId" class="rv-card-type" :name="r.typeName" :icon="r.typeIcon" :color="r.typeColor" />
          <h3 class="rv-card-title">{{ r.title }}<span v-if="r.year" class="rv-card-year">{{ r.year }}</span></h3>
          <p v-if="cardCredit(r)" class="rv-credit">{{ cardCredit(r) }}</p>
          <div class="rv-card-rating">
            <StarRating :model-value="r.rating" />
            <span v-if="hasProgress(r.typeName)" class="rv-progress" :class="`rv-progress--${r.progress}`">{{ progressLabel(r.progress) }}</span>
          </div>
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
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { getCached, setCached, pluralType, authorName, formatReviewDate, fetchReviewTypes, hasProgress, progressLabel, cardCredit, type Review, type ReviewType } from "./api";
import ReviewCover from "./ReviewCover.vue";
import StarRating from "./StarRating.vue";
import TypeChip from "./TypeChip.vue";

const PAGE = 30;
const route = useRoute();
const router = useRouter();
const typeId = ref<number | null>(parseInt(route.query.type as string) || null);
// Each tab's list (including any "Load more" pages) is kept in the session cache, so switching
// back to a tab shows it straight away.
const feedKey = `feed:${typeId.value ?? "all"}`;
const cachedFeed = getCached<{ reviews: Review[]; total: number }>(feedKey);
const types = ref<ReviewType[]>(getCached<ReviewType[]>("types") ?? []);
const reviews = ref<Review[]>(cachedFeed?.reviews ?? []);
const total = ref(cachedFeed?.total ?? 0);
const loading = ref(false);
const error = ref("");

// Every type gets a tab, most-reviewed first (ties keep the usual order, so "Other" stays last).
const filterTypes = computed(() => [...types.value].sort((a, b) => b.reviewCount - a.reviewCount));
const activeType = computed(() => types.value.find(t => t.id === typeId.value) ?? null);
// As many tabs as fit on one row; on narrow screens the rest go under "More".
const fitCount = ref(Infinity);
const shownTypes = computed(() => filterTypes.value.slice(0, fitCount.value));
const moreTypes = computed(() => filterTypes.value.slice(shownTypes.value.length));
const activeInMore = computed(() => moreTypes.value.some(t => t.id === typeId.value));
const moreOpen = ref(false);
const moreEl = ref<HTMLElement | null>(null);
const navEl = ref<HTMLElement | null>(null);
const measureEl = ref<HTMLElement | null>(null);

// Measures the invisible copy of the tabs (All, each type, More) against the row's width.
function fitTabs() {
  const nav = navEl.value, measure = measureEl.value;
  if (!nav || !measure) return;
  const gap = parseFloat(getComputedStyle(nav).columnGap) || 0;
  const widths = [...measure.children].map(c => (c as HTMLElement).offsetWidth);
  const more = widths.pop()!;
  const [all, ...tabs] = widths;
  const room = nav.clientWidth;
  if (tabs.reduce((used, w) => used + gap + w, all) <= room) { fitCount.value = tabs.length; return; }
  let used = all + gap + more, count = 0;
  while (count < tabs.length && used + gap + tabs[count] <= room) used += gap + tabs[count++];
  fitCount.value = count;
}
const resizeObserver = new ResizeObserver(() => fitTabs());
watch(navEl, (el, old) => { if (old) resizeObserver.unobserve(old); if (el) resizeObserver.observe(el); });
watch(filterTypes, () => nextTick(fitTabs));
function closeMoreOnOutsideClick(e: MouseEvent) {
  if (moreOpen.value && !moreEl.value?.contains(e.target as Node)) moreOpen.value = false;
}

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
    setCached(feedKey, { reviews: reviews.value, total: total.value });
  } catch {
    error.value = "Couldn't load reviews — try refreshing.";
  }
  loading.value = false;
}

// The filter lives in the URL so back/refresh keep it; the layout re-mounts this view on URL change.
function setType(id: number | null) {
  router.replace({ query: id ? { type: String(id) } : {} });
}

onUnmounted(() => { document.removeEventListener("click", closeMoreOnOutsideClick); resizeObserver.disconnect(); });
onMounted(async () => {
  document.addEventListener("click", closeMoreOnOutsideClick);
  // Emoji can change width once the font loads.
  document.fonts?.ready.then(fitTabs);
  await Promise.all([cachedFeed ? null : load(true), fetchReviewTypes().then(t => { types.value = t; })]);
});
</script>
