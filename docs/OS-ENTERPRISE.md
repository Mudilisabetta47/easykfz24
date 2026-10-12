# EasyKFZ24 OS – Enterprise Edition: Bestandsaufnahme und Fahrplan

Stand: 12.10.2026 · lebendes Dokument, wird nach jeder Phase fortgeschrieben.

## Phase 1 – Bestandsaufnahme

### Infrastruktur (bleibt erhalten)

| Baustein | Stand |
|---|---|
| Laufzeit | Cloudflare Worker `easykfz24` (OpenNext), lokal Node.js + SQLite-Datei |
| Datenbank | D1 `easykfz24` (Binding `DB`), Migrationen zur Laufzeit über `schema_migrations` (v1–v5) |
| Dateien | R2 `easykfz24-uploads` (EU, privat, Binding `UPLOADS`), lokal `data/uploads` |
| Zahlung | Stripe Checkout + signierter Webhook (`/api/zahlung/*`), ohne Schlüssel manuelle Pflege |
| kfz-api.de | signierter Webhook (HMAC, Dedupe über `X-Event-Id`), lesender Belegabruf, Verbindungstest (nur lesen) |
| E-Mail | Resend (HTTP) bzw. SMTP lokal; Statusmails an Kunden über `notifications` protokolliert |

### Tabellen

`orders`, `order_counters`, `documents`, `events` (Auftragsverlauf), `notes` (+ Autor, Papierkorb), `kfz_webhook_events`,
`notifications` (ausgehende Kundenmails), `users`, `audit_log`, `settings`.

### Programme – was funktioniert

| Programm | Funktioniert heute (echte Daten) |
|---|---|
| Kontrollzentrum | Kennzahlen (neu, in Bearbeitung, bei Zulassungsstelle, erledigt), Umsatz bezahlt/offen, Median-Bearbeitungszeit, 30-Tage-Diagramme, Status-Verteilung, Systemstatus, Webhook-Ereignisse, neueste Aufträge |
| Auftragscenter | Liste mit Suche/Statusfilter, Akte mit Statuswechsel (Workflow-Prüfung), Checkliste, Kennzeichen, Zahlung, Versand, KFZ-API-Verknüpfung, Notizen (mit Papierkorb), Verlauf mit Bearbeitername, Druckansicht |
| Kundenverwaltung | aus Aufträgen abgeleitet (E-Mail), Kontakt, Fahrzeuge, Auftragshistorie |
| Zulassungsmanager | Spalten nach Bearbeitungsstand, Filter nach Vorgangsart |
| Dokumentenmanager | Ordner je Auftrag, Liste, Vorschau (PDF/Bild) über geschützte Route, Download, Zugriff protokolliert |
| KFZ-API Center | Webhook-/API-Status, Ereignisprotokoll mit Filter, Zuordnung nicht zugeordneter Meldungen, Verbindungstest, Selbsttest |
| Finanzcenter | Umsatz/bezahlt/offen/erstattet/Rabatte, Monatsdiagramm, Umsatz je Leistung, Einkaufskosten je Leistung (pflegbar) → Marge, Zahlungsliste |
| Benachrichtigungen | aus echten Ereignissen abgeleitet, Filter, Sprung zum Auftrag, Hinweise am Desktop |
| Papierkorb | gelöschte Notizen wiederherstellen / endgültig löschen (Recht „Einstellungen verwalten“) |
| Systemeinstellungen | Konto, Benutzer & Rollen (anlegen, Rolle, sperren, Passwort), Design, Sperrzeit, Protokoll, Systemstatus |
| Desktop | Fenster (ziehen, Größe, minimieren/maximieren, Snap-Layouts, Rand-Einrasten mit Vorschau), Taskleiste, Startmenü, Suche, Schnellmenü, Schnellzugriff (Alt+X), Kontextmenüs, Raster-Symbole (ziehbar), Startbildschirm mit echten Prüfungen, Sperrbildschirm, Tastenkombinationen, Zustand pro Benutzer |

