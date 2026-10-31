import { api } from './api.js';
import { h, put, clear, icon, toast, showError, openModal, confirmDialog, avatar, LABEL_COLORS } from './dom.js';
import { state, ROLE_LABELS } from './state.js';
import { openFilePicker } from './filepicker.js';

const TABS = [
  ['general', 'Allgemein'],
  ['members', 'Mitglieder'],
  ['labels', 'Labels'],
  ['folder', 'Nextcloud-Ordner'],
];

const BOARD_COLORS = ['#2f6f9f', '#7b4fa0', '#16a085', '#2e8b57', '#d68910', '#c0392b', '#8e44ad', '#5d6d7e', '#1abc9c', '#34495e'];

export function openBoardSettings(data, tab = 'general', onChange) {
  let current = tab;
  let d = data;
  const tabsEl = h('div', { class: 'tabs', role: 'tablist' });
  const panel = h('div', { class: 'settings-panel', role: 'tabpanel' });
  const m = openModal({ title: `Einstellungen – ${d.board.title}`, wide: true, content: [tabsEl, panel] });

  const reload = async () => {
    await onChange?.();
    d = await api.get(`/boards/${d.board.id}`);
    draw();
  };
  const run = (fn) => async (...args) => { try { await fn(...args); await reload(); } catch (err) { showError(err); } };

  const owner = () => d.board.role === 'owner';
  const editor = () => d.board.role !== 'viewer';

  function draw() {
    clear(tabsEl).append(...TABS.map(([k, label]) => h('button', {
      role: 'tab', 'aria-selected': String(k === current), class: k === current ? 'active' : '',
      onclick: () => { current = k; draw(); },
    }, label)));
    clear(panel).append(({ general, members, labels, folder })[current]());
  }

  // ---- Allgemein ----
  function general() {
    const title = h('input', { type: 'text', value: d.board.title, maxlength: 120, required: true, disabled: !editor() });
    const desc = h('textarea', { rows: 3, maxlength: 2000, disabled: !editor() });
    desc.value = d.board.description;
    let color = d.board.color;
    const swatches = h('div', { class: 'swatches' });
    const drawSw = () => clear(swatches).append(...BOARD_COLORS.map((c) => h('button', {
      type: 'button', class: `swatch-btn ${c === color ? 'on' : ''}`, style: { background: c }, 'aria-label': `Farbe ${c}`, disabled: !editor(),
      onclick: () => { color = c; drawSw(); },
    })));
    drawSw();
    return h('form', {
      onsubmit: run(async (e) => {
        e.preventDefault();
        await api.patch(`/boards/${d.board.id}`, { title: title.value, description: desc.value, color });
        toast('Gespeichert.');
      }),
    },
    h('label', { class: 'field' }, h('span', {}, 'Titel'), title),
    h('label', { class: 'field' }, h('span', {}, 'Beschreibung'), desc),
    h('div', { class: 'field' }, h('span', {}, 'Farbe'), swatches),
    editor() ? h('div', { class: 'actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Speichern')) : null);
  }

  // ---- Mitglieder ----
  function members() {
    const email = h('input', { type: 'email', placeholder: 'kollegin@schule.de', required: true, 'aria-label': 'E-Mail' });
    const role = h('select', { 'aria-label': 'Rolle' }, ['editor', 'viewer', 'owner'].map((r) => h('option', { value: r }, ROLE_LABELS[r])));
    return h('div', {},
      h('ul', { class: 'member-list' }, d.members.map((mem) => h('li', {},
        avatar(mem, 'md'),
        h('div', { class: 'member-info' },
          h('strong', {}, mem.name, mem.id === state.me.id ? ' (ich)' : ''),
          h('span', { class: 'muted small' }, mem.email, mem.nextcloud ? ' · Nextcloud verbunden' : '')),
        owner()
          ? h('select', { 'aria-label': `Rolle von ${mem.name}`, onchange: run((e) => api.patch(`/boards/${d.board.id}/members/${mem.id}`, { role: e.target.value })) },
            ['owner', 'editor', 'viewer'].map((r) => h('option', { value: r, selected: r === mem.role }, ROLE_LABELS[r])))
          : h('span', { class: 'badge' }, ROLE_LABELS[mem.role]),
        owner() && mem.id !== state.me.id ? h('button', {
          class: 'icon-btn', 'aria-label': `${mem.name} entfernen`,
          onclick: async () => { if (await confirmDialog(`${mem.name} aus dem Board entfernen?`, { ok: 'Entfernen', danger: true })) run(() => api.del(`/boards/${d.board.id}/members/${mem.id}`))(); },
        }, icon('x')) : null))),
      owner() ? h('form', {
        class: 'inline-form',
        onsubmit: run(async (e) => {
          e.preventDefault();
          const r = await api.post(`/boards/${d.board.id}/members`, { email: email.value, role: role.value });
          if (r.status === 'invited') showInviteLink(r, email.value);
          else toast(`${r.name} wurde hinzugefügt${r.mailed ? ' und per E-Mail benachrichtigt' : ''}.`, 'success');
        }),
      }, email, role, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Hinzufügen / Einladen')) : null,
      owner() ? pendingInvites() : null,
      h('p', { class: 'hint' },
        'Rollen: ', h('strong', {}, 'Verantwortlich'), ' – alles inkl. Mitglieder und Nextcloud-Ordner; ',
        h('strong', {}, 'Bearbeiten'), ' – Karten, Listen, Checklisten, Dateien; ',
        h('strong', {}, 'Lesen'), ' – ansehen und kommentieren (z. B. für Schulleitung oder Kollegium).'),
      owner() ? h('p', { class: 'hint' }, state.config.mailEnabled
        ? 'Personen ohne Konto erhalten eine Einladung per E-Mail. Personen mit Konto werden direkt hinzugefügt und benachrichtigt.'
        : 'Personen ohne Konto erhalten einen Einladungslink, den du weitergeben kannst (E-Mail-Versand ist auf diesem Server nicht eingerichtet).') : null);
  }

  function pendingInvites() {
    const box = h('div', { class: 'pending-invites' });
    api.get(`/boards/${d.board.id}/invitations`).then((list) => {
      if (!list.length) return;
      put(box, h('h3', {}, 'Offene Einladungen'), h('ul', { class: 'member-list' }, list.map((inv) => h('li', {},
        h('span', { class: 'avatar avatar-md more' }, '@'),
        h('div', { class: 'member-info' },
          h('strong', {}, inv.email),
          h('span', { class: `small ${inv.expired ? 'form-error' : 'muted'}` },
            `${ROLE_LABELS[inv.role]} · eingeladen von ${inv.invitedBy || '–'} · `,
            inv.expired ? 'abgelaufen' : `gültig bis ${new Date(inv.expiresAt).toLocaleDateString('de-DE')}`)),
        h('button', {
          class: 'btn btn-sm', title: 'Neuen Link erzeugen und erneut senden',
          onclick: run(async () => { showInviteLink(await api.post(`/invitations/${inv.id}/resend`), inv.email); }),
        }, state.config.mailEnabled ? 'Erneut senden' : 'Neuer Link'),
        h('button', {
          class: 'icon-btn', 'aria-label': `Einladung an ${inv.email} zurückziehen`, title: 'Zurückziehen',
          onclick: async () => { if (await confirmDialog(`Einladung an ${inv.email} zurückziehen?`, { ok: 'Zurückziehen', danger: true })) run(() => api.del(`/invitations/${inv.id}`))(); },
        }, icon('x'))))));
    }).catch(() => {});
    return box;
  }

  function showInviteLink(r, mail) {
    const input = h('input', { type: 'text', value: r.link, readOnly: true, 'aria-label': 'Einladungslink' });
    openModal({
      title: 'Einladung erstellt',
      content: [
        h('p', {}, r.mailed
          ? `Eine Einladung wurde per E-Mail an ${mail} geschickt.`
          : `Für ${mail} gibt es noch kein Konto. ${state.config.mailEnabled ? 'Die E-Mail konnte nicht verschickt werden – ' : ''}Bitte diesen Link persönlich weitergeben (z. B. per Schul-Mail oder Messenger):`),
        h('div', { class: 'inline-form' }, input, h('button', {
          class: 'btn btn-primary',
          onclick: async () => {
            try { await navigator.clipboard.writeText(r.link); } catch { input.select(); document.execCommand('copy'); }
            toast('Link kopiert.', 'success');
          },
        }, 'Link kopieren')),
        h('p', { class: 'hint' }, 'Der Link ist nur für diese Person gedacht und läuft automatisch ab. Mit dem Link kann sie sich auch registrieren, wenn die Registrierung sonst geschlossen ist.'),
      ],
    });
  }

  // ---- Labels ----
  function labels() {
    const name = h('input', { type: 'text', placeholder: 'Neues Label, z. B. „Fachschaft Deutsch“', maxlength: 40, required: true, 'aria-label': 'Labelname' });
    let color = LABEL_COLORS[7];
    const colorSel = colorPicker(color, (c) => { color = c; });
    return h('div', {},
      h('ul', { class: 'label-list' }, d.labels.map((l) => {
        const input = h('input', { type: 'text', value: l.name, maxlength: 40, disabled: !editor(), 'aria-label': 'Labelname' });
        input.addEventListener('change', run(() => api.patch(`/labels/${l.id}`, { name: input.value })));
        return h('li', {},
          colorPicker(l.color, run((c) => api.patch(`/labels/${l.id}`, { color: c })), !editor()),
          input,
          editor() ? h('button', {
            class: 'icon-btn', 'aria-label': `Label ${l.name} löschen`,
            onclick: async () => { if (await confirmDialog(`Label „${l.name}“ löschen? Es wird von allen Karten entfernt.`, { ok: 'Löschen', danger: true })) run(() => api.del(`/labels/${l.id}`))(); },
          }, icon('trash')) : null);
      })),
      editor() ? h('form', {
        class: 'inline-form',
        onsubmit: run(async (e) => { e.preventDefault(); await api.post(`/boards/${d.board.id}/labels`, { name: name.value, color }); }),
      }, colorSel, name, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Hinzufügen')) : null);
  }

  function colorPicker(value, onPick, disabled = false) {
    const btn = h('button', { type: 'button', class: 'swatch-btn', style: { background: value }, 'aria-label': 'Farbe wählen', disabled });
    btn.addEventListener('click', () => {
      const pop = h('div', { class: 'swatches popup' }, LABEL_COLORS.map((c) => h('button', {
        type: 'button', class: 'swatch-btn', style: { background: c }, 'aria-label': c,
        onclick: () => { btn.style.background = c; pop.remove(); onPick(c); },
      })));
      btn.after(pop);
      setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', off); } }));
    });
    return btn;
  }

  // ---- Nextcloud-Ordner ----
  function folder() {
    const f = d.board.folder;
    const box = h('div', { class: 'folder-settings' });
    if (f) {
      const ownerMember = d.members.find((x) => x.id === f.ownerId);
      put(box,
        h('div', { class: 'folder-card' }, icon('folder', 28),
          h('div', {}, h('strong', {}, f.path), h('div', { class: 'muted small' }, `verknüpft über das Nextcloud-Konto von ${f.ownerName || 'unbekannt'}`))),
        h('div', { class: 'actions left' },
          h('button', { class: 'btn', onclick: () => openFilePicker({ boardId: d.board.id, boardFolder: true, mode: 'browse' }) }, icon('folder'), ' Ordner durchsuchen'),
          owner() ? h('button', {
            class: 'btn', title: 'Gibt den Ordner in Nextcloud für alle Mitglieder frei, die dieselbe Nextcloud verbunden haben',
            onclick: run(async () => {
              const { results } = await api.post(`/boards/${d.board.id}/folder/share`);
              const txt = { shared: 'freigegeben', already: 'bereits freigegeben', skipped: 'übersprungen', error: 'Fehler' };
              openModal({
                title: 'Freigabe in Nextcloud',
                content: results.length ? h('ul', { class: 'plain-list' }, results.map((r) => h('li', {}, h('strong', {}, r.name), ` – ${txt[r.status]}${r.message ? ` (${r.message})` : ''}`)))
                  : h('p', {}, 'Keine weiteren Mitglieder vorhanden.'),
              });
            }),
          }, icon('share'), ' Mit Mitgliedern teilen') : null,
          owner() ? h('button', {
            class: 'btn btn-danger',
            onclick: async () => { if (await confirmDialog('Verknüpfung lösen? Die Dateien in der Nextcloud bleiben erhalten.', { ok: 'Lösen', danger: true })) run(() => api.del(`/boards/${d.board.id}/folder`))(); },
          }, 'Verknüpfung lösen') : null),
        h('p', { class: 'hint' },
          'Uploads aus Karten landen in diesem Ordner. Alle Board-Mitglieder mit Bearbeitungsrecht können über die App Dateien hineinladen und den Ordner durchsuchen – auch ohne eigene Nextcloud-Verbindung. ',
          'Damit Mitglieder den Ordner auch direkt in ihrer Nextcloud sehen, „Mit Mitgliedern teilen“ verwenden.'),
        ownerMember ? null : h('p', { class: 'form-error' }, 'Die Person, über die der Ordner verknüpft ist, ist kein Board-Mitglied mehr. Bitte den Ordner neu verknüpfen.'));
    } else {
      box.append(h('p', {}, 'Für dieses Board ist noch kein Nextcloud-Ordner verknüpft. Ein Board-Ordner bündelt Protokolle, Konzepte und Materialien des Vorhabens an einem Ort.'));
    }
    if (owner()) {
      if (!state.nextcloud) {
        box.append(h('p', { class: 'hint' }, 'Um einen Ordner zu verknüpfen, zuerst ', h('a', { href: '#/account', onclick: () => m.close() }, 'die eigene Nextcloud verbinden'), '.'));
      } else {
        box.append(h('div', { class: 'actions left' },
          h('button', {
            class: 'btn btn-primary',
            onclick: run(async () => {
              const r = await api.put(`/boards/${d.board.id}/folder`, { create: true });
              toast(`Ordner ${r.path} angelegt.`, 'success');
            }),
          }, icon('plus'), f ? ' Neuen Ordner anlegen' : ` Ordner anlegen (${state.config.nextcloudBaseFolder}/${d.board.title})`),
          h('button', {
            class: 'btn',
            onclick: () => openFilePicker({
              mode: 'folder', title: 'Vorhandenen Ordner verknüpfen',
              onPick: async (entry) => { await api.put(`/boards/${d.board.id}/folder`, { path: entry.path }); toast('Ordner verknüpft.', 'success'); await reload(); },
            }),
          }, icon('folder'), ' Vorhandenen Ordner wählen')));
      }
    } else if (!f) {
      box.append(h('p', { class: 'muted' }, 'Nur Verantwortliche des Boards können einen Ordner verknüpfen.'));
    }
    return box;
  }

  draw();
  return m;
}
