import { api } from './api.js';
import {
  h, clear, icon, toast, showError, openModal, confirmDialog, promptDialog, popupMenu, inlineEdit,
  fmtDate, fmtDateTime, fmtSize, dueState, avatar, fmtWhen,
} from './dom.js';
import { state, navigate, describeActivity } from './state.js';
import { board, canEdit, refresh as refreshBoard } from './board.js';
import { openFilePicker } from './filepicker.js';
import { openBoardSettings } from './settings.js';
import { renderMarkdown, renderInline, markdownToolbar, markdownShortcuts } from './markdown.js';

let modal = null;
let cardId = null;
let card = null;
let onChange = null;

export function closeCardModal() {
  modal?.close();
}

export async function openCard(id, opts) {
  onChange = opts.onChange;
  if (modal && cardId === id) return;
  closeCardModal();
  cardId = id;
  try {
    card = await api.get(`/cards/${id}`);
  } catch (err) {
    showError(err);
    navigate(`#/board/${opts.boardId}`);
    return;
  }
  modal = openModal({
    title: board()?.board.title || '', wide: true, className: 'card-modal',
    onClose: () => {
      const closedId = cardId;
      modal = null;
      cardId = null;
      if (new RegExp(`/card/${closedId}$`).test(location.hash)) navigate(`#/board/${opts.boardId}`);
    },
  });
  draw();
}

async function reload() {
  if (!cardId) return;
  card = await api.get(`/cards/${cardId}`);
  if (modal) draw();
  onChange?.();
}

/** Führt eine Änderung aus und lädt danach Karte + Board neu. */
const act = (fn) => async (...args) => {
  try { await fn(...args); await reload(); } catch (err) { showError(err); }
};

function draw() {
  const scroll = modal.body.scrollTop;
  const edit = canEdit();
  modal.setTitle(board().board.title);
  clear(modal.body).append(h('div', { class: 'card-detail' },
    h('div', { class: 'card-main' }, templateBanner(edit), titleBlock(edit), metaRow(), descriptionBlock(edit), checklistsBlock(edit), attachmentsBlock(edit), commentsBlock()),
    h('aside', { class: 'card-side' }, sidebar(edit))));
  modal.body.scrollTop = scroll;
}

function titleBlock(edit) {
  const t = h('h3', { class: `card-detail-title ${edit ? 'editable' : ''}`, tabindex: edit ? 0 : undefined }, renderInline(card.title));
  if (edit) {
    const go = () => inlineEdit(t, { value: card.title, multiline: false, onSave: act((v) => api.patch(`/cards/${card.id}`, { title: v })) });
    t.addEventListener('click', (e) => { if (!e.target.closest('a')) go(); });
    t.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }
  const list = board().lists.find((l) => l.id === card.listId);
  return h('div', {}, t, h('p', { class: 'muted small' }, 'in Liste ', h('strong', {}, list?.title || '–'),
    card.creator ? ` · angelegt von ${card.creator} am ${fmtDateTime(card.createdAt)}` : ''));
}

/** Hinweis bei Vorlagenkarten + direkt eine Karte daraus erstellen. */
function templateBanner(edit) {
  if (!card.isTemplate) return null;
  return h('div', { class: 'template-banner' },
    h('div', {}, h('strong', {}, 'Vorlagenkarte'), h('span', { class: 'muted small' }, ' – daraus entstehen neue Karten mit Beschreibung, Labels, Uhrzeit und Checklisten (alle Punkte offen).')),
    edit ? h('button', { class: 'btn btn-primary btn-sm', onclick: () => copyDialog(true) }, icon('plus'), ' Karte daraus erstellen') : null);
}

