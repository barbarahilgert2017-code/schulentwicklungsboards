import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, client } from './helpers.js';
import { startMockNextcloud } from './mock-nextcloud.js';
import { normalizeServerUrl, parseMultistatus, cleanPath, isInside, assertServerAllowed } from '../server/nextcloud.js';

let app;
let ncs;
before(async () => { ncs = await startMockNextcloud(); app = await startApp(); });
after(async () => { await app.close(); await ncs.close(); });

async function connect(c, loginName) {
  const start = await c.post('/api/nextcloud/login/start', { server: ncs.url });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  assert.ok(start.data.loginUrl.startsWith(ncs.url));
  assert.equal((await c.post('/api/nextcloud/login/poll', { flowId: start.data.flowId })).data.status, 'pending');
  ncs.approve(loginName);
  const done = await c.post('/api/nextcloud/login/poll', { flowId: start.data.flowId });
  assert.equal(done.data.status, 'connected');
  return done.data;
}

test('Hilfsfunktionen', async () => {
  assert.equal(normalizeServerUrl('cloud.schule.de/'), 'https://cloud.schule.de');
  assert.equal(normalizeServerUrl('https://cloud.schule.de/nextcloud/index.php/apps/files/'), 'https://cloud.schule.de/nextcloud');
  assert.throws(() => normalizeServerUrl('http://cloud.schule.de'));
  assert.throws(() => cleanPath('/a/../b'));
  assert.equal(cleanPath('a//b/'), '/a/b');
  assert.ok(isInside('/A/B', '/A/B/c'));
  assert.ok(!isInside('/A/B', '/A/BC'));
  await assert.rejects(assertServerAllowed('https://127.0.0.1', { allowedHosts: [], allowPrivateNetworks: false }));
  await assert.rejects(assertServerAllowed('https://evil.example', { allowedHosts: ['cloud.schule.de'] }));
  const parsed = parseMultistatus(`<?xml version="1.0"?><D:multistatus xmlns:D="DAV:" xmlns:oc="http://owncloud.org/ns">
    <D:response><D:href>/remote.php/dav/files/a/Ordner%20A/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype><oc:fileid>7</oc:fileid></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
    <D:propstat><D:prop><D:getcontenttype/></D:prop><D:status>HTTP/1.1 404 Not Found</D:status></D:propstat></D:response></D:multistatus>`);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].isDir, true);
  assert.equal(parsed[0].fileId, '7');
});

