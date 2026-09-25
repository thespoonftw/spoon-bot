<template>
  <p v-if="loading" class="rv-loading">Loading…</p>
  <form v-else class="rv-editor" @submit.prevent="save">
    <!-- On mobile this wrapper dissolves (display: contents) so the cover can sit between the
         rv-editor-lead fields (title, type) and the rest. -->
    <div class="rv-editor-main">
      <p v-if="error" class="rv-error rv-editor-lead">{{ error }}</p>

      <div class="rv-field rv-editor-lead">
        <label class="rv-label" for="rv-title">Title</label>
        <input id="rv-title" v-model="draft.title" class="rv-input rv-input--title" maxlength="200" placeholder="What are you reviewing?" autocomplete="off" />
      </div>

      <div class="rv-editor-row rv-editor-lead">
        <div class="rv-field">
          <label class="rv-label" for="rv-type">Type</label>
          <select id="rv-type" v-model="draft.typeId" class="rv-select">
            <option v-for="t in types" :key="t.id" :value="t.id">{{ t.icon }} {{ t.name }}</option>
          </select>
        </div>
        <div class="rv-field">
          <label class="rv-label" for="rv-progress">Progress</label>
          <select id="rv-progress" v-model="draft.progress" class="rv-select">
            <option v-for="p in PROGRESS_OPTIONS" :key="p.value" :value="p.value">{{ p.label }}</option>
          </select>
        </div>
      </div>

      <div class="rv-field">
        <label class="rv-label" for="rv-match">Match</label>
        <select id="rv-match" class="rv-select" :value="draft.sourceUrl ?? NO_PAGE" :disabled="!candidates.length" @change="onPageChange">
          <optgroup v-for="g in candidateGroups" :key="g.name" :label="g.name">
            <option v-for="c in g.items" :key="c.url" :value="c.url">{{ c.label }}{{ c.description ? ` — ${c.description}` : "" }}</option>
          </optgroup>
          <option :value="NO_PAGE">{{ candidates.length ? "None of these" : "—" }}</option>
        </select>
        <span class="rv-hint">{{ wikiStatus }}</span>
      </div>

      <div class="rv-editor-row">
        <!-- Year first and fixed-width, so it sits in the same place whether or not the type has a creator. -->
        <div class="rv-field rv-field--year">
          <label class="rv-label" for="rv-year">Year</label>
          <input id="rv-year" v-model="draft.year" class="rv-input" type="number" min="0" max="3000" @input="autoFilled.year = false" />
        </div>
        <div v-if="creatorFieldLabel" class="rv-field">
          <label class="rv-label" for="rv-creator">{{ creatorFieldLabel }}</label>
          <input id="rv-creator" v-model="draft.creator" class="rv-input" maxlength="200" autocomplete="off" @input="autoFilled.creator = false" />
        </div>
        <div v-if="extra === 'season' && seasonOptions.length" class="rv-field">
          <label class="rv-label" for="rv-season">Season</label>
          <select id="rv-season" class="rv-select" :value="draft.season ?? ''" @change="onSeasonChange">
            <option value="">Whole series</option>
            <option v-for="s in seasonOptions" :key="s.number" :value="s.number">Season {{ s.number }}{{ s.year ? ` (${s.year})` : "" }}</option>
          </select>
        </div>
        <div v-if="extra === 'platform'" class="rv-field">
          <label class="rv-label" for="rv-platform">Platform</label>
          <select id="rv-platform" v-model="draft.platform" class="rv-select">
            <option :value="null">Not specified</option>
            <optgroup v-if="gamePlatforms.length" label="Released on">
              <option v-for="p in gamePlatforms" :key="p" :value="p">{{ p }}</option>
            </optgroup>
            <optgroup :label="gamePlatforms.length ? 'Other platforms' : 'Platforms'">
              <option v-for="p in otherPlatforms" :key="p" :value="p">{{ p }}</option>
            </optgroup>
          </select>
        </div>
      </div>
      <p v-if="detailsStatus" class="rv-hint" style="margin: -14px 0 18px">{{ detailsStatus }}</p>

      <div class="rv-field">
        <span class="rv-label">Rating</span>
        <StarRating v-model="draft.rating" editable />
      </div>

      <div class="rv-field">
        <label class="rv-label" for="rv-summary">Summary</label>
        <textarea id="rv-summary" v-model="draft.summary" class="rv-textarea" maxlength="1000" rows="3" placeholder="The short version — a line or two."></textarea>
        <span class="rv-hint">{{ (draft.summary ?? "").length }}/1000</span>
      </div>

      <div class="rv-field">
        <span class="rv-label">Full review <span class="rv-label-note">Optional</span></span>
        <RichTextEditor v-model="bodyHtml" placeholder="Go into as much detail as you like…" />
      </div>

      <div class="rv-editor-foot">
        <router-link :to="isEdit ? `/reviews/${route.params.id}` : '/reviews'" class="rv-btn rv-btn--ghost">Cancel</router-link>
        <button type="submit" class="rv-btn" :disabled="saving">{{ saving ? "Saving…" : isEdit ? "Save changes" : "Publish review" }}</button>
      </div>
    </div>

    <aside class="rv-editor-side">
      <span class="rv-label">Cover</span>
      <div style="margin-top: 8px">
        <ReviewCover class="rv-picker-main" :image-url="draft.imageUrl" :icon="selectedType?.icon ?? '⭐'" :title="draft.title" large />
      </div>
      <p class="rv-picker-caption" v-if="source">
        From {{ source.name }}<template v-if="selectedCandidate">: <strong>{{ selectedCandidate.label }}</strong></template><br />
        <a :href="source.url" target="_blank" rel="noopener noreferrer">View page ↗</a>
      </p>
      <p class="rv-picker-caption" v-else>Pick a match to use its cover.</p>
    </aside>
  </form>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onUnmounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { PROGRESS_OPTIONS, SOURCE_NAMES, COMMON_PLATFORMS, searchMatches, fetchTvmazeSeasons, typeExtra, fetchMatchDetails, matchSource, creatorLabel, fetchReviewTypes, type ReviewDraft, type ReviewType, type MatchCandidate, type MatchSource, type SeasonOption } from "./api";
