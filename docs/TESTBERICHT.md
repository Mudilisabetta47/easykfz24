# Testbericht EasyKFZ24 OS Enterprise – Produktionsreife

Stand 12.10.2026 · geprüfter Code: Arbeitsstand auf `main` (noch nicht committet) · Basis in Produktion: `0937ed6`

## Ergebnis auf einen Blick

| Bereich | Ergebnis |
|---|---|
| Automatisierte Tests gesamt | **219 bestanden, 0 fehlgeschlagen** (135 Unit/Integration + 42 E2E unter Node + 42 E2E in der Cloudflare-Laufzeit) |
| Verwaltungs-Endpunkte | **101/101** abgedeckt · 99 mit Erfolgsfall · 100 ohne Anmeldung → 401 · 66 mit Rechte-Ablehnung → 403 · 55 mit ungültigen Eingaben · **0 Serverfehler (5xx)** |
| D1-Migration 3 → 6 mit Altdaten | **11/11** Prüfungen je Weg (SQL vorab / Laufzeit); alte Version läuft auf Schema 6 (Rollback-fähig) |
| Desktop-Programme im Browser | **11/11** Programme + Papierkorb, alle Tabs/Bereiche, 7 Programm-Verknüpfungen – keine JS-, UI- oder Serverfehler |
| Gefundene Fehler | **14 behoben** (2 hoch, 5 mittel, 7 niedrig) – Liste unten |
| Offene Punkte | keine Fehler; **Einschränkungen und Empfehlungen** siehe letzter Abschnitt |

Es wurden **keine** echten Zahlungen, E-Mails, Zulassungsanträge oder Änderungen an der Produktionsdatenbank ausgelöst.
Alle Tests liefen gegen isolierte Testserver mit Zufalls-Geheimnissen und **ohne** Stripe-, E-Mail- oder kfz-api.de-Schlüssel.

---

## Testumgebung und Methode

| Ebene | Werkzeug | Umgebung |
|---|---|---|
| Unit/Integration | `npm test` (node:test) | Fachlogik, Preise, Workflow, TOTP (RFC-6238-Vektoren), Sitzungstoken, Rechnungen |
| E2E – Node | `node scripts/e2e.mjs node` | gebauter Next-Standalone-Server, eigene SQLite-DB und Dateiablage im Temp-Ordner |
| E2E – Cloudflare | `node scripts/e2e.mjs worker` | gebauter Worker in **workerd** (`wrangler dev --local`) mit emulierter **D1** und **R2** |
| Migration | `scripts/e2e-migration.mjs` | ausgelieferter Stand `0937ed6` erzeugt Daten → Upgrade → neuer Stand prüft |
| Oberfläche | Browser (Entwicklungsserver), Testskript im Fenster | angemeldet als lokaler Testbenutzer (Rolle Verwaltung) |

Die E2E-Suite (`tests-e2e/api.e2e.test.ts`) liest die Routen direkt aus dem Quelltext und **schlägt fehl**, sobald ein
Endpunkt hinzukommt, der nicht ohne Anmeldung, mit Erfolg und – falls nicht jede Rolle das Recht hat – mit Ablehnung
getestet ist. Abdeckungsdaten: `test-results/e2e-<modus>-coverage.json`, JUnit-Berichte: `test-results/e2e-<modus>.xml`.

Rollen im Test: Inhaber, Verwaltung, Sachbearbeitung, Buchhaltung, Nur lesen (je eigener Benutzer, eigene IP).

---

## Ergebnisse je Prüfauftrag

### 1. Alle 101 Verwaltungs-Endpunkte (Rechte, ungültige Eingaben, Fehlerfälle) – bestanden

- Jeder Endpunkt ohne Sitzung → **401** (`locked:true`), manipuliertes oder gefälschtes Cookie → 401.
- Rechte je Rolle gemäß Rollenmatrix: 66 Endpunkte, deren Recht nicht jede Rolle besitzt, liefern für die fehlende
  Rolle **403** (u. a. Buchhaltung ohne Dokumentzugriff, Nur-lesen ohne jede Schreibaktion, Sachbearbeitung ohne
  Finanzen/Benutzer/Protokoll). Aktionen mit eigenem Recht innerhalb eines Endpunkts (Zahlung, Preis, Freigabe,
  KFZ-Verknüpfung, endgültig löschen) einzeln geprüft.
- Ungültige Eingaben → 400/404/413/415/422 mit verständlicher Meldung, nie 500: falsche IDs, unbekannte Aktionen/Status,
  ungültige Übergänge, falsche Kennzeichen/FIN/E-Mail/Datum/Prozent, Pfad-Tricks (`../`), Formel-Injection im
  CSV-Export, zu große Einstellungen (413), HTML als PDF getarnt (abgelehnt), leere Uploads.
