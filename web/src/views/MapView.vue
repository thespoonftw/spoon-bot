<template>
  <div class="map-page">
    <PageHeader back-to="/" title="Map">
      <div class="map-pin-count" v-if="pinCount !== null" @click="showPinsModal = true" style="cursor:pointer">{{ pinCount }} 📍</div>
    </PageHeader>
    <p v-if="status" class="empty map-status">{{ status }}</p>
    <div ref="mapEl" class="map-container"></div>
  </div>

  <Teleport to="body">
    <div class="modal-overlay" v-if="showPinsModal" style="z-index:200000">
      <div class="modal" style="max-width:520px;width:95vw">
        <button class="modal-close" @click="showPinsModal = false">✕</button>
        <h2>Pins</h2>
        <div class="pins-modal-list">
          <div v-for="entry in pinEntries" :key="entry.loc.id" class="pins-modal-row">
            <div class="pins-modal-name">📍 {{ entry.loc.name }}</div>
            <div class="pins-modal-coords">
              <input class="pins-coord-input" type="number" step="any" :value="entry.loc.lat ?? ''" placeholder="lat"
                @change="e => updateCoord(entry, 'lat', (e.target as HTMLInputElement).value)" />
              <input class="pins-coord-input" type="number" step="any" :value="entry.loc.lon ?? ''" placeholder="lon"
                @change="e => updateCoord(entry, 'lon', (e.target as HTMLInputElement).value)" />
            </div>
            <div class="pins-modal-actions">
              <span class="pins-photo-count">{{ entry.photoCount }} 📷</span>
              <button class="btn-secondary btn-small" @click="startMovePin(entry)" title="Move pin">✏️</button>
              <button class="btn-danger btn-small" :disabled="entry.photoCount > 0" @click="deletePin(entry)" title="Delete">🗑️</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
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
  } catch { /* network error — don't save attempted, may succeed next time */ return null; }
  // Save result (even null) so we don't retry
  fetch(`/api/album-location/${loc.id}/coords`, {
    method: "PUT",
    headers: authJsonHeaders(),
    body: JSON.stringify({ lat, lon }),
  });
  return lat != null && lon != null ? [lat, lon] : null;
}

const pinIcon = L.divIcon({
  html: "📍",
  iconSize: [28, 28],
  iconAnchor: [14, 28],
  popupAnchor: [0, -28],
  className: "map-emoji-pin",
});

const editingIcon = L.divIcon({
  html: "📍",
  iconSize: [36, 36],
  iconAnchor: [18, 36],
  className: "map-emoji-pin map-emoji-pin-editing",
});

const mapEl = ref<HTMLElement | null>(null);
const status = ref("Loading albums…");
const pinCount = ref<number | null>(null);
const showPinsModal = ref(false);

interface PinEntry { loc: AlbumLocation; albums: Album[]; photoCount: number }
const pinEntries = ref<PinEntry[]>([]);

// marker registry — populated during onMounted
const markerRegistry = new Map<number, { marker: L.Marker; popupContent: string }>();

async function updateCoord(entry: PinEntry, field: 'lat' | 'lon', val: string) {
  const num = parseFloat(val);
  if (isNaN(num)) return;
  entry.loc[field] = num;
  await fetch(`/api/album-location/${entry.loc.id}/coords`, {
    method: "PUT", headers: authJsonHeaders(),
    body: JSON.stringify({ lat: entry.loc.lat, lon: entry.loc.lon }),
  });
}

async function deletePin(entry: PinEntry) {
  if (entry.photoCount > 0) return;
  const channelId = entry.albums[0]?.channelId;
  if (!channelId) return;
  await fetch(`/api/album/${channelId}/locations/${entry.loc.id}`, { method: "DELETE", headers: authHeaders() });
  pinEntries.value = pinEntries.value.filter(e => e.loc.id !== entry.loc.id);
  pinCount.value = (pinCount.value ?? 1) - 1;
}

