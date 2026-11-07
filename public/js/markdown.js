/**
 * Kleiner, sicherer Markdown-Renderer (ohne innerHTML, ohne externe Bibliothek).
 *
 * Unterstützt:
 *   Inline:  **fett**, __fett__, *kursiv*, _kursiv_, ~~durchgestrichen~~, `Code`,
 *            [Text](https://…), automatische Links, \* (Zeichen maskieren)
 *   Blöcke:  # / ## / ### Überschriften, - Listen, 1. Listen (auch verschachtelt),
 *            - [ ] / - [x] Aufgaben, > Zitate, ``` Codeblöcke, --- Trennlinie,
 *            Absätze mit Zeilenumbrüchen
 * Nur http(s)- und mailto-Links; alles andere bleibt Text.
 */
import { h, icon } from './dom.js';

// ---------------- Inline ----------------

const SAFE_URL = /^(https?:\/\/|mailto:)/i;
/** Links in die eigene App (z. B. auf eine Karte) im selben Tab öffnen, andere in einem neuen. */
const linkAttrs = (href) => {
  try { if (new URL(href, location.href).origin === location.origin) return { href }; } catch { /* ignorieren */ }
  return { href, target: '_blank', rel: 'noopener noreferrer' };
};
const INLINE = [
  { type: 'code', re: /`([^`\n]+)`/ },
  { type: 'escape', re: /\\([\\`*_{}[\]()#+\-.!~>|])/ },
  { type: 'link', re: /\[([^\]\n]+)\]\(\s*([^\s)]+)\s*\)/ },
  { type: 'url', re: /\bhttps?:\/\/[^\s<>"]+/ },
  { type: 'bold', re: /\*\*(?=\S)([\s\S]*?\S)\*\*/ },
  { type: 'bold', pre: true, re: /(^|[^\w])__(?=\S)([\s\S]*?\S)__(?![\w])/ },
  { type: 'strike', re: /~~(?=\S)([\s\S]*?\S)~~/ },
  { type: 'em', re: /\*(?=[^\s*])([^*\n]*?[^\s*])\*/ },
  { type: 'em', re: /\*(?=[^\s*])([^\s*])\*/ },
  { type: 'em', pre: true, re: /(^|[^\w])_(?=[^\s_])([^_\n]*?[^\s_]|[^\s_])_(?![\w])/ },
];

/**
 * Inline-Markdown → Array aus Knoten/Strings (für h()).
 * opts.links = false: Links nur als Text (z. B. innerhalb einer Karte, die selbst ein Link ist).
 */
export function renderInline(text, opts = {}, depth = 0) {
  const links = opts.links !== false;
  const out = [];
  let rest = String(text ?? '');
  while (rest) {
    let best = null;
    for (const p of INLINE) {
      const m = p.re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { p, m };
    }
    if (!best) { out.push(rest); break; }
    const { p } = best;
    let { m } = best;
    if (p.pre) {
      // Vorangestelltes Zeichen (Wortgrenze) als Text behalten, dann wie ohne Präfix weiter
      const prefix = m[1];
      const shifted = [m[0].slice(prefix.length), m[2]];
      shifted.index = m.index + prefix.length;
      m = shifted;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    let consumed = m[0].length;
    const inner = (s) => (depth > 8 ? [s] : renderInline(s, opts, depth + 1));
    switch (p.type) {
      case 'code': out.push(h('code', { class: 'md-code' }, m[1])); break;
      case 'escape': out.push(m[1]); break;
      case 'link':
        if (!links) out.push(...inner(m[1]));
        else if (SAFE_URL.test(m[2])) out.push(h('a', linkAttrs(m[2]), inner(m[1])));
        else out.push(m[0]);
        break;
      case 'url': {
        const url = m[0].replace(/[.,;:!?)\]]+$/, '');
        consumed = url.length;
        if (!links) { out.push(url); break; }
        out.push(h('a', linkAttrs(url), url));
        break;
      }
      case 'bold': out.push(h('strong', {}, inner(m[1]))); break;
      case 'strike': out.push(h('del', {}, inner(m[1]))); break;
      case 'em': out.push(h('em', {}, inner(m[1]))); break;
      default: out.push(m[0]);
    }
    rest = rest.slice(m.index + consumed);
  }
  return out;
}

