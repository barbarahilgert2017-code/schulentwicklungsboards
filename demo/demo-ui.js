/**
 * Klick-Dummy: Demo-Leiste (Person wechseln, Rundgang, Postausgang, Zurücksetzen)
 * und gemeinsames Feedback-Panel (geteilte Daten über den `db`-Dienst der Seite).
 */
import { demo } from './mock-api.js';
import { h, put, clear, icon, openModal, toast, fmtDateTime } from '../js/dom.js';

// Neu laden der App ohne Seiten-Reload (app.js lauscht auf dieses Ereignis)
function refreshApp(hash = '#/') {
  try { history.replaceState(null, '', hash); } catch { location.hash = hash; }
  window.dispatchEvent(new Event('seb:unauthorized'));
  setTimeout(updateBar, 300);
}

// ---------------- Demo-Leiste ----------------
const bar = h('div', { class: 'demo-bar', role: 'region', 'aria-label': 'Klick-Dummy' });
document.body.prepend(bar);
document.body.classList.add('demo');
new ResizeObserver(() => document.documentElement.style.setProperty('--demo-bar-h', `${bar.offsetHeight}px`)).observe(bar);

function updateBar() {
  const users = demo.users();
  const sel = h('select', {
    id: 'demo-persona', 'aria-label': 'Ansicht als Person',
    onchange: (e) => {
      const uid = Number(e.target.value);
      demo.setUser(uid);
      toast(`Du siehst die App jetzt als ${users.find((u) => u.id === uid).name}.`);
      refreshApp('#/');
    },
  },
  demo.current() ? null : h('option', { value: '', selected: true }, '— abgemeldet —'),
  users.map((u) => h('option', { value: u.id, selected: u.id === demo.current() }, `${u.name} · ${u.about || ''}${u.nextcloud ? '' : ' · ohne Nextcloud'}`)));
  const n = demo.outbox().length;
  clear(bar).append(
    h('span', { class: 'demo-tag' }, 'Klick-Dummy'),
    h('span', { class: 'demo-note' }, 'Alles hier ist simuliert und bleibt in deinem Browser.'),
    h('label', { class: 'demo-persona', for: 'demo-persona' }, 'Ansicht als'), sel,
    h('span', { class: 'demo-actions' },
      h('button', { class: 'demo-btn', onclick: showTour }, 'Rundgang'),
      h('button', { class: 'demo-btn', onclick: showOutbox }, `Postausgang${n ? ` (${n})` : ''}`),
      h('button', { class: 'demo-btn', onclick: confirmReset }, 'Zurücksetzen')));
}
updateBar();
window.addEventListener('hashchange', () => setTimeout(updateBar, 400));

function confirmReset() {
  const m = openModal({
    title: 'Demo zurücksetzen?',
    content: [
      h('p', {}, 'Alle Änderungen in diesem Browser werden verworfen und die Beispieldaten neu geladen. Das gemeinsame Feedback bleibt erhalten.'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => m.close() }, 'Abbrechen'),
        h('button', { class: 'btn btn-danger', onclick: () => { demo.reset(); m.close(); toast('Beispieldaten neu geladen.'); refreshApp('#/'); } }, 'Zurücksetzen')),
    ],
  });
}

// ---------------- Postausgang ----------------
function showOutbox() {
  const mails = demo.outbox();
  const m = openModal({
    title: 'Postausgang (simuliert)', wide: true,
    content: [
      h('p', { class: 'hint' }, 'Diese E-Mails würde die echte App über den Mailserver der Schule verschicken. Hier werden sie nur angezeigt.'),
      mails.length ? h('ul', { class: 'outbox' }, mails.map((mail) => h('li', {},
        h('div', { class: 'outbox-head' }, h('strong', {}, mail.subject), h('span', { class: 'muted small' }, `an ${mail.to} · ${fmtDateTime(mail.at)}`)),
        h('pre', { class: 'outbox-text' }, mail.text),
        mail.inviteToken ? h('button', {
          class: 'btn btn-sm btn-primary',
          onclick: () => { m.close(); demo.logout(); toast(`Du öffnest den Link jetzt als ${mail.to}.`); refreshApp(`#/invite/${mail.inviteToken}`); },
        }, 'Als eingeladene Person öffnen') : null)))
        : h('p', { class: 'muted' }, 'Noch keine E-Mails. Lade jemanden ein: Board öffnen → Mitglieder → E-Mail-Adresse eingeben.'),
    ],
  });
}

