# Automatische Übermittlung an kfz-api.de – Phase 1: Abmeldung (AB)

Stand 17.10.2026. Code auf `main` veröffentlicht, **Funktion ausgeschaltet** (`KFZ_UEBERMITTLUNG` nicht gesetzt). Standardmäßig AUS.

## Quellen

- Offizielle OpenAPI-Spezifikation **API 2.3.0** (`spec/api.yaml`) und **Webhooks 3.1.0** (`spec/webhooks.yaml`) aus dem
  Dashboard – vollständig ausgewertet. Es werden nur dort beschriebene Endpunkte, Felder und Formate verwendet.
- Öffentliche Seiten `kfz-api.de/api/` (inkl. FAQ), `kfz-api.de/preise/` (Stand 29.09.2026), `kfz-api.de/kontakt/`.
- Die Doku hinter dem Login (`dashboard.kfz-api.de/docs`) konnte nicht gelesen werden (Anmeldung nötig).

## Verwendete Endpunkte

| Endpunkt | Zweck | Kosten |
|---|---|---|
| `POST /vehicleDeregistrations/deregistrations` | Antrag auf Außerbetriebsetzung – geht an das KBA, nicht rückholbar | ab 6,35 € netto (siehe unten) |
| `GET /vehicleDeregistrations/orders?externalId=…&businessTransaction=AB` | Klärung einer ungewissen Übermittlung (exakter Treffer auf die eigene Referenz) | keine |
| `GET /vehicleDeregistrations/orders/{orderId}` | Abgleich nach verlorenem Webhook („Stand beim Partner abfragen“) | keine |

## Antragsrumpf (Schema `VehicleDeregistrationRequest`)

```json
{
  "externalOrderId": "EK-2026-00001-AB1",
  "email": "kundenservice@easykfz24.de",
  "customization": {
    "productType": "VEHICLE_DEREGISTRATION",
    "licensePlateNumberComponents": { "usageType": "EURO", "city": "HB", "middle": "EK", "end": "12" },
    "frontLicensePlateSecurityCode": "•••",
    "rearLicensePlateSecurityCode": "•••",
    "vehicleIdentificationNumber": "WVWZZZ…",
    "vehicleRegistrationCertificateSecurityCode": "•••",
    "licensePlateReservationIncluded": false,
    "contractPartner": "U……"
  }
}
```

- `usageType` aus dem Kennzeichen selbst (Endung E → `ELECTRIC`, H → `HISTORIC`); passt es nicht zu den Fahrzeugangaben,
  wird nicht geraten, sondern die Übermittlung gesperrt.
- Vorderer Plakettencode nur bei zwei Kennzeichenschildern (laut Spezifikation bei einem Schild unzulässig); die Zahl der
  Schilder bestätigt der Mitarbeiter bei der Erfassung ausdrücklich.
- Nicht gesendet: `vehicleHolder` (wird laut Spezifikation nicht an das KBA übermittelt), `recycling`,
  `vehicleRegistrationCertificatePartII`, `vehicleRegistrationCertificateNumber`, `gksConfigurationId`, `correctionOf`.
- Gespeichert wird nur der Rumpf **ohne** Codes (`•••`).

## Geprüfte Punkte

