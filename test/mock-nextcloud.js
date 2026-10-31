// Minimaler Nextcloud-Nachbau für Tests: Login Flow v2, OCS, WebDAV (In-Memory).
import http from 'node:http';

export async function startMockNextcloud() {
  const state = {
    approved: null, // { loginName, appPassword, userId }
    users: { anna: 'anna', bernd: 'bernd' }, // loginName -> userId
    passwords: new Map(), // appPassword -> loginName
    files: new Map([['anna:/', { dir: true, id: 1 }], ['bernd:/', { dir: true, id: 2 }]]),
    shares: [],
    revoked: [],
    nextId: 100,
  };
  let base;

  const auth = (req) => {
    const h = req.headers.authorization || '';
    const [login, pw] = Buffer.from(h.replace(/^Basic /, ''), 'base64').toString().split(':');
    return state.passwords.get(pw) === login ? login : null;
  };
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const readBody = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
  const parent = (p) => (p.lastIndexOf('/') <= 0 ? '/' : p.slice(0, p.lastIndexOf('/')));

  const propXml = (user, p, f) => {
    const href = `/remote.php/dav/files/${user}${p === '/' ? '/' : p.split('/').map(encodeURIComponent).join('/')}${f.dir && p !== '/' ? '/' : ''}`;
    return `<d:response><d:href>${href}</d:href><d:propstat><d:prop>
      <d:displayname>${p === '/' ? user : p.split('/').pop().replace(/&/g, '&amp;')}</d:displayname>
      ${f.dir ? '<d:resourcetype><d:collection/></d:resourcetype>' : `<d:resourcetype/><d:getcontenttype>${f.mime}</d:getcontenttype><d:getcontentlength>${f.size}</d:getcontentlength>`}
      <oc:fileid>${f.id}</oc:fileid><oc:size>${f.size || 0}</oc:size>
      <d:getlastmodified>Mon, 01 Sep 2025 10:00:00 GMT</d:getlastmodified>
      </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, base);
    const p = url.pathname;
    if (req.method === 'POST' && p === '/index.php/login/v2') {
      return json(res, 200, { poll: { token: 'polltoken', endpoint: `${base}/login/v2/poll` }, login: `${base}/login/v2/flow/xyz` });
    }
    if (req.method === 'POST' && p === '/login/v2/poll') {
      const body = (await readBody(req)).toString();
      if (!body.includes('token=polltoken') || !state.approved) return json(res, 404, []);
      const a = state.approved; state.approved = null;
      state.passwords.set(a.appPassword, a.loginName);
      return json(res, 200, { server: base, loginName: a.loginName, appPassword: a.appPassword });
    }
    const login = auth(req);
    if (!login) { res.writeHead(401); return res.end(); }
    const userId = state.users[login];

    if (p === '/ocs/v2.php/cloud/user') return json(res, 200, { ocs: { data: { id: userId, 'display-name': userId.toUpperCase() } } });
    if (p === '/ocs/v2.php/core/apppassword' && req.method === 'DELETE') { state.revoked.push(login); return json(res, 200, { ocs: {} }); }
    if (p === '/ocs/v2.php/apps/files_sharing/api/v1/shares' && req.method === 'POST') {
      const params = new URLSearchParams((await readBody(req)).toString());
      state.shares.push({ owner: userId, path: params.get('path'), shareWith: params.get('shareWith'), permissions: Number(params.get('permissions')) });
      return json(res, 200, { ocs: { meta: { status: 'ok' }, data: {} } });
    }

    const prefix = `/remote.php/dav/files/${userId}`;
    if (!p.startsWith(prefix)) { res.writeHead(403); return res.end(); }
    let fp = decodeURIComponent(p.slice(prefix.length)).replace(/\/+$/, '') || '/';
    const key = `${userId}:${fp}`;
    if (req.method === 'PROPFIND') {
      const f = state.files.get(key);
      if (!f) { res.writeHead(404); return res.end(); }
      let out = propXml(userId, fp, f);
      if (req.headers.depth === '1' && f.dir) {
        for (const [k, v] of state.files) {
          const [u, path] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
          if (u === userId && path !== fp && parent(path) === fp) out += propXml(userId, path, v);
        }
      }
      res.writeHead(207, { 'Content-Type': 'application/xml' });
      return res.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">${out}</d:multistatus>`);
    }
    if (req.method === 'MKCOL') {
      if (state.files.has(key)) { res.writeHead(405); return res.end(); }
      if (!state.files.get(`${userId}:${parent(fp)}`)) { res.writeHead(409); return res.end(); }
      state.files.set(key, { dir: true, id: state.nextId++ });
      res.writeHead(201); return res.end();
    }
    if (req.method === 'PUT') {
      const body = await readBody(req);
      if (!state.files.get(`${userId}:${parent(fp)}`)) { res.writeHead(409); return res.end(); }
      state.files.set(key, { dir: false, id: state.nextId++, size: body.length, mime: req.headers['content-type'], content: body });
      res.writeHead(201); return res.end();
    }
    res.writeHead(405); res.end();
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  return {
    url: base,
    state,
    approve(loginName, appPassword = `pw-${loginName}-${Date.now()}`) { state.approved = { loginName, appPassword }; },
    addFile(userId, path, content = 'x', mime = 'text/plain') {
      state.files.set(`${userId}:${path}`, { dir: false, id: state.nextId++, size: content.length, mime, content: Buffer.from(content) });
    },
    addDir(userId, path) { state.files.set(`${userId}:${path}`, { dir: true, id: state.nextId++ }); },
    close: () => new Promise((r) => server.close(r)),
  };
}
