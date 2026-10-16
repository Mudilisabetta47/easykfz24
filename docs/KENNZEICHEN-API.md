# Eigenständige Kennzeichen-API – Prüfstand 16.10.2026

## Abgleich vor der Entwicklung

GitHub `main` stand auf `53a55a791c5f37517c616d05a1479c3d8030dc97`.
Die Produktion unter `https://easykfz24.de/api/version` meldete `commit: 53a55a791c5f`
und `builtAt: 2026-10-14T23:32:25.327Z`. Damit stimmen die veröffentlichten Code-Versionskennungen überein.
`/api/health` meldete `ok: true`, Schema/Erwartung 12, Plattform Cloudflare, D1 und Uploads verfügbar.
Die aktive Cloudflare-Version war `8d951ad8-f63f-4ae2-88a1-d1ab16266249` (15.10.2026,
15:52 UTC), laut Versionsmetadaten eine Änderung der Variable `BESTELLUNG_AKTIV` im Dashboard.
Das ist ein Nachweis der Code-Versionskennung, kein Vergleich sämtlicher Laufzeitvariablen mit GitHub.
Es wurden weder Variablen geändert noch Secrets ausgegeben.

## Anbietergrundlage

Geprüft wurde die bereits angemeldete Dokumentation:

- https://dashboard.kfz-api.de/docs/kennzeichen#eigenstaendige-kennzeichen-api
- https://dashboard.kfz-api.de/docs/referenz-api

Die neuen Wege verwenden dieselbe HTTP-Basic-Anmeldung und denselben Mandanten wie die bestehende KFZ-API.
Die alten `/licensePlateReservations/*`-Formate werden nicht verwendet.
Vollständige Kombinationen brauchen einen ausdrücklich ausgewählten Kreisschlüssel; das Kürzel allein genügt nicht.
Die Referenz beschreibt die Antworten der neuen Wege überwiegend als Text, ohne vollständiges Response-Schema.
Der Adapter validiert deshalb die benötigten Felder streng. Abweichende Anbieterformate werden gesperrt;
ein Live-Abgleich der Antwortformate ist vor einer späteren Kostenfreigabe noch erforderlich.
Es wurden in dieser Entwicklung keine Kennzeichen-Endpunkte des echten Anbieters aufgerufen.

## Umgesetztes Verhalten

- KFZ-API Center → Kennzeichen: Katalog laden, Behörde/Kürzel wählen, vollständige Kombination prüfen,
  behördenabhängige Privat-/Firmenfelder laden, Reservierungsentwurf speichern, Verlauf/Details ansehen.
- `POST /search` ist serverseitig angebunden, standardmäßig vor jedem Netzwerkzugriff gesperrt.
  Antworten werden dauerhaft unter ihrer Referenz gespeichert. AVAILABLE bestätigt nur Verfügbarkeit.
- `GET /bezirke` und `GET /bezirke/{ks}/anforderungen` werden auf ausdrückliche OS-Aktion geladen,
  eine Stunde zwischengespeichert und validiert. Fehlen aktuelle Anforderungen, bleibt der Entwurf gesperrt.
- Für `POST /reservations` entsteht ein validierter Payload mit echten Zustimmungsangaben als lokaler Entwurf.
  **Es gibt keinen ausführbaren Übermittlungsweg für neue Reservierungen.** Keine Schalterkombination aktiviert ihn.
- Bereits extern bestehende Vorgänge lassen sich über ihre jobId importieren und anschließend per
  `GET /reservations/{jobId}` aktualisieren. Das ist ein Abruf bestehender Reservierungen, keine Neuanlage.
  Nur `reserved` mit einer nichtleeren PIN-Zeichenkette wird übernommen; führende Nullen bleiben erhalten.
- Der öffentliche Konfigurator zeigt die passenden Behörden und vorhandene Pflichtfeldinformationen aus dem Cache.
  Seine Behördenauswahl ist informativ und ersetzt keine spätere verbindliche Zuständigkeitsprüfung.
  Besucher lösen keine externen Metadaten-, Such- oder Reservierungsaufrufe aus.
  Bestehende Vorschlags- und Bestellfunktionen bleiben erhalten. Die bisherige optionale externe
  Verfügbarkeitsanbindung bleibt unverändert; sie wird nicht auf die kostenpflichtige neue API umgeleitet.

## Rechte, Referenzen und Kosten

Der bestehende OS-Router prüft Sitzung, Rechte und bei POST Same-Origin/JSON.
Listen benötigen `kfz.read`, Aktionen `kfz.write`; Entwürfe zusätzlich `customers.write`,
Halterdetails/PINs zusätzlich `customers.read`. Übersichten enthalten weder Halterdaten noch PINs.
Relevante Zugriffe werden ohne diese Inhalte protokolliert. Es werden keine Zahlungs- oder Freigabefelder geändert.

