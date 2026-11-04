import { api, setCsrf } from './api.js';
import { h, put, clear, icon, toast, showError, openModal, fmtDate, dueState, avatar } from './dom.js';
import { state, navigate } from './state.js';
import { renderBoard, closeBoard } from './board.js';
import { renderAccount } from './account.js';
import { renderAdmin } from './admin.js';

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
  put(nav,
    link('#/', 'Boards', 'card'),
    link('#/tasks', 'Meine Aufgaben', 'checklist'),
    link('#/account', 'Konto', 'user'),
    state.me.isAdmin ? link('#/admin', 'Verwaltung', 'settings') : null,
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
  const setup = !!state.config.needsSetup;
  let mode = setup ? 'register' : 'login';
  const box = h('div', { class: 'auth-box' });
  const draw = () => {
    clear(box);
    const err = h('p', { class: 'form-error', role: 'alert' });
    const email = h('input', { type: 'email', name: 'email', required: true, autocomplete: 'email', autofocus: !setup });
    const pw = h('input', { type: 'password', name: 'password', required: true, minlength: mode === 'register' ? 10 : undefined, autocomplete: mode === 'register' ? 'new-password' : 'current-password' });
    const name = h('input', { type: 'text', name: 'name', required: true, autocomplete: 'name' });
    const code = h('input', { type: 'text', name: 'setupCode', required: true, autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', autofocus: true, placeholder: 'XXXX-XXXX-XXXX' });
    const switchTo = (m) => (e) => { e.preventDefault(); mode = m; draw(); };

    if (mode === 'forgot') {
      put(box, h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          err.textContent = '';
          try {
            const r = await api.post('/auth/forgot', { email: email.value });
            clear(box).append(h('div', {},
              h('h1', {}, 'Passwort vergessen'),
              r.mailEnabled
                ? h('p', {}, `Falls es ein Konto für ${email.value} gibt, ist jetzt eine E-Mail mit einem Link zum Setzen eines neuen Passworts unterwegs. Der Link ist 2 Stunden gültig. Bitte auch im Spam-Ordner nachsehen.`)
                : h('p', {}, 'Auf diesem Server ist kein E-Mail-Versand eingerichtet. Bitte wende dich an die Administration – sie kann dir unter „Verwaltung“ einen Link zum Zurücksetzen erstellen.'),
              h('p', { class: 'auth-switch' }, h('a', { href: '#', onclick: switchTo('login') }, 'Zurück zur Anmeldung'))));
          } catch (ex) { err.textContent = ex.message; }
        },
      },
      h('h1', {}, 'Passwort vergessen'),
      h('p', { class: 'muted' }, 'Gib deine E-Mail-Adresse ein. Du bekommst einen Link, mit dem du ein neues Passwort setzen kannst.'),
      h('label', { class: 'field' }, h('span', {}, 'Dienstliche E-Mail'), email),
      err,
      h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Link anfordern'),
      h('p', { class: 'auth-switch' }, h('a', { href: '#', onclick: switchTo('login') }, 'Zurück zur Anmeldung'))));
      return;
    }

    put(box, h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = '';
        try {
          if (mode === 'register') await api.post('/auth/register', { email: email.value, name: name.value, password: pw.value, setupCode: code.value });
          else await api.post('/auth/login', { email: email.value, password: pw.value });
          await loadMe();
          if (setup) toast('Willkommen! Du bist jetzt Administratorin bzw. Administrator dieser Installation.', 'success');
          route();
        } catch (ex) { err.textContent = ex.message; }
      },
    },
    h('h1', {}, setup ? 'Ersteinrichtung' : mode === 'register' ? 'Konto anlegen' : 'Anmelden'),
    setup ? h('p', { class: 'muted' }, 'Lege das erste Konto an. Es erhält Administrationsrechte und kann später weitere Personen verwalten.') : null,
    setup && state.config.setupCodeRequired
      ? h('label', { class: 'field' }, h('span', {}, 'Einrichtungscode'), code, h('small', { class: 'hint' }, 'Wurde am Ende der Installation auf dem Server angezeigt.')) : null,
    mode === 'register' ? h('label', { class: 'field' }, h('span', {}, 'Name'), name) : null,
    h('label', { class: 'field' }, h('span', {}, 'Dienstliche E-Mail'), email),
    mode === 'register' && !setup && state.config.registrationDomains?.length
      ? h('p', { class: 'hint' }, `Erlaubt: ${state.config.registrationDomains.map((d) => `@${d}`).join(', ')}`) : null,
    h('label', { class: 'field' }, h('span', {}, mode === 'register' ? 'Passwort (mind. 10 Zeichen)' : 'Passwort'), pw),
    mode === 'login' ? h('p', { class: 'forgot-link' }, h('a', { href: '#', onclick: switchTo('forgot') }, 'Passwort vergessen?')) : null,
    err,
    h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, setup ? 'Einrichten' : mode === 'register' ? 'Registrieren' : 'Anmelden'),
    !setup && state.config.allowRegistration ? h('p', { class: 'auth-switch' },
      mode === 'register' ? 'Schon ein Konto? ' : 'Noch kein Konto? ',
      h('a', { href: '#', onclick: switchTo(mode === 'register' ? 'login' : 'register') }, mode === 'register' ? 'Anmelden' : 'Registrieren')) : null));
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

