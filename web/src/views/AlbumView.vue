<template>
  <div class="page" :class="{ 'album-page': album }">
    <template v-if="album">
      <PageHeader class="album-page-header" :back-to="(route.query.back as string) || '/photos/albums'" :title="album.groupName" :subtitle="album.dateText" :mobile-stack="true"
        :locations="album.locations ?? []"
        :group-tag="album.groupId ? siteGroups.find(g => g.id === album!.groupId) ?? null : null"
        @location-click="jumpToPhotos">
        <div class="album-header-right">
          <div class="album-header-btns">
            <span class="album-section-count desktop-only">📷 {{ totalSortedCount }}</span>
            <button class="btn-primary btn-small album-upload-header" @click="openUpload">Upload</button>
            <div ref="menuRoot" class="user-options">
              <button type="button" class="user-options-btn" aria-label="Album options" aria-haspopup="menu" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>
              </button>
              <div v-if="menuOpen" class="user-options-menu album-options-menu" role="menu">
                <button type="button" role="menuitem" @click="menuPick(() => openEdit('name'))">Edit Album Name</button>
                <button type="button" role="menuitem" @click="menuPick(() => openEdit('date'))">Edit Date</button>
                <button type="button" role="menuitem" @click="menuPick(() => showLocations = true)">Edit Locations</button>
                <button type="button" role="menuitem" @click="menuPick(() => showEditMembers = true)">Edit Members</button>
                <button type="button" role="menuitem" @click="menuPick(() => openEdit('group'))">Edit Group</button>
                <button type="button" role="menuitem" @click="menuPick(openShare)">Share</button>
                <button type="button" role="menuitem" class="menu-danger" @click="menuPick(() => openEdit('delete'))">Delete Album</button>
              </div>
            </div>
          </div>
        </div>
      </PageHeader>

      <!-- 📷 Photos -->
      <div class="album-section">
        <div class="album-section-header">
          <div class="card-members album-members-row">
            <div v-for="member in album.members" :key="member.userId" class="card-member-avatar" :title="member.firstName || member.displayName">
              <MemberAvatar :avatar-url="member.avatarUrl" :name="member.firstName || member.displayName" />
            </div>
          </div>
          <template v-if="album.photos.length > 0">
            <label class="sort-label" style="margin-left: auto">Sort By:</label>
            <select v-model="sortBy" class="sort-select">
              <option value="popular">Popularity</option>
              <option v-if="album.startDate" value="date">Date</option>
              <option v-if="album.locations && album.locations.length > 1" value="location">Location</option>
              <option value="uploader">Author</option>
              <option value="newest">Upload</option>
              <option v-if="TAGGING_ENABLED" value="tagging">Tagging</option>
            </select>
            <select v-if="TAGGING_ENABLED && sortBy === 'tagging'" v-model="tagFilterUserId" class="sort-select">
              <option v-for="m in sortedTagFilterMembers" :key="m.userId" :value="m.userId">{{ dropdownName(m, album.members) }}</option>
              <option value="__nobody__">Nobody</option>
            </select>
          </template>
        </div>
        <p v-if="album.photos.length === 0" class="empty">No photos yet.</p>
        <PhotoGallery v-else :sections="displayedSections" :members="allMembers" :can-delete="true"
          :can-load-more="hasMore" :total-count="totalSortedCount"
          :album-locations="album?.locations ?? []"
          :album-start-date="album?.startDate"
          :hide-uploader="singleUploader"
          @photo-deleted="onPhotoDeleted" @load-more="displayLimit += 40" />
        <div class="search-show-more" v-if="hasMore" ref="showMoreEl">
          <button class="btn-secondary" @click="displayLimit += 40">Show more</button>
        </div>
      </div>

      <!-- Phones: a large Upload button that stays at the bottom of the screen -->
      <div class="album-upload-bar">
        <button class="btn-primary" @click="openUpload">Upload Photos</button>
      </div>
    </template>
    <p v-else-if="loading" class="empty">Loading…</p>
    <p v-else class="empty">Album not found.</p>
  </div>


  <Teleport to="body">
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
      <div class="modal upload-modal">
        <button class="modal-close" @click="closeUpload" :disabled="anyUploading" aria-label="Close">✕</button>
        <h2>Add photos</h2>
        <p class="upload-subtitle">to {{ album?.groupName }}</p>

        <button type="button" :class="['upload-drop-zone', { compact: uploadItems.length }]"
                @click="uploadFileInput?.click()" @dragover.prevent @dragleave.prevent @drop.stop.prevent="onUploadDrop">
          <span class="upload-drop-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M20 16v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2" />
            </svg>
          </span>
          <span class="upload-drop-text">
            <strong>{{ uploadDragOver ? 'Drop to upload' : uploadItems.length ? 'Add more photos' : 'Drag photos here' }}</strong>
            <span>or <u>browse your device</u> · JPG, PNG, HEIC up to 50MB</span>
          </span>
          <input ref="uploadFileInput" type="file" accept="image/*" multiple hidden @change="onFilesSelected" />
        </button>

        <template v-if="uploadItems.length">
          <div class="upload-summary">
            <span>
              <template v-if="anyUploading">Uploading… {{ uploadDoneCount }} of {{ uploadItems.length }} done</template>
              <template v-else-if="uploadFailedCount">{{ uploadDoneCount }} uploaded · <span class="upload-summary-failed">{{ uploadFailedCount }} failed</span></template>
              <template v-else>{{ uploadDoneCount }} {{ uploadDoneCount === 1 ? 'photo' : 'photos' }} added</template>
            </span>
            <span class="upload-summary-pct">{{ uploadOverallPct }}%</span>
          </div>
          <div class="upload-progress" role="progressbar" :aria-valuenow="uploadOverallPct" aria-valuemin="0" aria-valuemax="100">
            <div class="upload-progress-fill" :class="{ complete: !anyUploading && !uploadFailedCount }" :style="{ width: uploadOverallPct + '%' }"></div>
          </div>

          <div class="upload-grid">
            <div v-for="item in uploadItems" :key="item.id" :class="['upload-tile', 'is-' + item.status]" :title="item.error ? `${item.name} — ${item.error}` : item.name">
              <img v-if="item.preview && !item.previewFailed" :src="item.preview" alt="" @error="item.previewFailed = true" />
              <span v-else class="upload-tile-fallback">{{ item.name.split('.').pop()?.toUpperCase() }}</span>
              <div v-if="item.status === 'uploading' || item.status === 'pending'" class="upload-tile-overlay">
                <svg v-if="item.status === 'uploading'" class="upload-ring" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" r="15" class="upload-ring-track" />
                  <circle cx="18" cy="18" r="15" class="upload-ring-fill" :style="{ strokeDashoffset: 94.25 * (1 - item.progress) }" />
                </svg>
              </div>
              <span v-else-if="item.status === 'done'" class="upload-badge done" aria-label="Uploaded">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10" /></svg>
              </span>
              <button v-else type="button" class="upload-tile-failed" @click="retryUpload(item)" :aria-label="`Retry ${item.name}`">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
                <span>Retry</span>
              </button>
            </div>
          </div>

          <div class="modal-actions upload-actions">
            <button v-if="uploadFailedCount && !anyUploading" class="btn-secondary" @click="retryAllFailed">Retry failed</button>
            <button class="btn-primary" @click="closeUpload" :disabled="anyUploading">
              {{ anyUploading ? 'Uploading…' : 'Done' }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>

  <EditAlbumModal
    :show="showEdit"
    :section="editSection"
    :channel-id="album?.channelId ?? ''"
    :album="album ?? { groupName: '' }"
    :groups="siteGroups"
    @close="showEdit = false"
    @saved="onAlbumSaved"
    @deleted="onAlbumDeleted"
  />

  <MembersModal
    v-model="showEditMembers"
    :channel-id="album?.channelId ?? ''"
    @members-updated="onMembersUpdated"
  />

  <LocationsModal
    v-if="showLocations && album"
    :channel-id="album.channelId"
    :locations="album.locations ?? []"
    @close="showLocations = false"
    @updated="locs => { if (album) album.locations = locs }"
  />
</template>

<script setup lang="ts">
import { byPopularity } from "../utils/popularity";
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAlbumsCache } from "../composables/useAlbumsCache";
import MemberAvatar from "../components/MemberAvatar.vue";
import { TAGGING_ENABLED } from "../utils/features";
import EditAlbumModal from "../components/EditAlbumModal.vue";
import MembersModal from "../components/MembersModal.vue";
import PhotoGallery from "../components/PhotoGallery.vue";
import { authHeaders, authJsonHeaders } from "../utils/session";
import { useDraggable } from "../utils/draggable";
import { dropdownName, sortByName } from "../utils/names";
import PageHeader from "../components/PageHeader.vue";
import LocationsModal from "../components/LocationsModal.vue";

