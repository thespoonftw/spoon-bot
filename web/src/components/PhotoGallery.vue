<template>
  <template v-for="section in sections" :key="section.label">
    <h3 v-if="section.label" class="gallery-section-header" @click="toggleSection(section.label)">
      <span class="section-collapse-icon">{{ collapsedSections.has(section.label) ? '▶' : '▼' }}</span>
      {{ section.label }}
      <span class="section-photo-count">{{ section.photos.length }}</span>
      <span class="section-collapse-spacer"></span>
    </h3>
    <template v-if="!section.label || !collapsedSections.has(section.label)">
      <div class="gallery">
        <div v-for="photo in section.photos" :key="photo.id" class="photo-item" @click="openLightbox(allPhotos.indexOf(photo))">
          <img :src="thumbUrl(photo.url)" loading="lazy" @error="($event.target as HTMLImageElement).src = photo.url" />
          <button v-if="canDelete" class="photo-delete-btn" @click.stop="confirmDelete(photo)" title="Delete photo">🗑</button>
          <div class="photo-votes" @click.stop>
            <button class="vote-btn vote-fav" :class="{ active: !!getVoteState(photo).userIsSuper }" @click="handleVote($event, photo, '⭐', true)" title="Super vote">⭐</button>
            <div class="vote-up-wrapper" @mouseenter="emojiPickerPhotoId = photo.id" @mouseleave="emojiPickerPhotoId = null">
              <button class="vote-btn vote-up" :class="{ active: !!getVoteState(photo).userVote }" @click.stop="handleVote($event, photo, '👍', false)" title="Vote">{{ getVoteLabel(getVoteState(photo).userVote) }}</button>
              <div v-if="emojiPickerPhotoId === photo.id" class="emoji-picker-wrap" @click.stop @mousedown.stop>
                <emoji-picker class="dark" @emoji-click="(e: any) => { const { reactType, isSuper } = getEmojiReact(e.detail.unicode); handleVote(e, photo, reactType, isSuper); emojiPickerPhotoId = null }" />
              </div>
            </div>
            <button class="vote-btn vote-score" @click.stop="openVoteModal(photo)">{{ getVoteState(photo).score }}</button>
            <button class="vote-btn vote-group" :class="{ active: photo.taggedIds?.length }" @click.stop="openTagging(photo, true)" title="Tagging">
              <span v-if="getTaggedMembers(photo).length >= 4" style="color:#fff"><span class="tag-count">{{ getTaggedMembers(photo).length }}</span>👥</span>
              <span v-else-if="getTaggedMembers(photo).length" class="tagging-avatars">
                <template v-for="m in getTaggedMembers(photo)" :key="m.userId">
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
        <div v-for="photo in section.photos" :key="photo.id" class="photo-item-mobile" @click="openLightbox(allPhotos.indexOf(photo))">
          <img :src="thumbUrl(photo.url)" loading="lazy" @load="loadFull($event, photo.url)" />
        </div>
      </div>
    </template>
  </template>

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
            <span class="vote-modal-icon">{{ v.reactType }}{{ v.isSuper ? '✨' : '' }}</span>
          </div>
        </div>
      </div>
    </div>
    <!-- Delete Photo Confirmation Modal -->
    <div class="modal-overlay" v-if="canDelete && deletingPhoto" style="z-index:200000">
      <div class="modal" :style="dragDelete.style.value">
        <button class="modal-close" @click="deletingPhoto = null">✕</button>
        <h2 class="modal-drag-handle" @mousedown="dragDelete.onMouseDown">Delete Photo?</h2>
        <p style="color:#a6adc8;margin-bottom:20px">This cannot be undone.</p>
        <div class="modal-actions">
          <button class="btn-danger" @click="deletePhoto" :disabled="deleting">{{ deleting ? 'Deleting…' : 'Delete' }}</button>
        </div>
      </div>
    </div>
    <!-- Location Picker Modal -->
    <div class="modal-overlay" v-if="showLocationPicker" style="z-index:200000">
      <div class="modal">
        <button class="modal-close" @click="showLocationPicker = false; locationPickerPhoto = null">✕</button>
        <h2>Set Location</h2>
        <div class="members-modal-list">
          <div
            v-for="loc in albumLocations"
            :key="loc.id"
            class="members-modal-row location-picker-row"
            :class="{ active: locationPickerPhoto?.locationId === loc.id }"
            @click="setPhotoLocation(loc.id)"
          >
            <span>📍 {{ loc.name }}</span>
            <span v-if="locationPickerPhoto?.locationId === loc.id" style="color:#a6e3a1;font-size:0.85em">✓ current</span>
          </div>
          <div
            class="members-modal-row location-picker-row"
            :class="{ active: !locationPickerPhoto?.locationId }"
            @click="setPhotoLocation(null)"
          >
            <span style="color:#6c7086">— No location</span>
            <span v-if="!locationPickerPhoto?.locationId" style="color:#a6e3a1;font-size:0.85em">✓ current</span>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import "emoji-picker-element";
