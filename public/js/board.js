import { api } from './api.js';
import {
  h, clear, icon, toast, showError, openModal, confirmDialog, popupMenu, inlineEdit,
  fmtDateShort, fmtDateTime, dueState, avatar, fmtWhen, fmtWhenShort,
} from './dom.js';
import { state, navigate, describeActivity } from './state.js';
import { openCard, closeCardModal } from './card.js';
import { openBoardSettings } from './settings.js';
import { openFilePicker } from './filepicker.js';
import { renderInline } from './markdown.js';

const cur = {
  boardId: null,
  data: null,
  root: null,
  listsEl: null,
  filter: { text: '', labels: new Set(), mine: false, due: '' },
  drag: null,
  timer: null,
};

export const board = () => cur.data;
export const canEdit = () => cur.data && cur.data.board.role !== 'viewer';
export const isOwner = () => cur.data?.board.role === 'owner';

export function closeBoard() {
  if (cur.timer) clearInterval(cur.timer);
  cur.timer = null;
  cur.boardId = null;
  cur.data = null;
  closeCardModal();
  document.body.style.removeProperty('--board-color');
}

export async function renderBoard(main, boardId, cardId) {
  if (cur.boardId !== boardId || !main.contains(cur.root)) {
    closeBoard();
    cur.boardId = boardId;
    cur.filter = { text: '', labels: new Set(), mine: false, due: '' };
    cur.data = await api.get(`/boards/${boardId}`);
    state.boardRole = cur.data.board.role;
    clear(main);
    cur.root = h('div', { class: 'board-page' });
    main.append(cur.root);
    draw();
    // Änderungen anderer Mitglieder regelmäßig nachladen
    cur.timer = setInterval(() => {
      if (document.hidden || cur.drag || document.querySelector('.board-page .inline-input, .list-composer textarea:focus')) return;
      refresh(true);
    }, 30_000);
  }
  if (cardId) openCard(cardId, { boardId, onChange: () => refresh() });
  else closeCardModal();
}

export async function refresh(silent = false) {
  if (!cur.boardId) return;
  try {
    cur.data = await api.get(`/boards/${cur.boardId}`);
    state.boardRole = cur.data.board.role;
    draw();
  } catch (err) {
    if (err.status === 404) { toast('Board nicht mehr verfügbar.', 'error'); navigate('#/'); return; }
    if (!silent) showError(err);
  }
}

// ---------------- Zeichnen ----------------

function draw() {
  const { board: b } = cur.data;
  document.body.style.setProperty('--board-color', b.color);
  const scroll = cur.listsEl?.scrollLeft || 0;
  clear(cur.root).append(header(), filterBar(), lists());
  cur.listsEl.scrollLeft = scroll;
}

function header() {
  const { board: b, members } = cur.data;
  const title = h('h1', { class: `board-title ${canEdit() ? 'editable' : ''}`, tabindex: canEdit() ? 0 : undefined, title: canEdit() ? 'Zum Umbenennen klicken' : '' }, b.title);
  if (canEdit()) {
    const edit = () => inlineEdit(title, { value: b.title, maxLength: 120, onSave: async (v) => { await api.patch(`/boards/${b.id}`, { title: v }).catch(showError); refresh(); } });
    title.addEventListener('click', edit);
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') edit(); });
  }
  const menuBtn = h('button', { class: 'btn btn-ghost', 'aria-label': 'Board-Menü', onclick: () => boardMenu(menuBtn) }, icon('menu'), h('span', { class: 'hide-sm' }, ' Menü'));
  return h('div', { class: 'board-head' },
    h('div', { class: 'board-head-left' },
      title,
      b.archived ? h('span', { class: 'badge' }, 'Archiviert') : null,
      b.role === 'viewer' ? h('span', { class: 'badge' }, 'Nur lesen') : null),
    h('div', { class: 'board-head-right' },
      h('button', { class: 'member-stack', title: 'Mitglieder', onclick: () => openBoardSettings(cur.data, 'members', refresh) },
        members.slice(0, 5).map((m) => avatar(m)), members.length > 5 ? h('span', { class: 'avatar avatar-sm more' }, `+${members.length - 5}`) : null),
      isOwner() ? h('button', { class: 'btn btn-ghost', title: 'Einladungslink erstellen und teilen', onclick: () => openBoardSettings(cur.data, 'share', refresh) }, icon('share'), h('span', { class: 'hide-sm' }, ' Teilen')) : null,
      folderButton(),
      h('button', { class: 'btn btn-ghost', onclick: showActivity }, icon('activity'), h('span', { class: 'hide-sm' }, ' Aktivität')),
      menuBtn),
    b.description ? h('p', { class: 'board-desc' }, renderInline(b.description)) : null);
}

