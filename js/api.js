let csrf = null;
export const setCsrf = (t) => { csrf = t; };

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function request(method, path, body, { raw = false, headers = {} } = {}) {
  const opts = { method, headers: { ...headers }, credentials: 'same-origin' };
  if (csrf && method !== 'GET') opts.headers['X-CSRF-Token'] = csrf;
  if (body !== undefined) {
    if (raw) {
      opts.body = body;
    } else {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
  }
  let res;
  try {
    res = await fetch(`/api${path}`, opts);
  } catch {
    throw new ApiError(0, 'Keine Verbindung zum Server.');
  }
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('seb:unauthorized'));
    throw new ApiError(res.status, data?.error || `Fehler ${res.status}`);
  }
  if (data?.csrf) csrf = data.csrf;
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b ?? {}),
  patch: (p, b) => request('PATCH', p, b),
  put: (p, b) => request('PUT', p, b ?? {}),
  del: (p, b) => request('DELETE', p, b),
  upload: (p, file) => request('POST', p, file, { raw: true, headers: { 'Content-Type': file.type || 'application/octet-stream' } }),
};
