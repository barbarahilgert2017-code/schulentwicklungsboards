// Konsistente Sicherung der SQLite-Datenbank im laufenden Betrieb: `npm run backup [zielverzeichnis]`
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from './config.js';

const config = loadConfig();
const dir = path.resolve(process.argv[2] || path.join(config.dataDir, 'backups'));
fs.mkdirSync(dir, { recursive: true });
const target = path.join(dir, `boards-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
const db = new DatabaseSync(config.dbFile);
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
db.close();
console.log(`Sicherung erstellt: ${target}`);
console.log('Hinweis: Zusätzlich data/secret.key bzw. APP_SECRET sichern – ohne ihn sind gespeicherte Nextcloud-Verbindungen nicht nutzbar.');