/** Karte kopieren bzw. aus Vorlage erstellen: Titel und Ziel-Liste wählen. */
function copyDialog(fromTemplate) {
  const { lists } = board();
  const title = h('input', { type: 'text', maxlength: 300, required: true, autofocus: true, value: fromTemplate ? card.title.replace(/^Vorlage:\s*/i, '') : `${card.title} (Kopie)` });
  const listSel = h('select', { 'aria-label': 'Liste' }, lists.map((l) => h('option', { value: l.id, selected: l.id === card.listId }, l.title)));
  const m = openModal({
    title: fromTemplate ? 'Karte aus Vorlage erstellen' : 'Karte kopieren',
    content: h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          const made = await api.post(`/cards/${card.id}/copy`, { title: title.value, listId: Number(listSel.value) });
          m.close();
          toast(fromTemplate ? 'Karte aus Vorlage erstellt.' : 'Karte kopiert.', 'success');
          await refreshBoard();
          navigate(`#/board/${card.boardId}/card/${made.id}`);
        } catch (err) { showError(err); }
      },
    },
    h('label', { class: 'field' }, h('span', {}, 'Titel'), title),
    h('label', { class: 'field' }, h('span', {}, 'In Liste'), listSel),
    h('p', { class: 'hint' }, 'Übernommen werden Beschreibung, Labels, Uhrzeit und Checklisten (alle Punkte offen) – keine Termine, Personen, Kommentare oder Anhänge.'),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => m.close() }, 'Abbrechen'),
      h('button', { type: 'submit', class: 'btn btn-primary' }, fromTemplate ? 'Erstellen' : 'Kopieren'))),
  });
}

function metaRow() {
  const { labels, members } = board();
  const due = card.isTemplate ? 'ok' : dueState(card.dueDate, card.completed, card.dueTime);
  const items = [];
  if (card.members.length) {
    items.push(h('div', { class: 'meta' }, h('div', { class: 'meta-label' }, 'Zuständig'),
      h('div', { class: 'meta-value' }, card.members.map((id) => members.find((m) => m.id === id)).filter(Boolean)
        .map((m) => h('span', { class: 'person' }, avatar(m), m.name)))));
  }
  if (card.labels.length) {
    items.push(h('div', { class: 'meta' }, h('div', { class: 'meta-label' }, 'Labels'),
      h('div', { class: 'meta-value' }, card.labels.map((id) => labels.find((l) => l.id === id)).filter(Boolean)
        .map((l) => h('span', { class: 'card-label big', style: { '--label-color': l.color } }, l.name)))));
  }
  if (card.startDate || card.dueDate) {
    items.push(h('div', { class: 'meta' }, h('div', { class: 'meta-label' }, 'Zeitraum'),
      h('div', { class: 'meta-value' },
        card.startDate ? `${fmtWhen(card.startDate, card.startTime)} – ` : '',
        card.dueDate ? h('span', { class: `badge due due-${due}` }, fmtWhen(card.dueDate, card.dueTime),
          due === 'overdue' ? ' · überfällig' : due === 'soon' ? ' · bald fällig' : due === 'done' ? ' · erledigt' : '') : '')));
  }
  return items.length ? h('div', { class: 'meta-row' }, items) : null;
}

function descriptionBlock(edit) {
  const sec = h('section', { class: 'card-section' }, h('h4', {}, icon('text'), ' Beschreibung'));
  const show = () => {
    const body = card.description
      ? h('div', { class: `description md ${edit ? 'editable' : ''}`, tabindex: edit ? 0 : undefined }, renderMarkdown(card.description))
      : h('div', { class: 'description empty', tabindex: edit ? 0 : undefined }, edit ? 'Beschreibung hinzufügen … (Ziele, Hintergrund, Beschlusslage)' : 'Keine Beschreibung.');
    if (edit) {
      body.addEventListener('click', (e) => { if (!e.target.closest('a')) editMode(); });
      body.addEventListener('keydown', (e) => { if (e.key === 'Enter') editMode(); });
    }
    sec.replaceChildren(sec.firstChild, body);
  };
  const editMode = () => {
    const ta = h('textarea', { rows: 8, maxlength: 20000, class: 'description-input' });
    ta.value = card.description;
    ta.dataset.escapeCancels = '1';
    const save = act(async () => { await api.patch(`/cards/${card.id}`, { description: ta.value }); });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); show(); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
    });
    markdownShortcuts(ta);
    const preview = h('div', { class: 'description md md-preview', hidden: true });
    const toolbar = markdownToolbar(ta);
    const previewBtn = h('button', {
      class: 'btn btn-sm', 'aria-pressed': 'false',
      onclick: () => {
        const on = preview.hidden;
        preview.replaceChildren(...(ta.value.trim() ? renderMarkdown(ta.value) : [h('p', { class: 'muted' }, 'Noch kein Text.')]));
        preview.hidden = !on;
        ta.hidden = on;
        toolbar.hidden = on;
        previewBtn.textContent = on ? 'Bearbeiten' : 'Vorschau';
        previewBtn.setAttribute('aria-pressed', String(on));
      },
    }, 'Vorschau');
    sec.replaceChildren(sec.firstChild, toolbar, ta, preview, h('div', { class: 'composer-actions' },
      h('button', { class: 'btn btn-primary btn-sm', onclick: save }, 'Speichern'),
      h('button', { class: 'btn btn-sm', onclick: show }, 'Abbrechen'),
      previewBtn,
      h('span', { class: 'muted small hide-sm' }, 'Strg+Enter speichert')));
    ta.focus();
  };
  show();
  return sec;
}

