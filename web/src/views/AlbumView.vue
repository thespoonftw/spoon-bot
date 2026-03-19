<template>
  <div class="page">
    <router-link to="/albums" class="back">← All Albums</router-link>
    <template v-if="album">
      <div class="album-header">
        <div>
          <div style="display:flex;align-items:center;gap:8px">
            <h1>{{ album.groupName }}</h1>
            <button class="btn-icon" @click="openEdit" title="Edit album">✏️</button>
          </div>
          <p v-if="album.dateText" class="date">{{ album.dateText }}</p>
          <p v-if="album.location" class="meta">📍 {{ album.location }}</p>
        </div>
        <div class="upload-area">
          <button class="btn-primary" @click="triggerUpload" :disabled="uploading">
            {{ uploading ? `Uploading ${uploadProgress}…` : '+ Upload Photos' }}
          </button>
          <input ref="fileInput" type="file" accept="image/*" multiple style="display:none" @change="onFilesSelected" />
        </div>
      </div>

      <p v-if="uploadError" class="upload-error">{{ uploadError }}</p>

      <div v-if="album.members.length > 0" class="members-section">
        <div class="members-header">
          <div class="members-list">
            <div v-for="member in album.members" :key="member.userId" class="member-chip" :title="member.firstName || member.displayName">
              <img v-if="member.avatarUrl" :src="member.avatarUrl" class="member-avatar" />
              <span v-else class="member-avatar member-avatar-placeholder">{{ (member.firstName || member.displayName)[0] }}</span>
              <span class="member-name">{{ member.firstName || member.displayName }}</span>
            </div>
            <button class="btn-icon" @click="openEditMembers" title="Edit members">✏️</button>
          </div>
        </div>
      </div>

      <p v-if="album.photos.length === 0" class="empty" style="margin-top:24px">No photos yet.</p>
      <div class="gallery">
        <div v-for="(photo, i) in album.photos" :key="photo.id" class="photo-item" @click="openLightbox(i)">
          <img :src="thumbUrl(photo.url)" loading="lazy" @error="($event.target as HTMLImageElement).src = photo.url" />
          <button class="photo-delete-btn" @click.stop="confirmDelete(photo)" title="Delete photo">🗑</button>
          <div class="photo-meta">
            <span v-if="photo.uploadedByName" class="uploader">{{ photo.uploadedByName }}</span>
            <span v-if="photo.takenAt" class="upload-time">{{ formatTime(photo.takenAt) }}</span>
          </div>
        </div>
      </div>
      <div class="gallery-mobile">
        <div v-for="(photo, i) in album.photos" :key="photo.id" class="photo-item-mobile" @click="openLightbox(i)">
          <img :src="photo.url" loading="lazy" />
          <div class="photo-meta">
            <span v-if="photo.uploadedByName" class="uploader">{{ photo.uploadedByName }}</span>
            <span v-if="photo.takenAt" class="upload-time">{{ formatTime(photo.takenAt) }}</span>
          </div>
        </div>
      </div>
    </template>
    <p v-else class="empty">Album not found.</p>
  </div>


  <!-- Delete Photo Confirmation Modal -->
  <div class="modal-overlay" v-if="deletingPhoto">
    <div class="modal">
      <button class="modal-close" @click="deletingPhoto = null">✕</button>
      <h2>Delete Photo?</h2>
      <p style="color:#a6adc8;margin-bottom:20px">This cannot be undone.</p>
      <div class="modal-actions">
        <button class="btn-danger" @click="deletePhoto" :disabled="deleting">{{ deleting ? 'Deleting…' : 'Delete' }}</button>
      </div>
    </div>
  </div>

  <!-- Edit Album Modal -->
  <div class="modal-overlay" v-if="showEdit">
    <div class="modal">
      <button class="modal-close" @click="showEdit = false">✕</button>
      <h2>Edit Album</h2>
      <div class="form-group">
        <label>Name</label>
        <input v-model="editForm.name" type="text" />
      </div>
      <div class="form-group">
        <label>Location</label>
        <input v-model="editForm.location" type="text" />
      </div>
      <div class="form-group">
        <label>Start Date</label>
        <input v-model="editForm.startDate" type="date" />
      </div>
      <div class="form-group">
        <label>End Date</label>
        <div v-if="editForm.endDate" style="display:flex;gap:8px;align-items:center">
          <input v-model="editForm.endDate" type="date" style="flex:1" />
          <button type="button" class="btn-remove" @click="editForm.endDate = ''">remove</button>
        </div>
        <button v-else type="button" class="btn-secondary btn-small" @click="editForm.endDate = editForm.startDate">+ Add end date</button>
      </div>
      <div v-if="editError" class="error">{{ editError }}</div>
      <div class="modal-actions">
        <button class="btn-primary" @click="saveEdit" :disabled="saving">{{ saving ? "Saving…" : "Save" }}</button>
      </div>
    </div>
  </div>

  <!-- Edit Members Modal -->
  <div class="modal-overlay" v-if="showEditMembers">
    <div class="modal">
      <button class="modal-close" @click="showEditMembers = false">✕</button>
      <h2>Members</h2>
      <div class="members-modal-list">
        <div v-for="member in allMembers" :key="member.userId" :class="['members-modal-row', { 'member-hidden': member.hidden }]">
          <img v-if="member.avatarUrl" :src="member.avatarUrl" class="member-avatar" />
          <span v-else class="member-avatar member-avatar-placeholder">{{ (member.firstName || member.displayName)[0] }}</span>
          <span class="members-modal-name">{{ member.firstName || member.displayName }}</span>
          <span v-if="member.rsvpStatus" :class="['rsvp-badge', 'rsvp-' + member.rsvpStatus]">{{ rsvpLabel(member.rsvpStatus) }}</span>
          <span v-if="member.hidden" class="rsvp-badge">hidden</span>
          <template v-if="member.userId.startsWith('guest_')">
            <button class="btn-remove" @click="deleteMember(member.userId)" title="Remove">delete</button>
          </template>
          <template v-else>
            <button v-if="!member.hidden" class="btn-remove" @click="hideMember(member.userId)" title="Hide from album">hide</button>
            <button v-else class="btn-remove btn-unhide" @click="unhideMember(member.userId)" title="Show in album">show</button>
          </template>
        </div>
      </div>
      <div class="members-add-section">
        <select v-model="addMemberUserId" class="members-add-select" @change="addMemberName = ''">
          <option value="">— Add existing user —</option>
          <option v-for="u in addableUsers" :key="u.userId" :value="u.userId">{{ u.firstName || u.displayName }}</option>
        </select>
        <button class="btn-secondary btn-small" @click="addExistingMember" :disabled="!addMemberUserId">Add</button>
      </div>
      <div class="members-add-section">
        <input v-model="addMemberName" class="members-add-input" type="text" placeholder="Or type a new person's name…" @input="addMemberUserId = ''" />
        <button class="btn-secondary btn-small" @click="addNewMember" :disabled="!addMemberName.trim()">Add</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import PhotoSwipe from "photoswipe";
