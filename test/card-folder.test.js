import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, client } from './helpers.js';
import { startMockNextcloud } from './mock-nextcloud.js';

let app; let ncs;
before(async () => { ncs = await startMockNextcloud(); app = await startApp(); });
after(async () => { await app.close(); await ncs.close(); });

async function connect(c, login) {
  const s = await c.post('/api/nextcloud/login/start', { server: ncs.url });
  ncs.approve(login);
  await c.post('/api/nextcloud/login/poll', { flowId: s.data.flowId });
}

test('Eigener Nextcloud-Ordner pro Karte: anlegen, Upload landet dort, durchsuchen, verknüpfen, lösen', async () => {
  const a = client(app.base);
  await a.register('a@schule.de', 'Anna');
  await connect(a, 'anna');
  const boardId = (await a.post('/api/boards', { title: 'Steuergruppe', templateKey: 'leer' })).data.id;
  const listId = (await a.get(`/api/boards/${boardId}`)).data.lists[0].id;
  const cardId = (await a.post(`/api/lists/${listId}/cards`, { title: 'Sitzung 12. Dezember' })).data.id;

  // Ohne Board-Ordner kein automatisches Anlegen
  assert.equal((await a.put(`/api/cards/${cardId}/folder`, { create: true })).status, 409);
  await a.put(`/api/boards/${boardId}/folder`, { create: true });

  const made = await a.put(`/api/cards/${cardId}/folder`, { create: true });
  assert.equal(made.status, 200);
  assert.equal(made.data.path, '/Schulentwicklung/Steuergruppe/Sitzung 12. Dezember');
  assert.match(made.data.link, /\/index\.php\/f\//);
  let card = (await a.get(`/api/cards/${cardId}`)).data;
  assert.equal(card.folder.path, made.data.path);
  assert.equal(card.folder.ownerName, 'Anna');
  assert.equal((await a.get(`/api/boards/${boardId}`)).data.cards[0].hasFolder, true);

  // Upload landet im Kartenordner, nicht im Board-Ordner
  const up = await a.raw('POST', `/api/cards/${cardId}/attachments/upload?name=Tagesordnung.txt`, new TextEncoder().encode('TOP 1'), { 'content-type': 'text/plain' });
  assert.equal(up.data.path, '/Schulentwicklung/Steuergruppe/Sitzung 12. Dezember/Tagesordnung.txt');

  // Durchsuchen + Unterordner, kein Ausbruch nach oben
  const list = (await a.get(`/api/cards/${cardId}/folder/files`)).data;
  assert.ok(list.entries.some((e) => e.name === 'Tagesordnung.txt'));
  assert.equal((await a.post(`/api/cards/${cardId}/folder/folders`, { name: 'Material' })).status, 201);
  assert.equal((await a.get(`/api/cards/${cardId}/folder/files?path=/Schulentwicklung`)).status, 403);
  // Datei aus dem Kartenordner anhängen
  assert.equal((await a.post(`/api/cards/${cardId}/attachments/nextcloud`, { source: 'card', path: `${made.data.path}/Tagesordnung.txt` })).status, 201);

  // Lesende sehen und durchsuchen, ändern aber nichts
  const r = client(app.base);
  await r.register('r@schule.de', 'Leser');
  await a.post(`/api/boards/${boardId}/members`, { email: 'r@schule.de', role: 'viewer' });
  assert.equal((await r.get(`/api/cards/${cardId}/folder/files`)).status, 200);
  assert.equal((await r.raw('DELETE', `/api/cards/${cardId}/folder`)).status, 403);

  // Vorhandenen Ordner aus der eigenen Nextcloud verknüpfen
  ncs.addDir('anna', '/Projekte');
  ncs.addDir('anna', '/Projekte/Lesekonzept');
  const card2 = (await a.post(`/api/lists/${listId}/cards`, { title: 'Lesekonzept' })).data.id;
  assert.equal((await a.put(`/api/cards/${card2}/folder`, { path: '/Projekte/Lesekonzept', source: 'own' })).data.path, '/Projekte/Lesekonzept');
  assert.equal((await a.put(`/api/cards/${card2}/folder`, { path: '/', source: 'own' })).status, 400);
  assert.equal((await a.put(`/api/cards/${card2}/folder`, { path: '/Projekte', source: 'board' })).status, 403, 'nicht im Board-Ordner');

  // Lösen: Uploads gehen wieder in den Board-Ordner
  await a.del(`/api/cards/${cardId}/folder`);
  card = (await a.get(`/api/cards/${cardId}`)).data;
  assert.equal(card.folder, null);
  const up2 = await a.raw('POST', `/api/cards/${cardId}/attachments/upload?name=Notiz.txt`, new TextEncoder().encode('x'), { 'content-type': 'text/plain' });
  assert.equal(up2.data.path, '/Schulentwicklung/Steuergruppe/Notiz.txt');
});
