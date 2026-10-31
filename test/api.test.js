import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, client } from './helpers.js';

let app;
before(async () => { app = await startApp(); });
after(() => app.close());

test('Registrierung, Anmeldung, CSRF', async () => {
  const a = client(app.base);
  const user = await a.register('leitung@schule.de', 'Frau Leitung');
  assert.equal(user.isAdmin, true, 'erste Person wird Admin');

  const me = await a.get('/api/auth/me');
  assert.equal(me.data.user.email, 'leitung@schule.de');

  a.setCsrf('falsch');
  const r = await a.post('/api/boards', { title: 'X' });
  assert.equal(r.status, 403);

  const b = client(app.base);
  assert.equal((await b.post('/api/auth/login', { email: 'leitung@schule.de', password: 'falsch-falsch' })).status, 401);
  assert.equal((await b.post('/api/auth/login', { email: 'LEITUNG@schule.de', password: 'geheim-passwort-123' })).status, 200);
  assert.equal((await b.post('/api/auth/register', { email: 'leitung@schule.de', name: 'x', password: 'geheim-passwort-123' })).status, 409);
  assert.equal((await client(app.base).get('/api/boards')).status, 401);
});

test('Board aus Vorlage mit Listen, Karten, Checklisten', async () => {
  const a = client(app.base);
  await a.register('sg@schule.de', 'Steuergruppe');
  const tpl = await a.get('/api/templates');
  assert.ok(tpl.data.find((t) => t.key === 'pdca'));

  const created = await a.post('/api/boards', { title: 'Lesekonzept', templateKey: 'pdca' });
  assert.equal(created.status, 201);
  const { data } = await a.get(`/api/boards/${created.data.id}`);
  assert.equal(data.board.role, 'owner');
  assert.equal(data.lists[0].title, 'Ideen & Bedarfe');
  assert.ok(data.labels.some((l) => l.name === 'Steuergruppe'));
  const analyse = data.cards.find((c) => c.title === 'Bestandsaufnahme / IST-Analyse');
  assert.ok(analyse.checklist.total >= 5);
  assert.ok(analyse.dueDate);
  assert.ok(analyse.labels.length >= 1);
});

test('Kartenlogik: anlegen, verschieben, Checkliste, Mitglieder, Archiv', async () => {
  const a = client(app.base);
  const me = await a.register('kollege@schule.de', 'Kollege');
  const { data: { id: boardId } } = await a.post('/api/boards', { title: 'Test', templateKey: 'leer' });
  let board = (await a.get(`/api/boards/${boardId}`)).data;
  const [todo, doing, done] = board.lists;

  const c1 = (await a.post(`/api/lists/${todo.id}/cards`, { title: 'Karte 1' })).data;
  const c2 = (await a.post(`/api/lists/${todo.id}/cards`, { title: 'Karte 2' })).data;
  const c3 = (await a.post(`/api/lists/${todo.id}/cards`, { title: 'Karte 3' })).data;

  // Karte 3 an den Anfang
  await a.post(`/api/cards/${c3.id}/move`, { listId: todo.id, index: 0 });
  board = (await a.get(`/api/boards/${boardId}`)).data;
  assert.deepEqual(board.cards.filter((c) => c.listId === todo.id).map((c) => c.title), ['Karte 3', 'Karte 1', 'Karte 2']);

  // In andere Liste
  await a.post(`/api/cards/${c1.id}/move`, { listId: doing.id, index: 0 });
  board = (await a.get(`/api/boards/${boardId}`)).data;
  assert.equal(board.cards.find((c) => c.id === c1.id).listId, doing.id);

  // Checkliste
  const cl = (await a.post(`/api/cards/${c1.id}/checklists`, { title: 'Schritte', items: ['A', 'B'] })).data;
  await a.post(`/api/checklists/${cl.id}/items`, { text: 'C' });
  let card = (await a.get(`/api/cards/${c1.id}`)).data;
  assert.equal(card.checklists[0].items.length, 3);
  const itemA = card.checklists[0].items[0];
  await a.patch(`/api/checklist-items/${itemA.id}`, { done: true, assigneeId: me.id, dueDate: '2030-01-15' });
  card = (await a.get(`/api/cards/${c1.id}`)).data;
  assert.deepEqual(card.checklist, { done: 1, total: 3 });

  // Punkt → Karte
  const itemC = card.checklists[0].items[2];
  const conv = await a.post(`/api/checklist-items/${itemC.id}/to-card`);
  assert.equal(conv.status, 201);

  // Mitglied, Fälligkeit, Erledigt
  await a.put(`/api/cards/${c2.id}/members/${me.id}`);
  await a.patch(`/api/cards/${c2.id}`, { dueDate: '2030-02-01', description: 'Beschreibung' });
  const tasks = (await a.get('/api/my/tasks')).data;
  assert.ok(tasks.cards.find((c) => c.id === c2.id));
  assert.ok(tasks.items.find((i) => i.id === itemA.id) === undefined, 'erledigte Punkte nicht in Aufgaben');

  await a.patch(`/api/cards/${c2.id}`, { completed: true });
  await a.post(`/api/cards/${c2.id}/move`, { listId: done.id });

  // Archivieren + wiederherstellen
  await a.patch(`/api/cards/${c3.id}`, { archived: true });
  assert.ok(!(await a.get(`/api/boards/${boardId}`)).data.cards.find((c) => c.id === c3.id));
  assert.ok((await a.get(`/api/boards/${boardId}/archive`)).data.cards.find((c) => c.id === c3.id));
  await a.patch(`/api/cards/${c3.id}`, { archived: false });
  assert.ok((await a.get(`/api/boards/${boardId}`)).data.cards.find((c) => c.id === c3.id));

  // Kommentare + Aktivität
  await a.post(`/api/cards/${c1.id}/comments`, { body: 'Bitte bis Freitag' });
  card = (await a.get(`/api/cards/${c1.id}`)).data;
  assert.equal(card.comments[0].body, 'Bitte bis Freitag');
  assert.ok(card.activity.some((x) => x.action === 'card.moved'));

  // Link-Anhang (nur http/https)
  assert.equal((await a.post(`/api/cards/${c1.id}/attachments/link`, { url: 'javascript:alert(1)' })).status, 400);
  assert.equal((await a.post(`/api/cards/${c1.id}/attachments/link`, { url: 'https://www.kmk.org' })).status, 201);

  // Export
  const exp = await a.get(`/api/boards/${boardId}/export`);
  assert.equal(exp.data.board.title, 'Test');
  assert.ok(exp.data.cards.length >= 4);
});

