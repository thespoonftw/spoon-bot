<template>
  <div class="modal-overlay" v-if="show">
    <div class="modal" :style="drag.style.value">
      <button class="modal-close" @click="emit('close')">✕</button>
      <h2 class="modal-drag-handle" @mousedown="drag.onMouseDown">Edit Album</h2>
      <div class="form-group">
        <label>Name</label>
        <input v-model="form.name" type="text" />
      </div>
      <div class="form-group">
        <label>Location</label>
        <input v-model="form.location" type="text" />
      </div>
      <DateRangePicker v-model:start-date="form.startDate" v-model:end-date="form.endDate" />
      <div v-if="error" class="error">{{ error }}</div>
      <div class="modal-actions">
        <button class="btn-primary" @click="save" :disabled="saving">{{ saving ? "Saving…" : "Save" }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from "vue";
import DateRangePicker from "./DateRangePicker.vue";
import { authJsonHeaders } from "../utils/session";
import { useDraggable, useEscKey } from "../utils/draggable";

const drag = useDraggable();

interface AlbumFields { groupName: string; location?: string; startDate?: string; endDate?: string }

const props = defineProps<{ show: boolean; channelId: string; album: AlbumFields }>();
const emit = defineEmits<{ close: []; saved: [updated: object] }>();
useEscKey(computed(() => props.show), () => emit("close"));

const form = ref({ name: "", location: "", startDate: "", endDate: "" });
const saving = ref(false);
const error = ref("");

watch(() => props.show, (v) => {
  if (v) {
    drag.reset();
    form.value = {
      name: props.album.groupName,
      location: props.album.location ?? "",
      startDate: props.album.startDate ?? "",
      endDate: props.album.endDate ?? "",
    };
    error.value = "";
  }
});

async function save() {
  error.value = "";
  saving.value = true;
  const res = await fetch(`/api/album/${props.channelId}`, {
    method: "PUT",
    headers: authJsonHeaders(),
    body: JSON.stringify({
      name: form.value.name.trim(),
      location: form.value.location.trim() || undefined,
      startDate: form.value.startDate || undefined,
      endDate: form.value.endDate || undefined,
    }),
  });
  saving.value = false;
  if (res.ok) {
    emit("saved", await res.json());
    emit("close");
  } else {
    error.value = "Failed to save. Try again.";
  }
}
</script>
