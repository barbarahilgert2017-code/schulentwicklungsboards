import { api } from './api.js';
import { h, put, clear, icon, toast, showError, confirmDialog } from './dom.js';
import { state } from './state.js';

let pollTimer = null;

export async function renderAccount(main, { reload }) {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (state.me.isGuest) return renderGuestAccount(main, reload);

  // ---- Profil ----
  const name = h('input', { type: 'text', value: state.me.name, maxlength: 100, required: true });
  const profile = h('form', {
    class: 'panel',
    onsubmit: async (e) => {
      e.preventDefault();
      try { await api.patch('/auth/me', { name: name.value }); toast('Gespeichert.'); await reload(); } catch (err) { showError(err); }
    },
  }, h('h2', {}, 'Profil'),
  h('p', { class: 'muted' }, state.me.email, state.me.isAdmin ? ' · Administration' : ''),
  h('label', { class: 'field' }, h('span', {}, 'Name'), name),
  h('button', { class: 'btn btn-primary', type: 'submit' }, 'Speichern'));

  const cur = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const nw = h('input', { type: 'password', autocomplete: 'new-password', minlength: 10, required: true });
  const pwForm = h('form', {
    class: 'panel',
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        await api.patch('/auth/me', { currentPassword: cur.value, newPassword: nw.value });
        cur.value = ''; nw.value = '';
        toast('Passwort geändert.');
      } catch (err) { showError(err); }
    },
  }, h('h2', {}, 'Passwort ändern'),
  h('label', { class: 'field' }, h('span', {}, 'Aktuelles Passwort'), cur),
  h('label', { class: 'field' }, h('span', {}, 'Neues Passwort (mind. 10 Zeichen)'), nw),
  h('button', { class: 'btn', type: 'submit' }, 'Passwort ändern'));

  const delPw = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const delForm = h('form', {
    class: 'panel',
    onsubmit: async (e) => {
      e.preventDefault();
      if (!(await confirmDialog('Konto endgültig löschen? Boards, in denen du allein bist, werden mitgelöscht. Kommentare bleiben ohne Namen erhalten. Dateien in der Nextcloud bleiben unberührt.', { ok: 'Endgültig löschen', danger: true }))) return;
      try {
        await api.del('/auth/me', { password: delPw.value });
        toast('Konto gelöscht.');
        await reload();
      } catch (err) { showError(err); }
    },
  }, h('h2', {}, 'Konto löschen'),
  h('p', { class: 'muted small' }, 'Vorher ggf. Boards über Menü → „Als JSON exportieren“ sichern.'),
  h('label', { class: 'field' }, h('span', {}, 'Passwort zur Bestätigung'), delPw),
  h('button', { class: 'btn btn-danger', type: 'submit' }, 'Konto löschen'));

  main.append(h('div', { class: 'page-head' }, h('h1', {}, 'Konto')),
    h('div', { class: 'account-grid' }, ncPanel(reload), profile, pwForm, delForm));
}

function renderGuestAccount(main, reload) {
  const name = h('input', { type: 'text', value: state.me.name, maxlength: 60, required: true });
  main.append(h('div', { class: 'page-head' }, h('h1', {}, 'Gastzugang')),
    h('div', { class: 'account-grid' },
      h('form', {
        class: 'panel',
        onsubmit: async (e) => {
          e.preventDefault();
          try { await api.patch('/auth/me', { name: name.value }); toast('Gespeichert.'); await reload(); } catch (err) { showError(err); }
        },
      }, h('h2', {}, 'Dein Name'),
      h('p', { class: 'muted small' }, 'Du bist über einen Einladungslink dabei – ohne Konto und Passwort.'),
      h('label', { class: 'field' }, h('span', {}, 'Name'), name),
      h('button', { class: 'btn btn-primary', type: 'submit' }, 'Speichern')),
      h('section', { class: 'panel' }, h('h2', {}, 'Gastzugang beenden'),
        h('p', { class: 'muted small' }, 'Danach bist du auf diesem Gerät abgemeldet. Deine Karten und Kommentare bleiben im Board, ohne deinen Namen. Über den Einladungslink kannst du später wieder beitreten.'),
        h('button', {
          class: 'btn btn-danger',
          onclick: async () => {
            if (!(await confirmDialog('Gastzugang wirklich beenden?', { ok: 'Beenden', danger: true }))) return;
            try { await api.del('/auth/me'); toast('Gastzugang beendet.'); await reload(); } catch (err) { showError(err); }
          },
        }, 'Gastzugang beenden'))));
}

