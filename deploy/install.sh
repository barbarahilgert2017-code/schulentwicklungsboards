#!/usr/bin/env bash
# Schulentwicklungsboards – Installation auf einem frischen Server (Ubuntu 22.04/24.04 oder Debian 12)
#
#   curl -fsSL https://raw.githubusercontent.com/barbarahilgert2017-code/schulentwicklungsboards/main/deploy/install.sh | sudo bash
#
# Richtet ein: Docker, Firewall, automatische Sicherheitsupdates, die App mit HTTPS (Caddy),
# tägliche Datensicherung und den Befehl „seb“ für die Verwaltung.
# Erneut ausführen ist gefahrlos: vorhandene Daten und Einstellungen bleiben erhalten.
#
# Ohne Rückfragen (z. B. per cloud-init):  SEB_NONINTERACTIVE=1 SEB_DOMAIN=boards.schule.de bash install.sh
# Weitere Variablen: SEB_NEXTCLOUD (Adresse der Schul-Nextcloud), SEB_MAIL_DOMAINS (z. B. schule.de),
#   SEB_SETUP_CODE (eigener Einrichtungscode, mind. 8 Zeichen – sonst wird einer erzeugt)
set -euo pipefail

REPO_URL="${SEB_REPO:-https://github.com/barbarahilgert2017-code/schulentwicklungsboards.git}"
BRANCH="${SEB_BRANCH:-main}"
DIR="${SEB_DIR:-/opt/schulentwicklungsboards}"
BIN="${SEB_BIN:-/usr/local/bin/seb}"
DRY="${SEB_DRY_RUN:-}"          # nur für Tests: keine Systemänderungen
NONINT="${SEB_NONINTERACTIVE:-}"

bold=$'\e[1m'; green=$'\e[32m'; yellow=$'\e[33m'; red=$'\e[31m'; reset=$'\e[0m'
say()  { printf '%s\n' "${bold}==>${reset} $*"; }
warn() { printf '%s\n' "${yellow}Hinweis:${reset} $*"; }
die()  { printf '%s\n' "${red}Fehler:${reset} $*" >&2; exit 1; }
run()  { if [ -n "$DRY" ]; then echo "[test] $*"; else "$@"; fi; }

ask() { # ask "Frage" "Vorgabe"
  local answer=""
  if [ -n "$NONINT" ] || [ ! -r /dev/tty ]; then printf '%s' "$2"; return; fi
  read -r -p "$1 " answer </dev/tty || true
  printf '%s' "${answer:-$2}"
}

random_code() { # gut lesbarer Code ohne verwechselbare Zeichen, z. B. K7QM-2XWP-9DTR
  local chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789' out='' i
  for i in $(seq 1 12); do
    out+="${chars:$(( $(od -An -N2 -tu2 /dev/urandom) % ${#chars} )):1}"
    if [ "$i" = 4 ] || [ "$i" = 8 ]; then out+='-'; fi
  done
  printf '%s' "$out"
}

public_ip() {
  local ip=""
  ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}') || true
  case "$ip" in 10.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*|192.168.*|"") ip=$(curl -4 -fsS --max-time 5 https://ifconfig.co 2>/dev/null || true) ;; esac
  printf '%s' "$ip"
}

# ---------------------------------------------------------------- Prüfungen
[ -n "$DRY" ] || [ "$(id -u)" = 0 ] || die "Bitte mit Administratorrechten ausführen (… | sudo bash)."
command -v apt-get >/dev/null || [ -n "$DRY" ] || die "Dieses Skript unterstützt Ubuntu und Debian."

echo
echo "${bold}Schulentwicklungsboards – Installation${reset}"
echo "Dauer: etwa 3–5 Minuten. Vorhandene Daten bleiben erhalten."
echo

