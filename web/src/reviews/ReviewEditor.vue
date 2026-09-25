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
      <p class="rv-picker-caption" v-if="draft.wikiTitle && draft.imageUrl">From Wikipedia: <strong>{{ draft.wikiTitle }}</strong></p>
      <p class="rv-picker-status">{{ wikiStatus }}</p>
      <div v-if="candidates.length" class="rv-picker-strip">
        <button v-for="c in candidates" :key="c.imageUrl" type="button" :class="{ active: draft.imageUrl === c.imageUrl }"
          :title="c.description ? `${c.pageTitle} — ${c.description}` : c.pageTitle" @click="pick(c)">
          <img :src="c.imageUrl" :alt="c.pageTitle" loading="lazy" referrerpolicy="no-referrer" />
        </button>
        <button type="button" class="none" :class="{ active: !draft.imageUrl }" @click="pick(null)">No image</button>
      </div>
    </aside>
  </form>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick, onMounted, onUnmounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { PROGRESS_OPTIONS, searchWikipediaImages, fetchReviewTypes, createReviewType, type ReviewDraft, type ReviewType, type WikiCandidate } from "./api";
import StarRating from "./StarRating.vue";
import RichTextEditor from "./RichTextEditor.vue";
import ReviewCover from "./ReviewCover.vue";

const route = useRoute();
const router = useRouter();
const isEdit = computed(() => route.params.id !== undefined);

const draft = reactive<ReviewDraft>({
  title: "", typeId: null, rating: null, progress: "finished",
  summary: "", bodyHtml: "", imageUrl: null, wikiTitle: null,
});
const bodyHtml = computed({ get: () => draft.bodyHtml ?? "", set: (v: string) => { draft.bodyHtml = v; } });
const loading = ref(isEdit.value);
const saving = ref(false);
const error = ref("");

// --- Types: a dropdown of everyone's types, with a last option to add a new one inline.
const NEW_TYPE = "__new__";
const types = ref<ReviewType[]>([]);
const selectedType = computed(() => types.value.find(t => t.id === draft.typeId) ?? null);
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

// --- Wikipedia cover lookup: re-runs as the title/type change; the top hit is used until the user picks one.
const candidates = ref<WikiCandidate[]>([]);
const wikiStatus = ref("Type a title and we'll look for a cover on Wikipedia.");
const userPicked = ref(false);
let debounce: ReturnType<typeof setTimeout> | undefined;
let inflight: AbortController | null = null;

async function lookup() {
  const title = draft.title.trim();
  inflight?.abort();
  if (title.length < 2) { candidates.value = []; wikiStatus.value = "Type a title and we'll look for a cover on Wikipedia."; return; }
  inflight = new AbortController();
  wikiStatus.value = "Searching Wikipedia…";
  try {
    const found = await searchWikipediaImages(title, selectedType.value?.name ?? "", inflight.signal);
    candidates.value = found.slice(0, 7);
    if (!userPicked.value) {
      draft.imageUrl = found[0]?.imageUrl ?? null;
      draft.wikiTitle = found[0]?.pageTitle ?? null;
    }
    wikiStatus.value = found.length ? "Not the right one? Pick another:" : "No Wikipedia image found for that title.";
  } catch (e) {
    if ((e as Error).name !== "AbortError") wikiStatus.value = "Couldn't reach Wikipedia.";
  }
}

function pick(c: WikiCandidate | null) {
  userPicked.value = true;
  draft.imageUrl = c?.imageUrl ?? null;
  draft.wikiTitle = c?.pageTitle ?? null;
}

watch(() => [draft.title, draft.typeId], () => {
  clearTimeout(debounce);
  debounce = setTimeout(lookup, 600);
});
onUnmounted(() => { clearTimeout(debounce); inflight?.abort(); });

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
  // Keep the saved cover; the lookup still fills the strip so it can be swapped.
  userPicked.value = true;
  Object.assign(draft, {
    title: r.title, typeId: r.typeId, rating: r.rating, progress: r.progress,
    summary: r.summary ?? "", bodyHtml: r.bodyHtml ?? "", imageUrl: r.imageUrl, wikiTitle: r.wikiTitle,
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
