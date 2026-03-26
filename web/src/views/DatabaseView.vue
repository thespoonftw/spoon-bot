<template>
  <div class="page">
    <router-link to="/" class="back">← Home</router-link>
    <h1>Database</h1>

    <div class="db-layout">
      <div class="db-sidebar">
        <p class="meta" style="margin:0 0 6px">Select table</p>
        <p v-if="!tables.length" class="empty">Loading…</p>
        <button
          v-for="t in tables" :key="t"
          class="db-table-btn"
          :class="{ active: t === activeTable }"
          @click="selectTable(t)"
        >{{ t }}</button>
      </div>

      <div class="db-main" v-if="activeTable">
        <div class="db-toolbar">
          <span class="db-table-name">{{ activeTable }}</span>
          <span class="db-count">{{ total }} rows</span>
          <div class="db-pagination">
            <button class="btn-secondary btn-small" @click="changePage(page - 1)" :disabled="page === 0">←</button>
            <span>Page {{ page + 1 }} of {{ totalPages }}</span>
            <button class="btn-secondary btn-small" @click="changePage(page + 1)" :disabled="page >= totalPages - 1">→</button>
          </div>
        </div>
        <div class="db-table-wrap">
          <p v-if="loading" class="empty">Loading…</p>
          <table v-else class="db-table">
            <thead>
              <tr>
                <th style="color:#585b70">#</th>
                <th v-for="col in columns" :key="col">{{ col }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in rows" :key="i">
                <td style="color:#585b70;user-select:none">{{ page * PAGE_SIZE + i + 1 }}</td>
                <td v-for="(cell, j) in row" :key="j">{{ cell ?? 'NULL' }}</td>
              </tr>
              <tr v-if="!rows.length">
                <td :colspan="columns.length + 1" style="text-align:center;color:#585b70">No rows</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="db-main" v-else>
        <p class="empty" style="padding:32px">Select a table</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { authHeaders } from "../utils/session";

const tables = ref<string[]>([]);
const activeTable = ref<string | null>(null);
const columns = ref<string[]>([]);
const rows = ref<unknown[][]>([]);
const total = ref(0);
const page = ref(0);
const loading = ref(false);
const PAGE_SIZE = 50;

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));

onMounted(async () => {
  const res = await fetch("/api/db/tables", { headers: authHeaders() });
  if (res.ok) tables.value = (await res.json()).tables;
});

async function selectTable(table: string) {
  activeTable.value = table;
  page.value = 0;
  await loadPage();
}

async function changePage(p: number) {
  page.value = p;
  await loadPage();
}

async function loadPage() {
  if (!activeTable.value) return;
  loading.value = true;
  const res = await fetch(`/api/db/table/${encodeURIComponent(activeTable.value)}?page=${page.value}`, { headers: authHeaders() });
  if (res.ok) {
    const data = await res.json();
    columns.value = data.columns;
    rows.value = data.rows;
    total.value = data.total;
  }
  loading.value = false;
}
</script>