### Sicherheit – vorhanden

Sitzung v2 (signiert, HttpOnly, SameSite=Strict, Leerlauf + 12 h absolut), PBKDF2-Passwörter, 5 Rollen / 11 Rechte serverseitig,
Same-Origin- und JSON-Pflicht für Änderungen, Anmeldebegrenzung, Audit-Protokoll, Dokumente nur über geschützte Routen.

### Lücken gegenüber dem Auftrag „OS 2.0“

| Bereich | Fehlt |
|---|---|
| Daten | eigene Kundentabelle (heute nur abgeleitet), Firmen mit Standorten/Ansprechpartnern, Fahrzeugstamm, Aufgaben, Rechnungen/Gutschriften, Zahlungsbuchungen mit Gebühren, Nachrichten/Vorlagen, Automatisierungsregeln, Ereignisprotokoll, Lesestatus pro Benutzer, Sitzungsregister, 2FA |
| Auftragscenter | Auftrag manuell anlegen, Zuweisung, Priorität, Fristen, Wiedervorlagen, Sammelaktionen, Export CSV/Excel/PDF, Kanban nach Arbeitsphasen, Fehlererkennung |
| Zulassung | Vollständigkeits-/Pflichtfeldprüfung je Vorgang, FIN-Prüfziffer, Sicherheitscodes, manuelle Freigabe vor Übermittlung |
| Dokumente | Upload im Explorer, Umbenennen, Kategorien, Versionen, Ablaufdaten, Archiv, Papierkorb, Kachelansicht |
| Finanzen | Rechnungen, Gutschriften, offene Posten, Zahlungsabgleich, Gebühren, Netto/USt/Brutto, Gutscheine, Geschäftskundenpreise, Berichte, Export |
| Organisation | Aufgabencenter, Kommunikationszentrale |
| OS | virtuelle Arbeitsflächen, Programmwechsler (Alt+Tab-artig), Kalender, Akzentfarbe, Symbolgröße |

### Grenzen, die ich nicht „wegprogrammiere“

1. **Übermittlung an kfz-api.de:** Im Projekt sind nur Webhook, Belegabruf und eine lesende Liste dokumentiert. Endpunkte zum
   Anlegen von Anträgen sind nicht belegt (Dokumentation nur nach Login). Ich baue Prüfung, Freigabe-Schritt und Sperre;
   die eigentliche Übermittlung bleibt aus, bis Dokumentation, KBA-Freischaltung und deine ausdrückliche Freigabe vorliegen.
2. **Posteingang:** Eingehende Kundenmails brauchen eine E-Mail-Anbindung (z. B. Cloudflare Email Routing → Worker). Bis dahin
   nur ausgehende Nachrichten mit echtem Versandstatus – keine simulierten Eingänge.
3. **Rechnungen und Steuer:** Unternehmensdaten auf der Website sind noch Platzhalter. Rechnungen werden erst ausstellbar,
   wenn Firmendaten und Steuerstatus (Regelbesteuerung 19 % oder Kleinunternehmer § 19 UStG) gepflegt sind; amtliche Gebühren
   als durchlaufende Posten. Rechtliche/steuerliche Prüfung erforderlich (MONVEX UG i. G.).
4. **Zahlungsgebühren:** Echte Werte nur aus Stripe (Balance Transaction) oder manueller Eingabe – keine Schätzungen als Ist-Wert.

## Phase 2 – Gemeinsame Architektur (erledigt)