- Schutz vor Cross-Site-Anfragen: fremde Herkunft 403, `Sec-Fetch-Site: cross-site` 403, falscher Inhaltstyp 415.
- Nicht ohne externe Dienste mit Erfolg testbar (bewusst): „Zahlung bei Stripe abrufen“ und „E-Mail senden“ – geprüft
  wird die saubere Ablehnung („nicht eingerichtet“), keine externe Anfrage.

### 2. Desktop-Programme im Browser – bestanden

Geöffnet und durchgeklickt, dabei JS-Fehler, Fehleranzeigen und API-Antworten ≥ 400 aufgezeichnet:
Kontrollzentrum · Auftragscenter (Liste, Kanban, Akte mit 9 Tabs) · Kundenverwaltung (Akte mit 9 Bereichen) ·
Zulassungsmanager (6 Tabs) · Dokumentenmanager · KFZ-API Center (5 Tabs) · Finanzcenter (7 Tabs) · Aufgabencenter ·
Kommunikationszentrale (4 Tabs) · Benachrichtigungscenter · Systemeinstellungen (8 Bereiche) · Papierkorb.
Ergebnis: **0** JS-Fehler, **0** API-Fehler, **0** Serverfehler. Einzige Meldung: DSGVO-Löschung „Nicht möglich:
1 laufender Auftrag“ – gewolltes Verhalten.

### 3. Vollständiger Ablauf Bestellung → Zahlung → Prüfung → Abschluss – bestanden

Website-Bestellung (Abmeldung) mit Ausweis und ZB I → Auftrag + Kunde + Ereignis → signierter Stripe-Webhook „bezahlt“
→ Automatisierung setzt „In Prüfung“ → Checkliste → Sicherheitscodes bestätigt → Freigabe (vorher blockiert, mit
Grund) → Übergabe „bei Zulassungsstelle“ → kfz-api.de ACCEPTED → „in Bearbeitung“ → APPROVED → „Zugelassen“
automatisch → Kunden-E-Mail **als Entwurf** vorbereitet (nicht versendet) → Abgeholt → Abgeschlossen → Rechnung →
Gutschrift. Zusätzlich die Gegenrichtung: Rückfrage der Behörde (REJECTED) → „Unterlagen fehlen“ → genau eine Aufgabe.

### 4. Stripe-Zahlungen und Webhooks – bestanden

| Angriff/Fehlerfall | Ergebnis |
|---|---|
| falsche Signatur | 400, nichts gebucht |
| alte Signatur (Replay, > 5 Min) | 400 |
| doppelte Zustellung desselben Ereignisses | angenommen, **genau eine** Buchung, eine Benachrichtigung, Automatisierung einmal |
| unbekannte Auftragsnummer | angenommen, keine Änderung |
| Session „unpaid“ als „completed“ | keine Zahlung gebucht |
| Betrag ≠ Auftragsbetrag | im Zahlungsabgleich gemeldet **und Freigabe blockiert** (neu, siehe F5) |
| abgelaufene / fehlgeschlagene Zahlung (auch doppelt) | einmal protokolliert, einmal gemeldet, Auftrag bleibt offen |
| Preis vom Kunden beeinflussbar? | nein – Betrag kommt nur aus der Datenbank, Zahlungslink braucht Zufallstoken |
| Preisänderung nach Zahlung | abgelehnt („nur bei offener Zahlung“) |

### 5. Sicherheit: Rollen, 2FA, Sitzungen, Dokumentzugriff – bestanden (2 Fehler behoben)

- **2FA (TOTP):** Einrichten, falscher Code abgelehnt, Anmeldung ohne Code keine Sitzung, derselbe Code nicht zweimal,
  Abschalten nur mit gültigem Code, Zurücksetzen durch Inhaber beendet alle Sitzungen des Benutzers.
- **Sitzungen:** serverseitiges Register; Sperren macht das alte Cookie wertlos; fremde Sitzung nicht beendbar (404);
  „andere abmelden“, Passwort-/Rollen-/Statusänderung und Deaktivierung beenden Sitzungen; Cookie HttpOnly,
  SameSite=Strict, Secure in Produktion; Leerlauf- und absolute Ablaufzeit.
- **Anmeldesperre:** nach Fehlversuchen 429 – auch mit gefälschtem `X-Forwarded-For` und danach mit richtigem
  Passwort (dauerhaft über das Protokoll, nicht nur im Speicher einer Instanz).
- **Dokumente:** Datei nur mit Dokumentrecht (Buchhaltung/Nur lesen 403), Abruf/Download protokolliert,
  `Content-Security-Policy: default-src 'none'`, `Cache-Control: private, no-store`, Pfad-Tricks 404, Inhaltsprüfung
  statt Dateiendung, gelöschte Dateien nur mit Schreibrecht. R2-Bucket privat.
