# Hosting in Deutschland

Die App ist ein einzelner Node.js-Prozess mit SQLite-Datenbank. Für eine Schule oder einen Schulverbund reicht ein kleiner Server (1–2 vCPU, 2 GB RAM, 20 GB SSD). Dateien liegen in der Nextcloud, nicht auf dem App-Server.

## Wo hosten?

In dieser Reihenfolge prüfen:

1. **Beim Schulträger / kommunalen IT-Dienstleister / Landesangebot** – oft gibt es bereits Server, Verträge und eine abgestimmte Datenschutzdokumentation. Häufig die einfachste Lösung für die Freigabe durch die Schulleitung.
2. **Auf demselben Server wie die Schul-Nextcloud** (falls selbst betrieben) – kurze Wege, eine Stelle für Updates und Sicherungen.
3. **Eigener virtueller Server bei einem Anbieter mit Rechenzentrum in Deutschland**, z. B. Hetzner (Nürnberg, Falkenstein), netcup (Nürnberg), IONOS oder STRATO. Beim Bestellen ausdrücklich einen **Standort in Deutschland** wählen (manche Anbieter haben auch Standorte außerhalb der EU) und den **Auftragsverarbeitungsvertrag (AVV, Art. 28 DSGVO)** abschließen – das geht bei diesen Anbietern in der Regel online im Kundenkonto.

> Bitte vor der Inbetriebnahme mit der/dem schulischen Datenschutzbeauftragten und ggf. dem Schulträger abstimmen. Hinweise dazu in [DATENSCHUTZ.md](DATENSCHUTZ.md).

## Installation mit Docker Compose (Ubuntu 24.04)

### 1. Server vorbereiten

```bash
apt update && apt -y upgrade
apt -y install docker.io docker-compose-v2 git ufw unattended-upgrades
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443 && ufw enable
dpkg-reconfigure -plow unattended-upgrades   # automatische Sicherheitsupdates
```

### 2. DNS

Einen A-/AAAA-Eintrag für die gewünschte Adresse (z. B. `boards.meine-schule.de`) auf die IP des Servers setzen.

### 3. App einrichten

```bash
git clone <repository-url> /opt/schulentwicklungsboards
cd /opt/schulentwicklungsboards
cp .env.example .env
openssl rand -hex 32          # Ausgabe als APP_SECRET in .env eintragen
nano .env                     # DOMAIN, BASE_URL, NEXTCLOUD_* anpassen
docker compose up -d --build
```

Caddy holt automatisch ein TLS-Zertifikat (Let's Encrypt). Danach `https://boards.meine-schule.de` öffnen und **als erste Person registrieren** – dieses Konto wird Administrator/in.

Danach empfohlen: `ALLOW_REGISTRATION=false` setzen oder `REGISTRATION_EMAIL_DOMAINS` auf die Schul-Domain begrenzen und `docker compose up -d` ausführen.

### 4. Nextcloud vorbereiten

Nichts zu installieren – die App nutzt Standard-Schnittstellen. Empfohlen:

- In `.env`: `NEXTCLOUD_DEFAULT_URL` und `NEXTCLOUD_ALLOWED_HOSTS` auf die Schul-Nextcloud setzen.
- Falls die Nextcloud eine Brute-Force-/IP-Sperre nutzt, die IP des App-Servers ggf. als vertrauenswürdig eintragen.
- Bei Nextcloud im internen Netz muss der App-Server sie erreichen können.

## Sicherung

Zu sichern sind **die Datenbank und `APP_SECRET`** (ohne den Schlüssel können gespeicherte Nextcloud-Verbindungen nicht mehr entschlüsselt werden; Boards bleiben aber lesbar, Personen müssen Nextcloud dann neu verbinden).

```bash
# Tägliche konsistente Sicherung (VACUUM INTO) mit 30 Tagen Aufbewahrung
crontab -e
15 2 * * * /opt/schulentwicklungsboards/deploy/backup.sh
```

Die Sicherungen liegen im Volume unter `/data/backups`. Zusätzlich auf ein zweites System kopieren (z. B. per `restic`/`borg` auf einen Speicher in Deutschland):

```bash
docker compose cp app:/data/backups ./backups
```

**Wiederherstellen:** App stoppen, gewünschte Sicherung als `/data/boards.sqlite` in das Volume kopieren (`docker compose cp`), App starten.

## Updates

```bash
cd /opt/schulentwicklungsboards
git pull
docker compose up -d --build
```

Datenbank-Migrationen laufen beim Start automatisch.

## Verwaltung

```bash
docker compose exec app node server/cli.js list-users
docker compose exec app node server/cli.js reset-password person@schule.de
docker compose exec app node server/cli.js make-admin person@schule.de
```

## Ohne Docker

Node.js ≥ 22.13 installieren, dann:

```bash
npm ci --omit=dev
NODE_ENV=production APP_SECRET=… DATA_DIR=/var/lib/schulentwicklungsboards node server/index.js
```

…als systemd-Dienst hinter einem Reverse Proxy (Caddy, nginx) mit HTTPS betreiben. Hinter dem Proxy `TRUST_PROXY=true` setzen.