// ---------------- Rundgang ----------------
function go(hash) { location.hash = hash; }
function showTour() {
  const mk = demo.boardId('Medienkonzept 2026/27');
  const ds = demo.cardId('Datenschutzrechtliche Prüfung digitaler Werkzeuge');
  const steps = [
    ['Board ansehen', 'Im Board „Medienkonzept 2026/27“ Karten per Drag & Drop verschieben und oben nach „Überfällig“ oder Labels filtern.', mk && `#/board/${mk}`],
    ['Karte bearbeiten', 'Checkliste abhaken, Punkte Personen zuweisen, Fälligkeit setzen, kommentieren.', mk && ds && `#/board/${mk}/card/${ds}`],
    ['Nextcloud', 'In einer Karte „Aus Nextcloud“ eine Datei anhängen oder per „Hochladen“ in den Board-Ordner legen. Den Ordner gibt es oben über „Board-Ordner“.', null],
    ['Neues Board aus Vorlage', 'Auf der Übersicht „Neues Board“ wählen, eine Schulentwicklungs-Vorlage nehmen und den Nextcloud-Ordner mit anlegen lassen.', '#/'],
    ['Einladen', 'Im Board auf die Personen-Symbole klicken, eine neue E-Mail-Adresse einladen und im Postausgang die Einladung als eingeladene Person öffnen.', null],
    ['Rollen erleben', 'Oben „Ansicht als“ auf Dr. Anna Krüger (Schulleitung, liest mit) oder Thomas Becker (verbindet seine Nextcloud unter „Konto“) stellen.', null],
    ['Meine Aufgaben', 'Alles, was der gewählten Person zugewiesen ist, über alle Boards hinweg.', '#/tasks'],
    ['Feedback geben', 'Unten rechts Ideen, Probleme und Fragen sammeln und für die Wünsche anderer stimmen. Das sehen alle, die diese Seite geöffnet haben.', null],
  ];
  const m = openModal({
    title: 'Rundgang durch den Klick-Dummy', wide: true,
    content: [
      h('p', {}, 'Das ist ein Klick-Dummy von Schulentwicklungsboards: die echte Oberfläche mit Beispieldaten einer fiktiven Schule. Nextcloud und E-Mail-Versand werden simuliert. Alles, was du änderst, bleibt in deinem Browser und stört niemanden.'),
      h('ol', { class: 'tour' }, steps.map(([t, d, hash]) => h('li', {},
        h('div', {}, h('strong', {}, t), h('p', { class: 'muted' }, d)),
        hash ? h('button', { class: 'btn btn-sm', onclick: () => { m.close(); go(hash); } }, 'Hin') : null))),
      h('div', { class: 'actions' }, h('button', { class: 'btn btn-primary', autofocus: true, onclick: () => m.close() }, 'Los geht’s')),
    ],
  });
}
let toured = false;
try { toured = localStorage.getItem('seb-klickdummy-tour') === '1'; localStorage.setItem('seb-klickdummy-tour', '1'); } catch { /* egal */ }
if (!toured) setTimeout(showTour, 700);

// ---------------- Gemeinsames Feedback ----------------
const KINDS = { idee: 'Idee', problem: 'Problem', frage: 'Frage', gut: 'Gefällt mir' };
const fb = { db: null, user: null, uid: null, canWrite: true, items: [], votes: new Map(), loading: true, stale: false, error: null, open: false, sort: 'votes', kind: 'idee' };

const fab = h('button', { class: 'fb-fab', 'aria-expanded': 'false', 'aria-controls': 'fb-panel', onclick: () => toggle() }, icon('comment', 18), h('span', { class: 'fb-fab-label' }, 'Feedback & Ideen'), h('span', { class: 'fb-count' }));
const panel = h('aside', { id: 'fb-panel', class: 'fb-panel', 'aria-label': 'Feedback & Ideen', hidden: true });
document.body.append(fab, panel);

function toggle(force) {
  fb.open = force ?? !fb.open;
  panel.hidden = !fb.open;
  fab.setAttribute('aria-expanded', String(fb.open));
  if (fb.open) { render(); panel.querySelector('textarea')?.focus(); }
}