- **Geheimnisse:** keine Schlüssel in Einstellungs-/Sitzungsantworten; Build-Ausgaben ohne `.env`/`.dev.vars`/`data`.
- **kfz-api.de-Webhook:** Signatur vor Verarbeitung geprüft (falsch → 401), PING bestätigt, Wiederholung erkannt,
  nicht zuordenbare Meldung → Zuordnen/Erneut verarbeiten. Antragsübermittlung im Code gesperrt.

### 6. D1-Migrationen und R2 in der Cloudflare-Laufzeit – bestanden

- Gesamte E2E-Suite in **workerd** mit D1 und R2: 42/42, Diagnose meldet Worker + D1- und R2-Bindung, R2
  schreiben/lesen/löschen ok, Schema 6/6 (frische Datenbank, Migrationen 1–6).
- **Upgrade mit echten Altdaten** (ausgelieferter Stand legt 3 Bestellungen mit 6 Unterlagen in R2, Stripe-Zahlung und
  kfz-Meldungen an): Migration 3 → 6 als SQL-Datei (79 Anweisungen, < 1 s) **und** als Laufzeit-Migration – je 11/11:
  Altaufträge mit Zahlung/kfz-Stand, Kundenübernahme, Alt-Unterlagen aus R2 abrufbar, KFZ-Center mit Altmeldungen,
  Benachrichtigungen einmalig übernommen, Finanzen, Nummernkreis läuft weiter, Statusseite, Diagnose.
- **Rollback-Fähigkeit:** die alte Version läuft auf Schema 6 (Bestellung mit Upload, Zahlung, Webhooks ok).

### 7. Rechnungen und Gutschriften – bestanden

- Rechnerisch: netto + USt = brutto; Summe Positionen = Rechnungsbetrag; USt der Positionen = Gesamt-USt (Rundung wird
  der größten Position zugeordnet, keine Ausgleichszeile); jede Position netto + USt = brutto; USt = 19/119 des
  Bruttos; Rabatte nicht doppelt.
- Pflichtangaben (§ 14 Abs. 4 UStG) auf dem Druckbeleg: Name/Anschrift beider Seiten, Steuernummer und USt-IdNr.,
  Rechnungsnummer (fortlaufend `RE-JJJJ-NNNNN`), Rechnungsdatum, **Leistungsdatum** (Tag der Zulassung), Leistung,
  Entgelt, Steuersatz und -betrag, Hinweis auf durchlaufende Posten (Behördengebühren).
- Kleinunternehmer: keine USt, Hinweis nach § 19 UStG.
- Keine Rechnung ohne Unternehmensdaten, keine Doppelrechnung, Gutschrift `GS-…` mit Bezug, exakt negativ, nur einmal;
  Umsatzsteuer-Übersicht: Rechnung + Gutschrift = 0. Rechnungsseite nur mit Finanzrecht.

### 8. Programm-Verknüpfungen und Automatisierungen – bestanden (Lücke behoben)

- Verknüpfungen im Browser: Auftrag → Kunde, → Dateien (Dokumentenmanager mit Auftrag), → E-Mail (Kommunikation mit
  Auftrag); Benachrichtigung → Auftragscenter; Kontrollzentrum-Problem → KFZ-API Center (Filter „zu prüfen“);
  Kennzahl-Kachel → Zulassungsmanager; Startmenü → Papierkorb.
- Automatisierungen per API: Zahlung → In Prüfung (einmal trotz doppelter Zustellung), fehlende Unterlagen → Aufgabe
  (ohne Dublette), Zulassung → Kunden-E-Mail als Entwurf, Behörden-Rückfrage → Aufgabe, Zeitregeln, Regeln
  ein-/ausschalten mit Grenzwertprüfung, Ausführungsprotokoll.

### 9. Testbericht – dieses Dokument · 10. Deploy- und Rollback-Plan – `docs/DEPLOYMENT.md`

---

## Gefundene und behobene Fehler