function checklistsBlock(edit) {
  const { members } = board();
  const sec = h('section', { class: 'card-section' });
  for (const cl of card.checklists) {
    const done = cl.items.filter((i) => i.done).length;
    const pct = cl.items.length ? Math.round((done / cl.items.length) * 100) : 0;
    const title = h('h4', { class: edit ? 'editable' : '' }, icon('checklist'), ` ${cl.title}`);
    if (edit) title.addEventListener('click', () => inlineEdit(title, { value: cl.title, onSave: act((v) => api.patch(`/checklists/${cl.id}`, { title: v })) }));
    const hideDone = h('input', { type: 'checkbox' });
    const ul = h('ul', { class: 'checklist' });
    hideDone.addEventListener('change', () => ul.classList.toggle('hide-done', hideDone.checked));

    for (const item of cl.items) {
      const assignee = members.find((m) => m.id === item.assigneeId);
      const text = h('span', { class: `item-text ${edit ? 'editable' : ''}` }, renderInline(item.text));
      if (edit) text.addEventListener('click', (e) => { if (!e.target.closest('a')) inlineEdit(text, { value: item.text, maxLength: 500, onSave: act((v) => api.patch(`/checklist-items/${item.id}`, { text: v })) }); });
      const more = edit ? h('button', { class: 'icon-btn', 'aria-label': 'Optionen', onclick: () => itemMenu(more, item) }, icon('menu')) : null;
      const itemDue = dueState(item.dueDate, item.done);
      ul.append(h('li', { class: item.done ? 'done' : '' },
        h('input', { type: 'checkbox', checked: item.done, disabled: !edit, 'aria-label': item.text, onchange: act((e) => api.patch(`/checklist-items/${item.id}`, { done: e.target.checked })) }),
        text,
        h('span', { class: 'item-meta' },
          item.dueDate ? h('span', { class: `badge due due-${itemDue}` }, fmtDate(item.dueDate)) : null,
          assignee ? avatar(assignee, 'xs') : null),
        more));
    }

    let addRow = null;
    if (edit) {
      const input = h('input', { type: 'text', placeholder: 'Punkt hinzufügen … (Enter)', maxlength: 500, 'aria-label': `Punkt zu ${cl.title} hinzufügen` });
      input.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter' || !input.value.trim()) return;
        e.preventDefault();
        try {
          await api.post(`/checklists/${cl.id}/items`, { text: input.value });
          await reload();
          modal?.body.querySelector(`[aria-label="Punkt zu ${CSS.escape(cl.title)} hinzufügen"]`)?.focus();
        } catch (err) { showError(err); }
      });
      addRow = h('div', { class: 'add-item' }, input);
    }

    sec.append(h('div', { class: 'checklist-block' },
      h('div', { class: 'checklist-head' }, title,
        h('label', { class: 'small muted' }, hideDone, ' Erledigte ausblenden'),
        edit ? h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => {
          if (await confirmDialog(`Checkliste „${cl.title}“ löschen?`, { ok: 'Löschen', danger: true })) act(() => api.del(`/checklists/${cl.id}`))();
        } }, 'Löschen') : null),
      h('div', { class: 'progress-row' }, h('span', { class: 'small' }, `${pct} %`),
        h('div', { class: 'progress' }, h('div', { class: `progress-bar ${pct === 100 ? 'full' : ''}`, style: { width: `${pct}%` } }))),
      ul, addRow));
  }
  return sec.childNodes.length ? sec : null;
}

