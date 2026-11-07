import { Router } from 'express';
import { Readable } from 'node:stream';
import { requireUser } from '../auth.js';
import { HttpError, bad, text, date, time, int, bool, updateFields } from '../http.js';
import { tx } from '../db.js';
import { NextcloudError, cleanPath, joinPath, safeName, isInside } from '../nextcloud.js';

export default function cardRoutes({ db, config, nc, svc, access }) {
  const r = Router();
  r.use(requireUser);

  const cardRow = (id) => db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
  const isMember = (boardId, userId) => !!db.prepare('SELECT 1 FROM board_members WHERE board_id = ? AND user_id = ?').get(boardId, userId);

  // ---------------- Karten ----------------

  r.post('/lists/:id/cards', (req, res) => {
    const { boardId } = access.via('list', req.user, req.params.id, 'editor');
    const listId = int(req.params.id);
    const title = text(req.body.title, { name: 'Titel', required: true, max: 300 });
    const id = svc.createCard(boardId, listId, req.user.id, { title });
    const list = db.prepare('SELECT title FROM lists WHERE id = ?').get(listId);
    svc.log(boardId, id, req.user.id, 'card.created', { list: list.title });
    svc.touchBoard(boardId);
    res.status(201).json(svc.cardSummaries('c.id = ?', id)[0]);
  });

  /** Verknüpfte Karten – nur aus Boards, in denen die Person Mitglied ist. */
  function linkedCards(cardId, userId) {
    return db.prepare(`
      SELECT c.id, c.title, c.board_id AS boardId, b.title AS boardTitle, b.color AS boardColor, l.title AS listTitle,
             c.completed, c.archived, c.is_template AS isTemplate, c.due_date AS dueDate, c.due_time AS dueTime
      FROM card_links k
      JOIN cards c ON c.id = CASE WHEN k.card_a = ? THEN k.card_b ELSE k.card_a END
      JOIN boards b ON b.id = c.board_id JOIN lists l ON l.id = c.list_id
      JOIN board_members m ON m.board_id = c.board_id AND m.user_id = ?
      WHERE k.card_a = ? OR k.card_b = ?
      ORDER BY b.title, c.title`).all(cardId, userId, cardId, cardId)
      .map((x) => ({ ...x, completed: !!x.completed, archived: !!x.archived, isTemplate: !!x.isTemplate }));
  }

  r.get('/cards/:id', (req, res) => {
    const { role } = access.via('card', req.user, req.params.id);
    const id = int(req.params.id);
    res.json({ ...svc.fullCard(id), role, linkedCards: linkedCards(id, req.user.id) });
  });

  // ---- Verknüpfungen ----
  r.post('/cards/:id/links', (req, res) => {
    const { boardId } = access.via('card', req.user, req.params.id, 'editor');
    const id = int(req.params.id);
    const targetId = int(req.body.cardId, 'Karte');
    if (targetId === id) throw bad('Eine Karte kann nicht mit sich selbst verknüpft werden.');
    const target = access.via('card', req.user, targetId); // Zielboard muss sichtbar sein
    const [a, b] = id < targetId ? [id, targetId] : [targetId, id];
    const added = db.prepare('INSERT OR IGNORE INTO card_links (card_a, card_b, created_by) VALUES (?, ?, ?)').run(a, b, req.user.id).changes;
    if (added) {
      const t = cardRow(targetId);
      const src = cardRow(id);
      svc.log(boardId, id, req.user.id, 'card.linked', { title: t.title });
      svc.log(target.boardId, targetId, req.user.id, 'card.linked', { title: src.title });
    }
    res.status(added ? 201 : 200).json({ linkedCards: linkedCards(id, req.user.id) });
  });

  r.delete('/cards/:id/links/:targetId', (req, res) => {
    const { boardId } = access.via('card', req.user, req.params.id, 'editor');
    const id = int(req.params.id);
    const targetId = int(req.params.targetId);
    const [a, b] = id < targetId ? [id, targetId] : [targetId, id];
    if (db.prepare('DELETE FROM card_links WHERE card_a = ? AND card_b = ?').run(a, b).changes) {
      svc.log(boardId, id, req.user.id, 'card.unlinked', { title: cardRow(targetId)?.title });
    }
    res.json({ linkedCards: linkedCards(id, req.user.id) });
  });

  // Karten zum Verknüpfen suchen – in allen Boards der Person
  r.get('/cards/:id/link-candidates', (req, res) => {
    const { boardId } = access.via('card', req.user, req.params.id, 'editor');
    const id = int(req.params.id);
    const q = String(req.query.q || '').trim().toLowerCase().slice(0, 100);
    const rows = db.prepare(`
      SELECT c.id, c.title, c.board_id AS boardId, b.title AS boardTitle, b.color AS boardColor, l.title AS listTitle, c.completed
      FROM cards c JOIN boards b ON b.id = c.board_id JOIN lists l ON l.id = c.list_id
      JOIN board_members m ON m.board_id = c.board_id AND m.user_id = ?
      WHERE c.id != ? AND c.archived = 0 AND l.archived = 0 AND b.archived = 0
        AND (? = '' OR lower(c.title) LIKE ? ESCAPE '\\')
        AND NOT EXISTS (SELECT 1 FROM card_links k WHERE (k.card_a = c.id AND k.card_b = ?) OR (k.card_b = c.id AND k.card_a = ?))
      ORDER BY (c.board_id = ?) DESC, c.updated_at DESC
      LIMIT 30`).all(req.user.id, id, q, `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`, id, id, boardId);
    res.json(rows.map((x) => ({ ...x, completed: !!x.completed, sameBoard: x.boardId === boardId })));
  });

  r.patch('/cards/:id', (req, res) => {
    const { boardId } = access.via('card', req.user, req.params.id, 'editor');
    const id = int(req.params.id);
    const before = cardRow(id);
    const fields = {
      title: text(req.body.title, { name: 'Titel', max: 300 }) || undefined,
      description: text(req.body.description, { name: 'Beschreibung', max: 20000, trim: false }),
      start_date: date(req.body.startDate, 'Startdatum'),
      due_date: date(req.body.dueDate, 'Fälligkeitsdatum'),
      start_time: time(req.body.startTime, 'Startzeit'),
      due_time: time(req.body.dueTime, 'Uhrzeit'),
      is_template: bool(req.body.isTemplate),
      cover_attachment_id: req.body.coverAttachmentId === undefined ? undefined
        : req.body.coverAttachmentId === null ? null : int(req.body.coverAttachmentId, 'Titelbild'),
      completed: bool(req.body.completed),
      archived: bool(req.body.archived),
    };
    // Ohne Datum keine Uhrzeit
    if (fields.cover_attachment_id) {
      const a = db.prepare('SELECT card_id, kind, mime, name FROM attachments WHERE id = ?').get(fields.cover_attachment_id);
      if (!a || a.card_id !== id || a.kind !== 'nextcloud' || !isImage(a.mime, a.name)) throw bad('Als Titelbild eignen sich nur Bilder, die an dieser Karte hängen.');
    }
    // Datum entfernen löscht die Uhrzeit (außer bei Vorlagen: dort zählt nur die Uhrzeit)
    const isTpl = (fields.is_template ?? before.is_template) === 1;
    if (fields.start_date === null && !isTpl) fields.start_time = null;
    if (fields.due_date === null && !isTpl) fields.due_time = null;
    const template = fields.is_template ?? before.is_template;
    if (fields.start_time && !template && !(fields.start_date ?? before.start_date)) throw bad('Bitte zuerst ein Startdatum wählen.');
    if (fields.due_time && !template && !(fields.due_date ?? before.due_date)) throw bad('Bitte zuerst ein Fälligkeitsdatum wählen.');
    tx(db, () => {
      updateFields(db, 'cards', id, fields, { touch: true });
      if (fields.is_template !== undefined && fields.is_template !== before.is_template) {
        svc.log(boardId, id, req.user.id, fields.is_template ? 'card.template' : 'card.untemplate');
      }
      if (fields.archived === 0 && before.archived) {
        // Wiederherstellen: Liste muss aktiv sein, sonst in erste aktive Liste verschieben
        const list = db.prepare('SELECT archived FROM lists WHERE id = ?').get(before.list_id);
        let listId = before.list_id;
        if (list.archived) {
          const first = db.prepare('SELECT id FROM lists WHERE board_id = ? AND archived = 0 ORDER BY position LIMIT 1').get(boardId);
          if (!first) throw bad('Keine aktive Liste vorhanden, in die die Karte zurückgelegt werden kann.');
          listId = first.id;
          db.prepare('UPDATE cards SET list_id = ? WHERE id = ?').run(listId, id);
        }
        svc.place('cards', 'list_id', listId, id, undefined);
      }
      if (fields.completed !== undefined && fields.completed !== before.completed) {
        svc.log(boardId, id, req.user.id, fields.completed ? 'card.completed' : 'card.reopened');
      }
      if (fields.archived !== undefined && fields.archived !== before.archived) {
        svc.log(boardId, id, req.user.id, fields.archived ? 'card.archived' : 'card.restored');
      }
      const dueChanged = (fields.due_date !== undefined && fields.due_date !== before.due_date)
        || (fields.due_time !== undefined && fields.due_time !== before.due_time);
      if (dueChanged) {
        const after = db.prepare('SELECT due_date, due_time FROM cards WHERE id = ?').get(id);
        svc.log(boardId, id, req.user.id, 'card.due', { due: after.due_date, time: after.due_time });
      }
      if (fields.title && fields.title !== before.title) {
        svc.log(boardId, id, req.user.id, 'card.renamed', { from: before.title, to: fields.title });
      }
      svc.touchBoard(boardId);
    });
    res.json(svc.cardSummaries('c.id = ?', id)[0]);
  });

  // Karte kopieren – auch „neue Karte aus Vorlagenkarte“
  r.post('/cards/:id/copy', (req, res) => {
    const { boardId } = access.via('card', req.user, req.params.id, 'editor');
    const src = cardRow(int(req.params.id));
    const listId = req.body.listId === undefined ? src.list_id : int(req.body.listId, 'Liste');
    const target = db.prepare('SELECT board_id, title FROM lists WHERE id = ?').get(listId);
    if (!target || target.board_id !== boardId) throw bad('Zielliste gehört nicht zu diesem Board.');
    const title = text(req.body.title, { name: 'Titel', max: 300 }) || undefined;
    const dueDate = date(req.body.dueDate, 'Fälligkeitsdatum');
    const dueTime = time(req.body.dueTime, 'Uhrzeit');
    const id = tx(db, () => {
      const newId = svc.copyCard(src.id, listId, req.user.id, { title, index: req.body.index === undefined ? undefined : int(req.body.index, 'Index') });
      svc.log(boardId, newId, req.user.id, 'card.created', { list: target.title, [src.is_template ? 'fromTemplate' : 'copyOf']: src.title });
      if (dueDate) {
        // Termin direkt setzen; ohne eigene Uhrzeit gilt die der Vorlage
        const t = dueTime === undefined ? src.due_time : dueTime;
        db.prepare('UPDATE cards SET due_date = ?, due_time = ? WHERE id = ?').run(dueDate, t, newId);
        svc.log(boardId, newId, req.user.id, 'card.due', { due: dueDate, time: t });
      }
      svc.touchBoard(boardId);
      return newId;
    });
    res.status(201).json(svc.cardSummaries('c.id = ?', id)[0]);
  });

  r.post('/cards/:id/move', (req, res) => {
    const { boardId } = access.via('card', req.user, req.params.id, 'editor');
    const id = int(req.params.id);
    const listId = int(req.body.listId, 'Liste');
    const target = db.prepare('SELECT id, title, board_id FROM lists WHERE id = ?').get(listId);
    if (!target || target.board_id !== boardId) throw bad('Zielliste gehört nicht zu diesem Board.');
    const before = cardRow(id);
    tx(db, () => {
      db.prepare("UPDATE cards SET list_id = ?, updated_at = datetime('now') WHERE id = ?").run(listId, id);
      svc.place('cards', 'list_id', listId, id, req.body.index === undefined ? undefined : int(req.body.index, 'Index'));
      if (before.list_id !== listId) {
        const from = db.prepare('SELECT title FROM lists WHERE id = ?').get(before.list_id);
        svc.log(boardId, id, req.user.id, 'card.moved', { from: from?.title, to: target.title });
      }
      svc.touchBoard(boardId);
    });
    res.json({ ok: true });
  });

  r.delete('/cards/:id', (req, res) => {
    const { boardId } = access.via('card', req.user, req.params.id, 'editor');
    const c = cardRow(int(req.params.id));
    db.prepare('DELETE FROM cards WHERE id = ?').run(c.id);
    svc.log(boardId, null, req.user.id, 'card.deleted', { title: c.title });
    res.json({ ok: true });
  });

  r.put('/cards/:id/labels/:labelId', (req, res) => {
    const { boardId } = access.via('card', req.user, req.params.id, 'editor');
    const label = db.prepare('SELECT board_id FROM labels WHERE id = ?').get(int(req.params.labelId));
    if (!label || label.board_id !== boardId) throw bad('Label gehört nicht zu diesem Board.');
    db.prepare('INSERT OR IGNORE INTO card_labels (card_id, label_id) VALUES (?, ?)').run(int(req.params.id), int(req.params.labelId));
    res.json({ ok: true });
  });

  r.delete('/cards/:id/labels/:labelId', (req, res) => {
    access.via('card', req.user, req.params.id, 'editor');
    db.prepare('DELETE FROM card_labels WHERE card_id = ? AND label_id = ?').run(int(req.params.id), int(req.params.labelId));
    res.json({ ok: true });
  });

  r.put('/cards/:id/members/:userId', (req, res) => {
    const { boardId } = access.via('card', req.user, req.params.id, 'editor');
    const userId = int(req.params.userId);
    if (!isMember(boardId, userId)) throw bad('Die Person ist kein Mitglied dieses Boards.');
    const added = db.prepare('INSERT OR IGNORE INTO card_members (card_id, user_id) VALUES (?, ?)').run(int(req.params.id), userId).changes;
    if (added) {
      const u = db.prepare('SELECT name FROM users WHERE id = ?').get(userId);
      svc.log(boardId, int(req.params.id), req.user.id, 'card.member', { name: u.name });
    }
    res.json({ ok: true });
  });

  r.delete('/cards/:id/members/:userId', (req, res) => {
    access.via('card', req.user, req.params.id, 'editor');
    db.prepare('DELETE FROM card_members WHERE card_id = ? AND user_id = ?').run(int(req.params.id), int(req.params.userId));
    res.json({ ok: true });
  });

  // ---------------- Checklisten ----------------

  r.post('/cards/:id/checklists', (req, res) => {
    const { boardId } = access.via('card', req.user, req.params.id, 'editor');
    const title = text(req.body.title, { name: 'Titel', max: 200 }) || 'Checkliste';
    const items = Array.isArray(req.body.items) ? req.body.items.map((t) => text(t, { name: 'Punkt', max: 500, required: true })) : [];
    const id = tx(db, () => svc.createChecklist(int(req.params.id), title, items));
    svc.log(boardId, int(req.params.id), req.user.id, 'checklist.added', { title });
    res.status(201).json({ id });
  });

  r.patch('/checklists/:id', (req, res) => {
    access.via('checklist', req.user, req.params.id, 'editor');
    updateFields(db, 'checklists', int(req.params.id), { title: text(req.body.title, { name: 'Titel', max: 200 }) || undefined });
    res.json({ ok: true });
  });

  r.delete('/checklists/:id', (req, res) => {
    access.via('checklist', req.user, req.params.id, 'editor');
    db.prepare('DELETE FROM checklists WHERE id = ?').run(int(req.params.id));
    res.json({ ok: true });
  });

  r.post('/checklists/:id/items', (req, res) => {
    access.via('checklist', req.user, req.params.id, 'editor');
    const clId = int(req.params.id);
    const { lastInsertRowid } = db.prepare('INSERT INTO checklist_items (checklist_id, text, position) VALUES (?, ?, ?)')
      .run(clId, text(req.body.text, { name: 'Text', required: true, max: 500 }), svc.nextPosition('checklist_items', 'checklist_id', clId));
    res.status(201).json({ id: Number(lastInsertRowid) });
  });

  r.patch('/checklist-items/:id', (req, res) => {
    const { boardId } = access.via('item', req.user, req.params.id, 'editor');
    const id = int(req.params.id);
    let assignee;
    if (req.body.assigneeId !== undefined) {
      assignee = req.body.assigneeId === null ? null : int(req.body.assigneeId, 'Person');
      if (assignee !== null && !isMember(boardId, assignee)) throw bad('Die Person ist kein Mitglied dieses Boards.');
    }
    const before = db.prepare(`SELECT i.done, i.text, cl.card_id FROM checklist_items i JOIN checklists cl ON cl.id = i.checklist_id WHERE i.id = ?`).get(id);
    const done = bool(req.body.done);
    updateFields(db, 'checklist_items', id, {
      text: text(req.body.text, { name: 'Text', max: 500 }) || undefined,
      done,
      assignee_id: assignee,
      due_date: date(req.body.dueDate),
    });
    if (done !== undefined && done !== before.done && done) {
      svc.log(boardId, before.card_id, req.user.id, 'item.done', { text: before.text });
    }
    svc.touchBoard(boardId);
    res.json({ ok: true });
  });

  r.post('/checklist-items/:id/move', (req, res) => {
    const { boardId } = access.via('item', req.user, req.params.id, 'editor');
    const id = int(req.params.id);
    const clId = int(req.body.checklistId, 'Checkliste');
    const target = db.prepare('SELECT c.board_id FROM checklists cl JOIN cards c ON c.id = cl.card_id WHERE cl.id = ?').get(clId);
    if (!target || target.board_id !== boardId) throw bad('Ungültige Checkliste.');
    tx(db, () => {
      db.prepare('UPDATE checklist_items SET checklist_id = ? WHERE id = ?').run(clId, id);
      svc.place('checklist_items', 'checklist_id', clId, id, int(req.body.index, 'Index'), { archivedCol: false });
    });
    res.json({ ok: true });
  });

  /** Checklistenpunkt in eine eigene Karte umwandeln (in derselben Liste). */
  r.post('/checklist-items/:id/to-card', (req, res) => {
    const { boardId } = access.via('item', req.user, req.params.id, 'editor');
    const item = db.prepare(`SELECT i.*, c.list_id, c.id AS card_id FROM checklist_items i JOIN checklists cl ON cl.id = i.checklist_id
                             JOIN cards c ON c.id = cl.card_id WHERE i.id = ?`).get(int(req.params.id));
    const cardId = tx(db, () => {
      const id = svc.createCard(boardId, item.list_id, req.user.id, { title: item.text, dueDate: item.due_date });
      if (item.assignee_id) db.prepare('INSERT OR IGNORE INTO card_members (card_id, user_id) VALUES (?, ?)').run(id, item.assignee_id);
      db.prepare('DELETE FROM checklist_items WHERE id = ?').run(item.id);
      svc.log(boardId, id, req.user.id, 'card.created', { fromItem: true });
      return id;
    });
    res.status(201).json({ id: cardId });
  });

  r.delete('/checklist-items/:id', (req, res) => {
    access.via('item', req.user, req.params.id, 'editor');
    db.prepare('DELETE FROM checklist_items WHERE id = ?').run(int(req.params.id));
    res.json({ ok: true });
  });

  // ---------------- Kommentare ----------------

  r.post('/cards/:id/comments', (req, res) => {
    // Auch Lesende dürfen kommentieren (z. B. Schulleitung, die nur mitliest).
    const { boardId } = access.via('card', req.user, req.params.id, 'viewer');
    const body = text(req.body.body, { name: 'Kommentar', required: true, max: 5000 });
    const { lastInsertRowid } = db.prepare('INSERT INTO comments (card_id, user_id, body) VALUES (?, ?, ?)').run(int(req.params.id), req.user.id, body);
    svc.log(boardId, int(req.params.id), req.user.id, 'comment.added');
    svc.touchBoard(boardId);
    res.status(201).json({ id: Number(lastInsertRowid) });
  });

  r.patch('/comments/:id', (req, res) => {
    access.via('comment', req.user, req.params.id, 'viewer');
    const c = db.prepare('SELECT user_id FROM comments WHERE id = ?').get(int(req.params.id));
    if (c.user_id !== req.user.id) throw new HttpError(403, 'Nur eigene Kommentare können bearbeitet werden.');
    db.prepare('UPDATE comments SET body = ? WHERE id = ?').run(text(req.body.body, { name: 'Kommentar', required: true, max: 5000 }), int(req.params.id));
    res.json({ ok: true });
  });

  r.delete('/comments/:id', (req, res) => {
    const { role } = access.via('comment', req.user, req.params.id, 'viewer');
    const c = db.prepare('SELECT user_id FROM comments WHERE id = ?').get(int(req.params.id));
    if (c.user_id !== req.user.id && role !== 'owner') throw new HttpError(403, 'Nur eigene Kommentare können gelöscht werden.');
    db.prepare('DELETE FROM comments WHERE id = ?').run(int(req.params.id));
    res.json({ ok: true });
  });

  // ---------------- Anhänge ----------------

  const insertAttachment = db.prepare(`INSERT INTO attachments (card_id, kind, name, url, nc_server, nc_path, nc_file_id, mime, size, added_by)
                                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  function addNcAttachment(boardId, cardId, userId, client, entry) {
    const { lastInsertRowid } = insertAttachment.run(
      cardId, 'nextcloud', entry.name, client.fileLink(entry.fileId) || `${client.serverUrl}/index.php/apps/files/?dir=${encodeURIComponent(entry.path)}`,
      client.serverUrl, entry.path, entry.fileId || null, entry.isDir ? 'httpd/unix-directory' : entry.mime || null, entry.size || null, userId,
    );
    const attId = Number(lastInsertRowid);
    // Erstes Bild wird automatisch zum Titelbild
    if (!entry.isDir && isImage(entry.mime, entry.name)) {
      db.prepare('UPDATE cards SET cover_attachment_id = ? WHERE id = ? AND cover_attachment_id IS NULL').run(attId, cardId);
    }
    svc.log(boardId, cardId, userId, 'attachment.added', { name: entry.name });
    svc.touchBoard(boardId);
    return attId;
  }

  // ---------------- Titelbild ----------------
  const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const isImage = (mime, name = '') => /^image\/(jpeg|pjpeg|png|gif|webp|heic|heif)$/i.test(mime || '')
    || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(name);
  const coverCache = new Map(); // attachmentId → { buf, type, at }
  const COVER_TTL = 60 * 60_000;
  let coverBytes = 0;
  function cacheCover(id, entry) {
    coverCache.delete(id);
    coverCache.set(id, entry);
    coverBytes += entry.buf.length;
    while (coverBytes > 30 * 1024 * 1024 || coverCache.size > 200) {
      const [k, v] = coverCache.entries().next().value;
      coverCache.delete(k);
      coverBytes -= v.buf.length;
    }
  }

  /** Nextcloud-Zugänge, über die ein Anhang lesbar sein kann: Board-Ordner zuerst, dann wer ihn angehängt hat. */
  function clientsForAttachment(att, boardId) {
    const out = [];
    try {
      const f = nc.folderClient(boardId);
      if (f.client.serverUrl === att.nc_server && isInside(f.root, att.nc_path || '/')) out.push(f.client);
    } catch { /* kein Board-Ordner */ }
    const own = nc.clientFor(att.added_by, { required: false });
    if (own && own.serverUrl === att.nc_server) out.push(own);
    return out;
  }

  r.get('/attachments/:id/cover', async (req, res) => {
    const { boardId } = access.via('attachment', req.user, req.params.id);
    const att = db.prepare('SELECT * FROM attachments WHERE id = ?').get(int(req.params.id));
    if (att.kind !== 'nextcloud' || !isImage(att.mime, att.name)) throw new HttpError(415, 'Kein Bild.');
    let entry = coverCache.get(att.id);
    if (!entry || Date.now() - entry.at > COVER_TTL) {
      entry = null;
      let lastErr = null;
      for (const client of clientsForAttachment(att, boardId)) {
        try {
          const img = await client.image(att.nc_file_id, att.nc_path);
          if (IMAGE_TYPES.includes(img.type)) { entry = { ...img, at: Date.now() }; break; }
          lastErr = new HttpError(415, 'Dieses Bildformat kann nicht angezeigt werden.');
        } catch (err) { lastErr = err; }
      }
      if (!entry) throw lastErr || new HttpError(404, 'Bild nicht erreichbar.');
      cacheCover(att.id, entry);
    }
    res.setHeader('Content-Type', entry.type);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.end(entry.buf);
  });

  // Weblink anhängen
  r.post('/cards/:id/attachments/link', (req, res) => {
    const { boardId } = access.via('card', req.user, req.params.id, 'editor');
    const url = text(req.body.url, { name: 'Adresse', required: true, max: 2000 });
    let parsed;
    try { parsed = new URL(url); } catch { throw bad('Ungültige Adresse.'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw bad('Nur http(s)-Links sind erlaubt.');
    const name = text(req.body.name, { name: 'Name', max: 200 }) || parsed.hostname + parsed.pathname.replace(/\/$/, '');
    const { lastInsertRowid } = insertAttachment.run(int(req.params.id), 'link', name, parsed.href, null, null, null, null, null, req.user.id);
    svc.log(boardId, int(req.params.id), req.user.id, 'attachment.added', { name });
    res.status(201).json({ id: Number(lastInsertRowid) });
  });

  // Datei aus der Nextcloud verknüpfen: source = "own" (eigene Nextcloud) | "board" (Board-Ordner)
  r.post('/cards/:id/attachments/nextcloud', async (req, res) => {
    const { boardId } = access.via('card', req.user, req.params.id, 'editor');
    const path = cleanPath(text(req.body.path, { name: 'Pfad', required: true, max: 1000 }));
    let client;
    if (req.body.source === 'board') {
      const f = nc.folderClient(boardId);
      if (!isInside(f.root, path)) throw new HttpError(403, 'Außerhalb des Board-Ordners.');
      client = f.client;
    } else {
      client = nc.clientFor(req.user.id);
    }
    const entry = await client.stat(path);
    if (!entry) throw new HttpError(404, 'Datei nicht gefunden.');
    const id = addNcAttachment(boardId, int(req.params.id), req.user.id, client, entry);
    res.status(201).json({ id });
  });

  // Datei hochladen → wird im Board-Ordner (optional Unterordner) in der Nextcloud gespeichert
  r.post('/cards/:id/attachments/upload', async (req, res) => {
    const { boardId } = access.via('card', req.user, req.params.id, 'editor');
    const size = Number(req.get('content-length'));
    if (!size) throw new HttpError(411, 'Dateigröße unbekannt.');
    if (size > config.uploadMaxMb * 1024 * 1024) throw new HttpError(413, `Datei zu groß (max. ${config.uploadMaxMb} MB).`);
    const { client, root } = nc.folderClient(boardId);
    const folder = req.query.folder ? cleanPath(String(req.query.folder)) : root;
    if (!isInside(root, folder)) throw new HttpError(403, 'Außerhalb des Board-Ordners.');
    const name = await client.freeName(folder, safeName(String(req.query.name || ''), 'Datei'));
    const entry = await client.upload(joinPath(folder, name), Readable.toWeb(req), {
      size, contentType: req.get('content-type'),
    });
    if (!entry) throw new NextcloudError('Upload konnte nicht bestätigt werden.');
    const id = addNcAttachment(boardId, int(req.params.id), req.user.id, client, entry);
    res.status(201).json({ id, path: entry.path });
  });

  r.delete('/attachments/:id', (req, res) => {
    access.via('attachment', req.user, req.params.id, 'editor');
    // Entfernt nur die Verknüpfung – die Datei bleibt in der Nextcloud erhalten.
    db.prepare('DELETE FROM attachments WHERE id = ?').run(int(req.params.id));
    res.json({ ok: true });
  });

  // ---------------- Meine Aufgaben ----------------

  r.get('/my/tasks', (req, res) => {
    const cards = db.prepare(`
      SELECT c.id, c.title, c.due_date AS dueDate, c.due_time AS dueTime, c.completed, b.id AS boardId, b.title AS boardTitle, b.color AS boardColor, l.title AS listTitle
      FROM card_members cm JOIN cards c ON c.id = cm.card_id JOIN boards b ON b.id = c.board_id JOIN lists l ON l.id = c.list_id
      JOIN board_members m ON m.board_id = b.id AND m.user_id = cm.user_id
      WHERE cm.user_id = ? AND c.archived = 0 AND l.archived = 0 AND b.archived = 0 AND c.completed = 0 AND c.is_template = 0
      ORDER BY c.due_date IS NULL, c.due_date, b.title`).all(req.user.id);
    const items = db.prepare(`
      SELECT i.id, i.text, i.due_date AS dueDate, c.id AS cardId, c.title AS cardTitle, b.id AS boardId, b.title AS boardTitle, b.color AS boardColor
      FROM checklist_items i JOIN checklists cl ON cl.id = i.checklist_id JOIN cards c ON c.id = cl.card_id
      JOIN boards b ON b.id = c.board_id JOIN lists l ON l.id = c.list_id
      JOIN board_members m ON m.board_id = b.id AND m.user_id = i.assignee_id
      WHERE i.assignee_id = ? AND i.done = 0 AND c.archived = 0 AND l.archived = 0 AND b.archived = 0 AND c.is_template = 0
      ORDER BY i.due_date IS NULL, i.due_date, b.title`).all(req.user.id);
    res.json({ cards: cards.map((c) => ({ ...c, completed: !!c.completed })), items });
  });

  r.use((err, _req, _res, next) => next(err instanceof NextcloudError ? new HttpError(err.status, err.message) : err));
  return r;
}
