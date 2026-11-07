import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, client } from './helpers.js';

let app;
before(async () => { app = await startApp(); });
after(() => app.close());

async function card(c, boardId, title) {
  const listId = (await c.get(`/api/boards/${boardId}`)).data.lists[0].id;
  return (await c.post(`/api/lists/${listId}/cards`, { title })).data.id;
}

test('Karten verknüpfen: beidseitig, über Boards hinweg, sichtbar nur mit Zugang', async () => {
  const a = client(app.base);
  await a.register('a@schule.de', 'Anna');
  const b1 = (await a.post('/api/boards', { title: 'Medienkonzept', templateKey: 'leer' })).data.id;
  const b2 = (await a.post('/api/boards', { title: 'Fortbildung', templateKey: 'leer' })).data.id;
  const k1 = await card(a, b1, 'WLAN ausbauen');
  const k2 = await card(a, b1, 'Tablets beschaffen');
  const k3 = await card(a, b2, 'Fortbildung Tablets');

  // Suche findet Karten aus allen eigenen Boards, eigenes Board zuerst, nicht sich selbst
  const cand = (await a.get(`/api/cards/${k1}/link-candidates?q=tablet`)).data;
  assert.deepEqual(cand.map((x) => x.id), [k2, k3]);
  assert.equal(cand[0].sameBoard, true);
  assert.equal((await a.get(`/api/cards/${k1}/link-candidates?q=100%`)).data.length, 0, 'Platzhalter werden maskiert');

  assert.equal((await a.post(`/api/cards/${k1}/links`, { cardId: k1 })).status, 400);
  assert.equal((await a.post(`/api/cards/${k1}/links`, { cardId: k2 })).status, 201);
  assert.equal((await a.post(`/api/cards/${k1}/links`, { cardId: k2 })).status, 200, 'doppelt ist harmlos');
  await a.post(`/api/cards/${k3}/links`, { cardId: k1 });

  const full1 = (await a.get(`/api/cards/${k1}`)).data;
  assert.deepEqual(full1.linkedCards.map((x) => x.title).sort(), ['Fortbildung Tablets', 'Tablets beschaffen']);
  assert.equal(full1.linkedCards.find((x) => x.id === k3).boardTitle, 'Fortbildung');
  assert.equal((await a.get(`/api/cards/${k2}`)).data.linkedCards[0].id, k1, 'beidseitig');
  assert.equal((await a.get(`/api/boards/${b1}`)).data.cards.find((x) => x.id === k1).links, 2);
  assert.ok((await a.get(`/api/cards/${k1}`)).data.activity.some((x) => x.action === 'card.linked'));
  assert.ok(!(await a.get(`/api/cards/${k1}/link-candidates`)).data.some((x) => x.id === k2), 'schon verknüpft');

  // Andere Person nur im Board "Medienkonzept": sieht die Verknüpfung ins fremde Board nicht
  const t = client(app.base);
  await t.register('t@schule.de', 'Tom');
  await a.post(`/api/boards/${b1}/members`, { email: 't@schule.de', role: 'editor' });
  const seen = (await t.get(`/api/cards/${k1}`)).data.linkedCards.map((x) => x.id);
  assert.deepEqual(seen, [k2]);
  assert.equal((await t.post(`/api/cards/${k2}/links`, { cardId: k3 })).status, 404, 'kein Zugang zum Ziel-Board');
  assert.ok(!(await t.get(`/api/cards/${k2}/link-candidates`)).data.some((x) => x.id === k3));

  // Lösen und Löschen
  await a.del(`/api/cards/${k1}/links/${k2}`);
  assert.equal((await a.get(`/api/cards/${k2}`)).data.linkedCards.length, 0);
  await a.del(`/api/cards/${k3}`);
  assert.equal((await a.get(`/api/cards/${k1}`)).data.linkedCards.length, 0, 'Verknüpfung verschwindet mit der Karte');
});
