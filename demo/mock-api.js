/**
 * Klick-Dummy: bildet die REST-API von Schulentwicklungsboards im Browser nach.
 * Fängt fetch('/api/...') ab, hält alle Daten im Speicher und (wenn möglich) im
 * localStorage dieses Browsers. Kein Server, keine echte Nextcloud, keine echten E-Mails.
 */
import { getTemplate, templateSummaries } from '../js/templates.js';

const KEY = 'seb-klickdummy-v1';
const NC_SERVER = 'https://cloud.example.org';
const BASE_FOLDER = 'Schulentwicklung';
const RANK = { viewer: 1, editor: 2, owner: 3 };

let S;

// ---------------- Hilfen ----------------
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
const ago = (days, hours = 0) => stamp(new Date(Date.now() - days * 86400000 - hours * 3600000));
const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };
const id = () => ++S.seq;
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const bad = (m) => fail(400, m);
const byPos = (a, b) => a.position - b.position || a.id - b.id;
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 32);
const str = (v, name, max = 300, required = false) => {
  if (v === undefined || v === null) { if (required) bad(`${name} fehlt.`); return undefined; }
  const t = String(v).trim();
  if (required && !t) bad(`${name} darf nicht leer sein.`);
  if (t.length > max) bad(`${name} ist zu lang.`);
  return t;
};

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* privates Fenster o. Ä. – Demo läuft im Speicher weiter */ }
}
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const s = JSON.parse(raw); if (s?.v === 1) return s; }
  } catch { /* ignorieren */ }
  return null;
}

const me = () => S.users.find((u) => u.id === S.me) || null;
const requireMe = () => me() || fail(401, 'Bitte oben eine Demo-Person auswählen.');
const user = (uid) => S.users.find((u) => u.id === uid);

function log(boardId, cardId, userId, action, details = {}) {
  S.activities.push({ id: id(), board_id: boardId, card_id: cardId ?? null, user_id: userId, action, details, created_at: stamp() });
}
const touch = (boardId) => { const b = S.boards.find((x) => x.id === boardId); if (b) b.updated_at = stamp(); };

function roleIn(boardId, uid = S.me) {
  return S.members.find((m) => m.board_id === boardId && m.user_id === uid)?.role || null;
}
function access(boardId, min = 'viewer') {
  const u = requireMe();
  const r = roleIn(Number(boardId), u.id);
  if (!r) fail(404, 'Board nicht gefunden.');
  if (RANK[r] < RANK[min]) fail(403, min === 'owner' ? 'Nur Board-Verantwortliche dürfen das.' : 'Du hast nur Leserechte in diesem Board.');
  return { boardId: Number(boardId), role: r, user: u };
}
const via = (coll, oid, min, boardOf) => {
  const o = S[coll].find((x) => x.id === Number(oid)) || fail(404, 'Nicht gefunden.');
  return { ...access(boardOf(o), min), obj: o };
};
const viaList = (oid, min) => via('lists', oid, min, (l) => l.board_id);
const viaCard = (oid, min) => via('cards', oid, min, (c) => c.board_id);
const cardOfChecklist = (cl) => S.cards.find((c) => c.id === cl.card_id);
const viaChecklist = (oid, min) => via('checklists', oid, min, (cl) => cardOfChecklist(cl).board_id);
const viaItem = (oid, min) => via('items', oid, min, (i) => cardOfChecklist(S.checklists.find((cl) => cl.id === i.checklist_id)).board_id);

function nextPos(arr) { return (arr.reduce((m, x) => Math.max(m, x.position), 0) || 0) + 1024; }
function place(siblings, moved, index) {
  const rest = siblings.filter((x) => x.id !== moved.id).sort(byPos);
  const i = Math.max(0, Math.min(Number.isInteger(index) ? index : rest.length, rest.length));
  rest.splice(i, 0, moved);
  rest.forEach((x, n) => { x.position = (n + 1) * 1024; });
}

