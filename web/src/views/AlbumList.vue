<template>
  <div class="page">
    <PageHeader back-to="/" title="Albums" />

    <button class="btn-primary" @click="showModal = true" style="margin-bottom:20px">New Album</button>

    <p v-if="loading" class="empty">Loading…</p>
    <p v-else-if="albums.length === 0" class="empty">No albums yet.</p>
    <template v-for="group in albumsByYear" :key="group.year">
      <h2 class="year-header">{{ group.year }}</h2>
      <router-link v-for="album in group.items" :key="album.channelId" :to="`/album/${album.channelId}`" class="card">
        <div class="card-left">
          <div class="card-left-title">
            <h2>{{ album.groupName }}</h2>
            <p v-if="album.startDate" class="date">{{ formatAlbumDate(album.startDate, album.endDate) }}</p>
            <p v-if="album.locations?.length" class="meta">📍 {{ album.locations.map(l => l.name).join(', ') }}</p>
          </div>
          <div class="card-left-details">
            <p class="meta">{{ album.photos.length }} 📷</p>
            <p v-if="album.members.length > 0" class="meta">{{ album.members.length }} 👥</p>
          </div>
          <div v-if="album.members.length > 0" class="card-members">
            <div v-for="member in album.members" :key="member.userId" class="card-member-avatar" :title="member.firstName || member.displayName">
              <img v-if="member.avatarUrl" :src="member.avatarUrl" />
              <span v-else>{{ (member.firstName || member.displayName)[0] }}</span>
            </div>
          </div>
        </div>
        <div class="card-right" v-if="buildCollage(album, heroSize).length">
          <div class="card-collage" :style="{ width: collageWidth(album, heroSize), height: collageHeight(album, heroSize), position: 'relative', flexShrink: '0' }">
            <img v-for="item in buildCollage(album, heroSize)" :key="item.photo.id"
              :src="thumbUrl(item.photo.url)" @error="($event.target as HTMLImageElement).src = item.photo.url"
              :style="{ position: 'absolute', left: item.cssLeft + 'px', top: item.cssTop + 'px', width: item.size + 'px', height: item.size + 'px', objectFit: 'cover', borderRadius: '4px', boxShadow: '1px 1px 6px rgba(0,0,0,0.6)', zIndex: item.zIndex, outline: '1px solid rgba(255,255,255,0.12)' }" />
          </div>
        </div>
      </router-link>
    </template>
  </div>

  <!-- Create Album Modal -->
  <div class="modal-overlay" v-if="showModal">
    <div class="modal">
      <button class="modal-close" @click="closeModal">✕</button>
      <h2>New Album</h2>
      <div class="form-group">
        <label>Name</label>
        <input v-model="form.name" type="text" placeholder="e.g. Summer Trip" />
      </div>
      <div class="form-group">
        <label>Location</label>
        <input v-model="form.location" type="text" placeholder="e.g. Barcelona" />
      </div>
      <DateRangePicker v-model:start-date="form.startDate" v-model:end-date="form.endDate" />
      <div v-if="formError" class="error">{{ formError }}</div>
      <div class="modal-actions">
        <button class="btn-primary" @click="createAlbum" :disabled="creating">{{ creating ? "Creating…" : "Create" }}</button>
      </div>
    </div>
  </div>

</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useCurrentUser } from "../composables/useCurrentUser";
import { authJsonHeaders } from "../utils/session";
import DateRangePicker from "../components/DateRangePicker.vue";
import PageHeader from "../components/PageHeader.vue";
import { formatAlbumDate } from "../utils/formatDate";

interface Member { userId: string; displayName: string; firstName?: string; avatarUrl?: string }
interface Photo { id: number; url: string; score?: number }
interface AlbumLocation { id: number; name: string }
interface Album { channelId: string; groupName: string; location?: string; locations?: AlbumLocation[]; startDate?: string; endDate?: string; createdAt: string; photos: Photo[]; members: Member[] }

const albums = ref<Album[]>([]);
const loading = ref(true);
useCurrentUser();

const showModal = ref(false);
const creating = ref(false);
const formError = ref("");
const form = ref({ name: "", location: "", startDate: "", endDate: "" });

