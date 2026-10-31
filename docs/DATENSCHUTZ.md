# Hinweise für Datenschutz und Freigabe

Diese Hinweise unterstützen Schulleitung und Datenschutzbeauftragte bei der Dokumentation. Sie ersetzen keine rechtliche Prüfung im Einzelfall und keine landesrechtlichen Vorgaben.

## Grundsätze der Umsetzung

- **Selbst gehostet**, keine Verbindung zu Drittanbietern: keine CDNs, keine externen Schriftarten, kein Tracking, keine Analyse. Eine strikte Content-Security-Policy erzwingt das im Browser.
- **Nur technisch notwendiges Cookie** (Sitzung, HttpOnly, SameSite=Lax, Secure). Ein Cookie-Banner ist dafür nicht erforderlich (§ 25 Abs. 2 TDDDG).
- **Dateien bleiben in der Nextcloud** der Schule; die App speichert nur Verweise (Name, Pfad, Datei-ID, Größe).
- **Kein Zugriff auf Nextcloud-Passwörter**: Anmeldung per Login Flow, die App erhält ein widerrufbares App-Passwort, das verschlüsselt (AES-256-GCM) gespeichert wird.
- **Passwörter** der App werden mit scrypt gehasht.
- **Keine Zugriffsprotokolle mit IP-Adressen** im mitgelieferten Caddy-Setup. Fehlermeldungen des Servers enthalten keine Inhalte.
- **Datenübertragbarkeit und Löschung**: JSON-Export je Board; Boards und Karten können endgültig gelöscht werden; Nutzende können ihr Konto selbst löschen.

## Welche Daten werden verarbeitet?

| Kategorie | Daten | Zweck |
|---|---|---|
| Konto | Name, dienstliche E-Mail, Passwort-Hash, Erstellungsdatum | Anmeldung, Zuordnung |
| Sitzung | zufälliges Token (gehasht gespeichert), Ablaufdatum | angemeldet bleiben |
| Nextcloud-Verbindung | Server-Adresse, Loginname, Nextcloud-Benutzer-ID, Anzeigename, App-Passwort (verschlüsselt) | Dateiauswahl, Board-Ordner |
| Inhalte | Boards, Listen, Karten, Beschreibungen, Checklisten, Kommentare, Termine, Zuständigkeiten, Verweise auf Dateien | Projektarbeit |
| Einladungen | eingeladene E-Mail-Adresse, Rolle, einladende Person, Ablaufdatum, Token (gehasht) | Board-Beitritt per Link |
| Protokoll | wer hat wann was an Board/Karte geändert | Nachvollziehbarkeit in der Gruppe |

Betroffene: Lehrkräfte und ggf. weiteres Schulpersonal. **Empfehlung:** In Boards keine personenbezogenen Daten von Schülerinnen und Schülern oder besondere Kategorien (Art. 9 DSGVO) ablegen – dafür sind die Verfahren der Schule (z. B. Schulverwaltungssoftware) vorgesehen. Auswertungs-Rohdaten (z. B. aus Befragungen) nur in entsprechend geschützten Nextcloud-Ordnern speichern.

## Checkliste für die Inbetriebnahme

- [ ] Hosting-Standort Deutschland, AVV mit dem Hoster (bzw. Betrieb durch Schulträger)
- [ ] Eintrag im **Verzeichnis der Verarbeitungstätigkeiten** (Zweck: Organisation von Schulentwicklungsvorhaben; Rechtsgrundlage nach Landesschulrecht / Art. 6 Abs. 1 lit. e DSGVO bzw. Dienstvereinbarung)
- [ ] Ggf. Beteiligung des **Personalrats** (Möglichkeit der Leistungs- und Verhaltenskontrolle durch Aktivitätsprotokoll)
- [ ] **Löschkonzept** festlegen, z. B. abgeschlossene Boards nach Export ins Schularchiv nach X Jahren löschen; Konten ausgeschiedener Personen löschen
- [ ] Registrierung auf Schul-Domain begrenzen (`REGISTRATION_EMAIL_DOMAINS`) oder schließen
- [ ] Für Einladungsmails den Mailserver der Schule / des Schulträgers verwenden (`SMTP_*`)
- [ ] Nextcloud-Allowlist setzen (`NEXTCLOUD_ALLOWED_HOSTS`)
- [ ] Sicherungen eingerichtet und Wiederherstellung einmal getestet
- [ ] Datenschutzhinweise für Nutzende bereitgestellt (Vorlage: Tabelle oben)
