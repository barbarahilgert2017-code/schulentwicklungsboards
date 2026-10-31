/** Erzeugt DOM-Elemente sicher (kein innerHTML für Nutzerdaten). */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, val); else el.style[prop] = val;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'readOnly') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Wie Element.append, ignoriert aber null/false und flacht Arrays ab. */
export const put = (el, ...children) => { append(el, children); return el; };

export const clear = (el) => { while (el.firstChild) el.firstChild.remove(); return el; };
export const $ = (sel, root = document) => root.querySelector(sel);

// ---- Icons (inline SVG, keine externen Quellen) ----
const ICONS = {
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5L20 7',
  clock: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  checklist: 'M4 7l2 2 4-4M4 17l2 2 4-4M13 7h7M13 17h7',
  comment: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.3A8 8 0 1 1 21 12z',
  clip: 'M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  file: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6',
  link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  text: 'M4 6h16M4 12h16M4 18h10',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M18 14a6 6 0 0 1 4 7',
  menu: 'M5 12h.01M12 12h.01M19 12h.01',
  tag: 'M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9zM7.5 7.5h.01',
  calendar: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 10h16M8 2v4M16 2v4',
  archive: 'M3 4h18v4H3zM5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  cloud: 'M7 18a5 5 0 0 1-.5-10A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z',
  share: 'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
  activity: 'M3 12h4l3 8 4-16 3 8h4',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  move: 'M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20',
  arrowLeft: 'M19 12H5M12 19l-7-7 7-7',
  arrowRight: 'M5 12h14M12 5l7 7-7 7',
  card: 'M3 5h18v14H3zM3 10h18',
};

export function icon(name, size = 16) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICONS[name] || ICONS.file);
  svg.append(path);
  return svg;
}

