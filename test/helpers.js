import { loadConfig } from '../server/config.js';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';

export async function startApp(overrides = {}) {
  const config = loadConfig({
    dbFile: ':memory:', dataDir: '/nonexistent', appSecret: 'x'.repeat(40), cookieSecure: false, production: false,
    allowRegistration: true, registrationDomains: [],
    ...overrides,
    nextcloud: { allowInsecureHttp: true, allowPrivateNetworks: true, allowedHosts: [], baseFolder: 'Schulentwicklung', ...(overrides.nextcloud || {}) },
  });
  const db = openDb(':memory:');
  const app = createApp({ config, db });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, db, config, close: () => new Promise((r) => server.close(r)) };
}

/** Kleiner HTTP-Client mit Cookie + CSRF. */
export function client(base) {
  let cookie = '';
  let csrf = '';
  async function call(method, path, body, headers = {}) {
    const h = { ...headers };
    if (cookie) h.cookie = cookie;
    if (csrf) h['x-csrf-token'] = csrf;
    let payload = body;
    if (body !== undefined && !(body instanceof Uint8Array) && typeof body !== 'string') {
      h['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + path, { method, headers: h, body: payload });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    if (data && data.csrf) csrf = data.csrf;
    return { status: res.status, data };
  }
  return {
    get: (p) => call('GET', p),
    post: (p, b, h) => call('POST', p, b, h),
    patch: (p, b) => call('PATCH', p, b),
    put: (p, b) => call('PUT', p, b),
    del: (p) => call('DELETE', p),
    raw: call,
    async register(email, name = email.split('@')[0]) {
      const r = await call('POST', '/api/auth/register', { email, name, password: 'geheim-passwort-123' });
      if (r.status !== 201) throw new Error(JSON.stringify(r.data));
      return r.data.user;
    },
    setCsrf(v) { csrf = v; },
  };
}
