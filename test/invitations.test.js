import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, client } from './helpers.js';

const sent = [];
const mailer = { enabled: true, async send(m) { sent.push(m); return true; } };
let app;
before(async () => {
  // Registrierung geschlossen + Domain-Beschränkung: Einladung muss trotzdem funktionieren
  app = await startApp({ allowRegistration: false, registrationDomains: ['schule.de'], baseUrl: 'https://boards.example' }, { mailer });
});
after(() => app.close());

const tokenFrom = (link) => link.split('#/invite/')[1];

test('Einladung per E-Mail: Registrierung über Link, Annahme, Verwaltung', async () => {
  const owner = client(app.base);
  await owner.register('leitung@schule.de', 'Frau Leitung'); // erste Person darf immer
  const { data: { id: boardId } } = await owner.post('/api/boards', { title: 'Lesekonzept', templateKey: 'leer' });

  // Unbekannte Adresse → Einladung + Mail
  const r = await owner.post(`/api/boards/${boardId}/members`, { email: 'Extern@Partner.org', role: 'viewer' });
  assert.equal(r.status, 201);
  assert.equal(r.data.status, 'invited');
  assert.equal(r.data.mailed, true);
  assert.match(r.data.link, /^https:\/\/boards\.example\/#\/invite\//);
  const mail = sent.at(-1);
  assert.equal(mail.to, 'extern@partner.org');
  assert.match(mail.subject, /Lesekonzept/);
  assert.ok(mail.text.includes(r.data.link));
  assert.ok(mail.html.includes('Frau Leitung'));

  // Offene Einladungen sehen
  const list = await owner.get(`/api/boards/${boardId}/invitations`);
  assert.equal(list.data.length, 1);

  // Erneut senden → altes Token ungültig
  const again = await owner.post(`/api/invitations/${list.data[0].id}/resend`);
  assert.equal((await client(app.base).get(`/api/invitations/token/${tokenFrom(r.data.link)}`)).status, 404);
  const token = tokenFrom(again.data.link);

  // Öffentliche Info
  const info = await client(app.base).get(`/api/invitations/token/${token}`);
  assert.deepEqual([info.data.boardTitle, info.data.role, info.data.accountExists, info.data.inviter], ['Lesekonzept', 'viewer', false, 'Frau Leitung']);

  // Ohne Einladung keine Registrierung
  const guest = client(app.base);
  assert.equal((await guest.post('/api/auth/register', { email: 'x@schule.de', name: 'X', password: 'geheim-passwort-123' })).status, 403);
  // Mit Einladung: E-Mail wird aus der Einladung übernommen, Domain-Grenze gilt nicht
  const reg = await guest.post('/api/auth/register', { email: 'andere@schule.de', name: 'Herr Extern', password: 'geheim-passwort-123', inviteToken: token });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  assert.equal(reg.data.user.email, 'extern@partner.org');
  assert.equal(reg.data.boardId, boardId);
  const board = (await guest.get(`/api/boards/${boardId}`)).data;
  assert.equal(board.board.role, 'viewer');
  assert.equal((await owner.get(`/api/boards/${boardId}/invitations`)).data.length, 0);

  // Token kein zweites Mal nutzbar
  assert.equal((await client(app.base).post('/api/auth/register', { name: 'Y', password: 'geheim-passwort-123', inviteToken: token })).status, 400);
});

test('Bestehendes Konto: direkt hinzufügen + Benachrichtigung; Einladung annehmen als angemeldete Person', async () => {
  const owner = client(app.base);
  await owner.post('/api/auth/login', { email: 'leitung@schule.de', password: 'geheim-passwort-123' });
  const { data: { id: boardId } } = await owner.post('/api/boards', { title: 'Medien', templateKey: 'leer' });

  const r = await owner.post(`/api/boards/${boardId}/members`, { email: 'extern@partner.org', role: 'editor' });
  assert.equal(r.data.status, 'added');
  assert.match(sent.at(-1).subject, /hinzugefügt/);

  // Einladung an neue Adresse, aber angenommen von bereits angemeldeter Person
  const inv = await owner.post(`/api/boards/${boardId}/members`, { email: 'neu@schule.de' });
  const token = tokenFrom(inv.data.link);
  const ext = client(app.base);
  await ext.post('/api/auth/login', { email: 'extern@partner.org', password: 'geheim-passwort-123' });
  assert.equal((await client(app.base).post(`/api/invitations/token/${token}/accept`)).status, 401);
  const acc = await ext.post(`/api/invitations/token/${token}/accept`);
  assert.equal(acc.data.boardId, boardId);
  // Rolle bleibt "editor" (Einladung war editor), Mehrfachannahme durch dieselbe Person ok
  assert.equal((await ext.post(`/api/invitations/token/${token}/accept`)).status, 200);

  // Zurückziehen
  const inv2 = await owner.post(`/api/boards/${boardId}/members`, { email: 'zurueck@schule.de' });
  const pending = (await owner.get(`/api/boards/${boardId}/invitations`)).data;
  assert.equal((await ext.del(`/api/invitations/${pending[0].id}`)).status, 403, 'nur Verantwortliche');
  assert.equal((await owner.del(`/api/invitations/${pending[0].id}`)).status, 200);
  assert.equal((await client(app.base).get(`/api/invitations/token/${tokenFrom(inv2.data.link)}`)).status, 404);
});

test('Ohne SMTP: Einladung funktioniert, Link wird zum Kopieren zurückgegeben', async () => {
  const noMail = await startApp();
  try {
    const owner = client(noMail.base);
    await owner.register('a@schule.de');
    const { data: { id } } = await owner.post('/api/boards', { title: 'B', templateKey: 'leer' });
    const r = await owner.post(`/api/boards/${id}/members`, { email: 'b@schule.de' });
    assert.equal(r.data.mailed, false);
    assert.match(r.data.link, /#\/invite\//);
    assert.equal((await owner.get('/api/auth/me')).data.config.mailEnabled, false);
  } finally {
    await noMail.close();
  }
});
