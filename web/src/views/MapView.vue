<template>
  <div class="map-page">
    <PageHeader back-to="/" title="Map">
      <template v-if="pinCount !== null">
        <label class="search-filter-label">Filter:</label>
        <select v-model="filterMode" class="sort-select">
          <option value="me">Including Me</option>
          <option v-for="g in currentUser?.groups ?? []" :key="g.id" :value="g.id">{{ g.name }}</option>
          <option value="all">All Albums</option>
        </select>
        <div class="map-pin-count">{{ pinCount }} 📍</div>
      </template>
    </PageHeader>
    <p v-if="status" class="empty map-status">{{ status }}</p>
    <div ref="mapEl" class="map-container"></div>
    <div v-if="movingPinLoc" class="map-bottom-bar">
      <input class="popup-name-input" type="text" v-model="activeNameStr" placeholder="Location name" @change="saveActiveName" />
      <input class="popup-coord-input" type="number" step="any" v-model="activeLatStr" placeholder="lat" readonly />
      <input class="popup-coord-input" type="number" step="any" v-model="activeLonStr" placeholder="lon" readonly />
      <button v-if="activePinPhotoCount === 0" class="map-popup-delete-btn" @click="deleteActiveLoc">Delete</button>
      <button class="map-popup-save-btn" @click="saveDrag">Save</button>
      <button class="map-popup-cancel-btn" @click="cancelDrag">Cancel</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from "vue";
import PageHeader from "../components/PageHeader.vue";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { authJsonHeaders, authHeaders } from "../utils/session";
import { useCurrentUser } from "../composables/useCurrentUser";

interface AlbumLocation { id: number; name: string; lat?: number | null; lon?: number | null; geocodeAttempted?: number }
interface Album {
  channelId: string;
  groupName: string;
  groupId?: number | null;
  locations?: AlbumLocation[];
  startDate?: string;
  endDate?: string;
  members: { userId: string }[];
  photos: { id: number; url: string; score?: number; locationId?: number | null }[];
}

