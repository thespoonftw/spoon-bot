<template>
  <div class="page">
    <PageHeader back-to="/admin" title="Groups" />

    <p v-if="!isAdmin && currentUser" class="empty">Admins only.</p>
    <template v-else-if="isAdmin">
      <p class="groups-intro">A group's colour is used for its label on the Users page and on its albums. Add people to groups from the Users page.</p>

      <p v-if="loading" class="empty">Loading…</p>
      <div v-else class="groups-list">
        <div v-for="(g, i) in groups" :key="g.id" class="group-row"
          :class="{ 'group-row-dragging': dragIndex === i, 'group-row-dragover': dragOverIndex === i && dragIndex !== i }"
          @dragover.prevent="dragOverIndex = i" @drop.prevent="onDrop">
          <span class="group-drag-handle" title="Drag to reorder" draggable="true"
            @dragstart="onDragStart(i, $event)" @dragend="dragIndex = dragOverIndex = null">⠿</span>
          <input type="color" class="group-color" :value="g.color" :aria-label="`Colour for ${g.name}`"
            @input="g.color = ($event.target as HTMLInputElement).value" @change="save(g)" />
          <div class="group-row-main">
            <input v-model="g.name" class="group-name" type="text" maxlength="30" :aria-label="`Name of ${g.savedName}`"
              @keydown.enter="($event.target as HTMLInputElement).blur()" @blur="g.name.trim() !== g.savedName && save(g)" />
            <div class="group-row-meta">
              <span class="user-group-tag" :style="{ background: g.color }">{{ g.name.trim() || g.savedName }}</span>
              <span>{{ plural(g.memberCount, "member") }} · {{ plural(g.albumCount, "album") }}</span>
              <span v-if="status[g.id]" class="group-status" :class="{ error: status[g.id].error }">{{ status[g.id].text }}</span>
            </div>
          </div>
          <button class="btn-icon" title="Delete group" :aria-label="`Delete ${g.savedName}`" @click="remove(g)">🗑️</button>
        </div>
        <p v-if="!groups.length" class="empty">No groups yet.</p>
      </div>

      <form class="group-add" @submit.prevent="add">
        <input v-model="newColor" type="color" class="group-color" aria-label="Colour for the new group" />
        <input v-model="newName" class="group-name" type="text" maxlength="30" placeholder="New group name" />
        <button class="btn-primary btn-small" :disabled="adding || !newName.trim()">{{ adding ? "Adding…" : "Add group" }}</button>
      </form>
      <p v-if="addError" class="error">{{ addError }}</p>
      <p v-if="orderError" class="error">{{ orderError }}</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import PageHeader from "../components/PageHeader.vue";
import { useCurrentUser } from "../composables/useCurrentUser";
import { authHeaders, authJsonHeaders } from "../utils/session";

interface Group { id: number; name: string; color: string; memberCount: number; albumCount: number; savedName: string; savedColor: string }

const { currentUser } = useCurrentUser();
const isAdmin = computed(() => (currentUser.value?.level ?? 0) >= 2);
const groups = ref<Group[]>([]);
const loading = ref(true);
const status = ref<Record<number, { text: string; error?: boolean }>>({});
const newName = ref("");
const newColor = ref("#89b4fa");
const adding = ref(false);
const addError = ref("");

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

async function load() {
  const res = await fetch("/api/admin/groups", { headers: authHeaders() });
  if (res.ok) groups.value = (await res.json()).map((g: Group) => ({ ...g, savedName: g.name, savedColor: g.color }));
  loading.value = false;
}

async function save(g: Group) {
  const name = g.name.trim();
  if (!name) { g.name = g.savedName; return; }
  status.value[g.id] = { text: "Saving…" };
  const res = await fetch(`/api/admin/groups/${g.id}`, { method: "PUT", headers: authJsonHeaders(), body: JSON.stringify({ name, color: g.color }) });
  if (res.ok) {
    g.name = g.savedName = name;
    g.savedColor = g.color;
    status.value[g.id] = { text: "Saved" };
    setTimeout(() => { if (status.value[g.id]?.text === "Saved") delete status.value[g.id]; }, 1500);
  } else {
    const err = await res.json().catch(() => ({}));
    g.name = g.savedName;
    g.color = g.savedColor;
    status.value[g.id] = { text: err.error ?? "Couldn't save", error: true };
  }
}

