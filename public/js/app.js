import { api, setCsrf } from './api.js';
import { h, put, clear, icon, toast, showError, openModal, fmtDate, dueState, avatar } from './dom.js';
import { state, navigate } from './state.js';
import { renderBoard, closeBoard } from './board.js';
import { renderAccount } from './account.js';

const main = document.getElementById('app');
const nav = document.getElementById('nav');

async function loadMe() {
  const me = await api.get('/auth/me');
  state.me = me.user;
  state.config = me.config;
  state.nextcloud = me.nextcloud;
  setCsrf(me.csrf);
  document.title = me.config.appName;
  document.getElementById('brand-name').textContent = me.config.appName;
}

function renderNav() {
  clear(nav);
  if (!state.me) return;
  const route = location.hash || '#/';
  const link = (href, label, ic) => h('a', { href, class: (route === href || (href !== '#/' && route.startsWith(href))) ? 'active' : '' }, icon(ic), h('span', {}, label));
  nav.append(
    link('#/', 'Boards', 'card'),
    link('#/tasks', 'Meine Aufgaben', 'checklist'),
    link('#/account', 'Konto', 'user'),
    h('button', { class: 'btn btn-ghost', onclick: logout }, 'Abmelden'),
  );
}

async function logout() {
  await api.post('/auth/logout').catch(() => {});
  state.me = null;
  await loadMe();
  navigate('#/');
}

// ---------------- Anmeldung / Registrierung ----------------

function renderAuth() {
  let mode = 'login';
  const box = h('div', { class: 'auth-box' });
  const draw = () => {
    clear(box);
    const err = h('p', { class: 'form-error', role: 'alert' });
    const email = h('input', { type: 'email', name: 'email', required: true, autocomplete: 'email', autofocus: true });
    const pw = h('input', { type: 'password', name: 'password', required: true, minlength: mode === 'register' ? 10 : undefined, autocomplete: mode === 'register' ? 'new-password' : 'current-password' });
    const name = h('input', { type: 'text', name: 'name', required: true, autocomplete: 'name' });
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = '';
        try {
          if (mode === 'register') await api.post('/auth/register', { email: email.value, name: name.value, password: pw.value });
          else await api.post('/auth/login', { email: email.value, password: pw.value });
          await loadMe();
          route();
        } catch (ex) { err.textContent = ex.message; }
      },
    },
    h('h1', {}, mode === 'register' ? 'Konto anlegen' : 'Anmelden'),
    mode === 'register' ? h('label', { class: 'field' }, h('span', {}, 'Name'), name) : null,
    h('label', { class: 'field' }, h('span', {}, 'Dienstliche E-Mail'), email),
    mode === 'register' && state.config.registrationDomains?.length
      ? h('p', { class: 'hint' }, `Erlaubt: ${state.config.registrationDomains.map((d) => `@${d}`).join(', ')}`) : null,
    h('label', { class: 'field' }, h('span', {}, mode === 'register' ? 'Passwort (mind. 10 Zeichen)' : 'Passwort'), pw),
    err,
    h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, mode === 'register' ? 'Registrieren' : 'Anmelden'),
    state.config.allowRegistration ? h('p', { class: 'auth-switch' },
      mode === 'register' ? 'Schon ein Konto? ' : 'Noch kein Konto? ',
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); mode = mode === 'register' ? 'login' : 'register'; draw(); } }, mode === 'register' ? 'Anmelden' : 'Registrieren')) : null);
    box.append(form);
  };
  draw();
  main.append(h('div', { class: 'auth-page' },
    h('div', { class: 'auth-intro' },
      h('h2', {}, 'Schulentwicklung gemeinsam organisieren'),
      h('ul', {},
        h('li', {}, 'Boards mit Listen, Karten und Checklisten für Steuergruppen, Fachschaften und Projektteams'),
        h('li', {}, 'Vorlagen für PDCA-Zyklus, Medienkonzept, interne Evaluation u. v. m.'),
        h('li', {}, 'Dateien bleiben in eurer Nextcloud – jedes Board bekommt einen eigenen Ordner'),
        h('li', {}, 'Gehostet in Deutschland, ohne Tracking und ohne externe Dienste'))),
    box));
}

