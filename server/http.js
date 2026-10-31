export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const bad = (msg) => new HttpError(400, msg);

/** Pflicht- oder optionaler Text mit Längenbegrenzung. */
export function text(value, { name = 'Feld', max = 200, required = false, trim = true } = {}) {
  if (value === undefined || value === null) {
    if (required) throw bad(`${name} fehlt.`);
    return undefined;
  }
  if (typeof value !== 'string') throw bad(`${name} muss Text sein.`);
  const v = trim ? value.trim() : value;
  if (required && !v) throw bad(`${name} darf nicht leer sein.`);
  if (v.length > max) throw bad(`${name} ist zu lang (max. ${max} Zeichen).`);
  return v;
}

/** Datum als YYYY-MM-DD oder null. */
export function date(value, name = 'Datum') {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw bad(`${name} ist ungültig (erwartet JJJJ-MM-TT).`);
  }
  return value;
}

export function color(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) throw bad('Farbe ist ungültig.');
  return value.toLowerCase();
}

export function int(value, name = 'Wert') {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw bad(`${name} ist ungültig.`);
  return n;
}

export function bool(value) {
  if (value === undefined) return undefined;
  return value ? 1 : 0;
}

/** Baut ein UPDATE nur aus gesetzten Feldern. */
export function updateFields(db, table, id, fields, { touch = false } = {}) {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (!entries.length) return false;
  const sets = entries.map(([k]) => `${k} = ?`);
  if (touch) sets.push("updated_at = datetime('now')");
  db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).run(...entries.map(([, v]) => v), id);
  return true;
}
