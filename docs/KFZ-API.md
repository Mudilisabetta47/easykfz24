# kfz-api.de – Anbindung in EasyKFZ24 OS

Stand 12.10.2026, ergänzt 17.10.2026. Quellen: öffentliche Entwicklerseite `kfz-api.de/api/` (inkl. FAQ), Preisliste
`kfz-api.de/preise/` (Stand 29.09.2026) und – seit 17.10.2026 – die offizielle OpenAPI **API 2.3.0** und **Webhooks 3.1.0**
aus dem Dashboard. Automatische Übermittlung (Phase 1, Abmeldung): siehe [KFZ-UEBERMITTLUNG.md](KFZ-UEBERMITTLUNG.md).

## Zugang

| Punkt | Stand |
|---|---|
| Basisadresse | `KFZ_API_BASE_URL` = `https://api.kfz-api.de/dropshipping-api/10/2.3.0` (normale Variable im Worker) |
| Anmeldung | HTTP Basic mit API-Benutzer aus dem Dashboard (`KFZ_API_LOGIN`, `KFZ_API_PASSWORD`, Secrets) – laut FAQ; Server bestätigt `WWW-Authenticate: Basic realm="dropshipping-api"` |
| Pfade | relativ zur Basisadresse; Client entfernt einen abschließenden `/`, hängt Endpunkte genau einmal an (lokal in workerd geprüft) |
| Testumgebung | Separater **Sandbox-Zugang** im Dashboard (nach Partnervertrag; simulierte Vorgänge, keine echten Webhooks, eigene Zugangsdaten). Ob er die Abmeldung abbildet, ist öffentlich nicht beschrieben. Anträge über die produktiven Zugangsdaten gehen immer an das KBA. |
| Kosten | API „ohne Aufpreis“, keine Grundgebühr; Kosten **je Vorgang** (Abmeldung ab 6,35 €, Zulassung/Umschreibung ab 32,60 €, Adressänderung ab 22,40 €), je vom KBA abgewiesener Übermittlung 0,10 €, Signatur 6,95 €, Handelsregisterabgleich 4,99 € |
| Fehlerverfolgung | Antwort-Header `X-Trace-Id`; Fehlerkörper `{"error": "…", "traceId": "…"}` |

## Endpunkte und Nutzung in EasyKFZ24

| Endpunkt | Art | Kosten | In EasyKFZ24 |
|---|---|---|---|
| `GET /vehicleDeregistrations/orders?limit=1` | lesend („Erster Aufruf“, prüft Adresse und Anmeldung, legt nichts an) | keine | **aktiv** – „Verbindung prüfen“ im KFZ-API Center (nur Status + Trace-Id, protokolliert ohne Inhalte) |
| `GET /{prefix}/files/content/{fileAccessKey}` | lesend | keine | **aktiv** – Belege aus Webhooks im Auftrag öffnen (nur mit Recht, protokolliert) |
| `GET /{prefix}/orders` (Filter u. a. `externalId`, `changedSince`) | lesend | keine | Branch `feature/kfz-uebermittlung`: Klärung einer ungewissen Übermittlung (`externalId` exakt) |
| `GET /{prefix}/orders/{orderId}` | lesend | keine | Branch `feature/kfz-uebermittlung`: „Stand beim Partner abfragen“ nach verlorenem Webhook |
| `GET /serviceStatus`, `GET /health` | lesend | keine | nicht genutzt – Empfehlung: Störungsanzeige im KFZ-API Center |
| `GET /registrationOffices/{districtKey}/availability` | lesend | keine | nicht genutzt |
| `GET /powerOfAttorneys/{processId}` | lesend | keine | nicht genutzt |
| `POST /vehicleDeregistrations/deregistrations` (AB) | **schreibend, produktiv ans KBA** | ab 6,35 € netto / 6,73 € brutto | Branch `feature/kfz-uebermittlung`, Schalter `KFZ_UEBERMITTLUNG` (Vorgabe aus) – siehe KFZ-UEBERMITTLUNG.md |
| `POST /vehicleRegistrations/registrations` (NZ), `…/dayRegistrations` (TZ), `/vehicleTransfers/transfers` (UG), `/vehicleReRegistrations/reRegistrations` (WG), `…/sameHolderReRegistrations` (WZ), `/vehicleHolderChanges/holderChanges` (HA) | **schreibend, produktiv ans KBA** | je Vorgang | **gesperrt** (kein Code; Phase 2) |
| `POST /powerOfAttorneys` | schreibend (Vollmachts-/Signaturvorgang) | Signatur 6,95 €, ggf. 4,99 € | gesperrt |
| `POST /gksConfigurations` | Kontoeinstellung (eigener KoPa-Schlüssel) | – | nicht genutzt |

## Webhooks (aktiv)

- Empfang: `POST https://easykfz24.de/api/webhooks/kfz-api`; Signatur `X-Signature` = HMAC-SHA256 (hex) über den Rohtext
  mit `KFZ_API_WEBHOOK_SECRET`, zeitkonstanter Vergleich; ohne/mit falscher Signatur → 401, nichts gespeichert.
- Zustellung durch kfz-api.de bis zu 7-mal in ~31 Stunden mit gleicher `X-Event-Id` → bei uns als Dublette erkannt.
- Zuordnung (Webhooks 3.1.0): eigene Referenz einer automatischen Übermittlung, dann `attemptOf` (Auftrag, nicht
  `order.id` des Versuchs), dann `order.id`, zuletzt `order.externalId` = EasyKFZ24-Auftragsnummer; nicht zuordenbare
  Meldungen → KFZ-API Center „zu prüfen“ (manuell zuordnen, erneut verarbeiten).
- Status (alle dokumentierten Werte abgedeckt):

| kfz-api.de | Anzeige | Auftrag (automatisch, soweit Übergang erlaubt) |
|---|---|---|
| `ACCEPTED`, `FORWARDED` | in Bearbeitung | bei Zulassungsstelle |
| `APPROVED`, `APPROVED_WITH_DOCUMENTS` | abgeschlossen | zugelassen (+ Kennzeichen aus `licensePlate`, Belege aus `files[]`) |
| `REJECTED`, `REJECTED_WITH_DOCUMENTS` | Angaben erforderlich | Unterlagen fehlen (+ Aufgabe, Meldungen aus `messages[]`) |
| `FAILED` | fehlgeschlagen (`retryable` berücksichtigt); korrigierbare Ablehnungsart (falscher Code, Fahrzeug unbekannt …) → Angaben erforderlich | Hinweis, kein Rückschritt |
| `PROCESSED`, `UNKNOWN` | nach `derivedStatus` | wie oben |
| `derivedStatus` (11 Werte laut 3.1.0, u. a. `ERROR_UNHANDLED` = manuelle Prüfung, nicht erneut einreichen) | Ersatz bzw. Einordnung | wie oben |

## Automatische Übermittlung – Stand

Phase 1 (Abmeldung) ist auf dem Branch `feature/kfz-uebermittlung` umgesetzt (Punkte 1–3, 5–6 unten erledigt, 7 offen),
Details in [KFZ-UEBERMITTLUNG.md](KFZ-UEBERMITTLUNG.md). Die folgende Liste galt vor der Auswertung der Spezifikation und
bleibt für Phase 2 (übrige Vorgangsarten) maßgeblich.

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
