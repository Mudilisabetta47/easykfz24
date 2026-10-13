# kfz-api.de – Anbindung in EasyKFZ24 OS

Stand 12.10.2026. Quellen: öffentliche Entwicklerseite `kfz-api.de/api/` (inkl. FAQ) und Preisliste
`kfz-api.de/preise/` (Stand 29.09.2026). Die vollständige Doku (`api.kfz-api.de/docs`, Pflichtfelder je Vorgang,
Meldungscodes, OpenAPI) liegt hinter dem Dashboard-Login und ist hier **nicht** ausgewertet.

## Zugang

| Punkt | Stand |
|---|---|
| Basisadresse | `KFZ_API_BASE_URL` = `https://api.kfz-api.de/dropshipping-api/10/2.3.0` (normale Variable im Worker) |
| Anmeldung | HTTP Basic mit API-Benutzer aus dem Dashboard (`KFZ_API_LOGIN`, `KFZ_API_PASSWORD`, Secrets) – laut FAQ; Server bestätigt `WWW-Authenticate: Basic realm="dropshipping-api"` |
| Pfade | relativ zur Basisadresse; Client entfernt einen abschließenden `/`, hängt Endpunkte genau einmal an (lokal in workerd geprüft) |
| Testumgebung | **keine** – gültige Anträge gehen produktiv ans KBA; Test laut Anbieter nur mit lesenden Aufrufen und Webhook-PING |
| Kosten | API „ohne Aufpreis“, keine Grundgebühr; Kosten **je Vorgang** (Abmeldung ab 6,35 €, Zulassung/Umschreibung ab 32,60 €, Adressänderung ab 22,40 €), je vom KBA abgewiesener Übermittlung 0,10 €, Signatur 6,95 €, Handelsregisterabgleich 4,99 € |
| Fehlerverfolgung | Antwort-Header `X-Trace-Id`; Fehlerkörper `{"error": "…", "traceId": "…"}` |

## Endpunkte und Nutzung in EasyKFZ24

| Endpunkt | Art | Kosten | In EasyKFZ24 |
|---|---|---|---|
| `GET /vehicleDeregistrations/orders?limit=1` | lesend („Erster Aufruf“, prüft Adresse und Anmeldung, legt nichts an) | keine | **aktiv** – „Verbindung prüfen“ im KFZ-API Center (nur Status + Trace-Id, protokolliert ohne Inhalte) |
| `GET /{prefix}/files/content/{fileAccessKey}` | lesend | keine | **aktiv** – Belege aus Webhooks im Auftrag öffnen (nur mit Recht, protokolliert) |
| `GET /{prefix}/orders` (Filter u. a. `changedSince`) | lesend | keine | nicht genutzt – Empfehlung: Abgleich verpasster Webhooks |
| `GET /{prefix}/orders/{orderId}` | lesend | keine | nicht genutzt – Empfehlung: „Vorgangsauskunft“ im Auftrag |
| `GET /serviceStatus`, `GET /health` | lesend | keine | nicht genutzt – Empfehlung: Störungsanzeige im KFZ-API Center |
| `GET /registrationOffices/{districtKey}/availability` | lesend | keine | nicht genutzt |
| `GET /powerOfAttorneys/{processId}` | lesend | keine | nicht genutzt |
| `POST /vehicleRegistrations/registrations` (NZ), `…/dayRegistrations` (TZ), `/vehicleTransfers/transfers` (UG), `/vehicleReRegistrations/reRegistrations` (WG), `…/sameHolderReRegistrations` (WZ), `/vehicleHolderChanges/holderChanges` (HA), `/vehicleDeregistrations/deregistrations` (AB) | **schreibend, produktiv ans KBA** | je Vorgang | **gesperrt** (kein Code, `submission.enabled: false`) |
| `POST /powerOfAttorneys` | schreibend (Vollmachts-/Signaturvorgang) | Signatur 6,95 €, ggf. 4,99 € | gesperrt |
| `POST /gksConfigurations` | Kontoeinstellung (eigener KoPa-Schlüssel) | – | nicht genutzt |

