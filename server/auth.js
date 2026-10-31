import { randomToken, sha256 } from './crypto.js';
import { HttpError } from './http.js';

export const SESSION_COOKIE = 'seb_session';

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignorieren */ }
  }
  return out;
}

export function createSession(db, config, res, userId) {
  const token = randomToken();
  const csrf = randomToken(24);
  const expires = new Date(Date.now() + config.sessionDays * 86400_000);
  db.prepare('INSERT INTO sessions (token_hash, user_id, csrf, expires_at) VALUES (?, ?, ?, ?)')
    .run(sha256(token), userId, csrf, expires.toISOString());
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, expires, path: '/',
  });
  return csrf;
}

export function destroySession(db, config, req, res) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.cookieSecure });
}

/** Lädt die Sitzung (falls vorhanden) und prüft bei schreibenden Anfragen das CSRF-Token. */
export function sessionMiddleware(db) {
  const find = db.prepare(`
    SELECT s.csrf, s.expires_at, u.id, u.email, u.name, u.is_admin
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`);
  const del = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
  let lastCleanup = 0;

  return (req, res, next) => {
    if (Date.now() - lastCleanup > 3600_000) {
      lastCleanup = Date.now();
      db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
      db.prepare("DELETE FROM nextcloud_login_flows WHERE created_at < datetime('now', '-20 minutes')").run();
    }
    req.user = null;
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) {
      const hash = sha256(token);
      const row = find.get(hash);
      if (row && row.expires_at > new Date().toISOString()) {
        req.user = { id: row.id, email: row.email, name: row.name, isAdmin: !!row.is_admin };
        req.csrf = row.csrf;
      } else if (row) {
        del.run(hash);
      }
    }
    const safe = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (!safe && req.user && req.get('x-csrf-token') !== req.csrf) {
      return next(new HttpError(403, 'Sicherheitstoken ungültig. Bitte Seite neu laden.'));
    }
    next();
  };
}

export function requireUser(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Bitte anmelden.'));
  next();
}

/** Einfache Begrenzung von Anmeldeversuchen (pro IP + E-Mail). */
export function createRateLimiter({ max = 10, windowMs = 15 * 60_000 } = {}) {
  const hits = new Map();
  return {
    check(key) {
      const now = Date.now();
      const e = hits.get(key);
      if (!e || now - e.start > windowMs) {
        hits.set(key, { start: now, count: 1 });
        if (hits.size > 10_000) for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
        return true;
      }
      e.count += 1;
      return e.count <= max;
    },
    reset(key) { hits.delete(key); },
  };
}