import StarRating from "./StarRating.vue";
import RichTextEditor from "./RichTextEditor.vue";
import ReviewCover from "./ReviewCover.vue";

const route = useRoute();
const router = useRouter();
const isEdit = computed(() => route.params.id !== undefined);

const draft = reactive<ReviewDraft>({
  title: "", typeId: null, rating: null, progress: "finished",
  summary: "", bodyHtml: "", imageUrl: null, wikiTitle: null, sourceUrl: null, creator: "", year: "",
  season: null, platform: null,
});
const bodyHtml = computed({ get: () => draft.bodyHtml ?? "", set: (v: string) => { draft.bodyHtml = v; } });
const loading = ref(isEdit.value);
const saving = ref(false);
const error = ref("");

// --- Types: everyone's types (managed by admins).
const types = ref<ReviewType[]>([]);
const selectedType = computed(() => types.value.find(t => t.id === draft.typeId) ?? null);
// null for types without a creator field (films and series).
const creatorFieldLabel = computed(() => creatorLabel(selectedType.value?.name ?? ""));
// "season" for series, "platform" for video games, null otherwise.
const extra = computed(() => typeExtra(selectedType.value?.name ?? ""));

// --- Season (series): the matched TVmaze show's seasons. Picking one moves the year and cover to
// that season; "Whole series" goes back to the show's own.
const seasonOptions = ref<SeasonOption[]>([]);
let seasonsInflight: AbortController | null = null;