/** Markdown-Zeichen entfernen (für reine Textstellen wie Seitentitel). */
export function stripInline(text) {
  const el = h('span', {}, renderInline(text));
  return el.textContent;
}

// ---------------- Blöcke ----------------

const RE = {
  fence: /^\s*```/,
  heading: /^\s{0,3}(#{1,3})\s+(.*?)\s*#*\s*$/,
  hr: /^\s{0,3}([-*_])(\s*\1){2,}\s*$/,
  quote: /^\s{0,3}>\s?/,
  item: /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/,
  task: /^\[([ xX])\]\s+(.*)$/,
  blank: /^\s*$/,
};
const indentOf = (s) => s.replace(/\t/g, '    ').match(/^ */)[0].length;
const startsBlock = (line) => RE.fence.test(line) || RE.heading.test(line) || RE.hr.test(line) || RE.quote.test(line) || RE.item.test(line);

/** Markdown → Array aus Block-Elementen. */
export function renderMarkdown(text, depth = 0) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (RE.blank.test(line)) { i++; continue; }

    if (RE.fence.test(line)) {
      const code = [];
      i++;
      while (i < lines.length && !RE.fence.test(lines[i])) code.push(lines[i++]);
      i++; // schließendes ```
      blocks.push(h('pre', { class: 'md-pre' }, h('code', {}, code.join('\n'))));
      continue;
    }
    let m = RE.heading.exec(line);
    if (m) {
      blocks.push(h(`h${Math.min(6, m[1].length + 3)}`, { class: `md-h md-h${m[1].length}` }, renderInline(m[2])));
      i++;
      continue;
    }
    if (RE.hr.test(line)) {
      blocks.push(h('hr', { class: 'md-hr' }));
      i++;
      continue;
    }
    if (RE.quote.test(line)) {
      const inner = [];
      while (i < lines.length && RE.quote.test(lines[i])) inner.push(lines[i++].replace(RE.quote, ''));
      blocks.push(h('blockquote', { class: 'md-quote' }, depth > 5 ? inner.join('\n') : renderMarkdown(inner.join('\n'), depth + 1)));
      continue;
    }
    if (RE.item.test(line)) {
      const [list, next] = parseList(lines, i, indentOf(line), depth);
      blocks.push(list);
      i = next;
      continue;
    }
    // Absatz: bis Leerzeile oder Blockbeginn; Zeilenumbrüche bleiben erhalten
    const para = [];
    while (i < lines.length && !RE.blank.test(lines[i]) && (para.length === 0 || !startsBlock(lines[i]))) para.push(lines[i++]);
    const parts = [];
    para.forEach((l, n) => { if (n) parts.push(h('br')); parts.push(...renderInline(l.trim())); });
    blocks.push(h('p', { class: 'md-p' }, parts));
  }
  return blocks;
}

function parseList(lines, start, baseIndent, depth) {
  const first = RE.item.exec(lines[start]);
  const ordered = /\d/.test(first[2]);
  const list = h(ordered ? 'ol' : 'ul', { class: 'md-list' });
  if (ordered && parseInt(first[2], 10) !== 1) list.setAttribute('start', String(parseInt(first[2], 10)));
  let i = start;
  while (i < lines.length) {
    const m = RE.item.exec(lines[i]);
    if (!m) {
      // Fortsetzungszeile (eingerückt) gehört zum letzten Punkt
      if (!RE.blank.test(lines[i]) && indentOf(lines[i]) > baseIndent && list.lastChild) {
        list.lastChild.append(h('br'), ...renderInline(lines[i].trim()));
        i++;
        continue;
      }
      // Leerzeile zwischen Punkten erlauben
      if (RE.blank.test(lines[i]) && i + 1 < lines.length && RE.item.test(lines[i + 1]) && indentOf(lines[i + 1]) >= baseIndent) { i++; continue; }
      break;
    }
    const ind = indentOf(m[1]);
    if (ind < baseIndent) break;
    if (ind > baseIndent) {
      if (depth > 6 || !list.lastChild) break;
      const [sub, next] = parseList(lines, i, ind, depth + 1);
      list.lastChild.append(sub);
      i = next;
      continue;
    }
    if (/\d/.test(m[2]) !== ordered) break; // anderer Listentyp → neue Liste
    const task = RE.task.exec(m[3]);
    const li = task
      ? h('li', { class: 'md-task' }, h('input', { type: 'checkbox', checked: task[1] !== ' ', disabled: true, 'aria-label': task[1] !== ' ' ? 'erledigt' : 'offen' }), ' ', renderInline(task[2]))
      : h('li', {}, renderInline(m[3]));
    list.append(li);
    i++;
  }
  return [list, i];
}

