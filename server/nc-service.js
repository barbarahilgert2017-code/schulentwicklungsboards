import { NextcloudClient, NextcloudError } from './nextcloud.js';
import { HttpError } from './http.js';

/** Verknüpft gespeicherte Nextcloud-Konten mit dem WebDAV-Client. */
export function createNcService({ db, config, box }) {
  const get = db.prepare('SELECT * FROM nextcloud_accounts WHERE user_id = ?');

  function clientFor(userId, { required = true } = {}) {
    const row = userId ? get.get(userId) : null;
    if (!row) {
      if (required) throw new NextcloudError('Keine Nextcloud verbunden. Bitte unter „Konto“ die Nextcloud verbinden.', 409);
      return null;
    }
    return new NextcloudClient({
      serverUrl: row.server_url,
      loginName: row.login_name,
      ncUserId: row.nc_user_id,
      appPassword: box.decrypt(row.app_password_enc),
      userAgent: config.nextcloud.userAgent,
    });
  }

  function account(userId) {
    return userId ? get.get(userId) || null : null;
  }

  /** Client des Kontos, über das der Board-Ordner angebunden ist. */
  function folderClient(boardId) {
    const b = db.prepare('SELECT nc_folder_user_id, nc_folder_path FROM boards WHERE id = ?').get(boardId);
    if (!b?.nc_folder_path) throw new HttpError(409, 'Für dieses Board ist noch kein Nextcloud-Ordner verknüpft.');
    const client = clientFor(b.nc_folder_user_id, { required: false });
    if (!client) {
      throw new HttpError(409, 'Der Board-Ordner ist nicht erreichbar: Die Person, die ihn verknüpft hat, hat ihre Nextcloud getrennt. Bitte den Ordner neu verknüpfen.');
    }
    return { client, root: b.nc_folder_path, ownerId: b.nc_folder_user_id };
  }

  return { clientFor, account, folderClient };
}

export const entryJson = (client, e) => ({
  name: e.name,
  path: e.path,
  isDir: e.isDir,
  size: e.size,
  mime: e.isDir ? null : e.mime,
  modified: e.modified,
  fileId: e.fileId,
  link: client.fileLink(e.fileId),
});