| Punkt | Ergebnis | Quelle |
|---|---|---|
| Vertragspartnernummer | **Pflicht** ohne eigenen KoPa-Schlüssel: genau die am Konto hinterlegte Nummer (Dashboard „Vertragspartner“, eingetragen von kfz-api.de), sonst 403. Das Schema nennt sie bei der AB zwar „optional“, die öffentliche Entwicklerseite und die 403-Beschreibung verlangen sie. Ohne `KFZ_VERTRAGSPARTNER` sendet EasyKFZ24 nichts. **Die Nummer selbst ist uns nicht bekannt** – im Dashboard ablesen. | `kfz-api.de/api/` („ohne eigenen KoPa-Schlüssel Pflicht“), `spec/api.yaml` ContractPartner, 403 NichtFreigegeben |
| Sandbox (nicht weiter verfolgt, kein Sandbox-Test) | Es gibt sie: separater Sandbox-Zugang im Dashboard nach Partnervertrag, simulierte Vorgänge ohne Behördenantrag, **keine echten Webhooks**, eigene Zugangsdaten. **Ob sie den Abmelde-Endpunkt abbildet, ist öffentlich nicht beschrieben** und in `spec/api.yaml` nicht erwähnt. Der Satz „Sie arbeiten ausschließlich in der Produktion“ in der Spezifikation betrifft nur die KBA-Umgebung eines eigenen KoPa-Zugangs (`/gksConfigurations`). | FAQ `kfz-api.de/api/`, `kfz-api.de/kontakt/` |
| Gebühren AB (ohne eigenen KoPa-Schlüssel) | Leistung kfz-api.de **2,00 € netto** zzgl. 19 % USt (0,38 €); amtliche Gebühren ohne Aufschlag und ohne USt: Amtsgebühr ab 3,30 €, KBA-Gebühr 0,70 €, Abwicklungsgebühr 0,35 €. **Summe ab 6,35 € netto = ab 6,73 € brutto.** Leistung nur bei Erfolg; je vom KBA abgewiesener Übermittlung **0,10 € netto (0,12 € brutto)**. Amtsgebühren je Behörde verschieden („ab“), maßgeblich ist die monatliche Sammelrechnung. | `kfz-api.de/preise/` (Stand 29.09.2026) |
| E-Mail im Antrag | Pflichtfeld, **Bedeutung nicht abschließend dokumentiert** (Spezifikation ohne Beschreibung, Beispiele zeigen `kunde@example.de`). EasyKFZ24 sendet die eigene, über `KFZ_UEBERMITTLUNG_EMAIL` konfigurierbare Service-Adresse; eine Kunden-E-Mail wird nie automatisch eingesetzt. Keine Rückfrage beim Partner (Vorgabe des Inhabers). | `spec/api.yaml` (ohne Beschreibung) |
| Codes bei ungewissem Stand | Bleiben verschlüsselt erhalten, solange eine Übermittlung `sendet`, `ungewiss` oder `Konflikt` ist: nicht löschbar, nicht änderbar, nicht von der 30-Tage-Löschung erfasst; Höchstfrist 90 Tage ab Erfassung (dann Löschung mit Verlaufsvermerk). Nach Klärung „angenommen“ sofort gelöscht, nach „nicht angelegt“ für die Wiederholung mit derselben Referenz verfügbar. | Code + Tests |

## Ablauf und Schutz

1. **Schalter** `KFZ_UEBERMITTLUNG`: `aus` (Vorgabe) · `test` (nur Inhaber, nur ein einzeln freigegebener echter Auftrag,
   24 h, eine Übermittlung) · `aktiv` (Recht „KFZ-API bearbeiten“). Zusätzlich nötig: Partnerzugang, `KFZ_CODES_KEY`,
   `KFZ_VERTRAGSPARTNER`.
2. **Voraussetzungen**: Abmeldung, kein Testauftrag, nicht storniert, interne Freigabe (alle bestehenden Prüfungen),
   bezahlt, keine Sperre durch die Widerrufsfrist, nicht manuell verknüpft, Codes erfasst und lesbar.
3. **Codes**: Eingabe nur schreibend im OS, AES-256-GCM (WebCrypto) mit `KFZ_CODES_KEY`, Zusatzdaten binden den
   Geheimtext an Auftrag und Zweck. Nie in Antworten, Verlauf, Audit, Protokoll oder gespeichertem Rumpf. Fehlertexte des
   Partners werden vor dem Speichern um die Codewerte bereinigt.
