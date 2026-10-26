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
            <tr v-for="m in section.members" :key="m.discordId" :class="m.removal ? 'snek-row--' + m.removal : ''">
              <td class="snek-avatar-cell">
                <img :src="m.avatarUrl" class="snek-avatar" />
                <span v-if="m.status" class="snek-status" :class="'snek-status--' + m.status" :title="m.status"></span>
              </td>
              <td>
                <div class="snek-name">{{ m.displayName }}</div>
                <div class="snek-username">@{{ m.username }}</div>
              </td>
              <td class="snek-name-cell">
                <input v-if="isEditing(m, 'realName')" v-model="draft" class="snek-edit-input" maxlength="60" placeholder="First Surname"
                  @keydown.enter.prevent="saveField(m, 'realName')" @keydown.esc="editing = null" @blur="saveField(m, 'realName')" v-focus />
                <div v-else class="snek-editable" :class="{ empty: !m.realName }" @click="startEdit(m, 'realName')">
                  {{ m.realName || '+ name' }}
                </div>
              </td>
              <td class="snek-nowrap">{{ m.birthday ? formatBirthday(m.birthday) : '' }}</td>
              <td class="snek-num">{{ m.messageCount }}</td>
              <td class="snek-num snek-nowrap">{{ formatDuration(m.voiceSeconds) }}</td>
              <td class="snek-num">{{ m.onlinePct === null ? '' : m.onlinePct + '%' }}</td>
              <td class="snek-nowrap" :title="m.lastSeenAt ? new Date(m.lastSeenAt).toLocaleString() : ''">
                {{ m.status && m.status !== 'offline' ? 'Online now' : m.lastSeenAt ? timeAgo(m.lastSeenAt) : '' }}
              </td>
              <td class="snek-note-cell">
                <textarea v-if="isEditing(m, 'note')" v-model="draft" class="snek-edit-input" rows="2" maxlength="500"
                  @keydown.enter.exact.prevent="saveField(m, 'note')" @keydown.esc="editing = null" @blur="saveField(m, 'note')" v-focus></textarea>
                <div v-else class="snek-editable snek-note" :class="{ empty: !m.note }" @click="startEdit(m, 'note')"
                  :title="m.note && m.noteBy ? `${m.noteBy}, ${new Date(m.noteAt!).toLocaleDateString()}` : 'Add a note'">
                  {{ m.note || '+ note' }}
                </div>
              </td>
              <td class="snek-removal-cell">
                <button class="snek-removal" :class="m.removal ? 'snek-removal--' + m.removal : ''" @click="cycleRemoval(m)"
                  :title="m.removal && m.removalBy ? `${m.removal === 'delete' ? 'Delete' : 'Maybe'}, set by ${m.removalBy}, ${new Date(m.removalAt!).toLocaleDateString()}` : 'Thinking of removing them from the server?'">
                  {{ m.removal === 'delete' ? '✕' : m.removal === 'maybe' ? '~' : '' }}
                </button>
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

type Removal = 'maybe' | 'delete' | null;
interface SnekMember {
  discordId: string; displayName: string; username: string; avatarUrl: string; isSnek: boolean; joinedAt: string | null;
  birthday: string | null; realName: string | null; status: string | null; note: string | null; noteBy: string | null; noteAt: string | null;
  removal: Removal; removalBy: string | null; removalAt: string | null;
  messageCount: number; voiceSeconds: number; onlinePct: number | null; lastSeenAt: string | null;
}
interface SnekData { snekRole: string | null; presenceTracking: boolean; trackingSince: string | null; members: SnekMember[] }
type SortKey = 'name' | 'realName' | 'birthday' | 'messages' | 'voice' | 'online' | 'lastSeen' | 'removal';

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
  { key: 'removal', label: 'Delete', sort: true },
];

const data = ref<SnekData | null>(null);
const loading = ref(true);
const error = ref('');
const sortKey = ref<SortKey>('name');
const sortDesc = ref(false);
type EditableField = 'note' | 'realName';
// Where each editable field saves to, and the key it's sent under.
const fieldApi: Record<EditableField, string> = { note: 'note', realName: 'name' };
const editing = ref<{ id: string; field: EditableField } | null>(null);
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
    case 'removal': return m.removal === 'delete' ? 2 : m.removal === 'maybe' ? 1 : null;
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
    sortDesc.value = ['messages', 'voice', 'online', 'lastSeen', 'removal'].includes(key);
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

const isEditing = (m: SnekMember, field: EditableField) => editing.value?.id === m.discordId && editing.value.field === field;

function startEdit(m: SnekMember, field: EditableField) {
  editing.value = { id: m.discordId, field };
  draft.value = m[field] ?? '';
}

async function saveField(m: SnekMember, field: EditableField) {
  if (!isEditing(m, field)) return;
  editing.value = null;
  const value = draft.value.trim();
  if (value === (m[field] ?? '')) return;
  const api = fieldApi[field];
  const res = await fetch(`/api/snek/members/${m.discordId}/${api}`, { method: 'PUT', headers: authJsonHeaders(), body: JSON.stringify({ [api]: value }) });
  if (res.ok) Object.assign(m, await res.json());
  else error.value = `Couldn't save that ${api}.`;
}

// Each click steps blank → maybe → delete → blank.
const NEXT_REMOVAL: Record<string, Removal> = { none: 'maybe', maybe: 'delete', delete: null };

async function cycleRemoval(m: SnekMember) {
  const previous = m.removal;
  const removal = NEXT_REMOVAL[previous ?? 'none'];
  m.removal = removal;
  const res = await fetch(`/api/snek/members/${m.discordId}/removal`, { method: 'PUT', headers: authJsonHeaders(), body: JSON.stringify({ removal }) });
  if (res.ok) Object.assign(m, await res.json());
  else { m.removal = previous; error.value = "Couldn't save that."; }
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
.snek-name-cell { min-width: 120px; }
.snek-removal-cell { text-align: center; }
.snek-removal { width: 20px; height: 20px; border-radius: 4px; border: 2px solid #6c7086; background: transparent; color: #1e1e2e; font-weight: 800; font-size: 0.85em; line-height: 1; padding: 0; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.snek-removal:hover { border-color: #a6adc8; }
.snek-removal--maybe { background: #f9e2af; border-color: #f9e2af; font-size: 1.05em; }
.snek-removal--delete { background: #f38ba8; border-color: #f38ba8; }
.snek-table tbody tr.snek-row--maybe { background: rgba(249, 226, 175, 0.10); }
.snek-table tbody tr.snek-row--maybe:hover { background: rgba(249, 226, 175, 0.16); }
.snek-table tbody tr.snek-row--delete { background: rgba(243, 139, 168, 0.12); }
.snek-table tbody tr.snek-row--delete:hover { background: rgba(243, 139, 168, 0.18); }
.snek-editable { cursor: pointer; border-radius: 6px; padding: 4px 6px; margin: -4px -6px; word-break: break-word; user-select: text; }
.snek-editable:hover { background: #45475a; }
.snek-editable.empty { color: #6c7086; font-size: 0.85em; opacity: 0; white-space: nowrap; }
tr:hover .snek-editable.empty { opacity: 1; }
.snek-note { white-space: pre-wrap; }
.snek-edit-input { width: 100%; background: #1e1e2e; border: 1px solid #cba6f7; border-radius: 6px; padding: 4px 6px; color: #cdd6f4; font: inherit; resize: vertical; outline: none; }
@media (hover: none) { .snek-editable.empty { opacity: 1; } }
</style>
