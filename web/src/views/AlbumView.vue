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
      <div class="gallery">
        <div v-for="(photo, i) in album.photos" :key="photo.id" class="photo-item" @click="openLightbox(i)">
          <img :src="thumbUrl(photo.url)" loading="lazy" @error="($event.target as HTMLImageElement).src = photo.url" />
          <button class="photo-delete-btn" @click.stop="confirmDelete(photo)" title="Delete photo">🗑</button>
          <div class="photo-votes" @click.stop>
            <button class="vote-btn vote-fav" :class="{ active: getVoteState(photo).userVote === 'fav' }" @click="handleVote($event, photo, 'fav')" title="Favourite">⭐</button>
            <button class="vote-btn vote-up" :class="{ active: getVoteState(photo).userVote === 'up' || getVoteState(photo).userVote === 'fav' }" @click="handleVote($event, photo, 'up')" title="Upvote">👍</button>
            <span class="vote-score">{{ getVoteState(photo).score }}</span>
            <button class="vote-btn vote-down" :class="{ active: getVoteState(photo).userVote === 'down' }" @click="handleVote($event, photo, 'down')" title="Downvote">👎</button>
            <button class="vote-btn vote-group" :class="{ active: photo.featuredIds?.length }" @click.stop="openFeatured(photo)" title="Tagging" style="padding:2px 3px">
              <span v-if="getFeaturedMembers(photo).length >= 4" style="color:#fff">{{ getFeaturedMembers(photo).length }}👥</span>
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
        <div v-for="(photo, i) in album.photos" :key="photo.id" class="photo-item-mobile" @click="openLightbox(i)">
          <img :src="photo.url" loading="lazy" />
        </div>
      </div>
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
        <div v-for="member in allMembers" :key="member.userId" :class="['members-modal-row', { 'member-hidden': member.hidden }]">
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
import { ref, computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import PhotoSwipe from "photoswipe";
import "photoswipe/style.css";

interface Photo { id: number; url: string; filename?: string; uploadedById?: string; uploadedByName?: string; uploadedAt: string; takenAt?: string; width?: number; height?: number; lat?: number; lon?: number; score?: number; userVote?: string | null; featuredIds?: string[] }
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

const featuredMembers = computed(() =>
  album.value?.members.filter(m => featuredSelection.value.has(m.userId)) ?? []
);
const pickableMembers = computed(() =>
  album.value?.members.filter(m => !featuredSelection.value.has(m.userId)) ?? []
);

function getVoteState(photo: Photo) {
  return votes.value[photo.id] ?? { score: photo.score ?? 0, userVote: photo.userVote ?? null };
}

async function doVote(photoId: number, voteType: string) {
  if (!album.value) return;
  const session = localStorage.getItem("snek_session");
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
  if (!photo.featuredIds?.length || !album.value) return [];
  return photo.featuredIds.map(id => album.value!.members.find(m => m.userId === id)).filter(Boolean) as Member[];
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

async function saveFeatured() {
  if (!album.value || !featuredPhoto.value) return;
  savingFeatured.value = true;
  const session = localStorage.getItem("snek_session");
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
const allUsers = ref<Member[]>([]);
const addMemberUserId = ref("");
const addMemberName = ref("");
const addMemberError = ref("");
const addableUsers = computed(() => {
  const memberIds = new Set(allMembers.value.map(m => m.userId));
  return allUsers.value.filter(u => !memberIds.has(u.userId));
});

onMounted(async () => {
  const session = localStorage.getItem("snek_session");
  const res = await fetch(`/api/album/${route.params.channelId}`, {
    headers: { Authorization: `Bearer ${session}` },
  });
  if (res.ok) {
    const data = await res.json();
    data.photos.sort((a: Photo, b: Photo) => (b.score ?? 0) - (a.score ?? 0));
    album.value = data;
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
      const mapHtml = (p?.lat && p?.lon) ? `<a class="pswp-caption-map" href="https://www.google.com/maps?q=${p.lat},${p.lon}" target="_blank">📍 Map</a>` : "";
      const uploaderHtml = p?.uploadedByName ? `<span class="pswp-caption-uploader">By: ${p.uploadedByName}</span>` : "";
      return { dateHtml, mapHtml, uploaderHtml };
    };
    pswp.ui!.registerElement({
      name: "top-meta",
      order: 8,
      isButton: false,
      appendTo: "root",
      onInit: (el) => {
        topMetaEl = el;
        const update = () => {
          const { dateHtml, mapHtml, uploaderHtml } = buildMetaHtml(photos[pswp.currIndex]);
          el.innerHTML = `<div class="pswp-meta-left">${dateHtml}${mapHtml}</div><div class="pswp-meta-right">${uploaderHtml}</div>`;
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
          }
        });
        const update = () => {
          const p = photos[pswp.currIndex];
          const { score, userVote } = getVoteState(p);
          const upActive = userVote === "up" || userVote === "fav";
          const featuredMs = (album.value?.members ?? []).filter(m => p.featuredIds?.includes(m.userId));
          const avStyle = (i: number) => `width:1em;height:1em;border-radius:50%;object-fit:cover;pointer-events:none;border:1.5px solid rgba(0,0,0,0.4);flex-shrink:0;${i > 0 ? "margin-left:-0.35em;" : ""}`;
          const featuredBtnContent = featuredMs.length >= 4
            ? `<span style="color:#fff">${featuredMs.length}👥</span>`
            : featuredMs.length
            ? `<span style="display:inline-flex;align-items:center">${featuredMs.map((m, i) => m.avatarUrl
                ? `<img src="${m.avatarUrl}" style="${avStyle(i)}display:block" />`
                : `<span style="${avStyle(i)}background:#585b70;display:inline-flex;align-items:center;justify-content:center;"><span style="font-size:0.55em;font-weight:600;color:#cdd6f4;pointer-events:none">${(m.firstName || m.displayName)[0]}</span></span>`
              ).join("")}</span>`
            : "👥";
          const { dateHtml, mapHtml, uploaderHtml } = buildMetaHtml(p);
          el.innerHTML = `
            <div class="pswp-meta-left">${dateHtml}${mapHtml}</div>
            <div class="pswp-meta-right">${uploaderHtml}</div>
            <div class="pswp-votes">
              <button data-vote="fav" class="pswp-vote-btn${userVote === "fav" ? " active-fav" : ""}">⭐</button>
              <button data-vote="up" class="pswp-vote-btn${upActive ? " active-up" : ""}">👍</button>
              <span class="pswp-vote-score">${score}</span>
              <button data-vote="down" class="pswp-vote-btn${userVote === "down" ? " active-down" : ""}">👎</button>
              <button data-action="featured" class="pswp-vote-btn${featuredMs.length ? " active-fav" : ""}" style="padding:3px">${featuredBtnContent}</button>
            </div>
          `;
          if (topMetaEl) topMetaEl.innerHTML = `<div class="pswp-meta-left">${dateHtml}${mapHtml}</div><div class="pswp-meta-right">${uploaderHtml}</div>`;
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
  const session = localStorage.getItem("snek_session");
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
  const session = localStorage.getItem("snek_session");
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
  const session = localStorage.getItem("snek_session");
  const res = await fetch(`/api/album/${album.value.channelId}/members/${userId}?remove=true`, { method: "DELETE", headers: { Authorization: `Bearer ${session}` } });
  if (res.ok) {
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
  const session = localStorage.getItem("snek_session");
  for (let i = 0; i < files.length; i++) {
    uploadProgress.value = `${i + 1}/${files.length}`;
    const fd = new FormData();
    fd.append("photo", files[i]);
    const gps = await readGpsFromFile(files[i]);
    if (gps) { fd.append("lat", String(gps.lat)); fd.append("lon", String(gps.lon)); }
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

async function readGpsFromFile(file: File): Promise<{ lat: number; lon: number } | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const buf = new Uint8Array(e.target!.result as ArrayBuffer);
        if (buf[0] !== 0xFF || buf[1] !== 0xD8) return resolve(null);
        let pos = 2;
        while (pos < buf.length - 4) {
          if (buf[pos] !== 0xFF) break;
          const marker = buf[pos + 1];
          const segLen = (buf[pos + 2] << 8) | buf[pos + 3];
          if (marker === 0xE1) {
            const hdr = String.fromCharCode(buf[pos+4], buf[pos+5], buf[pos+6], buf[pos+7], buf[pos+8], buf[pos+9]);
            if (hdr === "Exif\0\0") {
              const ts = pos + 10; // TIFF start
              const le = buf[ts] === 0x49;
              const r16 = (o: number) => le ? buf[ts+o] | buf[ts+o+1]<<8 : buf[ts+o]<<8 | buf[ts+o+1];
              const r32 = (o: number) => le
                ? (buf[ts+o] | buf[ts+o+1]<<8 | buf[ts+o+2]<<16 | buf[ts+o+3]*16777216) >>> 0
                : ((buf[ts+o]*16777216 | buf[ts+o+1]<<16 | buf[ts+o+2]<<8 | buf[ts+o+3]) >>> 0);
              const ifd0 = r32(4), ifd0n = r16(ifd0);
              let gpsOff: number | null = null;
              for (let i = 0; i < ifd0n; i++) { const t = ifd0 + 2 + i * 12; if (r16(t) === 0x8825) { gpsOff = r32(t + 8); break; } }
              if (gpsOff === null) return resolve(null);
              const gpsn = r16(gpsOff);
              let latRef = "N", lonRef = "E", latDataOff: number | null = null, lonDataOff: number | null = null;
              for (let i = 0; i < gpsn; i++) {
                const t = gpsOff + 2 + i * 12, tag = r16(t);
                if (tag === 0x0001) latRef = String.fromCharCode(buf[ts + t + 8]);
                else if (tag === 0x0002 && r16(t+2) === 5 && r32(t+4) === 3) latDataOff = r32(t + 8);
                else if (tag === 0x0003) lonRef = String.fromCharCode(buf[ts + t + 8]);
                else if (tag === 0x0004 && r16(t+2) === 5 && r32(t+4) === 3) lonDataOff = r32(t + 8);
              }
              if (latDataOff === null || lonDataOff === null) return resolve(null);
              const rat = (o: number) => { const n = r32(o), d = r32(o+4); return d === 0 ? NaN : n / d; };
              const dms = (o: number, ref: string) => { const v = rat(o) + rat(o+8)/60 + rat(o+16)/3600; return (ref === "S" || ref === "W") ? -v : v; };
              const lat = dms(latDataOff, latRef), lon = dms(lonDataOff, lonRef);
              if (isNaN(lat) || isNaN(lon) || (lat === 0 && lon === 0)) return resolve(null);
              return resolve({ lat, lon });
            }
          }
          if (marker === 0xDA) break;
          pos += 2 + segLen;
        }
        resolve(null);
      } catch { resolve(null); }
    };
    reader.onerror = () => resolve(null);
    reader.readAsArrayBuffer(file);
  });
}

function thumbUrl(url: string): string {
  return url.replace("/uploads/", "/thumbnails/");
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
</script>