// ---------------- Formatierungsleiste für Textfelder ----------------

/** Werkzeugleiste über einem Textfeld: Auswahl fett/kursiv/… machen, Listen einfügen. */
export function markdownToolbar(ta) {
  const wrap = (before, after = before, placeholder = 'Text') => () => {
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const sel = value.slice(s, e) || placeholder;
    ta.setRangeText(`${before}${sel}${after}`, s, e, 'end');
    if (s === e) ta.setSelectionRange(s + before.length, s + before.length + sel.length);
    ta.focus();
    ta.dispatchEvent(new Event('input'));
  };
  const prefix = (fn) => () => {
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    const lineEnd = value.indexOf('\n', e) === -1 ? value.length : value.indexOf('\n', e);
    const lines = value.slice(lineStart, lineEnd).split('\n');
    const next = lines.map((l, n) => fn(l, n)).join('\n');
    ta.setRangeText(next, lineStart, lineEnd, 'end'); // Cursor ans Zeilenende → einfach weiterschreiben, Enter setzt die Liste fort
    ta.focus();
    ta.dispatchEvent(new Event('input'));
  };
  const link = () => {
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const sel = value.slice(s, e) || 'Linktext';
    const insert = `[${sel}](https://)`;
    ta.setRangeText(insert, s, e, 'end');
    const urlPos = s + insert.length - 1;
    ta.setSelectionRange(urlPos, urlPos);
    ta.focus();
    ta.dispatchEvent(new Event('input'));
  };
  const btn = (label, title, onclick, cls = '') => h('button', {
    type: 'button', class: `md-btn ${cls}`, title, 'aria-label': title,
    onmousedown: (e) => e.preventDefault(), // Fokus/Auswahl im Textfeld behalten
    onclick,
  }, label);
  const help = h('div', { class: 'md-help', hidden: true },
    h('table', {}, h('tbody', {},
      [['**fett**', 'fett'], ['*kursiv*', 'kursiv'], ['~~durchgestrichen~~', 'durchgestrichen'], ['`Code`', 'Code'],
        ['# Überschrift', 'Überschrift (auch ## und ###)'], ['- Punkt', 'Aufzählung (2 Leerzeichen davor = eingerückt)'],
        ['1. Punkt', 'nummerierte Liste'], ['- [ ] Aufgabe', 'Kästchen (- [x] = abgehakt)'], ['> Text', 'Zitat'],
        ['[Text](https://…)', 'Link'], ['---', 'Trennlinie']]
        .map(([code, desc]) => h('tr', {}, h('td', {}, h('code', {}, code)), h('td', {}, desc))))));
  const helpBtn = btn('?', 'Formatierungshilfe', () => { help.hidden = !help.hidden; helpBtn.setAttribute('aria-expanded', String(!help.hidden)); }, 'md-help-btn');
  helpBtn.setAttribute('aria-expanded', 'false');
  return h('div', { class: 'md-toolbar-wrap' },
    h('div', { class: 'md-toolbar', role: 'toolbar', 'aria-label': 'Formatierung' },
      btn(h('strong', {}, 'B'), 'Fett (Strg+B)', wrap('**')),
      btn(h('em', {}, 'I'), 'Kursiv (Strg+I)', wrap('*')),
      btn(h('del', {}, 'S'), 'Durchgestrichen', wrap('~~')),
      btn('H', 'Überschrift', prefix((l) => (l.startsWith('### ') ? l.slice(4) : `### ${l.replace(/^#+\s*/, '')}`))),
      btn('•', 'Aufzählung', prefix((l) => (/^\s*[-*]\s/.test(l) ? l.replace(/^(\s*)[-*]\s/, '$1') : `- ${l}`))),
      btn('1.', 'Nummerierte Liste', prefix((l, n) => (/^\s*\d+\.\s/.test(l) ? l.replace(/^(\s*)\d+\.\s/, '$1') : `${n + 1}. ${l}`))),
      btn('☐', 'Kästchen', prefix((l) => (/^\s*- \[[ xX]\]\s/.test(l) ? l.replace(/^(\s*)- \[[ xX]\]\s/, '$1') : `- [ ] ${l}`))),
      btn(icon('link', 15), 'Link', link),
      btn('</>', 'Code', wrap('`')),
      helpBtn),
    help);
}