// ---------------- Board-Übersicht ----------------

async function renderBoards() {
  const [boards, templates] = await Promise.all([api.get('/boards'), api.get('/templates')]);
  const active = boards.filter((b) => !b.archived);
  const archived = boards.filter((b) => b.archived);

  const tile = (b) => {
    const pct = b.stats.cards ? Math.round((b.stats.done / b.stats.cards) * 100) : 0;
    return h('a', { class: 'board-tile', href: `#/board/${b.id}`, style: { '--board-color': b.color } },
      h('div', { class: 'board-tile-head' }, h('h3', {}, b.title), b.folder ? h('span', { class: 'tile-folder', title: `Nextcloud: ${b.folder.path}` }, icon('cloud')) : null),
      b.description ? h('p', { class: 'board-tile-desc' }, b.description) : null,
      h('div', { class: 'progress', title: `${pct} % erledigt` }, h('div', { class: 'progress-bar', style: { width: `${pct}%` } })),
      h('div', { class: 'board-tile-stats' },
        h('span', {}, `${b.stats.cards} Karten`),
        b.stats.overdue ? h('span', { class: 'badge badge-overdue' }, `${b.stats.overdue} überfällig`) : null,
        h('span', { class: 'muted' }, icon('users', 14), ` ${b.stats.members}`)));
  };

  put(main,
    h('div', { class: 'page-head' },
      h('h1', {}, 'Boards'),
      h('button', { class: 'btn btn-primary', onclick: () => newBoardDialog(templates) }, icon('plus'), ' Neues Board')),
    active.length
      ? h('div', { class: 'board-grid' }, active.map(tile))
      : h('div', { class: 'empty' },
        h('p', {}, 'Noch keine Boards. Legt euer erstes Board an – am besten aus einer Vorlage für Schulentwicklung.'),
        h('button', { class: 'btn btn-primary', onclick: () => newBoardDialog(templates) }, 'Erstes Board anlegen')),
    archived.length ? h('details', { class: 'archived-boards' },
      h('summary', {}, `Archivierte Boards (${archived.length})`),
      h('div', { class: 'board-grid' }, archived.map(tile))) : null,
  );
}

function newBoardDialog(templates) {
  let selected = templates[0]?.key;
  const title = h('input', { type: 'text', required: true, maxlength: 120, autofocus: true, placeholder: 'z. B. Lesekonzept 2026/27' });
  const desc = h('textarea', { rows: 2, maxlength: 2000, placeholder: 'Worum geht es? (optional)' });
  const nc = !!state.nextcloud;
  const folder = h('input', { type: 'checkbox', checked: nc, disabled: !nc });
  const preview = h('div', { class: 'template-preview' });
  const grid = h('div', { class: 'template-grid', role: 'radiogroup', 'aria-label': 'Vorlage' });

  const drawTemplates = () => {
    clear(grid);
    for (const t of templates) {
      grid.append(h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(t.key === selected),
        class: `template-card ${t.key === selected ? 'selected' : ''}`, style: { '--board-color': t.color },
        onclick: () => { selected = t.key; drawTemplates(); },
      }, h('strong', {}, t.title), h('span', {}, t.description)));
    }
    const t = templates.find((x) => x.key === selected);
    put(clear(preview),
      h('div', { class: 'muted' }, 'Spalten: ', t.lists.join(' → ')),
      t.cardCount ? h('div', { class: 'muted' }, `${t.cardCount} vorbereitete Karten mit Checklisten`) : null,
      t.folders.length ? h('div', { class: 'muted' }, 'Nextcloud-Unterordner: ', t.folders.join(', ')) : null);
  };
  drawTemplates();

  const m = openModal({
    title: 'Neues Board', wide: true,
    content: h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const btn = e.submitter; if (btn) btn.disabled = true;
        try {
          const res = await api.post('/boards', { title: title.value, description: desc.value, templateKey: selected, createFolder: folder.checked });
          if (res.folderError) toast(`Board angelegt, aber Nextcloud-Ordner fehlgeschlagen: ${res.folderError}`, 'error');
          m.close();
          navigate(`#/board/${res.id}`);
        } catch (err) { showError(err); if (btn) btn.disabled = false; }
      },
    },
    h('label', { class: 'field' }, h('span', {}, 'Titel'), title),
    h('label', { class: 'field' }, h('span', {}, 'Beschreibung'), desc),
    h('div', { class: 'field' }, h('span', {}, 'Vorlage'), grid, preview),
    h('label', { class: 'check' }, folder,
      nc ? ` Board-Ordner in Nextcloud anlegen (${state.config.nextcloudBaseFolder}/…)`
        : h('span', {}, ' Board-Ordner in Nextcloud anlegen – ', h('a', { href: '#/account', onclick: () => m.close() }, 'zuerst Nextcloud verbinden'))),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => m.close() }, 'Abbrechen'),
      h('button', { type: 'submit', class: 'btn btn-primary' }, 'Board anlegen'))),
  });
}