4. **Vorschau** mit allen Angaben, Kosten und Hinweisen und einer SHA-256-Prüfsumme über den gesendeten Rumpf (Codes nur
   über Datensatz und Geheimtext, nicht im Klartext – dreistellige Codes ließen sich sonst zurückrechnen). Senden nur mit
   dieser Prüfsumme und Häkchen.
5. **Datensatz vor dem Senden** (`kfz_submissions`), eindeutige Referenz `<Auftrag>-AB<Versuch>`, höchstens ein laufender
   Versuch je Auftrag (eindeutiger Index) → Doppelklick und parallele Aufrufe senden genau einmal.
6. **Antwort**:
   - 200 mit `order.id` → `angenommen`: Vorgangsnummer am Auftrag, Codes gelöscht, Status „bei Zulassungsstelle“.
   - 400/401/403/413/415/503 mit Fehlerrumpf → `abgewiesen` (laut Spezifikation nichts angelegt, nichts an das KBA);
     Wiederholung mit derselben Referenz.
   - 409 → `Konflikt` (gleiche Referenz und FIN, andere Daten; nichts geändert).
   - 500, Gateway-Fehler, Zeitüberschreitung, Abbruch, Unlesbares → `ungewiss` (500 sagt laut Spezifikation nicht,
     ob etwas angelegt wurde).
7. **Keine automatische Wiederholung.** „Stand klären“ fragt die Auftragsliste exakt nach der Referenz ab: ein Treffer →
   angenommen; keiner (frühestens 2 Minuten nach dem Senden) → `nicht angelegt`, danach erneut senden mit derselben
   Referenz; mehrere → manuell. Ein Treffer zu einer **anderen FIN** wird nie übernommen (manuell). Ein hängengebliebenes
   „sendet“ gilt nach 2 Minuten als ungewiss, nie als „nicht gesendet“.
8. **Gegenseitiger Ausschluss**: Manuelle Verknüpfung (und deren Lösen) ist gesperrt, solange eine automatische
   Übermittlung läuft oder angenommen ist; die automatische Übermittlung ist gesperrt, wenn manuell verknüpft wurde.
   Die Freigabe ist nicht zurücknehmbar, solange eine Übermittlung offen ist. Wird zwischen Prüfung und Datensatz parallel
   manuell verknüpft, wird nicht gesendet.
10. **Löschung der Codes außerdem** sofort bei Storno (`actStatus`) und bei der Anonymisierung eines Kunden bzw.
   Testauftrags (außer eine Übermittlung ist noch ungeklärt – dann Höchstfrist 90 Tage).
9. **Korrekturen** (`correctionOf`) sind in Phase 1 nicht automatisiert: Die 15-Minuten-Regel des Doppelschutzes macht
   eine Korrektur unter derselben Referenz mehrdeutig. Korrekturen erfolgen im Partner-Dashboard; die Ereignisse dazu
   ordnet EasyKFZ24 über `attemptOf` zu.

## Webhooks (angepasst an 3.1.0)

- Zuordnung: zuerst eigene Referenz (`order.externalId` = `externalOrderId` einer Übermittlung), dann **`attemptOf`**
  (Auftrag), dann `order.id`, zuletzt die Auftragsnummer (manuell im Dashboard gestellte Anträge). Am Auftrag steht immer
  der Auftragskopf (`attemptOf`), nicht die Versuchs-Id.
- Neue Werte: `status` `PROCESSED`, `UNKNOWN`; `derivedStatus` `VEHICLE_UNKNOWN`, `VEHICLE_ALREADY_DEREGISTERED`,
  `LICENSE_PLATE_CODE_INVALID`, `REGISTRATION_CERTIFICATE_CODE_INVALID`, `LICENSE_PLATE_CODE_QTY_INVALID`,
  `INPUT_INVALID`, `RESERVATION_IMPOSSIBLE`, `ERROR_UNHANDLED`.