// ---------------- Nextcloud (simuliert) ----------------
function ncTree(uid) { S.ncFiles[uid] ||= {}; return S.ncFiles[uid]; }
function ncAdd(uid, path, { dir = false, size = 0, mime = null } = {}) {
  const t = ncTree(uid);
  const parts = path.split('/').filter(Boolean);
  let cur = '';
  parts.forEach((p, i) => {
    cur += `/${p}`;
    const last = i === parts.length - 1;
    if (!t[cur]) t[cur] = { path: cur, name: p, isDir: last ? dir : true, size: last ? size : 0, mime: last && !dir ? mime : null, fileId: String(id()), modified: new Date(Date.now() - Math.random() * 30 * 86400000).toUTCString() };
  });
  return t[cur];
}
const ncLink = (e) => `${NC_SERVER}/index.php/f/${e.fileId}`;
const entryJson = (e) => ({ name: e.name, path: e.path, isDir: e.isDir, size: e.size, mime: e.isDir ? null : e.mime, modified: e.modified, fileId: e.fileId, link: ncLink(e) });
function ncList(uid, path) {
  const t = ncTree(uid);
  const p = path === '/' ? '/' : path.replace(/\/+$/, '');
  if (p !== '/' && !t[p]) fail(404, 'Ordner lesen: nicht gefunden.');
  const parentOf = (x) => x.slice(0, x.lastIndexOf('/')) || '/';
  const entries = Object.values(t).filter((e) => parentOf(e.path) === p)
    .sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name, 'de'));
  const self = p === '/' ? { path: '/', name: '/', isDir: true, fileId: '1', size: 0 } : t[p];
  return { path: p, self: entryJson(self), entries: entries.map(entryJson) };
}
const cleanPath = (p) => {
  const segs = String(p || '').split('/').filter((s) => s && s !== '.');
  if (segs.includes('..')) bad('Ungültiger Pfad.');
  return `/${segs.join('/')}`;
};
const inside = (root, p) => p === root || p.startsWith(`${root}/`);
const safeName = (n, f = 'Datei') => (String(n || '').replace(/[/\\]+/g, '-').replace(/[:*?"<>|]+/g, ' ').trim() || f).slice(0, 180);
function freeName(uid, folder, name) {
  const t = ncTree(uid);
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; i < 100; i++) {
    const c = i === 1 ? name : `${base} (${i})${ext}`;
    if (!t[`${folder}/${c}`]) return c;
  }
  return `${base} (${Date.now()})${ext}`;
}
function folderOf(boardId) {
  const b = S.boards.find((x) => x.id === boardId);
  if (!b.folder) fail(409, 'Für dieses Board ist noch kein Nextcloud-Ordner verknüpft.');
  if (!S.nc[b.folder.ownerId]) fail(409, 'Der Board-Ordner ist nicht erreichbar: Die Person, die ihn verknüpft hat, hat ihre Nextcloud getrennt.');
  return b.folder;
}
function createBoardFolder(boardId, uid, title, subfolders = []) {
  if (!S.nc[uid]) fail(409, 'Keine Nextcloud verbunden. Bitte unter „Konto“ die Nextcloud verbinden.');
  ncAdd(uid, `/${BASE_FOLDER}`, { dir: true });
  const name = freeName(uid, `/${BASE_FOLDER}`, safeName(title, 'Board'));
  const folder = ncAdd(uid, `/${BASE_FOLDER}/${name}`, { dir: true });
  subfolders.forEach((s) => ncAdd(uid, `${folder.path}/${safeName(s)}`, { dir: true }));
  const b = S.boards.find((x) => x.id === boardId);
  b.folder = { path: folder.path, fileId: folder.fileId, ownerId: uid };
  return folder;
}

// ---------------- Boards & Karten ----------------
function createList(boardId, title) {
  const l = { id: id(), board_id: boardId, title, position: nextPos(S.lists.filter((x) => x.board_id === boardId)), archived: false };
  S.lists.push(l);
  return l;
}
function createCard(boardId, listId, uid, { title, description = '', due = null }) {
  const c = {
    id: id(), board_id: boardId, list_id: listId, title, description, position: nextPos(S.cards.filter((x) => x.list_id === listId)),
    start_date: null, due_date: due, completed: false, archived: false, created_by: uid, created_at: stamp(), updated_at: stamp(),
  };
  S.cards.push(c);
  return c;
}
function createChecklist(cardId, title, items = []) {
  const cl = { id: id(), card_id: cardId, title, position: nextPos(S.checklists.filter((x) => x.card_id === cardId)) };
  S.checklists.push(cl);
  items.forEach((t, i) => S.items.push({ id: id(), checklist_id: cl.id, text: t, done: false, position: (i + 1) * 1024, assignee_id: null, due_date: null }));
  return cl;
}
function createBoard(uid, { title, description = '', color, template }) {
  const b = { id: id(), title, description, color: color || template?.color || '#2f6f9f', template_key: template?.key || null, archived: false, folder: null, created_by: uid, created_at: stamp(), updated_at: stamp() };
  S.boards.push(b);
  S.members.push({ board_id: b.id, user_id: uid, role: 'owner' });
  if (template) {
    const labelIds = new Map();
    for (const l of template.labels || []) { const lab = { id: id(), board_id: b.id, name: l.name, color: l.color }; S.labels.push(lab); labelIds.set(l.name, lab.id); }
    for (const list of template.lists) {
      const l = createList(b.id, list.title);
      for (const c of list.cards || []) {
        const card = createCard(b.id, l.id, uid, { title: c.title, description: c.description || '', due: c.dueInDays ? day(c.dueInDays) : null });
        for (const n of c.labels || []) if (labelIds.has(n)) S.cardLabels.push({ card_id: card.id, label_id: labelIds.get(n) });
        for (const cl of c.checklists || []) createChecklist(card.id, cl.title, cl.items);
      }
    }
  }
  log(b.id, null, uid, 'board.created', { template: template?.key || null });
  return b;
}

const boardJson = (b, role) => {
  const owner = b.folder ? user(b.folder.ownerId) : null;
  return {
    id: b.id, title: b.title, description: b.description, color: b.color, templateKey: b.template_key, archived: !!b.archived,
    createdAt: b.created_at, updatedAt: b.updated_at, role,
    folder: b.folder ? { path: b.folder.path, fileId: b.folder.fileId, ownerId: b.folder.ownerId, ownerName: owner?.name || null } : null,
  };
};
const itemsOfCard = (cid) => {
  const cls = new Set(S.checklists.filter((cl) => cl.card_id === cid).map((cl) => cl.id));
  return S.items.filter((i) => cls.has(i.checklist_id));
};
function cardSummary(c) {
  const items = itemsOfCard(c.id);
  return {
    id: c.id, listId: c.list_id, title: c.title, position: c.position, startDate: c.start_date, dueDate: c.due_date,
    completed: !!c.completed, archived: !!c.archived, hasDescription: !!c.description,
    checklist: { done: items.filter((i) => i.done).length, total: items.length },
    attachments: S.attachments.filter((a) => a.card_id === c.id).length,
    comments: S.comments.filter((x) => x.card_id === c.id).length,
    labels: S.cardLabels.filter((x) => x.card_id === c.id).map((x) => x.label_id),
    members: S.cardMembers.filter((x) => x.card_id === c.id).map((x) => x.user_id),
  };
}
function membersOf(boardId) {
  const order = { owner: 0, editor: 1, viewer: 2 };
  return S.members.filter((m) => m.board_id === boardId).map((m) => ({ ...user(m.user_id), role: m.role }))
    .sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name, 'de'))
    .map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, nextcloud: !!S.nc[u.id] }));
}
function activities(filter, limit = 50) {
  return S.activities.filter(filter).sort((a, b) => b.id - a.id).slice(0, limit).map((a) => ({
    id: a.id, cardId: a.card_id, action: a.action, details: a.details, createdAt: a.created_at,
    userName: user(a.user_id)?.name || null, cardTitle: S.cards.find((c) => c.id === a.card_id)?.title || null,
  }));
}
function fullBoard(boardId, role) {
  const b = S.boards.find((x) => x.id === boardId);
  const lists = S.lists.filter((l) => l.board_id === boardId && !l.archived).sort(byPos);
  const listIds = new Set(lists.map((l) => l.id));
  return {
    board: boardJson(b, role),
    members: membersOf(boardId),
    labels: S.labels.filter((l) => l.board_id === boardId).map(({ id: lid, name, color }) => ({ id: lid, name, color })),
    lists: lists.map(({ id: lid, title, position }) => ({ id: lid, title, position })),
    cards: S.cards.filter((c) => c.board_id === boardId && !c.archived && listIds.has(c.list_id)).sort(byPos).map(cardSummary),
  };
}
function fullCard(cid) {
  const c = S.cards.find((x) => x.id === cid);
  return {
    ...cardSummary(c), boardId: c.board_id, description: c.description, createdAt: c.created_at, updatedAt: c.updated_at,
    creator: user(c.created_by)?.name || null,
    checklists: S.checklists.filter((cl) => cl.card_id === cid).sort(byPos).map((cl) => ({
      id: cl.id, title: cl.title,
      items: S.items.filter((i) => i.checklist_id === cl.id).sort(byPos).map((i) => ({ id: i.id, text: i.text, done: !!i.done, assigneeId: i.assignee_id, dueDate: i.due_date })),
    })),
    comments: S.comments.filter((x) => x.card_id === cid).sort((a, b) => b.id - a.id)
      .map((x) => ({ id: x.id, body: x.body, createdAt: x.created_at, userId: x.user_id, userName: user(x.user_id)?.name || null })),
    attachmentList: S.attachments.filter((a) => a.card_id === cid).sort((a, b) => b.id - a.id)
      .map((a) => ({ id: a.id, kind: a.kind, name: a.name, url: a.url, path: a.path, fileId: a.fileId, mime: a.mime, size: a.size, createdAt: a.created_at, addedBy: user(a.added_by)?.name || null })),
    activity: activities((a) => a.card_id === cid, 50),
  };
}
function addAttachment(boardId, cardId, uid, a) {
  const att = { id: id(), card_id: cardId, added_by: uid, created_at: stamp(), path: null, fileId: null, mime: null, size: null, ...a };
  S.attachments.push(att);
  log(boardId, cardId, uid, 'attachment.added', { name: att.name });
  touch(boardId);
  return att;
}

