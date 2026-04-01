<template>
  <div class="map-page">
    <PageHeader back-to="/" title="Map">
      <div class="map-pin-count" v-if="pinCount !== null">{{ pinCount }} 📍</div>
    </PageHeader>
    <p v-if="status" class="empty map-status">{{ status }}</p>
    <div ref="mapEl" class="map-container"></div>
    <div v-if="movingPinLoc" class="map-move-overlay">
      <span>Drag pin to new position</span>
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
const movingPinLoc = ref<AlbumLocation | null>(null);

let movingMarker: L.Marker | null = null;
let movingOrigLatLng: L.LatLng | null = null;
let movingPopupEl: HTMLElement | null = null;

const markerRegistry = new Map<number, { marker: L.Marker; popupEl: HTMLElement }>();

function buildPopupEl(loc: AlbumLocation, albumsHere: Album[], photoCount: number, marker: L.Marker): HTMLElement {
  const thumbUrl = (url: string) => url.replace("/uploads/", "/thumbnails/");
  const albumsHtml = albumsHere.map((a, i) => {
    const year = a.startDate ? new Date(a.startDate).getUTCFullYear() : "";
    const singleLocation = (a.locations?.length ?? 0) <= 1;
    const locPhotos = singleLocation ? a.photos : a.photos.filter(p => p.locationId === loc.id);
    const topPhotos = [...locPhotos].sort((x, y) => (y.score ?? 0) - (x.score ?? 0)).slice(0, 3);
    const smallThumbs = topPhotos.slice(1).map(p =>
      `<a href="/album/${a.channelId}?back=/map"><img src="${thumbUrl(p.url)}" class="map-popup-thumb-sm" /></a>`
    ).join("");
    const thumbsHtml = topPhotos.length ? `<div class="map-popup-thumbs">
      <a href="/album/${a.channelId}?back=/map"><img src="${thumbUrl(topPhotos[0].url)}" class="map-popup-thumb-lg" /></a>
      ${smallThumbs ? `<div class="map-popup-thumbs-stack">${smallThumbs}</div>` : ""}
    </div>` : "";
    const editBtn = i === 0 ? ` <button class="map-popup-move-btn" title="Move pin">✏️</button>` : "";
    return `<div class="map-popup-album">
      <a href="/album/${a.channelId}?back=/map" class="map-popup-title">${loc.name}</a>
      <div class="map-popup-meta">${a.groupName}${year ? ` · ${year}` : ""}${editBtn}</div>
      ${thumbsHtml}
    </div>`;
  }).join('<hr class="map-popup-divider">');

  const deleteBtn = photoCount === 0 ? `<button class="popup-delete-btn btn-danger btn-small" title="Delete location">🗑️ Delete</button>` : "";
  const coordsRow = `<div class="popup-coords-row">
    <input class="popup-coord-input" type="number" step="any" value="${loc.lat?.toFixed(5) ?? ""}" placeholder="lat" />
    <input class="popup-coord-input" type="number" step="any" value="${loc.lon?.toFixed(5) ?? ""}" placeholder="lon" />
    ${deleteBtn}
  </div>`;

  const el = document.createElement("div");
  el.className = "map-popup";
  el.innerHTML = albumsHtml + coordsRow;

  // Move pin button
  (el.querySelector(".map-popup-move-btn") as HTMLButtonElement | null)
    ?.addEventListener("click", () => {
      marker.closePopup();
      startDragMode(loc, marker, el);
    });

  // Lat/lon inputs
  const [latInput, lonInput] = el.querySelectorAll<HTMLInputElement>(".popup-coord-input");
  const saveCoords = async () => {
    const lat = parseFloat(latInput.value);
    const lon = parseFloat(lonInput.value);
    if (!isNaN(lat) && !isNaN(lon)) {
      loc.lat = lat; loc.lon = lon;
      marker.setLatLng([lat, lon]);
      await fetch(`/api/album-location/${loc.id}/coords`, {
        method: "PUT", headers: authJsonHeaders(), body: JSON.stringify({ lat, lon }),
      });
    }
  };
  latInput.addEventListener("change", saveCoords);
  lonInput.addEventListener("change", saveCoords);

  // Delete button
  (el.querySelector(".popup-delete-btn") as HTMLButtonElement | null)
    ?.addEventListener("click", async () => {
      const channelId = albumsHere[0]?.channelId;
      if (!channelId) return;
      await fetch(`/api/album/${channelId}/locations/${loc.id}`, { method: "DELETE", headers: authHeaders() });
      marker.remove();
      markerRegistry.delete(loc.id);
      pinCount.value = (pinCount.value ?? 1) - 1;
    });

  return el;
}

function startDragMode(loc: AlbumLocation, marker: L.Marker, popupEl: HTMLElement) {
  movingPinLoc.value = loc;
  movingMarker = marker;
  movingOrigLatLng = marker.getLatLng();
  movingPopupEl = popupEl;
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
  // update coord inputs
  const [latInput, lonInput] = (movingPopupEl?.querySelectorAll<HTMLInputElement>(".popup-coord-input") ?? []);
  if (latInput) latInput.value = lat.toFixed(5);
  if (lonInput) lonInput.value = lng.toFixed(5);
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
  movingPopupEl = null;
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
    const popupEl = buildPopupEl(loc, albumsHere, photoCount, marker);
    marker.bindPopup(popupEl, { maxWidth: 340 });
    markerRegistry.set(loc.id, { marker, popupEl });
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
