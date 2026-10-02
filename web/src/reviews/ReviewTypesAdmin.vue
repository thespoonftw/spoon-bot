<template>
  <div class="rv-admin">
    <h2>Review types</h2>
    <p class="rv-admin-intro">Each type's colour is used for its label on review cards and the underline on its tab.</p>

    <p v-if="!isAdmin && currentUser" class="rv-error">Only admins can change review types.</p>
    <p v-else-if="loading" class="rv-loading">Loading…</p>
    <ul v-else class="rv-admin-types">
      <li v-for="t in types" :key="t.id">
        <span class="rv-admin-icon">{{ t.icon }}</span>
        <TypeChip :name="t.name" :icon="t.icon" :color="t.color" />
        <span class="rv-admin-count">{{ t.reviewCount }} review{{ t.reviewCount === 1 ? "" : "s" }}</span>
        <input type="color" :value="t.color" :aria-label="`Colour for ${t.name}`" :disabled="!isAdmin" @input="preview(t, $event)" @change="save(t, $event)" />
        <span class="rv-admin-status">{{ status[t.id] ?? "" }}</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useCurrentUser } from "../composables/useCurrentUser";
import { fetchReviewTypes, setReviewTypeColor, type ReviewType } from "./api";
import TypeChip from "./TypeChip.vue";

const { currentUser } = useCurrentUser();
const isAdmin = computed(() => (currentUser.value?.level ?? 0) >= 2);
const types = ref<ReviewType[]>([]);
const loading = ref(true);
const status = ref<Record<number, string>>({});

// The chip follows the picker while it's being dragged; the colour is saved once it's chosen.
function preview(t: ReviewType, e: Event) {
  t.color = (e.target as HTMLInputElement).value;
}

async function save(t: ReviewType, e: Event) {
  const color = (e.target as HTMLInputElement).value;
  status.value[t.id] = "Saving…";
  const ok = await setReviewTypeColor(t.id, color);
  status.value[t.id] = ok ? "Saved" : "Couldn't save";
  if (ok) setTimeout(() => { if (status.value[t.id] === "Saved") status.value[t.id] = ""; }, 1500);
}

onMounted(async () => {
  types.value = (await fetchReviewTypes()).map(t => ({ ...t }));
  loading.value = false;
});
</script>