| # | Schwere | Fehler | Behebung |
|---|---|---|---|
| F1 | **hoch** | Nach „Passwort ändern“ war der Benutzer sofort ausgesperrt: der Router verlängerte nach dem Handler die **alte** Sitzung und überschrieb das neue Cookie | Handler meldet „Sitzung ersetzt“, Router verlängert dann nicht |
| F2 | **hoch** | Worker-Build brach ab: der (in dieser Testphase ergänzte) Ausschluss `./data/**` traf als Teilstring auch `next/dist/lib/metadata/…` – ein Push hätte den Deploy scheitern lassen | Ausschluss nur für Seiten/Routen (`/**`), dort exakt aufgelöst; Build und Ausgabe geprüft |
| F3 | mittel | Anmeldesperre per gefälschtem `X-Forwarded-For` umgehbar, Zähler nur im Speicher einer Instanz | IP aus `cf-connecting-ip`; zusätzliche dauerhafte Sperre über das Protokoll (10/IP, 60 gesamt in 15 Min) für Anmeldung, Entsperren, 2FA, Passwortwechsel |
| F4 | mittel | Lokale Datenbank und Uploads wurden in Build-Ausgaben kopiert (nur lokal; `data/` ist nicht im Repository) | aus der Dateiverfolgung ausgeschlossen, geprüft |
| F5 | mittel | Freigabe trotz Unterzahlung möglich (nur „bezahlt“ geprüft, nicht der Betrag) | Freigabe-Sperre, wenn gebuchte Zahlungen unter dem Auftragsbetrag liegen |
| F6 | mittel | Statuswechsel durch kfz-api.de lösten keine OS-Regeln aus (kein Entwurf bei Zulassung, keine Aufgabe bei Rückfrage) | automatische Schritte laufen als Statusereignis durch dieselben Regeln; kein Entwurf, wenn die Status-E-Mail schon rausging; keine Doppelmeldung |
| F7 | mittel | Einmalige Benachrichtigungs-Übernahme hätte Ereignisse zwischen Deploy und erstem Login doppelt gemeldet | Übernahme nur für Ereignisse vor dem Ereignisprotokoll |
| F8 | niedrig | Rechnung: USt-Rundungsdifferenz und Leistungsdatum (Ausstellungs- statt Zulassungstag) | Rundung auf größte Position, Leistungsdatum = Tag „Zugelassen“ |
| F9 | niedrig | Prozent-Nachlass ohne Begründung möglich; Gutschein-Zähler zählte auch bei abgelehnter Anpassung | Begründung Pflicht; Zähler nur bei gebuchter Anpassung |
| F10 | niedrig | Automatische Aufgabe „Unterlagen anfordern“ konnte doppelt entstehen | offene gleiche Aufgabe am Auftrag wird wiederverwendet |
| F11 | niedrig | Ordnernamen „..“ möglich, Ordner für nicht vorhandenen Auftrag | abgelehnt (422) |
| F12 | niedrig | Zu große Desktop-Einstellungen → 500 | 413 mit Meldung |
| F13 | niedrig | Ungültiger Auftrag in der Verwaltung → 200 mit `ok:false` | 422 mit Feldfehlern, Formular markiert die Felder |
| F14 | niedrig | `test-results/` nicht ignoriert | in `.gitignore` |

---

## Einschränkungen und Empfehlungen (keine Fehler, bewusst offen)

1. **Echte externe Dienste nicht getestet** (gemäß Vorgabe): kein Stripe-Testmodus-Lauf, kein E-Mail-Versand, keine
   kfz-api.de-Abfrage. Signaturen wurden mit eigenen Testgeheimnissen geprüft. Empfehlung nach dem Deploy: Stripe
   „Testereignis senden“ und PING aus dem kfz-api.de-Dashboard (kostenfrei, siehe Smoke-Test).
2. **kfz-api.de setzt Status selbst:** Meldungen der Behörde ziehen den Auftrag nach (auch ohne Freigabe im OS), weil
   die Einreichung derzeit außerhalb erfolgt und die Behördenmeldung maßgeblich ist. Im Verlauf als „Automatisch nach
   Meldung von kfz-api.de“ gekennzeichnet.
3. **Zeitregeln** (Wiedervorlage, Fristen, Erinnerungen) laufen, solange jemand angemeldet ist (alle 5 Minuten) –
   kein Cron-Trigger. Optional später: Cloudflare Cron Trigger.
4. **`SESSION_SECRET` nicht rotieren** ohne Plan: verschlüsselt auch die 2FA-Schlüssel (alle 2FA neu einrichten).
   Keine Wiederherstellungscodes für 2FA; Inhaber-Wiederherstellung über D1 (siehe Deployment-Plan).
5. **Rechnungen:** fachlich nach § 14 UStG geprüft – vor dem ersten Echtbetrieb vom Steuerberater abnehmen lassen
   (insbesondere Behandlung der Behördengebühren als durchlaufende Posten).
6. **Oberflächentest** lief als Skript im Browser (nicht als dauerhafte Testsuite); die API-Suite ist dauerhaft und
   wiederholbar (`npm run test:e2e`). Empfehlung: E2E vor jedem Deploy ausführen.
7. **Rate-Limit:** zusätzlich Cloudflare-WAF-Regel für Anmeldung/Entsperren empfohlen.
8. **Stripe-Dashboard:** Ereignisse `async_payment_succeeded/failed` und `expired` ergänzen, sonst werden
   fehlgeschlagene/abgebrochene Zahlungen nicht erfasst (Code ist bereit).

---

## Wiederholen

```bash
npm run typecheck && npm test && npm run build && npm run test:e2e
```

Migrationstest: Ablauf im Kopf von `scripts/e2e-migration.mjs`.