const albumsByYear = computed(() => {
  const groups = new Map<string, Album[]>();
  for (const album of albums.value) {
    const year = album.startDate?.slice(0, 4) ?? album.createdAt.slice(0, 4);
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year)!.push(album);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([year, items]) => ({ year, items: items.sort((a, b) => (b.startDate ?? b.createdAt).localeCompare(a.startDate ?? a.createdAt)) }));
});

function thumbUrl(url: string): string { return url.replace("/uploads/", "/thumbnails/"); }

interface CollageItem { photo: Photo; size: number; cssLeft: number; cssTop: number; zIndex: number; }

function buildCollage(album: Album, H = 160): CollageItem[] {
  const count = Math.min(Math.floor(Math.sqrt(album.photos.length)), 15);
  const eligible = album.photos.filter(p => (p.score ?? 0) >= 1);
  for (let i = eligible.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [eligible[i], eligible[j]] = [eligible[j], eligible[i]]; }
  const sorted = eligible.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, count);
  if (!sorted.length) return [];

  const s2 = H * 0.7, s3 = H * 0.49, s4 = H * 0.343;
  const OV = 5;
  // center-to-center distances from hero
  const gapR  = (H  + s2) / 2 - OV;  // hero → size-2
  const cx4   = (H  + s3) / 2 - OV;  // hero → size-3 (tighter than gapR)
  // vertical offset: size-2 shifts down/up by dy when sharing a column with size-3
  const dy = (s3 - OV) / 2;
  // size-3 y: sits above the shifted size-2 with OV overlap
  const cy4 = dy - s2 / 2 + OV - s3 / 2;  // = (OV - s2) / 2, negative = above center
  // size-4 #1: tucked in corner touching size-3 on its right, size-2 on its top
  const cx6 = cx4 + (s3 + s4) / 2 - OV;
  const cy6 = dy - s2 / 2 + OV - s4 / 2;
  // size-4 #2: in corner touching size-4 #1 and size-2, via circle intersection
  function corner(ax: number, ay: number, ra: number, bx: number, by: number, rb: number, leftmost = false): [number, number] {
    const ddx = bx - ax, ddy = by - ay, d = Math.sqrt(ddx * ddx + ddy * ddy);
    const a = (ra * ra - rb * rb + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, ra * ra - a * a));
    const mx = ax + a * ddx / d, my = ay + a * ddy / d;
    const p1: [number, number] = [mx - h * ddy / d, my + h * ddx / d];
    const p2: [number, number] = [mx + h * ddy / d, my - h * ddx / d];
    return leftmost ? (p1[0] < p2[0] ? p1 : p2) : (p1[0] > p2[0] ? p1 : p2);
  }
  const [cx8, cy8] = corner(cx6, cy6, s4 - OV, gapR, dy, (s2 + s4) / 2 - 2);
  // size-5: directly below/above size-4 #2
  const s5 = H * 0.2401;
  const cy10 = cy8 + (s4 + s5) / 2 - OV;
  // size-6: in corner touching both size-4 photos (6 and 8), via circle intersection
  const s6 = H * 0.16807;
  const [cx12, cy12] = corner(cx6, cy6, (s4 + s6) / 2 - OV, cx8, cy8, (s4 + s6) / 2 - OV);
  // photo 14: to the left of size-2 (photo 3), above size-5 (photo 11)
  const cx14 = -gapR - (s2 + s6) / 2 + OV;
  const cy14 = -cy10 - (s5 + s6) / 2 + OV;
  // photo 15: mirror of photo 14 (right side, below size-5 photo 10)
  const cx15 = -cx14;
  const cy15 = -cy14;

  type R = { photo: Photo; size: number; cx: number; cy: number; z: number };
  const raw: R[] = [];
  raw.push({ photo: sorted[0], size: H,  cx: 0,    cy: 0,    z: 100 });
  if (count >= 2)  raw.push({ photo: sorted[1],  size: s2, cx:  gapR, cy: count >= 4 ?  dy : 0, z: 90 });
  if (count >= 3)  raw.push({ photo: sorted[2],  size: s2, cx: -gapR, cy: count >= 5 ? -dy : 0, z: 90 });
  if (count >= 4)  raw.push({ photo: sorted[3],  size: s3, cx:  cx4,  cy:  cy4,  z: 80 });
  if (count >= 5)  raw.push({ photo: sorted[4],  size: s3, cx: -cx4,  cy: -cy4,  z: 80 });
  if (count >= 6)  raw.push({ photo: sorted[5],  size: s4, cx:  cx6,  cy:  cy6,  z: 70 });
  if (count >= 7)  raw.push({ photo: sorted[6],  size: s4, cx: -cx6,  cy: -cy6,  z: 70 });
  if (count >= 8)  raw.push({ photo: sorted[7],  size: s4, cx:  cx8,  cy:  cy8,  z: 60 });
  if (count >= 9)  raw.push({ photo: sorted[8],  size: s4, cx: -cx8,  cy: -cy8,  z: 60 });
  if (count >= 10) raw.push({ photo: sorted[9],  size: s5, cx:  cx8,  cy:  cy10, z: 50 });
  if (count >= 11) raw.push({ photo: sorted[10], size: s5, cx: -cx8,  cy: -cy10, z: 50 });
  if (count >= 12) raw.push({ photo: sorted[11], size: s6, cx:  cx12, cy:  cy12, z: 40 });
  if (count >= 13) raw.push({ photo: sorted[12], size: s6, cx: -cx12, cy: -cy12, z: 40 });
  if (count >= 14) raw.push({ photo: sorted[13], size: s6, cx:  cx14, cy:  cy14, z: 30 });
  if (count >= 15) raw.push({ photo: sorted[14], size: s6, cx:  cx15, cy:  cy15, z: 30 });

  const minX = Math.min(...raw.map(p => p.cx - p.size / 2));
  const maxX = Math.max(...raw.map(p => p.cx + p.size / 2));
  const minY = Math.min(...raw.map(p => p.cy - p.size / 2));
  const shift = -(minX + maxX) / 2;
  const offX = Math.max(0, -(minX + shift));
  const offY = Math.max(0, -minY);
  return raw.map(p => ({ photo: p.photo, size: p.size, cssLeft: p.cx - p.size / 2 + shift + offX, cssTop: p.cy - p.size / 2 + offY, zIndex: p.z }));
}