const dragShare = useDraggable();

interface Photo { id: number; channelId: string; url: string; filename?: string; uploadedById?: string; uploadedByName?: string; uploadedAt: string; takenAt?: string; width?: number; height?: number; caption?: string; score?: number; superCount?: number; rankScore?: number; userVote?: string | null; taggedIds?: string[]; locationId?: number | null }
interface Member { userId: string; displayName: string; firstName?: string; surname?: string; avatarUrl?: string; rsvpStatus?: string }
interface AlbumLocation { id: number; name: string; lat?: number | null; lon?: number | null; geocodeAttempted?: number }
interface SiteGroup { id: number; name: string; color: string }
interface Album { channelId: string; groupName: string; dateText?: string; locations?: AlbumLocation[]; startDate?: string; endDate?: string; groupId?: number | null; photos: Photo[]; members: Member[] }

const route = useRoute();
const router = useRouter();
const { markAlbumsDirty } = useAlbumsCache();

const album = ref<Album | null>(null);
const loading = ref(true);
const uploadFileInput = ref<HTMLInputElement | null>(null);
const showUpload = ref(false);
const uploadDragOver = ref(false);
interface UploadItem {
  id: number; file: File; name: string; preview: string; previewFailed?: boolean;
  status: 'pending' | 'uploading' | 'done' | 'failed'; progress: number; error?: string;
}
const uploadItems = ref<UploadItem[]>([]);
const anyUploading = computed(() => uploadItems.value.some(i => i.status === 'pending' || i.status === 'uploading'));
const uploadDoneCount = computed(() => uploadItems.value.filter(i => i.status === 'done').length);
const uploadFailedCount = computed(() => uploadItems.value.filter(i => i.status === 'failed').length);
// Byte-weighted, so one big photo doesn't make the bar jump.
const uploadOverallPct = computed(() => {
  const items = uploadItems.value;
  const total = items.reduce((s, i) => s + i.file.size, 0);
  if (!total) return 0;
  const sent = items.reduce((s, i) => s + i.file.size * (i.status === 'done' ? 1 : i.status === 'uploading' ? i.progress : 0), 0);
  return Math.round((sent / total) * 100);
});

