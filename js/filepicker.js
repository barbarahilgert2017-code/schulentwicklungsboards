import { api } from './api.js';
import { h, put, clear, icon, openModal, showError, promptDialog, fmtSize, fmtDateTime } from './dom.js';
import { state } from './state.js';

/**
 * Nextcloud-Dateiauswahl.
 * @param {object} o
 * @param {number} [o.boardId]       Board, dessen Ordner durchsucht werden kann
 * @param {boolean} [o.boardFolder]  Board-Ordner vorhanden?
 * @param {'file'|'folder'|'browse'} o.mode
 * @param {(entry, source) => Promise<void>|void} [o.onPick]
 */
export function openFilePicker({ boardId, boardFolder = false, mode = 'file', title, onPick, multiple = true }) {
  const sources = [];
  if (boardFolder && mode !== 'folder') sources.push({ key: 'board', label: 'Board-Ordner' });
  if (state.nextcloud) sources.push({ key: 'own', label: 'Meine Nextcloud' });
  if (!sources.length) {
    openModal({ title: 'Nextcloud', content: [h('p', {}, 'Bitte zuerst unter „Konto“ die Nextcloud verbinden.'), h('a', { class: 'btn btn-primary', href: '#/account' }, 'Zum Konto')] });
    return;
  }

  let source = sources[0].key;
  let path = null;
  let root = null;
  let data = null;
  const selected = new Map();

  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Pfad' });
  const listEl = h('ul', { class: 'file-list', role: 'listbox', 'aria-multiselectable': String(mode === 'file' && multiple) });
  const toolbar = h('div', { class: 'picker-toolbar' });
  const footer = h('div', { class: 'actions' });

  const m = openModal({
    title: title || (mode === 'folder' ? 'Ordner auswählen' : mode === 'browse' ? 'Board-Ordner' : 'Datei aus Nextcloud wählen'),
    wide: true,
    content: [tabs, toolbar, crumbs, listEl, footer],
  });

  async function load(newPath) {
    listEl.replaceChildren(h('li', { class: 'muted' }, h('span', { class: 'spinner' }), ' Lädt …'));
    try {
      const q = newPath ? `?path=${encodeURIComponent(newPath)}` : '';
      data = source === 'board' ? await api.get(`/boards/${boardId}/folder/files${q}`) : await api.get(`/nextcloud/files${q}`);
      path = data.path;
      root = source === 'board' ? data.root : '/';
      draw();
    } catch (err) {
      listEl.replaceChildren(h('li', { class: 'form-error' }, err.message));
    }
  }

  function draw() {
    clear(tabs);
    if (sources.length > 1 || mode === 'browse') {
      for (const s of sources) {
        tabs.append(h('button', {
          role: 'tab', 'aria-selected': String(s.key === source), class: s.key === source ? 'active' : '',
          onclick: () => { if (source !== s.key) { source = s.key; selected.clear(); load(null); } },
        }, s.label));
      }
    }

    // Brotkrumen
    clear(crumbs);
    const rel = root === '/' ? path : path.slice(root.length);
    const segs = rel.split('/').filter(Boolean);
    const rootLabel = source === 'board' ? root.split('/').pop() : 'Nextcloud';
    crumbs.append(h('button', { class: 'crumb', onclick: () => load(root) }, icon(source === 'board' ? 'folder' : 'cloud'), ` ${rootLabel}`));
    segs.forEach((s, i) => {
      const target = `${root === '/' ? '' : root}/${segs.slice(0, i + 1).join('/')}`;
      crumbs.append(h('span', { class: 'crumb-sep' }, '/'), h('button', { class: 'crumb', onclick: () => load(target) }, s));
    });

    put(clear(toolbar),
      h('button', {
        class: 'btn btn-sm',
        disabled: source === 'board' && state.boardRole === 'viewer',
        onclick: async () => {
          const name = await promptDialog('Neuer Ordner', { label: 'Ordnername', ok: 'Anlegen' });
          if (!name) return;
          try {
            if (source === 'board') await api.post(`/boards/${boardId}/folder/folders`, { parent: path, name });
            else await api.post('/nextcloud/folders', { parent: path, name });
            load(path);
          } catch (err) { showError(err); }
        },
      }, icon('plus'), ' Neuer Ordner'),
      data.self?.link ? h('a', { class: 'btn btn-sm', href: data.self.link, target: '_blank', rel: 'noopener noreferrer' }, icon('external'), ' In Nextcloud öffnen') : null);

    // Einträge
    clear(listEl);
    if (path !== root) {
      const up = path.split('/').slice(0, -1).join('/') || '/';
      listEl.append(h('li', {}, h('button', { class: 'file-row', onclick: () => load(up) }, icon('arrowLeft'), h('span', { class: 'file-name' }, '..'))));
    }
    if (!data.entries.length) listEl.append(h('li', { class: 'muted empty-row' }, 'Dieser Ordner ist leer.'));
    for (const e of data.entries) {
      const isSel = selected.has(e.path);
      const row = h('button', {
        class: `file-row ${isSel ? 'selected' : ''}`,
        role: 'option', 'aria-selected': String(isSel),
        disabled: !e.isDir && mode === 'folder',
        ondblclick: () => { if (!e.isDir && mode === 'file') { selected.set(e.path, e); finish(); } },
        onclick: () => {
          if (e.isDir) return load(e.path);
          if (mode === 'browse') { if (e.link) window.open(e.link, '_blank', 'noopener'); return; }
          if (!multiple) selected.clear();
          if (selected.has(e.path)) selected.delete(e.path); else selected.set(e.path, e);
          draw();
        },
      },
      icon(e.isDir ? 'folder' : 'file'),
      h('span', { class: 'file-name' }, e.name),
      h('span', { class: 'file-meta' }, e.isDir ? '' : fmtSize(e.size)),
      h('span', { class: 'file-meta hide-sm' }, e.modified ? fmtDateTime(new Date(e.modified).toISOString()) : ''));
      listEl.append(h('li', {}, row));
    }

    clear(footer);
    footer.append(h('button', { class: 'btn', onclick: () => m.close() }, mode === 'browse' ? 'Schließen' : 'Abbrechen'));
    if (mode === 'file') {
      footer.append(h('button', { class: 'btn btn-primary', disabled: !selected.size, onclick: finish },
        selected.size > 1 ? `${selected.size} Dateien anhängen` : 'Anhängen'));
    } else if (mode === 'folder') {
      footer.append(h('button', { class: 'btn btn-primary', disabled: path === '/', title: path === '/' ? 'Bitte einen Unterordner wählen' : '', onclick: () => finishFolder() },
        'Diesen Ordner verknüpfen'));
    }
  }

  async function finish() {
    try {
      for (const e of selected.values()) await onPick?.(e, source);
      m.close();
    } catch (err) { showError(err); }
  }

  async function finishFolder() {
    try {
      await onPick?.(data.self || { path, isDir: true }, source);
      m.close();
    } catch (err) { showError(err); }
  }

  load(null);
}
