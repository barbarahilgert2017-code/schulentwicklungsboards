# Schulentwicklungsboards

Ein schlankes, selbst gehostetes Kanban-Werkzeug (Trello-ähnlich) für **Schulentwicklungsgruppen** – Steuergruppen, Fachschaften, Projektteams – mit **Nextcloud-Anbindung** und **Vorlagen für typische Schulentwicklungsprozesse**. Gedacht für den Betrieb **in Deutschland**, ohne Tracking und ohne externe Dienste.

## Funktionen

**Boards, Listen, Karten**
- Boards mit frei benennbaren Listen; Karten per Drag & Drop verschieben (Karten und Listen) – auf Tablets alternativ über „Verschieben“ im Karten-Dialog
- Karten mit Beschreibung, Labels, Zuständigen, Start- und Fälligkeitsdatum, Erledigt-Status, Kommentaren, Anhängen und Verlauf
- **Titelbilder**: Das erste angehängte Bild wird automatisch Titelbild (groß oben in der Karte, klein auf der Kachel); per Knopf wechseln oder entfernen. Die Vorschau kommt aus der Nextcloud und wird kurz zwischengespeichert – Dateien bleiben in der Nextcloud
- **Verknüpfte Karten**: Karten untereinander verknüpfen – auch über Boards hinweg, in beide Richtungen; sichtbar nur für Personen mit Zugang zu beiden Boards. „Link zur Karte kopieren“ für Beschreibungen und Kommentare
- **Vorlagenkarten**: Karten als Vorlage markieren (z. B. „Sitzung“ mit Checklisten) und daraus per „aus Vorlage“ neue Karten erstellen; Karten kopieren
- **Uhrzeiten** bei Start und Fälligkeit, z. B. für Sitzungstermine
- **QR-Code** zu jedem Einladungslink – beamer-tauglich im Vollbild oder als Bild zum Ausdrucken
- **Markdown** in Beschreibungen, Kommentaren, Checklisten und Kartentiteln (`**fett**`, `*kursiv*`, Listen, Überschriften, Links …) mit Formatierungsleiste, Vorschau und Strg+B / Strg+I – sicher gerendert ohne HTML
- **Checklisten** mit Fortschrittsbalken; Punkte können einer Person und einem Termin zugeordnet und in eigene Karten umgewandelt werden
- Filter nach Text, Label, „Mir zugewiesen“ und Fälligkeit; Archiv für Karten und Listen
- **Meine Aufgaben**: alle mir zugewiesenen Karten und Checklistenpunkte über alle Boards, gruppiert nach Dringlichkeit
- Rollen pro Board: *Verantwortlich*, *Bearbeiten*, *Lesen* (Lesende dürfen kommentieren – z. B. Schulleitung oder Kollegium)
- **Einladungslink pro Board**: Ein Link für beliebig viele Personen – wer ihn öffnet, kommt nur mit seinem Namen als Gast aufs Board (Bearbeiten oder Lesen, optional mit Ablaufdatum). Gäste können keine eigenen Boards anlegen; Löschen des Links sperrt sie sofort aus. Wer ein Konto anlegen will, kann das über den Link tun.
- **Einladungen per E-Mail**: Personen ohne Konto erhalten einen persönlichen, ablaufenden Link, mit dem sie sich registrieren und direkt dem Board beitreten – auch wenn die freie Registrierung geschlossen ist. Bestehende Konten werden direkt hinzugefügt und benachrichtigt. Ohne SMTP-Server lässt sich der Link kopieren und selbst weitergeben.
- Aktivitätsprotokoll, JSON-Export pro Board, Konto-Selbstlöschung
- **Verwaltung** für Admins: Konten, Administrationsrechte, Links zum Zurücksetzen von Passwörtern, Test-E-Mail; „Passwort vergessen“ per E-Mail

**Nextcloud**
- Anmeldung über den offiziellen **Login Flow v2** – die App erhält ein eigenes, jederzeit widerrufbares App-Passwort; das Nextcloud-Passwort sieht sie nie
- **Dateiauswahl**: Dateien aus der eigenen Nextcloud oder aus dem Board-Ordner an Karten hängen (Link öffnet die Datei direkt in Nextcloud)
- **Board-Ordner**: beim Anlegen eines Boards automatisch `Schulentwicklung/<Boardname>` samt vorlagenspezifischer Unterordner erstellen – oder einen vorhandenen Ordner verknüpfen
- Uploads aus Karten landen direkt im Board-Ordner (Dateien werden nicht auf dem App-Server gespeichert)
- Board-Ordner per Klick in Nextcloud mit allen Board-Mitgliedern teilen

Details: [docs/NEXTCLOUD.md](docs/NEXTCLOUD.md)

**Vorlagen für Schulentwicklung** (mit Listen, Karten, Checklisten, Labels, relativen Terminen und Ordnerstruktur)

| Vorlage | Inhalt |
|---|---|
| Schulentwicklungsvorhaben (PDCA-Zyklus) | Ideen → Plan (IST-Analyse, SMART-Ziele, Maßnahmenplan) → Do → Check → Act |
| Steuergruppe – Jahresarbeit | Themenspeicher, Sitzungsvorbereitung, Schulprogramm, Jahresarbeitsplan, Beschlüsse |
| Medienkonzept / Digitale Schule | Bestandsaufnahme, Kompetenzrahmen in Fachcurricula, Schulträger, Fortbildung, DSGVO |
| Interne Evaluation | Gegenstand & Indikatoren, Instrumente, Datenschutz der Befragung, Auswertung, Zielvereinbarung |
| Unterrichtsentwicklung – Kollegiale Hospitation | Spielregeln, Tandems, Hospitationen, Reflexion |
| Fortbildungsplanung Kollegium | Bedarfe, pädagogischer Tag, Durchführung, Multiplikation |
| Projektwoche / Schulveranstaltung | Rahmen, Angebote, Foto-Einwilligungen, Nachbereitung |
| Leeres Board | Zu erledigen / In Arbeit / Erledigt |

