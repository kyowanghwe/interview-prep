// ===== Sync configuration =====
// Fill these in after you register a GitHub OAuth App and deploy the Worker.
// See README → "Cross-Device Sync (GitHub Login)" for step-by-step setup.

export const CONFIG = {
    // The Client ID of your GitHub OAuth App (public — safe to commit).
    GITHUB_CLIENT_ID: 'Ov23liCucrPQFY4B2YiG',

    // Your deployed Cloudflare Worker URL.
    // The Worker handles OAuth exchange, progress save/load, and leaderboard.
    // e.g. 'https://jip-oauth.your-subdomain.workers.dev'
    WORKER_URL: 'https://jip-oauth.huycan19991999.workers.dev',

    // OAuth scope. 'read:user' is all we need to identify the user.
    OAUTH_SCOPE: 'read:user',
};

// True once the placeholders above have been replaced with real values.
export function isSyncConfigured() {
    return (
        CONFIG.GITHUB_CLIENT_ID &&
        !CONFIG.GITHUB_CLIENT_ID.startsWith('YOUR_') &&
        CONFIG.WORKER_URL &&
        !CONFIG.WORKER_URL.includes('YOUR_SUBDOMAIN')
    );
}