function folderButton() {
  const { board: b } = cur.data;
  if (b.folder) {
    return h('button', {
      class: 'btn btn-ghost', title: `Nextcloud: ${b.folder.path} (verknüpft von ${b.folder.ownerName || 'unbekannt'})`,
      onclick: () => openFilePicker({ boardId: b.id, boardFolder: true, mode: 'browse', title: `Board-Ordner – ${b.folder.path}` }),
    }, icon('folder'), h('span', { class: 'hide-sm' }, ' Board-Ordner'));
  }
  if (!isOwner()) return null;
  return h('button', { class: 'btn btn-ghost', onclick: () => openBoardSettings(cur.data, 'folder', refresh) }, icon('cloud'), h('span', { class: 'hide-sm' }, ' Ordner verknüpfen'));
}

function boardMenu(anchor) {
  const { board: b } = cur.data;
  popupMenu(anchor, [
    { label: 'Einstellungen', icon: 'settings', onClick: () => openBoardSettings(cur.data, 'general', refresh) },
    { label: 'Mitglieder', icon: 'users', onClick: () => openBoardSettings(cur.data, 'members', refresh) },
    { label: 'Labels', icon: 'tag', onClick: () => openBoardSettings(cur.data, 'labels', refresh) },
    { label: 'Nextcloud-Ordner', icon: 'cloud', onClick: () => openBoardSettings(cur.data, 'folder', refresh) },
    'sep',
    { label: 'Archiv anzeigen', icon: 'archive', onClick: showArchive },
    { label: 'Als JSON exportieren', icon: 'download', onClick: async () => {
      try {
        const data = await api.get(`/boards/${b.id}/export`);
        if (state.config.demo) {
          const ta = h('textarea', { rows: 16, readOnly: true, class: 'export-json', 'aria-label': 'Export als JSON' });
          ta.value = JSON.stringify(data, null, 2);
          openModal({ title: 'Export (JSON)', wide: true, content: [h('p', { class: 'hint' }, 'In der echten App wird diese Datei heruntergeladen. Im Klick-Dummy wird sie hier angezeigt.'), ta] });
          return;
        }
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const a = h('a', { href: url, download: `${b.title.replace(/[^\wäöüÄÖÜß -]+/g, '_')}.json` });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (err) { showError(err); }
    } },
    'sep',
    isOwner() ? { label: b.archived ? 'Board reaktivieren' : 'Board archivieren', icon: 'archive', onClick: async () => {
      await api.patch(`/boards/${b.id}`, { archived: !b.archived }).catch(showError); refresh();
    } } : null,
    !isOwner() ? { label: 'Board verlassen', icon: 'arrowLeft', danger: true, onClick: async () => {
      if (!(await confirmDialog('Board wirklich verlassen?', { ok: 'Verlassen', danger: true }))) return;
      try { await api.del(`/boards/${b.id}/members/${state.me.id}`); navigate('#/'); } catch (err) { showError(err); }
    } } : null,
    isOwner() ? { label: 'Board löschen', icon: 'trash', danger: true, onClick: async () => {
      if (!(await confirmDialog(`Board „${b.title}“ mit allen Karten endgültig löschen? Dateien in der Nextcloud bleiben erhalten.`, { ok: 'Endgültig löschen', danger: true }))) return;
      try { await api.del(`/boards/${b.id}`); toast('Board gelöscht.'); navigate('#/'); } catch (err) { showError(err); }
    } } : null,
  ]);
}

function filterBar() {
  const f = cur.filter;
  const { labels } = cur.data;
  const active = f.text || f.labels.size || f.mine || f.due;
  const search = h('input', {
    type: 'search', placeholder: 'Karten durchsuchen …', value: f.text, 'aria-label': 'Karten durchsuchen',
    oninput: (e) => { f.text = e.target.value; applyFilter(); },
  });
  return h('div', { class: 'filter-bar' },
    icon('filter'), search,
    h('label', { class: 'chip-toggle' }, h('input', { type: 'checkbox', checked: f.mine, onchange: (e) => { f.mine = e.target.checked; applyFilter(); } }), ' Mir zugewiesen'),
    h('select', {
      'aria-label': 'Fälligkeit filtern',
      onchange: (e) => { f.due = e.target.value; applyFilter(); },
    }, [['', 'Alle Termine'], ['overdue', 'Überfällig'], ['soon', 'Fällig in 3 Tagen'], ['none', 'Ohne Termin']]
      .map(([v, l]) => h('option', { value: v, selected: f.due === v }, l))),
    labels.map((l) => h('button', {
      class: `label-chip ${f.labels.has(l.id) ? 'on' : ''}`, style: { '--label-color': l.color }, 'aria-pressed': String(f.labels.has(l.id)),
      onclick: (e) => { if (f.labels.has(l.id)) f.labels.delete(l.id); else f.labels.add(l.id); e.currentTarget.classList.toggle('on'); applyFilter(); },
    }, l.name)),
    active ? h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { cur.filter = { text: '', labels: new Set(), mine: false, due: '' }; draw(); } }, 'Filter zurücksetzen') : null);
}

