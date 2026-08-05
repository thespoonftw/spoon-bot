<template>
  <Teleport to="body">
  <div class="modal-overlay" style="pointer-events:none;background:none">
    <div class="modal" :style="drag.style.value" style="pointer-events:auto">
      <button class="modal-close" @click="emit('close')">✕</button>
      <h2 class="modal-drag-handle" @mousedown="drag.onMouseDown">Locations</h2>

      <div class="locations-modal-list">
        <template v-for="(loc, i) in localLocations" :key="loc.id">
          <div
            class="location-row"
            :draggable="expandedLocId === null"
            :class="{ 'location-row-dragging': dragIndex === i, 'location-row-dragover': dragOverIndex === i }"
            @dragstart="onDragStart(i)"
            @dragover.prevent="onDragOver(i)"
            @drop.prevent="onDrop"
            @dragend="onDragEnd"
          >
            <span class="location-drag-handle" title="Drag to reorder">⠿</span>
            <span class="location-row-name">📍 {{ loc.name }}</span>
            <button class="btn-icon" @click="togglePreview(loc)" title="Preview on map">✏️</button>
            <button class="btn-remove" @click="remove(loc.id)" title="Remove">delete</button>
          </div>
          <div v-if="expandedLocId === loc.id" class="location-map-preview-wrap">
            <p v-if="previewStatus" class="empty" style="font-size:0.8em;margin:4px 0">{{ previewStatus }}</p>
            <div v-show="!previewStatus" :ref="setPreviewMapEl" class="location-map-preview"></div>
          </div>
        </template>
        <p v-if="localLocations.length === 0" class="empty" style="margin: 8px 0">No locations set.</p>
      </div>

      <div class="form-group" style="margin-top: 16px">
        <label>Add location</label>
        <div style="display:flex;gap:8px">
          <input v-model="newName" type="text" placeholder="e.g. London, UK" @keydown.enter="add" />
          <button class="btn-primary" @click="add" :disabled="!newName.trim() || adding">Add</button>
        </div>
      </div>
      <div v-if="error" class="error">{{ error }}</div>
    </div>
  </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted, onUnmounted } from "vue";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { authJsonHeaders, authHeaders } from "../utils/session";
import { useDraggable, useEscKey } from "../utils/draggable";
import { geocodeAndSaveLocation } from "../utils/geocode";
import { makeMapIcon } from "../utils/mapIcon";

interface AlbumLocation { id: number; name: string; lat?: number | null; lon?: number | null; geocodeAttempted?: number }

const props = defineProps<{ channelId: string; locations: AlbumLocation[] }>();
const emit = defineEmits<{ close: []; updated: [locations: AlbumLocation[]] }>();

const drag = useDraggable();
const isOpen = ref(true);
useEscKey(isOpen, () => emit("close"));

const localLocations = ref<AlbumLocation[]>([...props.locations]);
const dragIndex = ref<number | null>(null);
const dragOverIndex = ref<number | null>(null);

const newName = ref("");
const adding = ref(false);
const error = ref("");

const expandedLocId = ref<number | null>(null);
const previewStatus = ref("");
let previewMapContainer: HTMLElement | null = null;
function setPreviewMapEl(el: Element | null) { previewMapContainer = el as HTMLElement | null; }
let previewMap: L.Map | null = null;

function closePreview() {
  previewMap?.remove();
  previewMap = null;
  expandedLocId.value = null;
  previewStatus.value = "";
}

async function togglePreview(loc: AlbumLocation) {
  if (expandedLocId.value === loc.id) { closePreview(); return; }
  closePreview();
  expandedLocId.value = loc.id;
  if (loc.lat == null || loc.lon == null) {
    if (loc.geocodeAttempted) { previewStatus.value = "Couldn't find this location on the map."; return; }
    previewStatus.value = "Locating…";
    const coords = await geocodeAndSaveLocation(loc.id, loc.name);
    if (expandedLocId.value !== loc.id) return;
    if (!coords) { previewStatus.value = "Couldn't find this location on the map."; return; }
    loc.lat = coords[0]; loc.lon = coords[1]; loc.geocodeAttempted = 1;
  }
  previewStatus.value = "";
  await nextTick();
  if (expandedLocId.value !== loc.id || !previewMapContainer) return;
  previewMap = L.map(previewMapContainer, { attributionControl: false }).setView([loc.lat!, loc.lon!], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18 }).addTo(previewMap);
  const marker = L.marker([loc.lat!, loc.lon!], { icon: makeMapIcon('#888fa8'), draggable: true }).addTo(previewMap);
  marker.on("dragend", async () => {
    const { lat, lng } = marker.getLatLng();
    loc.lat = lat; loc.lon = lng;
    await fetch(`/api/album-location/${loc.id}/coords`, {
      method: "PUT", headers: authJsonHeaders(), body: JSON.stringify({ lat, lon: lng }),
    });
    emit("updated", [...localLocations.value]);
  });
}

onMounted(() => {
  if (localLocations.value.length > 0) togglePreview(localLocations.value[0]);
});

onUnmounted(() => { previewMap?.remove(); previewMap = null; });

function onDragStart(i: number) { dragIndex.value = i; }
function onDragOver(i: number) { dragOverIndex.value = i; }
function onDragEnd() { dragIndex.value = null; dragOverIndex.value = null; }

async function onDrop() {
  const from = dragIndex.value;
  const to = dragOverIndex.value;
  dragIndex.value = null;
  dragOverIndex.value = null;
  if (from === null || to === null || from === to) return;
  const arr = [...localLocations.value];
  arr.splice(to, 0, arr.splice(from, 1)[0]);
  localLocations.value = arr;
  await fetch(`/api/album/${props.channelId}/locations/order`, {
    method: "PUT",
    headers: authJsonHeaders(),
    body: JSON.stringify({ ids: arr.map(l => l.id) }),
  });
  emit("updated", [...arr]);
}

async function add() {
  if (!newName.value.trim()) return;
  adding.value = true;
  error.value = "";
  const res = await fetch(`/api/album/${props.channelId}/locations`, {
    method: "POST",
    headers: authJsonHeaders(),
    body: JSON.stringify({ name: newName.value.trim() }),
  });
  adding.value = false;
  if (res.ok) {
    const loc: AlbumLocation = await res.json();
    newName.value = "";
    localLocations.value = [...localLocations.value, loc];
    emit("updated", [...localLocations.value]);
  } else if (res.status === 409) {
    error.value = "That location already exists.";
  } else {
    error.value = "Failed to add location.";
  }
}

async function remove(id: number) {
  if (expandedLocId.value === id) closePreview();
  await fetch(`/api/album/${props.channelId}/locations/${id}`, { method: "DELETE", headers: authHeaders() });
  localLocations.value = localLocations.value.filter(l => l.id !== id);
  emit("updated", [...localLocations.value]);
}
</script>
