# Installation – Schritt für Schritt

Diese Anleitung bringt Schulentwicklungsboards auf einen eigenen Server in Deutschland. Vorkenntnisse sind nicht nötig. Dauer: etwa 20 Minuten. Kosten: ein kleiner Server für etwa 4–6 € im Monat.

Am Ende habt ihr eine Adresse wie `https://boards.meine-schule.de` (oder zunächst eine automatische Adresse), echte Konten, gemeinsame Boards, Nextcloud-Anbindung, E-Mail-Einladungen und eine tägliche Datensicherung.

> Vorher klären: Schulleitung und Datenschutzbeauftragte/n informieren. Hinweise dazu stehen in [DATENSCHUTZ.md](DATENSCHUTZ.md). Wenn der Schulträger einen Server stellen kann, funktioniert diese Anleitung dort genauso (ab Schritt 3).

## 1. Server mieten (Beispiel: Hetzner)

1. Auf **console.hetzner.cloud** ein Konto anlegen und ein Projekt erstellen, z. B. „Schulentwicklung“.
2. **Server hinzufügen**:
   - **Standort:** Nürnberg oder Falkenstein (beide in Deutschland)
   - **Image:** Ubuntu 24.04
   - **Typ:** der kleinste Typ mit 2 GB RAM reicht für eine Schule
   - **SSH-Schlüssel:** kann leer bleiben – dann schickt Hetzner das Passwort per E-Mail
   - **Name:** z. B. `boards`
3. **Erstellen**. Nach etwa einer Minute steht die **IP-Adresse** des Servers in der Übersicht (z. B. `116.203.45.67`).
4. Im Hetzner-Konto den **Vertrag zur Auftragsverarbeitung (AVV)** abschließen (zu finden in den Kontoeinstellungen unter Datenschutz). Das ist für den Schulbetrieb nötig.

Andere Anbieter mit Rechenzentrum in Deutschland (z. B. netcup, IONOS) funktionieren genauso: Ubuntu 24.04 oder Debian 12 wählen, Standort Deutschland.

## Abkürzung: Installation ganz ohne Anmelden (cloud-init)

Beim Erstellen des Servers bei Hetzner gibt es weiter unten das Feld **„Cloud config“**. Wird dort der folgende Text eingefügt, installiert sich der Server beim ersten Start komplett selbst – Schritt 2 und 3 entfallen. `MEIN-CODE-HIER` durch einen selbst gewählten Einrichtungscode ersetzen (mindestens 8 Zeichen, ohne Leerzeichen):

```yaml
#cloud-config
runcmd:
  - curl -fsSL https://raw.githubusercontent.com/barbarahilgert2017-code/schulentwicklungsboards/main/deploy/install.sh | SEB_NONINTERACTIVE=1 SEB_SETUP_CODE=MEIN-CODE-HIER bash
```

Nach etwa 5–10 Minuten ist die App erreichbar unter `https://IP-MIT-BINDESTRICHEN.sslip.io` – also z. B. bei der IP `116.203.45.67` unter `https://116-203-45-67.sslip.io`. Weiter mit Schritt 4.

Ein bereits erstellter Server lässt sich dafür löschen und neu anlegen (Hetzner rechnet stundengenau ab, das kostet nur Cent).

## 2. Mit dem Server verbinden

**Vom iPad:** Die kostenlose App **Termius** installieren → **New Host** → bei *Address* die IP-Adresse, bei *Username* `root`, bei *Password* das Passwort aus der Hetzner-E-Mail → **Connect**.

**Vom Mac/PC:** Terminal öffnen und `ssh root@IP-ADRESSE` eingeben.

**Ohne App:** In der Hetzner-Konsole (Achtung: dort funktioniert Einfügen oft nicht, und das lange Passwort muss abgetippt werden – dann lieber die Abkürzung mit cloud-init oben nutzen) beim Server auf das Symbol **`>_`** (Konsole) klicken. Benutzer `root`, Passwort aus der E-Mail.

Beim ersten Anmelden verlangt der Server ein neues Passwort: zuerst das alte aus der E-Mail eingeben, dann zweimal ein neues. **Dieses Passwort gut aufbewahren.**

## 3. Installieren

Diesen einen Befehl einfügen und Enter drücken:

```bash
curl -fsSL https://raw.githubusercontent.com/barbarahilgert2017-code/schulentwicklungsboards/main/deploy/install.sh | sudo bash
```

Das Skript stellt drei Fragen:

| Frage | Was eingeben? |
|---|---|
| **Adresse** | Einfach **Enter** – dann gibt es sofort eine funktionierende Adresse wie `116-203-45-67.sslip.io`. Eine eigene Adresse (z. B. `boards.meine-schule.de`) lässt sich später einstellen, siehe unten. |
| **Schul-Nextcloud** | z. B. `cloud.meine-schule.de` – oder Enter, wenn ihr (noch) keine habt |
| **E-Mail-Domain** | z. B. `meine-schule.de`, damit sich nur Personen mit Schuladresse registrieren können – oder Enter |

Nach 3–5 Minuten erscheint:

```
Fertig!
  Adresse:            https://116-203-45-67.sslip.io
  Einrichtungscode:   K7QM-2XWP-9DTR
```

**Den Einrichtungscode notieren.** Damit legt ihr gleich das erste Konto an. (Später nochmal anzeigen: `sudo seb code`)

## 4. Erstes Konto anlegen