| Baustein | Umsetzung |
|---|---|
| Datenbasis | Migration v6 (nur Ergänzungen): Kunden, Standorte, Ansprechpartner, Fahrzeuge, Aufgaben + Kommentare, Zahlungsbuchungen, Rechnungen/Gutschriften mit Nummernkreisen, Gutscheine, Nachrichten + Vorlagen, Ereignisprotokoll, Automatisierungsregeln + Läufe, Benachrichtigungen + Lesestatus, Benutzereinstellungen, Sitzungsregister; Aufträge: Kunde, Fahrzeug, Zuständig, Priorität, Frist, Wiedervorlage, Freigabe, Prüfpunkte; Dokumente: Name, Kategorie, Ordner, Versionen, Ablauf, Archiv, Papierkorb, Prüfvermerk |
| Ereignisse | `server/os/events.ts`: jede fachliche Änderung = ein Ereignis mit eindeutigem Schlüssel → Benachrichtigung + Automatisierung genau einmal (auch bei Webhook-Neuzustellung) |
| Kundenstamm | Bestellungen werden per E-Mail dem bestehenden Kunden zugeordnet (bestehende Aufträge einmalig übernommen), Fahrzeuge je FIN, Dubletten, Zusammenführen, DSGVO-Auskunft, Löschprüfung + Anonymisierung |
| Fachregeln | `lib/workflow.ts`: Arbeitsphasen (Kanban) aus echten Feldern, Fehlererkennung, FIN-Prüfung, Sicherheitscodes je Vorgang, Freigabe-Sperren |
| Automatisierung | 9 Regeln mit Protokoll und Doppelschutz; nichts Kostenpflichtiges, keine automatische Kundenmail (nur Entwürfe) |
| Finanzen | Zahlungsbuchungen (Stripe-Gebühr als Ist-Wert), Netto/USt/Brutto je Steuerstatus, Deckungsbeitrag je Auftrag, Rechnungen nur mit vollständigen Firmendaten, Gutschrift statt Löschen, offene Posten, Abgleich |
| Schnittstelle | modular (`server/os/routes/*`), jede Route mit Pflichtrecht, Export CSV/XLSX, Upload multipart |
| Rechte | neu: Kunden bearbeiten, Dokumente bearbeiten, Team-Aufgaben, E-Mail-Versand, Automatisierungen |
| Tests | 132 automatisierte Tests (12 neu: Kundenzuordnung, Doppelschutz, Automatisierung, Freigabe, Rechnungen, Webhook-Neuzustellung, Dubletten, Export) |

## Phasen 3–5 – Programme und Betriebssystem (umgesetzt)

