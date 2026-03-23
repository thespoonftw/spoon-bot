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
              <img v-if="member.avatarUrl" :src="member.avatarUrl" class="member-avatar" />
              <span v-else class="member-avatar member-avatar-placeholder">{{ (member.firstName || member.displayName)[0] }}</span>
              <span class="member-name">{{ member.firstName || member.displayName }}</span>
            </div>
            <button class="btn-icon" @click="openEditMembers" title="Edit members">✏️</button>
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
              <button class="vote-btn vote-group" :class="{ active: photo.featuredIds?.length }" @click.stop="openFeatured(photo)" title="Tagging">
                <span v-if="getFeaturedMembers(photo).length >= 4" style="color:#fff"><span class="tag-count">{{ getFeaturedMembers(photo).length }}</span>👥</span>
                <span v-else-if="getFeaturedMembers(photo).length" class="featured-avatars">
                  <template v-for="(m, idx) in getFeaturedMembers(photo)" :key="m.userId">
                    <img v-if="m.avatarUrl" :src="m.avatarUrl" class="featured-mini-avatar" />
                    <span v-else class="featured-mini-avatar featured-mini-initial">{{ (m.firstName || m.displayName)[0] }}</span>
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
    <div class="modal-overlay" v-if="showFeatured" style="z-index:200000">
      <div class="modal">
        <button class="modal-close" @click="showFeatured = false">✕</button>
        <h2>Tagging</h2>
        <div class="members-modal-list" style="min-height:40px">
          <div v-for="member in featuredMembers" :key="member.userId" class="members-modal-row">
            <img v-if="member.avatarUrl" :src="member.avatarUrl" class="member-avatar" />
            <span v-else class="member-avatar member-avatar-placeholder">{{ (member.firstName || member.displayName)[0] }}</span>
            <span class="members-modal-name">{{ member.firstName || member.displayName }}</span>
            <button class="btn-remove" @click="removeFeatured(member.userId)">remove</button>
          </div>
          <p v-if="featuredMembers.length === 0" class="empty" style="font-size:0.85em;padding:6px 0">No one tagged yet.</p>
        </div>
        <div style="margin-top:12px">
          <button class="btn-secondary btn-small" @click="showFeaturedPicker = true">+ Add User</button>
        </div>
        <div class="modal-actions">
          <button class="btn-primary" @click="saveFeatured" :disabled="savingFeatured">{{ savingFeatured ? 'Saving…' : 'Save' }}</button>
        </div>
      </div>
    </div>
    <!-- Featured User Picker Modal -->
    <div class="modal-overlay" v-if="showFeaturedPicker" style="z-index:210000">
      <div class="modal">
        <button class="modal-close" @click="showFeaturedPicker = false; if (!featuredSelection.size) showFeatured = false">✕</button>
        <h2>Tag User</h2>
        <div class="members-modal-list">
          <div class="members-modal-row featured-row" @click="addEveryone()">
            <span class="member-avatar member-avatar-placeholder">★</span>
            <span class="members-modal-name"><strong>Everyone</strong></span>
          </div>
          <div v-for="member in pickableMembers" :key="member.userId" class="members-modal-row featured-row" @click="addFeatured(member.userId)">
            <img v-if="member.avatarUrl" :src="member.avatarUrl" class="member-avatar" />
            <span v-else class="member-avatar member-avatar-placeholder">{{ (member.firstName || member.displayName)[0] }}</span>
            <span class="members-modal-name">{{ member.firstName || member.displayName }}</span>
          </div>
          <p v-if="pickableMembers.length === 0" class="empty" style="font-size:0.85em;padding:6px 0">All members already featured.</p>
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

  <Teleport to="body">
    <div class="modal-overlay" v-if="showMemberPicker" style="z-index:200">
      <div class="modal">
        <button class="modal-close" @click="showMemberPicker = false">✕</button>
        <h2>Add User</h2>
        <div class="members-modal-list">
          <div v-for="u in addableUsers" :key="u.userId" class="members-modal-row featured-row" @click="pickAndAddMember(u.userId)">
            <img v-if="u.avatarUrl" :src="u.avatarUrl" class="member-avatar" />
            <span v-else class="member-avatar member-avatar-placeholder">{{ (u.firstName || u.displayName)[0] }}</span>
            <span class="members-modal-name">{{ u.firstName || u.displayName }}</span>
          </div>
          <p v-if="addableUsers.length === 0" class="empty" style="font-size:0.85em;padding:6px 0">No more users to add.</p>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Edit Members Modal -->
  <div class="modal-overlay" v-if="showEditMembers">
    <div class="modal">
      <button class="modal-close" @click="showEditMembers = false">✕</button>
      <h2>Members</h2>
      <div class="members-modal-list">
        <div v-for="member in allMembers.filter(m => !deletedMemberIds.has(m.userId))" :key="member.userId" :class="['members-modal-row', { 'member-hidden': member.hidden }]">
          <img v-if="member.avatarUrl" :src="member.avatarUrl" class="member-avatar" />
          <span v-else class="member-avatar member-avatar-placeholder">{{ (member.firstName || member.displayName)[0] }}</span>
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
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import PhotoSwipe from "photoswipe";
import "photoswipe/style.css";
import { getSession } from "../utils/session";

