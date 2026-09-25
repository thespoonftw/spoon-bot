<template>
  <p v-if="loading" class="rv-loading">Loading…</p>
  <form v-else class="rv-editor" @submit.prevent="save">
    <div>
      <p v-if="error" class="rv-error">{{ error }}</p>

      <div class="rv-field">
        <label class="rv-label" for="rv-title">Title</label>
        <input id="rv-title" v-model="draft.title" class="rv-input rv-input--title" maxlength="200" placeholder="What are you reviewing?" autocomplete="off" />
      </div>

      <div class="rv-editor-row">
        <div class="rv-field">
          <label class="rv-label" for="rv-type">Type</label>
          <select id="rv-type" class="rv-select" :value="draft.typeId ?? ''" @change="onTypeChange">
            <option v-for="t in types" :key="t.id" :value="t.id">{{ t.icon }} {{ t.name }}</option>
            <option :value="NEW_TYPE">＋ Add a new type…</option>
          </select>
          <div v-if="addingType" class="rv-newtype">
            <input v-model="newType.icon" class="rv-input rv-newtype-icon" placeholder="🎮" maxlength="8" aria-label="Emoji (optional)" title="Emoji (optional)" />
            <input ref="newTypeName" v-model="newType.name" class="rv-input" placeholder="e.g. Video game" maxlength="40" aria-label="New type name" @keydown.enter.prevent="addType" @keydown.esc="addingType = false" />
            <button type="button" class="rv-btn rv-btn--small" :disabled="!newType.name.trim() || addingBusy" @click="addType">Add</button>
            <button type="button" class="rv-btn rv-btn--ghost rv-btn--small" @click="addingType = false">Cancel</button>
          </div>
          <span v-if="typeError" class="rv-hint" style="color: var(--rv-accent)">{{ typeError }}</span>
        </div>
        <div class="rv-field">
          <label class="rv-label" for="rv-progress">Progress</label>
          <select id="rv-progress" v-model="draft.progress" class="rv-select">
            <option v-for="p in PROGRESS_OPTIONS" :key="p.value" :value="p.value">{{ p.label }}</option>
          </select>
        </div>
      </div>

      <div class="rv-field">
        <label class="rv-label" for="rv-wiki">Wikipedia match</label>
        <select id="rv-wiki" class="rv-select" :value="draft.wikiTitle ?? NO_PAGE" :disabled="!candidates.length" @change="onPageChange">
          <option v-for="c in candidates" :key="c.pageTitle" :value="c.pageTitle">{{ c.pageTitle }}{{ c.description ? ` — ${c.description}` : "" }}</option>
          <option :value="NO_PAGE">{{ candidates.length ? "None of these" : "—" }}</option>
        </select>
        <span class="rv-hint">{{ wikiStatus }}</span>
      </div>

      <div class="rv-editor-row">
        <div class="rv-field" style="flex: 2">
          <label class="rv-label" for="rv-creator">{{ creatorFieldLabel }}</label>
          <input id="rv-creator" v-model="draft.creator" class="rv-input" maxlength="200" autocomplete="off" @input="autoFilled.creator = false" />
        </div>
        <div class="rv-field" style="flex: 1; min-width: 120px">
          <label class="rv-label" for="rv-year">Year</label>
          <input id="rv-year" v-model="draft.year" class="rv-input" type="number" min="0" max="3000" @input="autoFilled.year = false" />
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
        <span class="rv-label">Full review</span>
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
      <p class="rv-picker-caption" v-if="draft.wikiTitle">
        From Wikipedia: <strong>{{ draft.wikiTitle }}</strong><br />
        <a :href="wikiUrl(draft.wikiTitle)" target="_blank" rel="noopener noreferrer">View page ↗</a>
      </p>
      <p class="rv-picker-caption" v-else>Pick a Wikipedia match to use its cover.</p>
    </aside>
  </form>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick, onMounted, onUnmounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { PROGRESS_OPTIONS, searchWikipedia, fetchWikiDetails, creatorLabel, fetchReviewTypes, createReviewType, type ReviewDraft, type ReviewType, type WikiCandidate } from "./api";
import StarRating from "./StarRating.vue";
import RichTextEditor from "./RichTextEditor.vue";
import ReviewCover from "./ReviewCover.vue";

const route = useRoute();
const router = useRouter();
const isEdit = computed(() => route.params.id !== undefined);

const draft = reactive<ReviewDraft>({
  title: "", typeId: null, rating: null, progress: "finished",
  summary: "", bodyHtml: "", imageUrl: null, wikiTitle: null, creator: "", year: "",
});
const bodyHtml = computed({ get: () => draft.bodyHtml ?? "", set: (v: string) => { draft.bodyHtml = v; } });
const loading = ref(isEdit.value);
const saving = ref(false);
const error = ref("");

// --- Types: a dropdown of everyone's types, with a last option to add a new one inline.
const NEW_TYPE = "__new__";
const types = ref<ReviewType[]>([]);
const selectedType = computed(() => types.value.find(t => t.id === draft.typeId) ?? null);
const creatorFieldLabel = computed(() => creatorLabel(selectedType.value?.name ?? ""));
const addingType = ref(false);
const addingBusy = ref(false);
const typeError = ref("");
const newType = reactive({ name: "", icon: "" });
const newTypeName = ref<HTMLInputElement | null>(null);

