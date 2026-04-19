<template>
  <Teleport to="body">
  <div class="modal-overlay locations-modal-overlay" style="pointer-events:none;background:none">
    <div class="modal" :style="drag.style.value" style="pointer-events:auto">
      <button class="modal-close" @click="emit('close')">✕</button>
      <h2 class="modal-drag-handle" @mousedown="drag.onMouseDown">Locations</h2>

      <div class="locations-modal-list">
        <div
          v-for="(loc, i) in localLocations"
          :key="loc.id"
          class="location-row"
          draggable="true"
          :class="{ 'location-row-dragging': dragIndex === i, 'location-row-dragover': dragOverIndex === i }"
          @dragstart="onDragStart(i)"
          @dragover.prevent="onDragOver(i)"
          @drop.prevent="onDrop"
          @dragend="onDragEnd"
        >
          <span class="location-drag-handle" title="Drag to reorder">⠿</span>
          <span class="location-row-name">📍 {{ loc.name }}</span>
          <button class="btn-remove" @click="remove(loc.id)" title="Remove">delete</button>
        </div>
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
import { ref } from "vue";
import { authJsonHeaders, authHeaders } from "../utils/session";
import { useDraggable, useEscKey } from "../utils/draggable";

interface AlbumLocation { id: number; name: string }

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
  await fetch(`/api/album/${props.channelId}/locations/${id}`, { method: "DELETE", headers: authHeaders() });
  localLocations.value = localLocations.value.filter(l => l.id !== id);
  emit("updated", [...localLocations.value]);
}
</script>