import MemberAvatar from "./MemberAvatar.vue";
import PhotoSwipe from "photoswipe";
import "photoswipe/style.css";
import { authHeaders, authJsonHeaders } from "../utils/session";
import { useDraggable } from "../utils/draggable";
import { formatAlbumDate } from "../utils/formatDate";

interface Photo {
  id: number;
  channelId: string;
  url: string;
  filename?: string;
  uploadedById?: string;
  uploadedByName?: string;
  uploadedAt?: string;
  takenAt?: string;
  width?: number;
  height?: number;
  caption?: string;
  score?: number;
  userVote?: string | null;
  userIsSuper?: number | null;
  taggedIds?: string[];
  locationId?: number | null;
}
interface Member { userId: string; displayName: string; firstName?: string; avatarUrl?: string }
interface Section { label: string; photos: Photo[] }
interface AlbumInfo { groupName?: string; locations?: { id: number; name: string }[]; startDate?: string; endDate?: string }

const props = defineProps<{
  sections: Section[];
  members: Member[];
  canDelete?: boolean;
  albumMap?: Record<string, AlbumInfo>;
  canLoadMore?: boolean;
  totalCount?: number;
  albumLocations?: { id: number; name: string }[];
}>();

const emit = defineEmits<{
  photoDeleted: [id: number];
  loadMore: [];
}>();

const dragTagging = useDraggable();
const dragVotes = useDraggable();
const dragDelete = useDraggable();

const votes = ref<Record<number, { score: number; userVote: string | null; userIsSuper: number }>>({});
let refreshLightboxVotes: (() => void) | null = null;
const emojiPickerPhotoId = ref<number | null>(null);
function getEmojiReact(emoji: string): { reactType: string; isSuper: boolean } {
  return emoji === '⭐' ? { reactType: '⭐', isSuper: true } : { reactType: emoji, isSuper: false };
}
function getVoteLabel(userVote: string | null | undefined): string {
  return userVote || '👍';
}

const showTagging = ref(false);
const showTaggingPicker = ref(false);
const taggingPhoto = ref<Photo | null>(null);
const taggingSelection = ref(new Set<string>());

const voteModalPhoto = ref<Photo | null>(null);
const voteModalData = ref<{ userId: string; displayName: string; firstName: string | null; avatarUrl: string | null; reactType: string; isSuper: number }[]>([]);

const deletingPhoto = ref<Photo | null>(null);
const deleting = ref(false);
const showLocationPicker = ref(false);
const collapsedSections = ref(new Set<string>());
function toggleSection(label: string) {
  const s = new Set(collapsedSections.value);
  s.has(label) ? s.delete(label) : s.add(label);
  collapsedSections.value = s;
}
const locationPickerPhoto = ref<Photo | null>(null);
let pendingReopenIndex: number | null = null;
let activePswp: any = null;
let activeDsArray: { src: string; width: number; height: number; msrc: string }[] | null = null;
let frozenPhotos: Photo[] | null = null;
let lightboxLoadingMore = false;

const allPhotos = computed(() => props.sections.flatMap(s => s.photos));

// When new photos are appended (e.g. "load more"), push them into the live PhotoSwipe datasource
watch(() => allPhotos.value.length, (newLen, oldLen) => {
  if (!activeDsArray || !activePswp || newLen <= oldLen) return;
  for (let i = oldLen; i < newLen; i++) {
    const p = allPhotos.value[i];
    activeDsArray.push({ src: p.url, width: p.width || 1200, height: p.height || 900, msrc: thumbUrl(p.url) });
    frozenPhotos?.push(p);
  }
  lightboxLoadingMore = false;
  activePswp.element?.classList.remove('pswp--is-last');
  refreshLightboxVotes?.();
});

