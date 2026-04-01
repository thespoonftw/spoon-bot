<template>
  <div class="page">
    <template v-if="album">
      <div class="album-header">
        <div>
          <PageHeader :back-to="(route.query.back as string) || '/albums'" :title="album.groupName">
            <button class="btn-icon" @click="showEdit = true" title="Edit album">✏️</button>
          </PageHeader>
          <p v-if="album.dateText" class="date">{{ album.dateText }}</p>
          <div class="album-locations">
            <span v-for="loc in album.locations" :key="loc.id" class="meta">📍 {{ loc.name }}</span>
            <span v-if="!album.locations?.length" class="meta" style="color:#585b70">No location set</span>
            <button class="btn-icon" @click="showLocations = true" title="Edit locations">✏️</button>
          </div>
        </div>
        <div class="upload-area">
          <div class="upload-area-buttons">
            <button class="btn-secondary" @click="openShare">Share</button>
            <button class="btn-primary" @click="openUpload">Upload</button>
          </div>
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
        <label class="sort-label">Sort By:</label>
        <select v-model="sortBy" class="sort-select" @change="onSortChange">
          <option value="popular">Most Popular</option>
          <option v-if="album.locations && album.locations.length > 1" value="location">Location</option>
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
        <div v-if="album.photos.length > 0" class="album-photo-count">{{ totalSortedCount }} 📷</div>
      </div>
      <PhotoGallery :sections="displayedSections" :members="allMembers" :can-delete="true"
        :can-load-more="hasMore" :total-count="totalSortedCount"
        :album-locations="album?.locations ?? []"
        @photo-deleted="onPhotoDeleted" @load-more="displayLimit += 40" />
      <div class="search-show-more" v-if="hasMore" ref="showMoreEl">
        <button class="btn-secondary" @click="displayLimit += 40">Show more</button>
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
      <div class="modal">
        <button class="modal-close" @click="closeUpload" :disabled="anyUploading">✕</button>
        <h2>Upload Photos</h2>
        <div class="upload-drop-zone" @click="uploadFileInput?.click()" @dragover.prevent @dragleave.prevent @drop.stop.prevent="onUploadDrop">
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

  <LocationsModal
    v-if="showLocations && album"
    :channel-id="album.channelId"
    :locations="album.locations ?? []"
    @close="showLocations = false"
    @updated="locs => { if (album) album.locations = locs }"
  />
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import { useRoute } from "vue-router";
import MemberAvatar from "../components/MemberAvatar.vue";
import EditAlbumModal from "../components/EditAlbumModal.vue";
import MembersModal from "../components/MembersModal.vue";
import PhotoGallery from "../components/PhotoGallery.vue";
import { authHeaders, authJsonHeaders } from "../utils/session";
import { useDraggable } from "../utils/draggable";
import PageHeader from "../components/PageHeader.vue";
import LocationsModal from "../components/LocationsModal.vue";

const dragShare = useDraggable();

interface Photo { id: number; channelId: string; url: string; filename?: string; uploadedById?: string; uploadedByName?: string; uploadedAt: string; takenAt?: string; width?: number; height?: number; caption?: string; score?: number; userVote?: string | null; taggedIds?: string[]; locationId?: number | null }
interface Member { userId: string; displayName: string; firstName?: string; avatarUrl?: string; rsvpStatus?: string }
interface AlbumLocation { id: number; name: string }
interface Album { channelId: string; groupName: string; dateText?: string; locations?: AlbumLocation[]; startDate?: string; endDate?: string; photos: Photo[]; members: Member[] }

const route = useRoute();

const album = ref<Album | null>(null);
const loading = ref(true);
const uploadFileInput = ref<HTMLInputElement | null>(null);
const showUpload = ref(false);
const uploadDragOver = ref(false);
interface UploadItem { name: string; status: 'pending' | 'uploading' | 'done' | 'failed' }
const uploadItems = ref<UploadItem[]>([]);
const anyUploading = computed(() => uploadItems.value.some(i => i.status === 'pending' || i.status === 'uploading'));

const showShare = ref(false);
const sharePassword = ref("");
const shareUrl = ref("");
const sharing = ref(false);
const shareCopied = ref(false);

const showEdit = ref(false);
const showEditMembers = ref(false);
const showLocations = ref(false);


// allMembers is populated by MembersModal when it opens; used for getTaggedMembers
const allMembers = ref<Member[]>([]);

const SORT_KEY = 'snek_sort_by';
const sortBy = ref<'popular' | 'tagging' | 'uploader' | 'newest' | 'oldest' | 'location'>(
  (sessionStorage.getItem(SORT_KEY) as any) ?? 'popular'
);
watch(sortBy, () => { displayLimit.value = 40; });
function onSortChange() { sessionStorage.setItem(SORT_KEY, sortBy.value); }
const displayLimit = ref(40);
const currentUserId = ref<string | null>(null);
const tagFilterUserId = ref<string>('__nobody__');
watch(tagFilterUserId, () => { displayLimit.value = 40; });

function cmp(a: Photo, b: Photo): number {
  const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
  if (scoreDiff !== 0) return scoreDiff;
  return (b.uploadedAt ?? '').localeCompare(a.uploadedAt ?? '');
}

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
  if (sortBy.value === 'location') {
    const locs = album.value?.locations ?? [];
    const groups = new Map<number | null, { label: string; photos: Photo[] }>();
    for (const loc of locs) groups.set(loc.id, { label: `📍 ${loc.name}`, photos: [] });
    groups.set(null, { label: 'No Location', photos: [] });
    for (const photo of photos) {
      const key = photo.locationId && groups.has(photo.locationId) ? photo.locationId : null;
      groups.get(key)!.photos.push(photo);
    }
    const sections = [...groups.values()].filter(s => s.photos.length > 0);
    for (const s of sections) s.photos.sort(cmp);
    return sections;
  }
  return [{ label: '', photos }];
});

const totalSortedCount = computed(() => sortedSections.value.reduce((n, s) => n + s.photos.length, 0));
const displayedSections = computed(() => {
  let remaining = displayLimit.value;
  const result: { label: string; photos: Photo[] }[] = [];
  for (const section of sortedSections.value) {
    if (remaining <= 0) break;
    const photos = section.photos.slice(0, remaining);
    result.push({ ...section, photos });
    remaining -= photos.length;
  }
  return result;
});
const hasMore = computed(() => displayedSections.value.reduce((n, s) => n + s.photos.length, 0) < totalSortedCount.value);

const showMoreEl = ref<HTMLElement | null>(null);
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
    const hasMultipleLocations = (data.locations?.length ?? 0) > 1;
    if (hasMultipleLocations && !sessionStorage.getItem(SORT_KEY) && window.innerWidth >= 768) {
      sortBy.value = 'location';
    } else if (!hasMultipleLocations && sortBy.value === 'location') {
      sortBy.value = 'popular';
    }
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

function handleEscape(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  if (showShare.value) { showShare.value = false; e.stopImmediatePropagation(); return; }
}
onMounted(() => window.addEventListener("keydown", handleEscape, true));
onUnmounted(() => { window.removeEventListener("keydown", handleEscape, true); observer?.disconnect(); });

function onPhotoDeleted(id: number) {
  if (album.value) album.value.photos = album.value.photos.filter(p => p.id !== id);
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
  const startIdx = uploadItems.value.length;
  uploadItems.value.push(...files.map(f => ({ name: f.name, status: "pending" as const })));
  for (let i = 0; i < files.length; i++) {
    const item = uploadItems.value[startIdx + i];
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

</script>