/** Tastenkürzel Strg/Cmd+B und Strg/Cmd+I für ein Textfeld. */
const LIST_ITEM = /^(\s*)([-*+]|(\d{1,3})([.)]))(\s+)(\[[ xX]\]\s+)?/;

/**
 * Aufzählungen bleiben aktiv: Enter setzt den nächsten Punkt fort (- / 2. / - [ ]),
 * Enter in einem leeren Punkt beendet die Liste, Tab / Umschalt+Tab rücken ein bzw. aus.
 * Umschalt+Enter macht einen normalen Zeilenumbruch.
 */
function listKeys(ta, e) {
  if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return false;
  const { selectionStart: s, selectionEnd: en, value } = ta;
  const lineStart = value.lastIndexOf('\n', s - 1) + 1;
  const nl = value.indexOf('\n', s);
  const lineEnd = nl === -1 ? value.length : nl;
  const line = value.slice(lineStart, lineEnd);
  const m = LIST_ITEM.exec(line);
  if (!m) return false;

  if (e.key === 'Enter' && e.shiftKey && s === en) {
    // Zeilenumbruch innerhalb desselben Punkts: so weit einrücken wie der Text des Punkts
    ta.setRangeText(`\n${' '.repeat(m[0].length)}`, s, s, 'end');
    return true;
  }
  if (e.key === 'Enter' && !e.shiftKey && s === en) {
    const prefixLen = m[0].length;
    if (s < lineStart + prefixLen) return false; // Cursor steht im Aufzählungszeichen
    const content = line.slice(prefixLen).trim();
    if (!content) {
      // Leerer Punkt: eingerückt → eine Ebene ausrücken, sonst Liste beenden
      if (m[1].length >= 2) ta.setRangeText(line.slice(2), lineStart, lineEnd, 'end');
      else ta.setRangeText('', lineStart, lineEnd, 'end');
      return true;
    }
    const marker = m[3] ? `${Number(m[3]) + 1}${m[4]}` : m[2];
    const task = m[6] ? '[ ] ' : '';
    ta.setRangeText(`\n${m[1]}${marker}${m[5]}${task}`, s, s, 'end');
    return true;
  }
  if (e.key === 'Tab') {
    const pos = s - lineStart;
    if (e.shiftKey) {
      const remove = Math.min(2, m[1].length);
      if (!remove) return true; // schon ganz links – Fokus trotzdem im Feld lassen
      ta.setRangeText(line.slice(remove), lineStart, lineEnd, 'preserve');
      ta.setSelectionRange(lineStart + Math.max(0, pos - remove), lineStart + Math.max(0, pos - remove));
    } else {
      // Unterpunkte nummerierter Listen beginnen wieder bei 1.
      const renumbered = m[3] ? line.replace(/^(\s*)\d{1,3}/, '$11') : line;
      ta.setRangeText(`  ${renumbered}`, lineStart, lineEnd, 'preserve');
      const delta = 2 + renumbered.length - line.length;
      ta.setSelectionRange(s + delta, s + delta);
    }
    return true;
  }
  return false;
}

export function markdownShortcuts(ta) {
  ta.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === 'Tab') && listKeys(ta, e)) {
      e.preventDefault();
      ta.dispatchEvent(new Event('input'));
      return;
    }
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key !== 'b' && key !== 'i') return;
    e.preventDefault();
    const mark = key === 'b' ? '**' : '*';
    const { selectionStart: s, selectionEnd: en, value } = ta;
    const sel = value.slice(s, en) || 'Text';
    ta.setRangeText(`${mark}${sel}${mark}`, s, en, 'end');
    if (s === en) ta.setSelectionRange(s + mark.length, s + mark.length + sel.length);
    ta.dispatchEvent(new Event('input'));
  });
}
