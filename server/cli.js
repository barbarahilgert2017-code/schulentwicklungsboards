// Verwaltung ohne Weboberfläche:
//   node server/cli.js reset-password <email>   → setzt ein zufälliges Passwort und gibt es aus
//   node server/cli.js make-admin <email>
//   node server/cli.js list-users
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { hashPassword, randomToken } from './crypto.js';

const [cmd, email] = process.argv.slice(2);
const db = openDb(loadConfig().dbFile);
const user = email ? db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) : null;
const need = () => { if (!user) { console.error('Keine Person mit dieser E-Mail gefunden.'); process.exit(1); } };

switch (cmd) {
  case 'reset-password': {
    need();
    const pw = randomToken(12);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(pw), user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    console.log(`Neues Passwort für ${user.email}: ${pw}`);
    break;
  }
  case 'make-admin':
    need();
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(user.id);
    console.log(`${user.email} ist jetzt Administrator/in.`);
    break;
  case 'list-users':
    for (const u of db.prepare('SELECT id, email, name, is_admin, created_at FROM users ORDER BY id').all()) {
      console.log(`${u.id}\t${u.email}\t${u.name}${u.is_admin ? '\t[Admin]' : ''}\t${u.created_at}`);
    }
    break;
  default:
    console.log('Befehle: reset-password <email> | make-admin <email> | list-users');
}