function currentContext() {
  const hash = location.hash;
  const board = document.querySelector('.board-title')?.textContent?.trim();
  const card = document.querySelector('.card-detail-title')?.textContent?.trim();
  if (/^#\/board\/\d+\/card\//.test(hash) && board && card) return `Karte „${card}“ in „${board}“`;
  if (hash.startsWith('#/board/') && board) return `Board „${board}“`;
  if (hash.startsWith('#/tasks')) return 'Meine Aufgaben';
  if (hash.startsWith('#/account')) return 'Konto / Nextcloud';
  if (hash.startsWith('#/invite')) return 'Einladung annehmen';
  if (document.querySelector('.modal-title')?.textContent === 'Neues Board') return 'Neues Board / Vorlagen';
  return 'Board-Übersicht';
}

const draft = { text: '' };

async function render() {
  const votesFor = (fid) => [...fb.votes.values()].filter((ids) => ids.includes(fid)).length;
  const mine = fb.uid ? fb.votes.get(fb.uid) || [] : [];
  const items = [...fb.items].sort((a, b) => (fb.sort === 'votes' ? votesFor(b.id) - votesFor(a.id) : 0) || b.createdAt - a.createdAt);
  fab.querySelector('.fb-count').textContent = fb.items.length ? String(fb.items.length) : '';
  if (!fb.open) return;

  const authorIds = [...new Set(items.map((i) => i.authorId).filter(Boolean))];
  const ps = fb.user && authorIds.length ? await fb.user.profiles(authorIds) : {};

  const head = h('div', { class: 'fb-head' },
    h('div', {}, h('h2', {}, 'Feedback & Ideen'), h('p', { class: 'muted small' }, 'Gemeinsam für alle, die diesen Klick-Dummy geöffnet haben.')),
    h('button', { class: 'icon-btn', 'aria-label': 'Schließen', onclick: () => toggle(false) }, icon('x', 20)));

  let form = null;
  if (!fb.db) {
    form = h('p', { class: 'fb-note' }, fb.loading ? 'Verbinde …' : 'Das gemeinsame Feedback ist nur verfügbar, wenn die Seite auf claude.ai geöffnet ist und du angemeldet bist.');
  } else if (!fb.canWrite || !fb.uid) {
    form = h('p', { class: 'fb-note' }, 'Du kannst das Feedback lesen. Zum Mitschreiben braucht dein Zugang mindestens die Rolle „Mitwirkende/r“ – bitte bei der Person nachfragen, die den Link geteilt hat.');
  } else {
    const ta = h('textarea', { id: 'fb-text', rows: 3, maxlength: 1000, placeholder: 'Was fehlt, was stört, was ist gut?', 'aria-label': 'Feedback' });
    ta.value = draft.text;
    ta.addEventListener('input', () => { draft.text = ta.value; });
    const ctxBox = h('input', { type: 'checkbox', id: 'fb-ctx', checked: true });
    const ctx = currentContext();
    form = h('form', {
      class: 'fb-form',
      onsubmit: async (e) => {
        e.preventDefault();
        const text = ta.value.trim();
        if (!text) return;
        const btn = e.submitter; if (btn) btn.disabled = true;
        try {
          await fb.db.collection('feedback').add({ text, kind: fb.kind, context: ctxBox.checked ? ctx : '', authorId: fb.uid, createdAt: Date.now() });
          draft.text = '';
          toast('Danke! Dein Feedback ist für alle sichtbar.', 'success');
        } catch (err) {
          toast(err?.code === 'quota_exceeded' ? 'Die Feedback-Liste ist voll. Bitte erledigte Einträge löschen.' : 'Speichern hat nicht geklappt. Bitte gleich noch einmal versuchen.', 'error');
          if (err?.code === 'invalid_argument') { fb.canWrite = false; render(); }
        } finally { if (btn) btn.disabled = false; }
      },
    },
    h('div', { class: 'fb-kinds', role: 'radiogroup', 'aria-label': 'Art' }, Object.entries(KINDS).map(([k, label]) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(fb.kind === k), class: `fb-kind fb-kind-${k} ${fb.kind === k ? 'on' : ''}`,
      onclick: () => { fb.kind = k; render(); },
    }, label))),
    ta,
    h('label', { class: 'fb-ctx small', for: 'fb-ctx' }, ctxBox, ` Bezug: ${ctx}`),
    h('button', { class: 'btn btn-primary', type: 'submit' }, 'Teilen'));
  }

  const status = fb.error ? h('p', { class: 'form-error small' }, fb.error)
    : fb.stale ? h('p', { class: 'muted small' }, fb.items.length ? 'Verbindung hakt – die Liste ist eventuell nicht aktuell.' : 'Feedback lässt sich gerade nicht laden.') : null;

  const list = h('ul', { class: 'fb-list' }, items.map((it) => {
    const n = votesFor(it.id);
    const voted = mine.includes(it.id);
    const name = ps[it.authorId]?.name || 'Jemand';
    const canDelete = fb.uid && (it.authorId === fb.uid || fb.isOwner);
    return h('li', { class: 'fb-item' },
      h('button', {
        class: `fb-vote ${voted ? 'on' : ''}`, 'aria-pressed': String(voted), disabled: !fb.uid || !fb.canWrite,
        title: voted ? 'Stimme zurücknehmen' : 'Wichtig für mich', 'aria-label': `${n} Stimmen. ${voted ? 'Stimme zurücknehmen' : 'Dafür stimmen'}`,
        onclick: () => vote(it.id, !voted),
      }, h('span', { class: 'fb-arrow', 'aria-hidden': 'true' }, '▲'), h('span', {}, String(n))),
      h('div', { class: 'fb-body' },
        h('div', { class: 'fb-meta' }, h('span', { class: `fb-chip fb-kind-${it.kind}` }, KINDS[it.kind] || 'Idee'), h('span', { class: 'muted small' }, `${name} · ${new Date(it.createdAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}`)),
        h('p', { class: 'fb-text' }, it.text),
        it.context ? h('p', { class: 'muted small' }, it.context) : null,
        canDelete ? h('button', { class: 'link-btn', onclick: () => remove(it.id) }, 'Löschen') : null));
  }));

  const sortSel = h('select', { id: 'fb-sort', 'aria-label': 'Sortierung', onchange: (e) => { fb.sort = e.target.value; render(); } },
    h('option', { value: 'votes', selected: fb.sort === 'votes' }, 'Meiste Stimmen'), h('option', { value: 'new', selected: fb.sort === 'new' }, 'Neueste zuerst'));

  put(clear(panel), head, form,
    fb.db ? h('div', { class: 'fb-listhead' }, h('strong', {}, `${fb.items.length} ${fb.items.length === 1 ? 'Eintrag' : 'Einträge'}`), sortSel) : null,
    status,
    fb.items.length ? list : (fb.db && !fb.loading ? h('p', { class: 'muted fb-empty' }, 'Noch kein Feedback. Schreib den ersten Eintrag – z. B. eine Funktion, die euch in der Steuergruppe fehlt.') : null));
  const ta = panel.querySelector('#fb-text');
  if (ta && document.activeElement === document.body) ta.focus();
}