import "photoswipe/style.css";

interface Photo { id: number; url: string; filename?: string; uploadedById?: string; uploadedByName?: string; uploadedAt: string; takenAt?: string; width?: number; height?: number }
interface Member { userId: string; displayName: string; firstName?: string; avatarUrl?: string; rsvpStatus?: string }
interface Album { channelId: string; groupName: string; dateText?: string; location?: string; startDate?: string; endDate?: string; photos: Photo[]; members: Member[] }

const route = useRoute();
const album = ref<Album | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const uploadProgress = ref("");
const uploadError = ref("");

const deletingPhoto = ref<Photo | null>(null);
const deleting = ref(false);

const showEdit = ref(false);
const saving = ref(false);
const editError = ref("");
const editForm = ref({ name: "", location: "", startDate: "", endDate: "" });

interface AllMember extends Member { hidden: number; rsvpStatus?: string }
const showEditMembers = ref(false);
const allMembers = ref<AllMember[]>([]);
const allUsers = ref<Member[]>([]);
const addMemberUserId = ref("");
const addMemberName = ref("");
const addableUsers = computed(() => {
  const memberIds = new Set(allMembers.value.map(m => m.userId));
  return allUsers.value.filter(u => !memberIds.has(u.userId));
});

onMounted(async () => {
  const res = await fetch(`/api/album/${route.params.channelId}`);
  if (res.ok) album.value = await res.json();
});

function confirmDelete(photo: Photo) { deletingPhoto.value = photo; }

async function deletePhoto() {
  if (!album.value || !deletingPhoto.value) return;
  deleting.value = true;
  const session = localStorage.getItem("snek_session");
  const res = await fetch(`/api/album/${album.value.channelId}/photos/${deletingPhoto.value.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session}` },
  });
  deleting.value = false;
  if (res.ok) {
    album.value.photos = album.value.photos.filter(p => p.id !== deletingPhoto.value!.id);
    deletingPhoto.value = null;
  }
}

function openLightbox(index: number) {
  if (!album.value) return;
  const photos = album.value.photos;
  const pswp = new PhotoSwipe({
    dataSource: photos.map(p => ({ src: p.url, width: p.width || 1200, height: p.height || 900 })),
    index,
    bgOpacity: 0.92,
    zoom: true,
    close: true,
    counter: true,
    arrowKeys: true,
  });
  pswp.on("uiRegister", () => {
    pswp.ui!.registerElement({
      name: "photo-caption",
      order: 9,
      isButton: false,
      appendTo: "root",
      onInit: (el) => {
        const update = () => {
          const p = photos[pswp.currIndex];
          el.textContent = [p?.uploadedByName, p?.takenAt ? formatTime(p.takenAt) : ""].filter(Boolean).join(" · ");
        };
        pswp.on("change", update);
        update();
      },
    });
  });
  pswp.init();
}

function openEdit() {
  if (!album.value) return;
  editForm.value = {
    name: album.value.groupName,
    location: album.value.location ?? "",
    startDate: album.value.startDate ?? "",
    endDate: album.value.endDate ?? "",
  };
  editError.value = "";
  showEdit.value = true;
}