async function remove(g: Group) {
  const effects = [
    g.memberCount ? `remove it from ${plural(g.memberCount, "person")}`.replace("persons", "people") : "",
    g.albumCount ? `unlink ${plural(g.albumCount, "album")} (only the albums' own members will still see them)` : "",
  ].filter(Boolean);
  const msg = `Delete the ${g.savedName} group?` + (effects.length ? ` This will ${effects.join(" and ")}.` : "");
  if (!confirm(msg)) return;
  const res = await fetch(`/api/admin/groups/${g.id}`, { method: "DELETE", headers: authHeaders() });
  if (res.ok) groups.value = groups.value.filter(x => x.id !== g.id);
  else status.value[g.id] = { text: "Couldn't delete", error: true };
}

async function add() {
  const name = newName.value.trim();
  if (!name) return;
  adding.value = true;
  addError.value = "";
  const res = await fetch("/api/admin/groups", { method: "POST", headers: authJsonHeaders(), body: JSON.stringify({ name, color: newColor.value }) });
  if (res.ok) {
    const g = await res.json();
    groups.value.push({ ...g, memberCount: 0, albumCount: 0, savedName: g.name, savedColor: g.color });
    newName.value = "";
  } else {
    addError.value = (await res.json().catch(() => ({}))).error ?? "Couldn't add the group";
  }
  adding.value = false;
}

// Reordering: drag by the handle (desktop only; touch screens don't fire HTML drag events).
const dragIndex = ref<number | null>(null);
const dragOverIndex = ref<number | null>(null);
const orderError = ref("");

function onDragStart(i: number, e: DragEvent) {
  dragIndex.value = i;
  e.dataTransfer?.setData("text/plain", String(i)); // Firefox won't start a drag without data
  const row = (e.target as HTMLElement).closest(".group-row");
  if (row && e.dataTransfer) e.dataTransfer.setDragImage(row, 20, 20);
}

function onDrop() {
  const from = dragIndex.value, to = dragOverIndex.value;
  dragIndex.value = dragOverIndex.value = null;
  if (from !== null && to !== null) move(from, to);
}

async function move(from: number, to: number) {
  if (from === to || to < 0 || to >= groups.value.length) return;
  const before = [...groups.value];
  const [g] = groups.value.splice(from, 1);
  groups.value.splice(to, 0, g);
  orderError.value = "";
  const res = await fetch("/api/admin/groups/order", { method: "PUT", headers: authJsonHeaders(), body: JSON.stringify({ ids: groups.value.map(x => x.id) }) });
  if (!res.ok) { groups.value = before; orderError.value = "Couldn't save the new order"; }
}

onMounted(load);
</script>

<style scoped>
.groups-intro { color: #a6adc8; font-size: 0.9rem; margin-bottom: 20px; }
.groups-list { display: flex; flex-direction: column; gap: 10px; }
.group-row { display: flex; align-items: center; gap: 14px; background: #313244; border-radius: 10px; padding: 12px 16px; }
.group-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.group-row-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; color: #a6adc8; font-size: 0.85rem; }
.group-name { background: transparent; border: 1px solid transparent; border-radius: 6px; padding: 4px 8px; margin-left: -8px; color: #cdd6f4; font-size: 1rem; font-weight: 600; width: 100%; max-width: 280px; outline: none; }
.group-name:hover { border-color: #45475a; }
.group-name:focus { border-color: #cba6f7; background: #1e1e2e; }
.group-color { width: 40px; height: 40px; flex-shrink: 0; padding: 0; border: none; border-radius: 8px; background: none; cursor: pointer; }
.group-color::-webkit-color-swatch-wrapper { padding: 0; }
.group-color::-webkit-color-swatch { border: 2px solid #45475a; border-radius: 8px; }
.group-color::-moz-color-swatch { border: 2px solid #45475a; border-radius: 8px; }
.group-drag-handle { color: #6c7086; font-size: 1.2rem; cursor: grab; user-select: none; padding: 4px 0; }
.group-drag-handle:active { cursor: grabbing; }
@media (hover: none) { .group-drag-handle { display: none; } }
.group-row-dragging { opacity: 0.4; }
.group-row-dragover { box-shadow: 0 -3px 0 #cba6f7; }
.group-status { font-size: 0.8rem; }
.group-status.error { color: #f38ba8; }
.group-add { display: flex; align-items: center; gap: 14px; margin-top: 20px; padding: 12px 16px; border: 1px dashed #45475a; border-radius: 10px; }
.group-add .group-name { margin-left: 0; flex: 1; background: #313244; border-color: #45475a; font-weight: 400; max-width: none; }
.group-add .group-name:focus { border-color: #cba6f7; }
@media (max-width: 480px) { .group-row, .group-add { gap: 10px; padding: 10px 12px; } }
</style>
