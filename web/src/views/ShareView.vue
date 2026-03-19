<template>
  <div class="page center" v-if="!album">
    <h1>Photo Album</h1>
    <div v-if="error" class="error" style="margin-bottom:16px;max-width:320px">{{ error }}</div>
    <p class="subtitle" v-else>Enter the password to view this album.</p>
    <div class="confirm-card">
      <div class="form-group" style="width:100%">
        <label>Password</label>
        <input v-model="password" type="password" @keyup.enter="unlock" placeholder="Password" autofocus />
      </div>
      <button class="btn-primary" style="width:100%" @click="unlock" :disabled="loading">
        {{ loading ? "Checking…" : "View Album" }}
      </button>
    </div>
  </div>

  <div class="page" v-else>
    <div class="album-header">
      <div>
        <h1>{{ album.groupName }}</h1>
        <p v-if="album.dateText" class="date">{{ album.dateText }}</p>
        <p v-if="album.location" class="meta">📍 {{ album.location }}</p>
      </div>
    </div>
    <p v-if="album.photos.length === 0" class="empty" style="margin-top:24px">No photos yet.</p>
    <div class="gallery">
      <div v-for="(photo, i) in album.photos" :key="photo.id" class="photo-item" @click="openLightbox(i)">
        <img :src="thumbUrl(photo.url)" loading="lazy" @error="($event.target as HTMLImageElement).src = photo.url" />
        <div class="photo-meta">
          <span v-if="photo.uploadedByName" class="uploader">{{ photo.uploadedByName }}</span>
          <span v-if="photo.takenAt" class="upload-time">{{ formatTime(photo.takenAt) }}</span>
        </div>
      </div>
    </div>
    <div class="gallery-mobile">
      <div v-for="(photo, i) in album.photos" :key="photo.id" class="photo-item-mobile" @click="openLightbox(i)">
        <img :src="photo.url" loading="lazy" />
        <div class="photo-meta">
          <span v-if="photo.uploadedByName" class="uploader">{{ photo.uploadedByName }}</span>
          <span v-if="photo.takenAt" class="upload-time">{{ formatTime(photo.takenAt) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRoute } from "vue-router";
import PhotoSwipe from "photoswipe";
import "photoswipe/style.css";

interface Photo { id: number; url: string; uploadedByName?: string; takenAt?: string; width?: number; height?: number }
interface Album { groupName: string; dateText?: string; location?: string; photos: Photo[] }

const route = useRoute();
const token = route.params.token as string;
const password = ref("");
const loading = ref(false);
const error = ref("");
const album = ref<Album | null>(null);

async function unlock() {
  if (!password.value) return;
  loading.value = true;
  error.value = "";
  const res = await fetch(`/api/share/${token}/unlock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: password.value }),
  });
  loading.value = false;
  if (res.ok) {
    album.value = await res.json();
  } else if (res.status === 401) {
    error.value = "Wrong password.";
  } else {
    error.value = "Link not found or expired.";
  }
}

function openLightbox(index: number) {
  if (!album.value) return;
  const photos = album.value.photos;
  const pswp = new PhotoSwipe({
    dataSource: photos.map(p => ({ src: p.url, width: p.width || 1200, height: p.height || 900 })),
    index, bgOpacity: 0.92, zoom: true, close: true, counter: true, arrowKeys: true, pinchToClose: false, closeOnVerticalDrag: false,
  });
  pswp.on("uiRegister", () => {
    pswp.ui!.registerElement({
      name: "photo-caption", order: 9, isButton: false, appendTo: "root",
      onInit: (el) => {
        const update = () => {
          const p = photos[pswp.currIndex];
          el.textContent = [p?.uploadedByName, p?.takenAt ? formatTime(p.takenAt) : ""].filter(Boolean).join(" · ");
        };
        pswp.on("change", update); update();
      },
    });
  });
  pswp.init();
}

function thumbUrl(url: string): string { return url.replace("/uploads/", "/thumbnails/"); }
function formatTime(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
</script>