// ---------------- E-Mails (simuliert) ----------------
const ROLE = { owner: 'Verantwortlich', editor: 'Bearbeiten', viewer: 'Lesen' };
const inviteLink = (t) => `${location.href.split('#')[0]}#/invite/${t}`;
function mail(to, subject, lines, extra = {}) {
  S.outbox.unshift({ id: id(), to, subject, text: lines.join('\n\n'), at: stamp(), ...extra });
}
function invite(boardId, email, role) {
  const b = S.boards.find((x) => x.id === boardId);
  const t = token();
  let inv = S.invitations.find((i) => i.board_id === boardId && i.email === email && !i.accepted_at);
  const expires = new Date(Date.now() + 14 * 86400000).toISOString();
  if (inv) Object.assign(inv, { token: t, role, expires_at: expires, invited_by: S.me, created_at: stamp() });
  else { inv = { id: id(), board_id: boardId, email, role, token: t, invited_by: S.me, created_at: stamp(), expires_at: expires, accepted_at: null }; S.invitations.push(inv); }
  mail(email, `Einladung zum Board „${b.title}“`, [
    `${me().name} lädt dich ein, im Board „${b.title}“ mitzuarbeiten (Rolle: ${ROLE[role]}).`,
    'Schulentwicklungsboards ist das Werkzeug eurer Schule, um Schulentwicklungsvorhaben mit Karten, Checklisten und Nextcloud-Ordnern zu organisieren.',
    'Mit dem Link kannst du dir ein Konto anlegen bzw. dich anmelden. Er ist 14 Tage gültig und nur für dich bestimmt.',
    `Einladung annehmen: ${inviteLink(t)}`,
  ], { inviteToken: t });
  log(boardId, null, S.me, 'member.invited', { email, role });
  return { id: inv.id, link: inviteLink(t), mailed: true };
}
function acceptInvite(inv, u) {
  const cur = S.members.find((m) => m.board_id === inv.board_id && m.user_id === u.id);
  if (!cur) S.members.push({ board_id: inv.board_id, user_id: u.id, role: inv.role });
  else if (RANK[inv.role] > RANK[cur.role]) cur.role = inv.role;
  inv.accepted_at = stamp();
  inv.accepted_by = u.id;
  log(inv.board_id, null, u.id, 'member.joined', { name: u.name });
  return inv.board_id;
}

// ---------------- Routen ----------------
const routes = [];
const on = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn });

// Auth
on('GET', '/auth/me', () => {
  const u = me();
  const nc = u && S.nc[u.id];
  return {
    user: u ? { id: u.id, email: u.email, name: u.name, isAdmin: !!u.isAdmin } : null,
    csrf: 'demo',
    nextcloud: nc ? { server: NC_SERVER, loginName: nc.loginName, userId: nc.userId, displayName: u.name } : null,
    config: {
      appName: 'Schulentwicklungsboards', allowRegistration: true, registrationDomains: [], nextcloudDefaultUrl: NC_SERVER,
      nextcloudFixed: true, nextcloudBaseFolder: BASE_FOLDER, uploadMaxMb: 50, mailEnabled: true, demo: true,
    },
  };
});
on('POST', '/auth/login', ({ body }) => {
  const u = S.users.find((x) => x.email === String(body.email || '').trim().toLowerCase());
  if (!u) fail(401, 'Im Klick-Dummy bitte eine der Demo-Personen nutzen (Auswahl oben in der Leiste). Das Passwort ist egal.');
  S.me = u.id;
  return { user: { id: u.id, email: u.email, name: u.name, isAdmin: !!u.isAdmin }, csrf: 'demo' };
});
on('POST', '/auth/register', ({ body }) => {
  const inv = body.inviteToken ? S.invitations.find((i) => i.token === body.inviteToken) : null;
  if (body.inviteToken && (!inv || inv.accepted_at)) bad('Die Einladung ist ungültig oder abgelaufen.');
  const email = inv ? inv.email : str(body.email, 'E-Mail', 200, true).toLowerCase();
  const name = str(body.name, 'Name', 100, true);
  if (String(body.password || '').length < 10) bad('Das Passwort muss mindestens 10 Zeichen lang sein.');
  if (S.users.some((u) => u.email === email)) fail(409, 'Diese E-Mail-Adresse ist bereits registriert.');
  const u = { id: id(), email, name, isAdmin: false, about: 'Neu registriert (Demo)' };
  S.users.push(u);
  S.me = u.id;
  const boardId = inv ? acceptInvite(inv, u) : null;
  return { user: { id: u.id, email, name, isAdmin: false }, csrf: 'demo', boardId };
});
on('POST', '/auth/logout', () => { S.me = null; return { ok: true }; });
on('PATCH', '/auth/me', ({ body }) => {
  const u = requireMe();
  if (body.name !== undefined) u.name = str(body.name, 'Name', 100, true);
  if (body.newPassword !== undefined) bad('Im Klick-Dummy gibt es keine echten Passwörter.');
  return { ok: true };
});
on('DELETE', '/auth/me', () => bad('Im Klick-Dummy deaktiviert. In der echten App löscht das Konto alle Boards, in denen man allein ist.'));

