import { Router } from 'express';
import { hashPassword, verifyPassword } from '../crypto.js';
import { createSession, destroySession, requireUser, createRateLimiter } from '../auth.js';
import { HttpError, bad, text } from '../http.js';
import crypto from 'node:crypto';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function authRoutes({ db, config, mailer, invitations, users }) {
  const r = Router();
  const limiter = createRateLimiter({ max: 10 });
  const forgotLimiter = createRateLimiter({ max: 5, windowMs: 60 * 60_000 });
  const sameCode = (a, b) => {
    const x = Buffer.from(String(a || '').trim().toUpperCase());
    const y = Buffer.from(String(b).toUpperCase());
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  };
  const userCount = () => db.prepare('SELECT COUNT(*) n FROM users').get().n;

  const validPassword = (pw) => {
    if (typeof pw !== 'string' || pw.length < 10) throw bad('Das Passwort muss mindestens 10 Zeichen lang sein.');
    if (pw.length > 200) throw bad('Das Passwort ist zu lang.');
    return pw;
  };

  r.get('/me', (req, res) => {
    let nextcloud = null;
    if (req.user) {
      const nc = db.prepare('SELECT server_url, login_name, nc_user_id, display_name FROM nextcloud_accounts WHERE user_id = ?').get(req.user.id);
      if (nc) nextcloud = { server: nc.server_url, loginName: nc.login_name, userId: nc.nc_user_id, displayName: nc.display_name };
    }
    res.json({
      user: req.user,
      csrf: req.csrf || null,
      nextcloud,
      config: {
        appName: config.appName,
        // Die erste Person darf sich immer registrieren (wird Admin) – mit Einrichtungscode, falls gesetzt.
        allowRegistration: config.allowRegistration || userCount() === 0,
        needsSetup: userCount() === 0,
        setupCodeRequired: userCount() === 0 && !!config.setupCode,
        registrationDomains: config.registrationDomains,
        nextcloudDefaultUrl: config.nextcloud.defaultUrl,
        nextcloudFixed: config.nextcloud.allowedHosts.length === 1 && !!config.nextcloud.defaultUrl,
        nextcloudBaseFolder: config.nextcloud.baseFolder,
        uploadMaxMb: config.uploadMaxMb,
        mailEnabled: mailer.enabled,
        demo: config.demo,
      },
    });
  });

  r.post('/register', (req, res) => {
    const first = userCount() === 0;
    // Gültige Einladung erlaubt die Registrierung auch bei geschlossener Registrierung / fremder Domain.
    const inv = req.body.inviteToken ? invitations.byToken(req.body.inviteToken) : null;
    if (req.body.inviteToken && (!inv || inv.accepted_at || inv.expired)) throw bad('Die Einladung ist ungültig oder abgelaufen.');
    if (!config.allowRegistration && !first && !inv) throw new HttpError(403, 'Die Registrierung ist deaktiviert. Bitte an die Administration wenden.');
    if (first && config.setupCode) {
      if (!limiter.check(`setup|${req.ip}`)) throw new HttpError(429, 'Zu viele Versuche. Bitte in 15 Minuten erneut versuchen.');
      if (!sameCode(req.body.setupCode, config.setupCode)) throw new HttpError(403, 'Der Einrichtungscode stimmt nicht. Er wurde am Ende der Installation angezeigt.');
    }
    const email = inv ? inv.email.toLowerCase() : text(req.body.email, { name: 'E-Mail', required: true, max: 200 }).toLowerCase();
    const name = text(req.body.name, { name: 'Name', required: true, max: 100 });
    const password = validPassword(req.body.password);
    if (!EMAIL_RE.test(email)) throw bad('Bitte eine gültige E-Mail-Adresse angeben.');
    if (config.registrationDomains.length && !first && !inv) {
      const domain = email.split('@')[1];
      if (!config.registrationDomains.includes(domain)) throw bad(`Registrierung nur mit Adressen von: ${config.registrationDomains.join(', ')}`);
    }
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'Diese E-Mail-Adresse ist bereits registriert.');
    const { lastInsertRowid } = db.prepare('INSERT INTO users (email, name, password_hash, is_admin) VALUES (?, ?, ?, ?)')
      .run(email, name, hashPassword(password), first ? 1 : 0);
    const user = { id: Number(lastInsertRowid), email, name, isAdmin: first };
    const boardId = inv ? invitations.accept(inv, user) : null;
    const csrf = createSession(db, config, res, user.id);
    res.status(201).json({ user, csrf, boardId });
  });

  r.post('/login', (req, res) => {
    const email = text(req.body.email, { name: 'E-Mail', required: true, max: 200 }).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const key = `${req.ip}|${email}`;
    if (!limiter.check(key)) throw new HttpError(429, 'Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.');
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!u || !verifyPassword(password, u.password_hash)) throw new HttpError(401, 'E-Mail oder Passwort falsch.');
    limiter.reset(key);
    const csrf = createSession(db, config, res, u.id);
    res.json({ user: { id: u.id, email: u.email, name: u.name, isAdmin: !!u.is_admin }, csrf });
  });

  r.post('/logout', (req, res) => {
    destroySession(db, config, req, res);
    res.json({ ok: true });
  });

  r.patch('/me', requireUser, (req, res) => {
    const name = text(req.body.name, { name: 'Name', max: 100 });
    if (name !== undefined) {
      if (!name) throw bad('Name darf nicht leer sein.');
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user.id);
    }
    if (req.body.newPassword !== undefined) {
      const u = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
      if (!verifyPassword(String(req.body.currentPassword || ''), u.password_hash)) throw bad('Das aktuelle Passwort ist falsch.');
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(validPassword(req.body.newPassword)), req.user.id);
    }
    res.json({ ok: true });
  });

  // Konto löschen (Art. 17 DSGVO). Boards, in denen man allein ist, werden mitgelöscht.
  r.delete('/me', requireUser, async (req, res) => {
    const u = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(String(req.body?.password || ''), u.password_hash)) throw bad('Passwort falsch.');
    if (req.user.isAdmin && db.prepare('SELECT COUNT(*) n FROM users WHERE is_admin = 1').get().n === 1
        && userCount() > 1) {
      throw new HttpError(409, 'Du bist die einzige Administratorin bzw. der einzige Administrator. Bitte zuerst unter „Verwaltung“ eine weitere Person zur Administration machen.');
    }
    await users.deleteUser(req.user.id);
    destroySession(db, config, req, res);
    res.json({ ok: true });
  });

  // ---- Passwort vergessen ----
  r.post('/forgot', async (req, res) => {
    const email = text(req.body.email, { name: 'E-Mail', required: true, max: 200 }).toLowerCase();
    if (!forgotLimiter.check(`${req.ip}|${email}`)) throw new HttpError(429, 'Zu viele Anfragen. Bitte später erneut versuchen.');
    if (!mailer.enabled) {
      return res.json({ ok: true, mailEnabled: false });
    }
    const u = db.prepare('SELECT id, email, name FROM users WHERE email = ?').get(email);
    // Immer gleiche Antwort – verrät nicht, ob es das Konto gibt.
    if (u) await users.createResetLink(req, u, { hours: 2 });
    res.json({ ok: true, mailEnabled: true });
  });

  r.get('/reset/:token', (req, res) => {
    const r0 = users.resetByToken(req.params.token);
    if (!r0 || r0.used_at || r0.expired) throw new HttpError(410, 'Dieser Link ist abgelaufen oder wurde schon benutzt. Bitte einen neuen anfordern.');
    res.json({ email: r0.email, name: r0.name });
  });

  r.post('/reset/:token', (req, res) => {
    const r0 = users.resetByToken(req.params.token);
    if (!r0 || r0.used_at || r0.expired) throw new HttpError(410, 'Dieser Link ist abgelaufen oder wurde schon benutzt. Bitte einen neuen anfordern.');
    const password = validPassword(req.body.password);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), r0.user_id);
    db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE token_hash = ?").run(r0.token_hash);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(r0.user_id); // überall abmelden
    const u = db.prepare('SELECT id, email, name, is_admin FROM users WHERE id = ?').get(r0.user_id);
    const csrf = createSession(db, config, res, u.id);
    res.json({ user: { id: u.id, email: u.email, name: u.name, isAdmin: !!u.is_admin }, csrf });
  });

  return r;
}