function onTypeChange(e: Event) {
  const select = e.target as HTMLSelectElement;
  if (select.value === NEW_TYPE) {
    // Keep showing the current type until the new one is actually created.
    select.value = String(draft.typeId ?? "");
    Object.assign(newType, { name: "", icon: "" });
    typeError.value = "";
    addingType.value = true;
    nextTick(() => newTypeName.value?.focus());
  } else {
    draft.typeId = Number(select.value);
  }
}

async function addType() {
  if (!newType.name.trim() || addingBusy.value) return;
  addingBusy.value = true;
  typeError.value = "";
  const result = await createReviewType(newType.name, newType.icon);
  addingBusy.value = false;
  if ("error" in result) { typeError.value = result.error; return; }
  if (!types.value.some(t => t.id === result.id)) types.value.push(result);
  draft.typeId = result.id;
  addingType.value = false;
}

// --- Wikipedia match: re-searches as the title/type change and auto-selects the best page until the
// user picks one. The chosen page supplies the cover, and its Wikidata item the creator and year.
const NO_PAGE = "__none__";
const candidates = ref<WikiCandidate[]>([]);
const wikiStatus = ref("Type a title and we'll find it on Wikipedia.");
const detailsStatus = ref("");
const userPicked = ref(false);
// Creator/year that came from Wikipedia get replaced when the match changes; typed-in values don't.
const autoFilled = reactive({ creator: true, year: true });
let debounce: ReturnType<typeof setTimeout> | undefined;
let searchInflight: AbortController | null = null;
let detailsInflight: AbortController | null = null;

const wikiUrl = (pageTitle: string) => `https://en.wikipedia.org/wiki/${encodeURIComponent(pageTitle.replace(/ /g, "_"))}`;

async function lookup() {
  const title = draft.title.trim();
  searchInflight?.abort();
  if (title.length < 2) { candidates.value = []; wikiStatus.value = "Type a title and we'll find it on Wikipedia."; return; }
  searchInflight = new AbortController();
  wikiStatus.value = "Searching Wikipedia…";
  try {
    const found = await searchWikipedia(title, selectedType.value?.name ?? "", searchInflight.signal);
    // Keep the current page selectable even if the new search didn't return it (e.g. an existing review).
    if (draft.wikiTitle && !found.some(c => c.pageTitle === draft.wikiTitle)) {
      found.unshift({ pageTitle: draft.wikiTitle, description: "", imageUrl: draft.imageUrl, wikidataId: null });
    }
    candidates.value = found;
    if (!userPicked.value) applyPage(found[0] ?? null);
    wikiStatus.value = !found.length ? "No Wikipedia page found — fill in the details yourself."
      : userPicked.value ? "" : "Best match picked automatically — change it if it's wrong.";
  } catch (e) {
    if ((e as Error).name !== "AbortError") wikiStatus.value = "Couldn't reach Wikipedia.";
  }
}

function onPageChange(e: Event) {
  const value = (e.target as HTMLSelectElement).value;
  userPicked.value = true;
  wikiStatus.value = "";
  // Choosing a page on purpose means "use this page's details", so it overrides typed values too.
  Object.assign(autoFilled, { creator: true, year: true });
  applyPage(candidates.value.find(c => c.pageTitle === value) ?? null);
}

async function applyPage(c: WikiCandidate | null) {
  draft.wikiTitle = c?.pageTitle ?? null;
  draft.imageUrl = c?.imageUrl ?? null;
  detailsInflight?.abort();
  detailsStatus.value = "";
  if (!c) return;
  if (!c.wikidataId) { fillDetails(null, null); return; }
  detailsInflight = new AbortController();
  detailsStatus.value = "Getting details from Wikipedia…";
  try {
    const d = await fetchWikiDetails(c.wikidataId, selectedType.value?.name ?? "", detailsInflight.signal);
    fillDetails(d.creator, d.year);
    detailsStatus.value = "";
  } catch (e) {
    if ((e as Error).name !== "AbortError") detailsStatus.value = "Couldn't get details from Wikipedia — fill them in yourself.";
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
onUnmounted(() => { clearTimeout(debounce); searchInflight?.abort(); detailsInflight?.abort(); });

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
    creator: r.creator ?? "", year: r.year ?? "",
  });
  loading.value = false;
});

async function save() {
  error.value = "";
  if (!draft.title.trim()) { error.value = "Give it a title."; return; }
  if (draft.typeId === null) { error.value = "Pick a type."; return; }
  if (draft.rating === null) { error.value = "Pick a star rating (0 is allowed)."; return; }
  saving.value = true;
  const res = await fetch(isEdit.value ? `/api/reviews/${route.params.id}` : "/api/reviews", {
    method: isEdit.value ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });
  const data = await res.json().catch(() => ({}));
  saving.value = false;
  if (!res.ok) { error.value = data.error ?? "Couldn't save the review."; return; }
  router.push(`/reviews/${data.id}`);
}
</script>
