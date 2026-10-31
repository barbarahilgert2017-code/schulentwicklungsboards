import { Router } from 'express';
import { requireUser } from '../auth.js';
import { HttpError, int } from '../http.js';

export default function invitationRoutes({ db, access, invitations }) {
  const r = Router();

  // ---- Öffentlich: Einladung ansehen ----
  r.get('/invitations/token/:token', (req, res) => {
    const inv = invitations.byToken(req.params.token);
    if (!inv) throw new HttpError(404, 'Diese Einladung gibt es nicht (mehr). Bitte um einen neuen Link.');
    res.json({
      boardId: inv.board_id,
      boardTitle: inv.board_title,
      inviter: inv.inviter_name,
      email: inv.email,
      role: inv.role,
      expired: !!inv.expired,
      accepted: !!inv.accepted_at,
      accountExists: !!db.prepare('SELECT 1 FROM users WHERE email = ?').get(inv.email),
    });
  });

  // ---- Angemeldet: Einladung annehmen ----
  r.post('/invitations/token/:token/accept', requireUser, (req, res) => {
    const inv = invitations.byToken(req.params.token);
    if (!inv) throw new HttpError(404, 'Diese Einladung gibt es nicht (mehr).');
    if (inv.accepted_at) {
      if (inv.accepted_by === req.user.id) return res.json({ boardId: inv.board_id });
      throw new HttpError(410, 'Diese Einladung wurde bereits angenommen.');
    }
    if (inv.expired) throw new HttpError(410, 'Diese Einladung ist abgelaufen. Bitte um einen neuen Link.');
    res.json({ boardId: invitations.accept(inv, req.user) });
  });

  // ---- Verwaltung durch Verantwortliche ----
  r.get('/boards/:id/invitations', requireUser, (req, res) => {
    const { boardId } = access.board(req.user, req.params.id, 'owner');
    const rows = db.prepare(`SELECT i.id, i.email, i.role, i.created_at AS createdAt, i.expires_at AS expiresAt, u.name AS invitedBy
                             FROM invitations i LEFT JOIN users u ON u.id = i.invited_by
                             WHERE i.board_id = ? AND i.accepted_at IS NULL ORDER BY i.id DESC`).all(boardId);
    const now = new Date().toISOString();
    res.json(rows.map((x) => ({ ...x, expired: x.expiresAt < now })));
  });

  r.post('/invitations/:id/resend', requireUser, async (req, res) => {
    const inv = db.prepare('SELECT * FROM invitations WHERE id = ? AND accepted_at IS NULL').get(int(req.params.id));
    if (!inv) throw new HttpError(404, 'Einladung nicht gefunden.');
    access.board(req.user, inv.board_id, 'owner');
    res.json(await invitations.invite(req, inv.board_id, inv.email, inv.role));
  });

  r.delete('/invitations/:id', requireUser, (req, res) => {
    const inv = db.prepare('SELECT board_id FROM invitations WHERE id = ?').get(int(req.params.id));
    if (!inv) throw new HttpError(404, 'Einladung nicht gefunden.');
    access.board(req.user, inv.board_id, 'owner');
    db.prepare('DELETE FROM invitations WHERE id = ?').run(int(req.params.id));
    res.json({ ok: true });
  });

  return r;
}
