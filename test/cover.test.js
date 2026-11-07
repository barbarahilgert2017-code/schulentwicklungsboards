import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, client } from './helpers.js';
import { startMockNextcloud } from './mock-nextcloud.js';

let app; let ncs;
before(async () => { ncs = await startMockNextcloud(); app = await startApp(); });
after(async () => { await app.close(); await ncs.close(); });

test('Titelbild: erstes Bild wird automatisch Titelbild, Vorschau aus Nextcloud, wählbar/entfernbar', async () => {
  const a = client(app.base);
  await a.register('a@schule.de', 'Anna');
  const s = await a.post('/api/nextcloud/login/start', { server: ncs.url });
  ncs.approve('anna');
  await a.post('/api/nextcloud/login/poll', { flowId: s.data.flowId });
  ncs.addFile('anna', '/Protokoll.pdf', 'pdf', 'application/pdf');
  ncs.addFile('anna', '/Foto Schulhof.jpg', 'jpegdaten', 'image/jpeg');
  ncs.addFile('anna', '/Plakat.png', 'pngdaten', 'image/png');
  ncs.addFile('anna', '/Logo.svg', '<svg onload="alert(1)"/>', 'image/svg+xml');

  const boardId = (await a.post('/api/boards', { title: 'Projektwoche', templateKey: 'leer', createFolder: true })).data.id;
  const listId = (await a.get(`/api/boards/${boardId}`)).data.lists[0].id;
  const cardId = (await a.post(`/api/lists/${listId}/cards`, { title: 'Schulfest' })).data.id;
  const attach = async (path) => (await a.post(`/api/cards/${cardId}/attachments/nextcloud`, { source: 'own', path })).data.id;

  await attach('/Protokoll.pdf');
  assert.equal((await a.get(`/api/cards/${cardId}`)).data.coverId, null, 'PDF wird kein Titelbild');
  const foto = await attach('/Foto Schulhof.jpg');
  const plakat = await attach('/Plakat.png');
  let card = (await a.get(`/api/cards/${cardId}`)).data;
  assert.equal(card.coverId, foto, 'erstes Bild ist Titelbild');
  assert.equal((await a.get(`/api/boards/${boardId}`)).data.cards[0].coverId, foto, 'auch auf der Kachel');

  // Bild abrufen: Vorschau aus Nextcloud, zwischengespeichert, mit sicheren Kopfzeilen
  const before = ncs.state.previews || 0;
  const r1 = await fetch(`${app.base}/api/attachments/${foto}/cover`, { headers: { cookie: a.cookie() } });
  assert.equal(r1.status, 200);
  assert.equal(r1.headers.get('content-type'), 'image/png');
  assert.match(r1.headers.get('cache-control'), /private, max-age=86400/);
  assert.match(r1.headers.get('content-security-policy'), /sandbox/);
  await fetch(`${app.base}/api/attachments/${foto}/cover`, { headers: { cookie: a.cookie() } });
  assert.equal((ncs.state.previews || 0) - before, 1, 'zweiter Abruf aus dem Zwischenspeicher');

  // Fremde sehen das Bild nicht
  const x = client(app.base);
  await x.register('x@schule.de', 'X');
  assert.equal((await x.get(`/api/attachments/${foto}/cover`)).status, 404);

  // SVG wird nie Titelbild
  const svg = await attach('/Logo.svg');
  assert.equal((await a.patch(`/api/cards/${cardId}`, { coverAttachmentId: svg })).status, 400);
  assert.equal((await a.get(`/api/attachments/${svg}/cover`)).status, 415);

  // Anderes Titelbild wählen, entfernen, gelöschter Anhang
  assert.equal((await a.patch(`/api/cards/${cardId}`, { coverAttachmentId: plakat })).data.coverId, plakat);
  assert.equal((await a.patch(`/api/cards/${cardId}`, { coverAttachmentId: null })).data.coverId, null);
  await a.patch(`/api/cards/${cardId}`, { coverAttachmentId: foto });
  await a.del(`/api/attachments/${foto}`);
  card = (await a.get(`/api/cards/${cardId}`)).data;
  assert.equal(card.coverId, null, 'Titelbild verschwindet mit dem Anhang');

  // Hochgeladenes Bild in den Board-Ordner wird automatisch Titelbild
  const card2 = (await a.post(`/api/lists/${listId}/cards`, { title: 'Plakat' })).data.id;
  const up = await a.raw('POST', `/api/cards/${card2}/attachments/upload?name=Foto.png`, new Uint8Array([137, 80, 78, 71]), { 'content-type': 'image/png' });
  assert.equal(up.status, 201);
  assert.equal((await a.get(`/api/cards/${card2}`)).data.coverId, up.data.id);
});

