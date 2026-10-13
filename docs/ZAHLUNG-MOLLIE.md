# Online-Zahlung über Mollie

Stand: 13.10.2026 · Mollie Payments API v2 (docs.mollie.com) · Code: `src/server/mollie.ts`, `src/lib/mollie.ts`

## Dokumentierte Fakten

| Thema | laut Mollie-Doku |
|---|---|
| Anlegen | `POST /v2/payments` – `amount {currency, value "24.99"}`, `description`, `redirectUrl`, optional `webhookUrl`, `locale`, `metadata` (≈ 1 kB) → `id` `tr_…`, `status`, `mode`, `_links.checkout.href` |
| Stand | `GET /v2/payments/{id}` – `open`, `pending`, `authorized`, `paid`, `canceled`, `expired`, `failed`; dazu `amountRefunded`, `amountChargedBack`, `method`, `metadata`, `paidAt` |
| Webhook | `POST` (form) mit nur `id`, **ohne Signatur** → Stand immer per `GET` holen; `200` bestätigt, sonst bis zu 10 Wiederholungen in ≈ 26 h; unbekannte IDs mit `200` beantworten; `localhost` nicht erreichbar |
| Wiederholung | `Idempotency-Key` an allen POST-Endpunkten, 1 Stunde gespeichert; gleiche Anfrage → gleiche Antwort (`Idempotent-Replayed: true`) |
| Rückleitung | ist **kein Zahlungsnachweis** (Webhook kann später kommen); Rückkehrseite darf nichts Sensibles zeigen |
| Schlüssel | `test_…` (Testmodus, Daten getrennt) bzw. `live_…`; nur serverseitig |
| Verbindungstest | `GET /v2/methods` – liest die aktiven Zahlarten, legt nichts an |

## Ablauf

1. Bestellung abgeschlossen → (nur bei `ZAHLUNG_ONLINE=1`) Zahlung bei Mollie anlegen; **Betrag aus `orders.total_cents`**,
   `metadata {order, attempt}`, `Idempotency-Key` je Versuch, Rückleitung auf `/zahlung/<Nr>?t=<Zahlungstoken>&rueckkehr=1`,
   Webhook `https://easykfz24.de/api/zahlung/mollie` (lokal ohne Webhook).
2. Kunde bezahlt bei Mollie (Checkout).
3. Webhook → `GET /v2/payments/{id}` → Prüfung: Betrag, Währung, Auftrag (`metadata.order`), Modus passen zum gespeicherten
   Versuch und zum Auftragsbetrag. Nur dann: Auftrag „bezahlt“, Buchung (`payments`, Anbieter `mollie`), Verlauf, OS-Hinweis.
4. Rückkehrseite zeigt den **serverseitig bestätigten** Stand (gedrosselter Abgleich, Neuladen bis ≈ 2 Min. bei „wird bestätigt“).
5. Fehlgeschlagen / abgebrochen / abgelaufen → „Erneut bezahlen“ (neuer Versuch). Offener Versuch → „Zahlung fortsetzen“
   (derselbe Checkout, keine zweite Zahlung).
6. Zeitsteuerung „Zahlungsabgleich“ (Cron alle 10 Min.) gleicht offene Versuche ab, falls ein Webhook ausbleibt.
7. Erstattungen und Rückbuchungen (Chargeback) werden beim Abgleich je Stand genau einmal gebucht; vollständige Erstattung →
   Auftrag „erstattet“.

Zahlung ≠ Unterschrift ≠ Zulassung – getrennte Zustände.

## Sicherheit

- Schlüssel nur als Cloudflare-Secret `MOLLIE_API_KEY`; nie im Browser, nie in Logs, nie in Antworten (Diagnose zeigt nur den Modus am Präfix).
- Preismanipulation: Der Browser schickt nur Auftragsnummer und Zahlungstoken; der Betrag kommt aus der Datenbank. Weicht der von Mollie
  gemeldete Betrag, die Währung, der Auftrag oder der Modus ab → **nicht** bezahlt, kritischer Hinweis „Zahlung prüfen“.
- Webhook ohne Vertrauen: Inhalt wird nie übernommen; fremde/ungültige IDs → 200 ohne Abfrage; Begrenzung 300/Min. je IP.
- Doppelte/gleichzeitige Webhooks: Statuswechsel atomar (`UPDATE … WHERE status = alter Stand`), Buchungen eindeutig
  (Anbieter, Referenz, Art, Status) → genau eine Buchung, ein Verlaufseintrag, ein Hinweis.
- Doppelzahlung (zweiter Versuch ebenfalls bezahlt): wird gebucht, als „DOPPELZAHLUNG – erstatten“ markiert, kritischer Hinweis.
- Mollie gestört: Webhook antwortet 503 → Mollie stellt erneut zu; Kunde erhält einen Hinweis, nichts wird erfunden.
- Rückkehrseite: nur mit Zahlungstoken, `noindex`, `no-referrer`, keine Personendaten; manipulierte Parameter zeigen keinen Erfolg.

