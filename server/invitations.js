import { randomToken, sha256 } from './crypto.js';
import { invitationMail, addedMail } from './mailer.js';

const RANK = { viewer: 1, editor: 2, owner: 3 };

export function createInvitationService({ db, config, mailer, svc }) {
  const baseUrl = (req) => config.baseUrl || `${req.protocol}://${req.get('host')}`;

  /** Legt eine Einladung an (bzw. erneuert eine offene) und verschickt sie per E-Mail. */
  async function invite(req, boardId, email, role) {
    const token = randomToken();
    const expires = new Date(Date.now() + config.inviteDays * 86400_000).toISOString();
    const open = db.prepare('SELECT id FROM invitations WHERE board_id = ? AND email = ? AND accepted_at IS NULL').get(boardId, email);
    let id;
    if (open) {
      db.prepare("UPDATE invitations SET token_hash = ?, role = ?, expires_at = ?, invited_by = ?, created_at = datetime('now') WHERE id = ?")
        .run(sha256(token), role, expires, req.user.id, open.id);
      id = open.id;
    } else {
      id = Number(db.prepare('INSERT INTO invitations (board_id, email, role, token_hash, invited_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(boardId, email, role, sha256(token), req.user.id, expires).lastInsertRowid);
    }
    const link = `${baseUrl(req)}/#/invite/${token}`;
    const board = db.prepare('SELECT title FROM boards WHERE id = ?').get(boardId);
    const mailed = await sendSafe({
      to: email,
      ...invitationMail({ appName: config.appName, inviter: req.user.name, board: board.title, role, link, expiresDays: config.inviteDays }),
    });
    svc.log(boardId, null, req.user.id, 'member.invited', { email, role });
    return { id, link, mailed };
  }

  async function notifyAdded(req, boardId, user, role) {
    const board = db.prepare('SELECT title FROM boards WHERE id = ?').get(boardId);
    return sendSafe({
      to: user.email,
      ...addedMail({ appName: config.appName, inviter: req.user.name, board: board.title, role, link: `${baseUrl(req)}/#/board/${boardId}` }),
    });
  }

  async function sendSafe(msg) {
    if (!mailer.enabled) return false;
    try {
      return await mailer.send(msg);
    } catch (err) {
      console.error(`[mail] Versand an ${msg.to} fehlgeschlagen: ${err.message}`);
      return false;
    }
  }

  /** Einladung über das Token finden (inkl. Status). */
  function byToken(token) {
    const inv = db.prepare(`SELECT i.*, b.title AS board_title, u.name AS inviter_name,
                              i.expires_at < ? AS expired
                            FROM invitations i JOIN boards b ON b.id = i.board_id
                            LEFT JOIN users u ON u.id = i.invited_by WHERE i.token_hash = ?`)
      .get(new Date().toISOString(), sha256(String(token || '')));
    return inv || null;
  }

  /** Nimmt eine Einladung für einen Benutzer an. Bestehende höhere Rollen bleiben erhalten. */
  function accept(inv, user) {
    const cur = db.prepare('SELECT role FROM board_members WHERE board_id = ? AND user_id = ?').get(inv.board_id, user.id);
    if (!cur) {
      db.prepare('INSERT INTO board_members (board_id, user_id, role) VALUES (?, ?, ?)').run(inv.board_id, user.id, inv.role);
    } else if (RANK[inv.role] > RANK[cur.role]) {
      db.prepare('UPDATE board_members SET role = ? WHERE board_id = ? AND user_id = ?').run(inv.role, inv.board_id, user.id);
    }
    db.prepare("UPDATE invitations SET accepted_at = datetime('now'), accepted_by = ? WHERE id = ?").run(user.id, inv.id);
    svc.log(inv.board_id, null, user.id, 'member.joined', { name: user.name });
    return inv.board_id;
  }

  return { invite, notifyAdded, byToken, accept };
}