// Nextcloud
on('POST', '/nextcloud/login/start', () => {
  const u = requireMe();
  const flowId = token();
  S.flows[flowId] = { userId: u.id, polls: 0 };
  return { flowId, loginUrl: `${NC_SERVER}/login/v2/flow/demo`, server: NC_SERVER };
});
on('POST', '/nextcloud/login/poll', ({ body }) => {
  const u = requireMe();
  const f = S.flows[body.flowId];
  if (!f || f.userId !== u.id) return { status: 'expired' };
  f.polls += 1;
  if (f.polls < 2) return { status: 'pending' };
  delete S.flows[body.flowId];
  const login = u.email.split('@')[0];
  S.nc[u.id] = { loginName: login, userId: login };
  if (!Object.keys(ncTree(u.id)).length) {
    ncAdd(u.id, '/Unterricht/Deutsch/Lesetagebuch Vorlage.docx', { size: 48211, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    ncAdd(u.id, '/Konferenzen/Protokoll Fachkonferenz.pdf', { size: 183004, mime: 'application/pdf' });
  }
  return { status: 'connected', server: NC_SERVER, loginName: login, userId: login, displayName: u.name };
});
on('DELETE', '/nextcloud/connection', () => { const u = requireMe(); delete S.nc[u.id]; return { ok: true, revoked: true }; });
on('GET', '/nextcloud/files', ({ query }) => {
  const u = requireMe();
  if (!S.nc[u.id]) fail(409, 'Keine Nextcloud verbunden. Bitte unter „Konto“ die Nextcloud verbinden.');
  return ncList(u.id, cleanPath(query.get('path') || '/'));
});
on('POST', '/nextcloud/folders', ({ body }) => {
  const u = requireMe();
  if (!S.nc[u.id]) fail(409, 'Keine Nextcloud verbunden.');
  return entryJson(ncAdd(u.id, `${cleanPath(body.parent)}/${safeName(str(body.name, 'Ordnername', 180, true))}`.replace('//', '/'), { dir: true }));
});

// Vorlagen & Boards
on('GET', '/templates', () => templateSummaries());
on('GET', '/boards', () => {
  const u = requireMe();
  return S.members.filter((m) => m.user_id === u.id).map((m) => S.boards.find((b) => b.id === m.board_id)).filter(Boolean)
    .sort((a, b) => (a.archived - b.archived) || b.updated_at.localeCompare(a.updated_at))
    .map((b) => {
      const cards = S.cards.filter((c) => c.board_id === b.id && !c.archived);
      return {
        ...boardJson(b, roleIn(b.id)),
        stats: {
          cards: cards.length, done: cards.filter((c) => c.completed).length,
          overdue: cards.filter((c) => !c.completed && c.due_date && c.due_date < day(0)).length,
          members: S.members.filter((x) => x.board_id === b.id).length,
        },
      };
    });
});
on('POST', '/boards', ({ body }) => {
  const u = requireMe();
  const title = str(body.title, 'Titel', 120, true);
  const template = body.templateKey ? getTemplate(body.templateKey) : null;
  const b = createBoard(u.id, { title, description: str(body.description, 'Beschreibung', 2000) || '', color: body.color, template });
  let folderError = null;
  if (body.createFolder) {
    try { createBoardFolder(b.id, u.id, title, template?.folders || []); } catch (e) { folderError = e.message; }
  }
  return { id: b.id, folderError };
});
on('GET', '/boards/:id', ({ p }) => { const { boardId, role } = access(p.id); return fullBoard(boardId, role); });
on('PATCH', '/boards/:id', ({ p, body }) => {
  const { boardId } = access(p.id, 'editor');
  if (body.archived !== undefined) access(boardId, 'owner');
  const b = S.boards.find((x) => x.id === boardId);
  if (body.title) b.title = str(body.title, 'Titel', 120, true);
  if (body.description !== undefined) b.description = str(body.description, 'Beschreibung', 2000);
  if (body.color) b.color = body.color;
  if (body.archived !== undefined) b.archived = !!body.archived;
  touch(boardId);
  return { ok: true };
});
on('DELETE', '/boards/:id', ({ p }) => {
  const { boardId } = access(p.id, 'owner');
  const cardIds = new Set(S.cards.filter((c) => c.board_id === boardId).map((c) => c.id));
  const clIds = new Set(S.checklists.filter((cl) => cardIds.has(cl.card_id)).map((cl) => cl.id));
  S.boards = S.boards.filter((b) => b.id !== boardId);
  for (const k of ['members', 'labels', 'lists', 'activities', 'invitations']) S[k] = S[k].filter((x) => x.board_id !== boardId);
  S.cards = S.cards.filter((c) => !cardIds.has(c.id));
  for (const k of ['cardLabels', 'cardMembers', 'checklists', 'comments', 'attachments']) S[k] = S[k].filter((x) => !cardIds.has(x.card_id));
  S.items = S.items.filter((i) => !clIds.has(i.checklist_id));
  return { ok: true };
});
on('GET', '/boards/:id/activity', ({ p, query }) => { const { boardId } = access(p.id); return activities((a) => a.board_id === boardId, Number(query.get('limit')) || 100); });
on('GET', '/boards/:id/archive', ({ p }) => {
  const { boardId } = access(p.id);
  const archivedLists = S.lists.filter((l) => l.board_id === boardId && l.archived);
  const al = new Set(archivedLists.map((l) => l.id));
  return {
    lists: archivedLists.map(({ id: lid, title }) => ({ id: lid, title })),
    cards: S.cards.filter((c) => c.board_id === boardId && (c.archived || al.has(c.list_id))).map(cardSummary),
  };
});
on('GET', '/boards/:id/export', ({ p }) => {
  const { boardId, role } = access(p.id);
  const d = fullBoard(boardId, role);
  return {
    exportedAt: new Date().toISOString(), app: 'Schulentwicklungsboards (Klick-Dummy)', board: d.board,
    members: d.members.map(({ name, role: r }) => ({ name, role: r })), labels: d.labels,
    lists: S.lists.filter((l) => l.board_id === boardId).sort(byPos).map(({ id: lid, title, archived }) => ({ id: lid, title, archived })),
    cards: S.cards.filter((c) => c.board_id === boardId).map((c) => { const x = fullCard(c.id); delete x.activity; return x; }),
  };
});

// Mitglieder & Einladungen
on('POST', '/boards/:id/members', ({ p, body }) => {
  const { boardId } = access(p.id, 'owner');
  const email = str(body.email, 'E-Mail', 200, true).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad('Bitte eine gültige E-Mail-Adresse angeben.');
  const role = RANK[body.role] ? body.role : 'editor';
  const u = S.users.find((x) => x.email === email);
  if (!u) return { status: 'invited', ...invite(boardId, email, role) };
  if (roleIn(boardId, u.id)) fail(409, `${u.name} ist bereits Mitglied.`);
  S.members.push({ board_id: boardId, user_id: u.id, role });
  log(boardId, null, S.me, 'member.added', { name: u.name, role });
  const b = S.boards.find((x) => x.id === boardId);
  mail(u.email, `Du wurdest zum Board „${b.title}“ hinzugefügt`, [`${me().name} hat dich zum Board „${b.title}“ hinzugefügt (Rolle: ${ROLE[role]}).`]);
  return { status: 'added', name: u.name, mailed: true };
});
const owners = (boardId) => S.members.filter((m) => m.board_id === boardId && m.role === 'owner').length;
on('PATCH', '/boards/:id/members/:uid', ({ p, body }) => {
  const { boardId } = access(p.id, 'owner');
  const m = S.members.find((x) => x.board_id === boardId && x.user_id === Number(p.uid)) || fail(404, 'Mitglied nicht gefunden.');
  if (!RANK[body.role]) bad('Unbekannte Rolle.');
  if (m.role === 'owner' && body.role !== 'owner' && owners(boardId) === 1) bad('Ein Board braucht mindestens eine verantwortliche Person.');
  m.role = body.role;
  return { ok: true };
});
on('DELETE', '/boards/:id/members/:uid', ({ p }) => {
  const uid = Number(p.uid);
  const { boardId } = access(p.id, uid === S.me ? 'viewer' : 'owner');
  const m = S.members.find((x) => x.board_id === boardId && x.user_id === uid) || fail(404, 'Mitglied nicht gefunden.');
  if (m.role === 'owner' && owners(boardId) === 1) bad('Die letzte verantwortliche Person kann nicht entfernt werden.');
  S.members = S.members.filter((x) => x !== m);
  const cids = new Set(S.cards.filter((c) => c.board_id === boardId).map((c) => c.id));
  S.cardMembers = S.cardMembers.filter((x) => !(x.user_id === uid && cids.has(x.card_id)));
  log(boardId, null, S.me, 'member.removed', { name: user(uid).name });
  return { ok: true };
});
on('GET', '/boards/:id/invitations', ({ p }) => {
  const { boardId } = access(p.id, 'owner');
  return S.invitations.filter((i) => i.board_id === boardId && !i.accepted_at).sort((a, b) => b.id - a.id).map((i) => ({
    id: i.id, email: i.email, role: i.role, createdAt: i.created_at, expiresAt: i.expires_at, invitedBy: user(i.invited_by)?.name, expired: false,
  }));
});
on('POST', '/invitations/:id/resend', ({ p }) => {
  const inv = S.invitations.find((i) => i.id === Number(p.id) && !i.accepted_at) || fail(404, 'Einladung nicht gefunden.');
  access(inv.board_id, 'owner');
  return invite(inv.board_id, inv.email, inv.role);
});
on('DELETE', '/invitations/:id', ({ p }) => {
  const inv = S.invitations.find((i) => i.id === Number(p.id)) || fail(404, 'Einladung nicht gefunden.');
  access(inv.board_id, 'owner');
  S.invitations = S.invitations.filter((i) => i !== inv);
  return { ok: true };
});
on('GET', '/invitations/token/:t', ({ p }) => {
  const inv = S.invitations.find((i) => i.token === p.t) || fail(404, 'Diese Einladung gibt es nicht (mehr). Bitte um einen neuen Link.');
  const b = S.boards.find((x) => x.id === inv.board_id);
  return {
    boardId: b.id, boardTitle: b.title, inviter: user(inv.invited_by)?.name, email: inv.email, role: inv.role,
    expired: false, accepted: !!inv.accepted_at, accountExists: S.users.some((u) => u.email === inv.email),
  };
});
on('POST', '/invitations/token/:t/accept', ({ p }) => {
  const u = requireMe();
  const inv = S.invitations.find((i) => i.token === p.t) || fail(404, 'Diese Einladung gibt es nicht (mehr).');
  if (inv.accepted_at) { if (inv.accepted_by === u.id) return { boardId: inv.board_id }; fail(410, 'Diese Einladung wurde bereits angenommen.'); }
  return { boardId: acceptInvite(inv, u) };
});

// Labels
on('POST', '/boards/:id/labels', ({ p, body }) => {
  const { boardId } = access(p.id, 'editor');
  const l = { id: id(), board_id: boardId, name: str(body.name, 'Name', 40, true), color: body.color || '#5d6d7e' };
  S.labels.push(l);
  return { id: l.id };
});
on('PATCH', '/labels/:id', ({ p, body }) => {
  const { obj } = via('labels', p.id, 'editor', (l) => l.board_id);
  if (body.name) obj.name = str(body.name, 'Name', 40, true);
  if (body.color) obj.color = body.color;
  return { ok: true };
});
on('DELETE', '/labels/:id', ({ p }) => {
  const { obj } = via('labels', p.id, 'editor', (l) => l.board_id);
  S.labels = S.labels.filter((l) => l !== obj);
  S.cardLabels = S.cardLabels.filter((x) => x.label_id !== obj.id);
  return { ok: true };
});

// Listen
on('POST', '/boards/:id/lists', ({ p, body }) => { const { boardId } = access(p.id, 'editor'); touch(boardId); return { id: createList(boardId, str(body.title, 'Titel', 120, true)).id }; });
on('PATCH', '/lists/:id', ({ p, body }) => {
  const { boardId, obj } = viaList(p.id, 'editor');
  if (body.title) obj.title = str(body.title, 'Titel', 120, true);
  if (body.archived !== undefined) {
    obj.archived = !!body.archived;
    if (!obj.archived) place(S.lists.filter((l) => l.board_id === boardId && !l.archived), obj);
  }
  touch(boardId);
  return { ok: true };
});
on('POST', '/lists/:id/move', ({ p, body }) => {
  const { boardId, obj } = viaList(p.id, 'editor');
  place(S.lists.filter((l) => l.board_id === boardId && !l.archived), obj, Number(body.index));
  return { ok: true };
});
on('DELETE', '/lists/:id', ({ p }) => {
  const { obj } = viaList(p.id, 'editor');
  S.lists = S.lists.filter((l) => l !== obj);
  S.cards = S.cards.filter((c) => c.list_id !== obj.id);
  return { ok: true };
});

// Board-Ordner
on('PUT', '/boards/:id/folder', ({ p, body }) => {
  const { boardId, user: u } = access(p.id, 'owner');
  const b = S.boards.find((x) => x.id === boardId);
  let entry;
  if (body.create) entry = createBoardFolder(boardId, u.id, b.title, getTemplate(b.template_key)?.folders || []);
  else {
    if (!S.nc[u.id]) fail(409, 'Keine Nextcloud verbunden.');
    entry = ncTree(u.id)[cleanPath(body.path)];
    if (!entry?.isDir) bad('Bitte einen Ordner auswählen.');
    b.folder = { path: entry.path, fileId: entry.fileId, ownerId: u.id };
  }
  log(boardId, null, u.id, 'folder.linked', { path: entry.path });
  return { path: entry.path, fileId: entry.fileId };
});
on('DELETE', '/boards/:id/folder', ({ p }) => { const { boardId } = access(p.id, 'owner'); S.boards.find((b) => b.id === boardId).folder = null; return { ok: true }; });
on('GET', '/boards/:id/folder/files', ({ p, query }) => {
  const { boardId } = access(p.id);
  const f = folderOf(boardId);
  const path = query.get('path') ? cleanPath(query.get('path')) : f.path;
  if (!inside(f.path, path)) fail(403, 'Außerhalb des Board-Ordners.');
  const r = ncList(f.ownerId, path);
  return { root: f.path, rootLink: `${NC_SERVER}/index.php/f/${f.fileId}`, ...r };
});
on('POST', '/boards/:id/folder/folders', ({ p, body }) => {
  const { boardId } = access(p.id, 'editor');
  const f = folderOf(boardId);
  const parent = body.parent ? cleanPath(body.parent) : f.path;
  if (!inside(f.path, parent)) fail(403, 'Außerhalb des Board-Ordners.');
  return entryJson(ncAdd(f.ownerId, `${parent}/${safeName(str(body.name, 'Ordnername', 180, true))}`, { dir: true }));
});
on('POST', '/boards/:id/folder/share', ({ p }) => {
  const { boardId } = access(p.id, 'owner');
  const f = folderOf(boardId);
  return {
    results: S.members.filter((m) => m.board_id === boardId && m.user_id !== f.ownerId).map((m) => {
      const u = user(m.user_id);
      return S.nc[u.id] ? { name: u.name, status: 'shared' } : { name: u.name, status: 'skipped', message: 'keine Nextcloud verbunden' };
    }),
  };
});

// Karten
on('POST', '/lists/:id/cards', ({ p, body }) => {
  const { boardId, obj, user: u } = viaList(p.id, 'editor');
  const c = createCard(boardId, obj.id, u.id, { title: str(body.title, 'Titel', 300, true) });
  log(boardId, c.id, u.id, 'card.created', { list: obj.title });
  touch(boardId);
  return cardSummary(c);
});
on('GET', '/cards/:id', ({ p }) => { const { role, obj } = viaCard(p.id); return { ...fullCard(obj.id), role }; });
on('PATCH', '/cards/:id', ({ p, body }) => {
  const { boardId, obj: c, user: u } = viaCard(p.id, 'editor');
  if (body.title && body.title.trim() !== c.title) { log(boardId, c.id, u.id, 'card.renamed', { from: c.title, to: body.title.trim() }); c.title = str(body.title, 'Titel', 300, true); }
  if (body.description !== undefined) c.description = String(body.description).slice(0, 20000);
  if (body.startDate !== undefined) c.start_date = body.startDate || null;
  if (body.dueDate !== undefined && (body.dueDate || null) !== c.due_date) { c.due_date = body.dueDate || null; log(boardId, c.id, u.id, 'card.due', { due: c.due_date }); }
  if (body.completed !== undefined && !!body.completed !== !!c.completed) { c.completed = !!body.completed; log(boardId, c.id, u.id, c.completed ? 'card.completed' : 'card.reopened'); }
  if (body.archived !== undefined && !!body.archived !== !!c.archived) {
    c.archived = !!body.archived;
    if (!c.archived) {
      const list = S.lists.find((l) => l.id === c.list_id);
      if (list.archived) c.list_id = S.lists.filter((l) => l.board_id === boardId && !l.archived).sort(byPos)[0]?.id ?? bad('Keine aktive Liste vorhanden.');
      place(S.cards.filter((x) => x.list_id === c.list_id && !x.archived), c);
    }
    log(boardId, c.id, u.id, c.archived ? 'card.archived' : 'card.restored');
  }
  c.updated_at = stamp();
  touch(boardId);
  return cardSummary(c);
});
on('POST', '/cards/:id/move', ({ p, body }) => {
  const { boardId, obj: c, user: u } = viaCard(p.id, 'editor');
  const target = S.lists.find((l) => l.id === Number(body.listId));
  if (!target || target.board_id !== boardId) bad('Zielliste gehört nicht zu diesem Board.');
  const from = S.lists.find((l) => l.id === c.list_id);
  c.list_id = target.id;
  place(S.cards.filter((x) => x.list_id === target.id && !x.archived), c, body.index === undefined ? undefined : Number(body.index));
  if (from.id !== target.id) log(boardId, c.id, u.id, 'card.moved', { from: from.title, to: target.title });
  touch(boardId);
  return { ok: true };
});
on('DELETE', '/cards/:id', ({ p }) => {
  const { boardId, obj: c, user: u } = viaCard(p.id, 'editor');
  const cl = new Set(S.checklists.filter((x) => x.card_id === c.id).map((x) => x.id));
  S.cards = S.cards.filter((x) => x !== c);
  for (const k of ['cardLabels', 'cardMembers', 'checklists', 'comments', 'attachments']) S[k] = S[k].filter((x) => x.card_id !== c.id);
  S.items = S.items.filter((i) => !cl.has(i.checklist_id));
  log(boardId, null, u.id, 'card.deleted', { title: c.title });
  return { ok: true };
});
on('PUT', '/cards/:id/labels/:lid', ({ p }) => {
  const { obj } = viaCard(p.id, 'editor');
  if (!S.cardLabels.some((x) => x.card_id === obj.id && x.label_id === Number(p.lid))) S.cardLabels.push({ card_id: obj.id, label_id: Number(p.lid) });
  return { ok: true };
});
on('DELETE', '/cards/:id/labels/:lid', ({ p }) => { const cid = viaCard(p.id, 'editor').obj.id; S.cardLabels = S.cardLabels.filter((x) => !(x.card_id === cid && x.label_id === Number(p.lid))); return { ok: true }; });
on('PUT', '/cards/:id/members/:uid', ({ p }) => {
  const { boardId, obj, user: u } = viaCard(p.id, 'editor');
  const uid = Number(p.uid);
  if (!roleIn(boardId, uid)) bad('Die Person ist kein Mitglied dieses Boards.');
  if (!S.cardMembers.some((x) => x.card_id === obj.id && x.user_id === uid)) {
    S.cardMembers.push({ card_id: obj.id, user_id: uid });
    log(boardId, obj.id, u.id, 'card.member', { name: user(uid).name });
  }
  return { ok: true };
});
on('DELETE', '/cards/:id/members/:uid', ({ p }) => { const cid = viaCard(p.id, 'editor').obj.id; S.cardMembers = S.cardMembers.filter((x) => !(x.card_id === cid && x.user_id === Number(p.uid))); return { ok: true }; });

// Checklisten
on('POST', '/cards/:id/checklists', ({ p, body }) => {
  const { boardId, obj, user: u } = viaCard(p.id, 'editor');
  const title = str(body.title, 'Titel', 200) || 'Checkliste';
  const cl = createChecklist(obj.id, title, Array.isArray(body.items) ? body.items : []);
  log(boardId, obj.id, u.id, 'checklist.added', { title });
  return { id: cl.id };
});
on('PATCH', '/checklists/:id', ({ p, body }) => { const { obj } = viaChecklist(p.id, 'editor'); if (body.title) obj.title = str(body.title, 'Titel', 200, true); return { ok: true }; });
on('DELETE', '/checklists/:id', ({ p }) => { const { obj } = viaChecklist(p.id, 'editor'); S.checklists = S.checklists.filter((x) => x !== obj); S.items = S.items.filter((i) => i.checklist_id !== obj.id); return { ok: true }; });
on('POST', '/checklists/:id/items', ({ p, body }) => {
  const { obj } = viaChecklist(p.id, 'editor');
  const it = { id: id(), checklist_id: obj.id, text: str(body.text, 'Text', 500, true), done: false, position: nextPos(S.items.filter((i) => i.checklist_id === obj.id)), assignee_id: null, due_date: null };
  S.items.push(it);
  return { id: it.id };
});
on('PATCH', '/checklist-items/:id', ({ p, body }) => {
  const { boardId, obj: it, user: u } = viaItem(p.id, 'editor');
  if (body.text) it.text = str(body.text, 'Text', 500, true);
  if (body.assigneeId !== undefined) {
    if (body.assigneeId !== null && !roleIn(boardId, Number(body.assigneeId))) bad('Die Person ist kein Mitglied dieses Boards.');
    it.assignee_id = body.assigneeId === null ? null : Number(body.assigneeId);
  }
  if (body.dueDate !== undefined) it.due_date = body.dueDate || null;
  if (body.done !== undefined && !!body.done !== !!it.done) {
    it.done = !!body.done;
    if (it.done) log(boardId, S.checklists.find((cl) => cl.id === it.checklist_id).card_id, u.id, 'item.done', { text: it.text });
  }
  touch(boardId);
  return { ok: true };
});
on('POST', '/checklist-items/:id/to-card', ({ p }) => {
  const { boardId, obj: it, user: u } = viaItem(p.id, 'editor');
  const card = S.cards.find((c) => c.id === S.checklists.find((cl) => cl.id === it.checklist_id).card_id);
  const c = createCard(boardId, card.list_id, u.id, { title: it.text, due: it.due_date });
  if (it.assignee_id) S.cardMembers.push({ card_id: c.id, user_id: it.assignee_id });
  S.items = S.items.filter((i) => i !== it);
  log(boardId, c.id, u.id, 'card.created', { fromItem: true });
  return { id: c.id };
});
on('DELETE', '/checklist-items/:id', ({ p }) => { const { obj } = viaItem(p.id, 'editor'); S.items = S.items.filter((i) => i !== obj); return { ok: true }; });

// Kommentare
on('POST', '/cards/:id/comments', ({ p, body }) => {
  const { boardId, obj, user: u } = viaCard(p.id, 'viewer');
  const c = { id: id(), card_id: obj.id, user_id: u.id, body: str(body.body, 'Kommentar', 5000, true), created_at: stamp() };
  S.comments.push(c);
  log(boardId, obj.id, u.id, 'comment.added');
  touch(boardId);
  return { id: c.id };
});
const viaComment = (oid) => via('comments', oid, 'viewer', (c) => S.cards.find((x) => x.id === c.card_id).board_id);
on('PATCH', '/comments/:id', ({ p, body }) => {
  const { obj, user: u } = viaComment(p.id);
  if (obj.user_id !== u.id) fail(403, 'Nur eigene Kommentare können bearbeitet werden.');
  obj.body = str(body.body, 'Kommentar', 5000, true);
  return { ok: true };
});
on('DELETE', '/comments/:id', ({ p }) => {
  const { obj, user: u, role } = viaComment(p.id);
  if (obj.user_id !== u.id && role !== 'owner') fail(403, 'Nur eigene Kommentare können gelöscht werden.');
  S.comments = S.comments.filter((x) => x !== obj);
  return { ok: true };
});

// Anhänge
on('POST', '/cards/:id/attachments/link', ({ p, body }) => {
  const { boardId, obj, user: u } = viaCard(p.id, 'editor');
  let url;
  try { url = new URL(str(body.url, 'Adresse', 2000, true)); } catch { bad('Ungültige Adresse.'); }
  if (!['http:', 'https:'].includes(url.protocol)) bad('Nur http(s)-Links sind erlaubt.');
  return { id: addAttachment(boardId, obj.id, u.id, { kind: 'link', name: str(body.name, 'Name', 200) || url.hostname + url.pathname.replace(/\/$/, ''), url: url.href }).id };
});
on('POST', '/cards/:id/attachments/nextcloud', ({ p, body }) => {
  const { boardId, obj, user: u } = viaCard(p.id, 'editor');
  const path = cleanPath(body.path);
  let owner = u.id;
  if (body.source === 'board') {
    const f = folderOf(boardId);
    if (!inside(f.path, path)) fail(403, 'Außerhalb des Board-Ordners.');
    owner = f.ownerId;
  } else if (!S.nc[u.id]) fail(409, 'Keine Nextcloud verbunden.');
  const e = ncTree(owner)[path] || fail(404, 'Datei nicht gefunden.');
  return { id: addAttachment(boardId, obj.id, u.id, { kind: 'nextcloud', name: e.name, url: ncLink(e), path: e.path, fileId: e.fileId, mime: e.isDir ? 'httpd/unix-directory' : e.mime, size: e.size }).id };
});
on('POST', '/cards/:id/attachments/upload', ({ p, query, blob, headers }) => {
  const { boardId, obj, user: u } = viaCard(p.id, 'editor');
  const f = folderOf(boardId);
  const name = freeName(f.ownerId, f.path, safeName(query.get('name')));
  const e = ncAdd(f.ownerId, `${f.path}/${name}`, { size: blob?.size || 0, mime: headers['Content-Type'] || 'application/octet-stream' });
  return { id: addAttachment(boardId, obj.id, u.id, { kind: 'nextcloud', name: e.name, url: ncLink(e), path: e.path, fileId: e.fileId, mime: e.mime, size: e.size }).id, path: e.path };
});
on('DELETE', '/attachments/:id', ({ p }) => {
  const { obj } = via('attachments', p.id, 'editor', (a) => S.cards.find((c) => c.id === a.card_id).board_id);
  S.attachments = S.attachments.filter((a) => a !== obj);
  return { ok: true };
});

// Meine Aufgaben
on('GET', '/my/tasks', () => {
  const u = requireMe();
  const active = (c) => {
    const b = S.boards.find((x) => x.id === c.board_id);
    const l = S.lists.find((x) => x.id === c.list_id);
    return b && !b.archived && !c.archived && !l.archived && roleIn(b.id, u.id) ? { b, l } : null;
  };
  const cards = S.cardMembers.filter((m) => m.user_id === u.id).map((m) => S.cards.find((c) => c.id === m.card_id))
    .filter((c) => c && !c.completed && active(c)).map((c) => {
      const { b, l } = active(c);
      return { id: c.id, title: c.title, dueDate: c.due_date, completed: false, boardId: b.id, boardTitle: b.title, boardColor: b.color, listTitle: l.title };
    });
  const items = S.items.filter((i) => i.assignee_id === u.id && !i.done).map((i) => {
    const c = S.cards.find((x) => x.id === S.checklists.find((cl) => cl.id === i.checklist_id).card_id);
    const a = active(c);
    return a ? { id: i.id, text: i.text, dueDate: i.due_date, cardId: c.id, cardTitle: c.title, boardId: a.b.id, boardTitle: a.b.title, boardColor: a.b.color } : null;
  }).filter(Boolean);
  return { cards, items };
});

// ---------------- Beispieldaten ----------------
function seed() {
  S = {
    v: 1, seq: 100, me: 1, flows: {}, outbox: [], nc: {}, ncFiles: {},
    users: [], boards: [], members: [], labels: [], lists: [], cards: [], cardLabels: [], cardMembers: [],
    checklists: [], items: [], comments: [], attachments: [], activities: [], invitations: [],
  };
  S.users = [
    { id: 1, email: 'm.schulz@beispielschule.de', name: 'Maria Schulz', isAdmin: true, about: 'Koordination Schulentwicklung' },
    { id: 2, email: 't.becker@beispielschule.de', name: 'Thomas Becker', isAdmin: false, about: 'Fachschaft Deutsch' },
    { id: 3, email: 'a.krueger@beispielschule.de', name: 'Dr. Anna Krüger', isAdmin: false, about: 'Schulleitung, liest meist nur mit' },
    { id: 4, email: 'c.yilmaz@beispielschule.de', name: 'Can Yılmaz', isAdmin: false, about: 'Medienbeauftragter' },
  ];
  S.nc[1] = { loginName: 'm.schulz', userId: 'm.schulz' };
  S.nc[4] = { loginName: 'c.yilmaz', userId: 'c.yilmaz' };
  const pdf = 'application/pdf';
  const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  ncAdd(1, '/Schulprogramm/Schulprogramm 2025.pdf', { size: 1843200, mime: pdf });
  ncAdd(1, '/Schulprogramm/Leitbild.docx', { size: 52300, mime: docx });
  ncAdd(1, '/Konferenzen/Protokoll Gesamtkonferenz 10.09.pdf', { size: 241000, mime: pdf });
  ncAdd(1, '/Konferenzen/Protokoll Schulkonferenz 24.09.pdf', { size: 198500, mime: pdf });
  ncAdd(1, '/Daten/Abschlussquoten 2021-2025.xlsx', { size: 38400, mime: xlsx });
  ncAdd(1, '/Daten/VERA 8 Rückmeldung.pdf', { size: 912000, mime: pdf });
  ncAdd(4, '/Medien/Inventar Endgeräte.xlsx', { size: 64000, mime: xlsx });
  ncAdd(4, '/Medien/WLAN-Ausleuchtung.pdf', { size: 2210000, mime: pdf });

  const at = (cardTitle, b) => S.cards.find((c) => c.board_id === b.id && c.title === cardTitle);
  const lab = (b, name) => S.labels.find((l) => l.board_id === b.id && l.name === name);
  const listOf = (b, title) => S.lists.find((l) => l.board_id === b.id && l.title === title);
  const tick = (c, n, who) => itemsOfCard(c.id).slice(0, n).forEach((i) => { i.done = true; log(c.board_id, c.id, who, 'item.done', { text: i.text }); });
  const comment = (c, uid, body, daysAgo) => { S.comments.push({ id: id(), card_id: c.id, user_id: uid, body, created_at: ago(daysAgo, 2) }); };
  const assign = (c, uid) => S.cardMembers.push({ card_id: c.id, user_id: uid });
  const ncAttach = (c, owner, path, by) => { const e = ncTree(owner)[path]; S.attachments.push({ id: id(), card_id: c.id, kind: 'nextcloud', name: e.name, url: ncLink(e), path: e.path, fileId: e.fileId, mime: e.mime, size: e.size, added_by: by, created_at: ago(3) }); };
  const move = (c, b, listTitle) => { const l = listOf(b, listTitle); c.list_id = l.id; place(S.cards.filter((x) => x.list_id === l.id), c); };

  // Board 1: Medienkonzept
  const m = createBoard(1, { title: 'Medienkonzept 2026/27', description: 'Fortschreibung des Medienkonzepts bis zur Schulkonferenz im Juni.', template: getTemplate('medienkonzept') });
  createBoardFolder(m.id, 1, m.title, getTemplate('medienkonzept').folders);
  ncAdd(1, `${m.folder.path}/Bestandsaufnahme/Umfrage Kollegium Ergebnisse.pdf`, { size: 412000, mime: pdf });
  ncAdd(1, `${m.folder.path}/Konzept/Entwurf Medienkonzept v2.docx`, { size: 96000, mime: docx });
  S.members.push({ board_id: m.id, user_id: 4, role: 'editor' }, { board_id: m.id, user_id: 2, role: 'editor' }, { board_id: m.id, user_id: 3, role: 'viewer' });
  const inv = at('Ausstattung und Infrastruktur erfassen', m);
  tick(inv, 3, 4); assign(inv, 4); inv.due_date = day(-2);
  ncAttach(inv, 4, '/Medien/Inventar Endgeräte.xlsx', 4);
  comment(inv, 4, 'Inventur ist fast fertig. Es fehlt nur noch die Support-Struktur – dazu brauche ich einen Termin mit dem Schulträger.', 2);
  const umf = at('Medienkompetenzen im Kollegium erheben', m);
  tick(umf, 3, 1); umf.completed = true; move(umf, m, 'Beschlossen / Erledigt');
  S.attachments.push({ id: id(), card_id: umf.id, kind: 'nextcloud', name: 'Umfrage Kollegium Ergebnisse.pdf', url: `${NC_SERVER}/index.php/f/900`, path: `${m.folder.path}/Bestandsaufnahme/Umfrage Kollegium Ergebnisse.pdf`, fileId: '900', mime: pdf, size: 412000, added_by: 1, created_at: ago(9) });
  const fc = at('Medienkompetenzen in Fachcurricula verankern', m);
  itemsOfCard(fc.id)[0].done = true; itemsOfCard(fc.id)[0].assignee_id = 2; itemsOfCard(fc.id)[1].assignee_id = 1; itemsOfCard(fc.id)[1].due_date = day(10);
  assign(fc, 2); assign(fc, 1);
  comment(fc, 2, 'Deutsch hat den Kompetenzrahmen in der Fachkonferenz besprochen, Entwurf folgt.', 5);
  comment(fc, 3, 'Danke! Bitte bis zu den Herbstferien alle Fachschaften einbinden.', 4);
  const ds = at('Datenschutzrechtliche Prüfung digitaler Werkzeuge', m);
  assign(ds, 1); S.cardLabels.push({ card_id: ds.id, label_id: lab(m, 'Schulträger').id });
  const ap = at('Ausstattungsplan mit dem Schulträger abstimmen', m);
  ap.description = 'Termin beim Schulträger: Dienstag, 14 Uhr, Rathaus Raum 2.12.\nVorher Bedarfsliste aus der Bestandsaufnahme abstimmen.';
  assign(ap, 4);

  // Board 2: Steuergruppe
  const s = createBoard(1, { title: 'Steuergruppe 2026/27', template: getTemplate('steuergruppe') });
  createBoardFolder(s.id, 1, s.title, getTemplate('steuergruppe').folders);
  S.members.push({ board_id: s.id, user_id: 3, role: 'editor' }, { board_id: s.id, user_id: 2, role: 'editor' });
  const sitz = at('Sitzung vorbereiten', s);
  sitz.title = 'Sitzung am Donnerstag vorbereiten'; sitz.due_date = day(3); assign(sitz, 1); tick(sitz, 2, 1);
  ncAttach(sitz, 1, '/Konferenzen/Protokoll Gesamtkonferenz 10.09.pdf', 1);
  const sp = at('Schulprogramm fortschreiben', s);
  ncAttach(sp, 1, '/Schulprogramm/Schulprogramm 2025.pdf', 1); assign(sp, 3); tick(sp, 1, 3);
  comment(sp, 3, 'Ich bringe den Entwurf des Leitbilds in die nächste Sitzung mit.', 1);
  const neu = createCard(s.id, listOf(s, 'Themenspeicher').id, 2, { title: 'Ganztag: Hausaufgabenkonzept überarbeiten' });
  S.cardLabels.push({ card_id: neu.id, label_id: lab(s, 'Eltern / SV').id });

  // Board 3: Lesekonzept (Thomas ist verantwortlich)
  const l = createBoard(2, { title: 'Lesekonzept Klasse 5/6', description: 'Lesezeit, Lesetagebuch und Leseförderung in den Jahrgängen 5 und 6.', template: getTemplate('pdca') });
  S.members.push({ board_id: l.id, user_id: 1, role: 'editor' }, { board_id: l.id, user_id: 3, role: 'viewer' });
  const ist = at('Bestandsaufnahme / IST-Analyse', l);
  tick(ist, 2, 2); assign(ist, 2); ncAttach(ist, 1, '/Daten/VERA 8 Rückmeldung.pdf', 1);
  const ziele = at('Entwicklungsziele formulieren (SMART)', l);
  assign(ziele, 1);
  comment(ziele, 1, 'Vorschlag: „Bis Juni lesen 80 % der Klassen 5 täglich 20 Minuten im Unterricht.“', 1);
  createCard(l.id, listOf(l, 'Ideen & Bedarfe').id, 2, { title: 'Lesepaten aus Klasse 9 gewinnen' });

  // Aktivitäten etwas in die Vergangenheit legen, damit der Verlauf realistisch wirkt
  S.activities.forEach((a, i) => { a.created_at = ago(14 - Math.min(13, Math.floor(i / 8)), i % 7); });
  S.me = 1;
}

// ---------------- Öffentliche Demo-Steuerung ----------------
export const demo = {
  users: () => S.users.map((u) => ({ ...u, nextcloud: !!S.nc[u.id] })),
  current: () => S.me,
  setUser(uid) { S.me = uid; save(); },
  logout() { S.me = null; save(); },
  reset() { seed(); save(); },
  outbox: () => S.outbox,
  boardId: (title) => S.boards.find((b) => b.title === title)?.id ?? null,
  cardId: (title) => S.cards.find((c) => c.title === title)?.id ?? null,
};

// ---------------- fetch abfangen ----------------
S = load();
if (!S) { seed(); save(); }

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  const i = url.pathname.indexOf('/api/');
  if (i < 0) return realFetch(input, init);
  const path = url.pathname.slice(i + 4);
  const method = (init.method || 'GET').toUpperCase();
  const headers = init.headers || {};
  let body = {};
  let blob = null;
  if (typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch { body = {}; } } else if (init.body instanceof Blob) blob = init.body;
  await new Promise((r) => setTimeout(r, 60 + Math.random() * 90)); // etwas Netzwerkgefühl
  let status = 200;
  let data;
  const route = routes.find((r) => r.method === method && r.re.test(path));
  try {
    if (!route) fail(404, 'Nicht gefunden.');
    data = route.fn({ p: path.match(route.re).groups || {}, body, query: url.searchParams, blob, headers });
    if (method === 'POST' && /\/(boards|lists\/\d+\/cards|checklists|items|comments|labels|attachments\/\w+)$/.test(path)) status = 201;
    if (method !== 'GET') save();
  } catch (err) {
    status = err.status || 500;
    data = { error: err.status ? err.message : `Interner Fehler im Klick-Dummy: ${err.message}` };
    if (!err.status) console.error(err);
  }
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
};
