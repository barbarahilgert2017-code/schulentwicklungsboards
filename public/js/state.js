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
    case 'card.created':
      if (d.fromItem) return 'hat einen Checklistenpunkt in eine Karte umgewandelt';
      if (d.fromTemplate) return `hat die Karte aus der Vorlage „${d.fromTemplate}“ erstellt`;
      if (d.copyOf) return `hat die Karte als Kopie von „${d.copyOf}“ erstellt`;
      return `hat die Karte in „${d.list}“ angelegt`;
    case 'card.moved': return `hat die Karte von „${d.from}“ nach „${d.to}“ verschoben`;
    case 'card.completed': return 'hat die Karte als erledigt markiert';
    case 'card.reopened': return 'hat die Karte wieder geöffnet';
    case 'card.archived': return 'hat die Karte archiviert';
    case 'card.restored': return 'hat die Karte wiederhergestellt';
    case 'card.deleted': return `hat die Karte „${d.title}“ gelöscht`;
    case 'card.renamed': return `hat die Karte umbenannt (vorher „${d.from}“)`;
    case 'card.due': return d.due ? `hat die Fälligkeit auf ${new Date(`${d.due}T00:00:00`).toLocaleDateString('de-DE')}${d.time ? `, ${d.time} Uhr` : ''} gesetzt` : 'hat die Fälligkeit entfernt';
    case 'card.linked': return `hat die Karte mit „${d.title}“ verknüpft`;
    case 'card.unlinked': return `hat die Verknüpfung mit „${d.title}“ gelöst`;
    case 'card.template': return 'hat die Karte zur Vorlage gemacht';
    case 'card.untemplate': return 'hat die Karte wieder zur normalen Karte gemacht';
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
