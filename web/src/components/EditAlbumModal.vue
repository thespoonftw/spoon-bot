<template>
  <div class="modal-overlay" v-if="show">
    <div class="modal" :style="drag.style.value">
      <button class="modal-close" @click="emit('close')">✕</button>
      <h2 class="modal-drag-handle" @mousedown="drag.onMouseDown">Edit Album</h2>
      <div class="form-group">
        <label>Name</label>
        <input v-model="form.name" type="text" />
      </div>
      <DateRangePicker v-model:start-date="form.startDate" v-model:end-date="form.endDate" />
      <div class="form-group" v-if="groups.length">
        <label>Group</label>
        <div class="album-group-picker">
          <button
            class="album-group-btn"
            :class="{ active: form.groupId === null }"
            :style="{ background: form.groupId === null ? '#585b70' : '' }"
            @click="form.groupId = null">
            None
          </button>
          <button
            v-for="g in groups" :key="g.id"
            class="album-group-btn"
            :class="{ active: form.groupId === g.id }"
            :style="{ background: form.groupId === g.id ? g.color : '' }"
            @click="form.groupId = g.id">
            {{ g.name }}
          </button>
        </div>
      </div>
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

interface SiteGroup { id: number; name: string; color: string }
interface AlbumFields { groupName: string; startDate?: string; endDate?: string; groupId?: number | null }

const props = defineProps<{ show: boolean; channelId: string; album: AlbumFields; groups: SiteGroup[] }>();
const emit = defineEmits<{ close: []; saved: [updated: object] }>();
useEscKey(computed(() => props.show), () => emit("close"));

const form = ref({ name: "", startDate: "", endDate: "", groupId: null as number | null });
const saving = ref(false);
const error = ref("");

watch(() => props.show, (v) => {
  if (v) {
    drag.reset();
    form.value = {
      name: props.album.groupName,
      startDate: props.album.startDate ?? "",
      endDate: props.album.endDate ?? "",
      groupId: props.album.groupId ?? null,
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
      startDate: form.value.startDate || undefined,
      endDate: form.value.endDate || undefined,
      groupId: form.value.groupId,
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
