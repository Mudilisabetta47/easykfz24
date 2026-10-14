# Notfallplan und Produktivschalter

Stand: 15.10.2026. Schalter werden **nur im Cloudflare-Dashboard** gesetzt (Workers & Pages › easykfz24 › Einstellungen ›
Variablen und Geheimnisse › Bereitstellen) – **nie per API** (ein API-Aufruf hat am 13.10.2026 alle Bindungen entfernt).
Nach jeder Änderung: `https://easykfz24.de/api/health` muss `"db":true,"uploads":true` zeigen.

## Sofort-Sperre bei Problemen

| Problem | Schalter | Wirkung | Bleibt erhalten |
|---|---|---|---|
| Neue Bestellungen stoppen | `BESTELLUNG_AKTIV` = `0` | Checkout zeigt „noch nicht freigeschaltet“, Bestell-API antwortet 503 | Aufträge, Unterlagen, OS, Statusabfrage, Widerruf, Webhooks, Cron |
| Zahlungen stoppen | `ZAHLUNG_PAUSE` löschen oder `1` | keine neuen Mollie-Zahlungen; Webhooks bereits gestarteter Zahlungen werden weiter verarbeitet | Aufträge, Zahlungsjournal |
| Digitale Vollmacht stoppen | `VOLLMACHT_DIGITAL` löschen | keine neuen (kostenpflichtigen) Vorgänge; Website nimmt dann nur Abmeldungen an | Abgleich bestehender Vorgänge (kostenlos) |
| Kundenmails anhalten | `KUNDENMAILS` = `0` | Mails werden „zurückgehalten“ protokolliert, nicht versendet | Mailprotokoll im OS |

Hinweis: Mit `BESTELLUNG_AKTIV=0` sind auch Online-Zahlungen für bestehende Aufträge gesperrt (gleiche Sicherheitsprüfung).
Nichts davon löscht Daten. Rücknahme: Wert zurücksetzen und erneut bereitstellen.

## Sollwerte für den Produktivstart (Reihenfolge)

| Schritt | Variable | Sollwert | Voraussetzung |
|---|---|---|---|
| 1 | `VOLLMACHT_TESTMODUS` | nicht gesetzt | Test abgeschlossen, Testfreigabe zurückgezogen, Fenster geschlossen |
| 2 | `VOLLMACHT_DIGITAL` | `1` | POWR-Produktivfreigabe schriftlich, Nachweisweg für signierte Vollmachten festgelegt |
| 3 | `ZAHLUNG_ONLINE` | `1` | – |
| 3 | `ZAHLUNG_PAUSE` | `0` | Mollie: Unternehmen verifiziert, Website-Profil freigegeben, Live-Schlüssel des Profils, Methoden aktiv |
| – | `KLARNA_AKTIV` | nicht gesetzt | Klarna nur nach eigener Freigabe |
| – | `MOLLIE_TEST_API_KEY` | nicht gesetzt | nur für Testzahlungen nach Freigabe |
| – | `WIDERRUF_AKTIV` | `1` | – |
| – | `KUNDENMAILS` | `1` | Resend-Domain verifiziert (Testmails 13.10.2026 zugestellt) |
| 5 | `BESTELLUNG_AKTIV` | `1` – **zuletzt** | alle Startblocker erledigt |

Unverändert lassen: `KFZ_API_BASE_URL`, `MAIL_FROM`, alle Geheimnisse und Bindungen (`DB`, `UPLOADS`, `ASSETS`, `IMAGES`,
`WORKER_SELF_REFERENCE`).

## Begleiteter Start

- Die ersten Aufträge täglich im OS prüfen: Zahlungsjournal (nur von Mollie bestätigte Zahlungen), Mailprotokoll,
  Vollmachtsstand, KFZ-API-Center (Webhooks, „Beim Partner ohne Freigabe/QES“), Benachrichtigungen, Audit-Protokoll.
- Freigabe zur Übermittlung je Auftrag nur bei: Zahlung bestätigt, Checkliste und Sicherheitscodes vollständig, QES vom
  Partner bestätigt (signiert + vollständig) und signiertes PDF aus dem POWR-Dashboard im Dokumentenmanager (Kategorie
  „Vollmacht“) – das System sperrt sonst.
- Digitale Vollmacht je Kundenauftrag erst nach bestätigter Zahlung anfordern (das System sperrt sonst; Kosten 6,95 € netto).