async function loadSeasons(showUrl: string | null) {
  seasonsInflight?.abort();
  seasonOptions.value = [];
  if (!showUrl?.startsWith("https://www.tvmaze.com/")) return;
  seasonsInflight = new AbortController();
  try { seasonOptions.value = await fetchTvmazeSeasons(showUrl, seasonsInflight.signal); } catch { /* aborted or offline: no season picker */ }
}

function onSeasonChange(e: Event) {
  const value = (e.target as HTMLSelectElement).value;
  draft.season = value === "" ? null : Number(value);
  const season = seasonOptions.value.find(s => s.number === draft.season) ?? null;
  const show = selectedCandidate.value;
  if (autoFilled.year) draft.year = season?.year ?? show?.details?.year ?? draft.year;
  draft.imageUrl = season?.imageUrl ?? show?.imageUrl ?? draft.imageUrl;
}

// --- Platform (video games): the matched game's platforms first, then the usual suspects. A saved
// platform that's in neither list is kept as an option so editing doesn't lose it.
const gamePlatforms = ref<string[]>([]);
const otherPlatforms = computed(() => {
  const others = COMMON_PLATFORMS.filter(p => !gamePlatforms.value.includes(p));
  if (draft.platform && !gamePlatforms.value.includes(draft.platform) && !others.includes(draft.platform)) others.unshift(draft.platform);
  return others;
});

// --- Match: re-searches as the title/type change and auto-selects the best page until the user picks
// one. The chosen page (Wikipedia, or Open Library for books) supplies the cover, creator and year.
const NO_PAGE = "__none__";
const candidates = ref<MatchCandidate[]>([]);
const candidateGroups = computed(() => (Object.keys(SOURCE_NAMES) as MatchSource[])
  .map(source => ({ name: SOURCE_NAMES[source], items: candidates.value.filter(c => c.source === source) }))
  .filter(g => g.items.length));
const selectedCandidate = computed(() => candidates.value.find(c => c.url === draft.sourceUrl) ?? null);
const source = computed(() => matchSource(draft));
const wikiStatus = ref("Type a title and we'll look it up.");
const detailsStatus = ref("");
const userPicked = ref(false);
// Creator/year that came from the match get replaced when the match changes; typed-in values don't.
const autoFilled = reactive({ creator: true, year: true });
let debounce: ReturnType<typeof setTimeout> | undefined;
let searchInflight: AbortController | null = null;
let detailsInflight: AbortController | null = null;

async function lookup() {
  const title = draft.title.trim();
  searchInflight?.abort();
  if (title.length < 2) { candidates.value = []; wikiStatus.value = "Type a title and we'll look it up."; return; }
  searchInflight = new AbortController();
  wikiStatus.value = "Searching…";
  try {
    const found = await searchMatches(title, selectedType.value?.name ?? "", searchInflight.signal);
    // Keep the current match selectable even if the new search didn't return it (e.g. an existing review).
    if (draft.sourceUrl && !found.some(c => c.url === draft.sourceUrl)) found.unshift(savedMatch());
    candidates.value = found;
    if (!userPicked.value) applyPage(found[0] ?? null);
    wikiStatus.value = !found.length ? "Nothing found — fill in the details yourself."
      : userPicked.value ? "" : "Best match picked automatically — change it if it's wrong.";
  } catch (e) {
    if ((e as Error).name !== "AbortError") wikiStatus.value = "Couldn't search right now — fill in the details yourself.";
  }
}

// The match an existing review was saved with, as a dropdown entry carrying its saved details.
function savedMatch(): MatchCandidate {
  const url = draft.sourceUrl!;
  return {
    source: matchSource(draft)?.source ?? "wikipedia",
    url, label: draft.wikiTitle ?? draft.title, description: "saved match",
    imageUrl: draft.imageUrl, wikiTitle: draft.wikiTitle, wikidataId: null,
    details: { creator: draft.creator || null, year: draft.year === "" || draft.year === null ? null : Number(draft.year) },
  };
}

