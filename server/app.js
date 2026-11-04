import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sessionMiddleware } from './auth.js';
import { createSecretBox } from './crypto.js';
import { createAccess } from './access.js';
import { createBoardService } from './board-service.js';
import { createNcService } from './nc-service.js';
import { NextcloudError } from './nextcloud.js';
import authRoutes from './routes/auth.js';
import nextcloudRoutes from './routes/nextcloud.js';
import boardRoutes from './routes/boards.js';
import cardRoutes from './routes/cards.js';
import invitationRoutes from './routes/invitations.js';
import adminRoutes from './routes/admin.js';
import shareRoutes from './routes/share.js';
import { createUserService } from './users.js';
import { createMailer } from './mailer.js';
import { createInvitationService } from './invitations.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp({ config, db, mailer = createMailer(config) }) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  const box = createSecretBox(config.appSecret);
  const ctx = { db, config, box, mailer, access: createAccess(db), svc: createBoardService(db) };
  ctx.nc = createNcService(ctx);
  app.locals.nc = ctx.nc;
  ctx.invitations = createInvitationService(ctx);
  ctx.users = createUserService(ctx);
  ctx.share = shareRoutes(ctx);

  // Sicherheits-Header: keine externen Quellen, kein Tracking, kein Einbetten.
  app.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  // JSON-Parser – nicht für Datei-Uploads, die als Rohdaten gestreamt werden.
  app.use(express.json({ limit: '1mb', type: (req) => !req.url.includes('/attachments/upload') && /json/.test(req.headers['content-type'] || '') }));
  app.use(sessionMiddleware(db));

  app.get('/healthz', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ ok: true });
  });

  const api = express.Router();
  api.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  api.use('/auth', authRoutes(ctx));
  api.use('/nextcloud', nextcloudRoutes(ctx));
  api.use('/admin', adminRoutes(ctx));
  api.use(invitationRoutes(ctx)); // enthält öffentliche Routen → vor den Routern mit Login-Pflicht
  api.use(ctx.share);
  api.use(boardRoutes(ctx));
  api.use(cardRoutes(ctx));
  api.use((_req, _res, next) => next(Object.assign(new Error('Nicht gefunden.'), { status: 404 })));
  app.use('/api', api);

  app.use(express.static(PUBLIC_DIR, { index: 'index.html', maxAge: config.production ? '1h' : 0 }));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

  // Fehlerbehandlung
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    let status = err.status || err.statusCode || 500;
    let message = err.message;
    if (err instanceof NextcloudError) status = err.status;
    if (err.type === 'entity.parse.failed') message = 'Ungültige Anfrage (JSON).';
    if (err.type === 'entity.too.large') message = 'Anfrage zu groß.';
    if (status >= 500) {
      console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
      if (!(err instanceof NextcloudError)) message = 'Interner Fehler.';
    }
    res.status(status).json({ error: message });
  });

  return app;
}
