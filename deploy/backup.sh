#!/bin/sh
# Tägliche Sicherung per Cron, z. B.:  15 2 * * *  /opt/schulentwicklungsboards/deploy/backup.sh
# Sichert die Datenbank konsistent und löscht Sicherungen älter als 30 Tage.
set -eu
cd "$(dirname "$0")/.."
docker compose exec -T app node --disable-warning=ExperimentalWarning server/backup.js /data/backups
docker compose exec -T app find /data/backups -name 'boards-*.sqlite' -mtime +30 -delete