function itemMenu(anchor, item) {
  const { members } = board();
  popupMenu(anchor, [
    { label: 'Zuständige Person …', icon: 'user', onClick: () => pickMember(item) },
    { label: 'Fälligkeit …', icon: 'calendar', onClick: () => pickDate(item) },
    { label: 'In Karte umwandeln', icon: 'card', onClick: act(async () => { await api.post(`/checklist-items/${item.id}/to-card`); toast('Als Karte angelegt.'); }) },
    'sep',
    { label: 'Löschen', icon: 'trash', danger: true, onClick: act(() => api.del(`/checklist-items/${item.id}`)) },
  ]);
  function pickMember(it) {
    const m = openModal({
      title: 'Zuständige Person',
      content: h('ul', { class: 'pick-list' },
        h('li', {}, h('button', { onclick: () => { m.close(); act(() => api.patch(`/checklist-items/${it.id}`, { assigneeId: null }))(); } }, '— niemand —')),
        members.filter((x) => x.role !== 'viewer').map((p) => h('li', {}, h('button', {
          class: p.id === it.assigneeId ? 'selected' : '',
          onclick: () => { m.close(); act(() => api.patch(`/checklist-items/${it.id}`, { assigneeId: p.id }))(); },
        }, avatar(p), ` ${p.name}`)))),
    });
  }
  function pickDate(it) {
    const input = h('input', { type: 'date', value: it.dueDate || '' });
    const m = openModal({
      title: 'Fälligkeit des Punkts',
      content: [input, h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => { m.close(); act(() => api.patch(`/checklist-items/${it.id}`, { dueDate: null }))(); } }, 'Entfernen'),
        h('button', { class: 'btn btn-primary', onclick: () => { m.close(); act(() => api.patch(`/checklist-items/${it.id}`, { dueDate: input.value || null }))(); } }, 'Speichern'))],
    });
  }
}

function attachmentsBlock(edit) {
  const b = board().board;
  const items = card.attachmentList;
  const sec = h('section', { class: 'card-section' }, h('h4', {}, icon('clip'), ' Anhänge'));
  if (items.length) {
    sec.append(h('ul', { class: 'attachments' }, items.map((a) => h('li', {},
      h('a', { href: a.url, target: '_blank', rel: 'noopener noreferrer', class: 'attachment' },
        icon(a.kind === 'link' ? 'link' : a.mime === 'httpd/unix-directory' ? 'folder' : 'file', 20),
        h('span', { class: 'att-body' },
          h('span', { class: 'att-name' }, a.name),
          h('span', { class: 'muted small' },
            a.kind === 'nextcloud' ? `Nextcloud${a.path ? ` · ${a.path}` : ''}` : new URL(a.url).hostname,
            a.size ? ` · ${fmtSize(a.size)}` : '', a.addedBy ? ` · ${a.addedBy}` : '')),
        icon('external', 14)),
      edit ? h('button', { class: 'icon-btn', 'aria-label': `Anhang ${a.name} entfernen`, title: 'Verknüpfung entfernen (Datei bleibt in Nextcloud)', onclick: async () => {
        if (await confirmDialog(`Anhang „${a.name}“ von der Karte entfernen? ${a.kind === 'nextcloud' ? 'Die Datei bleibt in der Nextcloud erhalten.' : ''}`, { ok: 'Entfernen' })) act(() => api.del(`/attachments/${a.id}`))();
      } }, icon('x')) : null))));
  } else {
    sec.append(h('p', { class: 'muted small' }, 'Noch keine Anhänge.'));
  }
  if (edit) {
    const fileInput = h('input', { type: 'file', multiple: true, hidden: true, onchange: (e) => uploadFiles([...e.target.files]) });
    const drop = h('div', { class: 'attach-actions' },
      h('button', { class: 'btn btn-sm', onclick: () => openFilePicker({
        boardId: b.id, boardFolder: !!b.folder, mode: 'file',
        onPick: async (entry, source) => { await api.post(`/cards/${card.id}/attachments/nextcloud`, { path: entry.path, source }); await reload(); },
      }) }, icon('cloud'), ' Aus Nextcloud'),
      h('button', {
        class: 'btn btn-sm',
        title: b.folder ? `Lädt in ${b.folder.path}` : 'Dieses Board hat noch keinen Nextcloud-Ordner',
        onclick: () => (b.folder ? fileInput.click() : explainNoFolder()),
      }, icon('upload'), ' Hochladen'),
      h('button', { class: 'btn btn-sm', onclick: addLink }, icon('link'), ' Link'),
      fileInput);
    if (b.folder) {
      sec.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); sec.classList.add('drop-target'); } });
      sec.addEventListener('dragleave', () => sec.classList.remove('drop-target'));
      sec.addEventListener('drop', (e) => { e.preventDefault(); sec.classList.remove('drop-target'); uploadFiles([...e.dataTransfer.files]); });
      sec.append(drop, h('p', { class: 'hint' }, `Dateien hierher ziehen, um sie im Board-Ordner (${b.folder.path}) zu speichern.`));
    } else {
      sec.append(drop);
    }
  }
  return sec;
}