// ---------------- Neues Passwort setzen ----------------

async function renderReset(token) {
  const box = h('div', { class: 'auth-box invite-box' });
  main.append(h('div', { class: 'invite-page' }, box));
  let info;
  try {
    info = await api.get(`/auth/reset/${encodeURIComponent(token)}`);
  } catch (err) {
    put(box, h('h1', {}, 'Link ungültig'), h('p', {}, err.message), h('a', { class: 'btn', href: '#/' }, 'Zur Anmeldung'));
    return;
  }
  const err = h('p', { class: 'form-error', role: 'alert' });
  const pw = h('input', { type: 'password', required: true, minlength: 10, autocomplete: 'new-password', autofocus: true });
  const pw2 = h('input', { type: 'password', required: true, minlength: 10, autocomplete: 'new-password' });
  put(box, h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      if (pw.value !== pw2.value) { err.textContent = 'Die beiden Passwörter stimmen nicht überein.'; return; }
      try {
        await api.post(`/auth/reset/${encodeURIComponent(token)}`, { password: pw.value });
        await loadMe();
        toast('Neues Passwort gespeichert. Du bist angemeldet.', 'success');
        navigate('#/');
      } catch (ex) { err.textContent = ex.message; }
    },
  },
  h('h1', {}, 'Neues Passwort setzen'),
  h('p', { class: 'muted' }, `Für ${info.name} (${info.email})`),
  h('label', { class: 'field' }, h('span', {}, 'Neues Passwort (mind. 10 Zeichen)'), pw),
  h('label', { class: 'field' }, h('span', {}, 'Wiederholen'), pw2),
  err,
  h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Passwort speichern'),
  h('p', { class: 'hint' }, 'Danach wirst du auf allen anderen Geräten abgemeldet.')));
}

// ---------------- Einladung annehmen ----------------