// ---- Benachrichtigungen ----
export function toast(message, type = 'info') {
  let box = $('#toasts');
  if (!box) { box = h('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div', { class: `toast toast-${type}` }, message);
  box.append(t);
  setTimeout(() => t.classList.add('hide'), type === 'error' ? 6000 : 3500);
  setTimeout(() => t.remove(), type === 'error' ? 6500 : 4000);
}

export const showError = (err) => toast(err?.message || String(err), 'error');

// ---- Modale Dialoge ----
const modalStack = [];

export function openModal({ title, content, wide = false, className = '', onClose } = {}) {
  const prevFocus = document.activeElement;
  const body = h('div', { class: 'modal-body' });
  const titleEl = h('h2', { class: 'modal-title', id: `mt-${Date.now()}` }, title || '');
  const dialog = h('div', { class: `modal ${wide ? 'modal-wide' : ''} ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleEl.id },
    h('div', { class: 'modal-head' }, titleEl,
      h('button', { class: 'icon-btn', 'aria-label': 'Schließen', title: 'Schließen (Esc)', onclick: () => close() }, icon('x', 20))),
    body);
  const overlay = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === overlay) close(); } }, dialog);
  document.body.append(overlay);
  document.body.classList.add('no-scroll');
  let closed = false;
  const entry = { close };
  modalStack.push(entry);

  function close() {
    if (closed) return;
    closed = true;
    overlay.remove();
    modalStack.splice(modalStack.indexOf(entry), 1);
    if (!modalStack.length) document.body.classList.remove('no-scroll');
    if (prevFocus && document.contains(prevFocus)) prevFocus.focus();
    onClose?.();
  }
  if (content) append(body, [content]);
  dialog.tabIndex = -1;
  requestAnimationFrame(() => {
    const auto = dialog.querySelector('[autofocus]');
    if (auto) auto.focus(); else dialog.focus({ preventScroll: true });
  });
  return { close, body, dialog, setTitle: (t) => { titleEl.textContent = t; } };
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalStack.length) {
    const active = document.activeElement;
    if (active?.dataset?.escapeCancels) return; // Eingabefeld behandelt Esc selbst
    e.preventDefault();
    modalStack.at(-1).close();
  }
});

export function confirmDialog(message, { ok = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const m = openModal({
      title: 'Bitte bestätigen',
      onClose: () => resolve(result),
      content: [
        h('p', {}, message),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onclick: () => m.close() }, 'Abbrechen'),
          h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, autofocus: true, onclick: () => { result = true; m.close(); } }, ok)),
      ],
    });
  });
}

export function promptDialog(title, { label = '', value = '', placeholder = '', ok = 'Speichern', type = 'text' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const input = h('input', { type, value, placeholder, autofocus: true, 'aria-label': label || title });
    const m = openModal({
      title,
      onClose: () => resolve(result),
      content: h('form', { onsubmit: (e) => { e.preventDefault(); result = input.value.trim(); m.close(); } },
        label ? h('label', { class: 'field' }, h('span', {}, label), input) : input,
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn', onclick: () => m.close() }, 'Abbrechen'),
          h('button', { type: 'submit', class: 'btn btn-primary' }, ok))),
    });
  });
}

/** Kleines Dropdown-Menü an einem Button. items: [{label, icon, onClick, danger, disabled}] | 'sep' */
export function popupMenu(anchor, items) {
  document.querySelectorAll('.popup-menu').forEach((m) => m.remove());
  const menu = h('div', { class: 'popup-menu', role: 'menu' },
    items.filter(Boolean).map((it) => (it === 'sep' ? h('hr') : h('button', {
      role: 'menuitem', class: it.danger ? 'danger' : '', disabled: it.disabled,
      onclick: () => { menu.remove(); it.onClick(); },
    }, it.icon ? icon(it.icon) : null, it.label))));
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  menu.style.top = `${r.bottom + window.scrollY + 4}px`;
  menu.style.left = `${Math.max(8, Math.min(r.left + window.scrollX, window.innerWidth - w - 8))}px`;
  menu.querySelector('button')?.focus();
  const off = (e) => {
    if (!menu.contains(e.target) || e.key === 'Escape') {
      if (e.type === 'keydown' && e.key !== 'Escape') return;
      menu.remove();
      document.removeEventListener('mousedown', off, true);
      document.removeEventListener('keydown', off, true);
    }
  };
  setTimeout(() => { document.addEventListener('mousedown', off, true); document.addEventListener('keydown', off, true); });
}

// ---- Formatierung ----
const dtf = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dtfShort = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });
const dttf = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

export const fmtDate = (d) => (d ? dtf.format(new Date(`${d}T00:00:00`)) : '');
export const fmtDateShort = (d) => (d ? dtfShort.format(new Date(`${d}T00:00:00`)) : '');
export const fmtDateTime = (s) => (s ? dttf.format(new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`)) : '');
export function fmtSize(n) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export const today = () => new Date().toISOString().slice(0, 10);

/** 'overdue' | 'soon' (≤ 3 Tage) | 'ok' | null */
export function dueState(due, completed) {
  if (!due) return null;
  if (completed) return 'done';
  const diff = (new Date(`${due}T00:00:00`) - new Date(`${today()}T00:00:00`)) / 86400000;
  if (diff < 0) return 'overdue';
  if (diff <= 3) return 'soon';
  return 'ok';
}

export function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts.at(-1)[0] : '')).toUpperCase() || '?';
}

export function avatar(user, size = 'sm') {
  let hash = 0;
  for (const ch of user?.name || '') hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return h('span', { class: `avatar avatar-${size}`, title: user?.name, style: { background: `hsl(${hash % 360} 45% 42%)` } }, initials(user?.name));
}

/** Text mit automatisch verlinkten URLs (sicher, ohne innerHTML). */
export function linkify(text) {
  const out = [];
  const re = /https?:\/\/[^\s<>"]+/g;
  let last = 0; let m;
  while ((m = re.exec(text))) {
    out.push(text.slice(last, m.index));
    const url = m[0].replace(/[.,;:!?)]+$/, '');
    out.push(h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, url));
    last = m.index + url.length;
  }
  out.push(text.slice(last));
  return out;
}

/** Inline-Bearbeitung: ersetzt ein Element durch ein Eingabefeld. */
export function inlineEdit(el, { value, multiline = false, onSave, maxLength = 300 }) {
  const input = multiline ? h('textarea', { rows: 3, maxlength: maxLength }) : h('input', { type: 'text', maxlength: maxLength });
  input.value = value;
  input.className = 'inline-input';
  input.dataset.escapeCancels = '1';
  el.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    input.replaceWith(el);
    if (save && v && v !== value) await onSave(v);
  };
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  });
}

export const LABEL_COLORS = ['#c0392b', '#e74c3c', '#d68910', '#f1c40f', '#2e8b57', '#16a085', '#1abc9c', '#2f6f9f', '#3498db', '#7b4fa0', '#8e44ad', '#5d6d7e'];