function matches(c) {
  const f = cur.filter;
  if (f.text && !c.title.toLowerCase().includes(f.text.toLowerCase())) return false;
  if (f.mine && !c.members.includes(state.me.id)) return false;
  if (f.labels.size && !c.labels.some((l) => f.labels.has(l))) return false;
  if (f.due) {
    if (c.isTemplate) return false;
    const s = dueState(c.dueDate, c.completed, c.dueTime);
    if (f.due === 'none' ? !!c.dueDate : s !== f.due) return false;
  }
  return true;
}

function applyFilter() {
  for (const el of cur.root.querySelectorAll('.card-tile')) {
    const c = cur.data.cards.find((x) => x.id === Number(el.dataset.id));
    el.hidden = c ? !matches(c) : false;
  }
}

function lists() {
  const { lists: ls, cards } = cur.data;
  cur.listsEl = h('div', { class: 'lists', ondragover: onListDragOver, ondrop: onListDrop });
  for (const l of ls) cur.listsEl.append(listColumn(l, cards.filter((c) => c.listId === l.id)));
  if (canEdit()) cur.listsEl.append(addListColumn());
  requestAnimationFrame(applyFilter);
  return cur.listsEl;
}

function listColumn(list, cards) {
  const titleEl = h('h2', { class: 'list-title', title: canEdit() ? 'Zum Umbenennen klicken' : '' }, list.title);
  if (canEdit()) {
    titleEl.addEventListener('click', () => inlineEdit(titleEl, {
      value: list.title, maxLength: 120,
      onSave: async (v) => { await api.patch(`/lists/${list.id}`, { title: v }).catch(showError); refresh(); },
    }));
  }
  const menuBtn = canEdit() ? h('button', { class: 'icon-btn', 'aria-label': `Menü für Liste ${list.title}`, onclick: () => listMenu(menuBtn, list, cards) }, icon('menu')) : null;
  const head = h('div', { class: 'list-head', draggable: canEdit() ? 'true' : undefined }, titleEl, h('span', { class: 'count' }, cards.length), menuBtn);
  if (canEdit()) {
    head.addEventListener('dragstart', (e) => {
      if (e.target.closest('input,textarea')) return;
      cur.drag = { type: 'list', id: list.id };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', `list:${list.id}`);
      requestAnimationFrame(() => col.classList.add('dragging'));
    });
    head.addEventListener('dragend', endDrag);
  }
  const body = h('div', { class: 'list-cards', dataset: { listId: list.id }, ondragover: onCardDragOver, ondrop: onCardDrop },
    cards.map(cardTile));
  const col = h('section', { class: 'list', dataset: { listId: list.id }, 'aria-label': list.title }, head, body, canEdit() ? cardComposer(list) : null);
  return col;
}

