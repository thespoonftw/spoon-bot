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
          <button class="btn-secondary btn-small" @click="showEditMembers = true">Edit</button>
        </div>
      </div>

      <p v-if="album.photos.length === 0" class="empty" style="margin-top:24px">No photos yet.</p>
      <div class="gallery">
        <div v-for="photo in album.photos" :key="photo.id" class="photo-item" @click="focusedPhoto = photo">
          <img :src="thumbUrl(photo.url)" loading="lazy" @error="($event.target as HTMLImageElement).src = photo.url" />
          <div class="photo-meta">
            <span v-if="photo.uploadedByName" class="uploader">{{ photo.uploadedByName }}</span>
            <span class="upload-time">{{ formatTime(photo.uploadedAt) }}</span>
          </div>
        </div>
      </div>
      <div class="gallery-mobile">
        <div v-for="photo in album.photos" :key="photo.id" class="photo-item-mobile" @click="focusedPhoto = photo">
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

  <!-- Mobile lightbox -->
  <div class="lightbox-overlay" v-if="focusedPhoto" @click="focusedPhoto = null">
    <img :src="focusedPhoto.url" class="lightbox-img" @click.stop />
    <button class="lightbox-close" @click="focusedPhoto = null">✕</button>
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
        <div v-for="member in album?.members" :key="member.userId" class="members-modal-row">
          <img v-if="member.avatarUrl" :src="member.avatarUrl" class="member-avatar" />
          <span v-else class="member-avatar member-avatar-placeholder">{{ member.displayName[0] }}</span>
          <span class="members-modal-name">{{ member.displayName }}</span>
          <span v-if="member.rsvpStatus" :class="['rsvp-badge', 'rsvp-' + member.rsvpStatus]">{{ rsvpLabel(member.rsvpStatus) }}</span>
          <button class="btn-remove" @click="removeMember(member.userId)" title="Remove from album">✕</button>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn-primary" @click="showEditMembers = false">Done</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
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
const focusedPhoto = ref<Photo | null>(null);

const showEdit = ref(false);
const saving = ref(false);
const editError = ref("");
const editForm = ref({ name: "", location: "", startDate: "", endDate: "" });

const showEditMembers = ref(false);

onMounted(async () => {
  const res = await fetch(`/api/album/${route.params.channelId}`);
  if (res.ok) album.value = await res.json();
});

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

async function removeMember(userId: string) {
  if (!album.value) return;
  const session = localStorage.getItem("snek_session");
  const res = await fetch(`/api/album/${album.value.channelId}/members/${userId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session}` },
  });
  if (res.ok && album.value) {
    album.value.members = album.value.members.filter(m => m.userId !== userId);
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
