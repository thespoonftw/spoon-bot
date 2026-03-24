<template>
  <div class="modal-overlay" v-if="modelValue">
    <div class="modal" :style="drag.style.value">
      <button class="modal-close" @click="emit('update:modelValue', false)">✕</button>
      <h2 class="modal-drag-handle" @mousedown="drag.onMouseDown">Members</h2>
      <div class="members-modal-list">
        <div v-for="member in allMembers.filter(m => !deletedMemberIds.has(m.userId))" :key="member.userId" :class="['members-modal-row', { 'member-hidden': member.hidden }]">
          <MemberAvatar :avatar-url="member.avatarUrl" :name="member.firstName || member.displayName" />
          <span class="members-modal-name">{{ member.firstName || member.displayName }}</span>
          <span v-if="member.rsvpStatus" :class="['rsvp-badge', 'rsvp-' + member.rsvpStatus]">{{ rsvpLabel(member.rsvpStatus) }}</span>
          <span v-if="member.hidden" class="rsvp-badge">hidden</span>
          <template v-if="member.userId.startsWith('guest_') || !member.rsvpStatus">
            <button class="btn-remove" @click="deleteMember(member.userId)" title="Remove">delete</button>
          </template>
          <template v-else-if="member.rsvpStatus !== 'decline'">
            <button v-if="!member.hidden" class="btn-remove" @click="hideMember(member.userId)" title="Hide from album">hide</button>
            <button v-else class="btn-remove btn-unhide" @click="unhideMember(member.userId)" title="Show in album">show</button>
          </template>
        </div>
      </div>
      <div class="members-add-section" style="margin-top:8px">
        <button class="btn-secondary btn-small" @click="showMemberPicker = true" :disabled="addableUsers.length === 0">+ Add Existing User</button>
      </div>
      <div v-if="addMemberError" class="error" style="margin-top:8px;font-size:0.85em;padding:8px 12px">{{ addMemberError }}</div>
      <div class="members-add-section">
        <input v-model="addMemberName" class="members-add-input" type="text" placeholder="Or type a new person's name…" @input="addMemberError = ''" />
        <button class="btn-secondary btn-small" @click="addNewMember" :disabled="!addMemberName.trim()">Add</button>
      </div>
    </div>
  </div>

  <Teleport to="body">
    <div class="modal-overlay" v-if="showMemberPicker" style="z-index:200">
      <div class="modal" :style="dragPicker.style.value">
        <button class="modal-close" @click="showMemberPicker = false">✕</button>
        <h2 class="modal-drag-handle" @mousedown="dragPicker.onMouseDown">Add User</h2>
        <div class="members-modal-list">
          <div v-for="u in addableUsers" :key="u.userId" class="members-modal-row tagging-row" @click="pickAndAddMember(u.userId)">
            <MemberAvatar :avatar-url="u.avatarUrl" :name="u.firstName || u.displayName" />
            <span class="members-modal-name">{{ u.firstName || u.displayName }}</span>
          </div>
          <p v-if="addableUsers.length === 0" class="empty" style="font-size:0.85em;padding:6px 0">No more users to add.</p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import MemberAvatar from "./MemberAvatar.vue";
import { authHeaders, authJsonHeaders } from "../utils/session";
import { useDraggable } from "../utils/draggable";

const drag = useDraggable();
const dragPicker = useDraggable();

interface Member { userId: string; displayName: string; firstName?: string; avatarUrl?: string }
interface AllMember extends Member { hidden: number; rsvpStatus?: string }

const props = defineProps<{ modelValue: boolean; channelId: string }>();
const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  "members-updated": [visible: Member[], all: AllMember[]];
}>();

const allMembers = ref<AllMember[]>([]);
const deletedMemberIds = ref(new Set<string>());
const allUsers = ref<Member[]>([]);
const addMemberUserId = ref("");
const addMemberName = ref("");
const addMemberError = ref("");
const showMemberPicker = ref(false);

const addableUsers = computed(() => {
  const memberIds = new Set(allMembers.value.map(m => m.userId));
  return allUsers.value.filter(u => !memberIds.has(u.userId));
});