## Schalter

| Variable | Wirkung | Vorgabe |
|---|---|---|
| `MOLLIE_API_KEY` (Secret) | Hauptschlüssel; Modus am Präfix `test_`/`live_` | seit 13.10.2026 in Cloudflare (Typ wird nach dem Deploy im Cron-Protokoll und in der Diagnose angezeigt) |
| `MOLLIE_TEST_API_KEY` (Secret) | separater Testschlüssel (`test_…`) für Testzahlungen aus dem OS | seit 13.10.2026 15:45 UTC in Cloudflare |
| `ZAHLUNG_ONLINE=1` | Online-Zahlung für Kunden einschalten | **aus** – ohne bleibt alles wie bisher (Zahlung „offen“, manuell) |
| `MOLLIE_API_BASE` | nur für Tests (Testnachbau) | `https://api.mollie.com/v2` |

Neue Tabelle `payment_attempts` (Migration v9, nur Ergänzung).

## Testzahlung (ohne Live-Freischaltung)

- OS → Auftrag → Reiter „Zahlung“ → **„Testzahlung starten (Mollie-Testmodus)“** – nur Inhaber, nur wenn ein Testschlüssel da ist
  (separater `MOLLIE_TEST_API_KEY` oder ein Test-Hauptschlüssel). Öffnet den Mollie-Testcheckout in neuem Tab; dort Status wählen.
- Jeder Aufruf wählt den Schlüssel passend zum Modus der Zahlung: Testzahlungen nur mit dem Testschlüssel, echte nur mit `live_…`
  (Testdaten sind bei Mollie von Live-Daten getrennt).
- **Ist der Hauptschlüssel live, zählt eine Testzahlung nie als echte Zahlung:** Auftrag bleibt „Zahlung offen“, Buchungsart
  „testzahlung“ (0 €), Hinweis „Testzahlung erfolgreich (kein echtes Geld)“, **kein** `payment.paid` → keine Automatisierung.
- Echte und Testzahlung werden nicht vermischt (offener Versuch des anderen Modus → Hinweis statt neuer Zahlung).
- Der Cron schreibt den Modus der Schlüssel (nie die Werte) ins private Worker-Protokoll:
  `[zeitplan] {…,"mollie":{"haupt":"live|test","testschluessel":true,"online":false}}` – lesbar mit `npx wrangler tail easykfz24`.

## Getestet (13.10.2026, Testnachbau `scripts/fake-mollie.mjs`, keine echten Zahlungen)

Unit-Tests 21 (u. a. separater Testschlüssel bei Live-Hauptschlüssel ohne Statuswechsel und Automatisierung, Standard AUS auch mit Live-Schlüssel, Verbindungstest, Betrag aus DB, Webhook nur an HTTPS, offener
Versuch wird fortgesetzt, verlorene Antwort → gleicher Idempotency-Key, Mollie gestört, dreifacher gleichzeitiger Webhook →
eine Buchung, fremde IDs ohne Abfrage, Mollie offline/5xx → 503 und spätere Übernahme, Preismanipulation, fremder Auftrag,
Betrag nach Start geändert, fehlgeschlagen/abgebrochen/abgelaufen → neuer Versuch, Doppelzahlung, Teil-/Vollerstattung,
Rückbuchung, gedrosselte Rückkehrseite, Cron-Abgleich) · E2E Node und **Cloudflare-Worker-Laufzeit** je 66/66 (inkl. Testzahlung nur für Inhaber) (Bestellung →
Mollie, manipulierte Preisfelder ignoriert, Webhook, Rückkehrseite, „Erneut bezahlen“, OS-Abgleich, Diagnose ohne Schlüssel)
· Bezahlseite im Browser (offen, fehlgeschlagen, bezahlt, mobil 375 px) · Produktions-Build.

## Noch offen / Livegang (Checkliste)

1. Veröffentlichung nur mit Freigabe (Migration v9 läuft dabei automatisch, nur neue Tabelle). `ZAHLUNG_ONLINE` bleibt **ungesetzt**
   → keine Online-Zahlung für Kunden, keine echten Abbuchungen.
2. Nach dem Deploy: Modus des Hauptschlüssels aus dem Cron-Protokoll bzw. OS → Einstellungen → System & Diagnose ablesen.
3. Testzahlung auf easykfz24.de: eigener Testauftrag im OS → „Testzahlung starten“ → im Testcheckout „Paid“ wählen →
   Rückkehrseite, Webhook, Buchung „testzahlung“, OS-Hinweis prüfen; zusätzlich „Failed“/„Canceled“ mit weiterer Testzahlung.
4. Erst danach (eigene Zustimmung): Live-Schlüssel + `ZAHLUNG_ONLINE=1`; Zahlarten im Mollie-Dashboard aktivieren;
   Datenschutzerklärung um Mollie als Zahlungsdienstleister ergänzen.
