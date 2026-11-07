/**
 * Nextcloud-Anbindung:
 *  - Login Flow v2 (https://docs.nextcloud.com/server/latest/developer_manual/client_apis/LoginFlow/)
 *  - WebDAV (Dateien auflisten, Ordner anlegen, hochladen)
 *  - OCS (Benutzerinfo, Freigaben, App-Passwort widerrufen)
 */
import dns from 'node:dns/promises';
import net from 'node:net';

export class NextcloudError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

/** Normalisiert eine eingegebene Nextcloud-Adresse zu "https://host[/unterpfad]". */
export function normalizeServerUrl(input, { allowInsecureHttp = false } = {}) {
  let raw = String(input || '').trim();
  if (!raw) throw new NextcloudError('Bitte die Adresse der Nextcloud angeben.', 400);
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new NextcloudError('Ungültige Nextcloud-Adresse.', 400);
  }
  if (url.protocol !== 'https:' && !(allowInsecureHttp && url.protocol === 'http:')) {
    throw new NextcloudError('Die Nextcloud muss über HTTPS erreichbar sein.', 400);
  }
  if (url.username || url.password) throw new NextcloudError('Bitte die Adresse ohne Zugangsdaten angeben.', 400);
  let p = url.pathname;
  for (const marker of ['/index.php', '/apps/', '/remote.php', '/ocs/', '/login']) {
    const i = p.indexOf(marker);
    if (i >= 0) p = p.slice(0, i);
  }
  p = p.replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${p}`;
}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

/** Prüft, ob die App mit diesem Server sprechen darf (Allowlist / Schutz vor SSRF). */
export async function assertServerAllowed(serverUrl, ncConfig) {
  const host = new URL(serverUrl).hostname.toLowerCase();
  if (ncConfig.allowedHosts.length) {
    if (!ncConfig.allowedHosts.includes(host)) {
      throw new NextcloudError(`Diese Nextcloud ist nicht freigegeben. Erlaubt: ${ncConfig.allowedHosts.join(', ')}`, 400);
    }
    return;
  }
  if (ncConfig.allowPrivateNetworks) return;
  let addresses;
  try {
    addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  } catch {
    throw new NextcloudError('Die Nextcloud-Adresse konnte nicht aufgelöst werden.', 400);
  }
  if (addresses.some((a) => isPrivateAddress(a.address))) {
    throw new NextcloudError('Adressen aus internen Netzen sind nicht erlaubt (siehe NEXTCLOUD_ALLOWED_HOSTS).', 400);
  }
}

function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

async function ncFetch(url, opts = {}) {
  let res;
  try {
    res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(opts.timeout ?? 20000), ...opts });
  } catch (err) {
    throw new NextcloudError(`Nextcloud nicht erreichbar (${err.cause?.code || err.name}).`);
  }
  if (res.status >= 300 && res.status < 400) {
    throw new NextcloudError(`Nextcloud leitet um (${res.headers.get('location') || res.status}). Bitte die genaue Adresse angeben.`, 400);
  }
  return res;
}

// ---------------- Login Flow v2 ----------------

export async function startLoginFlow(serverUrl, userAgent) {
  const res = await ncFetch(`${serverUrl}/index.php/login/v2`, {
    method: 'POST',
    headers: { 'User-Agent': userAgent, Accept: 'application/json' },
  });
  if (!res.ok) throw new NextcloudError(`Login Flow konnte nicht gestartet werden (HTTP ${res.status}). Ist das eine Nextcloud?`);
  const data = await res.json().catch(() => null);
  const endpoint = data?.poll?.endpoint;
  const token = data?.poll?.token;
  const login = data?.login;
  if (!endpoint || !token || !login) throw new NextcloudError('Unerwartete Antwort der Nextcloud beim Login Flow.');
  if (!sameOrigin(endpoint, serverUrl) || !sameOrigin(login, serverUrl)) {
    throw new NextcloudError('Die Nextcloud verweist auf einen fremden Server – Abbruch.');
  }
  return { pollEndpoint: endpoint, pollToken: token, loginUrl: login };
}

/** Liefert null, solange der Login noch nicht bestätigt wurde. */
export async function pollLoginFlow(pollEndpoint, pollToken, userAgent) {
  const res = await ncFetch(pollEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': userAgent, Accept: 'application/json' },
    body: new URLSearchParams({ token: pollToken }).toString(),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new NextcloudError(`Fehler beim Abfragen des Login Flows (HTTP ${res.status}).`);
  const data = await res.json();
  if (!data?.loginName || !data?.appPassword) throw new NextcloudError('Unvollständige Zugangsdaten von Nextcloud erhalten.');
  return { server: data.server, loginName: data.loginName, appPassword: data.appPassword };
}

// ---------------- Pfade ----------------

/** Normalisiert einen Pfad relativ zum Nextcloud-Home ("/A/B"), verhindert ".."-Ausbrüche. */
export function cleanPath(p) {
  const segs = String(p || '').split('/').map((s) => s.trim()).filter((s) => s && s !== '.');
  if (segs.some((s) => s === '..' || /[\0\\]/.test(s))) throw new NextcloudError('Ungültiger Pfad.', 400);
  return `/${segs.join('/')}`;
}

export function joinPath(...parts) {
  return cleanPath(parts.join('/'));
}

export function isInside(base, p) {
  const b = cleanPath(base);
  const x = cleanPath(p);
  return b === '/' || x === b || x.startsWith(`${b}/`);
}

/** Dateiname für Nextcloud bereinigen. */
export function safeName(name, fallback = 'Datei') {
  const n = String(name || '').replace(/[\/\\]+/g, '-').replace(/[:*?"<>|\0\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return (n || fallback).slice(0, 180);
}

const encodePath = (p) => cleanPath(p).split('/').map(encodeURIComponent).join('/');

// ---------------- WebDAV-XML ----------------

const decodeXml = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');

function tag(block, name) {
  const m = block.match(new RegExp(`<(?:[\\w.-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>`));
  return m ? decodeXml(m[1].trim()) : null;
}

/** Parst eine WebDAV-Multistatus-Antwort (ohne externe XML-Bibliothek). */
export function parseMultistatus(xml) {
  const out = [];
  const re = /<([\w.-]+:)?response\b[^>]*>([\s\S]*?)<\/\1response>/g;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[2];
    // Nur den Propstat mit Status 200 auswerten
    const propstats = block.match(/<(?:[\w.-]+:)?propstat\b[\s\S]*?<\/(?:[\w.-]+:)?propstat>/g) || [];
    const ok = propstats.find((ps) => / 200 /.test(tag(ps, 'status') || '')) || propstats[0] || block;
    out.push({
      href: tag(block, 'href'),
      isDir: /<(?:[\w.-]+:)?collection\b/.test(ok),
      name: tag(ok, 'displayname'),
      mime: tag(ok, 'getcontenttype'),
      size: Number(tag(ok, 'size') ?? tag(ok, 'getcontentlength') ?? 0) || 0,
      modified: tag(ok, 'getlastmodified'),
      fileId: tag(ok, 'fileid'),
    });
  }
  return out;
}

const PROPFIND_BODY = `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:prop><d:displayname/><d:getcontenttype/><d:getcontentlength/><d:getlastmodified/><d:resourcetype/><oc:fileid/><oc:size/></d:prop>
</d:propfind>`;

// ---------------- Client ----------------

export class NextcloudClient {
  constructor({ serverUrl, loginName, appPassword, ncUserId, userAgent = 'Schulentwicklungsboards' }) {
    this.serverUrl = serverUrl;
    this.loginName = loginName;
    this.ncUserId = ncUserId || loginName;
    this.userAgent = userAgent;
    this.auth = `Basic ${Buffer.from(`${loginName}:${appPassword}`).toString('base64')}`;
  }

  headers(extra = {}) {
    return { Authorization: this.auth, 'User-Agent': this.userAgent, 'OCS-APIRequest': 'true', ...extra };
  }

  davUrl(p) {
    return `${this.serverUrl}/remote.php/dav/files/${encodeURIComponent(this.ncUserId)}${encodePath(p)}`;
  }

  /** Permalink, der in Nextcloud die Datei / den Ordner öffnet. */
  fileLink(fileId) {
    return fileId ? `${this.serverUrl}/index.php/f/${encodeURIComponent(fileId)}` : null;
  }

  async check(res, what) {
    if (res.status === 401) throw new NextcloudError('Nextcloud-Anmeldung abgelaufen oder widerrufen. Bitte neu verbinden.', 401);
    if (res.status === 404) throw new NextcloudError(`${what}: nicht gefunden.`, 404);
    if (res.status === 507) throw new NextcloudError(`${what}: Speicherplatz in der Nextcloud voll.`, 507);
    if (!res.ok) throw new NextcloudError(`${what} fehlgeschlagen (HTTP ${res.status}).`);
    return res;
  }

  async ocs(method, path, body) {
    const opts = { method, headers: this.headers({ Accept: 'application/json' }) };
    if (body) {
      opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      opts.body = new URLSearchParams(body).toString();
    }
    const sep = path.includes('?') ? '&' : '?';
    const res = await ncFetch(`${this.serverUrl}/ocs/v2.php${path}${sep}format=json`, opts);
    await this.check(res, 'Nextcloud-API');
    const json = await res.json().catch(() => ({}));
    return json?.ocs?.data;
  }

  async currentUser() {
    const data = await this.ocs('GET', '/cloud/user');
    return { id: data?.id, displayName: data?.['display-name'] || data?.displayname || data?.id };
  }

  async propfind(p, depth) {
    const res = await ncFetch(this.davUrl(p), {
      method: 'PROPFIND',
      headers: this.headers({ Depth: String(depth), 'Content-Type': 'application/xml; charset=utf-8' }),
      body: PROPFIND_BODY,
    });
    await this.check(res, 'Ordner lesen');
    const xml = await res.text();
    const marker = '/remote.php/dav/files/';
    return parseMultistatus(xml).map((e) => {
      let href = e.href || '';
      try { href = new URL(href, this.serverUrl).pathname; } catch { /* relativ */ }
      const i = href.indexOf(marker);
      const rest = i >= 0 ? href.slice(i + marker.length).split('/').slice(1).join('/') : '';
      const path = cleanPath(rest.split('/').map((s) => { try { return decodeURIComponent(s); } catch { return s; } }).join('/'));
      const name = e.name || path.split('/').pop() || '/';
      return { ...e, path, name };
    });
  }

  async stat(p) {
    try {
      const [entry] = await this.propfind(p, 0);
      return entry || null;
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  async list(p) {
    const target = cleanPath(p);
    const entries = await this.propfind(target, 1);
    const self = entries.find((e) => e.path === target) || null;
    const children = entries
      .filter((e) => e.path !== target)
      .sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name, 'de'));
    return { self, entries: children };
  }

  async mkcol(p) {
    const res = await ncFetch(this.davUrl(p), { method: 'MKCOL', headers: this.headers() });
    if (res.status === 405) return false; // existiert bereits
    if (res.status === 409) throw new NextcloudError('Übergeordneter Ordner fehlt.', 409);
    await this.check(res, 'Ordner anlegen');
    return true;
  }

  /** Legt einen Ordnerpfad rekursiv an. */
  async ensureFolder(p) {
    const segs = cleanPath(p).split('/').filter(Boolean);
    let cur = '';
    for (const s of segs) {
      cur += `/${s}`;
      await this.mkcol(cur);
    }
    return this.stat(cur || '/');
  }

  /** Findet einen freien Dateinamen ("Datei (2).pdf"). */
  async freeName(folder, name) {
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let i = 1; i < 100; i++) {
      const candidate = i === 1 ? name : `${base} (${i})${ext}`;
      if (!(await this.stat(joinPath(folder, candidate)))) return candidate;
    }
    return `${base} (${Date.now()})${ext}`;
  }

  async upload(p, body, { contentType, size } = {}) {
    const headers = this.headers({ 'Content-Type': contentType || 'application/octet-stream' });
    if (size) headers['Content-Length'] = String(size);
    const res = await ncFetch(this.davUrl(p), { method: 'PUT', headers, body, duplex: 'half', timeout: 10 * 60 * 1000 });
    await this.check(res, 'Hochladen');
    return this.stat(p);
  }

  /**
   * Bild für die Anzeige holen: zuerst die verkleinerte Vorschau der Nextcloud,
   * sonst die Datei selbst (bis maxBytes). Gibt { buf, type } zurück.
   */
  async image(fileId, path, { width = 800, height = 450, maxBytes = 8 * 1024 * 1024 } = {}) {
    const read = async (res) => {
      const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const len = Number(res.headers.get('content-length') || 0);
      if (len > maxBytes) throw new NextcloudError('Bild zu groß.', 413);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxBytes) throw new NextcloudError('Bild zu groß.', 413);
      return { buf, type };
    };
    if (fileId) {
      const q = new URLSearchParams({ fileId: String(fileId), x: String(width), y: String(height), a: '1', forceIcon: '0' });
      try {
        const res = await ncFetch(`${this.serverUrl}/index.php/core/preview?${q}`, { headers: this.headers({ Accept: 'image/*' }) });
        if (res.ok) return await read(res);
      } catch (err) { if (err.status === 413) throw err; /* sonst: Datei direkt versuchen */ }
    }
    const res = await ncFetch(this.davUrl(path), { headers: this.headers() });
    await this.check(res, 'Bild laden');
    return read(res);
  }

  /** Teilt einen Ordner mit einer Nextcloud-Nutzerin / einem Nutzer (Freigabetyp 0). */
  async shareWithUser(p, shareWith, permissions = 31) {
    const res = await ncFetch(`${this.serverUrl}/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json`, {
      method: 'POST',
      headers: this.headers({ Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({ path: cleanPath(p), shareType: '0', shareWith, permissions: String(permissions) }).toString(),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true };
    const msg = json?.ocs?.meta?.message || `HTTP ${res.status}`;
    // Bereits geteilt → kein Fehler
    if (/already|bereits/i.test(msg)) return { ok: true, already: true };
    return { ok: false, message: msg };
  }

  async revokeAppPassword() {
    const res = await ncFetch(`${this.serverUrl}/ocs/v2.php/core/apppassword?format=json`, {
      method: 'DELETE', headers: this.headers({ Accept: 'application/json' }),
    });
    return res.ok;
  }
}
