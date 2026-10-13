# Testbericht: Kennzeichenschilder Carbon-Optik und Express-Bearbeitung

Stand 12.10.2026 · lokal entwickelt und getestet · **veröffentlicht am 13.10.2026** (Freigabe Inhaber).
Keine D1-Migration nötig: Preise und Einstellungen liegen als versionierte Einträge in der Tabelle `settings`,
Bestellangaben und Kosten im bestehenden Auftrag (`data_json`, `price_json`).

## Ergebnis

| Prüfung | Ergebnis |
|---|---|
| Unit- und Integrationstests | **148/148** (neu: 7 Carbon, 6 Express) |
| E2E Node-Server | **54/54** (neu: 6 Carbon, 6 Express) |
| E2E Cloudflare-Laufzeit (workerd, D1, R2) | **54/54** |
| Verwaltungs-Endpunkte | 105 (neu: Schilderpreise, Express-Einstellungen je lesen/speichern), jeder mit Anmeldung, Rechten und Fehlerfällen geprüft |
| Browser | Bestellassistent Carbon (Auswahl, Vorschau, Preis), Startseite Kennzeichen- und Express-Karte; keine Konsolenfehler |

---

## Kennzeichenschilder: Standard und Carbon-Optik

**Umgesetzt**
- Auswahl Standard / Carbon-Optik (Premium) im Bestellassistenten und im Auftragsformular der Verwaltung; Vorschau
  unterscheidet sich (Carbon-Rahmen, Schildfeld weiß reflektierend, „Vorschau schematisch“).
- Preis automatisch: Position „Kennzeichenschilder Carbon-Optik (2 Stück)“ mit Stückzahl und Einzelpreis; im
  Komplett-Paket nur der Aufpreis je Schild zusätzlich.
- Sichtbar in Bestellung, Rechnung (identische Positionsbezeichnung), Auftragsakte, Liste/Kanban („Carbon“),
  Druckansicht und Übermittlungsdaten („2 × Carbon-Optik – beim Zulassungspartner genau diese Ausführung wählen“).
- Preisverwaltung im Finanzcenter: Verkauf (brutto) und Einkauf (netto) je Ausführung, Versand des Lieferanten,
  nummerierte Preisversionen mit Verlauf. Preisänderungen gelten sofort für Website und neue Aufträge.
- Website-Preise (Startseite, Preistabelle, Ortsseiten) kommen aus derselben Quelle → angezeigter = berechneter Preis.
- Wirtschaftlichkeit: Jeder Auftrag speichert beim Bestellen Einkauf, Versand des Lieferanten und Preisversion
  (unveränderlich). Deckungsbeitrag = Netto − Vorgangskosten − Schilder-Einkauf − Lieferanten-Versand − Zahlungsgebühr;
  Auswertung je Ausführung mit anteiliger Zahlungsgebühr. Unbekannte Kosten werden nicht geschätzt.
- Carbon erst im Angebot mit Verkaufspreis, „anbieten“ **und** den Bestätigungen „lieferbar beim Lieferanten“ und
  „zulässig (DIN, Schildfeld weiß reflektierend)“.

**Getestet:** Standard und Carbon mit je 1 Schild (Motorrad) und 2 Schildern (Pkw), Paket, Rechnung,
Preisänderung ohne Wirkung auf alte Aufträge, Deckungsbeitrag mit/ohne Lieferanten-Versand, Rechte (Einkaufspreise nur
mit Finanzrecht), Deaktivierung.

**Offen (deine Entscheidung im Finanzcenter):** Verkaufspreis Carbon (Vorschlag: so wählen, dass der DB je Schild
mindestens dem von Standard entspricht – bei 12,99 € Standard z. B. 14,49 €–14,99 €), Versandkosten des Lieferanten,
die beiden Bestätigungen. Optik der Vorschau mit dem Produktbild im kfz-api.de-Dashboard abgleichen.

---

## Express-Bearbeitung

**Umgesetzt**
- Bestellassistent: Abschnitt „Express-Zulassung – bevorzugte Bearbeitung*“ mit Einschränkung direkt darunter,
  Ablauf-Darstellung (keine Countdown-Zahlen), Stufen Standard / Express (+19,90 €) / Express Plus (+29,90 €), Aufpreis
  als eigene Position (nicht rabattiert, nicht Teil des Pakets). Aufpreise, interne Kosten, interne Fristen und
  Express-Plus-Leistungen im Finanzcenter änderbar (versioniert). **Ausgangszustand: nicht im Angebot.**
- Verwaltung: Abzeichen „Express“/„Express+“, eigene **Express-Warteschlange** (bezahlte zuerst, dann interne Frist;
  Hinweise auf fehlende Unterlagen/Sicherheitscodes; Verzögerungen rot), Akte mit **Zeitstempeln** (Eingang, Zahlung,
  Unterlagen vollständig, Prüfung, Freigabe, Übertragung, Behörde, Ergebnis).
- Automatisierung: Express bezahlt → Priorität (Express „hoch“, Express Plus „dringend“), interne Frist, Express Plus
  an Ansprechperson; Rückfrage bei Express Plus → dringende Rückruf-Aufgabe. Fristüberschreitung → bestehende Warnung.
- Kunde: Express-Statusseite mit Meilensteinen nur aus echten Ereignissen; bei manueller Behördenprüfung Hinweis
  „Dauer liegt allein bei der Behörde“, keine Zeitangabe.
