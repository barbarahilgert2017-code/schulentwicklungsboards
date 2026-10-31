import { Router } from 'express';
import { requireUser } from '../auth.js';
import { HttpError, bad, text, color, bool, int, updateFields } from '../http.js';
import { getTemplate, templateSummaries } from '../templates.js';
import { tx } from '../db.js';
import { NextcloudError, cleanPath, joinPath, safeName, isInside } from '../nextcloud.js';
import { entryJson } from '../nc-service.js';

const ROLES = ['owner', 'editor', 'viewer'];

export default function boardRoutes({ db, config, nc, svc, access }) {
  const r = Router();
  r.use(requireUser);

  r.get('/templates', (_req, res) => res.json(templateSummaries()));

  // ---------------- Boards ----------------

  r.get('/boards', (req, res) => {
    const rows = db.prepare(`
      SELECT b.*, m.role, u.name AS folder_owner_name,
        (SELECT COUNT(*) FROM cards c WHERE c.board_id = b.id AND c.archived = 0) AS card_count,
        (SELECT COUNT(*) FROM cards c WHERE c.board_id = b.id AND c.archived = 0 AND c.completed = 1) AS done_count,
        (SELECT COUNT(*) FROM cards c WHERE c.board_id = b.id AND c.archived = 0 AND c.completed = 0
            AND c.due_date IS NOT NULL AND c.due_date < date('now')) AS overdue_count,
        (SELECT COUNT(*) FROM board_members bm WHERE bm.board_id = b.id) AS member_count
      FROM boards b JOIN board_members m ON m.board_id = b.id AND m.user_id = ?
      LEFT JOIN users u ON u.id = b.nc_folder_user_id
      ORDER BY b.archived, b.updated_at DESC`).all(req.user.id);
    res.json(rows.map((b) => ({
      ...svc.boardJson(b, b.role),
      stats: { cards: b.card_count, done: b.done_count, overdue: b.overdue_count, members: b.member_count },
    })));
  });

  r.post('/boards', async (req, res) => {
    const title = text(req.body.title, { name: 'Titel', required: true, max: 120 });
    const description = text(req.body.description, { name: 'Beschreibung', max: 2000 }) || '';
    const template = req.body.templateKey ? getTemplate(String(req.body.templateKey)) : null;
    if (req.body.templateKey && !template) throw bad('Unbekannte Vorlage.');
    const boardId = svc.createBoard(req.user.id, { title, description, color: color(req.body.color), template });

    let folderError = null;
    if (req.body.createFolder) {
      try {
        await createBoardFolder(boardId, req.user.id, title, template?.folders || []);
      } catch (err) {
        folderError = err.message;
      }
    }
    res.status(201).json({ id: boardId, folderError });
  });

  r.get('/boards/:id', (req, res) => {
    const { boardId, role } = access.board(req.user, req.params.id);
    res.json(svc.fullBoard(boardId, role));
  });

  r.patch('/boards/:id', (req, res) => {
    const { boardId } = access.board(req.user, req.params.id, 'editor');
    const archived = bool(req.body.archived);
    if (archived !== undefined) access.board(req.user, boardId, 'owner');
    updateFields(db, 'boards', boardId, {
      title: text(req.body.title, { name: 'Titel', max: 120 }) || undefined,
      description: text(req.body.description, { name: 'Beschreibung', max: 2000 }),
      color: color(req.body.color),
      archived,
    }, { touch: true });
    res.json({ ok: true });
  });

  r.delete('/boards/:id', (req, res) => {
    const { boardId } = access.board(req.user, req.params.id, 'owner');
    db.prepare('DELETE FROM boards WHERE id = ?').run(boardId);
    res.json({ ok: true });
  });

  r.get('/boards/:id/activity', (req, res) => {
    const { boardId } = access.board(req.user, req.params.id);
    res.json(svc.activities('a.board_id = ?', boardId, Math.min(Number(req.query.limit) || 100, 500)));
  });

  r.get('/boards/:id/archive', (req, res) => {
    const { boardId } = access.board(req.user, req.params.id);
    res.json({
      lists: db.prepare('SELECT id, title FROM lists WHERE board_id = ? AND archived = 1 ORDER BY id DESC').all(boardId),
      cards: svc.cardSummaries('c.board_id = ? AND (c.archived = 1 OR c.list_id IN (SELECT id FROM lists WHERE board_id = ? AND archived = 1))', boardId, boardId),
    });
  });

  /** Vollständiger JSON-Export (Datenportabilität, Archivierung). */
  r.get('/boards/:id/export', (req, res) => {
    const { boardId, role } = access.board(req.user, req.params.id);
    const data = svc.fullBoard(boardId, role);
    const cardIds = db.prepare('SELECT id FROM cards WHERE board_id = ?').all(boardId).map((c) => c.id);
    const out = {
      exportedAt: new Date().toISOString(),
      app: config.appName,
      board: data.board,
      members: data.members.map(({ name, role: rl }) => ({ name, role: rl })),
      labels: data.labels,
      lists: db.prepare('SELECT id, title, archived FROM lists WHERE board_id = ? ORDER BY position').all(boardId),
      cards: cardIds.map((id) => {
        const c = svc.fullCard(id);
        delete c.activity;
        return c;
      }),
    };
    const fname = `${safeName(data.board.title, 'board').replace(/\s+/g, '_')}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fname)}"`);
    res.json(out);
  });

  // ---------------- Mitglieder ----------------

  r.post('/boards/:id/members', (req, res) => {
    const { boardId } = access.board(req.user, req.params.id, 'owner');
    const email = text(req.body.email, { name: 'E-Mail', required: true, max: 200 }).toLowerCase();
    const role = ROLES.includes(req.body.role) ? req.body.role : 'editor';
    const u = db.prepare('SELECT id, name FROM users WHERE email = ?').get(email);
    if (!u) throw new HttpError(404, 'Unter dieser E-Mail ist noch niemand registriert. Bitte die Person bitten, sich zuerst zu registrieren.');
    const exists = db.prepare('SELECT 1 FROM board_members WHERE board_id = ? AND user_id = ?').get(boardId, u.id);
    if (exists) throw new HttpError(409, `${u.name} ist bereits Mitglied.`);
    db.prepare('INSERT INTO board_members (board_id, user_id, role) VALUES (?, ?, ?)').run(boardId, u.id, role);
    svc.log(boardId, null, req.user.id, 'member.added', { name: u.name, role });
    res.status(201).json({ ok: true });
  });

  const ownerCount = (boardId) => db.prepare("SELECT COUNT(*) n FROM board_members WHERE board_id = ? AND role = 'owner'").get(boardId).n;

  r.patch('/boards/:id/members/:userId', (req, res) => {
    const { boardId } = access.board(req.user, req.params.id, 'owner');
    const userId = int(req.params.userId);
    if (!ROLES.includes(req.body.role)) throw bad('Unbekannte Rolle.');
    const m = db.prepare('SELECT role FROM board_members WHERE board_id = ? AND user_id = ?').get(boardId, userId);
    if (!m) throw new HttpError(404, 'Mitglied nicht gefunden.');
    if (m.role === 'owner' && req.body.role !== 'owner' && ownerCount(boardId) === 1) throw bad('Ein Board braucht mindestens eine verantwortliche Person.');
    db.prepare('UPDATE board_members SET role = ? WHERE board_id = ? AND user_id = ?').run(req.body.role, boardId, userId);
    res.json({ ok: true });
  });

  r.delete('/boards/:id/members/:userId', (req, res) => {
    const userId = int(req.params.userId);
    // Selbst austreten darf jede Person, andere entfernen nur Verantwortliche.
    const { boardId } = access.board(req.user, req.params.id, userId === req.user.id ? 'viewer' : 'owner');
    const m = db.prepare('SELECT m.role, u.name FROM board_members m JOIN users u ON u.id = m.user_id WHERE board_id = ? AND user_id = ?').get(boardId, userId);
    if (!m) throw new HttpError(404, 'Mitglied nicht gefunden.');
    if (m.role === 'owner' && ownerCount(boardId) === 1) throw bad('Die letzte verantwortliche Person kann nicht entfernt werden.');
    tx(db, () => {
      db.prepare('DELETE FROM board_members WHERE board_id = ? AND user_id = ?').run(boardId, userId);
      db.prepare('DELETE FROM card_members WHERE user_id = ? AND card_id IN (SELECT id FROM cards WHERE board_id = ?)').run(userId, boardId);
      db.prepare(`UPDATE checklist_items SET assignee_id = NULL WHERE assignee_id = ? AND checklist_id IN
                  (SELECT cl.id FROM checklists cl JOIN cards c ON c.id = cl.card_id WHERE c.board_id = ?)`).run(userId, boardId);
      svc.log(boardId, null, req.user.id, 'member.removed', { name: m.name });
    });
    res.json({ ok: true });
  });

  // ---------------- Labels ----------------

  r.post('/boards/:id/labels', (req, res) => {
    const { boardId } = access.board(req.user, req.params.id, 'editor');
    const name = text(req.body.name, { name: 'Name', required: true, max: 40 });
    const { lastInsertRowid } = db.prepare('INSERT INTO labels (board_id, name, color) VALUES (?, ?, ?)')
      .run(boardId, name, color(req.body.color) || '#5d6d7e');
    res.status(201).json({ id: Number(lastInsertRowid) });
  });

  r.patch('/labels/:id', (req, res) => {
    access.via('label', req.user, req.params.id, 'editor');
    updateFields(db, 'labels', int(req.params.id), {
      name: text(req.body.name, { name: 'Name', max: 40 }) || undefined,
      color: color(req.body.color),
    });
    res.json({ ok: true });
  });

  r.delete('/labels/:id', (req, res) => {
    access.via('label', req.user, req.params.id, 'editor');
    db.prepare('DELETE FROM labels WHERE id = ?').run(int(req.params.id));
    res.json({ ok: true });
  });

  // ---------------- Listen ----------------

  r.post('/boards/:id/lists', (req, res) => {
    const { boardId } = access.board(req.user, req.params.id, 'editor');
    const id = svc.createList(boardId, text(req.body.title, { name: 'Titel', required: true, max: 120 }));
    svc.touchBoard(boardId);
    res.status(201).json({ id });
  });

  r.patch('/lists/:id', (req, res) => {
    const { boardId } = access.via('list', req.user, req.params.id, 'editor');
    const id = int(req.params.id);
    const archived = bool(req.body.archived);
    updateFields(db, 'lists', id, { title: text(req.body.title, { name: 'Titel', max: 120 }) || undefined, archived });
    if (archived === 0) svc.place('lists', 'board_id', boardId, id, undefined);
    svc.touchBoard(boardId);
    res.json({ ok: true });
  });

  r.post('/lists/:id/move', (req, res) => {
    const { boardId } = access.via('list', req.user, req.params.id, 'editor');
    tx(db, () => svc.place('lists', 'board_id', boardId, int(req.params.id), int(req.body.index, 'Index')));
    res.json({ ok: true });
  });

  r.delete('/lists/:id', (req, res) => {
    const { boardId } = access.via('list', req.user, req.params.id, 'editor');
    db.prepare('DELETE FROM lists WHERE id = ?').run(int(req.params.id));
    svc.touchBoard(boardId);
    res.json({ ok: true });
  });

  // ---------------- Board-Ordner in Nextcloud ----------------

  async function createBoardFolder(boardId, userId, title, subfolders = []) {
    const client = nc.clientFor(userId);
    const base = cleanPath(config.nextcloud.baseFolder);
    await client.ensureFolder(base);
    const name = await client.freeName(base, safeName(title, 'Board'));
    const folder = await client.ensureFolder(joinPath(base, name));
    for (const sub of subfolders) await client.mkcol(joinPath(folder.path, safeName(sub)));
    linkFolder(boardId, userId, folder);
    return folder;
  }

  function linkFolder(boardId, userId, entry) {
    db.prepare("UPDATE boards SET nc_folder_user_id = ?, nc_folder_path = ?, nc_folder_file_id = ?, updated_at = datetime('now') WHERE id = ?")
      .run(userId, entry.path, entry.fileId || null, boardId);
  }

  const folderClient = (boardId) => nc.folderClient(boardId);

  // Ordner verknüpfen: { path } = vorhandener Ordner der eigenen Nextcloud, { create: true } = neuen anlegen
  r.put('/boards/:id/folder', async (req, res) => {
    const { boardId } = access.board(req.user, req.params.id, 'owner');
    const b = svc.boardRow(boardId);
    let entry;
    if (req.body.create) {
      const template = getTemplate(b.template_key);
      entry = await createBoardFolder(boardId, req.user.id, b.title, template?.folders || []);
    } else {
      const client = nc.clientFor(req.user.id);
      entry = await client.stat(cleanPath(text(req.body.path, { name: 'Pfad', required: true, max: 1000 })));
      if (!entry?.isDir) throw bad('Bitte einen Ordner auswählen.');
      if (entry.path === '/') throw bad('Bitte nicht das gesamte Nextcloud-Verzeichnis verknüpfen, sondern einen Unterordner.');
      linkFolder(boardId, req.user.id, entry);
    }
    svc.log(boardId, null, req.user.id, 'folder.linked', { path: entry.path });
    res.json({ path: entry.path, fileId: entry.fileId });
  });

  r.delete('/boards/:id/folder', (req, res) => {
    const { boardId } = access.board(req.user, req.params.id, 'owner');
    db.prepare('UPDATE boards SET nc_folder_user_id = NULL, nc_folder_path = NULL, nc_folder_file_id = NULL WHERE id = ?').run(boardId);
    res.json({ ok: true });
  });

  r.get('/boards/:id/folder/files', async (req, res) => {
    const { boardId } = access.board(req.user, req.params.id);
    const { client, root } = folderClient(boardId);
    const path = req.query.path ? cleanPath(req.query.path) : root;
    if (!isInside(root, path)) throw new HttpError(403, 'Außerhalb des Board-Ordners.');
    const { self, entries } = await client.list(path);
    res.json({
      root, path,
      rootLink: client.fileLink(self?.fileId),
      self: self && entryJson(client, self),
      entries: entries.map((e) => entryJson(client, e)),
    });
  });

  r.post('/boards/:id/folder/folders', async (req, res) => {
    const { boardId } = access.board(req.user, req.params.id, 'editor');
    const { client, root } = folderClient(boardId);
    const parent = req.body.parent ? cleanPath(req.body.parent) : root;
    if (!isInside(root, parent)) throw new HttpError(403, 'Außerhalb des Board-Ordners.');
    const entry = await client.ensureFolder(joinPath(parent, safeName(text(req.body.name, { name: 'Ordnername', required: true, max: 180 }))));
    res.status(201).json(entryJson(client, entry));
  });

  /** Teilt den Board-Ordner in Nextcloud mit allen Mitgliedern, die dieselbe Nextcloud verbunden haben. */
  r.post('/boards/:id/folder/share', async (req, res) => {
    const { boardId } = access.board(req.user, req.params.id, 'owner');
    const { client, root, ownerId } = folderClient(boardId);
    const owner = nc.account(ownerId);
    const rows = db.prepare(`SELECT u.name, m.role, n.nc_user_id, n.server_url FROM board_members m
                             JOIN users u ON u.id = m.user_id LEFT JOIN nextcloud_accounts n ON n.user_id = m.user_id
                             WHERE m.board_id = ? AND m.user_id != ?`).all(boardId, ownerId);
    const results = [];
    for (const m of rows) {
      if (!m.nc_user_id) { results.push({ name: m.name, status: 'skipped', message: 'keine Nextcloud verbunden' }); continue; }
      if (m.server_url !== owner.server_url) { results.push({ name: m.name, status: 'skipped', message: 'andere Nextcloud' }); continue; }
      if (m.nc_user_id === owner.nc_user_id) { results.push({ name: m.name, status: 'skipped', message: 'gleiches Nextcloud-Konto' }); continue; }
      const perms = m.role === 'viewer' ? 1 : 31;
      const out = await client.shareWithUser(root, m.nc_user_id, perms);
      results.push({ name: m.name, status: out.ok ? (out.already ? 'already' : 'shared') : 'error', message: out.message });
    }
    res.json({ results });
  });

  r.use((err, _req, _res, next) => next(err instanceof NextcloudError ? new HttpError(err.status, err.message) : err));

  return r;
}