# ---------------------------------------------------------------- Fragen (nur beim ersten Mal)
IP=$(public_ip)
if [ -f "$DIR/.env" ]; then
  say "Vorhandene Installation gefunden – Einstellungen werden übernommen."
  FIRST=""
else
  FIRST=1
  echo "Unter welcher Adresse soll die App erreichbar sein?"
  echo "  • Eigene Adresse, z. B. boards.meine-schule.de (vorher beim Domain-Anbieter auf ${IP:-die Server-IP} zeigen lassen)"
  echo "  • Oder einfach Enter drücken: Dann gibt es sofort eine kostenlose Adresse auf Basis der Server-IP."
  DOMAIN=$(ask "Adresse [Enter = automatisch]:" "${SEB_DOMAIN:-}")
  DOMAIN=$(printf '%s' "$DOMAIN" | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#/.*$##; s/[[:space:]]//g')
  if [ -z "$DOMAIN" ]; then
    [ -n "$IP" ] || die "Konnte die öffentliche IP-Adresse nicht ermitteln. Bitte eine Adresse angeben (SEB_DOMAIN=…)."
    DOMAIN="${IP//./-}.sslip.io"
  elif ! printf '%s' "$DOMAIN" | grep -Eq '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$'; then
    die "„$DOMAIN“ ist keine gültige Adresse."
  else
    RESOLVED=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}') || true
    if [ -n "$IP" ] && [ "$RESOLVED" != "$IP" ]; then
      warn "$DOMAIN zeigt ${RESOLVED:+auf $RESOLVED }nicht auf diesen Server ($IP)."
      warn "Ohne passenden DNS-Eintrag klappt das HTTPS-Zertifikat nicht. Später ändern: sudo seb einstellungen"
    fi
  fi
  echo
  NEXTCLOUD=$(ask "Adresse eurer Schul-Nextcloud, z. B. cloud.meine-schule.de [Enter = später]:" "${SEB_NEXTCLOUD:-}")
  NEXTCLOUD=$(printf '%s' "$NEXTCLOUD" | sed -E 's/[[:space:]]//g; s#/+$##')
  if [ -n "$NEXTCLOUD" ] && ! printf '%s' "$NEXTCLOUD" | grep -q '^https\?://'; then NEXTCLOUD="https://$NEXTCLOUD"; fi
  NC_HOST=$(printf '%s' "$NEXTCLOUD" | sed -E 's#^https?://##; s#[/:].*$##')
  MAIL_DOMAINS=$(ask "Registrieren nur mit E-Mail-Adressen dieser Domain, z. B. meine-schule.de [Enter = alle]:" "${SEB_MAIL_DOMAINS:-}")
  MAIL_DOMAINS=$(printf '%s' "$MAIL_DOMAINS" | tr 'A-Z' 'a-z' | sed -E 's/[[:space:]@]//g')
fi

# ---------------------------------------------------------------- System vorbereiten
say "Pakete und Sicherheitsupdates einrichten …"
export DEBIAN_FRONTEND=noninteractive
# Beim ersten Start installiert der Server oft selbst Updates – dann warten statt abbrechen.
APT=(apt-get -o DPkg::Lock::Timeout=600)
run "${APT[@]}" update -qq
run "${APT[@]}" install -y -qq ca-certificates curl git openssl ufw unattended-upgrades >/dev/null
run dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

if [ -n "$DRY" ] || docker compose version >/dev/null 2>&1; then
  say "Docker ist vorhanden."
else
  say "Docker installieren …"
  if ! { "${APT[@]}" install -y -qq docker.io docker-compose-v2 >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; }; then
    curl -fsSL https://get.docker.com | sh >/dev/null
  fi
  systemctl enable --now docker >/dev/null 2>&1 || true
fi

say "Firewall: nur SSH, HTTP und HTTPS erlauben …"
run ufw allow OpenSSH >/dev/null
run ufw allow 80/tcp >/dev/null
run ufw allow 443 >/dev/null
run ufw --force enable >/dev/null

