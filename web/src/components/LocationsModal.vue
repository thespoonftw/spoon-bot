<template>
  <div class="modal-overlay">
    <div class="modal" :style="drag.style.value">
      <button class="modal-close" @click="emit('close')">✕</button>
      <h2 class="modal-drag-handle" @mousedown="drag.onMouseDown">Locations</h2>

      <div v-for="loc in locations" :key="loc.id" class="location-row">
        <span class="location-row-name">📍 {{ loc.name }}</span>
        <button class="btn-icon" @click="remove(loc.id)" title="Remove">🗑️</button>
      </div>
      <p v-if="locations.length === 0" class="empty" style="margin: 8px 0">No locations set.</p>

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

const newName = ref("");
const adding = ref(false);
const error = ref("");

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
    emit("updated", [...props.locations, loc]);
  } else if (res.status === 409) {
    error.value = "That location already exists.";
  } else {
    error.value = "Failed to add location.";
  }
}

async function remove(id: number) {
  await fetch(`/api/album/${props.channelId}/locations/${id}`, { method: "DELETE", headers: authHeaders() });
  emit("updated", props.locations.filter(l => l.id !== id));
}
</script>
