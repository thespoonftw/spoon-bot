<template>
  <div class="rv-login">
    <h2>{{ method === "email" ? "Check your inbox" : "Check your DMs" }}</h2>
    <p class="rv-login-sub" v-if="method === 'email'">
      We've emailed a login link to <strong v-if="maskedEmail">{{ maskedEmail }}</strong><template v-else>your email address</template>.
    </p>
    <p class="rv-login-sub" v-else>We've sent you a login link on Discord.</p>

    <!-- The message also has a code: the way in for the installed iPhone app, which can't pick up a
         login made by tapping the link (that opens Safari, which keeps separate cookies). -->
    <form v-if="requestId" class="rv-login-code" @submit.prevent="submitCode">
      <label for="rv-login-code">Or enter the 6-digit code from the message</label>
      <div class="rv-login-code-row">
        <input id="rv-login-code" v-model="code" class="rv-input" type="text" inputmode="numeric"
               autocomplete="one-time-code" maxlength="7" placeholder="123456" :disabled="checking || expired" />
        <button type="submit" class="rv-btn" :disabled="checking || expired || digits.length !== 6">
          {{ checking ? "Checking…" : "Sign in" }}
        </button>
      </div>
      <p v-if="codeError" class="rv-error">{{ codeError }}</p>
    </form>

    <p class="rv-hint">The {{ requestId ? "link and code expire" : "link expires" }} in 15 minutes.</p>
    <p style="margin-top: 24px"><router-link to="/reviews/login" class="rv-btn rv-btn--ghost">← Use a different account</router-link></p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { verifyLoginCode } from "../composables/useLogin";

const route = useRoute();
const router = useRouter();
const method = route.query.method as string | undefined;
const maskedEmail = route.query.maskedEmail as string | undefined;
const requestId = route.query.r as string | undefined;

const code = ref("");
const digits = computed(() => code.value.replace(/\D/g, ""));
const checking = ref(false);
const expired = ref(false);
const codeError = ref("");

async function submitCode() {
  if (!requestId || digits.value.length !== 6) return;
  checking.value = true;
  codeError.value = "";
  const result = await verifyLoginCode(requestId, digits.value).catch(() => "error" as const);
  checking.value = false;
  if (result === "ok") { router.replace("/reviews"); return; }
  if (result === "expired") {
    expired.value = true;
    codeError.value = "This code has expired or had too many wrong tries — request a new one below.";
  } else {
    codeError.value = result === "wrong" ? "That code isn't right — check the message and try again." : "Couldn't check the code — try again.";
  }
}
</script>