async function renderInvite(token) {
  let info;
  try {
    info = await api.get(`/invitations/token/${encodeURIComponent(token)}`);
  } catch (err) {
    main.append(h('div', { class: 'empty' }, h('p', {}, err.message), h('a', { class: 'btn', href: '#/' }, 'Zur Startseite')));
    return;
  }
  const ROLE = { owner: 'Verantwortlich', editor: 'Bearbeiten', viewer: 'Lesen' };
  const box = h('div', { class: 'auth-box invite-box' });
  const head = [
    h('p', { class: 'muted' }, 'Einladung'),
    h('h1', {}, info.boardTitle),
    h('p', {}, `${info.inviter || 'Jemand'} lädt dich ein mitzuarbeiten – Rolle: `, h('strong', {}, ROLE[info.role])),
  ];
  main.append(h('div', { class: 'invite-page' }, box));

  const done = (boardId) => { toast('Willkommen im Board!', 'success'); navigate(`#/board/${boardId}`); };

  if (info.accepted || info.expired) {
    put(box, head, h('p', { class: 'form-error' }, info.accepted ? 'Diese Einladung wurde bereits angenommen.' : 'Diese Einladung ist abgelaufen. Bitte um einen neuen Link.'),
      h('a', { class: 'btn', href: '#/' }, state.me ? 'Zu meinen Boards' : 'Zur Anmeldung'));
    return;
  }

  if (state.me) {
    put(box, head,
      state.me.email.toLowerCase() !== info.email.toLowerCase()
        ? h('p', { class: 'hint' }, `Die Einladung ging an ${info.email}. Du bist als ${state.me.email} angemeldet und trittst mit diesem Konto bei.`) : null,
      h('button', {
        class: 'btn btn-primary btn-block',
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          try { done((await api.post(`/invitations/token/${encodeURIComponent(token)}/accept`)).boardId); } catch (err) { showError(err); e.target.disabled = false; }
        },
      }, 'Einladung annehmen'));
    return;
  }

  let mode = info.accountExists ? 'login' : 'register';
  const draw = () => {
    clear(box);
    const err = h('p', { class: 'form-error', role: 'alert' });
    const name = h('input', { type: 'text', required: true, autocomplete: 'name', autofocus: true });
    const email = h('input', { type: 'email', value: info.email, readOnly: mode === 'register', required: true, autocomplete: 'email' });
    const pw = h('input', { type: 'password', required: true, minlength: mode === 'register' ? 10 : undefined, autocomplete: mode === 'register' ? 'new-password' : 'current-password' });
    put(box, head, h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = '';
        try {
          if (mode === 'register') {
            const r = await api.post('/auth/register', { name: name.value, password: pw.value, inviteToken: token });
            await loadMe();
            renderNav();
            done(r.boardId);
          } else {
            await api.post('/auth/login', { email: email.value, password: pw.value });
            await loadMe();
            renderNav();
            done((await api.post(`/invitations/token/${encodeURIComponent(token)}/accept`)).boardId);
          }
        } catch (ex) { err.textContent = ex.message; }
      },
    },
    h('h2', {}, mode === 'register' ? 'Konto anlegen und beitreten' : 'Anmelden und beitreten'),
    mode === 'register' ? h('label', { class: 'field' }, h('span', {}, 'Dein Name'), name) : null,
    h('label', { class: 'field' }, h('span', {}, 'E-Mail'), email),
    h('label', { class: 'field' }, h('span', {}, mode === 'register' ? 'Passwort wählen (mind. 10 Zeichen)' : 'Passwort'), pw),
    err,
    h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, mode === 'register' ? 'Konto anlegen & beitreten' : 'Anmelden & beitreten'),
    h('p', { class: 'auth-switch' }, h('a', {
      href: '#', onclick: (e) => { e.preventDefault(); mode = mode === 'register' ? 'login' : 'register'; draw(); },
    }, mode === 'register' ? 'Ich habe schon ein Konto' : 'Ich habe noch kein Konto'))));
  };
  draw();
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
  const reset = hash.match(/^#\/reset\/([\w-]+)/);
  if (reset) {
    closeBoard();
    clear(main);
    await renderReset(reset[1]);
    return;
  }
  const inv = hash.match(/^#\/invite\/([\w-]+)/);
  if (inv) {
    closeBoard();
    clear(main);
    await renderInvite(inv[1]);
    return;
  }
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
    else if (hash.startsWith('#/admin') && state.me.isAdmin) await renderAdmin(main);
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