function listMenu(anchor, list, cards) {
  const idx = cur.data.lists.findIndex((l) => l.id === list.id);
  popupMenu(anchor, [
    { label: 'Karte hinzufügen', icon: 'plus', onClick: () => cur.root.querySelector(`.list[data-list-id="${list.id}"] .composer-open`)?.click() },
    { label: 'Nach links', icon: 'arrowLeft', disabled: idx === 0, onClick: () => moveList(list.id, idx - 1) },
    { label: 'Nach rechts', icon: 'arrowRight', disabled: idx === cur.data.lists.length - 1, onClick: () => moveList(list.id, idx + 1) },
    { label: 'Alle Karten als erledigt markieren', icon: 'check', disabled: !cards.length, onClick: async () => {
      for (const c of cards.filter((x) => !x.completed)) await api.patch(`/cards/${c.id}`, { completed: true }).catch(showError);
      refresh();
    } },
    'sep',
    { label: 'Liste archivieren', icon: 'archive', onClick: async () => { await api.patch(`/lists/${list.id}`, { archived: true }).catch(showError); refresh(); } },
    { label: 'Liste löschen', icon: 'trash', danger: true, onClick: async () => {
      if (!(await confirmDialog(`Liste „${list.title}“ mit ${cards.length} Karte(n) endgültig löschen?`, { ok: 'Löschen', danger: true }))) return;
      await api.del(`/lists/${list.id}`).catch(showError); refresh();
    } },
  ]);
}

async function moveList(id, index) {
  await api.post(`/lists/${id}/move`, { index }).catch(showError);
  refresh();
}

function cardTile(c) {
  const { labels, members } = cur.data;
  const due = c.isTemplate ? 'ok' : dueState(c.dueDate, c.completed, c.dueTime);
  const cl = c.checklist;
  const tile = h('a', {
    class: `card-tile ${c.completed ? 'completed' : ''} ${c.isTemplate ? 'card-template' : ''}`, href: `#/board/${cur.boardId}/card/${c.id}`,
    draggable: canEdit() ? 'true' : undefined, dataset: { id: c.id },
  },
  c.labels.length ? h('div', { class: 'card-labels' }, c.labels.map((id) => labels.find((l) => l.id === id)).filter(Boolean)
    .map((l) => h('span', { class: 'card-label', style: { '--label-color': l.color }, title: l.name }, l.name))) : null,
  c.isTemplate ? h('div', { class: 'template-badge' }, icon('card', 12), ' Vorlage') : null,
  h('div', { class: 'card-title' }, c.completed ? h('span', { class: 'done-mark', title: 'Erledigt' }, icon('check', 14)) : null, renderInline(c.title, { links: false })),
  h('div', { class: 'card-badges' },
    c.dueDate ? h('span', { class: `badge due due-${due}`, title: `Fällig: ${fmtWhen(c.dueDate, c.dueTime)}` }, icon('clock', 13), ` ${fmtWhenShort(c.dueDate, c.dueTime)}`) : null,
    !c.dueDate && c.dueTime && c.isTemplate ? h('span', { class: 'badge', title: 'Uhrzeit der Vorlage' }, icon('clock', 13), ` ${c.dueTime}`) : null,
    c.hasDescription ? h('span', { class: 'badge-plain', title: 'Hat Beschreibung' }, icon('text', 13)) : null,
    cl.total ? h('span', { class: `badge-plain ${cl.done === cl.total ? 'all-done' : ''}`, title: 'Checklisten' }, icon('checklist', 13), ` ${cl.done}/${cl.total}`) : null,
    c.comments ? h('span', { class: 'badge-plain', title: 'Kommentare' }, icon('comment', 13), ` ${c.comments}`) : null,
    c.attachments ? h('span', { class: 'badge-plain', title: 'Anhänge' }, icon('clip', 13), ` ${c.attachments}`) : null,
    c.members.length ? h('span', { class: 'card-members' }, c.members.map((id) => members.find((m) => m.id === id)).filter(Boolean).map((m) => avatar(m, 'xs'))) : null));

  if (canEdit()) {
    tile.addEventListener('dragstart', (e) => {
      cur.drag = { type: 'card', id: c.id };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', `card:${c.id}`);
      requestAnimationFrame(() => tile.classList.add('dragging'));
    });
    tile.addEventListener('dragend', endDrag);
  }
  return tile;
}

