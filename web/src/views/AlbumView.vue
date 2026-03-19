<template>
  <div class="page">
    <router-link to="/albums" class="back">← All Albums</router-link>
    <template v-if="album">
      <div class="album-header">
        <div>
          <h1>{{ album.groupName }}</h1>
          <p v-if="album.dateText" class="date">{{ album.dateText }}</p>
          <p v-if="album.location" class="meta">📍 {{ album.location }}</p>
        </div>
        <div class="upload-area" style="display:flex;gap:10px">
          <button class="btn-secondary" @click="openEdit">Edit</button>
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
            <div v-for="member in album.members" :key="member.userId" class="member-chip" :title="member.displayName">
              <img v-if="member.avatarUrl" :src="member.avatarUrl" class="member-avatar" />
              <span v-else class="member-avatar member-avatar-placeholder">{{ member.displayName[0] }}</span>
              <span class="member-name">{{ member.displayName }}</span>
            </div>
          </div>
          <button class="btn-secondary btn-small" @click="openEditMembers">Edit</button>
        </div>
      </div>

      <p v-if="album.photos.length === 0" class="empty" style="margin-top:24px">No photos yet.</p>
      <div class="gallery">
        <div v-for="(photo, i) in album.photos" :key="photo.id" class="photo-item" @click="lightboxIndex = i">
          <img :src="thumbUrl(photo.url)" loading="lazy" @error="($event.target as HTMLImageElement).src = photo.url" />
          <div class="photo-meta">
            <span v-if="photo.uploadedByName" class="uploader">{{ photo.uploadedByName }}</span>
            <span class="upload-time">{{ formatTime(photo.uploadedAt) }}</span>
          </div>
        </div>
      </div>
      <div class="gallery-mobile">
        <div v-for="(photo, i) in album.photos" :key="photo.id" class="photo-item-mobile" @click="lightboxIndex = i">
          <img :src="photo.url" loading="lazy" />
          <div class="photo-meta">
            <span v-if="photo.uploadedByName" class="uploader">{{ photo.uploadedByName }}</span>
            <span class="upload-time">{{ formatTime(photo.uploadedAt) }}</span>
          </div>
        </div>
      </div>
    </template>
    <p v-else class="empty">Album not found.</p>
  </div>

  <!-- Lightbox -->
  <div class="lightbox-overlay" v-if="focusedPhoto"
    @click="lightboxIndex = null"
    @touchstart.passive="onTouchStart"
    @touchmove.passive="onTouchMove"
    @touchend.passive="onTouchEnd">
    <button class="lightbox-arrow lightbox-prev" @click.stop="lightboxPrev">‹</button>
    <div class="lightbox-content" @click.stop>
      <img :src="focusedPhoto.url" class="lightbox-img"
        :style="{ transform: `translateX(${swipeDelta}px)`, transition: swipeTransition ? 'transform 0.25s ease' : 'none' }" />
      <div class="lightbox-meta">
        <span v-if="focusedPhoto.uploadedByName" class="lightbox-uploader">{{ focusedPhoto.uploadedByName }}</span>
        <span class="lightbox-date">{{ formatTime(focusedPhoto.uploadedAt) }}</span>
      </div>
    </div>
    <button class="lightbox-arrow lightbox-next" @click.stop="lightboxNext">›</button>
    <button class="lightbox-close" @click.stop="lightboxIndex = null">✕</button>
  </div>

  <!-- Edit Album Modal -->
  <div class="modal-overlay" v-if="showEdit" @click.self="showEdit = false">
    <div class="modal">
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
        <label>End Date <span class="optional">(optional)</span></label>
        <input v-model="editForm.endDate" type="date" />
      </div>
      <div v-if="editError" class="error">{{ editError }}</div>
      <div class="modal-actions">
        <button class="btn-secondary" @click="showEdit = false">Cancel</button>
        <button class="btn-primary" @click="saveEdit" :disabled="saving">
          {{ saving ? "Saving…" : "Save" }}
        </button>
      </div>
    </div>
  </div>

  <!-- Edit Members Modal -->
  <div class="modal-overlay" v-if="showEditMembers" @click.self="showEditMembers = false">
    <div class="modal">
      <h2>Members</h2>
      <div class="members-modal-list">
        <div v-for="member in allMembers" :key="member.userId" :class="['members-modal-row', { 'member-hidden': member.hidden }]">
          <img v-if="member.avatarUrl" :src="member.avatarUrl" class="member-avatar" />
          <span v-else class="member-avatar member-avatar-placeholder">{{ member.displayName[0] }}</span>
          <span class="members-modal-name">{{ member.displayName }}</span>
          <span v-if="member.rsvpStatus" :class="['rsvp-badge', 'rsvp-' + member.rsvpStatus]">{{ rsvpLabel(member.rsvpStatus) }}</span>
          <span v-if="member.hidden" class="rsvp-badge">hidden</span>
          <button v-if="!member.hidden" class="btn-remove" @click="hideMember(member.userId)" title="Hide from album">hide</button>
          <button v-else class="btn-remove btn-unhide" @click="unhideMember(member.userId)" title="Show in album">show</button>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn-primary" @click="showEditMembers = false">Done</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRoute } from "vue-router";

