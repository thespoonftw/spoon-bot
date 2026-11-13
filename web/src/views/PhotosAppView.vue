<template>
  <div class="page photos-app-page">
    <PageHeader back-to="/photos" title="Get the app" />

    <div class="photos-app">
      <img src="/photos-app/icon-192.png" class="photos-app-icon" alt="" />
      <h2>brunchPhotos</h2>

      <template v-if="standalone">
        <p class="photos-app-sub">You have the brunchPhotos app. It updates itself, so there's nothing else to do.</p>
        <router-link to="/photos" class="btn-primary">Go to the photos</router-link>
      </template>

      <template v-else-if="installed && !installPrompt">
        <p class="photos-app-sub">You have the app. Open <strong>brunchPhotos</strong> from your home screen. It updates itself, so there's nothing else to do.</p>
      </template>

      <template v-else>
        <p class="photos-app-sub">Put the albums, search and map on your home screen. It opens full screen like any other app and always has the latest version.</p>

        <button v-if="installPrompt" type="button" class="btn-primary photos-app-install" @click="promptInstall">Install brunchPhotos</button>

        <ol v-else-if="ios" class="photos-app-steps">
          <li>Open this page in <strong>Safari</strong>.</li>
          <li>
            Tap the Share button
            <svg class="photos-app-share" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Share"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>
            at the bottom of the screen.
          </li>
          <li>Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
          <li>Open <strong>brunchPhotos</strong> from your home screen and log in. The app sends you a 6-digit code to type in.</li>
        </ol>

        <ol v-else-if="android" class="photos-app-steps">
          <li>Open this page in <strong>Chrome</strong>.</li>
          <li>Tap the menu <strong>⋮</strong> at the top right.</li>
          <li>Tap <strong>Install app</strong> (or <strong>Add to Home screen</strong>), then <strong>Install</strong>.</li>
        </ol>

        <template v-else>
          <p class="photos-app-hint">Open this page on your phone to install it:</p>
          <p class="photos-app-url">{{ pageUrl }}</p>
          <p class="photos-app-hint">On a computer, Chrome and Edge can install it too: look for the install icon at the right of the address bar.</p>
        </template>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import PageHeader from "../components/PageHeader.vue";
import { useInstall, isStandalone, isIos, isAndroid } from "../utils/pwa";

const { installPrompt, installed, promptInstall, checkInstalled } = useInstall("photos");
onMounted(checkInstalled);

const standalone = isStandalone();
const ios = isIos();
const android = isAndroid();
const pageUrl = `${location.host}/photos/app`;
</script>

<style scoped>
.photos-app-page { max-width: 560px; }
.photos-app { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 8px 0 32px; }
.photos-app-icon { width: 96px; height: 96px; border-radius: 22px; box-shadow: 0 10px 30px rgba(0,0,0,0.35); margin-bottom: 16px; }
.photos-app h2 { color: #cba6f7; font-size: 1.6rem; margin-bottom: 10px; }
.photos-app-sub { color: #a6adc8; line-height: 1.55; margin-bottom: 24px; max-width: 420px; }
.photos-app .btn-primary { text-decoration: none; display: inline-block; }
.photos-app-install { padding: 13px 28px; font-size: 1rem; border-radius: 999px; }
.photos-app-steps { text-align: left; background: #313244; border-radius: 14px; padding: 18px 20px 18px 40px; color: #cdd6f4; line-height: 1.55; width: 100%; display: flex; flex-direction: column; gap: 10px; }
.photos-app-steps strong { color: #f5e0dc; }
.photos-app-share { width: 18px; height: 18px; vertical-align: -3px; color: #89b4fa; }
.photos-app-hint { color: #7f849c; font-size: 0.9rem; line-height: 1.5; margin-bottom: 8px; }
.photos-app-url { color: #cdd6f4; font-weight: 600; margin-bottom: 18px; user-select: text; }
</style>