- Finanzcenter „Express“: Aufpreise, Zusatzkosten, anteilige Zahlungsgebühr, Deckungsbeitrag, Anzahl abgeschlossener
  Aufträge, interne Frist eingehalten (ja/nein/offen), tatsächliche Bearbeitungsdauer je Abschnitt (Median, Ø, Anzahl)
  für Standard, Express und Express Plus.

### Welche Express-Versprechen wir zuverlässig erfüllen können

| Versprechen | Erfüllbar? | Warum |
|---|---|---|
| Vorrang in **unserer** Prüfung und Einreichung nach Zahlung und vollständigen Unterlagen | **ja** | Automatische Priorität, eigene Warteschlange, Sortierung, interne Frist mit Warnung |
| Feste Ansprechperson (Express Plus) | **ja**, wenn im Automatisierungs-Regelwerk eine Person eingestellt ist | Zuweisung automatisch nach Zahlung |
| Rückruf bei Rückfragen der Behörde (Express Plus) | **ja**, während der Geschäftszeiten | Aufgabe „Kunde zurückrufen“ entsteht automatisch – Erledigung hängt von Personal ab |
| Transparenter Status mit Zeitpunkten | **ja** | Meilensteine aus echten Ereignissen |
| „Zulassung in 24 Stunden“ | **nein – nicht verwenden** | Produktion hat noch keine Aufträge; ohne belastbare Bearbeitungsdaten nicht belegbar, und die Behörde entscheidet über ihre Dauer (FORWARDED = manuelle Prüfung) |
| Schnellere Entscheidung der Behörde / sofortige Inbetriebsetzung | **nein** | nicht von uns beeinflussbar; ob eine automatisierte Entscheidung möglich ist, dokumentiert kfz-api.de öffentlich nicht je Vorgangsart |
| Statusmails zu jedem Schritt | **derzeit nein** | E-Mail-Versand in Produktion nicht eingerichtet – deshalb nicht in den Standard-Leistungen von Express Plus |

### Werbetext und § 5 UWG (Irreführung) – Einschätzung, keine Rechtsberatung

- Hauptaussage „Express-Zulassung – bevorzugte Bearbeitung*“: das Sternchen steht direkt an der Aussage, die
  Einschränkung steht unmittelbar darunter, gut lesbar, ohne Klick. Kein Zeitversprechen, keine Garantie, kein Countdown.
- Restrisiko: Der Begriff „Express-Zulassung“ kann für sich eine schnellere *Zulassung* nahelegen. Durch den direkt
  folgenden Hinweis („Über die Zulassung entscheidet die Zulassungsbehörde … keine Fristzusage“) gemindert; noch
  vorsichtiger wäre „Express-Bearbeitung“. Empfehlung: vor Freischaltung kurz anwaltlich prüfen lassen.
- „Zulassung in 24 Stunden*“ erst verwenden, wenn die Auswertung „Tatsächliche Bearbeitungsdauer“ über eine
  ausreichende Zahl von Aufträgen belegt, dass dies **in der Regel** eingehalten wird – und auch dann nur mit Angabe, wofür
  die 24 Stunden gelten (z. B. bis zur Einreichung) und dass die Behörde die Dauer bestimmt.

**Getestet:** Einstellungen und Rechte, nicht angebotene Stufe abgelehnt, Startseite (Sternchen + Einschränkung, keine
Fristzusage), Express-Plus-Bestellung mit Aufpreis und Kosten-Momentaufnahme, Warteschlange, Priorisierung nach
Stripe-Zahlung (interne Frist ~12 h), alle Meilensteine inkl. manueller Behördenprüfung, Rückruf-Aufgabe genau einmal,
Finanzauswertung (Aufpreis − Zusatzkosten − Gebührenanteil, Dauern, interne Frist eingehalten).

---

## Nebenbei gefunden und behoben

| Schwere | Befund | Behebung |
|---|---|---|
| **hoch** (latent) | Auftragsliste fragte Dokumente mit bis zu 500 IDs in einer Abfrage ab – Cloudflare D1 erlaubt höchstens 100 Parameter. Ab ~100 Aufträgen wäre die Liste in Produktion fehlgeschlagen (lokal unauffällig) | Abfragen in Blöcken (`allIn`), auch für alle neuen Auswertungen |
| mittel | Deckungsbeitrag berücksichtigte keine Schilder-Einkaufskosten | Einkauf und Lieferanten-Versand je Auftrag gespeichert und abgezogen |
| niedrig | Hinweis im KFZ-API-Panel „Anlage-Endpunkte nicht dokumentiert“ veraltet | Text korrigiert (Endpunkte öffentlich dokumentiert; gesperrt mangels Freigabe) |

## Wunschkennzeichen-Verfügbarkeit (Recherche)

Öffentlich dokumentiert (kfz-api.de/api, /preise): **kein Endpunkt für eine Verfügbarkeitsprüfung**; Reservierung nur
**im Antrag** (`licensePlateReservationIncluded`, 4,00 € + amtliche Gebühren ab 12,80 €). Reservierungsnummer, PIN und
Ablaufdatum: öffentlich nicht beschrieben (vollständige Doku hinter dem Login). Umsetzung: Vorschläge zeigen nur
„Verfügbar“/„Nicht verfügbar“, wenn eine autorisierte Quelle antwortet; sonst „Verfügbarkeit momentan unbekannt“ mit
Hinweis, dass verbindlich erst bei der Reservierung geprüft wird. Erzeugte Vorschläge werden nie als verfügbar markiert.