async function saveEdit() {
  if (!album.value) return;
  editError.value = "";
  saving.value = true;
  const session = localStorage.getItem("snek_session");
  const res = await fetch(`/api/album/${album.value.channelId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session}` },
    body: JSON.stringify({
      name: editForm.value.name.trim(),
      location: editForm.value.location.trim(),
      startDate: editForm.value.startDate || undefined,
      endDate: editForm.value.endDate || undefined,
    }),
  });
  saving.value = false;
  if (res.ok) {
    const updated = await res.json();
    album.value = { ...album.value, ...updated };
    showEdit.value = false;
  } else {
    editError.value = "Failed to save. Try again.";
  }
}

async function openEditMembers() {
  if (!album.value) return;
  const session = localStorage.getItem("snek_session");
  const [membersRes, usersRes] = await Promise.all([
    fetch(`/api/album/${album.value.channelId}/members`, { headers: { Authorization: `Bearer ${session}` } }),
    fetch("/api/users"),
  ]);
  if (membersRes.ok) {
    const raw: AllMember[] = await membersRes.json();
    allMembers.value = raw.sort((a, b) => {
      const ag = a.userId.startsWith("guest_"), bg = b.userId.startsWith("guest_");
      if (ag !== bg) return ag ? 1 : -1;
      return (a.hidden - b.hidden) || (a.firstName || a.displayName).localeCompare(b.firstName || b.displayName);
    });
  }
  if (usersRes.ok) allUsers.value = await usersRes.json();
  addMemberUserId.value = "";
  addMemberName.value = "";
  showEditMembers.value = true;
}

async function addExistingMember() {
  if (!album.value || !addMemberUserId.value) return;
  const session = localStorage.getItem("snek_session");
  const res = await fetch(`/api/album/${album.value.channelId}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session}` },
    body: JSON.stringify({ userId: addMemberUserId.value }),
  });
  if (res.ok) {
    const member: AllMember = await res.json();
    allMembers.value.push(member);
    album.value.members.push(member);
    addMemberUserId.value = "";
  }
}

async function addNewMember() {
  if (!album.value || !addMemberName.value.trim()) return;
  const session = localStorage.getItem("snek_session");
  const res = await fetch(`/api/album/${album.value.channelId}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session}` },
    body: JSON.stringify({ name: addMemberName.value.trim() }),
  });
  if (res.ok) {
    const member: AllMember = await res.json();
    allMembers.value.push(member);
    album.value.members.push(member);
    addMemberName.value = "";
  }
}

async function deleteMember(userId: string) {
  if (!album.value) return;
  const session = localStorage.getItem("snek_session");
  const res = await fetch(`/api/album/${album.value.channelId}/members/${userId}`, { method: "DELETE", headers: { Authorization: `Bearer ${session}` } });
  if (res.ok) {
    allMembers.value = allMembers.value.filter(m => m.userId !== userId);
    album.value.members = album.value.members.filter(m => m.userId !== userId);
  }
}

async function hideMember(userId: string) {
  if (!album.value) return;
  const session = localStorage.getItem("snek_session");
  const res = await fetch(`/api/album/${album.value.channelId}/members/${userId}`, { method: "DELETE", headers: { Authorization: `Bearer ${session}` } });
  if (res.ok) {
    const m = allMembers.value.find(m => m.userId === userId);
    if (m) m.hidden = 1;
    album.value.members = album.value.members.filter(m => m.userId !== userId);
  }
}

async function unhideMember(userId: string) {
  if (!album.value) return;
  const session = localStorage.getItem("snek_session");
  const res = await fetch(`/api/album/${album.value.channelId}/members/${userId}`, { method: "PATCH", headers: { Authorization: `Bearer ${session}` } });
  if (res.ok) {
    const m = allMembers.value.find(m => m.userId === userId);
    if (m) {
      m.hidden = 0;
      if (!album.value!.members.find(x => x.userId === userId)) album.value!.members.push(m);
    }
  }
}

function rsvpLabel(status: string): string {
  return { coming: "✅ Coming", maybe: "🤔 Maybe", decline: "❌ Can't go", lurking: "👀 Lurking" }[status] ?? status;
}

function triggerUpload() {
  uploadError.value = "";
  fileInput.value?.click();
}

async function onFilesSelected(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files ?? []);
  if (!files.length || !album.value) return;
  uploading.value = true;
  uploadError.value = "";
  const session = localStorage.getItem("snek_session");
  for (let i = 0; i < files.length; i++) {
    uploadProgress.value = `${i + 1}/${files.length}`;
    const fd = new FormData();
    fd.append("photo", files[i]);
    const res = await fetch(`/api/album/${album.value.channelId}/photos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session}` },
      body: fd,
    });
    if (res.ok) {
      const photo: Photo = await res.json();
      album.value.photos.push(photo);
    } else {
      uploadError.value = `Failed to upload ${files[i].name}`;
    }
  }
  uploading.value = false;
  uploadProgress.value = "";
  (e.target as HTMLInputElement).value = "";
}

function thumbUrl(url: string): string {
  return url.replace("/uploads/", "/thumbnails/");
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
</script>