test('Rechte: Lesende, Fremde, letzte verantwortliche Person', async () => {
  const owner = client(app.base);
  await owner.register('owner@schule.de', 'Owner');
  const reader = client(app.base);
  const readerUser = await reader.register('leser@schule.de', 'Leser');
  const stranger = client(app.base);
  await stranger.register('fremd@schule.de', 'Fremd');

  const { data: { id: boardId } } = await owner.post('/api/boards', { title: 'Geheim', templateKey: 'leer' });
  const listId = (await owner.get(`/api/boards/${boardId}`)).data.lists[0].id;
  const card = (await owner.post(`/api/lists/${listId}/cards`, { title: 'K' })).data;

  assert.equal((await stranger.get(`/api/boards/${boardId}`)).status, 404);
  assert.equal((await stranger.get(`/api/cards/${card.id}`)).status, 404);
  assert.equal((await owner.post(`/api/boards/${boardId}/members`, { email: 'leser@schule.de', role: 'viewer' })).status, 201);

  assert.equal((await reader.get(`/api/boards/${boardId}`)).status, 200);
  assert.equal((await reader.patch(`/api/cards/${card.id}`, { title: 'neu' })).status, 403);
  assert.equal((await reader.post(`/api/cards/${card.id}/comments`, { body: 'Lesende dürfen kommentieren' })).status, 201);
  assert.equal((await reader.del(`/api/boards/${boardId}`)).status, 403);

  // Karte darf nicht in Liste eines fremden Boards verschoben werden
  const { data: { id: other } } = await stranger.post('/api/boards', { title: 'Andere', templateKey: 'leer' });
  const otherList = (await stranger.get(`/api/boards/${other}`)).data.lists[0].id;
  assert.equal((await owner.post(`/api/cards/${card.id}/move`, { listId: otherList })).status, 400);

  // Letzte verantwortliche Person
  const ownerId = (await owner.get('/api/auth/me')).data.user.id;
  assert.equal((await owner.patch(`/api/boards/${boardId}/members/${ownerId}`, { role: 'editor' })).status, 400);
  assert.equal((await reader.del(`/api/boards/${boardId}/members/${readerUser.id}`)).status, 200, 'selbst austreten');
});

test('Registrierung auf Domains beschränken', async () => {
  const restricted = await startApp({ registrationDomains: ['schule.de'] });
  try {
    await client(restricted.base).register('admin@extern.de'); // erste Person immer erlaubt
    const r = await client(restricted.base).post('/api/auth/register', { email: 'x@gmail.com', name: 'x', password: 'geheim-passwort-123' });
    assert.equal(r.status, 400);
    await client(restricted.base).register('ok@schule.de');
  } finally {
    await restricted.close();
  }
});

test('Konto löschen', async () => {
  const a = client(app.base);
  await a.register('weg@schule.de', 'Weg');
  const solo = (await a.post('/api/boards', { title: 'Solo', templateKey: 'leer' })).data.id;
  const shared = (await a.post('/api/boards', { title: 'Geteilt', templateKey: 'leer' })).data.id;
  const b = client(app.base);
  await b.register('bleibt@schule.de', 'Bleibt');
  await a.post(`/api/boards/${shared}/members`, { email: 'bleibt@schule.de', role: 'editor' });

  assert.equal((await a.raw('DELETE', '/api/auth/me', { password: 'falsch' })).status, 400);
  const blocked = await a.raw('DELETE', '/api/auth/me', { password: 'geheim-passwort-123' });
  assert.equal(blocked.status, 409);
  assert.match(blocked.data.error, /Geteilt/);

  const bId = (await b.get('/api/auth/me')).data.user.id;
  await a.patch(`/api/boards/${shared}/members/${bId}`, { role: 'owner' });
  assert.equal((await a.raw('DELETE', '/api/auth/me', { password: 'geheim-passwort-123' })).status, 200);
  assert.equal((await a.get('/api/boards')).status, 401);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM boards WHERE id = ?').get(solo).n, 0);
  assert.equal((await b.get(`/api/boards/${shared}`)).data.members.length, 1);
});
