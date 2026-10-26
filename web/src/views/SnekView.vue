<template>
  <div class="page snek-page">
    <PageHeader back-to="/" title="Snek Server" :subtitle="subtitle" />

    <p v-if="data && !data.presenceTracking" class="snek-notice">
      Online % and last seen need the bot's Presence intent, which is switched off in the Discord Developer Portal.
    </p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="empty">Loading…</p>

    <template v-for="section in sections" :key="section.title">
      <h2 class="snek-section-title">{{ section.title }} <span class="snek-count">{{ section.members.length }}</span></h2>
      <div class="snek-table-wrap">
        <table class="snek-table">
          <thead>
            <tr>
              <th></th>
              <th v-for="col in columns" :key="col.key" :class="{ sortable: col.sort, sorted: sortKey === col.key }" @click="col.sort && setSort(col.key)">
                {{ col.label }}<span v-if="sortKey === col.key">{{ sortDesc ? ' ▾' : ' ▴' }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in section.members" :key="m.discordId">
              <td class="snek-avatar-cell">
                <img :src="m.avatarUrl" class="snek-avatar" />
                <span v-if="m.status" class="snek-status" :class="'snek-status--' + m.status" :title="m.status"></span>
              </td>
              <td>
                <div class="snek-name">{{ m.displayName }}</div>
                <div class="snek-username">@{{ m.username }}</div>
              </td>
              <td>{{ m.realName ?? '' }}</td>
              <td class="snek-nowrap">{{ m.birthday ? formatBirthday(m.birthday) : '' }}</td>
              <td class="snek-num">{{ m.messageCount }}</td>
              <td class="snek-num snek-nowrap">{{ formatDuration(m.voiceSeconds) }}</td>
              <td class="snek-num">{{ m.onlinePct === null ? '' : m.onlinePct + '%' }}</td>
              <td class="snek-nowrap" :title="m.lastSeenAt ? new Date(m.lastSeenAt).toLocaleString() : ''">
                {{ m.status && m.status !== 'offline' ? 'Online now' : m.lastSeenAt ? timeAgo(m.lastSeenAt) : '' }}
              </td>
              <td class="snek-note-cell">
                <textarea v-if="editingId === m.discordId" v-model="draft" class="snek-note-input" rows="2" maxlength="500"
                  @keydown.enter.exact.prevent="saveNote(m)" @keydown.esc="editingId = null" @blur="saveNote(m)" v-focus></textarea>
                <div v-else class="snek-note" :class="{ empty: !m.note }" @click="startEdit(m)"
                  :title="m.note && m.noteBy ? `${m.noteBy}, ${new Date(m.noteAt!).toLocaleDateString()}` : 'Add a note'">
                  {{ m.note || '+ note' }}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { authHeaders, authJsonHeaders } from "../utils/session";
import PageHeader from "../components/PageHeader.vue";

interface SnekMember {
  discordId: string; displayName: string; username: string; avatarUrl: string; isSnek: boolean; joinedAt: string | null;
  birthday: string | null; realName: string | null; status: string | null; note: string | null; noteBy: string | null; noteAt: string | null;
  messageCount: number; voiceSeconds: number; onlinePct: number | null; lastSeenAt: string | null;
}
interface SnekData { snekRole: string | null; presenceTracking: boolean; trackingSince: string | null; members: SnekMember[] }
type SortKey = 'name' | 'realName' | 'birthday' | 'messages' | 'voice' | 'online' | 'lastSeen';

const vFocus = { mounted: (el: HTMLElement) => el.focus() };

const columns: { key: SortKey | 'note'; label: string; sort: boolean }[] = [
  { key: 'name', label: 'Discord', sort: true },
  { key: 'realName', label: 'Name', sort: true },
  { key: 'birthday', label: 'Birthday', sort: true },
  { key: 'messages', label: 'Messages', sort: true },
  { key: 'voice', label: 'Voice', sort: true },
  { key: 'online', label: 'Online %', sort: true },
  { key: 'lastSeen', label: 'Last seen', sort: true },
  { key: 'note', label: 'Note', sort: false },
];

const data = ref<SnekData | null>(null);
const loading = ref(true);
const error = ref('');
const sortKey = ref<SortKey>('name');
const sortDesc = ref(false);
const editingId = ref<string | null>(null);
const draft = ref('');

const subtitle = computed(() => data.value?.trackingSince
  ? `Stats since ${new Date(data.value.trackingSince).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
  : undefined);

// Birthdays sort by when they fall in the year, "DD/MM" → MMDD.
const birthdayKey = (b: string | null) => b ? b.split('/').reverse().join('') : null;

function sortValue(m: SnekMember): string | number | null {
  switch (sortKey.value) {
    case 'name': return m.displayName.toLowerCase();
    case 'realName': return m.realName?.toLowerCase() || null;
    case 'birthday': return birthdayKey(m.birthday);
    case 'messages': return m.messageCount;
    case 'voice': return m.voiceSeconds;
    case 'online': return m.onlinePct;
    case 'lastSeen': return m.status && m.status !== 'offline' ? '9' : m.lastSeenAt;
  }
}

function sorted(members: SnekMember[]): SnekMember[] {
  return [...members].sort((a, b) => {
    const av = sortValue(a), bv = sortValue(b);
    // Blanks always go last, whichever way round.
    if (av === null || bv === null) return av === bv ? 0 : av === null ? 1 : -1;
    const cmp = typeof av === 'number' ? av - (bv as number) : String(av).localeCompare(String(bv));
    return sortDesc.value ? -cmp : cmp;
  });
}

const sections = computed(() => {
  if (!data.value) return [];
  const all = data.value.members;
  const role = data.value.snekRole ?? 'Snek';
  const plural = role.endsWith('s') ? role : `${role}s`;
  return [
    { title: plural, members: sorted(all.filter(m => m.isSnek)) },
    { title: `Not ${plural}`, members: sorted(all.filter(m => !m.isSnek)) },
  ].filter(s => s.members.length > 0);
});

function setSort(key: SortKey | 'note') {
  if (key === 'note') return;
  if (sortKey.value === key) sortDesc.value = !sortDesc.value;
  else {
    sortKey.value = key;
    // Numbers and dates read best biggest/latest first.
    sortDesc.value = ['messages', 'voice', 'online', 'lastSeen'].includes(key);
  }
}

function formatBirthday(date: string): string {
  const [day, month] = date.split('/').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day} ${months[month - 1]}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return seconds ? '<1m' : '';
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return mins <= 1 ? 'Just now' : `${mins} mins ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days < 60) return days === 1 ? 'Yesterday' : `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function startEdit(m: SnekMember) {
  editingId.value = m.discordId;
  draft.value = m.note ?? '';
}

async function saveNote(m: SnekMember) {
  if (editingId.value !== m.discordId) return;
  editingId.value = null;
  const note = draft.value.trim();
  if (note === (m.note ?? '')) return;
  const res = await fetch(`/api/snek/members/${m.discordId}/note`, { method: 'PUT', headers: authJsonHeaders(), body: JSON.stringify({ note }) });
  if (res.ok) Object.assign(m, await res.json());
  else error.value = "Couldn't save that note.";
}

onMounted(async () => {
  const res = await fetch('/api/snek/members', { headers: authHeaders() });
  if (res.ok) data.value = await res.json();
  else error.value = (await res.json().catch(() => null))?.error ?? "Couldn't load the member list.";
  loading.value = false;
});
</script>

<style scoped>
.snek-page { max-width: 1200px; }
.snek-notice { color: #a6adc8; background: #313244; border-radius: 8px; padding: 10px 16px; font-size: 0.85em; margin-bottom: 16px; }
.snek-section-title { color: #cba6f7; font-size: 1.2em; margin: 24px 0 10px; display: flex; align-items: center; gap: 8px; }
.snek-count { background: #313244; color: #a6adc8; border-radius: 10px; padding: 1px 9px; font-size: 0.75em; font-weight: 600; }
.snek-table-wrap { overflow-x: auto; background: #313244; border-radius: 10px; }
.snek-table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
.snek-table th { text-align: left; color: #a6adc8; font-weight: 600; font-size: 0.85em; padding: 10px 10px; border-bottom: 1px solid #45475a; white-space: nowrap; }
.snek-table th.sortable { cursor: pointer; }
.snek-table th.sortable:hover, .snek-table th.sorted { color: #cdd6f4; }
.snek-table td { padding: 8px 10px; border-bottom: 1px solid #3b3d52; vertical-align: middle; }
.snek-table tbody tr:last-child td { border-bottom: none; }
.snek-table tbody tr:hover { background: #383a50; }
.snek-avatar-cell { position: relative; width: 36px; padding-right: 0 !important; }
.snek-avatar { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; display: block; }
.snek-status { position: absolute; left: 36px; bottom: 6px; width: 11px; height: 11px; border-radius: 50%; border: 2px solid #313244; }
.snek-status--online { background: #a6e3a1; }
.snek-status--idle { background: #f9e2af; }
.snek-status--dnd { background: #f38ba8; }
.snek-status--offline { display: none; }
.snek-name { font-weight: 600; }
.snek-username { color: #7f849c; font-size: 0.8em; }
.snek-num { text-align: right; font-variant-numeric: tabular-nums; }
.snek-nowrap { white-space: nowrap; }
.snek-note-cell { min-width: 180px; max-width: 320px; }
.snek-note { cursor: pointer; border-radius: 6px; padding: 4px 6px; margin: -4px -6px; white-space: pre-wrap; word-break: break-word; user-select: text; }
.snek-note:hover { background: #45475a; }
.snek-note.empty { color: #6c7086; font-size: 0.85em; opacity: 0; }
tr:hover .snek-note.empty { opacity: 1; }
.snek-note-input { width: 100%; background: #1e1e2e; border: 1px solid #cba6f7; border-radius: 6px; padding: 4px 6px; color: #cdd6f4; font: inherit; resize: vertical; outline: none; }
@media (hover: none) { .snek-note.empty { opacity: 1; } }
</style>
