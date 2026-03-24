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
          <button class="btn-primary" @click="triggerUpload" :disabled="uploading">
            {{ uploading ? `Uploading ${uploadProgress}…` : 'Upload' }}
          </button>
          <input ref="fileInput" type="file" accept="image/*" multiple style="display:none" @change="onFilesSelected" />
        </div>
      </div>

      <p v-if="uploadError" class="upload-error">{{ uploadError }}</p>

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
              <button class="vote-btn vote-group" :class="{ active: photo.taggedIds?.length }" @click.stop="openTagging(photo)" title="Tagging">
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
    <div class="modal-overlay" v-if="showTagging" style="z-index:200000">
      <div class="modal">
        <button class="modal-close" @click="showTagging = false">✕</button>
        <h2>Tagging</h2>
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
        <div class="modal-actions">
          <button class="btn-primary" @click="saveTagging" :disabled="savingTagging">{{ savingTagging ? 'Saving…' : 'Save' }}</button>
        </div>
      </div>
    </div>
    <!-- Tagging User Picker Modal -->
    <div class="modal-overlay" v-if="showTaggingPicker" style="z-index:210000">
      <div class="modal">
        <button class="modal-close" @click="showTaggingPicker = false; if (!taggingSelection.size) showTagging = false">✕</button>
        <h2>Tag User</h2>
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
      </div>
    </div>
  </Teleport>

  <!-- Delete Photo Confirmation Modal -->
  <!-- Vote Breakdown Modal -->
  <div class="modal-overlay" v-if="voteModalPhoto" @click.self="voteModalPhoto = null" style="z-index:200000">
    <div class="modal">
      <button class="modal-close" @click="voteModalPhoto = null">✕</button>
      <h2>Votes</h2>
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

  <Teleport to="body">
    <div class="modal-overlay" v-if="deletingPhoto" style="z-index:200000">
      <div class="modal">
        <button class="modal-close" @click="deletingPhoto = null">✕</button>
        <h2>Delete Photo?</h2>
        <p style="color:#a6adc8;margin-bottom:20px">This cannot be undone.</p>
        <div class="modal-actions">
          <button class="btn-danger" @click="deletePhoto" :disabled="deleting">{{ deleting ? 'Deleting…' : 'Delete' }}</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Share Album Modal -->
  <div class="modal-overlay" v-if="showShare">
    <div class="modal">
      <button class="modal-close" @click="showShare = false">✕</button>
      <h2>Share Album</h2>
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
import { ref, computed, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import MemberAvatar from "../components/MemberAvatar.vue";
import EditAlbumModal from "../components/EditAlbumModal.vue";
import MembersModal from "../components/MembersModal.vue";
import PhotoSwipe from "photoswipe";
import "photoswipe/style.css";
import { authHeaders, authJsonHeaders } from "../utils/session";

interface Photo { id: number; url: string; filename?: string; uploadedById?: string; uploadedByName?: string; uploadedAt: string; takenAt?: string; width?: number; height?: number; score?: number; userVote?: string | null; taggedIds?: string[] }
interface Member { userId: string; displayName: string; firstName?: string; avatarUrl?: string; rsvpStatus?: string }
interface Album { channelId: string; groupName: string; dateText?: string; location?: string; startDate?: string; endDate?: string; photos: Photo[]; members: Member[] }

const route = useRoute();

const album = ref<Album | null>(null);
const loading = ref(true);
const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const uploadProgress = ref("");
const uploadError = ref("");

const deletingPhoto = ref<Photo | null>(null);
const voteModalPhoto = ref<Photo | null>(null);
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
const savingTagging = ref(false);

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

function openTagging(photo: Photo) {
  taggingPhoto.value = photo;
  taggingSelection.value = new Set(photo.taggedIds ?? []);
  showTagging.value = true;
  showTaggingPicker.value = !photo.taggedIds?.length;
}

function getTaggedMembers(photo: Photo): Member[] {
  if (!photo.taggedIds?.length) return [];
  return photo.taggedIds.map(id => allMembers.value.find(m => m.userId === id)).filter(Boolean) as Member[];
}

function removeTagged(userId: string) {
  const s = new Set(taggingSelection.value);
  s.delete(userId);
  taggingSelection.value = s;
}

function addTagged(userId: string) {
  const s = new Set(taggingSelection.value);
  s.add(userId);
  taggingSelection.value = s;
  showTaggingPicker.value = false;
}

function addEveryone() {
  taggingSelection.value = new Set(album.value?.members.map(m => m.userId) ?? []);
  showTaggingPicker.value = false;
}

async function saveTagging() {
  if (!album.value || !taggingPhoto.value) return;
  savingTagging.value = true;
  const userIds = [...taggingSelection.value];
  const res = await fetch(`/api/album/${album.value.channelId}/photos/${taggingPhoto.value.id}/tagged`, {
    method: "POST",
    headers: authJsonHeaders(),
    body: JSON.stringify({ userIds }),
  });
  savingTagging.value = false;
  if (res.ok) {
    const photo = album.value.photos.find(p => p.id === taggingPhoto.value!.id);
    if (photo) {
      photo.taggedIds = userIds;
      refreshLightboxVotes?.();
    }
    showTagging.value = false;
  }
}

onMounted(async () => {
  const [albumRes, checkRes] = await Promise.all([
    fetch(`/api/album/${route.params.channelId}`, { headers: authHeaders() }),
    fetch(`/api/auth/check`, { headers: authHeaders() }),
  ]);
  if (albumRes.ok) {
    const data = await albumRes.json();
    album.value = data;
    allMembers.value = data.members ?? [];
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
  if (album.value) album.value.members = visible;
  allMembers.value = all;
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

function confirmDelete(photo: Photo) { deletingPhoto.value = photo; }

async function deletePhoto() {
  if (!album.value || !deletingPhoto.value) return;
  deleting.value = true;
  const res = await fetch(`/api/album/${album.value.channelId}/photos/${deletingPhoto.value.id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  deleting.value = false;
  if (res.ok) {
    album.value.photos = album.value.photos.filter(p => p.id !== deletingPhoto.value!.id);
    deletingPhoto.value = null;
  }
}

function openLightbox(index: number) {
  if (!album.value) return;
  const photos = allPhotosFlat.value;
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

  pswp.on("close", () => {
    window.removeEventListener("popstate", onPopState);
    window.removeEventListener("keydown", onKeyDown);
    if (!closedByBack) history.back();
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
            openTagging(photos[pswp.currIndex]);
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

function triggerUpload() {
  uploadError.value = "";
  fileInput.value?.click();
}

async function onFilesSelected(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files ?? []);
  if (!files.length || !album.value) return;
  uploading.value = true;
  uploadError.value = "";
  for (let i = 0; i < files.length; i++) {
    uploadProgress.value = `${i + 1}/${files.length}`;
    const fd = new FormData();
    fd.append("photo", files[i]);
    const res = await fetch(`/api/album/${album.value.channelId}/photos`, {
      method: "POST",
      headers: authHeaders(),
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

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) +
    " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
</script>
