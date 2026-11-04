import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const bool = (v, def = false) => (v === undefined || v === '' ? def : /^(1|true|yes|ja|on)$/i.test(v));
const list = (v) => (v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/**
 * Liest die Konfiguration aus Umgebungsvariablen. `overrides` wird in Tests genutzt.
 */
export function loadConfig(overrides = {}) {
  const env = process.env;
  const production = env.NODE_ENV === 'production';
  const dataDir = overrides.dataDir ?? env.DATA_DIR ?? path.resolve('data');

  const cfg = {
    production,
    port: Number(env.PORT || 3000),
    appName: env.APP_NAME || 'Schulentwicklungsboards',
    baseUrl: (env.BASE_URL || '').replace(/\/+$/, ''),
    dataDir,
    dbFile: env.DB_FILE || path.join(dataDir, 'boards.sqlite'),
    appSecret: env.APP_SECRET || '',
    cookieSecure: bool(env.COOKIE_SECURE, production),
    trustProxy: bool(env.TRUST_PROXY, production),
    allowRegistration: bool(env.ALLOW_REGISTRATION, true),
    // Pflicht-Code für die allererste Registrierung (wird Admin). Setzt das Installationsskript.
    setupCode: env.SETUP_CODE || '',
    registrationDomains: list(env.REGISTRATION_EMAIL_DOMAINS),
    sessionDays: Number(env.SESSION_DAYS || 14),
    uploadMaxMb: Number(env.UPLOAD_MAX_MB || 50),
    inviteDays: Number(env.INVITE_DAYS || 14),
    smtp: {
      host: env.SMTP_HOST || '',
      port: Number(env.SMTP_PORT || 587),
      secure: bool(env.SMTP_SECURE, false),
      user: env.SMTP_USER || '',
      pass: env.SMTP_PASS || '',
      from: env.MAIL_FROM || env.SMTP_USER || '',
    },
    demo: false,
    nextcloud: {
      defaultUrl: (env.NEXTCLOUD_DEFAULT_URL || '').replace(/\/+$/, ''),
      allowedHosts: list(env.NEXTCLOUD_ALLOWED_HOSTS),
      allowInsecureHttp: bool(env.NEXTCLOUD_ALLOW_INSECURE_HTTP, false),
      allowPrivateNetworks: bool(env.NEXTCLOUD_ALLOW_PRIVATE_NETWORKS, false),
      baseFolder: env.NEXTCLOUD_BASE_FOLDER || 'Schulentwicklung',
      userAgent: env.NEXTCLOUD_CLIENT_NAME || 'Schulentwicklungsboards',
    },
    ...overrides,
  };
  if (overrides.nextcloud) cfg.nextcloud = { ...cfg.nextcloud, ...overrides.nextcloud };

  if (!cfg.appSecret) {
    if (cfg.production) {
      throw new Error('APP_SECRET muss in Produktion gesetzt sein (mind. 32 Zeichen, z. B. `openssl rand -hex 32`).');
    }
    // Entwicklung: Schlüssel einmalig erzeugen und im Datenverzeichnis ablegen.
    if (cfg.dbFile === ':memory:') {
      cfg.appSecret = crypto.randomBytes(32).toString('hex');
    } else {
      fs.mkdirSync(cfg.dataDir, { recursive: true });
      const keyFile = path.join(cfg.dataDir, 'secret.key');
      if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
      cfg.appSecret = fs.readFileSync(keyFile, 'utf8').trim();
    }
  }
  if (cfg.appSecret.length < 32) throw new Error('APP_SECRET ist zu kurz (mind. 32 Zeichen).');
  return cfg;
}