interface Photo { id: number; url: string; filename?: string; uploadedById?: string; uploadedByName?: string; uploadedAt: string }
interface Member { userId: string; displayName: string; avatarUrl?: string; rsvpStatus?: string }
interface Album { channelId: string; groupName: string; dateText?: string; location?: string; startDate?: string; endDate?: string; photos: Photo[]; members: Member[] }

const route = useRoute();
const album = ref<Album | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const uploadProgress = ref("");
const uploadError = ref("");
const lightboxIndex = ref<number | null>(null);
const focusedPhoto = computed(() => lightboxIndex.value !== null ? album.value?.photos[lightboxIndex.value] ?? null : null);
const swipeDelta = ref(0);
const swipeTransition = ref(false);
let touchStartX = 0;

const showEdit = ref(false);
const saving = ref(false);
const editError = ref("");
const editForm = ref({ name: "", location: "", startDate: "", endDate: "" });

interface AllMember extends Member { hidden: number; rsvpStatus?: string }
const showEditMembers = ref(false);
const allMembers = ref<AllMember[]>([]);

function onKeyDown(e: KeyboardEvent) {
  if (lightboxIndex.value === null) return;
  if (e.key === "ArrowRight") lightboxNext();
  else if (e.key === "ArrowLeft") lightboxPrev();
  else if (e.key === "Escape") lightboxIndex.value = null;
}

onMounted(async () => {
  const res = await fetch(`/api/album/${route.params.channelId}`);
  if (res.ok) album.value = await res.json();
  window.addEventListener("keydown", onKeyDown);
});

onUnmounted(() => { window.removeEventListener("keydown", onKeyDown); });

function lightboxNext() {
  if (lightboxIndex.value === null || !album.value) return;
  lightboxIndex.value = (lightboxIndex.value + 1) % album.value.photos.length;
  swipeDelta.value = 0;
  swipeTransition.value = false;
}
function lightboxPrev() {
  if (lightboxIndex.value === null || !album.value) return;
  lightboxIndex.value = (lightboxIndex.value - 1 + album.value.photos.length) % album.value.photos.length;
  swipeDelta.value = 0;
  swipeTransition.value = false;
}

function onTouchStart(e: TouchEvent) {
  touchStartX = e.touches[0].clientX;
  swipeTransition.value = false;
  swipeDelta.value = 0;
}
function onTouchMove(e: TouchEvent) {
  swipeDelta.value = e.touches[0].clientX - touchStartX;
}
function onTouchEnd(e: TouchEvent) {
  const delta = e.changedTouches[0].clientX - touchStartX;
  swipeTransition.value = true;
  if (delta > 50) {
    swipeDelta.value = window.innerWidth;
    setTimeout(() => { lightboxPrev(); }, 250);
  } else if (delta < -50) {
    swipeDelta.value = -window.innerWidth;
    setTimeout(() => { lightboxNext(); }, 250);
  } else {
    swipeDelta.value = 0;
    setTimeout(() => { swipeTransition.value = false; }, 250);
  }
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
  const res = await fetch(`/api/album/${album.value.channelId}/members`, { headers: { Authorization: `Bearer ${session}` } });
  if (res.ok) allMembers.value = await res.json();
  showEditMembers.value = true;
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