Jeder neue Such-/Reservierungsentwurf benötigt eine 8–120 Zeichen lange Idempotenzreferenz.
Referenzen sind eindeutig und an Benutzer, Operation, Providerkonto und normalisierte Angaben gebunden.
Geänderte Angaben unter derselben Referenz führen zu 409. Ein neuer bewusster Check benötigt eine neue Referenz.
Bei Netzfehlern bleibt die ursprüngliche Referenz erhalten, auch im OS-Verlauf nach Browser-Neustart.
Eine nach 30 Sekunden verwaiste Worker-Anfrage kann mit derselben Referenz fortgesetzt werden.
Es gibt keine automatischen kostenpflichtigen Wiederholungen und kein Hintergrundpolling beim Anbieter.

Datenbankgestützte, atomare Limits: 10 Aktionen/Minute je Benutzer und 60 insgesamt;
zusätzlich höchstens ein Metadatenabruf je Ressource/Minute. Alte Minutenstände werden entfernt.
429-Antworten enthalten `Retry-After: 60` (bei ausgeschöpftem Tagesbudget ist zusätzlich Budget nötig).

Nur eine spätere ausdrückliche Kostenfreigabe darf beide **neuen** serverseitigen Werte setzen:
`KENNZEICHEN_SEARCH_ENABLED=1` und ein positives `KENNZEICHEN_DAILY_BUDGET_CENT` von mindestens 10.
In diesem PR und in der Produktion wurden diese Werte nicht gesetzt.
Jede erste Abfrage bindet vor dem Netzwerk atomar 10 Cent im globalen Tagesbudget (UTC-Tagesgrenze).
Gleiche Referenzen binden kein weiteres Budget. Fehler/UNKNOWN geben den Betrag vorsorglich nicht frei.
Katalogpreise über 10 Cent je Abfrage oder eine Grundgebühr sperren die Suche.
Die Anbieterabrechnung bleibt maßgeblich; das interne Budget ist eine konservative Obergrenze,
keine Rechnung. Reservierungsentwürfe und Cache-Zugriffe kosten intern 0 Cent.

Authentifizierung nutzt ausschließlich `KFZ_API_BASE_URL`, `KFZ_API_LOGIN`, `KFZ_API_PASSWORD` auf dem Server.
Die URL muss auf `https://api.kfz-api.de/dropshipping-api/{Mandant}/2.3.0` zeigen;
Weiterleitungen sind verboten, Anfragezeit auf 10 Sekunden begrenzt, Anbieterfehler werden bereinigt.
PINs/Halterdaten liegen wie die übrigen OS-Daten in D1; kein Export in öffentliche Endpunkte oder Serverlogs.
Es gibt noch keine automatische Löschfrist für eigenständige Kennzeichenentwürfe; vor dem Livebetrieb
muss deren betriebliche Aufbewahrung und Löschung festgelegt werden.

## Datenbank und spätere Inbetriebnahme

Schema 13 ergänzt vier eigene Tabellen und drei Indizes. Bestehende Tabellen und Daten werden nicht verändert.
Die Schema-12-Migration wurde mit einem Bestandsauftrag, Dokument und unveränderten Zahlungs-/Freigabefeldern getestet.
Ein späteres Deployment würde diese additive Migration über den vorhandenen Migrationsmechanismus ausführen.
**Weder Migration noch Deployment wurden in der Produktion ausgeführt.**

Vor späterer Freigabe: Backup/Deployment gesondert genehmigen, kostenlose Metadaten im OS gegen das
Anbieterformat prüfen, Aufbewahrung klären und einen ausdrücklich genehmigten Suchbetrag festlegen.
Neue echte Reservierungen erfordern eine separate spätere Implementierung und Freigabe.
Mollie-Schalter, Checkout-Freigaben und deren bestehende Prüfungen bleiben unverändert.

## Validierung

- `npm run typecheck`: bestanden.
- `npm test`: **318/318**, darunter 21 neue Kennzeichenfälle und Migration 12 → 13.
- `npm run build`: Next.js und OpenNext-Cloudflare-Worker erfolgreich gebaut.
- `npm run test:e2e`: **71/71 auf Node und 71/71 auf lokalem Cloudflare workerd**, 128 OS-Endpunkte.
  Keine unerwarteten 5xx. Externe Dienste sind abgeschaltet oder lokal nachgebildet.
- Die neuen Unit-Tests ersetzen fetch vollständig. Keine echten Kennzeichensuchen oder Reservierungen.
- `git diff --check`: bestanden.
- Manuelle Browserprüfung: lokale Anmeldung/OS-Desktop erreicht; die weitere Sichtprüfung wurde durch eine
  unterbrochene Browserverbindung verhindert. Formular- und responsive Sichtprüfung bleiben vor Livegang offen.

Der Build meldet vorhandene OpenNext-Hinweise zu doppelten Zahlenschlüsseln in den generierten
FE-Schriftumrissen; er beendet sich erfolgreich. Diese Schriftdatei wurde nicht verändert.