Eigene Vorlagen lassen sich in [`server/templates.js`](server/templates.js) ergänzen.

## Schnellstart (lokal)

Voraussetzung: Node.js ≥ 22.13 (nutzt das eingebaute SQLite-Modul, keine nativen Abhängigkeiten).

```bash
npm install
npm start            # http://localhost:3000
```

Die erste registrierte Person wird Administrator/in. Daten liegen in `./data` (SQLite + lokal erzeugter Schlüssel).

```bash
npm test             # API- und Nextcloud-Tests (mit simulierter Nextcloud)
npm run backup       # konsistente Sicherung nach data/backups
npm run cli -- list-users
npm run cli -- reset-password person@schule.de
```

## Klick-Dummy

Für Workshops und Abstimmungsrunden gibt es eine Demo-Version ohne Server: die echte Oberfläche mit Beispieldaten einer fiktiven Schule, simulierter Nextcloud und simuliertem E-Mail-Versand (Postausgang). Über „Ansicht als“ lässt sich die Rolle wechseln (Koordination, Fachschaft, Schulleitung mit Leserechten, Medienbeauftragter).

```bash
npm run build:demo        # → dist/klickdummy/
cd dist/klickdummy && python3 -m http.server 8000   # dann http://localhost:8000/standalone.html
```

**Öffentlich, ohne Anmeldung:** https://barbarahilgert2017-code.github.io/schulentwicklungsboards/ (Branch `gh-pages`, nur erfundene Beispieldaten). Aktualisieren: `npm run build:demo`, dann den Inhalt von `dist/pages/` auf den Branch `gh-pages` legen. Dort gibt es statt des gemeinsamen Feedbacks „Meine Notizen“ pro Gerät mit „Alle kopieren“.

Die Quellen liegen in [`demo/`](demo/) (`mock-api.js` bildet die REST-API im Browser nach). Änderungen bleiben im Browser der jeweiligen Person.

## Betrieb in Deutschland

Auf einem frischen Server (Ubuntu 24.04 / Debian 12) mit einem Befehl – richtet Docker, HTTPS, Firewall, Sicherheitsupdates, tägliche Datensicherung und den Verwaltungsbefehl `seb` ein:

```bash
curl -fsSL https://raw.githubusercontent.com/barbarahilgert2017-code/schulentwicklungsboards/main/deploy/install.sh | sudo bash
```

Das erste Konto (Administration) lässt sich nur mit dem Einrichtungscode anlegen, den das Skript am Ende anzeigt. **Anleitung ohne Vorkenntnisse, inkl. Server mieten und iPad: [docs/INSTALLATION.md](docs/INSTALLATION.md)**

Manuell geht es auch: `.env` aus `.env.example` anlegen und `docker compose up -d --build`.

Schritt-für-Schritt-Anleitung, Anbieter mit Rechenzentren in Deutschland, Sicherung und Updates: **[docs/HOSTING.md](docs/HOSTING.md)**
Hinweise für Datenschutzbeauftragte (verarbeitete Daten, AVV, VVT): **[docs/DATENSCHUTZ.md](docs/DATENSCHUTZ.md)**

## Konfiguration

Alle Einstellungen über Umgebungsvariablen, siehe [`.env.example`](.env.example). Die wichtigsten:

| Variable | Bedeutung |
|---|---|
| `APP_SECRET` | Pflicht in Produktion; verschlüsselt gespeicherte Nextcloud-App-Passwörter (AES-256-GCM) |
| `ALLOW_REGISTRATION`, `REGISTRATION_EMAIL_DOMAINS` | Selbstregistrierung erlauben / auf Schul-Domains begrenzen |
| `NEXTCLOUD_DEFAULT_URL` | vorbelegte Schul-Nextcloud |
| `NEXTCLOUD_ALLOWED_HOSTS` | Allowlist erlaubter Nextcloud-Server (empfohlen) |
| `NEXTCLOUD_BASE_FOLDER` | Basisordner für Board-Ordner (Standard `Schulentwicklung`) |
| `UPLOAD_MAX_MB` | maximale Uploadgröße |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Mailversand für Einladungen (optional) |
| `INVITE_DAYS` | Gültigkeit von Einladungslinks (Standard 14 Tage) |

## Architektur

```
server/
  index.js          Start, Konfiguration
  app.js            Express-App, Sicherheits-Header (CSP), Fehlerbehandlung
  db.js             SQLite-Schema + Migrationen (node:sqlite)
  auth.js           Sitzungen (HttpOnly-Cookie), CSRF-Token, Login-Rate-Limit
  access.js         Rollenprüfung pro Board
  board-service.js  Boards aus Vorlagen anlegen, Board-/Kartendaten, Sortierung, Aktivität
  nextcloud.js      Login Flow v2, WebDAV (PROPFIND/MKCOL/PUT), OCS (Benutzer, Freigaben), SSRF-Schutz
  nc-service.js     gespeicherte Nextcloud-Konten ↔ Client, Board-Ordner
  templates.js      Schulentwicklungs-Vorlagen
  invitations.js    Einladungen (Token, Annahme), mailer.js: SMTP-Versand + Mailtexte
  routes/           REST-API (auth, nextcloud, boards, cards)
public/             Frontend ohne Build-Schritt (ES-Module, eigenes CSS, keine CDNs)
test/               node:test + simulierte Nextcloud
deploy/             Caddyfile, Backup-Skript
```

Laufzeitabhängigkeiten: Express und nodemailer.
