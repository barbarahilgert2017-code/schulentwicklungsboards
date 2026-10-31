/**
 * Board-Vorlagen für typische Schulentwicklungsprozesse.
 *
 * Aufbau: Listen → Karten → Checklisten. `labels` auf Karten verweisen auf Label-Namen,
 * `dueInDays` setzt ein Fälligkeitsdatum relativ zum Anlagedatum.
 * `folders` sind Unterordner, die im Nextcloud-Board-Ordner angelegt werden.
 */

const L = {
  sl: { name: 'Schulleitung', color: '#7b4fa0' },
  sg: { name: 'Steuergruppe', color: '#2f6f9f' },
  fs: { name: 'Fachschaft', color: '#2e8b57' },
  konf: { name: 'Konferenzbeschluss nötig', color: '#c0392b' },
  st: { name: 'Schulträger', color: '#d68910' },
  ds: { name: 'Datenschutz', color: '#5d6d7e' },
  prio: { name: 'Priorität hoch', color: '#e74c3c' },
  eltern: { name: 'Eltern / SV', color: '#16a085' },
  fb: { name: 'Fortbildung', color: '#8e44ad' },
  eval: { name: 'Evaluation', color: '#1abc9c' },
};

export const TEMPLATES = [
  {
    key: 'pdca',
    title: 'Schulentwicklungsvorhaben (PDCA-Zyklus)',
    description: 'Ein Entwicklungsvorhaben vom Bedarf bis zur Verstetigung – nach dem Qualitätszyklus Plan, Do, Check, Act.',
    color: '#2f6f9f',
    folders: ['01 Bestandsaufnahme', '02 Planung', '03 Umsetzung', '04 Evaluation', 'Protokolle'],
    labels: [L.sg, L.sl, L.fs, L.konf, L.eval, L.prio],
    lists: [
      {
        title: 'Ideen & Bedarfe',
        cards: [
          { title: 'Themenspeicher aus Kollegium sammeln', description: 'Rückmeldungen aus Konferenzen, Fachschaften und Gesprächen hier als eigene Karten festhalten.', labels: ['Steuergruppe'] },
        ],
      },
      {
        title: 'Plan – Analyse & Ziele',
        cards: [
          {
            title: 'Bestandsaufnahme / IST-Analyse',
            description: 'Wo stehen wir? Daten und Wahrnehmungen zusammentragen, bevor Ziele formuliert werden.',
            labels: ['Steuergruppe', 'Evaluation'], dueInDays: 30,
            checklists: [{
              title: 'Datengrundlage',
              items: ['Schulstatistik und Abschlussquoten sichten', 'Ergebnisse von Lernstandserhebungen (z. B. VERA) auswerten', 'Bericht der externen Evaluation / Qualitätsanalyse heranziehen', 'Kurzbefragung im Kollegium durchführen', 'Stärken-Schwächen-Analyse (SWOT) erstellen'],
            }],
          },
          {
            title: 'Entwicklungsziele formulieren (SMART)',
            description: 'Ziele spezifisch, messbar, attraktiv, realistisch und terminiert formulieren. Indikatoren für die spätere Evaluation gleich mitdenken.',
            labels: ['Steuergruppe'], dueInDays: 45,
            checklists: [{ title: 'Zielklärung', items: ['Zielentwurf in der Steuergruppe abstimmen', 'Indikatoren für Zielerreichung festlegen', 'Rückkopplung mit Schulleitung', 'Ziele in Gesamtkonferenz vorstellen'] }],
          },
          {
            title: 'Maßnahmen- und Zeitplan erstellen',
            labels: ['Steuergruppe', 'Konferenzbeschluss nötig'], dueInDays: 60,
            checklists: [{ title: 'Planung', items: ['Maßnahmen mit Verantwortlichen benennen', 'Ressourcen klären (Zeit, Budget, Entlastungsstunden)', 'Meilensteine festlegen', 'Beschluss in der Gesamtkonferenz herbeiführen'] }],
          },
        ],
      },
      {
        title: 'Do – Umsetzung',
        cards: [
          { title: 'Pilotphase starten', description: 'Maßnahme zunächst in einzelnen Klassen / Jahrgängen erproben.', labels: ['Fachschaft'], dueInDays: 90 },
          { title: 'Kollegium regelmäßig informieren', description: 'Kurzer Sachstand in jeder Dienstbesprechung, Protokolle im Board-Ordner ablegen.', labels: ['Steuergruppe'] },
        ],
      },
      {
        title: 'Check – Überprüfung',
        cards: [
          {
            title: 'Wirksamkeit überprüfen', labels: ['Evaluation'], dueInDays: 150,
            checklists: [{ title: 'Evaluation', items: ['Erhebung anhand der Indikatoren', 'Ergebnisse auswerten', 'Ergebnisbericht schreiben', 'Rückmeldung an Kollegium und Schulkonferenz'] }],
          },
        ],
      },
      {
        title: 'Act – Verstetigung',
        cards: [
          {
            title: 'Ergebnisse verankern', labels: ['Konferenzbeschluss nötig'], dueInDays: 180,
            checklists: [{ title: 'Verstetigung', items: ['Anpassungen aus der Evaluation einarbeiten', 'Im Schulprogramm / schulinternen Curriculum verankern', 'Zuständigkeiten dauerhaft festlegen', 'Nächsten Entwicklungszyklus planen'] }],
          },
        ],
      },
      { title: 'Erledigt', cards: [] },
    ],
  },
  {
    key: 'steuergruppe',
    title: 'Steuergruppe – Jahresarbeit',
    description: 'Sitzungen, Themenspeicher und Beschlüsse der Steuergruppe über ein Schuljahr organisieren.',
    color: '#7b4fa0',
    folders: ['Protokolle', 'Sitzungsunterlagen', 'Schulprogramm'],
    labels: [L.sg, L.sl, L.konf, L.eltern, L.prio],
    lists: [
      { title: 'Themenspeicher', cards: [
        { title: 'Rückmeldungen aus den Fachschaften', labels: ['Steuergruppe'] },
        { title: 'Anliegen von Eltern- und Schülervertretung', labels: ['Eltern / SV'] },
      ] },
      { title: 'Nächste Sitzung', cards: [
        {
          title: 'Sitzung vorbereiten', dueInDays: 14, labels: ['Steuergruppe'],
          checklists: [{ title: 'Vorbereitung', items: ['Tagesordnung abstimmen und versenden', 'Unterlagen im Board-Ordner bereitstellen', 'Moderation und Protokoll festlegen', 'Raum buchen'] }],
        },
      ] },
      { title: 'In Arbeit', cards: [
        {
          title: 'Schulprogramm fortschreiben', labels: ['Steuergruppe', 'Konferenzbeschluss nötig'], dueInDays: 120,
          checklists: [{ title: 'Fortschreibung', items: ['Leitbild auf Aktualität prüfen', 'Entwicklungsschwerpunkte aktualisieren', 'Entwurf in Fachschaften diskutieren', 'Beschluss Schulkonferenz'] }],
        },
        {
          title: 'Jahresarbeitsplan erstellen', labels: ['Schulleitung', 'Steuergruppe'], dueInDays: 30,
          checklists: [{ title: 'Jahresplanung', items: ['Termine Konferenzen und pädagogische Tage', 'Meilensteine der Entwicklungsvorhaben', 'Abstimmung mit Schulleitung'] }],
        },
      ] },
      { title: 'Wartet auf Beschluss', cards: [] },
      { title: 'Beschlossen / Erledigt', cards: [
        { title: 'Geschäftsordnung der Steuergruppe', description: 'Zusammensetzung, Mandat, Sitzungsrhythmus und Kommunikationswege festhalten.', labels: ['Steuergruppe'] },
      ] },
    ],
  },
  {
    key: 'medienkonzept',
    title: 'Medienkonzept / Digitale Schule',
    description: 'Medienkonzept erstellen oder fortschreiben: Pädagogik, Ausstattung, Fortbildung und Datenschutz.',
    color: '#16a085',
    folders: ['Bestandsaufnahme', 'Konzept', 'Ausstattung', 'Fortbildung', 'Datenschutz'],
    labels: [L.sg, L.fs, L.st, L.ds, L.fb, L.konf],
    lists: [
      { title: 'Bestandsaufnahme', cards: [
        {
          title: 'Ausstattung und Infrastruktur erfassen', labels: ['Schulträger'], dueInDays: 30,
          checklists: [{ title: 'Inventur', items: ['Endgeräte (Anzahl, Alter, Betriebssystem)', 'WLAN-Ausleuchtung und Bandbreite', 'Präsentationstechnik in Unterrichtsräumen', 'Support- und Wartungsstruktur'] }],
        },
        {
          title: 'Medienkompetenzen im Kollegium erheben', labels: ['Fortbildung'], dueInDays: 30,
          checklists: [{ title: 'Erhebung', items: ['Kurzumfrage erstellen', 'Umfrage durchführen', 'Ergebnisse auswerten'] }],
        },
      ] },
      { title: 'Pädagogisches Konzept', cards: [
        {
          title: 'Medienkompetenzen in Fachcurricula verankern', labels: ['Fachschaft'], dueInDays: 120,
          description: 'Orientierung am Kompetenzrahmen der KMK-Strategie „Bildung in der digitalen Welt“ bzw. am Medienkompetenzrahmen des Landes.',
          checklists: [{ title: 'Fachschaften', items: ['Deutsch', 'Mathematik', 'Fremdsprachen', 'Naturwissenschaften', 'Gesellschaftswissenschaften', 'Musik / Kunst / Sport'] }],
        },
        { title: 'Regeln zur Mediennutzung (Nutzungsordnung)', labels: ['Konferenzbeschluss nötig', 'Datenschutz'], dueInDays: 90 },
      ] },
      { title: 'Ausstattung & Schulträger', cards: [
        {
          title: 'Ausstattungsplan mit dem Schulträger abstimmen', labels: ['Schulträger'], dueInDays: 75,
          checklists: [{ title: 'Abstimmung', items: ['Bedarfe aus dem pädagogischen Konzept ableiten', 'Termin mit Schulträger', 'Fördermittel prüfen', 'Ausstattungsplan dokumentieren'] }],
        },
      ] },
      { title: 'Fortbildung', cards: [
        { title: 'Fortbildungsplan Digitalisierung', labels: ['Fortbildung'], dueInDays: 60, checklists: [{ title: 'Planung', items: ['Bedarfe priorisieren', 'Interne Multiplikatorinnen und Multiplikatoren gewinnen', 'Externe Angebote (Landesinstitut, Medienzentrum) prüfen', 'Termine festlegen'] }] },
      ] },
      { title: 'Datenschutz', cards: [
        {
          title: 'Datenschutzrechtliche Prüfung digitaler Werkzeuge', labels: ['Datenschutz'], dueInDays: 60,
          checklists: [{ title: 'DSGVO', items: ['Liste eingesetzter Werkzeuge und Plattformen', 'Auftragsverarbeitungsverträge (Art. 28 DSGVO) prüfen', 'Verzeichnis der Verarbeitungstätigkeiten aktualisieren', 'Einwilligungen und Informationen für Eltern', 'Abstimmung mit der/dem Datenschutzbeauftragten'] }],
        },
      ] },
      { title: 'Beschlossen / Erledigt', cards: [
        { title: 'Medienkonzept in Schulkonferenz beschließen', labels: ['Konferenzbeschluss nötig'], dueInDays: 180 },
      ] },
    ],
  },
  {
    key: 'evaluation',
    title: 'Interne Evaluation',
    description: 'Eine interne Evaluation planen, durchführen und Konsequenzen ableiten.',
    color: '#1abc9c',
    folders: ['Instrumente', 'Rohdaten (nicht teilen!)', 'Auswertung', 'Bericht'],
    labels: [L.eval, L.sg, L.ds, L.konf, L.eltern],
    lists: [
      { title: 'Planung', cards: [
        {
          title: 'Evaluationsgegenstand und Fragestellung festlegen', labels: ['Evaluation', 'Steuergruppe'], dueInDays: 21,
          checklists: [{ title: 'Klärung', items: ['Was genau soll evaluiert werden?', 'Wer wird befragt (Kollegium, Schülerinnen und Schüler, Eltern)?', 'Kriterien und Indikatoren definieren', 'Zeitplan erstellen'] }],
        },
      ] },
      { title: 'Instrumente', cards: [
        { title: 'Fragebogen / Beobachtungsbogen entwickeln', labels: ['Evaluation'], dueInDays: 45, description: 'Bewährte Instrumente (z. B. aus Landesportalen) prüfen, bevor eigene erstellt werden.' },
        {
          title: 'Datenschutz der Befragung klären', labels: ['Datenschutz'], dueInDays: 45,
          checklists: [{ title: 'Datenschutz', items: ['Anonymität sicherstellen', 'Informationsschreiben vorbereiten', 'Ggf. Zustimmung von Personalrat / Schulkonferenz', 'Löschfristen für Rohdaten festlegen'] }],
        },
      ] },
      { title: 'Durchführung', cards: [
        { title: 'Befragung durchführen', labels: ['Evaluation'], dueInDays: 70 },
      ] },
      { title: 'Auswertung', cards: [
        { title: 'Ergebnisse auswerten und aufbereiten', labels: ['Evaluation'], dueInDays: 90 },
      ] },
      { title: 'Rückmeldung & Konsequenzen', cards: [
        {
          title: 'Ergebnisse kommunizieren und Ziele vereinbaren', labels: ['Konferenzbeschluss nötig'], dueInDays: 110,
          checklists: [{ title: 'Rückmeldung', items: ['Präsentation im Kollegium', 'Rückmeldung an Befragte', 'Konsequenzen und Maßnahmen ableiten', 'Zielvereinbarung dokumentieren'] }],
        },
      ] },
    ],
  },
  {
    key: 'hospitation',
    title: 'Unterrichtsentwicklung – Kollegiale Hospitation',
    description: 'Kollegiale Unterrichtshospitationen organisieren: Tandems, Beobachtungsschwerpunkte, Feedback.',
    color: '#2e8b57',
    folders: ['Beobachtungsbögen', 'Material'],
    labels: [L.fs, L.sg, L.fb, L.eval],
    lists: [
      { title: 'Vorbereitung', cards: [
        {
          title: 'Konzept und Spielregeln abstimmen', labels: ['Steuergruppe'], dueInDays: 21,
          checklists: [{ title: 'Spielregeln', items: ['Freiwilligkeit und Vertraulichkeit festhalten', 'Beobachtungsschwerpunkte wählen (z. B. Klassenführung, kognitive Aktivierung)', 'Beobachtungsbogen erstellen', 'Feedbackregeln vereinbaren'] }],
        },
        { title: 'Tandems bilden', labels: ['Fachschaft'], dueInDays: 30 },
      ] },
      { title: 'Hospitationen geplant', cards: [] },
      { title: 'Durchgeführt', cards: [] },
      { title: 'Feedback & Reflexion', cards: [
        { title: 'Gemeinsame Reflexionsrunde', labels: ['Fortbildung'], dueInDays: 120, description: 'Erfahrungen bündeln, ohne Einzelergebnisse offenzulegen.' },
      ] },
    ],
  },
  {
    key: 'fortbildung',
    title: 'Fortbildungsplanung Kollegium',
    description: 'Fortbildungsbedarfe sammeln, Angebote planen und Erfahrungen ins Kollegium tragen.',
    color: '#8e44ad',
    folders: ['Angebote', 'Nachweise', 'Materialien'],
    labels: [L.fb, L.sl, L.fs, L.prio],
    lists: [
      { title: 'Bedarfe', cards: [
        { title: 'Fortbildungsbedarfe abfragen', labels: ['Fortbildung'], dueInDays: 21, checklists: [{ title: 'Abfrage', items: ['Abfrage in Fachschaften', 'Bedarfe aus Entwicklungsvorhaben ableiten', 'Prioritäten festlegen'] }] },
      ] },
      { title: 'Geplant', cards: [
        {
          title: 'Pädagogischer Tag', labels: ['Schulleitung', 'Fortbildung'], dueInDays: 90,
          checklists: [{ title: 'Organisation', items: ['Thema und Referierende festlegen', 'Genehmigung / Termin mit Schulleitung', 'Räume und Technik', 'Einladung an Kollegium', 'Verpflegung'] }],
        },
      ] },
      { title: 'Angemeldet', cards: [] },
      { title: 'Durchgeführt', cards: [] },
      { title: 'Ins Kollegium getragen', cards: [] },
    ],
  },
  {
    key: 'projektwoche',
    title: 'Projektwoche / Schulveranstaltung',
    description: 'Eine Projektwoche oder ein Schulfest planen – von der Idee bis zur Nachbereitung.',
    color: '#d68910',
    folders: ['Projektangebote', 'Organisation', 'Fotos (Einwilligungen beachten)'],
    labels: [L.sl, L.eltern, L.ds, L.prio],
    lists: [
      { title: 'Ideen', cards: [] },
      { title: 'Planung', cards: [
        {
          title: 'Rahmen festlegen', labels: ['Schulleitung'], dueInDays: 30,
          checklists: [{ title: 'Rahmen', items: ['Termin und Thema', 'Budget klären', 'Aufsichtsplan', 'Information an Eltern'] }],
        },
        { title: 'Projektangebote einsammeln', dueInDays: 45 },
        { title: 'Einwilligungen für Fotos einholen', labels: ['Datenschutz'], dueInDays: 50 },
      ] },
      { title: 'Organisation', cards: [
        { title: 'Zuteilung der Schülerinnen und Schüler', dueInDays: 60 },
      ] },
      { title: 'Durchführung', cards: [] },
      { title: 'Nachbereitung', cards: [
        { title: 'Rückmeldung und Dank', checklists: [{ title: 'Abschluss', items: ['Feedback einholen', 'Abrechnung', 'Dank an Beteiligte', 'Erkenntnisse für das nächste Mal notieren'] }] },
      ] },
    ],
  },
  {
    key: 'leer',
    title: 'Leeres Board',
    description: 'Einfaches Kanban mit drei Spalten.',
    color: '#5d6d7e',
    folders: [],
    labels: [L.prio],
    lists: [{ title: 'Zu erledigen', cards: [] }, { title: 'In Arbeit', cards: [] }, { title: 'Erledigt', cards: [] }],
  },
];

export const getTemplate = (key) => TEMPLATES.find((t) => t.key === key) || null;

export function templateSummaries() {
  return TEMPLATES.map((t) => ({
    key: t.key,
    title: t.title,
    description: t.description,
    color: t.color,
    lists: t.lists.map((l) => l.title),
    cardCount: t.lists.reduce((n, l) => n + l.cards.length, 0),
    folders: t.folders,
  }));
}