let voteBusy = false;
async function vote(fid, add) {
  if (voteBusy || !fb.uid) return;
  voteBusy = true;
  const mine = new Set(fb.votes.get(fb.uid) || []);
  if (add) mine.add(fid); else mine.delete(fid);
  const ids = [...mine].filter((x) => fb.items.some((i) => i.id === x));
  try { await fb.db.doc(`votes/${fb.uid}`).set({ ids }); } catch { toast('Stimme konnte nicht gespeichert werden.', 'error'); }
  voteBusy = false;
}

async function remove(fid) {
  try { await fb.db.doc(`feedback/${fid}`).delete(); } catch { toast('Löschen hat nicht geklappt.', 'error'); }
}

(async () => {
  render();
  const [db, user] = await Promise.all([window.claude?.use?.('db') ?? null, window.claude?.use?.('user') ?? null]);
  fb.loading = false;
  fb.db = db;
  fb.user = user;
  if (!db) { render(); return; }
  if (user) {
    fb.uid = await user.id();
    const can = await user.can?.('data.write');
    fb.canWrite = can !== false;
    fb.isOwner = !!(await user.isOwner?.());
  }
  let timer = setTimeout(() => { fb.stale = true; render(); }, 10000);
  const settled = (snap) => { if (!snap.metadata.fromCache) { clearTimeout(timer); fb.stale = false; } };
  const onErr = (e) => { clearTimeout(timer); fb.error = e?.code === 'revoked' ? 'Kein Zugriff mehr auf das Feedback.' : 'Feedback konnte nicht geladen werden.'; render(); };
  db.collection('feedback').onSnapshot((snap) => {
    settled(snap);
    fb.items = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => typeof x.text === 'string');
    render();
  }, onErr);
  db.collection('votes').onSnapshot((snap) => {
    settled(snap);
    fb.votes = new Map(snap.docs.map((d) => [d.id, Array.isArray(d.data()?.ids) ? d.data().ids : []]));
    render();
  }, onErr);
})();
