<template>
  <div class="map-page">
    <PageHeader back-to="/" title="Map">
      <div class="map-pin-count" v-if="pinCount !== null">{{ pinCount }} 📍</div>
    </PageHeader>
    <p v-if="status" class="empty map-status">{{ status }}</p>
    <div ref="mapEl" class="map-container"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted } from "vue";
import PageHeader from "../components/PageHeader.vue";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { formatAlbumDate } from "../utils/formatDate";
import { authJsonHeaders } from "../utils/session";

interface AlbumLocation { id: number; name: string; lat?: number | null; lon?: number | null; geocodeAttempted?: number }
interface Album {
  channelId: string;
  groupName: string;
  location?: string;
  locations?: AlbumLocation[];
  startDate?: string;
  endDate?: string;
  photos: { id: number }[];
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

const mapEl = ref<HTMLElement | null>(null);
const status = ref("Loading albums…");
const pinCount = ref<number | null>(null);
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
    const locs: AlbumLocation[] = album.locations?.length
      ? album.locations
      : album.location ? [{ id: -1, name: album.location }] : [];
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
    const popupHtml = albumsHere.map(a => {
      const date = a.startDate ? formatAlbumDate(a.startDate, a.endDate) : "";
      return `<div class="map-popup-album">
        <a href="/album/${a.channelId}" class="map-popup-title">${a.groupName}</a>
        ${date ? `<div class="map-popup-meta">${date}</div>` : ""}
        <div class="map-popup-meta">${a.photos.length} 📷</div>
      </div>`;
    }).join('<hr class="map-popup-divider">');

    const marker = L.marker([loc.lat, loc.lon], { icon: pinIcon }).addTo(map!);
    marker.bindPopup(`<div class="map-popup">${popupHtml}</div>`, { maxWidth: 250 });
  }

  pinCount.value = placed;
});

onUnmounted(() => {
  document.body.style.overflow = "";
  map?.remove();
  map = null;
  window.removeEventListener("resize", fitMapHeight);
});
</script>