const showShare = ref(false);
const sharePassword = ref("");
const shareUrl = ref("");
const sharing = ref(false);
const shareCopied = ref(false);

const showEdit = ref(false);
// When one person uploaded every photo in the album, the lightbox doesn't bother saying who.
const singleUploader = computed(() => {
  const photos = album.value?.photos ?? [];
  return photos.length > 0 && photos.every(p => p.uploadedById && p.uploadedById === photos[0].uploadedById);
});
const editSection = ref<"name" | "date" | "group" | "delete">("name");
function openEdit(section: "name" | "date" | "group" | "delete") { editSection.value = section; showEdit.value = true; }

// The ⋮ album options menu. Closes on a tap elsewhere, Escape, or picking an item.
const menuOpen = ref(false);
const menuRoot = ref<HTMLElement | null>(null);
function menuPick(action: () => void) { menuOpen.value = false; action(); }
function onDocPointer(e: PointerEvent) {
  if (menuOpen.value && menuRoot.value && !menuRoot.value.contains(e.target as Node)) menuOpen.value = false;
}
const showEditMembers = ref(false);
const showLocations = ref(false);
const siteGroups = ref<SiteGroup[]>([]);


// allMembers is populated by MembersModal when it opens; used for getTaggedMembers
const allMembers = ref<Member[]>([]);

