// ===== GitHub OAuth (Path B) =====
// Real "Login with GitHub" via the OAuth Authorization Code flow.
// The client secret lives ONLY in the Cloudflare Worker; the browser never sees it.
//
// Flow:
//   1. login() -> redirect to github.com/login/oauth/authorize
//   2. GitHub redirects back to this site with ?code=...&state=...
//   3. handleRedirect() posts the code to the Worker, which returns an access token
//   4. token is stored in localStorage and used for Gist API calls

import { CONFIG, isSyncConfigured } from './config.js';

const AUTH_KEYS = {
    TOKEN: 'jip_gh_token',
    USER: 'jip_gh_user',
    STATE: 'jip_oauth_state',
};

// ----- Public state helpers -----
export function getToken() {
    return localStorage.getItem(AUTH_KEYS.TOKEN) || null;
}

export function getUser() {
    try {
        return JSON.parse(localStorage.getItem(AUTH_KEYS.USER) || 'null');
    } catch {
        return null;
    }
}

export function isLoggedIn() {
    return !!getToken();
}

// ----- Login: redirect to GitHub -----
export function login() {
    if (!isSyncConfigured()) {
        alert('Sync is not configured yet. See README → "Cross-Device Sync".');
        return;
    }

    // CSRF protection: random state we verify on the way back.
    const state = randomState();
    localStorage.setItem(AUTH_KEYS.STATE, state);

    const redirectUri = siteRedirectUri();
    const params = new URLSearchParams({
        client_id: CONFIG.GITHUB_CLIENT_ID,
        redirect_uri: redirectUri,
        scope: CONFIG.OAUTH_SCOPE,
        state,
        allow_signup: 'false',
    });

    window.location.href = `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export function logout() {
    localStorage.removeItem(AUTH_KEYS.TOKEN);
    localStorage.removeItem(AUTH_KEYS.USER);
}

// ----- Handle the redirect back from GitHub -----
// Returns: { justLoggedIn: boolean }
export async function handleRedirect() {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (!code) return { justLoggedIn: false };

    const savedState = localStorage.getItem(AUTH_KEYS.STATE);
    // Always strip the query params so a refresh doesn't re-trigger the exchange.
    cleanUrl();

    if (!state || state !== savedState) {
        console.warn('OAuth state mismatch — ignoring redirect.');
        localStorage.removeItem(AUTH_KEYS.STATE);
        return { justLoggedIn: false };
    }
    localStorage.removeItem(AUTH_KEYS.STATE);

    try {
        const res = await fetch(CONFIG.WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            console.error('Token exchange failed:', err);
            alert('GitHub login failed during token exchange. See console.');
            return { justLoggedIn: false };
        }

        const data = await res.json();
        if (!data.access_token) {
            console.error('No access token returned:', data);
            return { justLoggedIn: false };
        }

        localStorage.setItem(AUTH_KEYS.TOKEN, data.access_token);
        await fetchAndStoreUser(data.access_token);
        return { justLoggedIn: true };
    } catch (e) {
        console.error('Token exchange error:', e);
        alert('GitHub login failed. Check your network / Worker URL.');
        return { justLoggedIn: false };
    }
}

// ----- Fetch the logged-in GitHub user (for display) -----
async function fetchAndStoreUser(token) {
    try {
        const res = await fetch('https://api.github.com/user', {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
            },
        });
        if (!res.ok) return;
        const u = await res.json();
        localStorage.setItem(
            AUTH_KEYS.USER,
            JSON.stringify({ login: u.login, name: u.name, avatar_url: u.avatar_url })
        );
    } catch (e) {
        console.warn('Could not fetch GitHub user:', e);
    }
}

// ----- Helpers -----
function siteRedirectUri() {
    // Redirect back to the page itself (origin + path, no query/hash).
    return window.location.origin + window.location.pathname;
}

function cleanUrl() {
    const clean = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, clean);
}

function randomState() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}