function cardComposer(list) {
  const wrap = h('div', { class: 'list-composer' });
  const openBtn = h('button', { class: 'composer-open', onclick: () => open() }, icon('plus'), ' Karte hinzufügen');
  const templates = cur.data.cards.filter((c) => c.isTemplate);
  const tplBtn = h('button', {
    class: 'composer-template', title: 'Neue Karte aus einer Vorlagenkarte',
    onclick: (e) => (!templates.length ? openModal({
      title: 'Noch keine Vorlagenkarte',
      content: [
        h('p', {}, 'Vorlagenkarten sind Muster für wiederkehrende Karten, z. B. für Sitzungen – mit Beschreibung, Labels, Uhrzeit und Checklisten.'),
        h('ol', { class: 'howto' },
          h('li', {}, 'Eine Karte anlegen, z. B. „Vorlage: Sitzung“, und alles eintragen, was jede neue Karte haben soll.'),
          h('li', {}, 'In der Karte unter „Aktionen“ auf „Als Vorlage markieren“ tippen.'),
          h('li', {}, 'Danach erstellt „aus Vorlage“ hier mit einem Tipp neue Karten daraus.')),
      ],
    }) : popupMenu(e.currentTarget, templates.map((t) => ({
      label: t.title, icon: 'card',
      onClick: async () => {
        try {
          const made = await api.post(`/cards/${t.id}/copy`, { listId: list.id, title: t.title.replace(/^Vorlage:\s*/i, '') });
          toast('Karte aus Vorlage erstellt.', 'success');
          await refresh();
          navigate(`#/board/${cur.boardId}/card/${made.id}`);
        } catch (err) { showError(err); }
      },
    })))),
  }, icon('card', 14), ' aus Vorlage');
  const row = h('div', { class: 'composer-row' }, openBtn, tplBtn);
  wrap.append(row);
  function open() {
    const ta = h('textarea', { rows: 2, maxlength: 300, placeholder: 'Titel der Karte … (Enter zum Speichern)', 'aria-label': 'Titel der neuen Karte' });
    ta.dataset.escapeCancels = '1';
    const save = async () => {
      const title = ta.value.trim();
      if (!title) return;
      ta.disabled = true;
      try {
        await api.post(`/lists/${list.id}/cards`, { title });
        await refresh();
        // Composer derselben Liste wieder öffnen für schnelles Erfassen
        cur.root.querySelector(`.list[data-list-id="${list.id}"] .composer-open`)?.click();
      } catch (err) { showError(err); ta.disabled = false; }
    };
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    const close = () => clear(wrap).append(row);
    clear(wrap).append(ta, h('div', { class: 'composer-actions' },
      h('button', { class: 'btn btn-primary btn-sm', onclick: save }, 'Hinzufügen'),
      h('button', { class: 'icon-btn', 'aria-label': 'Abbrechen', onclick: close }, icon('x'))));
    ta.focus();
    ta.scrollIntoView({ block: 'nearest' });
  }
  return wrap;
}

function addListColumn() {
  const wrap = h('div', { class: 'list list-add' });
  const btn = h('button', { class: 'composer-open', onclick: () => open() }, icon('plus'), ' Liste hinzufügen');
  wrap.append(btn);
  function open() {
    const input = h('input', { type: 'text', maxlength: 120, placeholder: 'Titel der Liste', 'aria-label': 'Titel der neuen Liste' });
    input.dataset.escapeCancels = '1';
    const save = async () => {
      if (!input.value.trim()) return;
      try { await api.post(`/boards/${cur.boardId}/lists`, { title: input.value }); await refresh(); cur.listsEl.scrollLeft = cur.listsEl.scrollWidth; } catch (err) { showError(err); }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { clear(wrap).append(btn); } });
    clear(wrap).append(input, h('div', { class: 'composer-actions' },
      h('button', { class: 'btn btn-primary btn-sm', onclick: save }, 'Hinzufügen'),
      h('button', { class: 'icon-btn', 'aria-label': 'Abbrechen', onclick: () => clear(wrap).append(btn) }, icon('x'))));
    input.focus();
  }
  return wrap;
}

// ---------------- Drag & Drop ----------------

let placeholder = null;

function endDrag() {
  cur.root?.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging'));
  placeholder?.remove();
  placeholder = null;
  cur.drag = null;
}

