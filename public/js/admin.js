import { api } from './api.js';
import { h, put, clear, icon, toast, showError, openModal, confirmDialog, avatar, fmtDateTime } from './dom.js';
import { state } from './state.js';

const yesNo = (v) => (v ? 'an' : 'aus');
const size = (b) => (b == null ? '–' : b < 1024 ** 2 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 ** 2).toFixed(1)} MB`);

export async function renderAdmin(main) {
  const [status, users] = await Promise.all([api.get('/admin/status'), api.get('/admin/users')]);
  const reload = async () => { clear(main); await renderAdmin(main); };

  // ---- Überblick ----
  const row = (label, ...value) => h('div', { class: 'kv' }, h('dt', {}, label), h('dd', {}, ...value));
  const testBtn = h('button', {
    class: 'btn btn-sm', disabled: !status.mail.enabled,
    onclick: async (e) => {
      e.currentTarget.disabled = true;
      try { const r = await api.post('/admin/test-mail'); toast(`Test-E-Mail an ${r.to} verschickt.`, 'success'); } catch (err) { showError(err); }
      e.target.disabled = false;
    },
  }, 'Test-E-Mail an mich');

  const overview = h('section', { class: 'panel' },
    h('h2', {}, 'Überblick'),
    h('dl', { class: 'kv-list' },
      row('Version', status.version),
      row('Adresse', status.baseUrl || location.origin),
      row('Konten', String(status.counts.users), status.counts.nextcloud ? ` · ${status.counts.nextcloud} mit Nextcloud` : ''),
      row('Boards', `${status.counts.boards} mit ${status.counts.cards} Karten`),
      row('Datenbank', size(status.dbBytes))));

  const settings = h('section', { class: 'panel' },
    h('h2', {}, 'Einstellungen'),
    h('dl', { class: 'kv-list' },
      row('E-Mail-Versand', h('span', { class: `badge ${status.mail.enabled ? 'due-done' : 'due-soon'}` }, yesNo(status.mail.enabled)),
        status.mail.from ? ` ${status.mail.from}` : ''),
      row('Registrierung', status.registration.open ? 'offen' : 'nur per Einladung',
        status.registration.domains.length ? ` · nur ${status.registration.domains.map((d) => `@${d}`).join(', ')}` : ''),
      row('Nextcloud', status.nextcloud.defaultUrl || 'keine vorgegeben',
        status.nextcloud.allowedHosts.length ? ` · erlaubt: ${status.nextcloud.allowedHosts.join(', ')}` : ' · alle HTTPS-Server erlaubt'),
      row('Board-Ordner', `/${status.nextcloud.baseFolder}/…`)),
    h('div', { class: 'actions left' }, testBtn),
    h('p', { class: 'hint' }, 'Ändern auf dem Server mit ', h('code', {}, 'sudo seb einstellungen'), ' (öffnet die Konfiguration und startet die App neu).',
      status.mail.enabled ? '' : ' Ohne E-Mail-Versand funktionieren Einladungen und Passwort-Links trotzdem – die Links werden dann zum Weitergeben angezeigt.'));

  // ---- Konten ----
  const table = h('div', { class: 'table-wrap' }, h('table', { class: 'user-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Person'), h('th', {}, 'Boards'), h('th', {}, 'Zuletzt angemeldet'), h('th', {}, 'Nextcloud'), h('th', {}, h('span', { class: 'sr-only' }, 'Aktionen')))),
    h('tbody', {}, users.map((u) => {
      const me = u.id === state.me.id;
      const menuBtn = h('button', { class: 'btn btn-sm', 'aria-label': `Aktionen für ${u.name}` }, 'Aktionen');
      menuBtn.addEventListener('click', () => userActions(u, me, status.mail.enabled, reload));
      return h('tr', {},
        h('td', {}, h('div', { class: 'user-cell' }, avatar(u, 'md'), h('div', {},
          h('strong', {}, u.name, me ? ' (ich)' : ''), u.isAdmin ? h('span', { class: 'badge admin-badge' }, 'Administration') : null,
          h('div', { class: 'muted small' }, u.email)))),
        h('td', { class: 'num' }, String(u.boards)),
        h('td', { class: 'small' }, u.lastLogin ? fmtDateTime(u.lastLogin) : '–'),
        h('td', {}, u.nextcloud ? icon('check') : h('span', { class: 'muted' }, '–')),
        h('td', { class: 'right' }, menuBtn));
    }))));

  put(main,
    h('div', { class: 'page-head' }, h('h1', {}, 'Verwaltung')),
    h('div', { class: 'admin-grid' }, overview, settings),
    h('section', { class: 'panel admin-users' },
      h('h2', {}, `Konten (${users.length})`),
      table,
      h('p', { class: 'hint' }, 'Neue Personen ladet ihr am einfachsten direkt in ein Board ein (Board → Mitglieder). Wer ein Konto hat, kann eigene Boards anlegen.')));
}

function userActions(u, me, mailEnabled, reload) {
  const m = openModal({
    title: u.name,
    content: [
      h('p', { class: 'muted' }, u.email),
      h('div', { class: 'action-list' },
        h('button', { class: 'btn btn-block', onclick: () => { m.close(); resetLink(u, mailEnabled); } }, icon('link'), ' Link für neues Passwort'),
        me ? null : h('button', {
          class: 'btn btn-block',
          onclick: async () => {
            try { await api.patch(`/admin/users/${u.id}`, { isAdmin: !u.isAdmin }); m.close(); toast(u.isAdmin ? 'Administrationsrechte entzogen.' : 'Administrationsrechte vergeben.', 'success'); reload(); } catch (err) { showError(err); }
          },
        }, icon('settings'), u.isAdmin ? ' Administrationsrechte entziehen' : ' Zur Administration machen'),
        me ? null : h('button', {
          class: 'btn btn-block btn-danger',
          onclick: async () => {
            if (!(await confirmDialog(`Konto von ${u.name} endgültig löschen? Boards, in denen die Person allein ist, werden mitgelöscht. Kommentare bleiben ohne Namen erhalten.`, { ok: 'Endgültig löschen', danger: true }))) return;
            try { await api.del(`/admin/users/${u.id}`); m.close(); toast('Konto gelöscht.'); reload(); } catch (err) { showError(err); }
          },
        }, icon('trash'), ' Konto löschen')),
    ],
  });
}

async function resetLink(u, mailEnabled) {
  const m = openModal({ title: `Neues Passwort für ${u.name}` });
  const create = async (send) => {
    try {
      const r = await api.post(`/admin/users/${u.id}/reset-link`, { send });
      const input = h('input', { type: 'text', value: r.link, readOnly: true, 'aria-label': 'Link' });
      put(clear(m.body),
        h('p', {}, r.mailed ? `Der Link wurde an ${u.email} geschickt. Du kannst ihn zusätzlich selbst weitergeben:` : 'Gib diesen Link persönlich weiter (z. B. per Schul-Mail oder Messenger):'),
        h('div', { class: 'inline-form' }, input, h('button', {
          class: 'btn btn-primary',
          onclick: async () => {
            try { await navigator.clipboard.writeText(r.link); } catch { input.select(); document.execCommand('copy'); }
            toast('Link kopiert.', 'success');
          },
        }, 'Kopieren')),
        h('p', { class: 'hint' }, 'Gültig 24 Stunden, nur einmal nutzbar. Ein älterer Link verliert damit seine Gültigkeit.'));
    } catch (err) { showError(err); }
  };
  put(m.body,
    h('p', {}, `Damit kann ${u.name} ein neues Passwort festlegen. Das alte Passwort gilt bis dahin weiter.`),
    h('div', { class: 'actions' },
      mailEnabled ? h('button', { class: 'btn btn-primary', onclick: () => create(true) }, 'Per E-Mail schicken') : null,
      h('button', { class: `btn ${mailEnabled ? '' : 'btn-primary'}`, onclick: () => create(false) }, 'Nur Link anzeigen')));
}