/** Hochladen ohne Board-Ordner: erklären und (für Verantwortliche) direkt zur Einrichtung führen. */
function explainNoFolder() {
  const data = board();
  const owner = data.board.role === 'owner';
  const m = openModal({
    title: 'Noch kein Board-Ordner',
    content: [
      h('p', {}, 'Hochgeladene Dateien werden im Nextcloud-Ordner des Boards gespeichert. Dieses Board hat noch keinen.'),
      owner
        ? h('p', { class: 'muted' }, state.nextcloud
          ? 'Du kannst jetzt einen Ordner anlegen oder einen vorhandenen auswählen. Danach geht das Hochladen sofort.'
          : 'Dafür verbindest du zuerst unter „Konto“ deine Nextcloud und legst dann hier den Ordner an.')
        : h('p', { class: 'muted' }, 'Bitte die verantwortliche Person des Boards, einen Nextcloud-Ordner zu verknüpfen (Board → „Ordner verknüpfen“).'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => m.close() }, owner ? 'Später' : 'OK'),
        owner && !state.nextcloud ? h('a', { class: 'btn btn-primary', href: '#/account', onclick: () => m.close() }, 'Zu „Konto“') : null,
        owner && state.nextcloud ? h('button', {
          class: 'btn btn-primary', autofocus: true,
          onclick: () => {
            m.close();
            openBoardSettings(data, 'folder', async () => { await refreshBoard(); if (modal) draw(); });
          },
        }, 'Ordner jetzt verknüpfen') : null),
    ],
  });
}

async function uploadFiles(files) {
  const max = (state.config.uploadMaxMb || 50) * 1024 * 1024;
  for (const f of files) {
    if (f.size > max) { toast(`„${f.name}“ ist zu groß (max. ${state.config.uploadMaxMb} MB).`, 'error'); continue; }
    toast(`Lade „${f.name}“ hoch …`);
    try {
      await api.upload(`/cards/${card.id}/attachments/upload?name=${encodeURIComponent(f.name)}`, f);
      toast(`„${f.name}“ in Nextcloud gespeichert.`, 'success');
    } catch (err) { showError(err); }
  }
  await reload();
}

async function addLink() {
  const url = await promptDialog('Link anhängen', { label: 'Adresse', placeholder: 'https://…', type: 'url', ok: 'Anhängen' });
  if (!url) return;
  act(() => api.post(`/cards/${card.id}/attachments/link`, { url }))();
}

