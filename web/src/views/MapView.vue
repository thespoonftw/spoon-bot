<template>
  <div class="map-page">
    <div class="map-header">
      <router-link to="/" class="back">← Home</router-link>
      <h1 class="map-title">Map</h1>
      <span class="map-header-spacer"></span>
    </div>
    <p v-if="status" class="empty map-status">{{ status }}</p>
    <div ref="mapEl" class="map-container"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { formatAlbumDate } from "../utils/formatDate";

// Fix Leaflet default icon paths broken by Vite
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow });

interface Album {
  channelId: string;
  groupName: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  photos: { id: number }[];
}

const GEOCODE_CACHE_KEY = "geocode_cache_v1";

function loadCache(): Record<string, [number, number] | null> {
  try { return JSON.parse(sessionStorage.getItem(GEOCODE_CACHE_KEY) ?? "{}"); }
  catch { return {}; }
}

function saveCache(cache: Record<string, [number, number] | null>) {
  sessionStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cache));
}

async function geocode(location: string, cache: Record<string, [number, number] | null>): Promise<[number, number] | null> {
  if (location in cache) return cache[location];
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`,
      { headers: { "Accept-Language": "en", "User-Agent": "spoon-bot/1.0" } }
    );
    const data = await res.json();
    const result: [number, number] | null = data[0] ? [parseFloat(data[0].lat), parseFloat(data[0].lon)] : null;
    cache[location] = result;
    saveCache(cache);
    return result;
  } catch {
    cache[location] = null;
    return null;
  }
}

const mapEl = ref<HTMLElement | null>(null);
const status = ref("Loading albums…");
let map: L.Map | null = null;

onMounted(async () => {
  const res = await fetch("/api/albums");
  const albums: Album[] = await res.json();

  if (!mapEl.value) return;
  map = L.map(mapEl.value).setView([20, 10], 2);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18,
  }).addTo(map);

  const withLocation = albums.filter(a => a.location);
  if (withLocation.length === 0) { status.value = "No albums have a location set."; return; }

  // Group albums by location string so same-location albums share one geocode call
  const byLocation = new Map<string, Album[]>();
  for (const album of withLocation) {
    const loc = album.location!;
    if (!byLocation.has(loc)) byLocation.set(loc, []);
    byLocation.get(loc)!.push(album);
  }

  const cache = loadCache();
  const locations = [...byLocation.keys()];
  let done = 0;
  status.value = `Locating albums… 0/${locations.length}`;

  for (const loc of locations) {
    const coords = await geocode(loc, cache);
    done++;
    status.value = done < locations.length ? `Locating albums… ${done}/${locations.length}` : "";

    if (!coords || !map) continue;
    const albumsHere = byLocation.get(loc)!;

    const popupHtml = albumsHere.map(a => {
      const date = a.startDate ? formatAlbumDate(a.startDate, a.endDate) : "";
      return `<div class="map-popup-album">
        <a href="/album/${a.channelId}" class="map-popup-title">${a.groupName}</a>
        ${date ? `<div class="map-popup-meta">${date}</div>` : ""}
        <div class="map-popup-meta">${a.photos.length} 📷</div>
      </div>`;
    }).join('<hr class="map-popup-divider">');

    const marker = L.marker(coords).addTo(map);
    marker.bindPopup(`<div class="map-popup">${popupHtml}</div>`, { maxWidth: 250 });

    // Small delay to respect Nominatim's 1 req/s rate limit (skip if cached)
    if (!(loc in cache) || cache[loc] === undefined) await new Promise(r => setTimeout(r, 1100));
  }
});

onUnmounted(() => { map?.remove(); map = null; });
</script>