const sortBy = ref<'popular' | 'date' | 'location' | 'uploader' | 'newest' | 'tagging'>('popular');
watch(sortBy, () => { displayLimit.value = 40; });
const displayLimit = ref(40);
const currentUserId = ref<string | null>(null);
const tagFilterUserId = ref<string>('__nobody__');
const sortedTagFilterMembers = computed(() => sortByName(album.value?.members ?? []));
watch(tagFilterUserId, () => { displayLimit.value = 40; });

function cmp(a: Photo, b: Photo): number {
  const pop = byPopularity(a, b);
  if (pop !== 0) return pop;
  return (b.uploadedAt ?? '').localeCompare(a.uploadedAt ?? '');
}

function dayLabel(dateKey: string, hideYear: boolean): string {
  const d = new Date(dateKey.slice(0, 10) + 'T12:00:00Z');
  return d.toLocaleDateString('en-GB', hideYear
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}

function groupByDate(photos: Photo[], getDate: (p: Photo) => string | undefined, newest: boolean, includeUnspecified: boolean, innerCmp: (a: Photo, b: Photo) => number = cmp) {
  const startYear = album.value?.startDate?.slice(0, 4);
  const endYear = album.value?.endDate?.slice(0, 4) ?? startYear;
  const albumYear = startYear && startYear === endYear ? startYear : null;

  const groups = new Map<string, { label: string; photos: Photo[] }>();
  const unspecified: Photo[] = [];
  for (const photo of photos) {
    const d = getDate(photo);
    if (!d) { unspecified.push(photo); continue; }
    const key = d.slice(0, 10);
    if (!groups.has(key)) groups.set(key, { label: dayLabel(key, albumYear !== null && key.slice(0, 4) === albumYear), photos: [] });
    groups.get(key)!.photos.push(photo);
  }
  const sections = [...groups.entries()]
    .sort(([a], [b]) => newest ? b.localeCompare(a) : a.localeCompare(b))
    .map(([, s]) => ({ label: s.label, photos: s.photos.sort(innerCmp) }));
  if (includeUnspecified && unspecified.length > 0) sections.push({ label: 'Unspecified', photos: unspecified.sort(innerCmp) });
  return sections;
}

const sortedSections = computed((): { label: string; photos: Photo[] }[] => {
  const photos = album.value?.photos ?? [];
  if (sortBy.value === 'popular') {
    return [{ label: '', photos: [...photos].sort(cmp) }];
  }
  if (sortBy.value === 'newest') {
    const byTime = (a: Photo, b: Photo) => (b.uploadedAt ?? '').localeCompare(a.uploadedAt ?? '');
    return groupByDate(photos, p => p.uploadedAt, true, false, byTime);
  }
  if (sortBy.value === 'date') {
    return groupByDate(photos, p => p.takenAt, false, true);
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
  if (sortBy.value === 'location') {
    const locs = album.value?.locations ?? [];
    const groups = new Map<number | null, { label: string; photos: Photo[] }>();
    for (const loc of locs) groups.set(loc.id, { label: loc.name, photos: [] });
    groups.set(null, { label: 'Others', photos: [] });
    for (const photo of photos) {
      const key = photo.locationId && groups.has(photo.locationId) ? photo.locationId : null;
      groups.get(key)!.photos.push(photo);
    }
    let sections = [...groups.entries()]
      .filter(([, s]) => s.photos.length > 0)
      .sort(([a], [b]) => {
        if (a === null) return 1;
        if (b === null) return -1;
        if (a === priorityLocId.value) return -1;
        if (b === priorityLocId.value) return 1;
        return 0;
      })
      .map(([, s]) => s);
    for (const s of sections) s.photos.sort(cmp);
    return sections;
  }
  return [{ label: '', photos }];
});

const totalSortedCount = computed(() => sortedSections.value.reduce((n, s) => n + s.photos.length, 0));
const displayedSections = computed(() => {
  let remaining = displayLimit.value;
  const result: { label: string; photos: Photo[]; total: number }[] = [];
  for (const section of sortedSections.value) {
    if (remaining <= 0) break;
    const photos = section.photos.slice(0, remaining);
    result.push({ ...section, photos, total: section.photos.length });
    remaining -= photos.length;
  }
  return result;
});
const hasMore = computed(() => displayedSections.value.reduce((n, s) => n + s.photos.length, 0) < totalSortedCount.value);

const showMoreEl = ref<HTMLElement | null>(null);

const priorityLocId = ref<number | null>(null);

function jumpToPhotos(locId: number) {
  priorityLocId.value = locId;
  sortBy.value = 'location';
}
let observer: IntersectionObserver | null = null;

watch(hasMore, async (val) => {
  if (val) {
    await nextTick();
    if (showMoreEl.value && !observer) {
      observer = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting) displayLimit.value += 40;
      }, { rootMargin: '200px' });
      observer.observe(showMoreEl.value);
    }
  } else {
    observer?.disconnect();
    observer = null;
  }
});

