# Livegang-Check EasyKFZ24 – Kundenbetrieb mit Online-Zahlung

Stand: 13.10.2026, 20:40 UTC (Code-Stand lokal, noch nicht veröffentlicht) · Live-Version `938890a` · `ZAHLUNG_ONLINE` **aus** · `KUNDENMAILS` **aus**

Ampel: 🟢 erledigt · 🟡 vor Freigabe empfohlen · 🔴 **Blocker** vor echten Kundenzahlungen

## 1. Rechtlich (Verbraucherverträge im Internet)

| | Punkt | Befund |
|---|---|---|
| 🟢 | Impressum | MONVEX UG (haftungsbeschränkt) i. G., Anschrift, Vertretung, Kontakt; keine erfundene Registernummer |
| 🟢 | Vertragspartner und Button | Bestellabschluss nennt den Vertragspartner; Button „Zahlungspflichtig beauftragen“ |
| 🟢 | Datenschutz: Mollie | Mollie B.V. als Zahlungsdienstleister genannt (seit `938890a`) |
| 🔴 | **Widerrufsbelehrung + Widerrufsfunktion** | vorbereitet, aber **aus** (`WIDERRUF_AKTIV`). Ohne Belehrung verlängert sich das Widerrufsrecht auf 12 Monate + 14 Tage; die elektronische Widerrufsfunktion (§ 356a BGB) ist seit 19.06.2026 Pflicht. Im Bestellabschluss erscheint der Hinweis erst nach Freischaltung. |
| 🔴 | **Vorzeitiger Leistungsbeginn** | technisch vorbereitet (Erklärung im Bestellabschluss, Zeitpunkt gespeichert, OS-Warnung ohne Erklärung, Bestätigung in der Vertragsmail) – erscheint nur mit `WIDERRUF_AKTIV=1`; **Wortlaut anwaltlich prüfen** |
| 🟡 | Vertragsbestätigung auf dauerhaftem Datenträger (§ 312f BGB) | **umgesetzt** (automatische Bestell- und Vertragsbestätigung, `docs/TRANSAKTIONSMAILS.md`); Versand erst mit `KUNDENMAILS=1`; Inhalt anwaltlich prüfen |
| 🟡 | AGB | keine AGB-Seite (nicht zwingend, aber üblich: Leistungsumfang, Mitwirkung, Haftung, Zahlungsbedingungen) |
| 🟡 | Datenschutz insgesamt | Seite noch als „Entwurf“ markiert; Platzhalter Speicherdauer; Empfänger kfz-api.de/Nect, Resend, Cloudflare-Details fehlen |
| 🟢 | Streitbeilegung | VSBG-Hinweis geprüft und dokumentiert |

## 2. Zahlung (Mollie)

| | Punkt | Befund |
|---|---|---|
| 🟢 | Schlüssel | `MOLLIE_API_KEY` = **live** (laut Cron-Protokoll), `MOLLIE_TEST_API_KEY` = test; Werte nie ausgelesen |
| 🟢 | Live/Test getrennt | Jeder Zahlungsversuch speichert seinen Modus; Abfragen nur mit dem passenden Schlüssel (Mollie trennt Test-/Live-Daten). Testzahlung bei Live-Hauptschlüssel: Auftrag bleibt offen, Buchung „testzahlung“ 0 €, **kein** `payment.paid`, keine Automatisierung. Testzahlungen nur Inhaber. Kunden immer mit Live-Schlüssel und nur bei `ZAHLUNG_ONLINE=1`. Live bestätigt (16:28 UTC). Nach Löschen von `MOLLIE_TEST_API_KEY` sind Testzahlungen ganz aus. |
| 🟢 | Betrag/Manipulation | Betrag nur aus der Datenbank; Abweichung von Betrag, Währung, Auftrag oder Modus → nicht bezahlt + kritischer Hinweis (Tests) |
| 🟢 | Webhook | Live empfangen (16:28:09 UTC, Mollie, 200); ohne Signatur → Stand immer per API; doppelte/gleichzeitige Zustellung ohne Doppelbuchung; 503 bei Mollie-Störung (Wiederholung); Cron-Abgleich alle 10 Min. |
| 🟢 | Fehlgeschlagen/abgebrochen/abgelaufen | Rückkehrseite zeigt bestätigten Stand; „Erneut bezahlen“; offener Versuch wird fortgesetzt |
| 🟡 | „pending“ (z. B. PayPal) | blockiert neuen Versuch bis zur Klärung (Schutz vor Doppelzahlung) – gewollt; läuft bei Mollie aus |
| 🟢 | Rückerstattung | Erstattungen/Rückbuchungen aus Mollie werden beim Abgleich gebucht (teilweise/vollständig → „erstattet“), getestet im Testnachbau; Auslösen der Erstattung im **Mollie-Dashboard** (keine Erstattungsfunktion im OS) |
| 🟢 | Zahlungsbestätigung an Kunden | umgesetzt: nur nach Mollie-bestätigter echter Zahlung, genau einmal; dazu „fehlgeschlagen“ und „Erstattung“ (Versand mit `KUNDENMAILS=1`) |
| 🟡 | Zahlarten | im Mollie-Live-Profil aktivieren und im OS-Verbindungstest prüfen |
| 🟡 | Erster echter Probekauf | kleiner eigener Auftrag + Erstattung im Mollie-Dashboard – nur mit ausdrücklicher Zustimmung |