# ---------------------------------------------------------------- App holen
if [ -d "$DIR/.git" ]; then
  say "App aktualisieren …"
  run git -C "$DIR" fetch -q origin "$BRANCH"
  run git -C "$DIR" checkout -q "$BRANCH"
  run git -C "$DIR" reset -q --hard "origin/$BRANCH"
elif [ -n "$DRY" ] && [ -f "$DIR/docker-compose.yml" ]; then
  say "Testmodus: vorhandenen Ordner $DIR verwenden."
else
  say "App herunterladen nach $DIR …"
  run git clone -q --branch "$BRANCH" "$REPO_URL" "$DIR"
fi

# ---------------------------------------------------------------- Konfiguration
if [ -n "$FIRST" ]; then
  say "Konfiguration anlegen …"
  SETUP_CODE="${SEB_SETUP_CODE:-}"
  if [ -n "$SETUP_CODE" ] && [ "${#SETUP_CODE}" -lt 8 ]; then die "SEB_SETUP_CODE ist zu kurz (mind. 8 Zeichen)."; fi
  [ -n "$SETUP_CODE" ] || SETUP_CODE=$(random_code)
  umask 077
  cat > "$DIR/.env" <<ENV
# Schulentwicklungsboards – Einstellungen. Nach Änderungen: sudo seb neustart
# Mehr dazu: docs/INSTALLATION.md und .env.example

DOMAIN=$DOMAIN
BASE_URL=https://$DOMAIN
APP_NAME=Schulentwicklungsboards

# Geheimer Schlüssel – NICHT ändern, sonst gehen gespeicherte Nextcloud-Verbindungen verloren.
APP_SECRET=$(openssl rand -hex 32)

# Code für das allererste Konto (Administration). Wird danach nicht mehr gebraucht.
SETUP_CODE=$SETUP_CODE

# Registrierung: true = jede Person mit passender Adresse, false = nur per Einladung
ALLOW_REGISTRATION=true
REGISTRATION_EMAIL_DOMAINS=$MAIL_DOMAINS

# Nextcloud der Schule
NEXTCLOUD_DEFAULT_URL=$NEXTCLOUD
NEXTCLOUD_ALLOWED_HOSTS=$NC_HOST
NEXTCLOUD_BASE_FOLDER=Schulentwicklung

# E-Mail-Versand (Einladungen, Passwort vergessen). Zugangsdaten vom Schul-Postfach oder Schulträger.
# Ohne SMTP_HOST zeigt die App die Links zum Weitergeben an.
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
MAIL_FROM=

UPLOAD_MAX_MB=50
ENV
  chmod 600 "$DIR/.env"
  umask 022
else
  DOMAIN=$(grep -E '^DOMAIN=' "$DIR/.env" | cut -d= -f2-)
  SETUP_CODE=$(grep -E '^SETUP_CODE=' "$DIR/.env" | cut -d= -f2- || true)
fi

