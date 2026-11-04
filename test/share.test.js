import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, client } from './helpers.js';

let app;
before(async () => { app = await startApp({ allowRegistration: false, baseUrl: 'https://boards.example' }); });
after(() => app.close());
const tok = (link) => link.split('#/l/')[1];

test('Einladungslink: Gast mit Namen, Rechte, Grenzen, Löschen sperrt aus', async () => {
  const owner = client(app.base);
  await owner.register('leitung@schule.de', 'Leitung'); // erste Person darf trotz geschlossener Registrierung
  const { data: { id: boardId } } = await owner.post('/api/boards', { title: 'Projektwoche', templateKey: 'leer' });
  const listId = (await owner.get(`/api/boards/${boardId}`)).data.lists[0].id;

  const created = await owner.post(`/api/boards/${boardId}/links`, { role: 'editor', label: 'Kollegium' });
  assert.equal(created.status, 201);
  assert.match(created.data.link, /^https:\/\/boards\.example\/#\/l\/[\w-]{20,}$/);
  const token = tok(created.data.link);

  const info = await client(app.base).get(`/api/share/${token}`);
  assert.deepEqual([info.data.boardTitle, info.data.role], ['Projektwoche', 'editor']);
  assert.equal((await client(app.base).get('/api/share/falsch')).status, 404);

  // Gast tritt nur mit Namen bei
  const guest = client(app.base);
  assert.equal((await guest.post(`/api/share/${token}/join`, { name: 'X' })).status, 400);
  const joined = await guest.post(`/api/share/${token}/join`, { name: 'Frau Gast' });
  assert.equal(joined.status, 201);
  assert.equal(joined.data.boardId, boardId);
  const me = (await guest.get('/api/auth/me')).data.user;
  assert.deepEqual([me.name, me.isGuest, me.email], ['Frau Gast', true, '']);

  // Gast kann bearbeiten …
  const card = await guest.post(`/api/lists/${listId}/cards`, { title: 'Von Gast angelegt' });
  assert.equal(card.status, 201);
  const board = (await owner.get(`/api/boards/${boardId}`)).data;
  const gm = board.members.find((m) => m.name === 'Frau Gast');
  assert.deepEqual([gm.guest, gm.role, gm.email], [true, 'editor', '']);
  // … aber keine eigenen Boards, keine Nextcloud, keine Links, kein Passwort, keine fremden Boards
  assert.equal((await guest.post('/api/boards', { title: 'Eigenes' })).status, 403);
  assert.equal((await guest.get('/api/nextcloud/files')).status, 403);
  assert.equal((await guest.post(`/api/boards/${boardId}/links`, {})).status, 403);
  assert.equal((await guest.patch('/api/auth/me', { currentPassword: 'x', newPassword: 'neues-passwort-1' })).status, 400);
  const { data: { id: other } } = await owner.post('/api/boards', { title: 'Geheim', templateKey: 'leer' });
  assert.equal((await guest.get(`/api/boards/${other}`)).status, 404);
  // Gäste tauchen nicht in der Verwaltung auf und können sich nicht per Passwort anmelden
  assert.ok(!(await owner.get('/api/admin/users')).data.some((u) => u.name === 'Frau Gast'));

  // Lese-Link
  const ro = await owner.post(`/api/boards/${boardId}/links`, { role: 'viewer', days: 7 });
  const reader = client(app.base);
  await reader.post(`/api/share/${tok(ro.data.link)}/join`, { name: 'Herr Lesend' });
  assert.equal((await reader.post(`/api/lists/${listId}/cards`, { title: 'nein' })).status, 403);
  assert.equal((await reader.post(`/api/cards/${card.data.id}/comments`, { body: 'Lesende dürfen kommentieren' })).status, 201);

  const links = (await owner.get(`/api/boards/${boardId}/links`)).data;
  assert.equal(links.length, 2);
  assert.equal(links.find((l) => l.role === 'editor').guests, 1);
  assert.ok(links.find((l) => l.role === 'viewer').expiresAt);
  assert.equal(links.find((l) => l.role === 'editor').link, created.data.link, 'Link bleibt abrufbar');

  // Link löschen → Gast sofort ausgesperrt, Inhalte bleiben
  const del = await owner.del(`/api/links/${links.find((l) => l.role === 'editor').id}`);
  assert.equal(del.data.removedGuests, 1);
  assert.equal((await guest.get(`/api/boards/${boardId}`)).status, 401);
  assert.equal((await client(app.base).get(`/api/share/${token}`)).status, 404);
  assert.ok((await owner.get(`/api/boards/${boardId}`)).data.cards.some((c) => c.title === 'Von Gast angelegt'));

  // Gastzugang selbst beenden
  assert.equal((await reader.raw('DELETE', '/api/auth/me')).status, 200);
  assert.equal((await reader.get('/api/boards')).status, 401);
});

test('Einladungslink: Konto anlegen trotz geschlossener Registrierung, angemeldete Personen werden Mitglied', async () => {
  const owner = client(app.base);
  await owner.post('/api/auth/login', { email: 'leitung@schule.de', password: 'geheim-passwort-123' });
  const { data: { id: boardId } } = await owner.post('/api/boards', { title: 'Steuergruppe', templateKey: 'leer' });
  const token = tok((await owner.post(`/api/boards/${boardId}/links`, { role: 'viewer' })).data.link);

  const neu = client(app.base);
  assert.equal((await neu.post('/api/auth/register', { email: 'neu@schule.de', name: 'Neu', password: 'geheim-passwort-123' })).status, 403);
  const reg = await neu.post('/api/auth/register', { email: 'neu@schule.de', name: 'Neu', password: 'geheim-passwort-123', shareToken: token });
  assert.equal(reg.status, 201);
  assert.equal(reg.data.boardId, boardId);
  assert.equal((await neu.get(`/api/boards/${boardId}`)).data.board.role, 'viewer');
  assert.equal((await neu.post('/api/boards', { title: 'Eigenes', templateKey: 'leer' })).status, 201, 'richtiges Konto darf Boards anlegen');

  // Bereits Mitglied mit höherer Rolle: Link stuft nicht herab
  const r = await owner.post(`/api/share/${token}/join`);
  assert.equal(r.data.boardId, boardId);
  assert.equal((await owner.get(`/api/boards/${boardId}`)).data.board.role, 'owner');

  // Abgelaufener Link
  const exp = await owner.post(`/api/boards/${boardId}/links`, { days: 1 });
  app.db.prepare("UPDATE share_links SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(exp.data.id);
  assert.equal((await client(app.base).post(`/api/share/${tok(exp.data.link)}/join`, { name: 'Zu spät' })).status, 410);
});