## 3. Rechnungen/Belege

| | Punkt | Befund |
|---|---|---|
| 🔴 | **Steuernummer / USt-IdNr.** | in den Firmendaten **leer** → Rechnungen können nicht erstellt werden (§ 14 UStG); bei UG i. G. ggf. Steuernummer beim Finanzamt beantragen |
| 🟡 | Rechnungserstellung | manuell im OS (Finanzen → Rechnung); keine automatische Rechnung nach Zahlung, kein automatischer Versand |
| 🟢 | Buchungen | Zahlungen, Erstattungen, Rückbuchungen, Preisänderungen, manuelle Buchungen getrennt nachvollziehbar |

## 4. E-Mail (Resend)

| | Punkt | Befund |
|---|---|---|
| 🟢 | Konfiguration | `RESEND_API_KEY` (Secret) + `MAIL_FROM` = `EasyKFZ24 <kundenservice@easykfz24.de>`; DNS: DKIM `resend._domainkey`, Absender-Subdomain `send` vorhanden |
| 🟡 | DMARC | kein `_dmarc`-Eintrag → bei IONOS `v=DMARC1; p=none; rua=mailto:kundenservice@easykfz24.de` |
| 🟡 | Team-Benachrichtigung | `notifyEmail` und `replyTo` in den Firmendaten leer → derzeit gehen keine Team-Mails raus; Antworten ohne Reply-To |
| 🟡 | Zustellnachweis | noch keine Mail live versendet (0 Nachrichten). Test: OS-Nachricht an eigene, ausdrücklich freigegebene Adresse → Nachweis im OS („versendet“) und im Resend-Dashboard („Delivered“) |
| 🟢 | Automatische Kunden-Mails | einheitliches System mit Vorlagen, Protokoll, Idempotenz, Wiederholung, Fehleranzeige, Freigabe im OS, Testversand (Inhaber) |

## 5. Technik und Betrieb

| | Punkt | Befund |
|---|---|---|
| 🟢 | Version/Deploy | `/api/version` zeigt Commit; Cloudflare Workers Builds (einmal ausgeblieben → leerer Commit) |
| 🟢 | Datenbank | Schema 9, automatische Migrationen nur ergänzend; Time-Travel-Lesezeichen + Export vorhanden |
| 🟢 | Cron | alle 10 Min., Vollmacht- und Zahlungsabgleich, Modus-Protokoll ohne Schlüsselwerte |
| 🟢 | Geheimnisse | keine Zugangsdaten im Frontend oder im öffentlichen Repository (Scan Live-JS + Git-Historie) |
| 🟢 | Tests | Unit 225/225, E2E Node und Worker je 66/66 |
| 🟡 | Sitzungen | 13 Sitzungen in der Datenbank (Inhaber) – ggf. alte abmelden |
| 🟡 | Digitale Vollmacht | aus (Standard); KBA-/Produktionsfreigabe bei kfz-api.de seit 14.10.2026 08:00 geplant |

## 6. Testdaten-Bereinigung – **erledigt** (13.10.2026, vom Inhaber ausgeführt; Wiederherstellung bewusst nicht ausgeführt)

Betroffen (Live, gezählt am 13.10.2026 16:42 UTC): Aufträge `EK-2026-00001`, `EK-2026-00002` (Abmeldung, aus der Verwaltung angelegt),
1 Kunde K000001, 1 Fahrzeug, 2 Buchungen (Testzahlung 0 €, manuell 34,98 €), 2 Zahlungsversuche (Mollie-Testmodus), 2 Aufgaben, 1 Notiz,
17 Verlaufseinträge, 12 OS-Ereignisse, 9 Hinweise, 14 Automatisierungsläufe. Bleibt: Sicherheitsprotokoll (39), kfz-api.de-Selbsttests (2),
Einstellungen (2), Sitzungen. Danach beginnen Auftragsnummern wieder bei `EK-2026-00001`.

⚠️ Der Kundendatensatz enthält einen echt wirkenden Namen, eine iCloud-Adresse und die Notiz „kundin hat angerufen“ – vor dem Löschen
bestätigen, dass es keine echte Kundin ist.

Sicherung vor dem Löschen: Time-Travel-Lesezeichen `0000003d-00000000-00005103-39d18761d0474d5afbb78c9e7def92a7`
(`npx wrangler d1 time-travel restore easykfz24 --bookmark=…`) und vollständiger Export (lokal, nur für den Inhaber lesbar).
Probelauf auf der wiederhergestellten Sicherung: genau diese Datensätze entfernt, Rest unverändert.

## Empfehlung

Kundenzahlungen erst freischalten, wenn die 🔴-Punkte erledigt sind: Widerrufsbelehrung/-funktion inkl. vorzeitigem Leistungsbeginn
(anwaltlich geprüft, dann `WIDERRUF_AKTIV=1`), Steuernummer/USt-IdNr. für Rechnungen. Danach `KUNDENMAILS=1`, dann `ZAHLUNG_ONLINE=1`.
Prüfliste der Rechtstexte: `docs/RECHTSTEXTE-PRUEFUNG.md`.