| Programm | Neu |
|---|---|
| Kontrollzentrum | Umsatz heute/Woche/Monat/Jahr mit Vorzeitraum, laufende Zulassungen, neue Kunden, Ø/Median-Bearbeitungsdauer, Erfolgsquote, Stornos und abgebrochene Bezahlvorgänge, fehlende Dokumente, Zahlungsprobleme, Webhook-Zustellung inkl. Neuzustellungen, D1/R2/Cloudflare-Zustand, eigene Aufgaben, priorisierte Probleme mit Sprungziel, Zeitraum 7/30/90/365 Tage, Widgets ein-/ausblendbar |
| Auftragscenter | Anlegen und Duplizieren (gleiche Prüfung wie Website), Filter (Datum, Kunde, FIN, Status, Phase, Leistung, Zahlung, Zuständig, Priorität, Frist, Probleme), Kanban nach Arbeitsphasen mit Ziehen-und-Ablegen (serverseitig validiert), Sammelaktionen, CSV/Excel, Druck/PDF, Akte mit 9 Registern (Prüfung, Planung, Freigabe mit Sicherheitscodes, Unterlagen mit Upload und Prüfvermerk, Zahlung & Rechnung, KFZ-API mit Statusverlauf, Kommunikation, Aufgaben, Verlauf + Systemereignisse) |
| Kundenverwaltung | Kundenstamm (Privat/Geschäft), Standorte, Ansprechpartner, Fahrzeuge, Historie, Dokumente, Kommunikation, Rechnungen, offene Zahlungen, Kategorien, Verantwortliche, Wiedervorlagen, Dubletten + Zusammenführen, Export, DSGVO-Auskunft und Anonymisierung mit Aufbewahrungsprüfung |
| Zulassungsmanager | Arbeitsschritte Prüfen → Freigeben → Übergeben → Überwachen → Rückfragen/Ablehnungen, Anforderungen je Vorgangsart, FIN-Prüfung, Sicherheitscodes, Übermittlung gesperrt |
| Dokumentenmanager | Ordner/Unterordner, Listen-/Detail-/Kachelansicht, Vorschau (Bild-Zoom/Drehen, PDF-Betrachter), Upload per Ziehen, Mehrfachauswahl, Umbenennen, Kategorien, Versionen, Ablaufdaten, Archiv, Papierkorb, Zugriffsprotokoll |
| KFZ-API Center | Status, Ereignisprotokoll mit Neuzustellungen, kontrolliert erneut verarbeiten, Zuordnen, Datenabgleich, Status-/HTTP-Erklärungen, Limits/Gebühren aus dem Vertrag |
| Finanzcenter | Zeiträume, Netto/USt/Brutto je Steuerstatus, Deckungsbeitrag je Auftrag, Rechnungen + Gutschriften (Druck/PDF), offene Posten, Zahlungsabgleich, Stripe-Gebühr als Ist-Wert, Gutscheine, Preisanpassung je Auftrag, Einkaufskosten, USt-Übersicht, Export |
| Aufgabencenter (neu) | Meine/Nicht zugewiesen/Team, Prioritäten, Fristen, Erinnerungen, Kommentare, Bezug zu Auftrag/Kunde |
| Kommunikationszentrale (neu) | Vorlagen mit echten Platzhaltern, Entwürfe (auch aus Automatisierung), Versand mit echtem Status, Verlauf, Statusmails; Posteingang ehrlich als „nicht angebunden“ |
| Benachrichtigungen | gespeichert, je Benutzer gelesen/ungelesen, Kategorien, Prioritäten, Einstellungen je Art (Desktop/E-Mail), Browser-Benachrichtigung nach Zustimmung |
| Systemsteuerung | Konto (Passwort, Zwei-Faktor TOTP, Sitzungen), Benutzer (E-Mail, Sitzungen beenden), Unternehmen (Firmendaten, Steuer, Rechnung, Absender, Geschäftszeiten), Design (Akzentfarbe, Hintergrund, Symbolgröße, Einrasten, maximiert öffnen), Benachrichtigungen, Sicherheit + Protokoll, Automatisierungen, Integrationen, Diagnose (D1/R2-Test) |
| Desktop | Startbildschirm mit echten Prüfungen, Sperrbildschirm mit 2FA, Snap-Layouts, Rand-Einrasten, Programmwechsler (⌥Q), 3 Arbeitsflächen (⌥1–3), Kalender mit Fristen, Schnellmenü, Schnellaktionen, Einstellungen pro Benutzer auf dem Server |

## Fahrplan

| Phase | Inhalt | Status |
|---|---|---|
| 1 | Bestandsaufnahme | erledigt |
| 2 | Gemeinsame Architektur: Ereignisprotokoll, Automatisierungs-Kern, Kunden-/Fahrzeugstamm mit Migration, Aufgaben, Lesestatus, modulare API | erledigt |
| 3 | Kernprogramme: Auftragscenter (ERP), CRM, Zulassungsmanager, Dokumentenmanager, KFZ-API Center | erledigt |
| 4 | Finanzcenter, Benachrichtigungen, Aufgabencenter, Kommunikationszentrale | erledigt |
| 5 | OS-Funktionen (Arbeitsflächen, Programmwechsler, Kalender, Personalisierung, 2FA, Sitzungsregister) | erledigt |
| 6 | Qualitätssicherung: 101 Endpunkte, Abläufe, Stripe/Webhooks, Sicherheit, D1/R2 in workerd, Migration 3→6, Rechnungen, Oberfläche – siehe `docs/TESTBERICHT.md` | erledigt |
| 7 | Migration auf D1 und Deploy **nur nach Freigabe** – Ablauf und Rollback in `docs/DEPLOYMENT.md` | wartet auf Freigabe |
