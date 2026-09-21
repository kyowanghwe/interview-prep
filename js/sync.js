// ===== Progress sync via Cloudflare Worker + D1 =====
// Saves the user's progress JSON to a shared D1 database via the Worker.
// Each user's data is keyed by their GitHub id — completely isolated.
// The leaderboard endpoint exposes only public stats (completed count, etc.).

import { CONFIG } from './config.js';
import { getToken } from './auth.js';

// ----- Pull / Push -----

// Returns the remote progress object (or {} if not found).
export async function pullProgress() {
  const token = getToken();
  if (!token) throw new Error('not_authenticated');

  const res = await fetch(`${CONFIG.WORKER_URL}/progress`, {
    headers: authHeaders(token),
  });

  if (res.status === 401) throw new Error('not_authenticated');
  if (!res.ok) throw new Error(`load_failed: ${res.status}`);

  const data = await res.json();
  return data.progress || {};
}

// Writes the given progress object to D1 via the Worker.
export async function pushProgress(progress) {
  const token = getToken();
  if (!token) throw new Error('not_authenticated');

  const res = await fetch(`${CONFIG.WORKER_URL}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ progress: progress || {} }),
  });

  if (res.status === 401) throw new Error('not_authenticated');
  if (!res.ok) throw new Error(`save_failed: ${res.status}`);
  return true;
}

// Returns the leaderboard array: [{ username, avatar, completed, needsRetry, updated_at }]
export async function fetchLeaderboard() {
  const res = await fetch(`${CONFIG.WORKER_URL}/leaderboard`);
  if (!res.ok) throw new Error(`leaderboard_failed: ${res.status}`);
  const data = await res.json();
  return data.leaderboard || [];
}

// ----- Merge (last-write-wins per question id) -----
// Combines local and remote progress. For each question id we keep the entry
// that is "more advanced": completed wins over not, and the latest
// completedDate breaks ties. Bookmarks and answered choices are OR-merged.
export function mergeProgress(local, remote) {
  const SETTINGS_KEY = '__settings';
  const merged = {};
  const ids = new Set([...Object.keys(local || {}), ...Object.keys(remote || {})]);
  ids.delete(SETTINGS_KEY);

  for (const id of ids) {
    const a = (local && local[id]) || {};
    const b = (remote && remote[id]) || {};

    const completed = !!(a.completed || b.completed);

    const dates = [a.completedDate, b.completedDate].filter(Boolean).sort();
    const completedDate = dates.length ? dates[dates.length - 1] : undefined;

    let answered = a.answered;
    if (answered === undefined) answered = b.answered;

    // Keep wrongDate from whichever side has it (unless completed on either).
    const wrongDate = (!completed && (a.wrongDate || b.wrongDate)) || undefined;

    const entry = {};
    if (completed) entry.completed = true;
    if (completedDate) entry.completedDate = completedDate;
    if (a.bookmarked || b.bookmarked) entry.bookmarked = true;
    if (answered !== undefined) entry.answered = answered;
    if (wrongDate) entry.wrongDate = wrongDate;

    if (Object.keys(entry).length) merged[id] = entry;
  }

  // Merge settings: local values win when present.
  const localSettings = (local && local[SETTINGS_KEY]) || {};
  const remoteSettings = (remote && remote[SETTINGS_KEY]) || {};
  const settings = { ...remoteSettings, ...localSettings };
  if (Object.keys(settings).length) merged[SETTINGS_KEY] = settings;

  return merged;
}

// ----- Debounced push so rapid clicks don't spam the API -----
let pushTimer = null;
export function schedulePush(getProgress, onDone) {
  if (!getToken()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    try {
      await pushProgress(getProgress());
      if (onDone) onDone(null);
    } catch (e) {
      console.warn('Progress push failed (will retry on next change):', e);
      if (onDone) onDone(e);
    }
  }, 1500);
}

// No-op kept for API compatibility — no gist cache to clear anymore.
export function clearGistCache() {}

// ----- Helpers -----
function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}