interface Photo { id: number; url: string; filename?: string; uploadedById?: string; uploadedByName?: string; uploadedAt: string; takenAt?: string; width?: number; height?: number; score?: number; userVote?: string | null; featuredIds?: string[] }
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
const saving = ref(false);
const editError = ref("");
const editForm = ref({ name: "", location: "", startDate: "", endDate: "" });

const votes = ref<Record<number, { score: number; userVote: string | null }>>({});
let refreshLightboxVotes: (() => void) | null = null;

const showFeatured = ref(false);
const showFeaturedPicker = ref(false);
const featuredPhoto = ref<Photo | null>(null);
const featuredSelection = ref(new Set<string>());
const savingFeatured = ref(false);

const SORT_KEY = 'snek_sort_by';
const sortBy = ref<'popular' | 'tagging' | 'uploader' | 'newest' | 'oldest'>(
  (localStorage.getItem(SORT_KEY) as any) ?? 'popular'
);
watch(sortBy, val => localStorage.setItem(SORT_KEY, val));
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
      ? photos.filter(p => !p.featuredIds?.length)
      : photos.filter(p => p.featuredIds?.includes(target));
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

const featuredMembers = computed(() =>
  album.value?.members.filter(m => featuredSelection.value.has(m.userId)) ?? []
);
const pickableMembers = computed(() =>
  album.value?.members.filter(m => !featuredSelection.value.has(m.userId)) ?? []
);

async function fetchVoteBreakdown(photo: Photo) {
  if (!album.value) return [];
  const session = getSession();
  const res = await fetch(`/api/album/${album.value.channelId}/photos/${photo.id}/votes`, { headers: { Authorization: `Bearer ${session}` } });
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
  const session = getSession();
  const res = await fetch(`/api/album/${album.value.channelId}/photos/${photoId}/vote`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session}` },
    body: JSON.stringify({ voteType }),
  });
  if (res.ok) {
    const { score, userVote } = await res.json();
    votes.value = { ...votes.value, [photoId]: { score, userVote } };
    refreshLightboxVotes?.();
  }
}

function openFeatured(photo: Photo) {
  featuredPhoto.value = photo;
  featuredSelection.value = new Set(photo.featuredIds ?? []);
  showFeatured.value = true;
  showFeaturedPicker.value = !photo.featuredIds?.length;
}

function getFeaturedMembers(photo: Photo): Member[] {
  if (!photo.featuredIds?.length) return [];
  return photo.featuredIds.map(id => allMembers.value.find(m => m.userId === id)).filter(Boolean) as Member[];
}

function removeFeatured(userId: string) {
  const s = new Set(featuredSelection.value);
  s.delete(userId);
  featuredSelection.value = s;
}

function addFeatured(userId: string) {
  const s = new Set(featuredSelection.value);
  s.add(userId);
  featuredSelection.value = s;
  showFeaturedPicker.value = false;
}

function addEveryone() {
  featuredSelection.value = new Set(album.value?.members.map(m => m.userId) ?? []);
  showFeaturedPicker.value = false;
}

async function saveFeatured() {
  if (!album.value || !featuredPhoto.value) return;
  savingFeatured.value = true;
  const session = getSession();
  const userIds = [...featuredSelection.value];
  const res = await fetch(`/api/album/${album.value.channelId}/photos/${featuredPhoto.value.id}/featured`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session}` },
    body: JSON.stringify({ userIds }),
  });
  savingFeatured.value = false;
  if (res.ok) {
    const photo = album.value.photos.find(p => p.id === featuredPhoto.value!.id);
    if (photo) {
      photo.featuredIds = userIds;
      refreshLightboxVotes?.();
    }
    showFeatured.value = false;
  }
}

interface AllMember extends Member { hidden: number; rsvpStatus?: string }
const showEditMembers = ref(false);
const showMemberPicker = ref(false);
const allMembers = ref<AllMember[]>([]);
const deletedMemberIds = ref(new Set<string>());
const allUsers = ref<Member[]>([]);
const addMemberUserId = ref("");
const addMemberName = ref("");
const addMemberError = ref("");
const addableUsers = computed(() => {
  const memberIds = new Set(allMembers.value.map(m => m.userId));
  return allUsers.value.filter(u => !memberIds.has(u.userId));
});

