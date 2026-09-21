/**
 * Cloudflare Worker — GitHub OAuth + D1 progress sync for java-interview-prep.
 *
 * Routes:
 *   POST /exchange          — exchange GitHub OAuth code for access token
 *   POST /progress          — save the authenticated user's progress to D1
 *   GET  /progress          — load the authenticated user's progress from D1
 *   GET  /leaderboard       — return all users' public stats (no raw progress data)
 *
 * Environment variables (set as Worker secrets via wrangler secret put):
 *   GITHUB_CLIENT_ID        — OAuth App client id
 *   GITHUB_CLIENT_SECRET    — OAuth App client secret (MUST stay server-side)
 *   ALLOWED_ORIGIN          — comma-separated list of allowed origins
 *
 * D1 binding (set in wrangler.toml):
 *   DB                      — D1 database binding
 */

const GH_API = 'https://api.github.com';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const corsHeaders = buildCorsHeaders(origin, env);

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Reject disallowed origins
    if (!isAllowedOrigin(origin, env)) {
      return json({ error: 'origin_not_allowed' }, 403, corsHeaders);
    }

    const url = new URL(request.url);

    // ── POST /exchange ── OAuth code → access token ──────────────────────────
    if (request.method === 'POST' && url.pathname === '/exchange') {
      return handleExchange(request, env, corsHeaders);
    }

    // ── POST /progress ── save progress ──────────────────────────────────────
    if (request.method === 'POST' && url.pathname === '/progress') {
      return handleSaveProgress(request, env, corsHeaders);
    }

    // ── GET /progress ── load progress ───────────────────────────────────────
    if (request.method === 'GET' && url.pathname === '/progress') {
      return handleLoadProgress(request, env, corsHeaders);
    }

    // ── GET /leaderboard ── public stats for all users ────────────────────────
    if (request.method === 'GET' && url.pathname === '/leaderboard') {
      return handleLeaderboard(request, env, corsHeaders);
    }

    return json({ error: 'not_found' }, 404, corsHeaders);
  },
};

// ── Handlers ─────────────────────────────────────────────────────────────────

async function handleExchange(request, env, corsHeaders) {
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

  let tokenRes;
  try {
    tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });
  } catch {
    return json({ error: 'github_unreachable' }, 502, corsHeaders);
  }

  if (!tokenRes.ok) return json({ error: 'token_exchange_failed' }, 502, corsHeaders);

  const data = await tokenRes.json();
  if (data.error || !data.access_token) {
    return json(
      { error: data.error || 'no_access_token', error_description: data.error_description },
      400,
      corsHeaders
    );
  }

  return json(
    { access_token: data.access_token, scope: data.scope, token_type: data.token_type },
    200,
    corsHeaders
  );
}

async function handleSaveProgress(request, env, corsHeaders) {
  // Authenticate the request — bearer token must be a valid GitHub token.
  const user = await getGitHubUser(request);
  if (!user) return json({ error: 'unauthorized' }, 401, corsHeaders);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400, corsHeaders);
  }

  const data = body && body.progress;
  if (data === undefined) return json({ error: 'missing_progress' }, 400, corsHeaders);

  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO progress (github_id, username, avatar, data, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(github_id) DO UPDATE SET
       username   = excluded.username,
       avatar     = excluded.avatar,
       data       = excluded.data,
       updated_at = excluded.updated_at`
  )
    .bind(
      String(user.id),
      user.login || '',
      user.avatar_url || '',
      JSON.stringify(data),
      now
    )
    .run();

  return json({ ok: true }, 200, corsHeaders);
}

async function handleLoadProgress(request, env, corsHeaders) {
  const user = await getGitHubUser(request);
  if (!user) return json({ error: 'unauthorized' }, 401, corsHeaders);

  const row = await env.DB.prepare(
    'SELECT data FROM progress WHERE github_id = ?1'
  )
    .bind(String(user.id))
    .first();

  if (!row) return json({ progress: {} }, 200, corsHeaders);

  let progress = {};
  try {
    progress = JSON.parse(row.data || '{}');
  } catch {
    progress = {};
  }

  return json({ progress }, 200, corsHeaders);
}

async function handleLeaderboard(request, env, corsHeaders) {
  // Returns public stats only — username, avatar, and computed counts.
  // Raw progress data (which questions, which answers) is never exposed.
  const { results } = await env.DB.prepare(
    'SELECT github_id, username, avatar, data, updated_at FROM progress ORDER BY updated_at DESC'
  ).all();

  const leaderboard = (results || []).map((row) => {
    let progress = {};
    try {
      progress = JSON.parse(row.data || '{}');
    } catch {}

    // Count completed questions (skip the __settings key).
    const completed = Object.entries(progress).filter(
      ([id, v]) => id !== '__settings' && v && v.completed
    ).length;

    // Count wrong answers not yet corrected.
    const needsRetry = Object.entries(progress).filter(
      ([id, v]) => id !== '__settings' && v && v.wrongDate && !v.completed
    ).length;

    return {
      github_id: row.github_id,
      username: row.username,
      avatar: row.avatar,
      completed,
      needsRetry,
      updated_at: row.updated_at,
    };
  });

  // Sort by completed descending.
  leaderboard.sort((a, b) => b.completed - a.completed);

  return json({ leaderboard }, 200, corsHeaders);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Calls GitHub API to verify the bearer token and return the user profile.
// Returns null if the token is missing or invalid.
async function getGitHubUser(request) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;

  try {
    const res = await fetch(`${GH_API}/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
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
