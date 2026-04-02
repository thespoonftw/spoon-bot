<template>
  <div class="map-page">
    <PageHeader back-to="/" title="Map">
      <div class="map-pin-count" v-if="pinCount !== null">{{ pinCount }} 📍</div>
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
import { ref, watch, nextTick, onMounted, onUnmounted } from "vue";
import PageHeader from "../components/PageHeader.vue";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { authJsonHeaders, authHeaders } from "../utils/session";

interface AlbumLocation { id: number; name: string; lat?: number | null; lon?: number | null; geocodeAttempted?: number }
interface Album {
  channelId: string;
  groupName: string;
  locations?: AlbumLocation[];
  startDate?: string;
  endDate?: string;
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

const pinIcon = L.divIcon({ html: "📍", iconSize: [28, 28], iconAnchor: [14, 28], popupAnchor: [0, -28], className: "map-emoji-pin" });
const editingIcon = L.divIcon({ html: "📍", iconSize: [36, 36], iconAnchor: [18, 36], className: "map-emoji-pin map-emoji-pin-editing" });

const mapEl = ref<HTMLElement | null>(null);
const status = ref("Loading albums…");
const pinCount = ref<number | null>(null);

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
}

function startDragMode(loc: AlbumLocation, marker: L.Marker) {
  movingPinLoc.value = loc;
  activePinLoc.value = loc;
  activeNameStr.value = loc.name;
  movingMarker = marker;
  movingOrigLatLng = marker.getLatLng();
  marker.closePopup();
  marker.dragging?.enable();
  marker.setIcon(editingIcon);
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
  movingMarker?.dragging?.disable();
  movingMarker?.setIcon(pinIcon);
  movingPinLoc.value = null;
  movingMarker = null;
  movingOrigLatLng = null;
}

function buildPopupEl(loc: AlbumLocation, albumsHere: Album[], marker: L.Marker): HTMLElement {
  const thumbUrl = (url: string) => url.replace("/uploads/", "/thumbnails/");
  const albumsHtml = albumsHere.map((a, i) => {
    const year = a.startDate ? new Date(a.startDate).getUTCFullYear() : "";
    const singleLocation = (a.locations?.length ?? 0) <= 1;
    const locPhotos = singleLocation ? a.photos : a.photos.filter(p => p.locationId === loc.id);
    const topPhotos = [...locPhotos].sort((x, y) => (y.score ?? 0) - (x.score ?? 0)).slice(0, 3);
    const albumUrl = singleLocation ? `/album/${a.channelId}?back=/map` : `/album/${a.channelId}?back=/map&sort=location&loc=${loc.id}`;
    const smallThumbs = topPhotos.slice(1).map(p =>
      `<a href="${albumUrl}"><img src="${thumbUrl(p.url)}" class="map-popup-thumb-sm" /></a>`
    ).join("");
    const thumbsHtml = topPhotos.length ? `<div class="map-popup-thumbs">
      <a href="${albumUrl}"><img src="${thumbUrl(topPhotos[0].url)}" class="map-popup-thumb-lg" /></a>
      ${smallThumbs ? `<div class="map-popup-thumbs-stack">${smallThumbs}</div>` : ""}
    </div>` : "";
    const albumPhotoCount = singleLocation ? a.photos.length : locPhotos.length;
    const editBtn = i === 0 ? ` <button class="map-popup-move-btn" title="Move pin">✏️</button>` : "";
    return `<div class="map-popup-album">
      <a href="${albumUrl}" class="map-popup-title">${loc.name}</a>
      <div class="map-popup-meta"><span>${a.groupName}${year ? ` · ${year}` : ""}${editBtn}</span><span class="map-popup-photo-count">${albumPhotoCount} 📸</span></div>
      ${thumbsHtml}
    </div>`;
  }).join('<hr class="map-popup-divider">');

  const el = document.createElement("div");
  el.className = "map-popup";
  el.innerHTML = albumsHtml;

  (el.querySelector(".map-popup-move-btn") as HTMLButtonElement | null)
    ?.addEventListener("click", () => startDragMode(loc, marker));

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

onMounted(async () => {
  document.body.style.overflow = "hidden";
  await nextTick();
  fitMapHeight();
  window.addEventListener("resize", fitMapHeight);

  const res = await fetch("/api/albums");
  const albums: Album[] = await res.json();

  if (!mapEl.value) return;
  map = L.map(mapEl.value).setView([54, -2], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18,
  }).addTo(map);

  const byName = new Map<string, { albums: Album[]; loc: AlbumLocation }>();
  for (const album of albums) {
    for (const loc of album.locations ?? []) {
      if (!byName.has(loc.name)) byName.set(loc.name, { albums: [], loc });
      byName.get(loc.name)!.albums.push(album);
    }
  }

  if (byName.size === 0) { status.value = "No albums have a location set."; return; }

  const needsGeocode = [...byName.values()].filter(e => e.loc.id >= 0 && !e.loc.geocodeAttempted && e.loc.lat == null);
  const total = needsGeocode.length;
  if (total > 0) status.value = `Locating ${total} new location${total > 1 ? "s" : ""}… 0/${total}`;
  let done = 0;
  for (const entry of needsGeocode) {
    const coords = await geocodeAndSave(entry.loc);
    if (coords) { entry.loc.lat = coords[0]; entry.loc.lon = coords[1]; }
    done++;
    if (done < total) status.value = `Locating… ${done}/${total}`;
    else status.value = "";
    if (done < total) await new Promise(r => setTimeout(r, 1100));
  }
  status.value = "";

  let placed = 0;
  for (const { albums: albumsHere, loc } of byName.values()) {
    if (loc.lat == null || loc.lon == null) continue;
    placed++;
    const photoCount = albumsHere.reduce((n, a) =>
      n + ((a.locations?.length ?? 0) <= 1 ? a.photos.length : a.photos.filter(p => p.locationId === loc.id).length), 0);
    const marker = L.marker([loc.lat, loc.lon], { icon: pinIcon }).addTo(map!);
    const popupEl = buildPopupEl(loc, albumsHere, marker);
    marker.bindPopup(popupEl, { maxWidth: 340 });
    marker.on("popupopen", () => {
      if (movingPinLoc.value && movingPinLoc.value.id !== loc.id) cancelDrag();
      activePinLoc.value = loc;
      activePinPhotoCount.value = photoCount;
      activePinAlbums.value = albumsHere;
      activeLatStr.value = loc.lat?.toFixed(5) ?? "";
      activeLonStr.value = loc.lon?.toFixed(5) ?? "";
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
  pinCount.value = placed;
});

onUnmounted(() => {
  document.body.style.overflow = "";
  map?.remove();
  map = null;
  markerRegistry.clear();
  window.removeEventListener("resize", fitMapHeight);
});
</script>