test('Login Flow v2, Dateiauswahl, Board-Ordner, Upload, Freigabe', async () => {
  const anna = client(app.base);
  await anna.register('anna@schule.de', 'Anna');
  const conn = await connect(anna, 'anna');
  assert.equal(conn.userId, 'anna');
  assert.equal((await anna.get('/api/auth/me')).data.nextcloud.userId, 'anna');

  // Eigene Dateien durchsuchen
  ncs.addDir('anna', '/Konzepte');
  ncs.addFile('anna', '/Konzepte/Leitbild.pdf', 'pdf', 'application/pdf');
  const root = await anna.get('/api/nextcloud/files?path=/');
  assert.ok(root.data.entries.find((e) => e.name === 'Konzepte' && e.isDir));
  const sub = await anna.get('/api/nextcloud/files?path=/Konzepte');
  const pdf = sub.data.entries.find((e) => e.name === 'Leitbild.pdf');
  assert.equal(pdf.mime, 'application/pdf');
  assert.match(pdf.link, /\/index\.php\/f\/\d+$/);

  // Board mit Board-Ordner aus Vorlage
  const created = await anna.post('/api/boards', { title: 'Medienkonzept 2026', templateKey: 'medienkonzept', createFolder: true });
  assert.equal(created.data.folderError, null);
  const boardId = created.data.id;
  const board = (await anna.get(`/api/boards/${boardId}`)).data;
  assert.equal(board.board.folder.path, '/Schulentwicklung/Medienkonzept 2026');
  assert.ok(ncs.state.files.has('anna:/Schulentwicklung/Medienkonzept 2026/Datenschutz'));

  // Gleicher Titel → freier Ordnername
  const second = await anna.post('/api/boards', { title: 'Medienkonzept 2026', createFolder: true });
  assert.equal((await anna.get(`/api/boards/${second.data.id}`)).data.board.folder.path, '/Schulentwicklung/Medienkonzept 2026 (2)');

  // Board-Ordner durchsuchen, Ausbruch verhindern
  const folder = await anna.get(`/api/boards/${boardId}/folder/files`);
  assert.ok(folder.data.entries.find((e) => e.name === 'Konzept'));
  assert.equal((await anna.get(`/api/boards/${boardId}/folder/files?path=/Konzepte`)).status, 403);

  // Datei aus eigener Nextcloud an Karte hängen
  const cardId = board.cards[0].id;
  const att = await anna.post(`/api/cards/${cardId}/attachments/nextcloud`, { source: 'own', path: '/Konzepte/Leitbild.pdf' });
  assert.equal(att.status, 201);

  // Upload in Board-Ordner
  const up = await anna.raw('POST', `/api/cards/${cardId}/attachments/upload?name=${encodeURIComponent('Protokoll 1.json')}`,
    new TextEncoder().encode('{"a":1}'), { 'content-type': 'application/json' });
  assert.equal(up.status, 201, JSON.stringify(up.data));
  assert.equal(up.data.path, '/Schulentwicklung/Medienkonzept 2026/Protokoll 1.json');
  assert.equal(ncs.state.files.get('anna:/Schulentwicklung/Medienkonzept 2026/Protokoll 1.json').content.toString(), '{"a":1}');
  const card = (await anna.get(`/api/cards/${cardId}`)).data;
  assert.equal(card.attachmentList.length, 2);
  assert.ok(card.attachmentList.every((a) => a.kind === 'nextcloud' && a.url.includes('/index.php/f/')));

  // Bernd: Mitglied, eigene Nextcloud → Freigabe
  const bernd = client(app.base);
  await bernd.register('bernd@schule.de', 'Bernd');
  await anna.post(`/api/boards/${boardId}/members`, { email: 'bernd@schule.de', role: 'editor' });
  // Bernd kann ohne eigene Nextcloud trotzdem in den Board-Ordner hochladen (über Annas Verknüpfung)
  const up2 = await bernd.raw('POST', `/api/cards/${cardId}/attachments/upload?name=Notiz.txt`, new TextEncoder().encode('hallo'), { 'content-type': 'text/plain' });
  assert.equal(up2.status, 201);
  let share = await anna.post(`/api/boards/${boardId}/folder/share`);
  assert.equal(share.data.results[0].status, 'skipped');
  await connect(bernd, 'bernd');
  share = await anna.post(`/api/boards/${boardId}/folder/share`);
  assert.equal(share.data.results[0].status, 'shared');
  assert.deepEqual(ncs.state.shares.at(-1), { owner: 'anna', path: '/Schulentwicklung/Medienkonzept 2026', shareWith: 'bernd', permissions: 31 });

  // Bernd verknüpft vorhandenen Ordner? Nur Verantwortliche.
  assert.equal((await bernd.put(`/api/boards/${boardId}/folder`, { path: '/' })).status, 403);

  // Trennen widerruft App-Passwort
  await anna.del('/api/nextcloud/connection');
  assert.ok(ncs.state.revoked.includes('anna'));
  assert.equal((await anna.get('/api/nextcloud/files?path=/')).status, 409);
  assert.equal((await bernd.get(`/api/boards/${boardId}/folder/files`)).status, 409);
});

test('Allowlist für Nextcloud-Server', async () => {
  const locked = await startApp({ nextcloud: { allowedHosts: ['cloud.schule.de'] } });
  try {
    const c = client(locked.base);
    await c.register('x@schule.de');
    const r = await c.post('/api/nextcloud/login/start', { server: ncs.url });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /nicht freigegeben/);
  } finally {
    await locked.close();
  }
});
