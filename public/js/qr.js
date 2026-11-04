/**
 * QR-Codes für Einladungslinks – vollständig im Browser erzeugt (keine externen Dienste).
 */
import qrcode from './vendor/qrcode.js';
import { h, icon, openModal, toast } from './dom.js';

const SVG = 'http://www.w3.org/2000/svg';

function matrix(text) {
  const qr = qrcode(0, 'M'); // Version automatisch, Fehlerkorrektur M (~15 %)
  qr.addData(text);
  qr.make();
  return qr;
}

/** QR-Code als SVG-Element (immer schwarz auf weiß, damit jede Kamera ihn liest). */
export function qrSvg(text, { margin = 4, label = 'QR-Code' } = {}) {
  const qr = matrix(text);
  const n = qr.getModuleCount();
  const total = n + margin * 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
  }
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${total} ${total}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.setAttribute('class', 'qr-svg');
  const bg = document.createElementNS(SVG, 'rect');
  bg.setAttribute('width', total); bg.setAttribute('height', total); bg.setAttribute('fill', '#ffffff');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', d); path.setAttribute('fill', '#000000');
  svg.append(bg, path);
  return svg;
}

/** QR-Code als PNG (Data-URL) in ganzzahliger Skalierung → scharfe Module. */
export function qrPng(text, { minPx = 1024, margin = 4 } = {}) {
  const qr = matrix(text);
  const n = qr.getModuleCount();
  const total = n + margin * 2;
  const scale = Math.max(4, Math.ceil(minPx / total));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = total * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
  }
  return canvas.toDataURL('image/png');
}

/** Großer, beamer-tauglicher QR-Dialog für einen Einladungslink. */
export function openQrModal({ link, boardTitle, role }) {
  const fileName = `Einladung-${boardTitle.replace(/[^\wäöüÄÖÜß-]+/g, '-').replace(/-+/g, '-')}.png`;
  const content = h('div', { class: 'qr-view' },
    h('div', { class: 'qr-box' }, qrSvg(link, { label: `QR-Code für die Einladung zum Board ${boardTitle}` })),
    h('div', { class: 'qr-text' },
      h('p', { class: 'qr-board' }, boardTitle),
      h('ol', { class: 'qr-steps' },
        h('li', {}, 'Mit der Handykamera scannen'),
        h('li', {}, 'Namen eingeben'),
        h('li', {}, role === 'viewer' ? 'Mitlesen und kommentieren' : 'Mitarbeiten')),
      h('p', { class: 'qr-link' }, link)));
  const m = openModal({ title: 'QR-Code zum Einladungslink', wide: true, className: 'qr-modal', content: [content] });
  content.addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); });
  const full = h('button', {
    class: 'btn btn-primary',
    onclick: async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await m.dialog.requestFullscreen();
      } catch { toast('Vollbild ist auf diesem Gerät nicht möglich – der QR-Code lässt sich trotzdem scannen.', 'error'); }
    },
  }, icon('external'), ' Vollbild');
  const save = h('a', { class: 'btn', href: qrPng(link), download: fileName }, icon('download'), ' Als Bild speichern');
  const copy = h('button', {
    class: 'btn',
    onclick: async () => {
      try { await navigator.clipboard.writeText(link); toast('Link kopiert.', 'success'); } catch { toast('Kopieren nicht möglich – Link bitte markieren.', 'error'); }
    },
  }, icon('link'), ' Link kopieren');
  m.body.append(h('div', { class: 'actions qr-actions' }, copy, save, document.fullscreenEnabled ? full : null));
  return m;
}
