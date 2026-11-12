<template>
  <div class="rv-app">
    <img src="/reviews-app/icon-192.png" class="rv-app-icon" alt="" />
    <h2>Get the app</h2>

    <template v-if="standalone || installed">
      <p class="rv-login-sub">You've got the Brunch Reviews app. It updates itself, so there's nothing else to do.</p>
      <router-link to="/reviews" class="rv-btn">Go to the reviews</router-link>
    </template>

    <template v-else>
      <p class="rv-login-sub">Put Brunch Reviews on your home screen. It opens full screen like any other app and always has the latest version.</p>

      <button v-if="installPrompt" type="button" class="rv-btn" @click="promptInstall">Install Brunch Reviews</button>

      <template v-else-if="ios">
        <ol class="rv-app-steps">
          <li>Open this page in <strong>Safari</strong>.</li>
          <li>
            Tap the Share button
            <svg class="rv-app-share" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Share"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>
            at the bottom of the screen.
          </li>
          <li>Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
          <li>Open <strong>Reviews</strong> from your home screen and sign in. When the login message arrives, type its <strong>6-digit code</strong> into the app; the link would sign you in to Safari instead.</li>
        </ol>
      </template>

      <template v-else-if="android">
        <ol class="rv-app-steps">
          <li>Open this page in <strong>Chrome</strong>.</li>
          <li>Tap the menu <strong>⋮</strong> at the top right.</li>
          <li>Tap <strong>Install app</strong> (or <strong>Add to Home screen</strong>), then <strong>Install</strong>.</li>
        </ol>
      </template>

      <template v-else>
        <p class="rv-hint" style="margin-bottom: 12px">Open this page on your phone to install it:</p>
        <p><strong>{{ pageUrl }}</strong></p>
        <p class="rv-hint" style="margin-top: 18px">On a computer, Chrome and Edge can install it too: look for the install icon at the right of the address bar.</p>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { installPrompt, installed, promptInstall, isStandalone, isIos, isAndroid } from "../utils/reviewsApp";

const standalone = isStandalone();
const ios = isIos();
const android = isAndroid();
const pageUrl = `${location.host}/reviews/app`;
</script>
