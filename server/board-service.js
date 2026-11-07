import { tx } from './db.js';

const addDays = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

export function createBoardService(db) {
  const logStmt = db.prepare('INSERT INTO activities (board_id, card_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)');

  function log(boardId, cardId, userId, action, details = {}) {
    logStmt.run(boardId, cardId ?? null, userId ?? null, action, JSON.stringify(details));
  }

  function touchBoard(boardId) {
    db.prepare("UPDATE boards SET updated_at = datetime('now') WHERE id = ?").run(boardId);
  }

  function nextPosition(table, parentCol, parentId) {
    const row = db.prepare(`SELECT MAX(position) AS p FROM ${table} WHERE ${parentCol} = ?`).get(parentId);
    return (row.p || 0) + 1024;
  }

  /** Fügt movedId an Index `index` in die Geschwisterreihe ein und nummeriert neu. */
  function place(table, parentCol, parentId, movedId, index, { archivedCol = true } = {}) {
    const where = archivedCol ? 'AND archived = 0' : '';
    const ids = db.prepare(`SELECT id FROM ${table} WHERE ${parentCol} = ? ${where} AND id != ? ORDER BY position, id`)
      .all(parentId, movedId).map((r) => r.id);
    const i = Math.max(0, Math.min(Number.isInteger(index) ? index : ids.length, ids.length));
    ids.splice(i, 0, movedId);
    const up = db.prepare(`UPDATE ${table} SET position = ? WHERE id = ?`);
    ids.forEach((id, n) => up.run((n + 1) * 1024, id));
  }

  function createList(boardId, title) {
    const { lastInsertRowid } = db.prepare('INSERT INTO lists (board_id, title, position) VALUES (?, ?, ?)')
      .run(boardId, title, nextPosition('lists', 'board_id', boardId));
    return Number(lastInsertRowid);
  }

  function createCard(boardId, listId, userId, { title, description = '', dueDate = null, isTemplate = false }) {
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO cards (board_id, list_id, title, description, due_date, position, created_by, is_template) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(boardId, listId, title, description, dueDate, nextPosition('cards', 'list_id', listId), userId, isTemplate ? 1 : 0);
    return Number(lastInsertRowid);
  }

  /**
   * Kopiert eine Karte (z. B. aus einer Vorlagenkarte): Titel, Beschreibung, Labels,
   * Uhrzeiten und Checklisten (alle Punkte offen). Termine, Personen, Kommentare und Anhänge nicht.
   */
  function copyCard(sourceId, listId, userId, { title, index } = {}) {
    const src = db.prepare('SELECT * FROM cards WHERE id = ?').get(sourceId);
    const id = createCard(src.board_id, listId, userId, { title: title || src.title, description: src.description });
    db.prepare('UPDATE cards SET start_time = ?, due_time = ? WHERE id = ?').run(src.start_time, src.due_time, id);
    db.prepare('INSERT INTO card_labels (card_id, label_id) SELECT ?, label_id FROM card_labels WHERE card_id = ?').run(id, sourceId);
    for (const cl of db.prepare('SELECT * FROM checklists WHERE card_id = ? ORDER BY position, id').all(sourceId)) {
      const items = db.prepare('SELECT text FROM checklist_items WHERE checklist_id = ? ORDER BY position, id').all(cl.id).map((i) => i.text);
      createChecklist(id, cl.title, items);
    }
    if (index !== undefined) place('cards', 'list_id', listId, id, index);
    return id;
  }

  function createChecklist(cardId, title, items = []) {
    const { lastInsertRowid } = db.prepare('INSERT INTO checklists (card_id, title, position) VALUES (?, ?, ?)')
      .run(cardId, title, nextPosition('checklists', 'card_id', cardId));
    const id = Number(lastInsertRowid);
    const ins = db.prepare('INSERT INTO checklist_items (checklist_id, text, position) VALUES (?, ?, ?)');
    items.forEach((t, i) => ins.run(id, t, (i + 1) * 1024));
    return id;
  }

  /** Legt ein Board an, optional aus einer Vorlage. */
  function createBoard(userId, { title, description = '', color, template }) {
    return tx(db, () => {
      const { lastInsertRowid } = db.prepare('INSERT INTO boards (title, description, color, template_key, created_by) VALUES (?, ?, ?, ?, ?)')
        .run(title, description, color || template?.color || '#2f6f9f', template?.key || null, userId);
      const boardId = Number(lastInsertRowid);
      db.prepare("INSERT INTO board_members (board_id, user_id, role) VALUES (?, ?, 'owner')").run(boardId, userId);

      if (template) {
        const labelIds = new Map();
        const insLabel = db.prepare('INSERT INTO labels (board_id, name, color) VALUES (?, ?, ?)');
        for (const l of template.labels || []) {
          labelIds.set(l.name, Number(insLabel.run(boardId, l.name, l.color).lastInsertRowid));
        }
        const addLabel = db.prepare('INSERT OR IGNORE INTO card_labels (card_id, label_id) VALUES (?, ?)');
        for (const list of template.lists || []) {
          const listId = createList(boardId, list.title);
          for (const c of list.cards || []) {
            const cardId = createCard(boardId, listId, userId, {
              title: c.title, description: c.description || '', dueDate: c.dueInDays ? addDays(c.dueInDays) : null, isTemplate: !!c.template,
            });
            if (c.dueTime) db.prepare('UPDATE cards SET due_time = ? WHERE id = ?').run(c.dueTime, cardId);
            for (const name of c.labels || []) if (labelIds.has(name)) addLabel.run(cardId, labelIds.get(name));
            for (const cl of c.checklists || []) createChecklist(cardId, cl.title, cl.items);
          }
        }
      }
      log(boardId, null, userId, 'board.created', { template: template?.key || null });
      return boardId;
    });
  }

  function boardRow(boardId) {
    return db.prepare(`SELECT b.*, u.name AS folder_owner_name FROM boards b
                       LEFT JOIN users u ON u.id = b.nc_folder_user_id WHERE b.id = ?`).get(boardId);
  }

  function boardJson(b, role) {
    return {
      id: b.id, title: b.title, description: b.description, color: b.color, templateKey: b.template_key,
      archived: !!b.archived, createdAt: b.created_at, updatedAt: b.updated_at, role,
      folder: b.nc_folder_path ? { path: b.nc_folder_path, fileId: b.nc_folder_file_id, ownerId: b.nc_folder_user_id, ownerName: b.folder_owner_name } : null,
    };
  }

  function members(boardId) {
    return db.prepare(`SELECT u.id, u.name, u.email, u.is_guest, m.role, (n.user_id IS NOT NULL) AS nc
                       FROM board_members m JOIN users u ON u.id = m.user_id
                       LEFT JOIN nextcloud_accounts n ON n.user_id = u.id
                       WHERE m.board_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, u.name`)
      .all(boardId).map((m) => ({ id: m.id, name: m.name, email: m.is_guest ? '' : m.email, role: m.role, nextcloud: !!m.nc, guest: !!m.is_guest }));
  }

  function labels(boardId) {
    return db.prepare('SELECT id, name, color FROM labels WHERE board_id = ? ORDER BY id').all(boardId);
  }

  /** Kartendaten für die Board-Übersicht. */
  function cardSummaries(where, ...params) {
    const cards = db.prepare(`
      SELECT c.id, c.list_id, c.title, c.position, c.start_date, c.due_date, c.start_time, c.due_time, c.is_template, c.completed, c.archived,
             length(c.description) > 0 AS has_desc,
             (SELECT COUNT(*) FROM checklist_items i JOIN checklists cl ON cl.id = i.checklist_id WHERE cl.card_id = c.id) AS items_total,
             (SELECT COUNT(*) FROM checklist_items i JOIN checklists cl ON cl.id = i.checklist_id WHERE cl.card_id = c.id AND i.done = 1) AS items_done,
             (SELECT COUNT(*) FROM attachments a WHERE a.card_id = c.id) AS attachments,
             (SELECT COUNT(*) FROM comments co WHERE co.card_id = c.id) AS comments,
             (SELECT COUNT(*) FROM card_links k WHERE k.card_a = c.id OR k.card_b = c.id) AS links,
             c.cover_attachment_id AS cover_id, c.nc_folder_path IS NOT NULL AS has_folder
      FROM cards c WHERE ${where} ORDER BY c.position, c.id`).all(...params);
    if (!cards.length) return [];
    const ids = cards.map((c) => c.id);
    const ph = ids.map(() => '?').join(',');
    const lab = new Map(); const mem = new Map();
    for (const r of db.prepare(`SELECT card_id, label_id FROM card_labels WHERE card_id IN (${ph})`).all(...ids)) {
      if (!lab.has(r.card_id)) lab.set(r.card_id, []);
      lab.get(r.card_id).push(r.label_id);
    }
    for (const r of db.prepare(`SELECT card_id, user_id FROM card_members WHERE card_id IN (${ph})`).all(...ids)) {
      if (!mem.has(r.card_id)) mem.set(r.card_id, []);
      mem.get(r.card_id).push(r.user_id);
    }
    return cards.map((c) => ({
      id: c.id, listId: c.list_id, title: c.title, position: c.position, startDate: c.start_date, dueDate: c.due_date,
      startTime: c.start_time, dueTime: c.due_time, isTemplate: !!c.is_template,
      completed: !!c.completed, archived: !!c.archived, hasDescription: !!c.has_desc,
      checklist: { done: c.items_done, total: c.items_total }, attachments: c.attachments, comments: c.comments, links: c.links,
      coverId: c.cover_id || null, hasFolder: !!c.has_folder,
      labels: lab.get(c.id) || [], members: mem.get(c.id) || [],
    }));
  }

  function fullBoard(boardId, role) {
    const lists = db.prepare('SELECT id, title, position FROM lists WHERE board_id = ? AND archived = 0 ORDER BY position, id').all(boardId);
    return {
      board: boardJson(boardRow(boardId), role),
      members: members(boardId),
      labels: labels(boardId),
      lists,
      cards: cardSummaries('c.board_id = ? AND c.archived = 0 AND c.list_id IN (SELECT id FROM lists WHERE board_id = ? AND archived = 0)', boardId, boardId),
    };
  }

  function fullCard(cardId) {
    const [summary] = cardSummaries('c.id = ?', cardId);
    const c = db.prepare(`SELECT c.*, u.name AS creator, fu.name AS folder_owner, na.server_url AS folder_server
                          FROM cards c LEFT JOIN users u ON u.id = c.created_by LEFT JOIN users fu ON fu.id = c.nc_folder_user_id
                          LEFT JOIN nextcloud_accounts na ON na.user_id = c.nc_folder_user_id WHERE c.id = ?`).get(cardId);
    const checklists = db.prepare('SELECT id, title FROM checklists WHERE card_id = ? ORDER BY position, id').all(cardId);
    const itemStmt = db.prepare('SELECT id, text, done, assignee_id, due_date FROM checklist_items WHERE checklist_id = ? ORDER BY position, id');
    return {
      ...summary,
      boardId: c.board_id,
      description: c.description,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      creator: c.creator,
      folder: c.nc_folder_path ? {
        path: c.nc_folder_path, fileId: c.nc_folder_file_id, ownerId: c.nc_folder_user_id, ownerName: c.folder_owner,
        link: c.folder_server && c.nc_folder_file_id ? `${c.folder_server}/index.php/f/${encodeURIComponent(c.nc_folder_file_id)}` : null,
      } : null,
      checklists: checklists.map((cl) => ({
        ...cl,
        items: itemStmt.all(cl.id).map((i) => ({ id: i.id, text: i.text, done: !!i.done, assigneeId: i.assignee_id, dueDate: i.due_date })),
      })),
      comments: db.prepare(`SELECT co.id, co.body, co.created_at AS createdAt, co.user_id AS userId, u.name AS userName
                            FROM comments co LEFT JOIN users u ON u.id = co.user_id WHERE co.card_id = ? ORDER BY co.id DESC`).all(cardId),
      attachmentList: db.prepare(`SELECT a.id, a.kind, a.name, a.url, a.nc_path AS path, a.nc_file_id AS fileId, a.mime, a.size,
                                  a.created_at AS createdAt, u.name AS addedBy
                                  FROM attachments a LEFT JOIN users u ON u.id = a.added_by WHERE a.card_id = ? ORDER BY a.id DESC`).all(cardId),
      activity: activities('a.card_id = ?', cardId, 50),
    };
  }

  function activities(where, param, limit = 50) {
    return db.prepare(`SELECT a.id, a.card_id AS cardId, a.action, a.details, a.created_at AS createdAt, u.name AS userName,
                       c.title AS cardTitle
                       FROM activities a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN cards c ON c.id = a.card_id
                       WHERE ${where} ORDER BY a.id DESC LIMIT ?`).all(param, limit)
      .map((a) => ({ ...a, details: JSON.parse(a.details || '{}') }));
  }

  return {
    log, touchBoard, nextPosition, place, createList, createCard, copyCard, createChecklist, createBoard,
    boardRow, boardJson, members, labels, cardSummaries, fullBoard, fullCard, activities,
  };
}
