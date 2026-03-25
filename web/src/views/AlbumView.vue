<template>
  <div class="page">
    <router-link to="/albums" class="back">← All Albums</router-link>
    <template v-if="album">
      <div class="album-header">
        <div>
          <div style="display:flex;align-items:center;gap:8px">
            <h1>{{ album.groupName }}</h1>
            <button class="btn-icon" @click="showEdit = true" title="Edit album">✏️</button>
          </div>
          <p v-if="album.dateText" class="date">{{ album.dateText }}</p>
          <p v-if="album.location" class="meta">📍 {{ album.location }}</p>
        </div>
        <div class="upload-area">
          <button class="btn-secondary" @click="openShare" style="margin-right:8px">Share</button>
          <button class="btn-primary" @click="openUpload">Upload</button>
        </div>
      </div>

      <div v-if="album.members.length > 0" class="members-section">
        <div class="members-header">
          <div class="members-list">
            <div v-for="member in album.members" :key="member.userId" class="member-chip" :title="member.firstName || member.displayName">
              <MemberAvatar :avatar-url="member.avatarUrl" :name="member.firstName || member.displayName" />
              <span class="member-name">{{ member.firstName || member.displayName }}</span>
            </div>
            <button class="btn-icon" @click="showEditMembers = true" title="Edit members">✏️</button>
          </div>
        </div>
      </div>

      <p v-if="album.photos.length === 0" class="empty" style="margin-top:24px">No photos yet.</p>
      <div v-else class="sort-bar">
        <label class="sort-label">Sort by</label>
        <select v-model="sortBy" class="sort-select">
          <option value="popular">Most Popular</option>
          <option value="tagging">Tagging</option>
          <option value="uploader">Uploader</option>
          <option value="newest">Newest Upload</option>
          <option value="oldest">Oldest Upload</option>
        </select>
        <template v-if="sortBy === 'tagging'">
          <select v-model="tagFilterUserId" class="sort-select">
            <option v-for="m in album.members" :key="m.userId" :value="m.userId">{{ m.firstName || m.displayName }}</option>
            <option value="__nobody__">Nobody</option>
          </select>
        </template>
      </div>
      <template v-for="section in sortedSections" :key="section.label">
        <h3 v-if="section.label" class="gallery-section-header">{{ section.label }}</h3>
        <div class="gallery">
          <div v-for="photo in section.photos" :key="photo.id" class="photo-item" @click="openLightbox(allPhotosFlat.indexOf(photo))">
            <img :src="thumbUrl(photo.url)" loading="lazy" @error="($event.target as HTMLImageElement).src = photo.url" />
            <button class="photo-delete-btn" @click.stop="confirmDelete(photo)" title="Delete photo">🗑</button>
            <div class="photo-votes" @click.stop>
              <button class="vote-btn vote-fav" :class="{ active: getVoteState(photo).userVote === 'fav' }" @click="handleVote($event, photo, 'fav')" title="Favourite">⭐</button>
              <button class="vote-btn vote-up" :class="{ active: getVoteState(photo).userVote === 'up' || getVoteState(photo).userVote === 'fav' }" @click="handleVote($event, photo, 'up')" title="Upvote">👍</button>
              <button class="vote-btn vote-score" @click.stop="openVoteModal(photo)">{{ getVoteState(photo).score }}</button>
              <button class="vote-btn vote-down" :class="{ active: getVoteState(photo).userVote === 'down' }" @click="handleVote($event, photo, 'down')" title="Downvote">👎</button>
              <button class="vote-btn vote-group" :class="{ active: photo.taggedIds?.length }" @click.stop="openTagging(photo, true)" title="Tagging">
                <span v-if="getTaggedMembers(photo).length >= 4" style="color:#fff"><span class="tag-count">{{ getTaggedMembers(photo).length }}</span>👥</span>
                <span v-else-if="getTaggedMembers(photo).length" class="tagging-avatars">
                  <template v-for="(m, idx) in getTaggedMembers(photo)" :key="m.userId">
                    <img v-if="m.avatarUrl" :src="m.avatarUrl" class="tagging-mini-avatar" />
                    <span v-else class="tagging-mini-avatar tagging-mini-initial">{{ (m.firstName || m.displayName)[0] }}</span>
                  </template>
                </span>
                <span v-else>👥</span>
              </button>
            </div>
          </div>
        </div>
        <div class="gallery-mobile">
          <div v-for="photo in section.photos" :key="photo.id" class="photo-item-mobile" @click="openLightbox(allPhotosFlat.indexOf(photo))">
            <img :src="photo.url" loading="lazy" />
          </div>
        </div>
      </template>
    </template>
    <p v-else-if="loading" class="empty">Loading…</p>
    <p v-else class="empty">Album not found.</p>
  </div>


  <Teleport to="body">
    <!-- Tagging Modal -->
    <div class="modal-overlay" v-if="showTagging" style="z-index:200000;pointer-events:none;background:none">
      <div class="modal" :style="dragTagging.style.value" style="pointer-events:auto">
        <button class="modal-close" @click="showTagging = false">✕</button>
        <template v-if="showTaggingPicker">
          <h2 class="modal-drag-handle" @mousedown="dragTagging.onMouseDown">Tag User</h2>
          <div class="members-modal-list">
            <div class="members-modal-row tagging-row" @click="addEveryone()">
              <span class="member-avatar member-avatar-placeholder">★</span>
              <span class="members-modal-name"><strong>Everyone</strong></span>
            </div>
            <div v-for="member in pickableMembers" :key="member.userId" class="members-modal-row tagging-row" @click="addTagged(member.userId)">
              <MemberAvatar :avatar-url="member.avatarUrl" :name="member.firstName || member.displayName" />
              <span class="members-modal-name">{{ member.firstName || member.displayName }}</span>
            </div>
            <p v-if="pickableMembers.length === 0" class="empty" style="font-size:0.85em;padding:6px 0">All members already tagged.</p>
          </div>
          <div style="margin-top:12px">
            <button class="btn-secondary btn-small" @click="showTaggingPicker = false">← Back</button>
          </div>
        </template>
        <template v-else>
          <h2 class="modal-drag-handle" @mousedown="dragTagging.onMouseDown">Tagging</h2>
          <div class="members-modal-list" style="min-height:40px">
            <div v-for="member in taggedMembers" :key="member.userId" class="members-modal-row">
              <MemberAvatar :avatar-url="member.avatarUrl" :name="member.firstName || member.displayName" />
              <span class="members-modal-name">{{ member.firstName || member.displayName }}</span>
              <button class="btn-remove" @click="removeTagged(member.userId)">remove</button>
            </div>
            <p v-if="taggedMembers.length === 0" class="empty" style="font-size:0.85em;padding:6px 0">No one tagged yet.</p>
          </div>
          <div style="margin-top:12px">
            <button class="btn-secondary btn-small" @click="showTaggingPicker = true">+ Add User</button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>

  <Teleport to="body">
    <!-- Vote Breakdown Modal -->
    <div class="modal-overlay" v-if="voteModalPhoto" style="z-index:200000;pointer-events:none;background:none">
      <div class="modal" :style="dragVotes.style.value" style="pointer-events:auto">
        <button class="modal-close" @click="voteModalPhoto = null">✕</button>
        <h2 class="modal-drag-handle" @mousedown="dragVotes.onMouseDown">Votes</h2>
        <div v-if="voteModalData.length === 0" style="color:#6c7086;margin-top:12px">No votes yet</div>
        <div v-else class="vote-modal-list">
          <div v-for="v in voteModalData" :key="v.userId" class="vote-modal-row">
            <img v-if="v.avatarUrl" :src="v.avatarUrl" class="vote-modal-avatar" />
            <span v-else class="vote-modal-avatar vote-modal-initial">{{ (v.firstName || v.displayName)[0] }}</span>
            <span class="vote-modal-name">{{ v.firstName || v.displayName }}</span>
            <span class="vote-modal-icon">{{ v.voteType === 'fav' ? '⭐' : v.voteType === 'up' ? '👍' : '👎' }}</span>
          </div>
        </div>
      </div>
    </div>
    <!-- Delete Photo Confirmation Modal -->
    <div class="modal-overlay" v-if="deletingPhoto" style="z-index:200000">
      <div class="modal" :style="dragDelete.style.value">
        <button class="modal-close" @click="deletingPhoto = null">✕</button>
        <h2 class="modal-drag-handle" @mousedown="dragDelete.onMouseDown">Delete Photo?</h2>
        <p style="color:#a6adc8;margin-bottom:20px">This cannot be undone.</p>
        <div class="modal-actions">
          <button class="btn-danger" @click="deletePhoto" :disabled="deleting">{{ deleting ? 'Deleting…' : 'Delete' }}</button>
        </div>
      </div>
    </div>
    <!-- Share Album Modal -->
    <div class="modal-overlay" v-if="showShare" style="z-index:200000">
      <div class="modal" :style="dragShare.style.value">
        <button class="modal-close" @click="showShare = false">✕</button>
        <h2 class="modal-drag-handle" @mousedown="dragShare.onMouseDown">Share Album</h2>
        <template v-if="!shareUrl">
          <div class="form-group">
            <label>Password</label>
            <input v-model="sharePassword" type="password" placeholder="Set a password for this link" @keyup.enter="generateShareLink" />
          </div>
          <div class="modal-actions">
            <button class="btn-primary" @click="generateShareLink" :disabled="sharing || !sharePassword.trim()">
              {{ sharing ? "Generating…" : "Generate Link" }}
            </button>
          </div>
        </template>
        <template v-else>
          <p style="color:#a6adc8;font-size:0.85em;margin-bottom:12px">Share this link and tell them the password:</p>
          <div style="display:flex;gap:8px">
            <input type="text" :value="shareUrl" readonly class="share-link-input" />
            <button class="btn-secondary btn-small" @click="copyShareLink">{{ shareCopied ? "✓ Copied" : "Copy" }}</button>
          </div>
        </template>
      </div>
    </div>
    <!-- Upload Modal -->
    <div class="modal-overlay" v-if="showUpload" style="z-index:200000"
         :class="{ 'upload-drag-active': uploadDragOver }"
         @dragover.prevent="uploadDragOver = true" @dragleave.self="uploadDragOver = false" @drop.prevent="onUploadDrop">
      <div class="modal">
        <button class="modal-close" @click="closeUpload" :disabled="anyUploading">✕</button>
        <h2>Upload Photos</h2>
        <div class="upload-drop-zone" @click="uploadFileInput?.click()" @dragover.prevent @dragleave.prevent @drop.prevent="onUploadDrop">
          <div class="upload-drop-icon">📷</div>
          <div>Drop photos here or click to browse</div>
          <input ref="uploadFileInput" type="file" accept="image/*" multiple style="display:none" @change="onFilesSelected" />
        </div>
        <div v-if="uploadItems.length" class="upload-item-list">
          <div v-for="item in uploadItems" :key="item.name" class="upload-item">
            <span :class="['upload-item-icon', 'upload-' + item.status]">
              {{ item.status === 'done' ? '✓' : item.status === 'failed' ? '✗' : item.status === 'uploading' ? '↑' : '·' }}
            </span>
            <span class="upload-item-name">{{ item.name }}</span>
          </div>
        </div>
        <div class="modal-actions" v-if="uploadItems.length">
          <button class="btn-primary" @click="closeUpload" :disabled="anyUploading">
            {{ anyUploading ? 'Uploading…' : 'Done' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <EditAlbumModal
    :show="showEdit"
    :channel-id="album?.channelId ?? ''"
    :album="album ?? { groupName: '' }"
    @close="showEdit = false"
    @saved="onAlbumSaved"
  />

  <MembersModal
    v-model="showEditMembers"
    :channel-id="album?.channelId ?? ''"
    @members-updated="onMembersUpdated"
  />
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import { useRoute } from "vue-router";
import MemberAvatar from "../components/MemberAvatar.vue";
import EditAlbumModal from "../components/EditAlbumModal.vue";
import MembersModal from "../components/MembersModal.vue";
import PhotoSwipe from "photoswipe";
import "photoswipe/style.css";
import { authHeaders, authJsonHeaders } from "../utils/session";
import { useDraggable } from "../utils/draggable";

const dragTagging = useDraggable();
const dragVotes = useDraggable();
const dragDelete = useDraggable();
const dragShare = useDraggable();

interface Photo { id: number; url: string; filename?: string; uploadedById?: string; uploadedByName?: string; uploadedAt: string; takenAt?: string; width?: number; height?: number; score?: number; userVote?: string | null; taggedIds?: string[] }
interface Member { userId: string; displayName: string; firstName?: string; avatarUrl?: string; rsvpStatus?: string }
interface Album { channelId: string; groupName: string; dateText?: string; location?: string; startDate?: string; endDate?: string; photos: Photo[]; members: Member[] }

const route = useRoute();

const album = ref<Album | null>(null);
const loading = ref(true);
const uploadFileInput = ref<HTMLInputElement | null>(null);
const showUpload = ref(false);
const uploadDragOver = ref(false);
interface UploadItem { name: string; status: 'pending' | 'uploading' | 'done' | 'failed' }
const uploadItems = ref<UploadItem[]>([]);
const anyUploading = computed(() => uploadItems.value.some(i => i.status === 'pending' || i.status === 'uploading'));

const deletingPhoto = ref<Photo | null>(null);
const voteModalPhoto = ref<Photo | null>(null);
let activePswp: any = null;
let pendingReopenIndex: number | null = null;
const voteModalData = ref<{ userId: string; displayName: string; firstName: string | null; avatarUrl: string | null; voteType: string }[]>([]);
const deleting = ref(false);

const showShare = ref(false);
const sharePassword = ref("");
const shareUrl = ref("");
const sharing = ref(false);
const shareCopied = ref(false);

const showEdit = ref(false);
const showEditMembers = ref(false);

// allMembers is populated by MembersModal when it opens; used for getTaggedMembers
const allMembers = ref<Member[]>([]);

const votes = ref<Record<number, { score: number; userVote: string | null }>>({});
let refreshLightboxVotes: (() => void) | null = null;

const showTagging = ref(false);
const showTaggingPicker = ref(false);
const taggingPhoto = ref<Photo | null>(null);
const taggingSelection = ref(new Set<string>());

const SORT_KEY = 'snek_sort_by';
const sortBy = ref<'popular' | 'tagging' | 'uploader' | 'newest' | 'oldest'>(
  (sessionStorage.getItem(SORT_KEY) as any) ?? 'popular'
);
watch(sortBy, val => sessionStorage.setItem(SORT_KEY, val));
const currentUserId = ref<string | null>(null);
const tagFilterUserId = ref<string>('__nobody__');

function cmp(a: Photo, b: Photo): number {
  const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
  if (scoreDiff !== 0) return scoreDiff;
  return (b.uploadedAt ?? '').localeCompare(a.uploadedAt ?? '');
}

const allPhotosFlat = computed(() => sortedSections.value.flatMap(s => s.photos));

const sortedSections = computed((): { label: string; photos: Photo[] }[] => {
  const photos = album.value?.photos ?? [];
  if (sortBy.value === 'popular') {
    return [{ label: '', photos: [...photos].sort(cmp) }];
  }
  if (sortBy.value === 'newest') {
    return [{ label: '', photos: [...photos].sort((a, b) => {
      const t = (b.uploadedAt ?? '').localeCompare(a.uploadedAt ?? '');
      return t !== 0 ? t : cmp(a, b);
    }) }];
  }
  if (sortBy.value === 'oldest') {
    return [{ label: '', photos: [...photos].sort((a, b) => {
      const t = (a.uploadedAt ?? '').localeCompare(b.uploadedAt ?? '');
      return t !== 0 ? t : cmp(a, b);
    }) }];
  }
  if (sortBy.value === 'tagging') {
    const target = tagFilterUserId.value;
    const filtered = target === '__nobody__'
      ? photos.filter(p => !p.taggedIds?.length)
      : photos.filter(p => p.taggedIds?.includes(target));
    return [{ label: '', photos: [...filtered].sort(cmp) }];
  }
  if (sortBy.value === 'uploader') {
    const groups = new Map<string, { label: string; photos: Photo[] }>();
    for (const photo of photos) {
      const key = photo.uploadedById ?? '__unknown__';
      const label = photo.uploadedByName ?? 'Unknown';
      if (!groups.has(key)) groups.set(key, { label, photos: [] });
      groups.get(key)!.photos.push(photo);
    }
    const sections = [...groups.values()].sort((a, b) => b.photos.length - a.photos.length);
    for (const s of sections) s.photos.sort(cmp);
    return sections;
  }
  return [{ label: '', photos }];
});

const byName = (a: Member, b: Member) => (a.firstName || a.displayName).localeCompare(b.firstName || b.displayName);

const taggedMembers = computed(() =>
  allMembers.value.filter(m => taggingSelection.value.has(m.userId))
);
const pickableMembers = computed(() =>
  (album.value?.members ?? []).filter(m => !taggingSelection.value.has(m.userId))
);

async function fetchVoteBreakdown(photo: Photo) {
  if (!album.value) return [];
  const res = await fetch(`/api/album/${album.value.channelId}/photos/${photo.id}/votes`, { headers: authHeaders() });
  return res.ok ? await res.json() : [];
}

async function openVoteModal(photo: Photo) {
  if (!voteModalPhoto.value) {
    dragVotes.reset();
    if (window.innerWidth >= 768) {
      const modalW = Math.min(380, window.innerWidth);
      dragVotes.setPosition(-(window.innerWidth / 2 - modalW / 2 - 80), 0);
    }
  }
  voteModalPhoto.value = photo;
  voteModalData.value = await fetchVoteBreakdown(photo);
}

function getVoteState(photo: Photo) {
  return votes.value[photo.id] ?? { score: photo.score ?? 0, userVote: photo.userVote ?? null };
}

async function doVote(photoId: number, voteType: string) {
  if (!album.value) return;
  const res = await fetch(`/api/album/${album.value.channelId}/photos/${photoId}/vote`, {
    method: "POST",
    headers: authJsonHeaders(),
    body: JSON.stringify({ voteType }),
  });
  if (res.ok) {
    const { score, userVote } = await res.json();
    votes.value = { ...votes.value, [photoId]: { score, userVote } };
    refreshLightboxVotes?.();
  }
}

function openTagging(photo: Photo, skipToPicker = false) {
  taggingPhoto.value = photo;
  taggingSelection.value = new Set(photo.taggedIds ?? []);
  if (!showTagging.value) {
    dragTagging.reset();
    if (window.innerWidth >= 768) {
      const modalW = Math.min(380, window.innerWidth);
      dragTagging.setPosition(window.innerWidth / 2 - modalW / 2 - 80, 0);
    }
  }
  showTagging.value = true;
  showTaggingPicker.value = skipToPicker && !photo.taggedIds?.length;
}

function getTaggedMembers(photo: Photo): Member[] {
  if (!photo.taggedIds?.length) return [];
  return photo.taggedIds.map(id => allMembers.value.find(m => m.userId === id)).filter(Boolean) as Member[];
}

function removeTagged(userId: string) {
  const s = new Set(taggingSelection.value);
  s.delete(userId);
  taggingSelection.value = s;
  saveTagging();
}

function addTagged(userId: string) {
  const s = new Set(taggingSelection.value);
  s.add(userId);
  taggingSelection.value = s;
  showTaggingPicker.value = false;
  saveTagging();
}

function addEveryone() {
  taggingSelection.value = new Set(album.value?.members.map(m => m.userId) ?? []);
  showTaggingPicker.value = false;
  saveTagging();
}

async function saveTagging() {
  if (!album.value || !taggingPhoto.value) return;
  const userIds = [...taggingSelection.value];
  const res = await fetch(`/api/album/${album.value.channelId}/photos/${taggingPhoto.value.id}/tagged`, {
    method: "POST",
    headers: authJsonHeaders(),
    body: JSON.stringify({ userIds }),
  });
  if (res.ok) {
    const photo = album.value.photos.find(p => p.id === taggingPhoto.value!.id);
    if (photo) {
      photo.taggedIds = userIds;
      refreshLightboxVotes?.();
    }
  }
}

onMounted(async () => {
  const [albumRes, checkRes] = await Promise.all([
    fetch(`/api/album/${route.params.channelId}`, { headers: authHeaders() }),
    fetch(`/api/auth/check`, { headers: authHeaders() }),
  ]);
  if (albumRes.ok) {
    const data = await albumRes.json();
    const sortedMembers = (data.members ?? []).slice().sort(byName);
    album.value = { ...data, members: sortedMembers };
    allMembers.value = sortedMembers;
  }
  if (checkRes.ok) {
    const { userId } = await checkRes.json();
    currentUserId.value = userId ?? null;
    const members = album.value?.members ?? [];
    tagFilterUserId.value = (userId && members.some(m => m.userId === userId)) ? userId : '__nobody__';
  }
  loading.value = false;
});

function onAlbumSaved(updated: object) {
  if (album.value) album.value = { ...album.value, ...updated };
}

function onMembersUpdated(visible: Member[], all: Member[]) {
  if (album.value) album.value.members = visible.slice().sort(byName);
  allMembers.value = all.slice().sort(byName);
}

function spawnFloat(x: number, y: number, voteType: string, grey = false) {
  const emoji = voteType === "fav" ? "⭐" : voteType === "up" ? "👍" : "👎";
  const span = document.createElement("span");
  span.className = grey ? "vote-float vote-float-grey" : "vote-float";
  span.textContent = emoji;
  span.style.left = `${x}px`;
  span.style.top = `${y}px`;
  document.body.appendChild(span);
  span.addEventListener("animationend", () => span.remove());
}

function isRemovingVote(currentVote: string | null | undefined, voteType: string) {
  return (voteType === "fav" && currentVote === "fav") ||
    (voteType === "up" && (currentVote === "up" || currentVote === "fav")) ||
    (voteType === "down" && currentVote === "down");
}

function handleVote(e: Event, photo: Photo, voteType: string) {
  const rect = (e.currentTarget as Element).getBoundingClientRect();
  spawnFloat(rect.left + rect.width / 2, rect.top + rect.height / 2, voteType, isRemovingVote(getVoteState(photo).userVote, voteType));
  doVote(photo.id, voteType);
}

function confirmDelete(photo: Photo) { dragDelete.reset(); deletingPhoto.value = photo; }

function handleEscape(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  if (showTaggingPicker.value) { showTaggingPicker.value = false; e.stopImmediatePropagation(); return; }
  if (showTagging.value)       { showTagging.value = false;       e.stopImmediatePropagation(); return; }
  if (voteModalPhoto.value)    { voteModalPhoto.value = null;     e.stopImmediatePropagation(); return; }
  if (deletingPhoto.value)     { deletingPhoto.value = null;      e.stopImmediatePropagation(); return; }
  if (showShare.value)         { showShare.value = false;         e.stopImmediatePropagation(); return; }
}
onMounted(() => window.addEventListener("keydown", handleEscape, true));
onUnmounted(() => window.removeEventListener("keydown", handleEscape, true));

async function deletePhoto() {
  if (!album.value || !deletingPhoto.value) return;
  deleting.value = true;
  const res = await fetch(`/api/album/${album.value.channelId}/photos/${deletingPhoto.value.id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  deleting.value = false;
  if (res.ok) {
    const deletedId = deletingPhoto.value!.id;
    deletingPhoto.value = null;
    if (activePswp) {
      const currIdx = activePswp.currIndex;
      const oldPhotos = allPhotosFlat.value;
      const deletedPos = oldPhotos.findIndex(p => p.id === deletedId);
      album.value.photos = album.value.photos.filter(p => p.id !== deletedId);
      const newLen = allPhotosFlat.value.length;
      if (newLen > 0) {
        const newIdx = deletedPos <= currIdx ? Math.max(0, currIdx - 1) : currIdx;
        pendingReopenIndex = Math.min(newIdx, newLen - 1);
      }
      activePswp.close();
    } else {
      album.value.photos = album.value.photos.filter(p => p.id !== deletedId);
    }
  }
}

function openLightbox(index: number) {
  if (!album.value) return;
  const photos = allPhotosFlat.value;
  activePswp = null;
  const pswp = new PhotoSwipe({
    dataSource: photos.map(p => ({ src: p.url, width: p.width || 1200, height: p.height || 900, msrc: thumbUrl(p.url) })),
    index,
    bgOpacity: 1,
    zoom: true,
    close: true,
    counter: true,
    arrowKeys: true,
    pinchToClose: false,
    closeOnVerticalDrag: false,
    bgClickAction: "none",
    loop: false,
    paddingFn: (viewportSize: { x: number; y: number }) =>
      viewportSize.x >= 768 ? { top: 20, bottom: 70, left: 0, right: 0 } : { top: 0, bottom: 0, left: 0, right: 0 },
  });
  activePswp = pswp;
  history.pushState({ pswp: true }, "");
  let closedByBack = false;
  const onPopState = () => { closedByBack = true; pswp.close(); };
  window.addEventListener("popstate", onPopState, { once: true });

  // Keyboard up/down to vote (up → fav → neutral cycle, down = downvote)
  const onKeyDown = (e: KeyboardEvent) => {
    const p = photos[pswp.currIndex];
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const currentVote = getVoteState(p).userVote;
      const voteType = (currentVote === "up" || currentVote === "fav") ? "fav" : "up";
      spawnFloat(window.innerWidth / 2, window.innerHeight / 2, voteType);
      doVote(p.id, voteType);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      spawnFloat(window.innerWidth / 2, window.innerHeight / 2, "down");
      doVote(p.id, "down");
    }
  };
  window.addEventListener("keydown", onKeyDown);

  // Mobile single tap = upvote, double tap = favourite (preventDefault stops toggle-controls/zoom)
  (pswp as any).on("tapAction", (e: any) => {
    e.preventDefault();
    if (e.originalEvent?.pointerType === "touch") {
      const x = e.originalEvent.clientX ?? window.innerWidth / 2;
      const y = e.originalEvent.clientY ?? window.innerHeight / 2;
      const p = photos[pswp.currIndex];
      spawnFloat(x, y, "up", isRemovingVote(getVoteState(p).userVote, "up"));
      doVote(p.id, "up");
    }
  });
  (pswp as any).on("doubleTapAction", (e: any) => {
    e.preventDefault();
    if (e.originalEvent?.pointerType === "touch") {
      const x = e.originalEvent.clientX ?? window.innerWidth / 2;
      const y = e.originalEvent.clientY ?? window.innerHeight / 2;
      const p = photos[pswp.currIndex];
      spawnFloat(x, y, "fav", isRemovingVote(getVoteState(p).userVote, "fav"));
      doVote(p.id, "fav");
    }
  });

  // Hide full image until completely loaded — keep thumbnail visible instead
  function holdUntilLoaded(img: HTMLImageElement) {
    if (img.complete) return;
    img.style.opacity = "0";
    img.addEventListener("load", () => { img.style.transition = "opacity 150ms"; img.style.opacity = ""; }, { once: true });
  }
  (pswp as any).on("afterInit", () => {
    const el = (pswp as any).currSlide?.content?.element;
    if (el) holdUntilLoaded(el);
  });
  pswp.on("close", () => {
    activePswp = null;
    window.removeEventListener("popstate", onPopState);
    window.removeEventListener("keydown", onKeyDown);
    if (!closedByBack) history.back();
    showTagging.value = false;
    showTaggingPicker.value = false;
    voteModalPhoto.value = null;
    const idx = pendingReopenIndex;
    pendingReopenIndex = null;
    if (idx !== null) nextTick(() => openLightbox(idx));
  });
  pswp.on("change", () => {
    const el = (pswp as any).currSlide?.content?.element;
    if (el) holdUntilLoaded(el);
    if (showTagging.value) openTagging(photos[pswp.currIndex]);
    if (voteModalPhoto.value) openVoteModal(photos[pswp.currIndex]);
  });
  pswp.on("uiRegister", () => {
    let topMetaEl: HTMLElement | null = null;
    const buildMetaHtml = (p: Photo) => {
      const dateHtml = p?.takenAt ? `<span class="pswp-caption-date">${formatTime(p.takenAt)}</span>` : "";
      const uploaderMember = p?.uploadedById ? album.value?.members.find(m => m.userId === p.uploadedById) : null;
      const avatarHtml = uploaderMember?.avatarUrl
        ? `<img src="${uploaderMember.avatarUrl}" style="width:1.4em;height:1.4em;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:5px" />`
        : "";
      const uploadedAtHtml = p?.uploadedAt ? `<span class="pswp-upload-date">${formatDateTime(p.uploadedAt)}</span>` : "";
      const uploaderHtml = p?.uploadedByName ? `<span class="pswp-caption-uploader">Uploader: ${avatarHtml}${p.uploadedByName}</span>${uploadedAtHtml}` : "";
      return { dateHtml, uploaderHtml };
    };
    pswp.ui!.registerElement({
      name: "top-meta",
      order: 8,
      isButton: false,
      appendTo: "root",
      onInit: (el) => {
        topMetaEl = el;
        const update = () => {
          const { dateHtml, uploaderHtml } = buildMetaHtml(photos[pswp.currIndex]);
          el.innerHTML = `<div class="pswp-meta-left">${dateHtml}</div><div class="pswp-meta-right">${uploaderHtml}</div>`;
        };
        pswp.on("change", update);
        update();
      },
    });
    pswp.ui!.registerElement({
      name: "delete-button",
      order: 9,
      isButton: true,
      html: "🗑",
      appendTo: "bar",
      onClick: () => {
        confirmDelete(photos[pswp.currIndex]);
      },
    });
    pswp.ui!.registerElement({
      name: "bottom-bar",
      order: 9,
      isButton: false,
      appendTo: "root",
      onInit: (el) => {
        el.addEventListener("click", (e) => {
          const btn = (e.target as Element).closest("[data-vote]") as HTMLElement | null;
          const featBtn = (e.target as Element).closest("[data-action='tagged']") as HTMLElement | null;
          if (btn) {
            const voteType = btn.dataset.vote!;
            const p = photos[pswp.currIndex];
            const rect = btn.getBoundingClientRect();
            spawnFloat(rect.left + rect.width / 2, rect.top + rect.height / 2, voteType, isRemovingVote(getVoteState(p).userVote, voteType));
            doVote(p.id, voteType);
          } else if (featBtn) {
            openTagging(photos[pswp.currIndex], true);
          } else if ((e.target as Element).closest("[data-action='score']")) {
            openVoteModal(photos[pswp.currIndex]);
          }
        });
        const update = () => {
          const p = photos[pswp.currIndex];
          const { score, userVote } = getVoteState(p);
          const upActive = userVote === "up" || userVote === "fav";
          const taggedMs = (album.value?.members ?? []).filter(m => p.taggedIds?.includes(m.userId));
          const avStyle = (i: number) => `width:1.4em;height:1.4em;border-radius:50%;object-fit:cover;pointer-events:none;border:1.5px solid rgba(0,0,0,0.4);flex-shrink:0;${i > 0 ? "margin-left:-0.5em;" : ""}`;
          const taggedBtnContent = taggedMs.length >= 4
            ? `<span style="color:#fff"><span class="tag-count">${taggedMs.length}</span>👥</span>`
            : taggedMs.length
            ? `<span style="display:inline-flex;align-items:center">${taggedMs.map((m, i) => m.avatarUrl
                ? `<img src="${m.avatarUrl}" style="${avStyle(i)}display:block" />`
                : `<span style="${avStyle(i)}background:#585b70;display:inline-flex;align-items:center;justify-content:center;"><span style="font-size:0.55em;font-weight:600;color:#cdd6f4;pointer-events:none">${(m.firstName || m.displayName)[0]}</span></span>`
              ).join("")}</span>`
            : "👥";
          const { dateHtml, uploaderHtml } = buildMetaHtml(p);
          el.innerHTML = `
            <div class="pswp-meta-left">${dateHtml}</div>
            <div class="pswp-meta-right">${uploaderHtml}</div>
            <div class="pswp-votes">
              <button data-vote="fav" class="pswp-vote-btn${userVote === "fav" ? " active-fav" : ""}">⭐</button>
              <button data-vote="up" class="pswp-vote-btn${upActive ? " active-up" : ""}">👍</button>
              <button data-action="score" class="pswp-vote-btn pswp-vote-score">${score}</button>
              <button data-vote="down" class="pswp-vote-btn${userVote === "down" ? " active-down" : ""}">👎</button>
              <button data-action="tagged" class="pswp-vote-btn${taggedMs.length ? " active-fav" : ""}">${taggedBtnContent}</button>
            </div>
          `;
          if (topMetaEl) topMetaEl.innerHTML = `<div class="pswp-meta-left">${dateHtml}</div><div class="pswp-meta-right">${uploaderHtml}</div>`;
        };
        refreshLightboxVotes = update;
        pswp.on("change", update);
        update();
      },
    });
  });
  pswp.on("close", () => { refreshLightboxVotes = null; });
  pswp.init();
}

function openShare() {
  sharePassword.value = "";
  shareUrl.value = "";
  shareCopied.value = false;
  dragShare.reset();
  showShare.value = true;
}

async function generateShareLink() {
  if (!album.value || !sharePassword.value.trim()) return;
  sharing.value = true;
  const res = await fetch(`/api/album/${album.value.channelId}/share`, {
    method: "POST",
    headers: authJsonHeaders(),
    body: JSON.stringify({ password: sharePassword.value.trim() }),
  });
  sharing.value = false;
  if (res.ok) shareUrl.value = (await res.json()).url;
}

function copyShareLink() {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(shareUrl.value);
  } else {
    const el = document.createElement("input");
    el.value = shareUrl.value;
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
  }
  shareCopied.value = true;
  setTimeout(() => { shareCopied.value = false; }, 2000);
}

function openUpload() { uploadItems.value = []; showUpload.value = true; }
function closeUpload() { if (!anyUploading.value) showUpload.value = false; }

function onUploadDrop(e: DragEvent) {
  uploadDragOver.value = false;
  const files = Array.from(e.dataTransfer?.files ?? []).filter(f => f.type.startsWith("image/"));
  if (files.length) startUpload(files);
}

function onFilesSelected(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files ?? []);
  (e.target as HTMLInputElement).value = "";
  if (files.length) startUpload(files);
}

async function startUpload(files: File[]) {
  if (!album.value) return;
  const items: UploadItem[] = files.map(f => ({ name: f.name, status: "pending" }));
  uploadItems.value.push(...items);
  for (let i = 0; i < files.length; i++) {
    const item = items[i];
    item.status = "uploading";
    const fd = new FormData();
    fd.append("photo", files[i]);
    const res = await fetch(`/api/album/${album.value.channelId}/photos`, {
      method: "POST", headers: authHeaders(), body: fd,
    });
    if (res.ok) { album.value.photos.push(await res.json()); item.status = "done"; }
    else item.status = "failed";
  }
}

function thumbUrl(url: string): string {
  return url.replace("/uploads/", "/thumbnails/");
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) +
    " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
</script>