const byName = (a: Member, b: Member) => (a.firstName || a.displayName).localeCompare(b.firstName || b.displayName);

async function loadAlbum() {
  loading.value = true;
  album.value = null;
  sortBy.value = 'popular';
  priorityLocId.value = null;
  tagFilterUserId.value = '__nobody__';

  const [albumRes, checkRes, groupsRes] = await Promise.all([
    fetch(`/api/album/${route.params.channelId}`, { headers: authHeaders() }),
    fetch(`/api/auth/check`, { headers: authHeaders() }),
    fetch(`/api/groups`, { headers: authHeaders() }),
  ]);
  if (groupsRes.ok) siteGroups.value = await groupsRes.json();
  if (albumRes.ok) {
    const data = await albumRes.json();
    const sortedMembers = (data.members ?? []).slice().sort(byName);
    album.value = { ...data, members: sortedMembers };
    allMembers.value = sortedMembers;
    const sort = route.query.sort as string | undefined;
    if (sort === 'location') {
      if ((data.locations?.length ?? 0) > 1) {
        sortBy.value = 'location';
        const locId = parseInt(route.query.loc as string);
        if (!isNaN(locId)) priorityLocId.value = locId;
      }
    } else if (sort === 'date') {
      if (data.startDate) sortBy.value = 'date';
    } else if (sort === 'uploader' || sort === 'newest' || (TAGGING_ENABLED && sort === 'tagging')) {
      sortBy.value = sort;
    }
  }
  if (checkRes.ok) {
    const { userId } = await checkRes.json();
    currentUserId.value = userId ?? null;
    const members = album.value?.members ?? [];
    tagFilterUserId.value = (userId && members.some(m => m.userId === userId)) ? userId : '__nobody__';
  }
  loading.value = false;
}

// Keep the chosen sort in the URL so links and refreshes open the album the same way.
watch([sortBy, priorityLocId], () => {
  if (loading.value) return;
  const query = { ...route.query };
  delete query.sort;
  delete query.loc;
  if (sortBy.value !== 'popular') query.sort = sortBy.value;
  if (sortBy.value === 'location' && priorityLocId.value !== null) query.loc = String(priorityLocId.value);
  router.replace({ query });
});