function onPageChange(e: Event) {
  const value = (e.target as HTMLSelectElement).value;
  userPicked.value = true;
  wikiStatus.value = "";
  // Choosing a page on purpose means "use this page's details", so it overrides typed values too.
  Object.assign(autoFilled, { creator: true, year: true });
  applyPage(candidates.value.find(c => c.url === value) ?? null);
}

async function applyPage(c: MatchCandidate | null) {
  draft.sourceUrl = c?.url ?? null;
  draft.wikiTitle = c?.wikiTitle ?? null;
  draft.imageUrl = c?.imageUrl ?? null;
  // A different show/game: its seasons and platforms replace the old ones, and a season no longer
  // applies. (The chosen platform is about how you played it, so it stays.)
  draft.season = null;
  gamePlatforms.value = [];
  loadSeasons(c?.source === "tvmaze" ? c.url : null);
  detailsInflight?.abort();
  detailsStatus.value = "";
  if (!c) return;
  detailsInflight = new AbortController();
  detailsStatus.value = "Getting details…";
  try {
    const d = await fetchMatchDetails(c, selectedType.value?.name ?? "", detailsInflight.signal);
    fillDetails(d.creator, d.year);
    gamePlatforms.value = d.platforms ?? [];
    detailsStatus.value = "";
  } catch (e) {
    if ((e as Error).name !== "AbortError") detailsStatus.value = "Couldn't get the details — fill them in yourself.";
  }
}

function fillDetails(creator: string | null, year: number | null) {
  if (autoFilled.creator) draft.creator = creator ?? "";
  if (autoFilled.year) draft.year = year ?? "";
}

watch(() => [draft.title, draft.typeId], () => {
  clearTimeout(debounce);
  debounce = setTimeout(lookup, 600);
});
onUnmounted(() => { clearTimeout(debounce); searchInflight?.abort(); detailsInflight?.abort(); seasonsInflight?.abort(); });

onMounted(async () => {
  types.value = await fetchReviewTypes();
  if (!isEdit.value) {
    draft.typeId = (types.value.find(t => t.name === "Film") ?? types.value[0])?.id ?? null;
    return;
  }
  const res = await fetch(`/api/reviews/${route.params.id}`);
  if (!res.ok) { error.value = "Couldn't load that review."; loading.value = false; return; }
  const r = await res.json();
  if (!r.canEdit) { router.replace(`/reviews/${r.id}`); return; }
  // Keep the saved page, cover and details; the search still fills the dropdown so they can be swapped.
  userPicked.value = true;
  Object.assign(autoFilled, { creator: !r.creator, year: r.year === null });
  Object.assign(draft, {
    title: r.title, typeId: r.typeId, rating: r.rating, progress: r.progress,
    summary: r.summary ?? "", bodyHtml: r.bodyHtml ?? "", imageUrl: r.imageUrl, wikiTitle: r.wikiTitle,
    sourceUrl: matchSource(r)?.url ?? null,
    creator: r.creator ?? "", year: r.year ?? "", season: r.season, platform: r.platform,
  });
  loadSeasons(draft.sourceUrl);
  loading.value = false;
});

async function save() {
  error.value = "";
  if (!draft.title.trim()) { error.value = "Give it a title."; return; }
  if (draft.typeId === null) { error.value = "Pick a type."; return; }
  if (draft.rating === null) { error.value = "Pick a star rating."; return; }
  saving.value = true;
  const res = await fetch(isEdit.value ? `/api/reviews/${route.params.id}` : "/api/reviews", {
    method: isEdit.value ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    // Only send the fields this type actually shows.
    body: JSON.stringify({
      ...draft,
      creator: creatorFieldLabel.value ? draft.creator : null,
      season: extra.value === "season" ? draft.season : null,
      platform: extra.value === "platform" ? draft.platform : null,
    }),
  });
  const data = await res.json().catch(() => ({}));
  saving.value = false;
  if (!res.ok) { error.value = data.error ?? "Couldn't save the review."; return; }
  router.push(`/reviews/${data.id}`);
}
</script>
