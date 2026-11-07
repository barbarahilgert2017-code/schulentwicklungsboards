import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, client } from './helpers.js';

let app; let c; let boardId; let board;
before(async () => {
  app = await startApp();
  c = client(app.base);
  await c.register('sg@schule.de', 'Steuergruppe');
  boardId = (await c.post('/api/boards', { title: 'SG', templateKey: 'steuergruppe' })).data.id;
  board = (await c.get(`/api/boards/${boardId}`)).data;
});
after(() => app.close());

test('Uhrzeiten bei Terminen', async () => {
  const card = board.cards.find((x) => x.title === 'Sitzung vorbereiten');
  assert.equal(card.dueTime, '14:00', 'Uhrzeit aus der Vorlage');
  assert.equal((await c.patch(`/api/cards/${card.id}`, { dueTime: '25:00' })).status, 400);
  const r = await c.patch(`/api/cards/${card.id}`, { dueDate: '2030-03-05', dueTime: '09:30', startDate: '2030-03-05', startTime: '08:00' });
  assert.deepEqual([r.data.dueDate, r.data.dueTime, r.data.startTime], ['2030-03-05', '09:30', '08:00']);
  const act = (await c.get(`/api/cards/${card.id}`)).data.activity.find((a) => a.action === 'card.due');
  assert.deepEqual(act.details, { due: '2030-03-05', time: '09:30' });
  // Datum entfernen löscht auch die Uhrzeit; Uhrzeit ohne Datum geht nicht
  const cleared = await c.patch(`/api/cards/${card.id}`, { dueDate: null });
  assert.deepEqual([cleared.data.dueDate, cleared.data.dueTime], [null, null]);
  assert.equal((await c.patch(`/api/cards/${card.id}`, { dueTime: '10:00' })).status, 400);
});

test('Vorlagenkarten: aus Vorlage erstellen, kopieren, nicht in Aufgaben/Statistik', async () => {
  const tpl = board.cards.find((x) => x.title === 'Vorlage: Sitzung');
  assert.equal(tpl.isTemplate, true);
  const me = (await c.get('/api/auth/me')).data.user;
  await c.put(`/api/cards/${tpl.id}/members/${me.id}`);
  await c.patch(`/api/cards/${tpl.id}`, { dueDate: '2000-01-01' }); // überfällig, zählt aber nicht
  const detail = (await c.get(`/api/cards/${tpl.id}`)).data;
  await c.patch(`/api/checklist-items/${detail.checklists[0].items[0].id}`, { done: true });

  const target = board.lists.find((l) => l.title === 'In Arbeit');
  const made = await c.post(`/api/cards/${tpl.id}/copy`, { listId: target.id, title: 'Sitzung 12. März', index: 0 });
  assert.equal(made.status, 201);
  assert.equal(made.data.isTemplate, false);
  assert.equal(made.data.listId, target.id);
  const full = (await c.get(`/api/cards/${made.data.id}`)).data;
  assert.equal(full.title, 'Sitzung 12. März');
  assert.ok(full.description.includes('**Termin:**'));
  assert.equal(full.checklists.length, 2);
  assert.ok(full.checklists.every((cl) => cl.items.every((i) => !i.done)), 'alle Punkte offen');
  assert.deepEqual([full.dueDate, full.dueTime, full.members.length], [null, '14:00', 0]);
  assert.equal(full.labels.length, 1);
  assert.equal((await c.get(`/api/boards/${boardId}`)).data.cards.filter((x) => x.listId === target.id)[0].id, made.data.id);
  assert.ok(full.activity.some((a) => a.action === 'card.created' && a.details.fromTemplate === 'Vorlage: Sitzung'));

  const tasks = (await c.get('/api/my/tasks')).data;
  assert.ok(!tasks.cards.some((x) => x.id === tpl.id), 'Vorlage nicht in Meine Aufgaben');
  const stats = (await c.get('/api/boards')).data.find((b) => b.id === boardId).stats;
  assert.equal(stats.overdue, 0, 'Vorlage zählt nicht als überfällig');

  // Gleich mit Termin erstellen: ohne Uhrzeit gilt die der Vorlage, mit Uhrzeit die eigene
  const withDate = (await c.post(`/api/cards/${tpl.id}/copy`, { listId: target.id, title: 'Sitzung Mai', dueDate: '2031-05-06' })).data;
  assert.deepEqual([withDate.dueDate, withDate.dueTime], ['2031-05-06', '14:00']);
  const ownTime = (await c.post(`/api/cards/${tpl.id}/copy`, { listId: target.id, dueDate: '2031-06-03', dueTime: '09:15' })).data;
  assert.deepEqual([ownTime.dueDate, ownTime.dueTime], ['2031-06-03', '09:15']);
  assert.equal((await c.post(`/api/cards/${tpl.id}/copy`, { dueDate: '03.06.2031' })).status, 400);

  // Beliebige Karte zur Vorlage machen und wieder zurück
  const normal = board.cards.find((x) => x.title === 'Schulprogramm fortschreiben');
  assert.equal((await c.patch(`/api/cards/${normal.id}`, { isTemplate: true })).data.isTemplate, true);
  assert.equal((await c.patch(`/api/cards/${normal.id}`, { isTemplate: false })).data.isTemplate, false);

  // Kopie in fremdes Board verboten
  const other = (await c.post('/api/boards', { title: 'Anderes', templateKey: 'leer' })).data.id;
  const otherList = (await c.get(`/api/boards/${other}`)).data.lists[0].id;
  assert.equal((await c.post(`/api/cards/${tpl.id}/copy`, { listId: otherList })).status, 400);
});