// ---------------- Meine Aufgaben ----------------

async function renderTasks() {
  const { cards, items } = await api.get('/my/tasks');
  const all = [
    ...cards.map((c) => ({ kind: 'card', title: c.title, due: c.dueDate, boardId: c.boardId, boardTitle: c.boardTitle, color: c.boardColor, cardId: c.id, sub: c.listTitle })),
    ...items.map((i) => ({ kind: 'item', title: i.text, due: i.dueDate, boardId: i.boardId, boardTitle: i.boardTitle, color: i.boardColor, cardId: i.cardId, sub: `Checkliste in „${i.cardTitle}“` })),
  ];
  const groups = { overdue: [], soon: [], later: [], none: [] };
  for (const t of all) {
    const s = dueState(t.due, false);
    (s === 'overdue' ? groups.overdue : s === 'soon' ? groups.soon : s === 'ok' ? groups.later : groups.none).push(t);
  }
  const sortDue = (a, b) => (a.due || '').localeCompare(b.due || '');
  const section = (title, list, cls = '') => (list.length ? h('section', { class: `task-group ${cls}` },
    h('h2', {}, title, h('span', { class: 'count' }, list.length)),
    h('ul', { class: 'task-list' }, list.sort(sortDue).map((t) => h('li', {},
      h('a', { href: `#/board/${t.boardId}/card/${t.cardId}`, style: { '--board-color': t.color } },
        icon(t.kind === 'card' ? 'card' : 'checklist'),
        h('span', { class: 'task-title' }, t.title),
        h('span', { class: 'task-meta' }, `${t.boardTitle} · ${t.sub}`),
        t.due ? h('span', { class: `due due-${dueState(t.due, false)}` }, fmtDate(t.due)) : null))))) : null);

  put(main,
    h('div', { class: 'page-head' }, h('h1', {}, 'Meine Aufgaben')),
    all.length ? [
      section('Überfällig', groups.overdue, 'overdue'),
      section('In den nächsten 3 Tagen', groups.soon),
      section('Später', groups.later),
      section('Ohne Termin', groups.none),
    ] : h('div', { class: 'empty' }, h('p', {}, 'Dir sind gerade keine offenen Karten oder Checklistenpunkte zugewiesen.')),
  );
}

// ---------------- Router ----------------

async function route() {
  const hash = location.hash || '#/';
  renderNav();
  if (!state.me) {
    closeBoard();
    clear(main);
    renderAuth();
    return;
  }
  const m = hash.match(/^#\/board\/(\d+)(?:\/card\/(\d+))?/);
  try {
    if (m) {
      await renderBoard(main, Number(m[1]), m[2] ? Number(m[2]) : null);
      return;
    }
    closeBoard();
    clear(main);
    if (hash.startsWith('#/tasks')) await renderTasks();
    else if (hash.startsWith('#/account')) await renderAccount(main, { reload: async () => { await loadMe(); route(); } });
    else await renderBoards();
  } catch (err) {
    clear(main).append(h('div', { class: 'empty' }, h('p', {}, err.message), h('a', { class: 'btn', href: '#/' }, 'Zur Übersicht')));
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('seb:unauthorized', async () => { await loadMe(); route(); });

(async () => {
  try {
    await loadMe();
  } catch (err) {
    main.textContent = err.message;
    return;
  }
  route();
})();

export { avatar };
