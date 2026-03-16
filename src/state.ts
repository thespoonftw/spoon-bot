import fs from "fs";
import path from "path";
import type { EventState, EditSession, GroupState } from "./types";

export const DATA_DIR = path.join(__dirname, "..", process.env.DATA_DIR ?? "data");
export const STATE_FILE = path.join(DATA_DIR, "events.json");
export const GROUP_STATE_FILE = path.join(DATA_DIR, "groups.json");

export const eventStates = new Map<string, EventState>();
export const editSessions = new Map<string, EditSession>();
export const pendingGearMenus = new Map<string, any>(); // channelId -> gear menu interaction (for deferred delete)
export const groupStates = new Map<string, GroupState>();

export function loadGroupState() {
  if (!fs.existsSync(GROUP_STATE_FILE)) return;
  const raw = JSON.parse(fs.readFileSync(GROUP_STATE_FILE, "utf-8")) as [string, any][];
  for (const [channelId, s] of raw) {
    groupStates.set(channelId, { ...s, members: new Map(s.members) });
  }
  console.log(`Loaded ${groupStates.size} group(s) from disk.`);
}

export function persistGroupState() {
  const serializable = [...groupStates.entries()].map(([id, s]) => [id, { ...s, members: [...s.members.entries()] }]);
  fs.writeFileSync(GROUP_STATE_FILE, JSON.stringify(serializable, null, 2));
}

export function persistState() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const obj: Record<string, any> = {};
    for (const [channelId, state] of eventStates) {
      obj[channelId] = { ...state, members: [...state.members.entries()] };
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(obj, null, 2));
  } catch (e) { console.error("Failed to persist state:", e); }
}

export function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    for (const [channelId, data] of Object.entries(raw) as [string, any][]) {
      eventStates.set(channelId, { ...data, members: new Map(data.members) });
    }
    console.log(`Loaded ${eventStates.size} event(s) from disk.`);
  } catch (e) { console.error("Failed to load state:", e); }
}