onMounted(loadAlbum);
watch(() => route.params.channelId, (_, oldId) => { if (oldId !== undefined) loadAlbum(); });

function onAlbumSaved(updated: object) {
  if (album.value) album.value = { ...album.value, ...updated };
  markAlbumsDirty();
}

function onAlbumDeleted() {
  showEdit.value = false;
  markAlbumsDirty();
  router.replace((route.query.back as string) || "/photos/albums");
}

function onMembersUpdated(visible: Member[], all: Member[]) {
  if (album.value) album.value.members = visible.slice().sort(byName);
  allMembers.value = all.slice().sort(byName);
  markAlbumsDirty();
}

function handleEscape(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  if (menuOpen.value) { menuOpen.value = false; e.stopImmediatePropagation(); return; }
  if (showShare.value) { showShare.value = false; e.stopImmediatePropagation(); return; }
}
onMounted(() => { window.addEventListener("keydown", handleEscape, true); document.addEventListener("pointerdown", onDocPointer); });
onUnmounted(() => { window.removeEventListener("keydown", handleEscape, true); document.removeEventListener("pointerdown", onDocPointer); observer?.disconnect(); });

function onPhotoDeleted(id: number) {
  if (album.value) album.value.photos = album.value.photos.filter(p => p.id !== id);
  markAlbumsDirty();
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

function clearUploadItems() {
  for (const i of uploadItems.value) if (i.preview) URL.revokeObjectURL(i.preview);
  uploadItems.value = [];
}
function openUpload() { clearUploadItems(); showUpload.value = true; }
function closeUpload() { if (anyUploading.value) return; showUpload.value = false; clearUploadItems(); }
onUnmounted(clearUploadItems);

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

let nextUploadId = 1;
let uploadWorkers = 0;
const UPLOAD_CONCURRENCY = 2;

function startUpload(files: File[]) {
  if (!album.value) return;
  uploadItems.value.push(...files.map(file => ({
    id: nextUploadId++, file, name: file.name, preview: URL.createObjectURL(file),
    status: "pending" as const, progress: 0,
  })));
  pumpUploads();
}

function retryUpload(item: UploadItem) {
  item.status = "pending"; item.progress = 0; item.error = undefined;
  pumpUploads();
}
function retryAllFailed() { uploadItems.value.filter(i => i.status === "failed").forEach(retryUpload); }

// Keeps up to UPLOAD_CONCURRENCY uploads in flight, picking pending items in order.
function pumpUploads() {
  while (uploadWorkers < UPLOAD_CONCURRENCY) {
    const item = uploadItems.value.find(i => i.status === "pending");
    if (!item) return;
    uploadWorkers++;
    uploadOne(item).finally(() => { uploadWorkers--; pumpUploads(); });
  }
}

// XHR rather than fetch so we get upload progress events.
function uploadOne(item: UploadItem): Promise<void> {
  const channelId = album.value?.channelId;
  if (!channelId) { item.status = "failed"; return Promise.resolve(); }
  item.status = "uploading";
  return new Promise(resolve => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/album/${channelId}/photos`);
    for (const [k, v] of Object.entries(authHeaders())) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = e => { if (e.lengthComputable) item.progress = e.loaded / e.total; };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { album.value?.photos.push(JSON.parse(xhr.responseText)); } catch { /* list refreshes on next load */ }
        item.status = "done"; item.progress = 1; markAlbumsDirty();
      } else {
        let msg = `Upload failed (${xhr.status})`;
        try { msg = JSON.parse(xhr.responseText).error ?? msg; } catch { /* keep default */ }
        item.status = "failed"; item.error = msg;
      }
      resolve();
    };
    xhr.onerror = () => { item.status = "failed"; item.error = "Connection lost"; resolve(); };
    const fd = new FormData();
    fd.append("photo", item.file);
    xhr.send(fd);
  });
}

</script>
