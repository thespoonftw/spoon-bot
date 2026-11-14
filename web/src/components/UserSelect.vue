<template>
  <div ref="root" class="user-select" :class="{ open }" @keydown="onKeydown">
    <button type="button" class="user-select-button" aria-haspopup="listbox" :aria-expanded="open" @click="toggle">
      <template v-if="selected">
        <MemberAvatar :avatar-url="selected.avatarUrl" :name="baseName(selected)" />
        <span class="user-select-label">{{ dropdownName(selected, users) }}</span>
      </template>
      <span v-else class="user-select-label user-select-placeholder">Choose someone…</span>
      <span class="user-select-caret" aria-hidden="true">▾</span>
    </button>
    <ul v-if="open" ref="list" class="user-select-menu" role="listbox">
      <li v-for="(u, i) in sorted" :key="u.userId" role="option" :aria-selected="u.userId === modelValue"
        class="user-select-option" :class="{ active: i === activeIndex, selected: u.userId === modelValue }"
        @mouseenter="activeIndex = i" @click="choose(u.userId)">
        <MemberAvatar :avatar-url="u.avatarUrl" :name="baseName(u)" />
        <span class="user-select-label">{{ dropdownName(u, users) }}</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onBeforeUnmount } from "vue";
import MemberAvatar from "./MemberAvatar.vue";
import { baseName, dropdownName, sortByName, type Nameable } from "../utils/names";

interface User extends Nameable { userId: string; avatarUrl?: string }

const props = defineProps<{ modelValue: string; users: User[] }>();
const emit = defineEmits<{ (e: "update:modelValue", v: string): void; (e: "change", v: string): void }>();

const root = ref<HTMLElement | null>(null);
const list = ref<HTMLElement | null>(null);
const open = ref(false);
const activeIndex = ref(-1);
const sorted = computed(() => sortByName(props.users));
const selected = computed(() => props.users.find(u => u.userId === props.modelValue));

function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) close();
}

function show() {
  open.value = true;
  activeIndex.value = Math.max(0, sorted.value.findIndex(u => u.userId === props.modelValue));
  document.addEventListener("mousedown", onDocClick);
  nextTick(scrollActiveIntoView);
}

function close() {
  open.value = false;
  document.removeEventListener("mousedown", onDocClick);
}

function toggle() { open.value ? close() : show(); }

function choose(userId: string) {
  close();
  if (userId === props.modelValue) return;
  emit("update:modelValue", userId);
  emit("change", userId);
}

function scrollActiveIntoView() {
  const el = list.value?.children[activeIndex.value] as HTMLElement | undefined;
  el?.scrollIntoView({ block: "nearest" });
}

function onKeydown(e: KeyboardEvent) {
  if (!open.value) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); show(); }
    return;
  }
  const n = sorted.value.length;
  if (e.key === "Escape") { e.preventDefault(); close(); }
  else if (e.key === "ArrowDown") { e.preventDefault(); activeIndex.value = Math.min(n - 1, activeIndex.value + 1); scrollActiveIntoView(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); activeIndex.value = Math.max(0, activeIndex.value - 1); scrollActiveIntoView(); }
  else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    const u = sorted.value[activeIndex.value];
    if (u) choose(u.userId);
  } else if (e.key === "Tab") close();
  else if (e.key.length === 1 && /\S/.test(e.key)) {
    // Type a letter to jump to the next person whose name starts with it, like a native select.
    const k = e.key.toLowerCase();
    for (let step = 1; step <= n; step++) {
      const i = (activeIndex.value + step) % n;
      if (baseName(sorted.value[i]).toLowerCase().startsWith(k)) { activeIndex.value = i; scrollActiveIntoView(); break; }
    }
  }
}

onBeforeUnmount(() => document.removeEventListener("mousedown", onDocClick));
</script>
