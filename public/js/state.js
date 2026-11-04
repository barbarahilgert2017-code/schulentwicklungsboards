export const state = {
  me: null,
  config: {},
  nextcloud: null,
};

export const navigate = (hash) => {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
};

export const describeActivity = (a) => {
  const d = a.details || {};
  switch (a.action) {
    case 'board.created': return 'hat das Board angelegt';
    case 'card.created': return d.fromItem ? 'hat einen Checklistenpunkt in eine Karte umgewandelt' : `hat die Karte in „${d.list}“ angelegt`;
    case 'card.moved': return `hat die Karte von „${d.from}“ nach „${d.to}“ verschoben`;
    case 'card.completed': return 'hat die Karte als erledigt markiert';
    case 'card.reopened': return 'hat die Karte wieder geöffnet';
    case 'card.archived': return 'hat die Karte archiviert';
    case 'card.restored': return 'hat die Karte wiederhergestellt';
    case 'card.deleted': return `hat die Karte „${d.title}“ gelöscht`;
    case 'card.renamed': return `hat die Karte umbenannt (vorher „${d.from}“)`;
    case 'card.due': return d.due ? `hat die Fälligkeit auf ${new Date(`${d.due}T00:00:00`).toLocaleDateString('de-DE')} gesetzt` : 'hat die Fälligkeit entfernt';
    case 'card.member': return `hat ${d.name} zugewiesen`;
    case 'checklist.added': return `hat die Checkliste „${d.title}“ hinzugefügt`;
    case 'item.done': return `hat „${d.text}“ abgehakt`;
    case 'comment.added': return 'hat kommentiert';
    case 'attachment.added': return `hat „${d.name}“ angehängt`;
    case 'member.added': return `hat ${d.name} zum Board hinzugefügt`;
    case 'member.invited': return `hat ${d.email} eingeladen`;
    case 'member.joined': return 'ist dem Board über eine Einladung beigetreten';
    case 'member.guest': return 'ist über einen Einladungslink als Gast beigetreten';
    case 'link.created': return d.role === 'viewer' ? 'hat einen Einladungslink zum Lesen erstellt' : 'hat einen Einladungslink zum Bearbeiten erstellt';
    case 'link.deleted': return d.guests ? `hat einen Einladungslink gelöscht (${d.guests} Gast/Gäste ausgesperrt)` : 'hat einen Einladungslink gelöscht';
    case 'member.removed': return `hat ${d.name} aus dem Board entfernt`;
    case 'folder.linked': return `hat den Nextcloud-Ordner „${d.path}“ verknüpft`;
    default: return a.action;
  }
};

export const ROLE_LABELS = { owner: 'Verantwortlich', editor: 'Bearbeiten', viewer: 'Lesen' };
