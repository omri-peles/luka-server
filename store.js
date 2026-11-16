// Simple JSON file persistence. Good enough for a single-owner assistant.
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve('./data');
const FILE = path.join(DATA_DIR, 'store.json');

const DEFAULTS = {
  google: null,          // { refresh_token, ... }
  seenEmailIds: [],      // Gmail message ids already handled
  alertedEventIds: [],   // calendar event ids already announced
  updates: [],           // queue of proactive messages for the tablet
  lastTabletSeen: 0,     // epoch ms of last tablet heartbeat/poll
  conversation: []       // shared chat history (tablet + whatsapp)
};

let cache = null;

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify(DEFAULTS, null, 2));
}

export function load() {
  if (cache) return cache;
  ensure();
  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export function save() {
  ensure();
  fs.writeFileSync(FILE, JSON.stringify(cache, null, 2));
}

export function get(key) { return load()[key]; }
export function set(key, value) { load(); cache[key] = value; save(); }

// Keep arrays from growing without bound
export function remember(key, id, max = 500) {
  load();
  if (!Array.isArray(cache[key])) cache[key] = [];
  if (cache[key].includes(id)) return false;
  cache[key].push(id);
  if (cache[key].length > max) cache[key] = cache[key].slice(-max);
  save();
  return true;
}