function commentsBlock() {
  const sec = h('section', { class: 'card-section' }, h('h4', {}, icon('comment'), ' Kommentare & Verlauf'));
  const ta = h('textarea', { rows: 2, maxlength: 5000, placeholder: 'Kommentar schreiben … (Strg+Enter sendet)', 'aria-label': 'Kommentar' });
  const send = act(async () => {
    if (!ta.value.trim()) return;
    await api.post(`/cards/${card.id}/comments`, { body: ta.value });
  });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); });
  markdownShortcuts(ta);
  sec.append(h('div', { class: 'comment-form' }, avatar(state.me), h('div', { class: 'comment-input' }, markdownToolbar(ta), ta), h('button', { class: 'btn btn-primary btn-sm', onclick: send }, 'Senden')));

  // Kommentare und Aktivitäten chronologisch mischen
  const entries = [
    ...card.comments.map((c) => ({ type: 'comment', at: c.createdAt, id: `c${c.id}`, c })),
    ...card.activity.filter((a) => a.action !== 'comment.added').map((a) => ({ type: 'activity', at: a.createdAt, id: `a${a.id}`, a })),
  ].sort((x, y) => y.at.localeCompare(x.at) || y.id.localeCompare(x.id));

  sec.append(h('ul', { class: 'timeline' }, entries.map((e) => {
    if (e.type === 'activity') {
      return h('li', { class: 'tl-activity' }, h('strong', {}, e.a.userName || 'Jemand'), ' ', describeActivity(e.a), h('span', { class: 'muted small' }, ` · ${fmtDateTime(e.a.createdAt)}`));
    }
    const c = e.c;
    const mine = c.userId === state.me.id;
    const bodyEl = h('div', { class: 'comment-body md' }, renderMarkdown(c.body));
    return h('li', { class: 'tl-comment' },
      avatar({ name: c.userName || '?' }),
      h('div', { class: 'comment' },
        h('div', { class: 'comment-head' }, h('strong', {}, c.userName || 'Gelöschtes Konto'), h('span', { class: 'muted small' }, fmtDateTime(c.createdAt))),
        bodyEl,
        mine || board().board.role === 'owner' ? h('div', { class: 'comment-actions' },
          mine ? h('button', { class: 'link-btn', onclick: () => inlineEdit(bodyEl, { value: c.body, multiline: true, maxLength: 5000, onSave: act((v) => api.patch(`/comments/${c.id}`, { body: v })) }) }, 'Bearbeiten') : null,
          h('button', { class: 'link-btn', onclick: async () => { if (await confirmDialog('Kommentar löschen?', { ok: 'Löschen', danger: true })) act(() => api.del(`/comments/${c.id}`))(); } }, 'Löschen')) : null));
  })));
  return sec;
}

