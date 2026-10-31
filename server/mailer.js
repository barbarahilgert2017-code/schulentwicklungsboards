import nodemailer from 'nodemailer';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * E-Mail-Versand über SMTP. Ohne SMTP_HOST ist der Versand deaktiviert –
 * Einladungslinks können dann in der App kopiert und selbst verschickt werden.
 */
export function createMailer(config) {
  const smtp = config.smtp;
  if (!smtp.host) return { enabled: false, async send() { return false; } };
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: !smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return {
    enabled: true,
    async send(msg) {
      await transport.sendMail({ from: smtp.from, ...msg });
      return true;
    },
  };
}

const ROLE = { owner: 'Verantwortlich', editor: 'Bearbeiten', viewer: 'Lesen' };

function layout(appName, title, paragraphs, button) {
  const text = [...paragraphs, '', `${button.label}: ${button.url}`, '', '—', appName].join('\n');
  const html = `<!doctype html><html lang="de"><body style="font-family:system-ui,Arial,sans-serif;color:#1d2733;line-height:1.5">
<div style="max-width:520px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 16px">${esc(title)}</h2>
${paragraphs.map((p) => `<p>${esc(p)}</p>`).join('\n')}
<p style="margin:24px 0"><a href="${esc(button.url)}" style="background:#2f6f9f;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">${esc(button.label)}</a></p>
<p style="color:#5b6878;font-size:13px">Falls der Button nicht funktioniert: ${esc(button.url)}</p>
<p style="color:#5b6878;font-size:13px">— ${esc(appName)}</p>
</div></body></html>`;
  return { text, html };
}

export function invitationMail({ appName, inviter, board, role, link, expiresDays }) {
  const subject = `Einladung zum Board „${board}“`;
  return {
    subject,
    ...layout(appName, subject, [
      `${inviter} lädt dich ein, im Board „${board}“ mitzuarbeiten (Rolle: ${ROLE[role] || role}).`,
      `${appName} ist das Werkzeug eurer Schule, um Schulentwicklungsvorhaben mit Karten, Checklisten und Nextcloud-Ordnern zu organisieren.`,
      `Mit dem Link kannst du dir ein Konto anlegen bzw. dich anmelden. Er ist ${expiresDays} Tage gültig und nur für dich bestimmt.`,
    ], { label: 'Einladung annehmen', url: link }),
  };
}

export function addedMail({ appName, inviter, board, role, link }) {
  const subject = `Du wurdest zum Board „${board}“ hinzugefügt`;
  return {
    subject,
    ...layout(appName, subject, [
      `${inviter} hat dich zum Board „${board}“ hinzugefügt (Rolle: ${ROLE[role] || role}).`,
    ], { label: 'Board öffnen', url: link }),
  };
}