- `FAILED` mit korrigierbarer Ablehnungsart → „Angaben erforderlich“; `ERROR_UNHANDLED` (nur AB: manuelle Prüfung, nicht
  erneut einreichen) und `VEHICLE_ALREADY_DEREGISTERED` → „fehlgeschlagen“; Klartext je Art im Verlauf.
- `messages[]` mit `kind` und `additional`; `applicationId` (KBA-Antragsnummer) im Verlauf.
- Ereignisse eines **älteren Versuchs**, die nach einem jüngeren eintreffen (Zustellung ohne garantierte Reihenfolge), ändern
  den Stand nicht und lösen keine Kundenmail aus; sie werden nur im Verlauf vermerkt.
- Intern zu klärende Ablehnungsarten (`ERROR_UNHANDLED`, `RESERVATION_IMPOSSIBLE`, `INPUT_INVALID`): Stand und
  Benachrichtigung für Mitarbeiter, **keine automatische Kundenmail**.

## Umgebung

| Variable | Art | Bedeutung |
|---|---|---|
| `KFZ_UEBERMITTLUNG` | Variable | `aus` (Vorgabe) · `test` · `aktiv` – setzt nur der Inhaber im Cloudflare-Dashboard |
| `KFZ_CODES_KEY` | **Secret** | 32 Byte Base64 (`openssl rand -base64 32`); ein Wechsel macht erfasste Codes unlesbar (neu erfassen) |
| `KFZ_VERTRAGSPARTNER` | Variable | Vertragspartnernummer laut Dashboard (`U/B/S` + 6 Ziffern) – Pflicht |
| `KFZ_UEBERMITTLUNG_EMAIL` | Variable, optional | E-Mail im Antrag; Vorgabe `kundenservice@easykfz24.de` |

## Datenbank (Migration v14, nur neue Tabellen)

- `order_secrets`: Geheimtext, IV, Schlüsselkennung, Metadaten (nur Schilderzahl), Ablauf, Löschgrund. Gelöscht wird der
  Geheimtext (Zeile bleibt als Nachweis der Erfassung ohne Inhalt).
- `kfz_submissions`: je Versuch Referenz, Prüfsumme, Zustand, Vorgangsnummer, HTTP-Status, Trace-Id, bereinigter Fehler,
  Modus, Rumpf ohne Codes, bestätigt von, Zeitpunkte.

## Tests (nur Simulation)

- `tests/kfz-submission.test.ts` (28 Tests) gegen den erweiterten Testnachbau `scripts/fake-kfz-api.mjs`
  (Schemaprüfung, Doppelschutz 15 Minuten, 409, 500/503/403, verlorene Antwort, Auftragsliste, Vorgangsauskunft).
- `tests/kfz-submission-migration.test.ts`: Migration 13 → 14 erhält alle Bestandsdaten.
- Zusätzlich im Browser gegen den Testnachbau geprüft (lokale, getrennte Datenbank, synthetische Daten): Erfassen,
  Vorschau, Senden, Status, Abgleich; Datenbankdateien (inkl. WAL) ohne Klartext-Codes.

## Aktivierung (nur durch den Inhaber, später)

1. Vertragspartnernummer im Dashboard ablesen und als `KFZ_VERTRAGSPARTNER` eintragen (Inhaber).
2. (Kein Kontakt mit kfz-api.de, kein Sandbox-Test – Vorgabe des Inhabers vom 17.10.2026.)
3. Datenschutzerklärung Fassung 5 (Abschnitt 10 und 13) – vom Inhaber am 17.10.2026 freigegeben und veröffentlicht.
4. `KFZ_CODES_KEY` als Secret und `KFZ_VERTRAGSPARTNER` setzen (Inhaber), dann zuerst `KFZ_UEBERMITTLUNG=test`.
5. Eine echte, bezahlte Abmeldung mit Testfreigabe senden (ab 6,73 € brutto), Webhooks beobachten.
6. Danach `KFZ_UEBERMITTLUNG=aktiv`. Der manuelle Weg bleibt jederzeit verfügbar.
