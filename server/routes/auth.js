import { Router } from 'express';
import { hashPassword, verifyPassword } from '../crypto.js';
import { createSession, destroySession, requireUser, createRateLimiter } from '../auth.js';
import { HttpError, bad, text } from '../http.js';
import { tx } from '../db.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function authRoutes({ db, config }) {
  const r = Router();
  const limiter = createRateLimiter({ max: 10 });
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
        // Die erste Person darf sich immer registrieren (wird Admin).
        allowRegistration: config.allowRegistration || userCount() === 0,
        registrationDomains: config.registrationDomains,
        nextcloudDefaultUrl: config.nextcloud.defaultUrl,
        nextcloudFixed: config.nextcloud.allowedHosts.length === 1 && !!config.nextcloud.defaultUrl,
        nextcloudBaseFolder: config.nextcloud.baseFolder,
        uploadMaxMb: config.uploadMaxMb,
      },
    });
  });

  r.post('/register', (req, res) => {
    const first = userCount() === 0;
    if (!config.allowRegistration && !first) throw new HttpError(403, 'Die Registrierung ist deaktiviert. Bitte an die Administration wenden.');
    const email = text(req.body.email, { name: 'E-Mail', required: true, max: 200 }).toLowerCase();
    const name = text(req.body.name, { name: 'Name', required: true, max: 100 });
    const password = validPassword(req.body.password);
    if (!EMAIL_RE.test(email)) throw bad('Bitte eine gültige E-Mail-Adresse angeben.');
    if (config.registrationDomains.length && !first) {
      const domain = email.split('@')[1];
      if (!config.registrationDomains.includes(domain)) throw bad(`Registrierung nur mit Adressen von: ${config.registrationDomains.join(', ')}`);
    }
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'Diese E-Mail-Adresse ist bereits registriert.');
    const { lastInsertRowid } = db.prepare('INSERT INTO users (email, name, password_hash, is_admin) VALUES (?, ?, ?, ?)')
      .run(email, name, hashPassword(password), first ? 1 : 0);
    const csrf = createSession(db, config, res, Number(lastInsertRowid));
    res.status(201).json({ user: { id: Number(lastInsertRowid), email, name, isAdmin: first }, csrf });
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
    const blocking = db.prepare(`
      SELECT b.title FROM boards b JOIN board_members m ON m.board_id = b.id AND m.user_id = ? AND m.role = 'owner'
      WHERE (SELECT COUNT(*) FROM board_members o WHERE o.board_id = b.id AND o.role = 'owner') = 1
        AND (SELECT COUNT(*) FROM board_members x WHERE x.board_id = b.id) > 1`).all(req.user.id);
    if (blocking.length) {
      throw new HttpError(409, `Du bist die einzige verantwortliche Person in: ${blocking.map((b) => `„${b.title}“`).join(', ')}. Bitte dort zuerst eine andere Person als verantwortlich eintragen.`);
    }
    const nc = req.app.locals.nc?.clientFor(req.user.id, { required: false });
    if (nc) await nc.revokeAppPassword().catch(() => {});
    tx(db, () => {
      db.prepare(`DELETE FROM boards WHERE id IN (SELECT board_id FROM board_members WHERE user_id = ?)
                  AND (SELECT COUNT(*) FROM board_members x WHERE x.board_id = boards.id) = 1`).run(req.user.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
    });
    destroySession(db, config, req, res);
    res.json({ ok: true });
  });

  return r;
}
