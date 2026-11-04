import { randomToken, sha256 } from './crypto.js';
import { tx } from './db.js';
import { HttpError } from './http.js';
import { resetMail } from './mailer.js';

/** Konten verwalten: löschen (mit Board-Regeln) und Passwort-Reset-Links. */
export function createUserService({ db, config, mailer, nc }) {
  const baseUrl = (req) => config.baseUrl || `${req.protocol}://${req.get('host')}`;

  /** Boards, in denen die Person die einzige Verantwortliche ist, obwohl es weitere Mitglieder gibt. */
  function blockingBoards(userId) {
    return db.prepare(`
      SELECT b.title FROM boards b JOIN board_members m ON m.board_id = b.id AND m.user_id = ? AND m.role = 'owner'
      WHERE (SELECT COUNT(*) FROM board_members o WHERE o.board_id = b.id AND o.role = 'owner') = 1
        AND (SELECT COUNT(*) FROM board_members x WHERE x.board_id = b.id) > 1`).all(userId).map((b) => b.title);
  }

  async function deleteUser(userId, { self = true } = {}) {
    const blocking = blockingBoards(userId);
    if (blocking.length) {
      const who = self ? 'Du bist' : 'Die Person ist';
      throw new HttpError(409, `${who} die einzige verantwortliche Person in: ${blocking.map((t) => `„${t}“`).join(', ')}. Bitte dort zuerst eine andere Person als verantwortlich eintragen.`);
    }
    const client = nc.clientFor(userId, { required: false });
    if (client) await client.revokeAppPassword().catch(() => {});
    tx(db, () => {
      db.prepare(`DELETE FROM boards WHERE id IN (SELECT board_id FROM board_members WHERE user_id = ?)
                  AND (SELECT COUNT(*) FROM board_members x WHERE x.board_id = boards.id) = 1`).run(userId);
      db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    });
  }

  /** Erstellt einen einmaligen Link zum Setzen eines neuen Passworts; verschickt ihn optional per E-Mail. */
  async function createResetLink(req, user, { hours = 2, byAdmin = false, send = true } = {}) {
    const token = randomToken();
    db.prepare('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL').run(user.id);
    db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at, created_by) VALUES (?, ?, ?, ?)')
      .run(sha256(token), user.id, new Date(Date.now() + hours * 3600_000).toISOString(), req.user?.id ?? null);
    const link = `${baseUrl(req)}/#/reset/${token}`;
    let mailed = false;
    if (send && mailer.enabled) {
      try {
        mailed = await mailer.send({ to: user.email, ...resetMail({ appName: config.appName, name: user.name, link, hours, byAdmin }) });
      } catch (err) {
        console.error(`[mail] Passwort-Mail an ${user.email} fehlgeschlagen: ${err.message}`);
      }
    }
    return { link, mailed };
  }

  function resetByToken(token) {
    return db.prepare(`SELECT r.*, u.email, u.name, r.expires_at < ? AS expired FROM password_resets r
                       JOIN users u ON u.id = r.user_id WHERE r.token_hash = ?`)
      .get(new Date().toISOString(), sha256(String(token || ''))) || null;
  }

  return { blockingBoards, deleteUser, createResetLink, resetByToken };
}