function sidebar(edit) {
  const { labels, members, lists } = board();
  if (!edit) {
    return h('p', { class: 'muted small' }, 'Du hast in diesem Board nur Leserechte. Kommentieren ist möglich.');
  }
  const section = (title, ...content) => h('div', { class: 'side-section' }, h('h5', {}, title), ...content);

  // Erledigt
  const doneBtn = h('button', {
    class: `btn btn-block ${card.completed ? 'btn-success' : ''}`,
    onclick: act(() => api.patch(`/cards/${card.id}`, { completed: !card.completed })),
  }, icon('check'), card.completed ? ' Erledigt' : ' Als erledigt markieren');

  // Zuständige
  const memberList = h('div', { class: 'toggle-list' }, members.filter((m) => m.role !== 'viewer' || card.members.includes(m.id)).map((m) => {
    const on = card.members.includes(m.id);
    return h('button', {
      class: `toggle ${on ? 'on' : ''}`, 'aria-pressed': String(on),
      onclick: act(() => (on ? api.del(`/cards/${card.id}/members/${m.id}`) : api.put(`/cards/${card.id}/members/${m.id}`))),
    }, avatar(m, 'xs'), ` ${m.name}${m.id === state.me.id ? ' (ich)' : ''}${m.guest ? ' (Gast)' : ''}`);
  }));

  // Labels
  const labelList = h('div', { class: 'toggle-list' }, labels.map((l) => {
    const on = card.labels.includes(l.id);
    return h('button', {
      class: `toggle label-toggle ${on ? 'on' : ''}`, style: { '--label-color': l.color }, 'aria-pressed': String(on),
      onclick: act(() => (on ? api.del(`/cards/${card.id}/labels/${l.id}`) : api.put(`/cards/${card.id}/labels/${l.id}`))),
    }, h('span', { class: 'swatch' }), ` ${l.name}`);
  }), labels.length ? null : h('p', { class: 'muted small' }, 'Labels unter Board-Menü → Labels anlegen.'));

  // Termine
  const start = h('input', { type: 'date', value: card.startDate || '', 'aria-label': 'Startdatum', onchange: act((e) => api.patch(`/cards/${card.id}`, { startDate: e.target.value || null })) });
  const due = h('input', { type: 'date', value: card.dueDate || '', 'aria-label': 'Fälligkeitsdatum', onchange: act((e) => api.patch(`/cards/${card.id}`, { dueDate: e.target.value || null })) });
  // Uhrzeit optional; bei Vorlagen auch ohne Datum (wird beim Erstellen übernommen)
  const timeInput = (field, value, dateValue, label) => h('input', {
    type: 'time', value: value || '', 'aria-label': label, step: 300,
    disabled: !dateValue && !card.isTemplate, title: !dateValue && !card.isTemplate ? 'Zuerst ein Datum wählen' : '',
    onchange: act((e) => api.patch(`/cards/${card.id}`, { [field]: e.target.value || null })),
  });
  const startTime = timeInput('startTime', card.startTime, card.startDate, 'Startzeit');
  const dueTime = timeInput('dueTime', card.dueTime, card.dueDate, 'Uhrzeit (Fälligkeit)');

  // Verschieben (auch als Alternative zu Drag & Drop, z. B. auf Tablets)
  const listSel = h('select', { 'aria-label': 'Ziel-Liste' }, lists.map((l) => h('option', { value: l.id, selected: l.id === card.listId }, l.title)));
  const posSel = h('select', { 'aria-label': 'Position' });
  const fillPos = () => {
    const lid = Number(listSel.value);
    const n = board().cards.filter((c) => c.listId === lid && c.id !== card.id).length;
    const curIdx = board().cards.filter((c) => c.listId === lid).findIndex((c) => c.id === card.id);
    clear(posSel).append(...Array.from({ length: n + 1 }, (_, i) => h('option', { value: i, selected: lid === card.listId ? i === curIdx : i === n }, `Position ${i + 1}`)));
  };
  listSel.addEventListener('change', fillPos);
  fillPos();

  return [
    doneBtn,
    section('Zuständig', memberList),
    section('Labels', labelList),
    section('Termine',
      h('div', { class: 'field small' }, h('span', {}, 'Start'), h('div', { class: 'date-time' }, start, startTime)),
      h('div', { class: 'field small' }, h('span', {}, 'Fällig / Termin'), h('div', { class: 'date-time' }, due, dueTime)),
      h('p', { class: 'hint' }, 'Uhrzeit optional, z. B. für Sitzungen.')),
    section('Checkliste', h('button', { class: 'btn btn-sm btn-block', onclick: async () => {
      const title = await promptDialog('Neue Checkliste', { label: 'Titel', value: 'Checkliste', ok: 'Hinzufügen' });
      if (title) act(() => api.post(`/cards/${card.id}/checklists`, { title }))();
    } }, icon('checklist'), ' Checkliste hinzufügen')),
    section('Verschieben', listSel, posSel, h('button', { class: 'btn btn-sm btn-block', onclick: act(async () => {
      await api.post(`/cards/${card.id}/move`, { listId: Number(listSel.value), index: Number(posSel.value) });
      await refreshBoard();
      toast('Karte verschoben.');
    }) }, icon('move'), ' Verschieben')),
    section('Aktionen',
      h('button', { class: 'btn btn-sm btn-block', onclick: () => copyDialog(false) }, icon('card'), ' Kopieren'),
      h('button', {
        class: 'btn btn-sm btn-block', title: 'Vorlagenkarten zählen nicht als Aufgaben und lassen sich als Ausgangspunkt für neue Karten nutzen.',
        onclick: act(async () => {
          await api.patch(`/cards/${card.id}`, card.isTemplate ? { isTemplate: false } : { isTemplate: true, dueDate: null, startDate: null });
          toast(card.isTemplate ? 'Ist jetzt eine normale Karte.' : 'Ist jetzt eine Vorlagenkarte.', 'success');
        }),
      }, icon('settings'), card.isTemplate ? ' Vorlage aufheben' : ' Als Vorlage markieren'),
      h('button', { class: 'btn btn-sm btn-block', onclick: async () => {
        try { await api.patch(`/cards/${card.id}`, { archived: true }); toast('Karte archiviert.'); onChange?.(); closeCardModal(); } catch (err) { showError(err); }
      } }, icon('archive'), ' Archivieren'),
      h('button', { class: 'btn btn-sm btn-block btn-danger', onclick: async () => {
        if (!(await confirmDialog(`Karte „${card.title}“ endgültig löschen?`, { ok: 'Löschen', danger: true }))) return;
        try { await api.del(`/cards/${card.id}`); onChange?.(); closeCardModal(); } catch (err) { showError(err); }
      } }, icon('trash'), ' Löschen')),
  ];
}
