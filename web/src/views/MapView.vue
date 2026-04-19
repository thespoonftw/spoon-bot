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

  function buildAlbumContent(a: Album): HTMLElement {
    const singleLocation = (a.locations?.length ?? 0) <= 1;
    const locPhotos = singleLocation ? a.photos : a.photos.filter(p => p.locationId === loc.id);
    const topPhotos = [...locPhotos].sort((x, y) => (y.score ?? 0) - (x.score ?? 0)).slice(0, 3);
    const albumUrl = singleLocation ? `/album/${a.channelId}?back=/map` : `/album/${a.channelId}?back=/map&sort=location&loc=${loc.id}`;
    const albumPhotoCount = singleLocation ? a.photos.length : locPhotos.length;
    const year = a.startDate ? new Date(a.startDate).getUTCFullYear() : "";

    const content = document.createElement("div");

    const meta = document.createElement("div");
    meta.className = "map-popup-meta";
    const metaLink = document.createElement("a");
    metaLink.href = albumUrl;
    metaLink.className = "map-popup-title";
    metaLink.textContent = a.groupName + (year ? ` · ${year}` : "");
    const photoCountEl = document.createElement("span");
    photoCountEl.className = "map-popup-photo-count";
    photoCountEl.textContent = `${albumPhotoCount} 📸`;
    meta.appendChild(metaLink);
    meta.appendChild(photoCountEl);
    content.appendChild(meta);

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

  // Header: location name + pencil button
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

  const contentArea = document.createElement("div");

  if (albumsHere.length === 1) {
    contentArea.appendChild(buildAlbumContent(albumsHere[0]));
  } else {
    // Tabs to switch between albums
    const tabs = document.createElement("div");
    tabs.className = "map-popup-tabs";
    const albumContents = albumsHere.map(a => buildAlbumContent(a));

    function showAlbum(idx: number) {
      contentArea.innerHTML = "";
      contentArea.appendChild(albumContents[idx]);
      tabs.querySelectorAll(".map-popup-tab").forEach((btn, i) => {
        btn.classList.toggle("active", i === idx);
      });
    }

    albumsHere.forEach((a, i) => {
      const tab = document.createElement("button");
      tab.className = "map-popup-tab" + (i === 0 ? " active" : "");
      const year = a.startDate ? new Date(a.startDate).getUTCFullYear() : "";
      tab.textContent = year ? `${a.groupName} · ${year}` : a.groupName;
      tab.addEventListener("click", () => showAlbum(i));
      tabs.appendChild(tab);
    });

    el.appendChild(tabs);
    contentArea.appendChild(albumContents[0]);
  }

  el.appendChild(contentArea);
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
    placed++;
    const lat = loc.lat ?? 0;
    const lon = loc.lon ?? 0;
    const photoCount = albumsHere.reduce((n, a) =>
      n + ((a.locations?.length ?? 0) <= 1 ? a.photos.length : a.photos.filter(p => p.locationId === loc.id).length), 0);
    const marker = L.marker([lat, lon], { icon: pinIcon }).addTo(map!);
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
  pinCount.value = [...byName.values()].filter(e => e.loc.lat != null).length;
});

onUnmounted(() => {
  document.body.style.overflow = "";
  map?.remove();
  map = null;
  markerRegistry.clear();
  window.removeEventListener("resize", fitMapHeight);
});
</script>
