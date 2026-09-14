/**
 * Cloudflare Worker — GitHub OAuth token exchange for java-interview-prep.
 *
 * The browser (static GitHub Pages site) can NEVER hold the OAuth client secret.
 * This Worker is the only place the secret lives. Its single job is to exchange
 * the temporary `code` GitHub returns for an access token.
 *
 * After the exchange, the browser talks to the GitHub Gist API directly using
 * that token — this Worker is not involved in reading/writing progress.
 *
 * Environment variables (set as Worker secrets, NOT committed):
 *   GITHUB_CLIENT_ID     — OAuth App client id (public, but kept here for convenience)
 *   GITHUB_CLIENT_SECRET — OAuth App client secret (MUST stay server-side)
 *   ALLOWED_ORIGIN       — exact site origin allowed to call this Worker,
 *                          e.g. https://YOUR_USERNAME.github.io
 */

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const corsHeaders = buildCorsHeaders(origin, env);

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405, corsHeaders);
    }

    // Reject origins that aren't on the allow-list
    if (!isAllowedOrigin(origin, env)) {
      return json({ error: 'origin_not_allowed' }, 403, corsHeaders);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'invalid_json' }, 400, corsHeaders);
    }

    const code = body && body.code;
    if (!code || typeof code !== 'string') {
      return json({ error: 'missing_code' }, 400, corsHeaders);
    }

    // Exchange the code for an access token.
    let tokenRes;
    try {
      tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
        }),
      });
    } catch {
      return json({ error: 'github_unreachable' }, 502, corsHeaders);
    }

    if (!tokenRes.ok) {
      return json({ error: 'token_exchange_failed' }, 502, corsHeaders);
    }

    const data = await tokenRes.json();

    if (data.error || !data.access_token) {
      return json(
        { error: data.error || 'no_access_token', error_description: data.error_description },
        400,
        corsHeaders
      );
    }

    // Only return the token + granted scope. Nothing else leaks.
    return json(
      { access_token: data.access_token, scope: data.scope, token_type: data.token_type },
      200,
      corsHeaders
    );
  },
};

function isAllowedOrigin(origin, env) {
  if (!origin) return false;
  const allowed = (env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return allowed.includes(origin);
}

function buildCorsHeaders(origin, env) {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  // Reflect the origin only if it's allowed (never use "*" with credentials/tokens).
  if (isAllowedOrigin(origin, env)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function json(obj, status, extraHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
