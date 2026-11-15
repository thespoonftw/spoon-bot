<template>
  <!-- Create Album: opened from the Photo Archives page. A new album opens straight away. -->
  <div class="modal-overlay">
    <div class="modal">
      <button class="modal-close" @click="emit('close')">✕</button>
      <h2>Create Album</h2>
      <div class="form-group">
        <label>Name</label>
        <input v-model="form.name" type="text" placeholder="e.g. Summer Trip" />
      </div>
      <DateRangePicker v-model:start-date="form.startDate" v-model:end-date="form.endDate" />
      <div class="form-group" v-if="siteGroups.length">
        <label>Group</label>
        <div class="album-group-picker">
          <button class="album-group-btn" :class="{ active: form.groupId === null }" @click="form.groupId = null">None</button>
          <button v-for="g in siteGroups" :key="g.id" class="album-group-btn" :class="{ active: form.groupId === g.id }" :style="{ background: form.groupId === g.id ? g.color : '' }" @click="form.groupId = g.id">{{ g.name }}</button>
        </div>
      </div>
      <div v-if="formError" class="error">{{ formError }}</div>
      <div class="modal-actions">
        <button class="btn-primary" @click="createAlbum" :disabled="creating">{{ creating ? "Creating…" : "Create" }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useAlbumsCache } from "../composables/useAlbumsCache";
import { authJsonHeaders } from "../utils/session";
import DateRangePicker from "./DateRangePicker.vue";

interface SiteGroup { id: number; name: string; color: string }

const emit = defineEmits<{ close: [] }>();
const router = useRouter();
const { markAlbumsDirty } = useAlbumsCache();
const siteGroups = ref<SiteGroup[]>([]);
const creating = ref(false);
const formError = ref("");
const form = ref({ name: "", startDate: "", endDate: "", groupId: null as number | null });

onMounted(async () => {
  const res = await fetch("/api/groups", { headers: authJsonHeaders() });
  if (res.ok) siteGroups.value = await res.json();
});

async function createAlbum() {
  formError.value = "";
  if (!form.value.name.trim()) { formError.value = "Name is required."; return; }
  if (!form.value.startDate) { formError.value = "Start date is required."; return; }
  creating.value = true;
  const res = await fetch("/api/albums", {
    method: "POST",
    headers: authJsonHeaders(),
    body: JSON.stringify({
      name: form.value.name.trim(),
      startDate: form.value.startDate,
      endDate: form.value.endDate || undefined,
      groupId: form.value.groupId,
    }),
  });
  creating.value = false;
  if (res.ok) {
    const album = await res.json();
    markAlbumsDirty();
    emit("close");
    router.push(`/archives/albums/${album.channelId}`);
  } else {
    formError.value = "Failed to create album. Try again.";
  }
}
</script>
