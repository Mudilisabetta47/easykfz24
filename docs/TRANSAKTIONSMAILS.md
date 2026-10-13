# Transaktionsmails (Resend)

Stand: 13.10.2026 · Code: `src/server/transactional-mail.ts`, Vorlagen `src/lib/mail-templates.ts`, Protokoll = Tabelle `messages` (Migration v10)

## Anlässe – nur bestätigte Ereignisse

| Mail | Auslöser | Schlüssel (Idempotenz) |
|---|---|---|
| Bestell- und Vertragsbestätigung | verbindliche Bestellung über die Website (`/api/auftrag`, nach dem Speichern) | `bestellung:<Auftrag>` |
| Zahlung bestätigt | Mollie-Abgleich (`GET /v2/payments/{id}`) meldet **echte** Zahlung, Betrag/Auftrag/Modus stimmen, erste Zahlung des Auftrags | `zahlung:<tr_…>` |
| Zahlung fehlgeschlagen | Mollie-Abgleich: `failed` (echte Zahlung) – mit Link „Erneut bezahlen“ | `zahlung_fehler:<tr_…>` |
| Erstattung | Mollie-Abgleich: Erstattungsbetrag gestiegen (echte Zahlung) | `erstattung:<tr_…>:<Gesamtbetrag>` |
| Unterlagen erforderlich | Status → „Unterlagen fehlen“ (OS) bzw. Behörde verlangt Angaben (kfz-api.de) | `unterlagen:<Auftrag>:<Ereignis>` |
| Vollmacht bestätigt | Partner-API bestätigt `signiert` + `readyForApplication` | `vollmacht:<Vorgang>` |
| Antrag eingereicht | Status → „Bei Zulassungsstelle“ bzw. kfz-api.de „in Bearbeitung“ | `antrag:<Auftrag>` |
| Zulassung abgeschlossen | Status → „Zugelassen“ bzw. kfz-api.de „abgeschlossen“ | `zulassung:<Auftrag>` |
| Auftrag nicht abgeschlossen | kfz-api.de „fehlgeschlagen“ | `abgelehnt:<Auftrag>:kfz:<Ereignis>` |

Nie ausgelöst durch: Browser-Rückleitung, Testzahlungen (Mollie-Testmodus bei Live-Hauptschlüssel), Betragsabweichung,
Doppelzahlung (stattdessen kritischer OS-Hinweis), manuell gesetzten Zahlungsstatus. OS-Status und Behördenmeldung teilen sich
den Schlüssel → nie doppelt.

## Ablauf und Sicherheit

- **Freigabe:** ohne `KUNDENMAILS=1` (Cloudflare-Variable) wird jede Kundenmail nur protokolliert („zurückgehalten“), nie
  versendet. Im OS (Auftrag → Kommunikation) einzeln „Freigeben und senden“ (Recht „Kunden-E-Mails versenden“).
- **Idempotenz:** eindeutiger `dedupe_key`; gleichzeitige Aufrufe → eine Mail. Zustellung atomar beansprucht (`wird_versendet`).
- **Wiederholung:** Versandfehler → bis zu 5 Versuche (5 Min., 30 Min., 2 Std., 12 Std.; Cron „Mail-Wiederholung“ alle 10 Min.),
  danach „fehlgeschlagen“ + OS-Hinweis; „Erneut senden“ im OS.
- **Nachweis:** Resend-E-Mail-ID je Mail (`provider_id`), im OS angezeigt; Zustellstatus im Resend-Dashboard (Emails → ID).
- **Datenschutz:** keine Fahrzeug-, Ausweis- oder Halterdaten in Mails; Schlüssel nie protokolliert; Reply-To = Firmendaten
  „Antwortadresse“, sonst `kundenservice@easykfz24.de`.
- **Darstellung:** einheitliches Layout mit Logo (`/logo/easykfz24-logo-mail.png`), eine Spalte, max. 560 px; Text- und HTML-Fassung;
  Anbieterangaben der MONVEX UG (haftungsbeschränkt) i. G. im Fuß jeder Mail.
- **Testversand:** OS → Einstellungen → System & Diagnose → „E-Mail-Testversand“ (nur Inhaber): Beispielinhalte ohne Kundendaten,
  Betreff „[TEST] …“, an genau die eingegebene Adresse; Ergebnis mit Resend-ID.

## Einstellungen

| Wo | Was | Stand |
|---|---|---|
| Cloudflare | `RESEND_API_KEY` (Secret), `MAIL_FROM` = `EasyKFZ24 <kundenservice@easykfz24.de>` | ✅ gesetzt |
| Cloudflare | `KUNDENMAILS=1` | **aus** – erst nach Freigabe |
| OS → Einstellungen → Unternehmen | „Antwortadresse (Reply-To)“, „Benachrichtigungs-E-Mail“ (Team) | **leer** |
| Resend | Domain `easykfz24.de` verifiziert | DKIM `resend._domainkey` + `send.` vorhanden (Status im Resend-Dashboard prüfen) |
| DNS (IONOS) | `_dmarc` TXT `v=DMARC1; p=none; rua=mailto:kundenservice@easykfz24.de` | **fehlt** |