# ---------------------------------------------------------------- Verwaltungsbefehl „seb“
say "Befehl „seb“ einrichten …"
cat > "$BIN" <<'SEB'
#!/usr/bin/env bash
# Verwaltung von Schulentwicklungsboards. Übersicht: sudo seb hilfe
set -euo pipefail
DIR="__DIR__"
cd "$DIR"
dc() { docker compose "$@"; }
case "${1:-hilfe}" in
  status)        dc ps; echo; echo "Adresse: $(grep -E '^BASE_URL=' .env | cut -d= -f2-)";;
  update)        git fetch -q origin && git reset -q --hard "origin/$(git rev-parse --abbrev-ref HEAD)" && dc up -d --build && docker image prune -f >/dev/null && echo "Aktualisiert.";;
  einstellungen) ${EDITOR:-nano} .env && dc up -d && echo "Neu gestartet mit den neuen Einstellungen.";;
  neustart)      dc up -d --force-recreate && echo "Neu gestartet.";;
  logs)          dc logs --tail 100 -f app;;
  sicherung)     ./deploy/backup.sh && echo "Sicherungen: docker compose exec app ls /data/backups";;
  code)          echo "Einrichtungscode: $(grep -E '^SETUP_CODE=' .env | cut -d= -f2-)  (nur für das allererste Konto)";;
  passwort)      [ -n "${2:-}" ] || { echo "Aufruf: sudo seb passwort name@schule.de"; exit 1; }
                 dc exec -T app node --disable-warning=ExperimentalWarning server/cli.js reset-password "$2";;
  admin)         [ -n "${2:-}" ] || { echo "Aufruf: sudo seb admin name@schule.de"; exit 1; }
                 dc exec -T app node --disable-warning=ExperimentalWarning server/cli.js make-admin "$2";;
  konten)        dc exec -T app node --disable-warning=ExperimentalWarning server/cli.js list-users;;
  *) cat <<HILFE
Schulentwicklungsboards – Verwaltung (immer mit sudo):
  seb status          Läuft alles? Zeigt die Adresse.
  seb update          Neueste Version holen und neu starten
  seb einstellungen   Einstellungen (.env) bearbeiten, z. B. E-Mail-Versand, Nextcloud
  seb neustart        App neu starten
  seb logs            Protokoll ansehen (Strg+C beendet)
  seb sicherung       Datensicherung jetzt erstellen (läuft auch täglich automatisch)
  seb code            Einrichtungscode anzeigen
  seb passwort MAIL   Neues Zufallspasswort für ein Konto setzen
  seb admin MAIL      Konto zur Administration machen
  seb konten          Alle Konten auflisten
HILFE
  ;;
esac
SEB
sed -i "s#__DIR__#$DIR#" "$BIN"
chmod 755 "$BIN"

# ---------------------------------------------------------------- Tägliche Sicherung
CRON="${SEB_CRON:-/etc/cron.d/schulentwicklungsboards}"
echo "15 2 * * * root $DIR/deploy/backup.sh >/dev/null 2>&1" > "$CRON"
chmod 644 "$CRON"

# ---------------------------------------------------------------- Starten
say "App bauen und starten (beim ersten Mal 1–3 Minuten) …"
if [ -n "$DRY" ]; then
  echo "[test] docker compose up -d --build"
else
  (cd "$DIR" && docker compose up -d --build --quiet-pull 2>&1 | tail -3)
  say "Warte auf HTTPS-Zertifikat für $DOMAIN …"
  ok=""
  for _ in $(seq 1 45); do
    if curl -fsS --max-time 5 "https://$DOMAIN/healthz" >/dev/null 2>&1; then ok=1; break; fi
    sleep 4
  done
  [ -n "$ok" ] || warn "Die Adresse antwortet noch nicht. Das Zertifikat kann ein paar Minuten dauern. Prüfen mit: sudo seb logs"
fi

# ---------------------------------------------------------------- Zusammenfassung
cat <<FERTIG

${green}${bold}Fertig!${reset}

  Adresse:            ${bold}https://$DOMAIN${reset}
  Einrichtungscode:   ${bold}${SETUP_CODE:-(bereits eingerichtet)}${reset}

So geht es weiter:
  1. Die Adresse im Browser öffnen.
  2. Mit dem Einrichtungscode das erste Konto anlegen – es wird Administration.
  3. Unter „Verwaltung“ prüfen, was noch fehlt (z. B. E-Mail-Versand).

Wichtig:
  • Einstellungen ändern:   sudo seb einstellungen
  • Neue Version holen:     sudo seb update
  • Alle Befehle:           sudo seb hilfe
  • Datensicherung läuft täglich um 2:15 Uhr. Zusätzlich die Datei $DIR/.env
    an einem sicheren Ort aufbewahren (enthält den geheimen Schlüssel).

FERTIG