watch(() => props.modelValue, async (v) => {
  if (!v) return;
  drag.reset();
  deletedMemberIds.value = new Set();
  addMemberName.value = "";
  addMemberError.value = "";
  addMemberUserId.value = "";
  const [membersRes, usersRes] = await Promise.all([
    fetch(`/api/album/${props.channelId}/members`, { headers: authHeaders() }),
    fetch("/api/users"),
  ]);
  if (membersRes.ok) {
    const raw: AllMember[] = await membersRes.json();
    const memberOrder = (u: AllMember) => {
      if (u.userId.startsWith("guest_")) return 2;
      if (u.rsvpStatus === "coming") return 0;
      if (!u.rsvpStatus) return 1;
      if (u.rsvpStatus === "maybe") return 3;
      if (u.rsvpStatus === "lurking") return 4;
      return 5;
    };
    allMembers.value = raw.sort((a, b) =>
      memberOrder(a) - memberOrder(b) || (a.firstName || a.displayName).localeCompare(b.firstName || b.displayName)
    );
  }
  if (usersRes.ok) allUsers.value = await usersRes.json();
});

function visibleMembers(): Member[] {
  return allMembers.value.filter(m => !m.hidden && !deletedMemberIds.value.has(m.userId) && m.rsvpStatus !== "decline");
}

function notifyUpdate() {
  emit("members-updated", visibleMembers(), [...allMembers.value]);
}

async function addExistingMember() {
  if (!addMemberUserId.value) return;
  const res = await fetch(`/api/album/${props.channelId}/members`, {
    method: "POST",
    headers: authJsonHeaders(),
    body: JSON.stringify({ userId: addMemberUserId.value }),
  });
  if (res.ok) {
    const member: AllMember = await res.json();
    allMembers.value.push(member);
    addMemberUserId.value = "";
    notifyUpdate();
  }
}

async function pickAndAddMember(userId: string) {
  showMemberPicker.value = false;
  addMemberUserId.value = userId;
  await addExistingMember();
}

async function addNewMember() {
  if (!addMemberName.value.trim()) return;
  const trimmed = addMemberName.value.trim();
  addMemberError.value = "";
  const allKnown = [...allMembers.value, ...allUsers.value];
  const dup = allKnown.find(u => (u.firstName || u.displayName).toLowerCase() === trimmed.toLowerCase());
  if (dup) {
    addMemberError.value = `"${trimmed}" is already someone's name`;
    return;
  }
  const res = await fetch(`/api/album/${props.channelId}/members`, {
    method: "POST",
    headers: authJsonHeaders(),
    body: JSON.stringify({ name: trimmed }),
  });
  if (res.ok) {
    const member: AllMember = await res.json();
    allMembers.value.push(member);
    addMemberName.value = "";
    notifyUpdate();
  }
}

async function deleteMember(userId: string) {
  const res = await fetch(`/api/album/${props.channelId}/members/${userId}?remove=true`, { method: "DELETE", headers: authHeaders() });
  if (res.ok) {
    deletedMemberIds.value = new Set([...deletedMemberIds.value, userId]);
    allMembers.value = allMembers.value.filter(m => m.userId !== userId);
    notifyUpdate();
  }
}

async function hideMember(userId: string) {
  const res = await fetch(`/api/album/${props.channelId}/members/${userId}`, { method: "DELETE", headers: authHeaders() });
  if (res.ok) {
    const m = allMembers.value.find(m => m.userId === userId);
    if (m) m.hidden = 1;
    notifyUpdate();
  }
}

async function unhideMember(userId: string) {
  const res = await fetch(`/api/album/${props.channelId}/members/${userId}`, { method: "PATCH", headers: authHeaders() });
  if (res.ok) {
    const m = allMembers.value.find(m => m.userId === userId);
    if (m) m.hidden = 0;
    notifyUpdate();
  }
}

function rsvpLabel(status: string): string {
  return { coming: "Attended", maybe: "Maybe", decline: "Declined", lurking: "Lurking" }[status] ?? status;
}
</script>
