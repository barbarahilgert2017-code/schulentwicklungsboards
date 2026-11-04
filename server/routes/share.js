import { Router } from 'express';
import { requireUser, createSession, createRateLimiter } from '../auth.js';
import { randomToken, sha256 } from '../crypto.js';
import { HttpError, bad, text, int } from '../http.js';
import { tx } from '../db.js';

const RANK = { viewer: 1, editor: 2, owner: 3 };
const GUEST_DAYS = 180;

/**
 * Einladungslinks: Ein Link pro Board (oder mehrere), mit dem Personen ohne Konto
 * – nur mit ihrem Namen – als Gast beitreten. Angemeldete Konten werden Mitglied.
 */
export default function shareRoutes({ db, config, box, access, svc }) {
  const r = Router();
  const joinLimiter = createRateLimiter({ max: 30, windowMs: 60 * 60_000 });
  const baseUrl = (req) => config.baseUrl || `${req.protocol}://${req.get('host')}`;
  const linkUrl = (req, token) => `${baseUrl(req)}/#/l/${token}`;

  function byToken(token) {
    const l = db.prepare(`SELECT l.*, b.title AS board_title, b.color AS board_color, b.archived AS board_archived
                          FROM share_links l JOIN boards b ON b.id = l.board_id WHERE l.token_hash = ?`)
      .get(sha256(String(token || '')));
    if (!l) throw new HttpError(404, 'Diesen Einladungslink gibt es nicht (mehr). Bitte um einen neuen Link.');
    if (l.expires_at && l.expires_at < new Date().toISOString()) throw new HttpError(410, 'Dieser Einladungslink ist abgelaufen. Bitte um einen neuen Link.');
    return l;
  }

  /** Mitgliedschaft über einen Link anlegen; eine bestehende höhere Rolle bleibt. */
  function addMember(link, user) {
    const cur = db.prepare('SELECT role FROM board_members WHERE board_id = ? AND user_id = ?').get(link.board_id, user.id);
    if (!cur) {
      db.prepare('INSERT INTO board_members (board_id, user_id, role, via_link_id) VALUES (?, ?, ?, ?)').run(link.board_id, user.id, link.role, link.id);
      svc.log(link.board_id, null, user.id, user.is_guest || user.isGuest ? 'member.guest' : 'member.joined', { name: user.name });
    } else if (RANK[link.role] > RANK[cur.role]) {
      db.prepare('UPDATE board_members SET role = ? WHERE board_id = ? AND user_id = ?').run(link.role, link.board_id, user.id);
    }
    return link.board_id;
  }
  r.shareAddMember = addMember;
  r.shareByToken = byToken;

  // ---- Öffentlich: Link prüfen ----
  r.get('/share/:token', (req, res) => {
    const l = byToken(req.params.token);
    res.json({ boardTitle: l.board_title, color: l.board_color, role: l.role, archived: !!l.board_archived });
  });

  // ---- Beitreten: angemeldet → Mitglied; sonst Gastzugang mit Namen ----
  r.post('/share/:token/join', (req, res) => {
    const l = byToken(req.params.token);
    if (req.user) {
      return res.json({ boardId: tx(db, () => addMember(l, req.user)) });
    }
    if (!joinLimiter.check(req.ip)) throw new HttpError(429, 'Zu viele Beitritte von diesem Gerät. Bitte später erneut versuchen.');
    const name = text(req.body.name, { name: 'Name', required: true, max: 60 });
    if (name.length < 2) throw bad('Bitte den Namen angeben, unter dem dich die anderen erkennen.');
    const guest = tx(db, () => {
      const email = `gast-${randomToken(9).toLowerCase()}@gast.invalid`;
      const { lastInsertRowid } = db.prepare("INSERT INTO users (email, name, password_hash, is_guest) VALUES (?, ?, 'gast', 1)").run(email, name);
      const u = { id: Number(lastInsertRowid), name, isGuest: true };
      addMember(l, u);
      return u;
    });
    const csrf = createSession(db, config, res, guest.id, { days: GUEST_DAYS });
    res.status(201).json({ boardId: l.board_id, csrf, user: { id: guest.id, name, email: '', isAdmin: false, isGuest: true } });
  });

  // ---- Verwaltung durch Verantwortliche ----
  r.get('/boards/:id/links', requireUser, (req, res) => {
    const { boardId } = access.board(req.user, req.params.id, 'owner');
    const rows = db.prepare(`SELECT l.*, u.name AS created_by_name,
                               (SELECT COUNT(*) FROM board_members m JOIN users g ON g.id = m.user_id
                                WHERE m.via_link_id = l.id AND g.is_guest = 1) AS guests,
                               (SELECT COUNT(*) FROM board_members m JOIN users g ON g.id = m.user_id
                                WHERE m.via_link_id = l.id AND g.is_guest = 0) AS accounts
                             FROM share_links l LEFT JOIN users u ON u.id = l.created_by
                             WHERE l.board_id = ? ORDER BY l.id DESC`).all(boardId);
    const now = new Date().toISOString();
    res.json(rows.map((l) => ({
      id: l.id, role: l.role, label: l.label, createdAt: l.created_at, createdBy: l.created_by_name,
      expiresAt: l.expires_at, expired: !!(l.expires_at && l.expires_at < now),
      guests: l.guests, accounts: l.accounts, link: linkUrl(req, box.decrypt(l.token_enc)),
    })));
  });

  r.post('/boards/:id/links', requireUser, (req, res) => {
    const { boardId } = access.board(req.user, req.params.id, 'owner');
    const role = req.body.role === 'viewer' ? 'viewer' : 'editor';
    const label = text(req.body.label, { name: 'Bezeichnung', max: 80 }) || '';
    let expires = null;
    if (req.body.days) {
      const days = int(req.body.days, 'Gültigkeit');
      if (days < 1 || days > 730) throw bad('Gültigkeit zwischen 1 und 730 Tagen wählen.');
      expires = new Date(Date.now() + days * 86400_000).toISOString();
    }
    const token = randomToken(18);
    const { lastInsertRowid } = db.prepare('INSERT INTO share_links (board_id, token_hash, token_enc, role, label, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(boardId, sha256(token), box.encrypt(token), role, label, req.user.id, expires);
    svc.log(boardId, null, req.user.id, 'link.created', { role });
    res.status(201).json({ id: Number(lastInsertRowid), link: linkUrl(req, token) });
  });

  /** Link löschen: Gäste, die über ihn gekommen sind, verlieren sofort den Zugang. */
  r.delete('/links/:id', requireUser, (req, res) => {
    const l = db.prepare('SELECT * FROM share_links WHERE id = ?').get(int(req.params.id));
    if (!l) throw new HttpError(404, 'Link nicht gefunden.');
    access.board(req.user, l.board_id, 'owner');
    const removed = tx(db, () => {
      const guests = db.prepare(`SELECT m.user_id FROM board_members m JOIN users u ON u.id = m.user_id
                                 WHERE m.via_link_id = ? AND u.is_guest = 1`).all(l.id).map((x) => x.user_id);
      for (const gid of guests) {
        db.prepare('DELETE FROM board_members WHERE board_id = ? AND user_id = ?').run(l.board_id, gid);
        db.prepare('DELETE FROM card_members WHERE user_id = ? AND card_id IN (SELECT id FROM cards WHERE board_id = ?)').run(gid, l.board_id);
        // Gäste ohne weiteres Board werden abgemeldet
        if (!db.prepare('SELECT 1 FROM board_members WHERE user_id = ?').get(gid)) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(gid);
      }
      db.prepare('DELETE FROM share_links WHERE id = ?').run(l.id);
      svc.log(l.board_id, null, req.user.id, 'link.deleted', { guests: guests.length });
      return guests.length;
    });
    res.json({ ok: true, removedGuests: removed });
  });

  return r;
}
