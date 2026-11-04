import { Router } from 'express';
import fs from 'node:fs';
import { requireUser } from '../auth.js';
import { HttpError, bad, int } from '../http.js';
import { testMail } from '../mailer.js';

const VERSION = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;

export default function adminRoutes({ db, config, mailer, users }) {
  const r = Router();
  r.use(requireUser, (req, _res, next) => next(req.user.isAdmin ? undefined : new HttpError(403, 'Nur für die Administration.')));

  const adminCount = () => db.prepare('SELECT COUNT(*) n FROM users WHERE is_admin = 1').get().n;
  const find = (id) => db.prepare('SELECT id, email, name, is_admin FROM users WHERE id = ?').get(int(id)) || (() => { throw new HttpError(404, 'Konto nicht gefunden.'); })();

  r.get('/status', (_req, res) => {
    const count = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
    let dbBytes = null;
    try { dbBytes = fs.statSync(config.dbFile).size; } catch { /* :memory: */ }
    res.json({
      version: VERSION,
      baseUrl: config.baseUrl,
      counts: { users: db.prepare('SELECT COUNT(*) n FROM users WHERE is_guest = 0').get().n, guests: db.prepare('SELECT COUNT(*) n FROM users WHERE is_guest = 1').get().n, boards: count('boards'), cards: count('cards'), nextcloud: count('nextcloud_accounts') },
      dbBytes,
      mail: { enabled: mailer.enabled, from: config.smtp.from || null, host: config.smtp.host || null },
      registration: { open: config.allowRegistration, domains: config.registrationDomains },
      nextcloud: { defaultUrl: config.nextcloud.defaultUrl || null, allowedHosts: config.nextcloud.allowedHosts, baseFolder: config.nextcloud.baseFolder },
    });
  });

  r.get('/users', (_req, res) => {
    res.json(db.prepare(`
      SELECT u.id, u.email, u.name, u.is_admin AS isAdmin, u.created_at AS createdAt,
        (SELECT COUNT(*) FROM board_members m WHERE m.user_id = u.id) AS boards,
        (SELECT MAX(created_at) FROM sessions s WHERE s.user_id = u.id) AS lastLogin,
        EXISTS (SELECT 1 FROM nextcloud_accounts n WHERE n.user_id = u.id) AS nextcloud
      FROM users u WHERE u.is_guest = 0 ORDER BY u.name COLLATE NOCASE`).all()
      .map((u) => ({ ...u, isAdmin: !!u.isAdmin, nextcloud: !!u.nextcloud })));
  });

  r.patch('/users/:id', (req, res) => {
    const u = find(req.params.id);
    if (req.body.isAdmin === undefined) throw bad('Nichts zu ändern.');
    const make = !!req.body.isAdmin;
    if (!make && u.is_admin && adminCount() === 1) throw bad('Es muss mindestens eine Person in der Administration bleiben.');
    db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(make ? 1 : 0, u.id);
    res.json({ ok: true });
  });

  // Link zum Setzen eines neuen Passworts (24 h gültig); optional per E-Mail
  r.post('/users/:id/reset-link', async (req, res) => {
    const u = find(req.params.id);
    res.json(await users.createResetLink(req, u, { hours: 24, byAdmin: true, send: !!req.body.send }));
  });

  r.delete('/users/:id', async (req, res) => {
    const u = find(req.params.id);
    if (u.id === req.user.id) throw bad('Das eigene Konto bitte unter „Konto“ löschen.');
    if (u.is_admin && adminCount() === 1) throw bad('Die letzte Person in der Administration kann nicht gelöscht werden.');
    await users.deleteUser(u.id, { self: false });
    res.json({ ok: true });
  });

  r.post('/test-mail', async (req, res) => {
    if (!mailer.enabled) throw bad('Der E-Mail-Versand ist nicht eingerichtet (SMTP_HOST in der .env fehlt).');
    try {
      await mailer.send({ to: req.user.email, ...testMail({ appName: config.appName, name: req.user.name }) });
    } catch (err) {
      throw new HttpError(502, `Versand fehlgeschlagen: ${err.message}`);
    }
    res.json({ ok: true, to: req.user.email });
  });

  return r;
}