function onCardDragOver(e) {
  if (cur.drag?.type !== 'card') return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const container = e.currentTarget;
  if (!placeholder) placeholder = h('div', { class: 'card-placeholder' });
  const tiles = [...container.querySelectorAll('.card-tile:not(.dragging)')].filter((t) => !t.hidden);
  const after = tiles.find((t) => { const r = t.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
  if (after) container.insertBefore(placeholder, after); else container.append(placeholder);
}

async function onCardDrop(e) {
  if (cur.drag?.type !== 'card') return;
  e.preventDefault();
  e.stopPropagation();
  const container = e.currentTarget;
  const listId = Number(container.dataset.listId);
  // Index unter allen (auch gefilterten) Karten der Zielliste ermitteln
  const children = [...container.children].filter((el) => el === placeholder || (el.classList.contains('card-tile') && !el.classList.contains('dragging')));
  const index = Math.max(0, children.indexOf(placeholder));
  const id = cur.drag.id;
  const dragged = container.ownerDocument.querySelector(`.card-tile[data-id="${id}"]`);
  if (placeholder && dragged) placeholder.replaceWith(dragged);
  endDrag();
  try { await api.post(`/cards/${id}/move`, { listId, index }); } catch (err) { showError(err); }
  refresh();
}

function onListDragOver(e) {
  if (cur.drag?.type !== 'list') return;
  e.preventDefault();
  const cols = [...cur.listsEl.querySelectorAll('.list:not(.list-add):not(.dragging)')];
  if (!placeholder) placeholder = h('div', { class: 'list-placeholder' });
  const after = cols.find((c) => { const r = c.getBoundingClientRect(); return e.clientX < r.left + r.width / 2; });
  if (after) cur.listsEl.insertBefore(placeholder, after);
  else cur.listsEl.insertBefore(placeholder, cur.listsEl.querySelector('.list-add'));
}

async function onListDrop(e) {
  if (cur.drag?.type !== 'list') return;
  e.preventDefault();
  const children = [...cur.listsEl.children].filter((el) => el === placeholder || (el.classList.contains('list') && !el.classList.contains('list-add') && !el.classList.contains('dragging')));
  const index = Math.max(0, children.indexOf(placeholder));
  const id = cur.drag.id;
  endDrag();
  await moveList(id, index);
}

// ---------------- Aktivität & Archiv ----------------

async function showActivity() {
  try {
    const items = await api.get(`/boards/${cur.boardId}/activity?limit=150`);
    openModal({
      title: 'Aktivität',
      content: items.length ? h('ul', { class: 'activity' }, items.map((a) => h('li', {},
        h('strong', {}, a.userName || 'Jemand'), ' ', describeActivity(a),
        a.cardId && a.cardTitle ? [' – ', h('a', { href: `#/board/${cur.boardId}/card/${a.cardId}`, onclick: (e) => e.target.closest('.overlay')?.querySelector('.icon-btn')?.click() }, renderInline(a.cardTitle, { links: false }))] : null,
        h('div', { class: 'muted small' }, fmtDateTime(a.createdAt))))) : h('p', { class: 'muted' }, 'Noch keine Aktivität.'),
    });
  } catch (err) { showError(err); }
}

async function showArchive() {
  const m = openModal({ title: 'Archiv', wide: true });
  const draw2 = async () => {
    const data = await api.get(`/boards/${cur.boardId}/archive`);
    clear(m.body).append(
      h('h3', {}, 'Archivierte Listen'),
      data.lists.length ? h('ul', { class: 'plain-list' }, data.lists.map((l) => h('li', {}, h('span', {}, l.title),
        canEdit() ? h('span', { class: 'row-actions' },
          h('button', { class: 'btn btn-sm', onclick: async () => { await api.patch(`/lists/${l.id}`, { archived: false }).catch(showError); draw2(); refresh(); } }, 'Wiederherstellen')) : null)))
        : h('p', { class: 'muted' }, 'Keine.'),
      h('h3', {}, 'Archivierte Karten'),
      data.cards.length ? h('ul', { class: 'plain-list' }, data.cards.map((c) => h('li', {}, h('span', {}, c.title),
        canEdit() ? h('span', { class: 'row-actions' },
          c.archived ? h('button', { class: 'btn btn-sm', onclick: async () => { await api.patch(`/cards/${c.id}`, { archived: false }).catch(showError); draw2(); refresh(); } }, 'Wiederherstellen') : h('span', { class: 'muted small' }, 'Liste archiviert'),
          h('button', { class: 'btn btn-sm btn-danger', onclick: async () => {
            if (!(await confirmDialog(`Karte „${c.title}“ endgültig löschen?`, { ok: 'Löschen', danger: true }))) return;
            await api.del(`/cards/${c.id}`).catch(showError); draw2();
          } }, 'Löschen')) : null)))
        : h('p', { class: 'muted' }, 'Keine.'));
  };
  draw2().catch(showError);
}