function doMovePin(loc: AlbumLocation, marker: L.Marker, popupContent: string) {
  const origLatLng = marker.getLatLng();
  marker.dragging?.enable();
  marker.setIcon(editingIcon);
  if (map) map.setView(marker.getLatLng(), Math.max(map.getZoom(), 10));

  const restorePopup = () => {
    marker.dragging?.disable();
    marker.setIcon(pinIcon);
    marker.closePopup();
    marker.unbindPopup();
    marker.bindPopup(popupContent, { maxWidth: 320 });
  };

  const container = document.createElement("div");
  container.className = "map-popup";
  container.innerHTML = `<div style="font-weight:700;margin-bottom:8px">Drag pin to correct position</div><div style="display:flex;gap:6px"><button class="map-popup-save-btn">Save</button><button class="map-popup-cancel-btn">Cancel</button></div>`;

  container.querySelector(".map-popup-save-btn")!.addEventListener("click", async () => {
    const { lat, lng } = marker.getLatLng();
    await fetch(`/api/album-location/${loc.id}/coords`, {
      method: "PUT", headers: authJsonHeaders(), body: JSON.stringify({ lat, lon: lng }),
    });
    loc.lat = lat; loc.lon = lng;
    restorePopup();
    const modalEntry = pinEntries.value.find(e => e.loc.id === loc.id);
    if (modalEntry) { modalEntry.loc.lat = lat; modalEntry.loc.lon = lng; }
  });

  container.querySelector(".map-popup-cancel-btn")!.addEventListener("click", () => {
    marker.setLatLng(origLatLng);
    restorePopup();
  });

  marker.unbindPopup();
  marker.bindPopup(container, { maxWidth: 240, closeOnClick: false, closeButton: false }).openPopup();
}

function startMovePin(entry: PinEntry) {
  showPinsModal.value = false;
  const reg = markerRegistry.get(entry.loc.id);
  if (reg && map) doMovePin(entry.loc, reg.marker, reg.popupContent);
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

  // Collect all named locations with their album, keyed by location name for grouping pins
  const byName = new Map<string, { albums: Album[]; loc: AlbumLocation }>();
  for (const album of albums) {
    const locs: AlbumLocation[] = album.locations ?? [];
    for (const loc of locs) {
      if (!byName.has(loc.name)) byName.set(loc.name, { albums: [], loc });
      byName.get(loc.name)!.albums.push(album);
    }
  }

  if (byName.size === 0) { status.value = "No albums have a location set."; return; }

  // Separate into already-geocoded and needing geocoding
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
    const thumbUrl = (url: string) => url.replace("/uploads/", "/thumbnails/");
    const editBtnId = `map-move-btn-${loc.id}`;
    const popupInner = albumsHere.map((a, i) => {
      const year = a.startDate ? new Date(a.startDate).getUTCFullYear() : "";
      const singleLocation = (a.locations?.length ?? 0) <= 1;
      const locPhotos = singleLocation ? a.photos : a.photos.filter(p => p.locationId === loc.id);
      const topPhotos = [...locPhotos].sort((x, y) => (y.score ?? 0) - (x.score ?? 0)).slice(0, 3);
      const smallThumbs = topPhotos.slice(1).map(p =>
        `<a href="/album/${a.channelId}?back=/map"><img src="${thumbUrl(p.url)}" class="map-popup-thumb-sm" /></a>`
      ).join("");
      const thumbsHtml = topPhotos.length ? `
        <div class="map-popup-thumbs">
          <a href="/album/${a.channelId}?back=/map"><img src="${thumbUrl(topPhotos[0].url)}" class="map-popup-thumb-lg" /></a>
          ${smallThumbs ? `<div class="map-popup-thumbs-stack">${smallThumbs}</div>` : ""}
        </div>` : "";
      const editBtn = i === 0 ? ` <button id="${editBtnId}" class="map-popup-move-btn" title="Move pin">✏️</button>` : "";
      return `<div class="map-popup-album">
        <a href="/album/${a.channelId}?back=/map" class="map-popup-title">${loc.name}</a>
        <div class="map-popup-meta">${a.groupName}${year ? ` · ${year}` : ""}${editBtn}</div>
        ${thumbsHtml}
      </div>`;
    }).join('<hr class="map-popup-divider">');

    const popupContent = `<div class="map-popup">${popupInner}</div>`;
    const marker = L.marker([loc.lat, loc.lon], { icon: pinIcon }).addTo(map!);
    marker.bindPopup(popupContent, { maxWidth: 320 });
    marker.on("popupopen", () => {
      const btn = document.getElementById(editBtnId);
      if (btn) btn.onclick = () => { marker.closePopup(); doMovePin(loc, marker, popupContent); };
    });
    markerRegistry.set(loc.id, { marker, popupContent });
  }

  pinCount.value = placed;
  pinEntries.value = [...byName.values()]
    .filter(e => e.loc.id >= 0)
    .map(e => ({
      loc: e.loc,
      albums: e.albums,
      photoCount: e.albums.reduce((n, a) => n + ((a.locations?.length ?? 0) <= 1 ? a.photos.length : a.photos.filter(p => p.locationId === e.loc.id).length), 0),
    }))
    .sort((a, b) => a.loc.name.localeCompare(b.loc.name));
});

onUnmounted(() => {
  document.body.style.overflow = "";
  map?.remove();
  map = null;
  markerRegistry.clear();
  window.removeEventListener("resize", fitMapHeight);
});
</script>