const taggedMembers = computed(() =>
  props.members.filter(m => taggingSelection.value.has(m.userId))
);
const pickableMembers = computed(() =>
  props.members.filter(m => !taggingSelection.value.has(m.userId))
);

async function fetchVoteBreakdown(photo: Photo) {
  const res = await fetch(`/api/album/${photo.channelId}/photos/${photo.id}/votes`, { headers: authHeaders() });
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
  return votes.value[photo.id] ?? { score: photo.score ?? 0, userVote: photo.userVote ?? null, userIsSuper: photo.userIsSuper ?? 0 };
}

async function doVote(channelId: string, photoId: number, reactType: string, isSuper: boolean) {
  const res = await fetch(`/api/album/${channelId}/photos/${photoId}/vote`, {
    method: "POST",
    headers: authJsonHeaders(),
    body: JSON.stringify({ reactType, isSuper }),
  });
  if (res.ok) {
    const { score, userVote, userIsSuper } = await res.json();
    votes.value = { ...votes.value, [photoId]: { score, userVote, userIsSuper } };
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
  return photo.taggedIds.map(id => props.members.find(m => m.userId === id)).filter(Boolean) as Member[];
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
  taggingSelection.value = new Set(props.members.map(m => m.userId));
  showTaggingPicker.value = false;
  saveTagging();
}

async function saveTagging() {
  if (!taggingPhoto.value) return;
  const userIds = [...taggingSelection.value];
  const res = await fetch(`/api/album/${taggingPhoto.value.channelId}/photos/${taggingPhoto.value.id}/tagged`, {
    method: "POST",
    headers: authJsonHeaders(),
    body: JSON.stringify({ userIds }),
  });
  if (res.ok) {
    const photo = allPhotos.value.find(p => p.id === taggingPhoto.value!.id);
    if (photo) {
      photo.taggedIds = userIds;
      refreshLightboxVotes?.();
    }
  }
}

function spawnFloat(x: number, y: number, voteType: string, grey = false) {
  const emoji = voteType === "fav" ? "⭐" : voteType === "up" ? "👍" : voteType;
  const span = document.createElement("span");
  span.className = grey ? "vote-float vote-float-grey" : "vote-float";
  span.textContent = emoji;
  span.style.left = `${x}px`;
  span.style.top = `${y}px`;
  document.body.appendChild(span);
  span.addEventListener("animationend", () => span.remove());
}

function isRemovingVote(state: { userVote: string | null; userIsSuper: number }, reactType: string, isSuper: boolean) {
  return state.userVote === reactType && !!state.userIsSuper === isSuper;
}

function handleVote(e: Event, photo: Photo, reactType: string, isSuper = false) {
  const rect = (e.currentTarget as Element).getBoundingClientRect();
  const state = getVoteState(photo);
  spawnFloat(rect.left + rect.width / 2, rect.top + rect.height / 2, reactType, isRemovingVote(state, reactType, isSuper));
  doVote(photo.channelId, photo.id, reactType, isSuper);
}

function confirmDelete(photo: Photo) { dragDelete.reset(); deletingPhoto.value = photo; }

function handleEscape(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  if (showTaggingPicker.value) { showTaggingPicker.value = false; e.stopImmediatePropagation(); return; }
  if (showTagging.value)       { showTagging.value = false;       e.stopImmediatePropagation(); return; }
  if (voteModalPhoto.value)    { voteModalPhoto.value = null;     e.stopImmediatePropagation(); return; }
  if (deletingPhoto.value)     { deletingPhoto.value = null;      e.stopImmediatePropagation(); return; }
}
onMounted(() => window.addEventListener("keydown", handleEscape, true));
onUnmounted(() => window.removeEventListener("keydown", handleEscape, true));

async function deletePhoto() {
  if (!deletingPhoto.value) return;
  deleting.value = true;
  const res = await fetch(`/api/album/${deletingPhoto.value.channelId}/photos/${deletingPhoto.value.id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  deleting.value = false;
  if (res.ok) {
    const deletedId = deletingPhoto.value!.id;
    deletingPhoto.value = null;
    if (activePswp) {
      const currIdx = activePswp.currIndex;
      const oldPhotos = allPhotos.value;
      const deletedPos = oldPhotos.findIndex(p => p.id === deletedId);
      emit("photoDeleted", deletedId);
      const newLen = allPhotos.value.length;
      if (newLen > 0) {
        const newIdx = deletedPos <= currIdx ? Math.max(0, currIdx - 1) : currIdx;
        pendingReopenIndex = Math.min(newIdx, newLen - 1);
      }
      activePswp.close();
    } else {
      emit("photoDeleted", deletedId);
    }
  }
}

function openLightbox(index: number) {
  const photos = allPhotos.value;
  frozenPhotos = [...photos];
  activePswp = null;
  const dsArray = photos.map(p => ({ src: p.url, width: p.width || 1200, height: p.height || 900, msrc: thumbUrl(p.url) }));
  activeDsArray = dsArray;
  lightboxLoadingMore = false;
  const pswp = new PhotoSwipe({
    dataSource: dsArray,
    index,
    bgOpacity: 1,
    zoom: true,
    close: true,
    counter: false,
    arrowKeys: true,
    pinchToClose: false,
    closeOnVerticalDrag: false,
    bgClickAction: "none",
    loop: false,
    paddingFn: (viewportSize: { x: number; y: number }) =>
      viewportSize.x >= 768 ? { top: 20, bottom: 110, left: 0, right: 0 } : { top: 0, bottom: 0, left: 0, right: 0 },
  });
  // Always use msrc thumbnail as placeholder, even for pre-loaded inactive slides
  (pswp as any).addFilter("placeholderSrc", (_: any, content: any) => content.data.msrc || false);

  activePswp = pswp;
  history.pushState({ pswp: true }, "");
  let closedByBack = false;
  const onPopState = () => { closedByBack = true; pswp.close(); };
  window.addEventListener("popstate", onPopState, { once: true });

  // Keyboard up to vote (up → super → neutral cycle)
  const onKeyDown = (e: KeyboardEvent) => {
    const p = frozenPhotos![pswp.currIndex];
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const state = getVoteState(p);
      const isSuper = !!(state.userVote && state.userIsSuper);
      const wasUp = !!(state.userVote && !state.userIsSuper);
      const newIsSuper = wasUp;  // first press = up, second = super
      spawnFloat(window.innerWidth / 2, window.innerHeight / 2, newIsSuper ? '⭐' : '👍');
      doVote(p.channelId, p.id, newIsSuper ? '⭐' : '👍', newIsSuper);
    }
  };
  window.addEventListener("keydown", onKeyDown);

  // Mobile single tap = upvote, double tap = favourite

  // Hide full image until loaded so thumbnail placeholder stays visible
  (pswp as any).on("contentAppend", (e: any) => {
    const img: HTMLImageElement | undefined = e.content?.element;
    if (!img || img.classList.contains("pswp__img--placeholder") || img.complete) return;
    img.style.opacity = "0";
  });
  (pswp as any).on("loadComplete", (e: any) => {
    const img: HTMLImageElement | undefined = e.content?.element;
    if (img) { img.style.transition = "opacity 150ms"; img.style.opacity = ""; }
  });

  pswp.on("close", () => {
    activePswp = null;
    frozenPhotos = null;
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
    if (showTagging.value) openTagging(frozenPhotos![pswp.currIndex]);
    if (voteModalPhoto.value) openVoteModal(frozenPhotos![pswp.currIndex]);
    // Trigger load more when within 5 of the end
    if (props.canLoadMore && !lightboxLoadingMore && pswp.currIndex >= dsArray.length - 5) {
      lightboxLoadingMore = true;
      emit('loadMore');
    }
  });
  pswp.on("uiRegister", () => {
    let topMetaEl: HTMLElement | null = null;
    let captionDisplayEl: HTMLElement | null = null;
    pswp.ui!.registerElement({
      name: "custom-counter",
      order: 5,
      isButton: false,
      appendTo: "bar",
      onInit: (el) => {
        el.className = "pswp__counter";
        const update = () => {
          el.textContent = `${pswp.currIndex + 1} / ${props.totalCount ?? dsArray.length}`;
        };
        pswp.on("change", update);
        update();
      },
    });
    const buildMetaHtml = (p: Photo) => {
      const album = props.albumMap?.[p.channelId];
      const locs = album?.locations ?? [];
      let locationStr: string | undefined;
      if (locs.length === 0) {
        locationStr = undefined;
      } else {
        const photoLocation = p.locationId ? (props.albumLocations?.find(l => l.id === p.locationId)?.name ?? locs.find(l => l.id === p.locationId)?.name) : null;
        if (photoLocation) {
          locationStr = album?.groupName ? `${photoLocation}, ${album.groupName}` : photoLocation;
        } else if (locs.length === 1) {
          locationStr = album?.groupName ? `${locs[0].name}, ${album.groupName}` : locs[0].name;
        } else {
          locationStr = album?.groupName;
        }
      }
      const locationHtml = locationStr ? `<span class="pswp-location">📍 ${locationStr}</span>` : "";
      let dateStr = p?.takenAt ? formatTime(p.takenAt) : "";
      if (!dateStr && album?.startDate) dateStr = formatAlbumDate(album.startDate, album.endDate, true);
      const dateHtml = (locationHtml || dateStr)
        ? `${locationHtml}${dateStr ? `<span class="pswp-caption-date">${dateStr}</span>` : ""}`
        : "";
      const uploaderMember = p?.uploadedById ? props.members.find(m => m.userId === p.uploadedById) : null;
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
          const { dateHtml, uploaderHtml } = buildMetaHtml(frozenPhotos![pswp.currIndex]);
          el.innerHTML = `<div class="pswp-meta-left">${dateHtml}</div><div class="pswp-meta-right">${uploaderHtml}</div>`;
        };
        pswp.on("change", update);
        update();
      },
    });
    // Dedicated caption display
    pswp.ui!.registerElement({
      name: "caption-display",
      order: 7,
      isButton: false,
      appendTo: "root",
      onInit: (el) => {
        captionDisplayEl = el;
        el.style.cssText = "position:absolute;left:0;right:0;text-align:center;color:rgba(255,255,255,0.9);font-size:0.9em;text-shadow:0 1px 3px rgba(0,0,0,0.6);pointer-events:none;padding:0 20px;display:none";
      },
    });
    // Caption editor
    let captionEditorEl: HTMLElement | null = null;
    let captionInputEl: HTMLTextAreaElement | null = null;
    const showCaptionEditor = () => {
      if (!captionEditorEl || !captionInputEl) return;
      captionInputEl.value = frozenPhotos![pswp.currIndex].caption ?? "";
      captionEditorEl.style.display = "flex";
      captionInputEl.focus();
    };
    const hideCaptionEditor = () => { if (captionEditorEl) captionEditorEl.style.display = "none"; };
    pswp.ui!.registerElement({
      name: "caption-editor",
      order: 10,
      isButton: false,
      appendTo: "root",
      onInit: (el) => {
        captionEditorEl = el;
        el.style.cssText = "display:none;position:absolute;bottom:70px;left:50%;transform:translateX(-50%);width:min(420px,90vw);background:#181825;border-radius:10px;padding:16px;flex-direction:column;gap:10px;z-index:10;box-shadow:0 4px 24px rgba(0,0,0,0.7)";
        const ta = document.createElement("textarea");
        ta.placeholder = "Add a caption…";
        ta.rows = 3;
        ta.style.cssText = "width:100%;background:#313244;color:#cdd6f4;border:none;border-radius:6px;padding:8px;font-size:0.95em;resize:vertical;font-family:inherit";
        ta.addEventListener("keydown", (e) => {
          e.stopPropagation();
          if (e.key === "Escape") { e.preventDefault(); hideCaptionEditor(); }
        });
        captionInputEl = ta;
        const actions = document.createElement("div");
        actions.style.cssText = "display:flex;gap:8px;justify-content:flex-end";
        const saveBtn = document.createElement("button");
        saveBtn.textContent = "Save";
        saveBtn.style.cssText = "background:#cba6f7;color:#1e1e2e;border:none;border-radius:6px;padding:6px 16px;cursor:pointer;font-weight:600";
        saveBtn.addEventListener("click", async () => {
          const photo = frozenPhotos![pswp.currIndex];
          const caption = ta.value;
          saveBtn.textContent = "Saving…";
          saveBtn.disabled = true;
          const res = await fetch(`/api/album/${photo.channelId}/photos/${photo.id}/caption`, {
            method: "PATCH", headers: authJsonHeaders(), body: JSON.stringify({ caption }),
          });
          saveBtn.textContent = "Save";
          saveBtn.disabled = false;
          if (res.ok) { photo.caption = caption || undefined; refreshLightboxVotes?.(); hideCaptionEditor(); }
        });
        const cancelBtn = document.createElement("button");
        cancelBtn.textContent = "Cancel";
        cancelBtn.style.cssText = "background:#45475a;color:#cdd6f4;border:none;border-radius:6px;padding:6px 16px;cursor:pointer";
        cancelBtn.addEventListener("click", hideCaptionEditor);
        actions.append(saveBtn, cancelBtn);
        el.append(ta, actions);
      },
    });
    pswp.ui!.registerElement({
      name: "caption-button",
      order: 8,
      isButton: true,
      html: "💬",
      appendTo: "bar",
      onClick: () => { showCaptionEditor(); },
    });
    if (props.albumLocations?.length) {
      pswp.ui!.registerElement({
        name: "location-button",
        order: 7,
        isButton: true,
        html: "📍",
        appendTo: "bar",
        onClick: () => {
          const photo = frozenPhotos![pswp.currIndex];
          if (photo) { locationPickerPhoto.value = photo; showLocationPicker.value = true; }
        },
      });
    }
    if (props.canDelete) {
      pswp.ui!.registerElement({
        name: "delete-button",
        order: 9,
        isButton: true,
        html: "🗑",
        appendTo: "bar",
        onClick: () => {
          confirmDelete(frozenPhotos![pswp.currIndex]);
        },
      });
    }
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
            const { reactType, isSuper } = getEmojiReact(btn.dataset.vote!);
            const p = frozenPhotos![pswp.currIndex];
            const rect = btn.getBoundingClientRect();
            spawnFloat(rect.left + rect.width / 2, rect.top + rect.height / 2, btn.dataset.vote!, isRemovingVote(getVoteState(p), reactType, isSuper));
            doVote(p.channelId, p.id, reactType, isSuper);
          } else if (featBtn) {
            openTagging(frozenPhotos![pswp.currIndex], true);
          } else if ((e.target as Element).closest("[data-action='score']")) {
            openVoteModal(frozenPhotos![pswp.currIndex]);
          }
        });
        const update = () => {
          const p = frozenPhotos![pswp.currIndex];
          const { score, userVote, userIsSuper } = getVoteState(p);
          const upActive = !!userVote && !userIsSuper;
          const favActive = !!userVote && !!userIsSuper;
          const taggedMs = props.members.filter(m => p.taggedIds?.includes(m.userId));
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
              <button data-vote="⭐" class="pswp-vote-btn${favActive ? " active-fav" : ""}">⭐</button>
              <button data-vote="👍" class="pswp-vote-btn${upActive ? " active-up" : ""}">${userVote && !userIsSuper ? userVote : '👍'}</button>
              <button data-action="score" class="pswp-vote-btn pswp-vote-score">${score}</button>
              <button data-action="tagged" class="pswp-vote-btn${taggedMs.length ? " active-fav" : ""}">${taggedBtnContent}</button>
            </div>
          `;
          if (topMetaEl) topMetaEl.innerHTML = `<div class="pswp-meta-left">${dateHtml}</div><div class="pswp-meta-right">${uploaderHtml}</div>`;
          if (captionDisplayEl) {
            const caption = p.caption || "";
            captionDisplayEl.textContent = caption;
            captionDisplayEl.style.display = caption ? "block" : "none";
            if (caption) {
              captionDisplayEl.style.top = "auto";
              captionDisplayEl.style.bottom = window.innerWidth >= 768 ? "75px" : "72px";
            }
          }
        };
        refreshLightboxVotes = update;
        pswp.on("change", update);
        update();
      },
    });
  });
  pswp.on("close", () => { refreshLightboxVotes = null; activeDsArray = null; lightboxLoadingMore = false; });
  pswp.init();
}

async function setPhotoLocation(locationId: number | null) {
  const photo = locationPickerPhoto.value;
  if (!photo) return;
  await fetch(`/api/photo/${photo.id}/location`, {
    method: "PUT", headers: authJsonHeaders(), body: JSON.stringify({ locationId }),
  });
  photo.locationId = locationId;
  showLocationPicker.value = false;
  locationPickerPhoto.value = null;
  refreshLightboxVotes?.();
}

function loadFull(e: Event, fullUrl: string) {
  const img = e.target as HTMLImageElement;
  if (img.dataset.fullLoaded) return;
  img.dataset.fullLoaded = "1";
  const full = new Image();
  full.src = fullUrl;
  full.onload = () => { img.src = fullUrl; };
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