## Webhooks (aktiv)

- Empfang: `POST https://easykfz24.de/api/webhooks/kfz-api`; Signatur `X-Signature` = HMAC-SHA256 (hex) über den Rohtext
  mit `KFZ_API_WEBHOOK_SECRET`, zeitkonstanter Vergleich; ohne/mit falscher Signatur → 401, nichts gespeichert.
- Zustellung durch kfz-api.de bis zu 7-mal in ~31 Stunden mit gleicher `X-Event-Id` → bei uns als Dublette erkannt.
- Zuordnung: `order.externalId` = EasyKFZ24-Auftragsnummer, sonst verknüpfte kfz-api-Vorgangsnummer (`order.id`);
  nicht zuordenbare Meldungen → KFZ-API Center „zu prüfen“ (manuell zuordnen, erneut verarbeiten).
- Status (alle dokumentierten Werte abgedeckt):

| kfz-api.de | Anzeige | Auftrag (automatisch, soweit Übergang erlaubt) |
|---|---|---|
| `ACCEPTED`, `FORWARDED` | in Bearbeitung | bei Zulassungsstelle |
| `APPROVED`, `APPROVED_WITH_DOCUMENTS` | abgeschlossen | zugelassen (+ Kennzeichen aus `licensePlate`, Belege aus `files[]`) |
| `REJECTED`, `REJECTED_WITH_DOCUMENTS` | Angaben erforderlich | Unterlagen fehlen (+ Aufgabe, Meldungen aus `messages[]`) |
| `FAILED` | fehlgeschlagen (`retryable` berücksichtigt) | Hinweis, kein Rückschritt |
| `derivedStatus` `PENDING`/`SUCCESS`/`FAILURE` | Ersatz, wenn `status` fehlt | wie oben |

## Spätere automatische Übermittlung – was noch fehlt

Zuordnung der Leistungen: Abmeldung → AB · Halterwechsel → UG · Umzug → HA (gleicher Bezirk) bzw. UG ·
Wiederzulassung → WG/WZ · Neuzulassung → NZ.

Vor einer Freischaltung nötig:

1. **Vollständige Doku** hinter dem Login auswerten (Pflichtfelder je Vorgangsart, Meldungscodes).
2. **Sicherheitscodes als Werte erfassen**: Das öffentliche Beispiel (AB) verlangt `vehicleRegistrationCertificateSecurityCode`,
   `frontLicensePlateSecurityCode`, `rearLicensePlateSecurityCode`. EasyKFZ24 speichert die Codes bisher bewusst **nicht**
   (nur „bestätigt“) – nötig wäre eine verschlüsselte, kurzlebige Ablage (nach Übermittlung löschen).
3. **Vertragspartnernummer** (`contractPartner`), Pflicht ohne eigenen KoPa-Schlüssel.
4. **Vollmacht/Signatur** für Zulassung/Umschreibung/HA (`/powerOfAttorneys`, kostenpflichtig) klären.
5. **Doppelantragsschutz** nutzen: `externalOrderId` = Auftragsnummer (kfz-api.de legt bei gleicher ID + FIN binnen
   15 Min. keinen zweiten Auftrag an).
6. **Auslöser** nur nach Freigabe im OS (bestehender Ablauf „Zur Übermittlung freigeben“ mit Prüfungen), je Auftrag
   einzeln, mit Kostenanzeige und Bestätigung; kein automatischer Versand.
7. **Ausdrückliche Produktivfreigabe** durch den Inhaber.

## Protokollierung

- Verbindungstest: Protokoll `kfz.verbindungstest` mit nur `ok/fehler` + HTTP-Status; Trace-Id in der Antwort.
- Webhook-Abweisung: Log nur mit Grund und Event-Id (kein Rumpf, keine Kundendaten).
- Zugangsdaten erscheinen nie in Antworten, Protokoll oder Logs (geprüft: Worker-Log, Audit, ausgelieferte JS-Dateien).