async function geocodeAndSave(loc: AlbumLocation): Promise<[number, number] | null> {
  let lat: number | null = null;
  let lon: number | null = null;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(loc.name)}&format=json&limit=1`,
      { headers: { "Accept-Language": "en", "User-Agent": "spoon-bot/1.0" } }
    );
    const data = await res.json();
    if (data[0]) { lat = parseFloat(data[0].lat); lon = parseFloat(data[0].lon); }
  } catch { return null; }
  fetch(`/api/album-location/${loc.id}/coords`, {
    method: "PUT", headers: authJsonHeaders(), body: JSON.stringify({ lat, lon }),
  });
  return lat != null && lon != null ? [lat, lon] : null;
}

const DEFAULT_PIN_COLOR = '#6c7086';

function makeIcon(color: string, editing = false) {
  const size = editing ? 26 : 18;
  return L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;background:${color};border-radius:50%;border:2px solid rgba(255,255,255,0.7);box-shadow:0 1px 6px rgba(0,0,0,0.6)"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size],
    className: "",
  });
}

const { currentUser } = useCurrentUser();
const siteGroups = ref<{ id: number; name: string; color: string }[]>([]);
const allAlbums = ref<Album[]>([]);
const filterMode = ref<'me' | 'all' | number>('me');
const filteredAlbums = computed(() => {
  const mode = filterMode.value;
  if (mode === 'all') return allAlbums.value;
  if (typeof mode === 'number') return allAlbums.value.filter(a => a.groupId === mode);
  const uid = currentUser.value?.userId;
  if (!uid) return allAlbums.value;
  return allAlbums.value.filter(a => a.members.some(m => m.userId === uid));
});

function pinColor(albumsHere: Album[]): string {
  const counts = new Map<number, number>();
  for (const a of albumsHere) if (a.groupId) counts.set(a.groupId, (counts.get(a.groupId) ?? 0) + 1);
  if (!counts.size) return DEFAULT_PIN_COLOR;
  const gid = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return siteGroups.value.find(g => g.id === gid)?.color ?? DEFAULT_PIN_COLOR;
}

const mapEl = ref<HTMLElement | null>(null);
const status = ref("Loading albums…");
const pinCount = ref<number | null>(null);
const markerColors = new Map<number, string>();

// Active popup state (drives the bottom bar)
const activePinLoc = ref<AlbumLocation | null>(null);
const activePinPhotoCount = ref(0);
const activePinAlbums = ref<Album[]>([]);
const activeLatStr = ref("");
const activeLonStr = ref("");
const activeNameStr = ref("");

// Drag mode state
const movingPinLoc = ref<AlbumLocation | null>(null);
let movingMarker: L.Marker | null = null;
let movingOrigLatLng: L.LatLng | null = null;

const markerRegistry = new Map<number, L.Marker>();

async function saveActiveName() {
  const name = activeNameStr.value.trim();
  if (!name || !activePinLoc.value) return;
  activePinLoc.value.name = name;
  await fetch(`/api/album-location/${activePinLoc.value.id}/name`, {
    method: "PUT", headers: authJsonHeaders(), body: JSON.stringify({ name }),
  });
}

async function deleteActiveLoc() {
  if (!activePinLoc.value) return;
  const channelId = activePinAlbums.value[0]?.channelId;
  if (!channelId) return;
  await fetch(`/api/album/${channelId}/locations/${activePinLoc.value.id}`, { method: "DELETE", headers: authHeaders() });
  const marker = markerRegistry.get(activePinLoc.value.id);
  marker?.remove();
  markerRegistry.delete(activePinLoc.value.id);
  pinCount.value = (pinCount.value ?? 1) - 1;
  activePinLoc.value = null;
  endDragMode();
}

function startDragMode(loc: AlbumLocation, marker: L.Marker) {
  movingPinLoc.value = loc;
  activePinLoc.value = loc;
  activeNameStr.value = loc.name;
  movingMarker = marker;
  movingOrigLatLng = marker.getLatLng();
  marker.closePopup();
  marker.dragging?.enable();
  marker.setIcon(makeIcon(markerColors.get(loc.id) ?? DEFAULT_PIN_COLOR, true));
}

async function saveDrag() {
  if (!movingMarker || !movingPinLoc.value) return;
  const { lat, lng } = movingMarker.getLatLng();
  await fetch(`/api/album-location/${movingPinLoc.value.id}/coords`, {
    method: "PUT", headers: authJsonHeaders(), body: JSON.stringify({ lat, lon: lng }),
  });
  movingPinLoc.value.lat = lat; movingPinLoc.value.lon = lng;
  endDragMode();
}

function cancelDrag() {
  if (movingMarker && movingOrigLatLng) movingMarker.setLatLng(movingOrigLatLng);
  endDragMode();
}

function endDragMode() {
  if (movingMarker && movingPinLoc.value)
    movingMarker.setIcon(makeIcon(markerColors.get(movingPinLoc.value.id) ?? DEFAULT_PIN_COLOR));
  movingMarker?.dragging?.disable();
  movingPinLoc.value = null;
  movingMarker = null;
  movingOrigLatLng = null;
}

function buildPopupEl(loc: AlbumLocation, albumsHere: Album[], marker: L.Marker): HTMLElement {
  const thumbUrl = (url: string) => url.replace("/uploads/", "/thumbnails/");

  // Oldest to newest
  const sorted = [...albumsHere].sort((a, b) => {
    if (!a.startDate && !b.startDate) return 0;
    if (!a.startDate) return 1;
    if (!b.startDate) return -1;
    return a.startDate.localeCompare(b.startDate);
  });

  function getLocPhotos(a: Album): { id: number; url: string; score?: number }[] {
    if ((a.locations?.length ?? 0) <= 1) return a.photos;
    const filtered = a.photos.filter(p => p.locationId === loc.id);
    return filtered.length > 0 ? filtered : a.photos;
  }

  function locPhotoCount(a: Album): number {
    return getLocPhotos(a).length;
  }
  const defaultOpenIdx = sorted.reduce((best, a, i) => locPhotoCount(a) > locPhotoCount(sorted[best]) ? i : best, 0);

  function buildPhotosEl(a: Album): HTMLElement {
    const singleLocation = (a.locations?.length ?? 0) <= 1;
    const locPhotos = getLocPhotos(a);
    const topPhotos = [...locPhotos].sort((x, y) => (y.score ?? 0) - (x.score ?? 0)).slice(0, 3);
    const albumUrl = singleLocation ? `/album/${a.channelId}?back=/map` : `/album/${a.channelId}?back=/map&sort=location&loc=${loc.id}`;
    const content = document.createElement("div");
    content.className = "map-popup-accordion-content";
    if (topPhotos.length) {
      const thumbsDiv = document.createElement("div");
      thumbsDiv.className = "map-popup-thumbs";
      const mainLink = document.createElement("a");
      mainLink.href = albumUrl;
      const mainImg = document.createElement("img");
      mainImg.src = thumbUrl(topPhotos[0].url);
      mainImg.className = "map-popup-thumb-lg";
      mainLink.appendChild(mainImg);
      thumbsDiv.appendChild(mainLink);
      if (topPhotos.length > 1) {
        const stack = document.createElement("div");
        stack.className = "map-popup-thumbs-stack";
        for (const p of topPhotos.slice(1)) {
          const link = document.createElement("a");
          link.href = albumUrl;
          const img = document.createElement("img");
          img.src = thumbUrl(p.url);
          img.className = "map-popup-thumb-sm";
          link.appendChild(img);
          stack.appendChild(link);
        }
        thumbsDiv.appendChild(stack);
      }
      content.appendChild(thumbsDiv);
    }
    return content;
  }

  const el = document.createElement("div");
  el.className = "map-popup";

  // Header: location name with pencil immediately after the text
  const header = document.createElement("div");
  header.className = "map-popup-header";
  const nameSpan = document.createElement("span");
  nameSpan.className = "map-popup-loc-name";
  nameSpan.textContent = loc.name;
  const moveBtn = document.createElement("button");
  moveBtn.className = "map-popup-move-btn";
  moveBtn.title = "Move pin";
  moveBtn.textContent = "✏️";
  moveBtn.addEventListener("click", () => startDragMode(loc, marker));
  header.appendChild(nameSpan);
  header.appendChild(moveBtn);
  el.appendChild(header);

  if (sorted.length === 1) {
    // Single album: just show title link + photo count + photos
    const a = sorted[0];
    const singleLocation = (a.locations?.length ?? 0) <= 1;
    const albumPhotoCount = locPhotoCount(a);
    const albumUrl = singleLocation ? `/album/${a.channelId}?back=/map` : `/album/${a.channelId}?back=/map&sort=location&loc=${loc.id}`;
    const year = a.startDate ? new Date(a.startDate).getUTCFullYear() : "";
    const meta = document.createElement("div");
    meta.className = "map-popup-meta";
    const metaTitle = document.createElement("span");
    metaTitle.className = "map-popup-title";
    metaTitle.textContent = a.groupName + (year ? ` · ${year}` : "");
    const photoCountEl = document.createElement("span");
    photoCountEl.className = "map-popup-photo-count";
    photoCountEl.textContent = `${albumPhotoCount} 📸`;
    meta.appendChild(metaTitle);
    meta.appendChild(photoCountEl);
    el.appendChild(meta);
    el.appendChild(buildPhotosEl(a));
  } else {
    // Accordion: one row per album, first expanded, only one open at a time
    const allPhotosEls: HTMLElement[] = [];

    sorted.forEach((a, i) => {
      const singleLocation = (a.locations?.length ?? 0) <= 1;
      const albumPhotoCount = locPhotoCount(a);
      const year = a.startDate ? new Date(a.startDate).getUTCFullYear() : "";

      const item = document.createElement("div");
      item.className = "map-popup-accordion-item";

      const hdr = document.createElement("div");
      hdr.className = "map-popup-accordion-header";

      const titleEl = document.createElement("span");
      titleEl.className = "map-popup-accordion-title";
      titleEl.textContent = a.groupName + (year ? ` · ${year}` : "");

      const countEl = document.createElement("span");
      countEl.className = "map-popup-photo-count";
      countEl.textContent = `${albumPhotoCount} 📸`;

      hdr.appendChild(titleEl);
      hdr.appendChild(countEl);

      const photosEl = buildPhotosEl(a);
      allPhotosEls.push(photosEl);
      photosEl.style.display = i === defaultOpenIdx ? "" : "none";

      hdr.addEventListener("click", () => {
        if (photosEl.style.display !== "none") return; // already open, do nothing
        allPhotosEls.forEach(p => { p.style.display = "none"; });
        photosEl.style.display = "";
      });

      item.appendChild(hdr);
      item.appendChild(photosEl);
      el.appendChild(item);
    });
  }

  return el;
}

let map: L.Map | null = null;

function fitMapHeight() {
  if (!mapEl.value) return;
  const w = window.innerWidth;
  const zoom = w > 1600 ? Math.min(w / 1600, 3) : 1;
  const top = mapEl.value.getBoundingClientRect().top;
  mapEl.value.style.height = ((window.innerHeight - top) / zoom - 32) + "px";
}

watch(status, () => nextTick(fitMapHeight));

function applyFilter() {
  if (!map) return;
  for (const marker of markerRegistry.values()) marker.remove();
  markerRegistry.clear();
  markerColors.clear();
  activePinLoc.value = null;

  const byName = new Map<string, { albums: Album[]; loc: AlbumLocation }>();
  for (const album of filteredAlbums.value) {
    for (const loc of album.locations ?? []) {
      if (loc.lat == null) continue;
      if (!byName.has(loc.name)) byName.set(loc.name, { albums: [], loc });
      byName.get(loc.name)!.albums.push(album);
    }
  }

  for (const { albums: albumsHere, loc } of byName.values()) {
    const photoCount = albumsHere.reduce((n, a) =>
      n + ((a.locations?.length ?? 0) <= 1 ? a.photos.length : a.photos.filter(p => p.locationId === loc.id).length), 0);
    const color = pinColor(albumsHere);
    const marker = L.marker([loc.lat!, loc.lon!], { icon: makeIcon(color) }).addTo(map!);
    markerColors.set(loc.id, color);
    const popupEl = buildPopupEl(loc, albumsHere, marker);
    marker.bindPopup(popupEl, { maxWidth: 340 });
    marker.on("popupopen", () => {
      if (movingPinLoc.value && movingPinLoc.value.id !== loc.id) cancelDrag();
      activePinLoc.value = loc;
      activePinPhotoCount.value = photoCount;
      activePinAlbums.value = albumsHere;
      activeLatStr.value = (loc.lat ?? 0).toFixed(5);
      activeLonStr.value = (loc.lon ?? 0).toFixed(5);
      activeNameStr.value = loc.name;
    });
    marker.on("popupclose", () => {
      if (!movingPinLoc.value) activePinLoc.value = null;
    });
    marker.on("drag", () => {
      const { lat, lng } = marker.getLatLng();
      activeLatStr.value = lat.toFixed(5);
      activeLonStr.value = lng.toFixed(5);
    });
    markerRegistry.set(loc.id, marker);
  }
  pinCount.value = markerRegistry.size;
}

watch(filteredAlbums, applyFilter);

onMounted(async () => {
  document.body.style.overflow = "hidden";
  await nextTick();
  fitMapHeight();
  window.addEventListener("resize", fitMapHeight);

  const [albumRes, groupRes] = await Promise.all([fetch("/api/albums"), fetch("/api/groups", { headers: authHeaders() })]);
  allAlbums.value = await albumRes.json();
  if (groupRes.ok) siteGroups.value = await groupRes.json();

  if (!mapEl.value) return;
  map = L.map(mapEl.value).setView([54, -2], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18,
  }).addTo(map);

  // Geocode any locations that don't yet have coords (one-time, uses all albums)
  const allByName = new Map<string, AlbumLocation>();
  for (const album of allAlbums.value)
    for (const loc of album.locations ?? [])
      if (!allByName.has(loc.name)) allByName.set(loc.name, loc);

  if (allByName.size === 0) { status.value = "No albums have a location set."; return; }

  const needsGeocode = [...allByName.values()].filter(e => e.id >= 0 && !e.geocodeAttempted && e.lat == null);
  const total = needsGeocode.length;
  if (total > 0) status.value = `Locating ${total} new location${total > 1 ? "s" : ""}… 0/${total}`;
  let done = 0;
  for (const loc of needsGeocode) {
    const coords = await geocodeAndSave(loc);
    if (coords) { loc.lat = coords[0]; loc.lon = coords[1]; }
    done++;
    if (done < total) status.value = `Locating… ${done}/${total}`;
    else status.value = "";
    if (done < total) await new Promise(r => setTimeout(r, 1100));
  }
  status.value = "";

  applyFilter();
});

onUnmounted(() => {
  document.body.style.overflow = "";
  map?.remove();
  map = null;
  markerRegistry.clear();
  markerColors.clear();
  window.removeEventListener("resize", fitMapHeight);
});
</script>
