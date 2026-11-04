import { Router } from 'express';
import crypto from 'node:crypto';
import {
  normalizeServerUrl, assertServerAllowed, startLoginFlow, pollLoginFlow, NextcloudClient, NextcloudError, cleanPath, joinPath, safeName,
} from '../nextcloud.js';
import { requireUser, noGuest } from '../auth.js';
import { HttpError, text } from '../http.js';
import { entryJson } from '../nc-service.js';

export default function nextcloudRoutes({ db, config, box, nc }) {
  const r = Router();
  r.use(requireUser, noGuest);
  const ncCfg = config.nextcloud;

  // ---- Login Flow v2 starten ----
  r.post('/login/start', async (req, res) => {
    const input = req.body.server || ncCfg.defaultUrl;
    const serverUrl = normalizeServerUrl(input, ncCfg);
    await assertServerAllowed(serverUrl, ncCfg);
    const flow = await startLoginFlow(serverUrl, ncCfg.userAgent);
    const id = crypto.randomUUID();
    db.prepare('DELETE FROM nextcloud_login_flows WHERE user_id = ?').run(req.user.id);
    db.prepare('INSERT INTO nextcloud_login_flows (id, user_id, server_url, poll_endpoint, poll_token_enc) VALUES (?, ?, ?, ?, ?)')
      .run(id, req.user.id, serverUrl, flow.pollEndpoint, box.encrypt(flow.pollToken));
    res.json({ flowId: id, loginUrl: flow.loginUrl, server: serverUrl });
  });

  // ---- Login Flow abfragen (vom Browser alle paar Sekunden aufgerufen) ----
  r.post('/login/poll', async (req, res) => {
    const flow = db.prepare("SELECT *, created_at < datetime('now', '-20 minutes') AS expired FROM nextcloud_login_flows WHERE id = ? AND user_id = ?")
      .get(String(req.body.flowId || ''), req.user.id);
    if (!flow || flow.expired) {
      if (flow) db.prepare('DELETE FROM nextcloud_login_flows WHERE id = ?').run(flow.id);
      return res.json({ status: 'expired' });
    }
    const result = await pollLoginFlow(flow.poll_endpoint, box.decrypt(flow.poll_token_enc), ncCfg.userAgent);
    if (!result) return res.json({ status: 'pending' });

    // Benutzer-ID ermitteln (kann vom Loginnamen abweichen, z. B. bei Anmeldung per E-Mail)
    const client = new NextcloudClient({
      serverUrl: flow.server_url, loginName: result.loginName, appPassword: result.appPassword, userAgent: ncCfg.userAgent,
    });
    let me = { id: result.loginName, displayName: result.loginName };
    try { me = await client.currentUser(); } catch { /* Fallback auf Loginnamen */ }

    // Altes App-Passwort widerrufen, falls bereits verbunden
    const old = nc.clientFor(req.user.id, { required: false });
    if (old) old.revokeAppPassword().catch(() => {});

    db.prepare(`INSERT INTO nextcloud_accounts (user_id, server_url, login_name, nc_user_id, display_name, app_password_enc)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET server_url = excluded.server_url, login_name = excluded.login_name,
                  nc_user_id = excluded.nc_user_id, display_name = excluded.display_name,
                  app_password_enc = excluded.app_password_enc, connected_at = datetime('now')`)
      .run(req.user.id, flow.server_url, result.loginName, me.id || result.loginName, me.displayName || null, box.encrypt(result.appPassword));
    db.prepare('DELETE FROM nextcloud_login_flows WHERE id = ?').run(flow.id);
    res.json({ status: 'connected', server: flow.server_url, loginName: result.loginName, userId: me.id, displayName: me.displayName });
  });

  // ---- Verbindung trennen (App-Passwort in Nextcloud widerrufen) ----
  r.delete('/connection', async (req, res) => {
    const client = nc.clientFor(req.user.id, { required: false });
    let revoked = false;
    if (client) revoked = await client.revokeAppPassword().catch(() => false);
    db.prepare('DELETE FROM nextcloud_accounts WHERE user_id = ?').run(req.user.id);
    res.json({ ok: true, revoked });
  });

  // ---- Eigene Dateien durchsuchen (Dateiauswahl) ----
  r.get('/files', async (req, res) => {
    const client = nc.clientFor(req.user.id);
    const path = cleanPath(req.query.path || '/');
    const { self, entries } = await client.list(path);
    res.json({ path, self: self && entryJson(client, self), entries: entries.map((e) => entryJson(client, e)) });
  });

  // ---- Ordner in eigener Nextcloud anlegen ----
  r.post('/folders', async (req, res) => {
    const client = nc.clientFor(req.user.id);
    const parent = cleanPath(req.body.parent || '/');
    const name = safeName(text(req.body.name, { name: 'Ordnername', required: true, max: 180 }));
    const entry = await client.ensureFolder(joinPath(parent, name));
    if (!entry) throw new NextcloudError('Ordner konnte nicht angelegt werden.');
    res.status(201).json(entryJson(client, entry));
  });

  r.use((err, _req, _res, next) => next(err instanceof NextcloudError ? new HttpError(err.status, err.message) : err));
  return r;
}
