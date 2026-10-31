import { HttpError } from './http.js';

const RANK = { viewer: 1, editor: 2, owner: 3 };

export function createAccess(db) {
  const memberStmt = db.prepare('SELECT role FROM board_members WHERE board_id = ? AND user_id = ?');
  const lookups = {
    list: db.prepare('SELECT board_id FROM lists WHERE id = ?'),
    card: db.prepare('SELECT board_id FROM cards WHERE id = ?'),
    checklist: db.prepare('SELECT c.board_id FROM checklists cl JOIN cards c ON c.id = cl.card_id WHERE cl.id = ?'),
    item: db.prepare(`SELECT c.board_id FROM checklist_items i JOIN checklists cl ON cl.id = i.checklist_id
                      JOIN cards c ON c.id = cl.card_id WHERE i.id = ?`),
    comment: db.prepare('SELECT c.board_id FROM comments co JOIN cards c ON c.id = co.card_id WHERE co.id = ?'),
    attachment: db.prepare('SELECT c.board_id FROM attachments a JOIN cards c ON c.id = a.card_id WHERE a.id = ?'),
    label: db.prepare('SELECT board_id FROM labels WHERE id = ?'),
  };

  /** Prüft die Rolle im Board, wirft 404 (kein Mitglied) oder 403 (zu geringe Rolle). */
  function board(user, boardId, minRole = 'viewer') {
    const id = Number(boardId);
    const m = Number.isInteger(id) ? memberStmt.get(id, user.id) : null;
    if (!m) throw new HttpError(404, 'Board nicht gefunden.');
    if (RANK[m.role] < RANK[minRole]) {
      throw new HttpError(403, minRole === 'owner' ? 'Nur Board-Verantwortliche dürfen das.' : 'Du hast nur Leserechte in diesem Board.');
    }
    return { boardId: id, role: m.role };
  }

  /** Ermittelt das Board eines Objekts (Liste, Karte, …) und prüft die Rolle. */
  function via(kind, user, objectId, minRole = 'viewer') {
    const row = lookups[kind].get(Number(objectId));
    if (!row) throw new HttpError(404, 'Nicht gefunden.');
    return board(user, row.board_id, minRole);
  }

  return { board, via };
}
