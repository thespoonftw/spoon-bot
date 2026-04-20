<template>
  <template v-for="section in sections" :key="section.label">
    <h3 v-if="section.label" class="gallery-section-header" @click="toggleSection(section.label)">
      <span class="section-collapse-icon">{{ collapsedSections.has(section.label) ? '▶' : '▼' }}</span>
      {{ section.label }}
      <span class="section-photo-count">{{ (section as any).total ?? section.photos.length }}</span>
      <span class="section-collapse-spacer"></span>
    </h3>
    <template v-if="!section.label || !collapsedSections.has(section.label)">
      <div class="gallery">
        <div v-for="photo in section.photos" :key="photo.id" class="photo-item" @click="openLightbox(allPhotos.indexOf(photo))">
          <img :src="thumbUrl(photo.url)" loading="lazy" @error="($event.target as HTMLImageElement).src = photo.url" />

          <div class="photo-votes" @click.stop>
            <button class="vote-btn vote-fav" :class="{ active: !!getVoteState(photo).userIsSuper }" @click="handleVote($event, photo, '⭐', true)" title="Super vote">⭐</button>
            <div class="vote-up-wrapper" @mouseenter="showEmojiPicker(photo.id)" @mouseleave="hideEmojiPicker()">
              <button class="vote-btn vote-up" :class="{ active: !!getVoteState(photo).userVote, 'is-super': !!getVoteState(photo).userIsSuper }" @click.stop="handleVote($event, photo, getVoteState(photo).userVote || '👍', !!getVoteState(photo).userIsSuper)" title="Vote"><template v-if="getVoteState(photo).userIsSuper"><span class="super-side">{{ getVoteLabel(getVoteState(photo).userVote) }}</span>{{ getVoteLabel(getVoteState(photo).userVote) }}<span class="super-side">{{ getVoteLabel(getVoteState(photo).userVote) }}</span></template><template v-else>{{ getVoteLabel(getVoteState(photo).userVote) }}</template></button>
              <div v-if="emojiPickerPhotoId === photo.id" class="emoji-picker-wrap" @click.stop @mousedown.stop @mouseenter="cancelHideEmojiPicker()" @mouseleave="hideEmojiPicker()">
                <div class="ep-search-row">
                  <input class="ep-search" v-model="emojiSearch" placeholder="Search emoji…" @click.stop @mousedown.stop @keydown.stop />
                  <button class="ep-super-toggle" :class="{ active: superMode }" @click.stop="toggleSuperMode(photo)">Super</button>
                  <button class="ep-close-btn" @click.stop="closeEmojiPicker()">✕</button>
                </div>
                <div class="ep-emoji-grid">
                  <button v-for="em in emojiSearchResults" :key="em" class="ep-emoji-btn" :class="{ 'ep-emoji-active': em === pickerCurrentVote }" @click.stop="pickEmoji($event, photo, em)">{{ em }}</button>
                  <span v-if="emojiSearchResults.length === 0" class="ep-no-results">No results</span>
                </div>
              </div>
            </div>
            <div class="vote-hover-wrapper">
              <button class="vote-btn vote-score" @mouseenter="showVoteHover(photo)" @mouseleave="hideVoteHover()" @click.stop>
                <span class="score-side-emoji" :style="sideEmojisCache[photo.id]?.[0] ? {} : { visibility: 'hidden' }">{{ sideEmojisCache[photo.id]?.[0] || '?' }}</span>
                <span>{{ getVoteState(photo).score }}</span>
                <span class="score-side-emoji" :style="sideEmojisCache[photo.id]?.[1] ? {} : { visibility: 'hidden' }">{{ sideEmojisCache[photo.id]?.[1] || '?' }}</span>
              </button>
              <div v-if="hoverVotePhotoId === photo.id" class="vote-hover-popup" @mouseenter="cancelHideVoteHover()" @mouseleave="hideVoteHover()">
                <div v-if="hoverVoteData.length === 0" class="vote-hover-empty">Fetching…</div>
                <div v-for="v in hoverVoteData" :key="v.userId" class="vote-hover-row">
                  <img v-if="v.avatarUrl" :src="v.avatarUrl" class="vote-hover-avatar" />
                  <span v-else class="vote-hover-avatar vote-hover-initial">{{ (v.firstName || v.displayName)[0] }}</span>
                  <span class="vote-hover-name">{{ v.firstName || v.displayName }}</span>
                  <span class="vote-hover-icon"><span class="super-side" :style="v.isSuper ? {} : { visibility: 'hidden' }">{{ v.reactType }}</span><span :class="{ 'is-super-glow': v.isSuper }">{{ v.reactType }}</span><span class="super-side" :style="v.isSuper ? {} : { visibility: 'hidden' }">{{ v.reactType }}</span></span>
                </div>
              </div>
            </div>
            <div class="vote-hover-wrapper">
              <button class="vote-btn vote-group" :class="{ active: photo.taggedIds?.length }" @mouseenter="showTagHover(photo)" @mouseleave="hideTagHover()" @click.stop="openTagging(photo, true)" title="Tagging">
                <span v-if="getTaggedMembers(photo).length >= 4" style="color:#fff"><span class="tag-count">{{ getTaggedMembers(photo).length }}</span>👥</span>
                <span v-else-if="getTaggedMembers(photo).length" class="tagging-avatars">
                  <template v-for="m in getTaggedMembers(photo)" :key="m.userId">
                    <img v-if="m.avatarUrl" :src="m.avatarUrl" class="tagging-mini-avatar" />
                    <span v-else class="tagging-mini-avatar tagging-mini-initial">{{ (m.firstName || m.displayName)[0] }}</span>
                  </template>
                </span>
                <span v-else>👥</span>
              </button>
              <div v-if="hoverTagPhotoId === photo.id && getTaggedMembers(photo).length" class="vote-hover-popup" @mouseenter="cancelHideTagHover()" @mouseleave="hideTagHover()">
                <div v-for="m in getTaggedMembers(photo)" :key="m.userId" class="vote-hover-row">
                  <img v-if="m.avatarUrl" :src="m.avatarUrl" class="vote-hover-avatar" />
                  <span v-else class="vote-hover-avatar vote-hover-initial">{{ (m.firstName || m.displayName)[0] }}</span>
                  <span class="vote-hover-name">{{ m.firstName || m.displayName }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="gallery-mobile">
        <div v-for="photo in section.photos" :key="photo.id" class="photo-item-mobile" @click="openLightbox(allPhotos.indexOf(photo))">
          <img :src="thumbUrl(photo.url)" loading="lazy" />
          <span v-if="getVoteState(photo).score > 0" class="mobile-vote-badge">♥ {{ getVoteState(photo).score }}</span>
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
    <div class="modal-overlay locations-modal-overlay" v-if="showLocationPicker" style="z-index:200000;pointer-events:none;background:none">
      <div class="modal" :style="dragLocation.style.value" style="pointer-events:auto">
        <button class="modal-close" @click="showLocationPicker = false; locationPickerPhoto = null">✕</button>
        <h2 class="modal-drag-handle" @mousedown="dragLocation.onMouseDown">Set Location</h2>
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
import { Database } from 'emoji-picker-element';
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
const dragDelete = useDraggable();
const dragLocation = useDraggable();

const votes = ref<Record<number, { score: number; userVote: string | null; userIsSuper: number }>>({});
let refreshLightboxVotes: (() => void) | null = null;
const emojiPickerPhotoId = ref<number | null>(null);
const superMode = ref(false);
const emojiSearch = ref('');
const DEFAULT_EMOJIS = ['👍','❤️','🔥','😂','😲','😢','🥰','🤔'];
const emojiSearchResults = ref<string[]>(DEFAULT_EMOJIS);
const pickerCurrentVote = ref<string | null>(null);
let pickerBaseEmojis: string[] = DEFAULT_EMOJIS;
const emojiDb = new Database();
let emojiPickerHideTimer: ReturnType<typeof setTimeout> | null = null;
let emojiSearchTimer: ReturnType<typeof setTimeout> | null = null;

watch(emojiSearch, (q) => {
  if (emojiSearchTimer) clearTimeout(emojiSearchTimer);
  if (!q.trim()) { emojiSearchResults.value = pickerBaseEmojis; return; }
  emojiSearchTimer = setTimeout(async () => {
    const results = await emojiDb.getEmojiBySearchQuery(q.trim());
    emojiSearchResults.value = (results as any[]).map(e => e.unicode).filter(Boolean).slice(0, 8);
  }, 150);
});
function showEmojiPicker(photoId: number) {
  if (emojiPickerHideTimer) { clearTimeout(emojiPickerHideTimer); emojiPickerHideTimer = null; }
  if (emojiPickerPhotoId.value === photoId) return;
  emojiPickerPhotoId.value = photoId;
  emojiSearch.value = '';
  const photo = allPhotos.value.find(p => p.id === photoId);
  const state = photo ? getVoteState(photo) : null;
  superMode.value = !!(state?.userVote && state?.userIsSuper);
  const currentVote = state?.userVote ?? null;
  pickerCurrentVote.value = currentVote;
  pickerBaseEmojis = currentVote && !DEFAULT_EMOJIS.includes(currentVote)
    ? [currentVote, ...DEFAULT_EMOJIS.slice(1)]
    : DEFAULT_EMOJIS;
  emojiSearchResults.value = pickerBaseEmojis;
  nextTick(() => {
    const input = document.querySelector<HTMLInputElement>('.emoji-picker-wrap .ep-search');
    input?.focus();
  });
}
function toggleSuperMode(photo: Photo) {
  superMode.value = !superMode.value;
  const state = getVoteState(photo);
  if (state.userVote) doVote(photo.channelId, photo.id, state.userVote, superMode.value);
}
function hideEmojiPicker() {
  emojiPickerHideTimer = setTimeout(() => { emojiPickerPhotoId.value = null; }, 150);
}
function cancelHideEmojiPicker() {
  if (emojiPickerHideTimer) { clearTimeout(emojiPickerHideTimer); emojiPickerHideTimer = null; }
}
function closeEmojiPicker() {
  if (emojiPickerHideTimer) { clearTimeout(emojiPickerHideTimer); emojiPickerHideTimer = null; }
  emojiPickerPhotoId.value = null;
}
function pickEmoji(e: MouseEvent, photo: Photo, emoji: string) {
  handleVote(e as Event, photo, emoji, superMode.value);
  emojiPickerPhotoId.value = null;
  superMode.value = false;
  emojiSearch.value = '';
}
type VoteBreakdownRow = { userId: string; displayName: string; firstName: string | null; avatarUrl: string | null; reactType: string; isSuper: number };
const hoverVotePhotoId = ref<number | null>(null);
const hoverVoteData = ref<VoteBreakdownRow[]>([]);
const hoverVoteCache = new Map<number, VoteBreakdownRow[]>();
const sideEmojisCache = ref<Record<number, [string | null, string | null]>>({});
let hoverVoteHideTimer: ReturnType<typeof setTimeout> | null = null;

function getTopSideEmojis(photoId: number): [string | null, string | null] {
  const data = hoverVoteCache.get(photoId);
  if (!data) return [null, null];
  const counts = new Map<string, number>();
  for (const v of data) {
    if (v.reactType !== '👍') counts.set(v.reactType, (counts.get(v.reactType) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const result: [string | null, string | null] = [sorted[1]?.[0] ?? null, sorted[0]?.[0] ?? null];
  sideEmojisCache.value = { ...sideEmojisCache.value, [photoId]: result };
  return result;
}
async function showVoteHover(photo: Photo) {
  if (!getVoteState(photo).score) return;
  if (hoverVoteHideTimer) { clearTimeout(hoverVoteHideTimer); hoverVoteHideTimer = null; }
  hoverVotePhotoId.value = photo.id;
  if (hoverVoteCache.has(photo.id)) {
    hoverVoteData.value = hoverVoteCache.get(photo.id)!;
  } else {
    hoverVoteData.value = [];
    setTimeout(async () => {
      const data = await fetchVoteBreakdown(photo);
      hoverVoteCache.set(photo.id, data);
      getTopSideEmojis(photo.id);
      if (hoverVotePhotoId.value === photo.id) hoverVoteData.value = data;
    }, 200);
  }
}
function hideVoteHover() {
  hoverVoteHideTimer = setTimeout(() => { hoverVotePhotoId.value = null; }, 150);
}
function cancelHideVoteHover() {
  if (hoverVoteHideTimer) { clearTimeout(hoverVoteHideTimer); hoverVoteHideTimer = null; }
}

const hoverTagPhotoId = ref<number | null>(null);
let hoverTagHideTimer: ReturnType<typeof setTimeout> | null = null;

function showTagHover(photo: Photo) {
  if (hoverTagHideTimer) { clearTimeout(hoverTagHideTimer); hoverTagHideTimer = null; }
  hoverTagPhotoId.value = photo.id;
}
function hideTagHover() {
  hoverTagHideTimer = setTimeout(() => { hoverTagPhotoId.value = null; }, 150);
}
function cancelHideTagHover() {
  if (hoverTagHideTimer) { clearTimeout(hoverTagHideTimer); hoverTagHideTimer = null; }
}


function getVoteLabel(userVote: string | null | undefined): string {
  return userVote || '👍';
}

const showTagging = ref(false);
const showTaggingPicker = ref(false);
const taggingPhoto = ref<Photo | null>(null);
const taggingSelection = ref(new Set<string>());


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

// Prefetch all vote breakdowns in one request per album so side emojis appear on load
watch(allPhotos, async (photos) => {
  const channelIds = [...new Set(photos.map(p => p.channelId))];
  for (const channelId of channelIds) {
    const res = await fetch(`/api/album/${channelId}/votes`, { headers: authHeaders() });
    if (!res.ok) continue;
    const bulk: Record<number, VoteBreakdownRow[]> = await res.json();
    for (const [id, data] of Object.entries(bulk)) {
      hoverVoteCache.set(Number(id), data);
      getTopSideEmojis(Number(id));
    }
  }
}, { immediate: true });

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
    hoverVoteCache.delete(photoId);
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
    zoom: false,
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
      const wasUp = !!(state.userVote && !state.userIsSuper);
      const newIsSuper = wasUp;  // first press = up, second = super
      const reactType = state.userVote || '👍';
      spawnFloat(window.innerWidth / 2, window.innerHeight / 2, reactType);
      doVote(p.channelId, p.id, reactType, newIsSuper);
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
    const idx = pendingReopenIndex;
    pendingReopenIndex = null;
    if (idx !== null) nextTick(() => openLightbox(idx));
  });
  let lbPickerOpen = false;
  let lbSuperMode = false;
  let lbCurrentVote: string | null = null;
  const lbSideFetching = new Set<number>();
  let lbBaseEmojis: string[] = DEFAULT_EMOJIS;
  let lbPickerEl: HTMLElement | null = null;
  let lbSuperBtn: HTMLButtonElement | null = null;
  let lbRenderEmojis: ((emojis: string[], active?: string | null) => void) | null = null;
  let lbPickerHideTimer: ReturnType<typeof setTimeout> | null = null;
  let lbHoverPopupEl: HTMLElement | null = null;
  let lbHoverHideTimer: ReturnType<typeof setTimeout> | null = null;

  function openLbPicker() {
    if (lbPickerHideTimer) { clearTimeout(lbPickerHideTimer); lbPickerHideTimer = null; }
    if (!lbPickerEl) return;
    const p = frozenPhotos?.[pswp.currIndex];
    const state = p ? getVoteState(p) : null;
    lbSuperMode = !!(state?.userVote && state?.userIsSuper);
    lbCurrentVote = state?.userVote ?? null;
    lbBaseEmojis = lbCurrentVote && !DEFAULT_EMOJIS.includes(lbCurrentVote)
      ? [lbCurrentVote, ...DEFAULT_EMOJIS.slice(1)]
      : DEFAULT_EMOJIS;
    if (lbRenderEmojis) lbRenderEmojis(lbBaseEmojis, lbCurrentVote);
    if (lbSuperBtn) lbSuperBtn.className = `ep-super-toggle${lbSuperMode ? " active" : ""}`;
    lbPickerEl.style.display = "block";
    lbPickerOpen = true;
    const lbSearchInput = lbPickerEl.querySelector<HTMLInputElement>('.ep-search');
    lbSearchInput?.focus();
  }
  function scheduledCloseLbPicker() {
    lbPickerHideTimer = setTimeout(closeLbPicker, 150);
  }
  function cancelScheduledCloseLbPicker() {
    if (lbPickerHideTimer) { clearTimeout(lbPickerHideTimer); lbPickerHideTimer = null; }
  }
  function closeLbPicker() {
    if (lbPickerHideTimer) { clearTimeout(lbPickerHideTimer); lbPickerHideTimer = null; }
    if (!lbPickerEl) return;
    lbPickerEl.style.display = "none";
    lbPickerOpen = false;
    lbSuperMode = false;
    if (lbSuperBtn) lbSuperBtn.className = "ep-super-toggle";
  }

  function showLbHoverPopup(anchorBtn: HTMLElement, content: string) {
    if (!lbHoverPopupEl) return;
    if (lbHoverHideTimer) { clearTimeout(lbHoverHideTimer); lbHoverHideTimer = null; }
    lbHoverPopupEl.innerHTML = content;
    lbHoverPopupEl.style.display = "block";
    const anchor = anchorBtn.getBoundingClientRect();
    const pr = (lbHoverPopupEl.offsetParent as HTMLElement)?.getBoundingClientRect() ?? { left: 0, top: 0, height: window.innerHeight };
    lbHoverPopupEl.style.left = `${anchor.left + anchor.width / 2 - pr.left}px`;
    lbHoverPopupEl.style.bottom = `${pr.height - (anchor.top - pr.top) + 6}px`;
    lbHoverPopupEl.style.transform = "translateX(-50%)";
  }
  function hideLbHoverPopup() {
    lbHoverHideTimer = setTimeout(() => { if (lbHoverPopupEl) lbHoverPopupEl.style.display = "none"; }, 150);
  }
  function cancelHideLbHoverPopup() {
    if (lbHoverHideTimer) { clearTimeout(lbHoverHideTimer); lbHoverHideTimer = null; }
  }

  pswp.on("change", () => {
    closeLbPicker();
    const hp = lbHoverPopupEl as HTMLElement | null; if (hp) hp.style.display = "none";
    if (showTagging.value) openTagging(frozenPhotos![pswp.currIndex]);
    if (showLocationPicker.value) locationPickerPhoto.value = frozenPhotos![pswp.currIndex];
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
      const locs = album?.locations?.length ? album.locations : (props.albumLocations ?? []);
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
      const uploaderLabel = window.innerWidth >= 768 ? "Uploader:" : "By:";
      const uploaderHtml = p?.uploadedByName ? `<span class="pswp-caption-uploader">${uploaderLabel} ${avatarHtml}${p.uploadedByName}</span>${uploadedAtHtml}` : "";
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
          if (photo) {
            locationPickerPhoto.value = photo;
            if (!showLocationPicker.value) dragLocation.reset();
            showLocationPicker.value = true;
          }
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
        // Mobile: single tap = vote, double tap = super 👍, long press = open picker
        let lbTouchTimer: ReturnType<typeof setTimeout> | null = null;
        let lbTouchIsLong = false;
        let lbLastTapTime = 0;
        el.addEventListener("touchstart", (e) => {
          const emojiBtn = (e.target as Element).closest("[data-action='emoji-toggle']");
          if (!emojiBtn) return;
          lbTouchIsLong = false;
          lbTouchTimer = setTimeout(() => {
            lbTouchIsLong = true;
            lbPickerOpen ? closeLbPicker() : openLbPicker();
          }, 320);
        }, { passive: true });
        el.addEventListener("touchmove", () => {
          if (lbTouchTimer) { clearTimeout(lbTouchTimer); lbTouchTimer = null; }
          const hp = lbHoverPopupEl as HTMLElement | null; if (hp) hp.style.display = "none";
        }, { passive: true });
        el.addEventListener("touchend", (e) => {
          if (lbTouchTimer) { clearTimeout(lbTouchTimer); lbTouchTimer = null; }
          const isScore = !!(e.target as Element).closest("[data-action='score']");
          if (!isScore) { const hp = lbHoverPopupEl as HTMLElement | null; if (hp) hp.style.display = "none"; }
          const emojiBtn = (e.target as Element).closest("[data-action='emoji-toggle']");
          if (emojiBtn) {
            e.preventDefault();
            if (lbTouchIsLong) return;
            const now = Date.now();
            const isDoubleTap = now - lbLastTapTime < 300;
            lbLastTapTime = isDoubleTap ? 0 : now;
            const p = frozenPhotos![pswp.currIndex];
            const state = getVoteState(p);
            const rect = (emojiBtn as HTMLElement).getBoundingClientRect();
            if (isDoubleTap) {
              spawnFloat(rect.left + rect.width / 2, rect.top + rect.height / 2, '👍', isRemovingVote(state, '👍', true));
              doVote(p.channelId, p.id, '👍', true);
            } else {
              const reactType = state.userVote || '👍';
              const isSuper = !!state.userIsSuper;
              spawnFloat(rect.left + rect.width / 2, rect.top + rect.height / 2, reactType, isRemovingVote(state, reactType, isSuper));
              doVote(p.channelId, p.id, reactType, isSuper);
            }
            return;
          }
          const scoreBtn2 = (e.target as Element).closest("[data-action='score']") as HTMLElement | null;
          if (scoreBtn2) {
            e.preventDefault();
            const hpEl2 = lbHoverPopupEl as HTMLElement | null;
            if (hpEl2?.style.display === "block") { hpEl2.style.display = "none"; return; }
            const p2 = frozenPhotos![pswp.currIndex];
            if (!getVoteState(p2).score) return;
            const mkRow = (avatarUrl: string | null, name: string, reactType: string, isSuper: number) =>
              `<div class="vote-hover-row">${avatarUrl ? `<img src="${avatarUrl}" class="vote-hover-avatar" />` : `<span class="vote-hover-avatar vote-hover-initial">${name[0]}</span>`}<span class="vote-hover-name">${name}</span><span class="vote-hover-icon"><span class="super-side" style="visibility:${isSuper ? 'visible' : 'hidden'}">${reactType}</span><span class="${isSuper ? 'is-super-glow' : ''}">${reactType}</span><span class="super-side" style="visibility:${isSuper ? 'visible' : 'hidden'}">${reactType}</span></span></div>`;
            (async () => {
              if (hoverVoteCache.has(p2.id)) {
                const data = hoverVoteCache.get(p2.id)!;
                if (!data.length) return;
                showLbHoverPopup(scoreBtn2, data.map(v => mkRow(v.avatarUrl, v.firstName || v.displayName, v.reactType, v.isSuper)).join(""));
              } else {
                showLbHoverPopup(scoreBtn2, '<div class="vote-hover-empty">Fetching…</div>');
                const data: VoteBreakdownRow[] = await fetchVoteBreakdown(p2);
                hoverVoteCache.set(p2.id, data);
                if (!data.length) { hideLbHoverPopup(); return; }
                const hpEl = lbHoverPopupEl as HTMLElement | null;
                if (hpEl?.style.display === "block") showLbHoverPopup(scoreBtn2, data.map(v => mkRow(v.avatarUrl, v.firstName || v.displayName, v.reactType, v.isSuper)).join(""));
              }
            })();
          }
        });

        let lbDesktopLastClick = 0;
        el.addEventListener("click", (e) => {
          const featBtn = (e.target as Element).closest("[data-action='tagged']") as HTMLElement | null;
          if ((e.target as Element).closest("[data-action='emoji-toggle']")) {
            if (window.innerWidth < 768) {
              // handled by touchend
            } else {
              const now = Date.now();
              const isDoubleClick = now - lbDesktopLastClick < 300;
              lbDesktopLastClick = isDoubleClick ? 0 : now;
              const p = frozenPhotos![pswp.currIndex];
              const state = getVoteState(p);
              const btn = (e.target as Element).closest("[data-action='emoji-toggle']") as HTMLElement;
              const rect = btn.getBoundingClientRect();
              if (isDoubleClick) {
                spawnFloat(rect.left + rect.width / 2, rect.top + rect.height / 2, '👍', isRemovingVote(state, '👍', true));
                doVote(p.channelId, p.id, '👍', true);
              } else {
                const reactType = state.userVote || '👍';
                const isSuper = !!state.userIsSuper;
                spawnFloat(rect.left + rect.width / 2, rect.top + rect.height / 2, reactType, isRemovingVote(state, reactType, isSuper));
                doVote(p.channelId, p.id, reactType, isSuper);
              }
            }
          } else if (featBtn) {
            closeLbPicker();
            const hp = lbHoverPopupEl as HTMLElement | null; if (hp) hp.style.display = "none";
            openTagging(frozenPhotos![pswp.currIndex], true);
          }
        });

        const update = () => {
          const p = frozenPhotos![pswp.currIndex];
          const { score, userVote, userIsSuper } = getVoteState(p);
          const voteActive = !!userVote;
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
          const [leftEmoji, rightEmoji] = getTopSideEmojis(p.id);
          if (!hoverVoteCache.has(p.id) && score > 0 && !lbSideFetching.has(p.id)) {
            lbSideFetching.add(p.id);
            fetchVoteBreakdown(p).then(data => {
              lbSideFetching.delete(p.id);
              hoverVoteCache.set(p.id, data);
              if (frozenPhotos?.[pswp.currIndex]?.id === p.id) update();
            });
          }
          el.innerHTML = `
            <div class="pswp-meta-left">${dateHtml}</div>
            <div class="pswp-meta-right">${uploaderHtml}</div>
            <div class="pswp-votes">
              <button data-action="emoji-toggle" class="pswp-vote-btn${voteActive ? (userIsSuper ? " active-fav" : " active-up") : ""}"><span class="super-side" style="visibility:${userIsSuper ? 'visible' : 'hidden'}">${userVote || '👍'}</span><span${userIsSuper ? ' class="is-super-glow"' : ''}>${userVote || '👍'}</span><span class="super-side" style="visibility:${userIsSuper ? 'visible' : 'hidden'}">${userVote || '👍'}</span></button>
              <button data-action="score" class="pswp-vote-btn pswp-vote-score"><span class="score-side-emoji" style="visibility:${leftEmoji ? 'visible' : 'hidden'}">${leftEmoji || '?'}</span><span>${score}</span><span class="score-side-emoji" style="visibility:${rightEmoji ? 'visible' : 'hidden'}">${rightEmoji || '?'}</span></button>
              <button data-action="tagged" class="pswp-vote-btn${taggedMs.length ? " active-fav" : ""}">${taggedBtnContent}</button>
            </div>
          `;
          // Desktop hover behaviours — listeners attached fresh each update (buttons are recreated by innerHTML)
          if (window.innerWidth >= 768) {
            const emojiBtn = el.querySelector("[data-action='emoji-toggle']") as HTMLElement | null;
            const scoreBtn = el.querySelector("[data-action='score']") as HTMLElement | null;
            const taggedBtn2 = el.querySelector("[data-action='tagged']") as HTMLElement | null;
            if (emojiBtn) {
              emojiBtn.addEventListener("mouseenter", openLbPicker);
              emojiBtn.addEventListener("mouseleave", scheduledCloseLbPicker);
            }
            if (scoreBtn && score > 0) {
              scoreBtn.addEventListener("mouseenter", async () => {
                const mkRow = (avatarUrl: string | null, name: string, reactType: string, isSuper: number) =>
                  `<div class="vote-hover-row">${avatarUrl ? `<img src="${avatarUrl}" class="vote-hover-avatar" />` : `<span class="vote-hover-avatar vote-hover-initial">${name[0]}</span>`}<span class="vote-hover-name">${name}</span><span class="vote-hover-icon"><span class="super-side" style="visibility:${isSuper ? 'visible' : 'hidden'}">${reactType}</span><span class="${isSuper ? 'is-super-glow' : ''}">${reactType}</span><span class="super-side" style="visibility:${isSuper ? 'visible' : 'hidden'}">${reactType}</span></span></div>`;
                if (hoverVoteCache.has(p.id)) {
                  const data = hoverVoteCache.get(p.id)!;
                  if (!data.length) return;
                  showLbHoverPopup(scoreBtn!, data.map(v => mkRow(v.avatarUrl, v.firstName || v.displayName, v.reactType, v.isSuper)).join(""));
                } else {
                  showLbHoverPopup(scoreBtn!, '<div class="vote-hover-empty">Fetching…</div>');
                  const data = await fetchVoteBreakdown(p);
                  hoverVoteCache.set(p.id, data);
                  getTopSideEmojis(p.id);
                  if (!data.length) { hideLbHoverPopup(); return; }
                  const hpEl = lbHoverPopupEl as HTMLElement | null;
                  if (hpEl?.style.display === "block") showLbHoverPopup(scoreBtn!, data.map((v: VoteBreakdownRow) => mkRow(v.avatarUrl, v.firstName || v.displayName, v.reactType, v.isSuper)).join(""));
                }
              });
              scoreBtn.addEventListener("mouseleave", hideLbHoverPopup);
            }
            if (taggedBtn2 && taggedMs.length) {
              taggedBtn2.addEventListener("mouseenter", () => {
                const html = taggedMs.map(m => `<div class="vote-hover-row">${m.avatarUrl ? `<img src="${m.avatarUrl}" class="vote-hover-avatar" />` : `<span class="vote-hover-avatar vote-hover-initial">${(m.firstName || m.displayName)[0]}</span>`}<span class="vote-hover-name">${m.firstName || m.displayName}</span></div>`).join("");
                showLbHoverPopup(taggedBtn2, html);
              });
              taggedBtn2.addEventListener("mouseleave", hideLbHoverPopup);
            }
          }
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

    pswp.ui!.registerElement({
      name: "lb-emoji-picker",
      order: 16,
      isButton: false,
      appendTo: "root",
      onInit: (el) => {
        lbPickerEl = el;
        el.className = "emoji-picker-wrap";
        el.style.cssText = "display:none;position:absolute;bottom:90px;left:50%;transform:translateX(-50%);z-index:20;width:320px";
        el.addEventListener("click", e => e.stopPropagation());
        el.addEventListener("mouseenter", cancelScheduledCloseLbPicker);
        el.addEventListener("mouseleave", scheduledCloseLbPicker);

        const searchRow = document.createElement("div");
        searchRow.className = "ep-search-row";
        const searchInput = document.createElement("input");
        searchInput.className = "ep-search";
        searchInput.placeholder = "Search emoji…";
        searchInput.addEventListener("keydown", e => e.stopPropagation());
        searchInput.addEventListener("mousedown", e => e.stopPropagation());
        const superBtn = document.createElement("button");
        superBtn.className = "ep-super-toggle";
        superBtn.textContent = "Super";
        lbSuperBtn = superBtn;
        superBtn.addEventListener("click", e => {
          e.stopPropagation();
          lbSuperMode = !lbSuperMode;
          superBtn.className = `ep-super-toggle${lbSuperMode ? " active" : ""}`;
          const p = frozenPhotos?.[pswp.currIndex];
          if (p && lbCurrentVote) doVote(p.channelId, p.id, lbCurrentVote, lbSuperMode);
        });
        const closeBtn = document.createElement("button");
        closeBtn.className = "ep-close-btn";
        closeBtn.textContent = "✕";
        closeBtn.addEventListener("click", (e) => { e.stopPropagation(); closeLbPicker(); });
        searchRow.append(searchInput, superBtn, closeBtn);

        const emojiGrid = document.createElement("div");
        emojiGrid.className = "ep-emoji-grid";

        const renderEmojis = (emojis: string[], active?: string | null) => {
          emojiGrid.innerHTML = "";
          for (const em of emojis) {
            const btn = document.createElement("button");
            btn.className = "ep-emoji-btn" + (em === active ? " ep-emoji-active" : "");
            btn.textContent = em;
            btn.addEventListener("click", (ev) => {
              ev.stopPropagation();
              const p = frozenPhotos![pswp.currIndex];
              const rect = btn.getBoundingClientRect();
              spawnFloat(rect.left + rect.width / 2, rect.top + rect.height / 2, em, isRemovingVote(getVoteState(p), em, lbSuperMode));
              doVote(p.channelId, p.id, em, lbSuperMode);
              closeLbPicker();
            });
            emojiGrid.appendChild(btn);
          }
        };
        lbRenderEmojis = renderEmojis;
        renderEmojis(DEFAULT_EMOJIS);

        let lbSearchTimer: ReturnType<typeof setTimeout> | null = null;
        searchInput.addEventListener("input", () => {
          if (lbSearchTimer) clearTimeout(lbSearchTimer);
          const q = searchInput.value.trim();
          if (!q) { renderEmojis(lbBaseEmojis, lbCurrentVote); return; }
          lbSearchTimer = setTimeout(async () => {
            const results = await emojiDb.getEmojiBySearchQuery(q);
            renderEmojis((results as any[]).map((r: any) => r.unicode).filter(Boolean).slice(0, 8), lbCurrentVote);
          }, 150);
        });

        el.append(searchRow, emojiGrid);
      },
    });

    pswp.ui!.registerElement({
      name: "lb-hover-popup",
      order: 17,
      isButton: false,
      appendTo: "root",
      onInit: (el) => {
        lbHoverPopupEl = el;
        el.className = "vote-hover-popup";
        el.style.cssText = "display:none;position:absolute;z-index:20;min-width:140px;max-width:200px";
        el.addEventListener("mouseenter", cancelHideLbHoverPopup);
        el.addEventListener("mouseleave", hideLbHoverPopup);
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
