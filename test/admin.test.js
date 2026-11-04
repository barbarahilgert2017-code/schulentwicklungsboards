import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, client } from './helpers.js';

const sent = [];
const mailer = { enabled: true, async send(m) { sent.push(m); return true; } };
let app;
before(async () => { app = await startApp({ setupCode: 'ABCD-EFGH-JKLM', baseUrl: 'https://boards.example' }, { mailer }); });
after(() => app.close());

const PW = 'geheim-passwort-123';
const tokenFrom = (text) => text.match(/#\/reset\/([\w-]+)/)[1];

test('Ersteinrichtung nur mit Einrichtungscode', async () => {
  const anon = client(app.base);
  const me = await anon.get('/api/auth/me');
  assert.equal(me.data.config.needsSetup, true);
  assert.equal(me.data.config.setupCodeRequired, true);
  const wrong = await anon.post('/api/auth/register', { email: 'fremd@x.de', name: 'Fremd', password: PW, setupCode: 'falsch' });
  assert.equal(wrong.status, 403);
  const ok = await anon.post('/api/auth/register', { email: 'admin@schule.de', name: 'Admin', password: PW, setupCode: 'abcd-efgh-jklm ' });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.user.isAdmin, true);
  assert.equal((await client(app.base).get('/api/auth/me')).data.config.setupCodeRequired, false);
});

test('Passwort vergessen: Mail, Link einmalig, alte Sitzungen beendet', async () => {
  const k = client(app.base);
  await k.register('kollegin@schule.de', 'Kollegin');
  const before = sent.length;
  // Unbekannte Adresse: gleiche Antwort, keine Mail
  const unknown = await client(app.base).post('/api/auth/forgot', { email: 'gibtsnicht@schule.de' });
  assert.deepEqual(unknown.data, { ok: true, mailEnabled: true });
  assert.equal(sent.length, before);
  await client(app.base).post('/api/auth/forgot', { email: 'Kollegin@schule.de' });
  const mail = sent.at(-1);
  assert.equal(mail.to, 'kollegin@schule.de');
  assert.ok(mail.text.includes('https://boards.example/#/reset/'));
  const token = tokenFrom(mail.text);

  const anon = client(app.base);
  assert.equal((await anon.get(`/api/auth/reset/${token}`)).data.email, 'kollegin@schule.de');
  assert.equal((await anon.post(`/api/auth/reset/${token}`, { password: 'kurz' })).status, 400);
  const done = await anon.post(`/api/auth/reset/${token}`, { password: 'ganz-neues-passwort' });
  assert.equal(done.status, 200);
  assert.equal((await anon.get('/api/boards')).status, 200, 'nach dem Zurücksetzen angemeldet');
  assert.equal((await k.get('/api/boards')).status, 401, 'alte Sitzung beendet');
  assert.equal((await client(app.base).post(`/api/auth/reset/${token}`, { password: 'noch-ein-passwort' })).status, 410);
  assert.equal((await client(app.base).post('/api/auth/login', { email: 'kollegin@schule.de', password: 'ganz-neues-passwort' })).status, 200);
});

test('Verwaltung: nur für Admins, Konten, Reset-Link, Rechte, Löschen, Test-Mail', async () => {
  const admin = client(app.base);
  await admin.post('/api/auth/login', { email: 'admin@schule.de', password: PW });
  const normal = client(app.base);
  const n = await normal.register('lehrer@schule.de', 'Lehrer');
  assert.equal((await normal.get('/api/admin/users')).status, 403);

  const status = await admin.get('/api/admin/status');
  assert.equal(status.data.mail.enabled, true);
  assert.ok(status.data.counts.users >= 3);
  const list = (await admin.get('/api/admin/users')).data;
  assert.ok(list.find((u) => u.email === 'lehrer@schule.de' && !u.isAdmin));

  // Reset-Link ohne Mail
  const before = sent.length;
  const link = await admin.post(`/api/admin/users/${n.id}/reset-link`, { send: false });
  assert.match(link.data.link, /#\/reset\//);
  assert.equal(link.data.mailed, false);
  assert.equal(sent.length, before);

  // Admin-Rechte vergeben und wieder entziehen; letzter Admin bleibt
  assert.equal((await admin.patch(`/api/admin/users/${n.id}`, { isAdmin: true })).status, 200);
  assert.equal((await normal.get('/api/admin/users')).status, 200);
  await admin.patch(`/api/admin/users/${n.id}`, { isAdmin: false });
  const adminId = (await admin.get('/api/auth/me')).data.user.id;
  assert.equal((await admin.patch(`/api/admin/users/${adminId}`, { isAdmin: false })).status, 400);
  assert.equal((await admin.raw('DELETE', '/api/auth/me', { password: PW })).status, 409, 'letzter Admin kann sich nicht selbst löschen');

  // Löschen mit Board-Regel
  const { data: { id: boardId } } = await normal.post('/api/boards', { title: 'Geteilt', templateKey: 'leer' });
  await normal.post(`/api/boards/${boardId}/members`, { email: 'admin@schule.de', role: 'editor' });
  assert.equal((await admin.del(`/api/admin/users/${n.id}`)).status, 409);
  await normal.patch(`/api/boards/${boardId}/members/${adminId}`, { role: 'owner' });
  assert.equal((await admin.del(`/api/admin/users/${n.id}`)).status, 200);
  assert.equal((await normal.get('/api/boards')).status, 401);

  const t = await admin.post('/api/admin/test-mail');
  assert.equal(t.data.to, 'admin@schule.de');
  assert.match(sent.at(-1).subject, /Test/);
});

test('Ohne Mailversand: "Passwort vergessen" verweist auf die Administration', async () => {
  const plain = await startApp();
  try {
    await client(plain.base).register('a@schule.de');
    const r = await client(plain.base).post('/api/auth/forgot', { email: 'a@schule.de' });
    assert.deepEqual(r.data, { ok: true, mailEnabled: false });
    assert.equal((await client(plain.base).get('/api/auth/me')).data.config.setupCodeRequired, false);
  } finally {
    await plain.close();
  }
});