function ncPanel(reload) {
  const panel = h('section', { class: 'panel panel-nc' }, h('h2', {}, icon('cloud', 20), ' Nextcloud'));
  const nc = state.nextcloud;
  if (nc) {
    panel.append(
      h('p', {}, 'Verbunden mit ', h('a', { href: nc.server, target: '_blank', rel: 'noopener noreferrer' }, nc.server)),
      h('p', { class: 'muted' }, `Nextcloud-Konto: ${nc.displayName || nc.userId} (${nc.loginName})`),
      h('p', { class: 'hint' }, 'Die App nutzt ein eigenes App-Passwort. Du siehst es in Nextcloud unter Einstellungen → Sicherheit → Geräte & Sitzungen und kannst es dort jederzeit widerrufen.'),
      h('button', {
        class: 'btn btn-danger',
        onclick: async () => {
          if (!(await confirmDialog('Nextcloud-Verbindung trennen? Board-Ordner, die über dein Konto verknüpft sind, sind dann für alle Mitglieder nicht mehr erreichbar.', { ok: 'Trennen', danger: true }))) return;
          try {
            const r = await api.del('/nextcloud/connection');
            toast(r.revoked ? 'Getrennt, App-Passwort widerrufen.' : 'Getrennt. Bitte das App-Passwort ggf. in Nextcloud manuell entfernen.');
            await reload();
          } catch (err) { showError(err); }
        },
      }, 'Verbindung trennen'));
    return panel;
  }

  const fixed = state.config.nextcloudFixed;
  const server = h('input', {
    type: 'text', value: state.config.nextcloudDefaultUrl || '', placeholder: 'https://cloud.meine-schule.de',
    readOnly: fixed, required: true, inputmode: 'url', autocomplete: 'url',
  });
  const status = h('div', { class: 'nc-status', 'aria-live': 'polite' });
  const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Mit Nextcloud verbinden');

  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      // Fenster sofort öffnen (sonst blockiert der Browser das Pop-up)
      const win = state.config.demo ? null : window.open('', '_blank');
      btn.disabled = true;
      status.textContent = 'Verbindung wird vorbereitet …';
      try {
        const flow = await api.post('/nextcloud/login/start', { server: server.value });
        if (win) { win.opener = null; win.location.href = flow.loginUrl; }
        put(clear(status),
          state.config.demo
            ? h('p', {}, 'Klick-Dummy: Die Nextcloud-Anmeldung wird simuliert und in wenigen Sekunden „bestätigt“.')
            : [h('p', {}, 'Bitte im neuen Fenster bei der Nextcloud anmelden und „Zugriff gewähren“ klicken.'),
              h('p', {}, 'Kein Fenster geöffnet? ', h('a', { href: flow.loginUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Anmeldeseite öffnen'))],
          h('p', { class: 'muted spinner-line' }, h('span', { class: 'spinner' }), ' Warte auf Bestätigung …'));
        const started = Date.now();
        pollTimer = setInterval(async () => {
          if (Date.now() - started > 20 * 60_000) { clearInterval(pollTimer); status.textContent = 'Zeit abgelaufen. Bitte erneut versuchen.'; btn.disabled = false; return; }
          try {
            const r = await api.post('/nextcloud/login/poll', { flowId: flow.flowId });
            if (r.status === 'connected') {
              clearInterval(pollTimer); pollTimer = null;
              toast(`Nextcloud verbunden (${r.displayName || r.loginName}).`, 'success');
              await reload();
            } else if (r.status === 'expired') {
              clearInterval(pollTimer); status.textContent = 'Anmeldung abgelaufen. Bitte erneut versuchen.'; btn.disabled = false;
            }
          } catch (err) {
            clearInterval(pollTimer); showError(err); btn.disabled = false; status.textContent = '';
          }
        }, 2000);
      } catch (err) {
        if (win) win.close();
        status.textContent = '';
        btn.disabled = false;
        showError(err);
      }
    },
  },
  h('p', {}, 'Verbinde deine Nextcloud, um Dateien an Karten zu hängen und für jedes Board einen gemeinsamen Ordner anzulegen. Die Anmeldung erfolgt direkt bei deiner Nextcloud (Login Flow) – dein Nextcloud-Passwort sieht diese App nie.'),
  h('label', { class: 'field' }, h('span', {}, 'Adresse der Nextcloud'), server),
  btn, status);
  panel.append(form);
  return panel;
}