1. Die angezeigte Adresse im Browser öffnen.
2. Es erscheint **„Ersteinrichtung“**: Einrichtungscode, Name, dienstliche E-Mail und ein Passwort eingeben → **Einrichten**.
3. Dieses Konto ist die **Administration**. Oben erscheint der Menüpunkt **Verwaltung**.

Ohne den Code kann niemand sonst das erste Konto anlegen – auch wenn die Adresse schon öffentlich erreichbar ist.

## 5. E-Mail-Versand einrichten (empfohlen)

Ohne E-Mail funktioniert alles, aber Einladungs- und Passwort-Links müsst ihr selbst weitergeben. Mit E-Mail werden sie automatisch verschickt.

Ihr braucht die **SMTP-Zugangsdaten** eines Postfachs, z. B. `boards@meine-schule.de` – vom Schulträger, der IT-Betreuung oder dem Mail-Anbieter der Schule.

1. Auf dem Server: `sudo seb einstellungen`
2. Im Editor die E-Mail-Zeilen ausfüllen, zum Beispiel:
   ```
   SMTP_HOST=smtp.meine-schule.de
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=boards@meine-schule.de
   SMTP_PASS=das-passwort
   MAIL_FROM="Schulentwicklungsboards <boards@meine-schule.de>"
   ```
   (Port 465 statt 587? Dann `SMTP_SECURE=true`.)
3. Speichern mit **Strg+O**, Enter, dann **Strg+X**. Die App startet neu.
4. In der App unter **Verwaltung → Test-E-Mail an mich** prüfen, ob es klappt.

## 6. Eigene Adresse (optional)

1. Beim Domain-Anbieter der Schule einen **A-Eintrag** anlegen lassen, z. B. `boards.meine-schule.de` → IP-Adresse des Servers.
2. Etwas warten (meist unter einer Stunde), dann auf dem Server `sudo seb einstellungen` und diese zwei Zeilen ändern:
   ```
   DOMAIN=boards.meine-schule.de
   BASE_URL=https://boards.meine-schule.de
   ```
3. Speichern. Das HTTPS-Zertifikat wird automatisch geholt.

## 7. Kollegium einladen

- **Einladungslink (am einfachsten):** Board öffnen → **Teilen** → **Link erstellen** → Link kopieren und z. B. per Mail oder Messenger verschicken. Wer ihn öffnet, gibt nur seinen Namen ein und ist auf dem Board – ohne Konto.
- **Einzeln per E-Mail:** Board öffnen → auf die Personen-Symbole klicken → E-Mail-Adresse und Rolle eingeben.
- **Selbst registrieren:** Wer die Adresse kennt und eine passende Schul-E-Mail hat, kann sich selbst registrieren. Nur per Einladung? Dann in `sudo seb einstellungen` die Zeile `ALLOW_REGISTRATION=false` setzen.
- **Passwort vergessen:** über den Link auf der Anmeldeseite, oder die Administration erstellt unter **Verwaltung → Aktionen** einen Link.
- **Nextcloud:** Jede Person verbindet ihre Nextcloud einmal unter **Konto**.

## Im Alltag

Alle Befehle auf dem Server, immer mit `sudo`:

| Befehl | Wofür |
|---|---|
| `sudo seb status` | Läuft alles? |
| `sudo seb update` | Neue Version sofort installieren (sonst passiert das jede Nacht automatisch) |
| `sudo seb automatisch an` / `aus` | Nächtliche Updates ein- oder ausschalten (Standard: an) |
| `sudo seb updateprotokoll` | Was haben die automatischen Updates gemacht? |
| `sudo seb einstellungen` | E-Mail, Nextcloud, Registrierung, Adresse ändern |
| `sudo seb sicherung` | Datensicherung sofort (läuft sonst täglich um 2:15 Uhr) |
| `sudo seb logs` | Protokoll ansehen, wenn etwas nicht klappt |
| `sudo seb passwort name@schule.de` | Notfall: neues Passwort setzen, falls niemand mehr in die Verwaltung kommt |
| `sudo seb hilfe` | Alle Befehle |

**Neue Versionen der App** holt der Server jede Nacht um 3:40 Uhr selbst. Vorher wird eine Datensicherung erstellt; startet die neue Version nicht, kehrt er automatisch zur vorherigen zurück. Ihr müsst euch dafür nicht anmelden.

**Sicherheitsupdates** des Betriebssystems installiert der Server ebenfalls selbstständig. Die Firewall lässt nur SSH, HTTP und HTTPS zu.

**Datensicherung:** Die tägliche Sicherung liegt auf dem Server selbst (30 Tage). Für den Fall, dass der ganze Server ausfällt, zusätzlich bei Hetzner die **Backups** für den Server einschalten (ca. 20 % Aufpreis) und die Datei `/opt/schulentwicklungsboards/.env` an einem sicheren Ort aufbewahren – sie enthält den geheimen Schlüssel.

## Wenn etwas nicht klappt

| Problem | Lösung |
|---|---|
| Adresse lädt nicht | 2–3 Minuten warten (Zertifikat). Dann `sudo seb status` und `sudo seb logs`. |
| Eigene Adresse: Zertifikatsfehler | Zeigt der A-Eintrag wirklich auf die Server-IP? Prüfen auf dnschecker.org |
| Einrichtungscode verloren | `sudo seb code` |
| Test-E-Mail kommt nicht an | `sudo seb mailtest` zeigt, ob Verbindung und Anmeldung beim Mailserver klappen; Spam-Ordner ansehen; Port 587 statt 465 verwenden |
| Nextcloud-Verbindung scheitert | Steht die Nextcloud-Adresse richtig in `NEXTCLOUD_ALLOWED_HOSTS`? |