function collageWidth(album: Album, H: number): string {
  const items = buildCollage(album, H);
  return (items.length ? Math.max(...items.map(i => i.cssLeft + i.size)) : 0) + 'px';
}

function collageHeight(album: Album, H: number): string {
  const items = buildCollage(album, H);
  return (items.length ? Math.max(...items.map(i => i.cssTop + i.size)) : H) + 'px';
}


const heroSize = ref(window.innerWidth < 768 ? 120 : 160);
const onResize = () => { heroSize.value = window.innerWidth < 768 ? 120 : 160; };

onMounted(async () => {
  window.addEventListener("resize", onResize);
  const res = await fetch("/api/albums");
  const data: Album[] = await res.json();
  const byName = (a: Member, b: Member) => (a.firstName || a.displayName).localeCompare(b.firstName || b.displayName);
  albums.value = data.map(a => ({ ...a, members: a.members.slice().sort(byName) }));
  loading.value = false;
});
onUnmounted(() => window.removeEventListener("resize", onResize));

function closeModal() {
  showModal.value = false;
  formError.value = "";
  form.value = { name: "", location: "", startDate: "", endDate: "" };
}

async function createAlbum() {
  formError.value = "";
  if (!form.value.name.trim()) { formError.value = "Name is required."; return; }
  if (!form.value.location.trim()) { formError.value = "Location is required."; return; }
  if (!form.value.startDate) { formError.value = "Start date is required."; return; }
  creating.value = true;
  const res = await fetch("/api/albums", {
    method: "POST",
    headers: authJsonHeaders(),
    body: JSON.stringify({
      name: form.value.name.trim(),
      location: form.value.location.trim(),
      startDate: form.value.startDate,
      endDate: form.value.endDate || undefined,
    }),
  });
  creating.value = false;
  if (res.ok) {
    const album = await res.json();
    albums.value.unshift(album);
    closeModal();
  } else {
    formError.value = "Failed to create album. Try again.";
  }
}

</script>
