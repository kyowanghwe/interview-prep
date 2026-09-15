// ===== Progress sync via GitHub Gist =====
// Stores the user's progress JSON in a per-user *secret* gist, so it syncs
// across every device where they log in with the same GitHub account.
//
// The browser calls the GitHub Gist API directly with the OAuth token.
// (The Worker is only used for the initial token exchange, not for sync.)

import { CONFIG } from './config.js';
import { getToken } from './auth.js';

const SYNC_KEYS = {
    GIST_ID: 'jip_gist_id',
};

const GH_API = 'https://api.github.com';

// ----- Gist discovery / creation -----

// Find the existing progress gist (by filename) or create a new secret one.
// Caches the gist id in localStorage so we skip the search next time.
export async function ensureGist() {
    const token = getToken();
    if (!token) throw new Error('not_authenticated');

    const cached = localStorage.getItem(SYNC_KEYS.GIST_ID);
    if (cached) {
        // Verify it still exists / is accessible.
        const ok = await gistExists(cached, token);
        if (ok) return cached;
        localStorage.removeItem(SYNC_KEYS.GIST_ID);
    }

    const found = await findProgressGist(token);
    if (found) {
        localStorage.setItem(SYNC_KEYS.GIST_ID, found);
        return found;
    }

    const created = await createProgressGist(token);
    localStorage.setItem(SYNC_KEYS.GIST_ID, created);
    return created;
}

async function gistExists(id, token) {
    const res = await fetch(`${GH_API}/gists/${id}`, { headers: ghHeaders(token) });
    return res.ok;
}

async function findProgressGist(token) {
    // Scan the user's gists for one containing our progress file.
    let page = 1;
    while (page <= 10) {
        const res = await fetch(`${GH_API}/gists?per_page=100&page=${page}`, {
            headers: ghHeaders(token),
        });
        if (!res.ok) break;
        const gists = await res.json();
        if (!Array.isArray(gists) || gists.length === 0) break;

        const match = gists.find((g) => g.files && g.files[CONFIG.GIST_FILENAME]);
        if (match) return match.id;

        if (gists.length < 100) break;
        page++;
    }
    return null;
}

async function createProgressGist(token) {
    const res = await fetch(`${GH_API}/gists`, {
        method: 'POST',
        headers: ghHeaders(token),
        body: JSON.stringify({
            description: CONFIG.GIST_DESCRIPTION,
            public: false,
            files: {
                [CONFIG.GIST_FILENAME]: { content: JSON.stringify(emptyDoc(), null, 2) },
            },
        }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`gist_create_failed: ${res.status} ${err}`);
    }
    const gist = await res.json();
    return gist.id;
}

// ----- Pull / Push -----

// Returns the remote progress object (or {} if empty/new).
export async function pullProgress() {
    const token = getToken();
    if (!token) throw new Error('not_authenticated');

    const id = await ensureGist();
    const res = await fetch(`${GH_API}/gists/${id}`, { headers: ghHeaders(token) });
    if (!res.ok) throw new Error(`gist_read_failed: ${res.status}`);

    const gist = await res.json();
    const file = gist.files && gist.files[CONFIG.GIST_FILENAME];
    if (!file) return {};

    // Large gists may be truncated; fetch raw_url in that case.
    let content = file.content;
    if (file.truncated && file.raw_url) {
        const raw = await fetch(file.raw_url);
        content = await raw.text();
    }

    try {
        const doc = JSON.parse(content || '{}');
        return doc.progress || {};
    } catch {
        return {};
    }
}

// Writes the given progress object to the gist.
export async function pushProgress(progress) {
    const token = getToken();
    if (!token) throw new Error('not_authenticated');

    const id = await ensureGist();
    const doc = {
        version: 1,
        updatedAt: new Date().toISOString(),
        progress: progress || {},
    };

    const res = await fetch(`${GH_API}/gists/${id}`, {
        method: 'PATCH',
        headers: ghHeaders(token),
        body: JSON.stringify({
            files: { [CONFIG.GIST_FILENAME]: { content: JSON.stringify(doc, null, 2) } },
        }),
    });
    if (!res.ok) throw new Error(`gist_write_failed: ${res.status}`);
    return true;
}

// ----- Merge (last-write-wins per question id) -----
// Combines local and remote progress. For each question id we keep the entry
// that is "more advanced": completed wins over not, and the latest
// completedDate breaks ties. Bookmarks and answered choices are OR-merged.
export function mergeProgress(local, remote) {
    const SETTINGS_KEY = '__settings';
    const merged = {};
    const ids = new Set([...Object.keys(local || {}), ...Object.keys(remote || {})]);
    ids.delete(SETTINGS_KEY); // handled separately below, not as a question entry

    for (const id of ids) {
        const a = (local && local[id]) || {};
        const b = (remote && remote[id]) || {};

        const completed = !!(a.completed || b.completed);

        // Pick the latest completedDate among the two.
        const dates = [a.completedDate, b.completedDate].filter(Boolean).sort();
        const completedDate = dates.length ? dates[dates.length - 1] : undefined;

        // answered: prefer a defined value; if both defined, keep local's.
        let answered = a.answered;
        if (answered === undefined) answered = b.answered;

        const entry = {};
        if (completed) entry.completed = true;
        if (completedDate) entry.completedDate = completedDate;
        if (a.bookmarked || b.bookmarked) entry.bookmarked = true;
        if (answered !== undefined) entry.answered = answered;

        if (Object.keys(entry).length) merged[id] = entry;
    }

    // Merge settings: local values win when present (a local change is the most
    // recent intent), otherwise fall back to the remote settings.
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

export function clearGistCache() {
    localStorage.removeItem(SYNC_KEYS.GIST_ID);
}

// ----- Helpers -----
function ghHeaders(token) {
    return {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
    };
}

function emptyDoc() {
    return { version: 1, updatedAt: new Date().toISOString(), progress: {} };
}
