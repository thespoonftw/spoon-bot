<template>
  <div class="rv-place" @focusout="onFocusOut">
    <input
      :id="id" class="rv-input" :value="location ?? ''" maxlength="100" placeholder="Search for a pub or bar, or type anywhere" autocomplete="off"
      role="combobox" :aria-expanded="open" aria-autocomplete="list"
      @input="onInput" @keydown="onKeydown" @focus="open = results.length > 0"
    />
    <ul v-if="open" class="rv-place-list" role="listbox">
      <li v-for="(p, i) in results" :key="p.url" role="option" :aria-selected="i === highlighted" :class="{ active: i === highlighted }" @mousedown.prevent="pick(p)" @mouseenter="highlighted = i">
        <strong>{{ p.name }}</strong>
        <span v-if="p.detail">{{ p.detail }}</span>
      </li>
      <li class="rv-place-credit" aria-hidden="true">Places from OpenStreetMap</li>
    </ul>
    <span class="rv-hint">
      <template v-if="status">{{ status }}</template>
      <template v-else-if="locationUrl"><a :href="locationUrl" target="_blank" rel="noopener noreferrer">On the map ↗</a></template>
      <template v-else>Pick a suggestion to link it to the map, or just type where you were.</template>
    </span>
  </div>
</template>

<script setup lang="ts">
import { ref, onUnmounted } from "vue";
import { searchPlaces, type PlaceResult } from "./api";

// The location is free text; picking a suggestion also sets its map link, and typing clears it.
defineProps<{ id?: string }>();
const location = defineModel<string | null>("location", { required: true });
const locationUrl = defineModel<string | null>("locationUrl", { required: true });

const results = ref<PlaceResult[]>([]);
const open = ref(false);
const highlighted = ref(-1);
const status = ref("");
let debounce: ReturnType<typeof setTimeout> | undefined;
let inflight: AbortController | null = null;

function onInput(e: Event) {
  const text = (e.target as HTMLInputElement).value;
  location.value = text;
  locationUrl.value = null;
  clearTimeout(debounce);
  inflight?.abort();
  if (text.trim().length < 3) { results.value = []; open.value = false; status.value = ""; return; }
  debounce = setTimeout(() => search(text.trim()), 350);
}

async function search(query: string) {
  inflight = new AbortController();
  try {
    results.value = await searchPlaces(query, inflight.signal);
    highlighted.value = -1;
    open.value = results.value.length > 0;
    status.value = results.value.length ? "" : "No places found — it'll be saved as you typed it.";
  } catch (e) {
    if ((e as Error).name !== "AbortError") { results.value = []; open.value = false; status.value = "Couldn't search places right now — it'll be saved as you typed it."; }
  }
}

function pick(p: PlaceResult) {
  location.value = p.label;
  locationUrl.value = p.url;
  open.value = false;
  status.value = "";
}

function onKeydown(e: KeyboardEvent) {
  if (!open.value) return;
  if (e.key === "ArrowDown") { e.preventDefault(); highlighted.value = (highlighted.value + 1) % results.value.length; }
  else if (e.key === "ArrowUp") { e.preventDefault(); highlighted.value = (highlighted.value - 1 + results.value.length) % results.value.length; }
  else if (e.key === "Enter" && highlighted.value >= 0) { e.preventDefault(); pick(results.value[highlighted.value]); }
  else if (e.key === "Escape") open.value = false;
}

function onFocusOut(e: FocusEvent) {
  if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) open.value = false;
}

onUnmounted(() => { clearTimeout(debounce); inflight?.abort(); });
</script>
