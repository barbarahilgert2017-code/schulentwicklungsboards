# Nextcloud-Anbindung

## 1. Verbinden (Login Flow v2)

Unter **Konto → Mit Nextcloud verbinden**:

1. Die App ruft `POST <nextcloud>/index.php/login/v2` auf und erhält eine Anmelde-URL und ein Abfrage-Token.
2. Im Browser öffnet sich die Nextcloud-Anmeldeseite. Dort meldet man sich wie gewohnt an (inkl. SSO/2FA) und klickt **Zugriff gewähren**.
3. Die App fragt im Hintergrund den Poll-Endpunkt ab und erhält Loginname + **App-Passwort**.
4. Das App-Passwort wird mit AES-256-GCM (Schlüssel aus `APP_SECRET`) verschlüsselt gespeichert.

Das App-Passwort erscheint in Nextcloud unter *Einstellungen → Sicherheit → Geräte & Sitzungen* (Name: `NEXTCLOUD_CLIENT_NAME`) und kann dort jederzeit widerrufen werden. **Verbindung trennen** in der App widerruft es ebenfalls (`DELETE /ocs/v2.php/core/apppassword`).

Voraussetzung: Nextcloud ≥ 16, erreichbar über HTTPS. Die App muss die Nextcloud über das Netz erreichen können.

## 2. Dateiauswahl

Im Karten-Dialog **Anhänge → Aus Nextcloud**:

- Reiter **Board-Ordner**: durchsucht den verknüpften Board-Ordner (für alle Mitglieder des Boards nutzbar)
- Reiter **Meine Nextcloud**: durchsucht die eigene Nextcloud (nur mit eigener Verbindung)

Die App speichert nur Name, Pfad, Größe, Typ und die Datei-ID. Der Link `…/index.php/f/<fileid>` öffnet die Datei in Nextcloud – Zugriff haben dort nur Personen, die die Datei in Nextcloud sehen dürfen. **Es werden keine Dateiinhalte auf dem App-Server gespeichert.**

## 3. Board-Ordner

- **Beim Anlegen eines Boards**: Option „Board-Ordner in Nextcloud anlegen“ erstellt `NEXTCLOUD_BASE_FOLDER/<Boardtitel>` (bei Namensgleichheit `… (2)`) und die Unterordner der Vorlage (z. B. *Protokolle*, *Konzepte*, *Evaluation*).
- **Nachträglich**: Board-Menü → *Nextcloud-Ordner* → neu anlegen oder vorhandenen Ordner wählen (nur *Verantwortliche*).
- **Hochladen**: Im Karten-Dialog „Hochladen“ oder Dateien in den Anhang-Bereich ziehen. Die Datei wird direkt per WebDAV in den Board-Ordner gestreamt und an die Karte gehängt.
- **Teilen**: *Mit Mitgliedern teilen* legt in Nextcloud Benutzerfreigaben für alle Board-Mitglieder an, die dieselbe Nextcloud verbunden haben (Lesende: nur lesen, sonst lesen/schreiben).

**Wichtig – über wessen Konto?** Ein Board-Ordner gehört zur Nextcloud der Person, die ihn verknüpft hat. Board-Mitglieder mit Bearbeitungsrecht können über die App Dateien in *diesen* Ordner hochladen und ihn durchsuchen – die App nutzt dafür das App-Passwort der verknüpfenden Person, aber ausschließlich innerhalb des Board-Ordners (Pfadprüfung serverseitig). Trennt diese Person ihre Nextcloud, ist der Ordner nicht mehr erreichbar und muss neu verknüpft werden. Empfehlung: Board-Ordner von einem Funktionskonto (z. B. „Steuergruppe“) oder von der Board-Leitung verknüpfen lassen.

## 4. Sicherheit

- **Allowlist**: `NEXTCLOUD_ALLOWED_HOSTS=cloud.meine-schule.de` beschränkt die Anbindung auf die Schul-Nextcloud (empfohlen).
- Ohne Allowlist werden Adressen in privaten Netzen (127.0.0.0/8, 10.0.0.0/8, 192.168.0.0/16 …) abgelehnt (Schutz vor SSRF). Für eine Nextcloud im internen Netz: Host in die Allowlist eintragen.
- Weiterleitungen werden nicht verfolgt; Login- und Poll-URLs müssen zur angegebenen Nextcloud gehören.
- Nur HTTPS (außer `NEXTCLOUD_ALLOW_INSECURE_HTTP=true` für Tests).

## Verwendete Schnittstellen

| Zweck | Schnittstelle |
|---|---|
| Anmeldung | `POST /index.php/login/v2`, Poll-Endpunkt |
| Benutzer-ID ermitteln | `GET /ocs/v2.php/cloud/user` |
| Ordner auflisten / Datei prüfen | `PROPFIND /remote.php/dav/files/<user>/…` |
| Ordner anlegen | `MKCOL` |
| Hochladen | `PUT` |
| Ordner teilen | `POST /ocs/v2.php/apps/files_sharing/api/v1/shares` |
| Abmelden | `DELETE /ocs/v2.php/core/apppassword` |
