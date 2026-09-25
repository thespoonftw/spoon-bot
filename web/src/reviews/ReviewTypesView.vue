<template>
  <div class="rv-narrow">
    <h2 class="rv-section-title">Types</h2>
    <p class="rv-hint" style="margin-bottom: 20px">Everything you can review. Add a new type and it's available to everyone straight away.</p>

    <form class="rv-newtype rv-newtype--panel" @submit.prevent="add">
      <input v-model="icon" class="rv-input rv-newtype-icon" placeholder="🎮" maxlength="8" aria-label="Emoji (optional)" title="Emoji (optional)" />
      <input v-model="name" class="rv-input" placeholder="New type, e.g. Video game" maxlength="40" aria-label="New type name" />
      <button type="submit" class="rv-btn rv-btn--small" :disabled="!name.trim() || busy">{{ busy ? "Adding…" : "Add type" }}</button>
    </form>
    <p v-if="message" class="rv-hint" :style="{ color: messageIsError ? 'var(--rv-accent)' : undefined, marginTop: '8px' }">{{ message }}</p>

    <p v-if="loading" class="rv-loading">Loading…</p>
    <table v-else class="rv-table" style="margin-top: 24px">
      <thead>
        <tr><th>Type</th><th class="num">Reviews</th><th>Added by</th></tr>
      </thead>
      <tbody>
        <tr v-for="t in types" :key="t.id" :class="{ 'rv-row-new': t.id === justAdded }">
          <td><TypeChip :name="t.name" :icon="t.icon" :color="t.color" with-icon /></td>
          <td class="num">
            <router-link v-if="t.reviewCount" :to="{ path: '/reviews', query: { type: String(t.id) } }">{{ t.reviewCount }}</router-link>
            <span v-else class="rv-muted">0</span>
          </td>
          <td class="rv-muted">{{ t.createdByName ?? "Built in" }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { fetchReviewTypes, createReviewType, type ReviewType } from "./api";
import TypeChip from "./TypeChip.vue";

const types = ref<ReviewType[]>([]);
const loading = ref(true);
const name = ref("");
const icon = ref("");
const busy = ref(false);
const message = ref("");
const messageIsError = ref(false);
const justAdded = ref<number | null>(null);

async function add() {
  if (!name.value.trim() || busy.value) return;
  busy.value = true;
  message.value = "";
  const result = await createReviewType(name.value, icon.value);
  busy.value = false;
  if ("error" in result) { message.value = result.error; messageIsError.value = true; return; }
  const existed = types.value.some(t => t.id === result.id);
  types.value = await fetchReviewTypes();
  justAdded.value = result.id;
  message.value = existed ? `"${result.name}" already exists.` : `Added "${result.name}".`;
  messageIsError.value = false;
  name.value = "";
  icon.value = "";
}

onMounted(async () => {
  types.value = await fetchReviewTypes();
  loading.value = false;
});
</script>
