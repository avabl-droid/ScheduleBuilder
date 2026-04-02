const crypto = require('crypto');

const { get, run } = require('../db/query');

const SESSION_COOKIE_NAME = 'schedule_builder_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function formatSqliteDate(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseCookies(cookieHeader = '') {
  const cookies = {};

  for (const pair of cookieHeader.split(';')) {
    const trimmed = pair.trim();
    if (!trimmed) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }

  return cookies;
}

function getCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: SESSION_TTL_MS,
    path: '/',
  };
}

async function createSession(userId, { userAgent = null, ipAddress = null } = {}) {
  const token = crypto.randomBytes(48).toString('base64url');
  const tokenHash = hashSessionToken(token);
  const expiresAt = formatSqliteDate(new Date(Date.now() + SESSION_TTL_MS));

  const result = await run(
    `
      INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip_address)
      VALUES (?, ?, ?, ?, ?)
    `,
    [userId, tokenHash, expiresAt, userAgent, ipAddress]
  );

  return {
    id: result.lastID,
    token,
    expiresAt,
  };
}

async function getSessionByToken(token) {
  if (!token) {
    return null;
  }

  const tokenHash = hashSessionToken(token);
  const session = await get(
    `
      SELECT
        s.id,
        s.user_id,
        s.expires_at,
        a.id AS account_id,
        a.primary_email,
        a.secondary_email,
        a.username,
        a.phone_number,
        a.full_name,
        a.system_role,
        a.employment_role,
        a.requires_profile_completion,
        a.requires_password_change,
        a.created_at,
        a.updated_at
      FROM sessions s
      JOIN accounts a ON a.id = s.user_id
      WHERE s.token_hash = ?
        AND datetime(s.expires_at) >= datetime('now')
      LIMIT 1
    `,
    [tokenHash]
  );

  if (!session) {
    return null;
  }

  await run(
    `
      UPDATE sessions
      SET last_seen_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [session.id]
  );

  return session;
}

async function destroySessionById(sessionId) {
  if (!sessionId) {
    return;
  }

  await run(`DELETE FROM sessions WHERE id = ?`, [sessionId]);
}

async function destroySessionByToken(token) {
  if (!token) {
    return;
  }

  await run(`DELETE FROM sessions WHERE token_hash = ?`, [hashSessionToken(token)]);
}

async function destroySessionsForUser(userId) {
  await run(`DELETE FROM sessions WHERE user_id = ?`, [userId]);
}

function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE_NAME, token, getCookieOptions());
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
  });
}

function getSessionTokenFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE_NAME] || null;
}

module.exports = {
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  createSession,
  getSessionByToken,
  destroySessionById,
  destroySessionByToken,
  destroySessionsForUser,
  setSessionCookie,
  clearSessionCookie,
  getSessionTokenFromRequest,
};