onMounted(async () => {
  const session = getSession();
  const [albumRes, checkRes] = await Promise.all([
    fetch(`/api/album/${route.params.channelId}`, { headers: { Authorization: `Bearer ${session}` } }),
    fetch(`/api/auth/check`, { headers: session ? { Authorization: `Bearer ${session}` } : {} }),
  ]);
  if (albumRes.ok) {
    const data = await albumRes.json();
    album.value = data;
    allMembers.value = (data.members ?? []) as AllMember[];
  }
  if (checkRes.ok) {
    const { userId } = await checkRes.json();
    currentUserId.value = userId ?? null;
    const members = album.value?.members ?? [];
    tagFilterUserId.value = (userId && members.some(m => m.userId === userId)) ? userId : '__nobody__';
  }
  loading.value = false;
});

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
  const session = getSession();
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
      const uploaderHtml = p?.uploadedByName ? `<span class="pswp-caption-uploader">Uploader: ${avatarHtml}${p.uploadedByName}</span>` : "";
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
      name: "bottom-bar",
      order: 9,
      isButton: false,
      appendTo: "root",
      onInit: (el) => {
        el.addEventListener("click", (e) => {
          const btn = (e.target as Element).closest("[data-vote]") as HTMLElement | null;
          const featBtn = (e.target as Element).closest("[data-action='featured']") as HTMLElement | null;
          if (btn) {
            const voteType = btn.dataset.vote!;
            const p = photos[pswp.currIndex];
            const rect = btn.getBoundingClientRect();
            spawnFloat(rect.left + rect.width / 2, rect.top + rect.height / 2, voteType, isRemovingVote(getVoteState(p).userVote, voteType));
            doVote(p.id, voteType);
          } else if (featBtn) {
            openFeatured(photos[pswp.currIndex]);
          } else if ((e.target as Element).closest("[data-action='score']")) {
            openVoteModal(photos[pswp.currIndex]);
          }
        });
        const update = () => {
          const p = photos[pswp.currIndex];
          const { score, userVote } = getVoteState(p);
          const upActive = userVote === "up" || userVote === "fav";
          const featuredMs = (album.value?.members ?? []).filter(m => p.featuredIds?.includes(m.userId));
          const avStyle = (i: number) => `width:1.4em;height:1.4em;border-radius:50%;object-fit:cover;pointer-events:none;border:1.5px solid rgba(0,0,0,0.4);flex-shrink:0;${i > 0 ? "margin-left:-0.5em;" : ""}`;
          const featuredBtnContent = featuredMs.length >= 4
            ? `<span style="color:#fff"><span class="tag-count">${featuredMs.length}</span>👥</span>`
            : featuredMs.length
            ? `<span style="display:inline-flex;align-items:center">${featuredMs.map((m, i) => m.avatarUrl
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
              <button data-action="featured" class="pswp-vote-btn${featuredMs.length ? " active-fav" : ""}">${featuredBtnContent}</button>
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
  const session = getSession();
  const res = await fetch(`/api/album/${album.value.channelId}/share`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session}` },
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
  const session = getSession();
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
  const session = getSession();
  const [membersRes, usersRes] = await Promise.all([
    fetch(`/api/album/${album.value.channelId}/members`, { headers: { Authorization: `Bearer ${session}` } }),
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
      return 5; // decline
    };
    allMembers.value = raw.sort((a, b) =>
      memberOrder(a) - memberOrder(b) || (a.firstName || a.displayName).localeCompare(b.firstName || b.displayName)
    );
  }
  if (usersRes.ok) allUsers.value = await usersRes.json();
  addMemberUserId.value = "";
  addMemberName.value = "";
  showEditMembers.value = true;
}

async function addExistingMember() {
  if (!album.value || !addMemberUserId.value) return;
  const session = getSession();
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

async function pickAndAddMember(userId: string) {
  showMemberPicker.value = false;
  addMemberUserId.value = userId;
  await addExistingMember();
}

async function addNewMember() {
  if (!album.value || !addMemberName.value.trim()) return;
  const trimmed = addMemberName.value.trim();
  addMemberError.value = "";
  const allKnown = [...allMembers.value, ...allUsers.value];
  const dup = allKnown.find(u => (u.firstName || u.displayName).toLowerCase() === trimmed.toLowerCase());
  if (dup) {
    addMemberError.value = `"${trimmed}" is already someone's name`;
    return;
  }
  const session = getSession();
  const res = await fetch(`/api/album/${album.value.channelId}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session}` },
    body: JSON.stringify({ name: trimmed }),
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
  const session = getSession();
  const res = await fetch(`/api/album/${album.value.channelId}/members/${userId}?remove=true`, { method: "DELETE", headers: { Authorization: `Bearer ${session}` } });
  if (res.ok) {
    deletedMemberIds.value = new Set([...deletedMemberIds.value, userId]);
    album.value.members = album.value.members.filter(m => m.userId !== userId);
  }
}

async function hideMember(userId: string) {
  if (!album.value) return;
  const session = getSession();
  const res = await fetch(`/api/album/${album.value.channelId}/members/${userId}`, { method: "DELETE", headers: { Authorization: `Bearer ${session}` } });
  if (res.ok) {
    const m = allMembers.value.find(m => m.userId === userId);
    if (m) m.hidden = 1;
    album.value.members = album.value.members.filter(m => m.userId !== userId);
  }
}

async function unhideMember(userId: string) {
  if (!album.value) return;
  const session = getSession();
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
  return { coming: "Attended", maybe: "Maybe", decline: "Declined", lurking: "Lurking" }[status] ?? status;
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
  const session = getSession();
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
