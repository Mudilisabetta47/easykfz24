# Widerruf – Vorbereitung (Entwurf, nicht aktiv)

Stand: 13.10.2026 · Code **veröffentlicht am 13.10.2026**, Widerrufsfunktion bleibt bis `WIDERRUF_AKTIV=1` **ausgeschaltet**.
Vor der Freischaltung prüft eine spezialisierte Kanzlei bzw. eRecht24 die gesamte Verbraucherrechtsstrecke.

## 1. Rechtsgrundlagen (geprüft an den amtlichen Fassungen)

- Widerrufsrecht bei Fernabsatzverträgen: §§ 312g, 355, 356 BGB
- Elektronische Widerrufsfunktion: **§ 356a BGB** – Funktion „Vertrag widerrufen“ (fortlaufend während der Widerrufsfrist verfügbar,
  hervorgehoben, leicht zugänglich); Angaben Name, Vertrag, elektronischer Weg für die Eingangsbestätigung; Bestätigungsfunktion
  „Widerruf bestätigen“; unverzügliche Eingangsbestätigung auf dauerhaftem Datenträger mit Inhalt sowie Datum und Uhrzeit des Eingangs;
  fristgerecht abgesendet = fristgerecht zugegangen.
- Muster-Widerrufsbelehrung: Anlage 1 zu Art. 246a § 1 Abs. 2 Satz 2 EGBGB (inkl. Baustein zur Online-Widerrufsfunktion)
- Muster-Widerrufsformular: Anlage 2 zu Art. 246a § 1 Abs. 2 Satz 1 Nr. 1 und § 2 Abs. 2 Nr. 2 EGBGB

## 2. Was vorbereitet ist

| Baustein | Umsetzung |
|---|---|
| Widerrufsbelehrung `/widerrufsbelehrung` | Amtliches Muster für **Dienstleistungen** (Frist ab Vertragsabschluss), Anbieter mit Anschrift, Telefon, E-Mail, Baustein zur Online-Funktion, Folgen des Widerrufs; Muster-Widerrufsformular mit Anbieterangaben; druckbar |
| Widerrufsfunktion `/widerruf` | Schritt 1: Name, Vertrag (z. B. Auftragsnummer), E-Mail für die Eingangsbestätigung · Schritt 2: Erklärung prüfen und **„Widerruf bestätigen“** · Schritt 3: Eingangsbestätigung mit Datum, Uhrzeit, Vorgangsnummer und Inhalt |
| Eingangsbestätigung | E-Mail an die angegebene Adresse (dauerhafter Datenträger) mit Inhalt der Erklärung, Datum und Uhrzeit des Eingangs und Vorgangsnummer; Versandzustand wird gespeichert. Ohne E-Mail-Dienst (lokal) wird „nicht versendet“ festgehalten und auf der Seite angezeigt – **für den Livebetrieb ist Resend Voraussetzung** |
| Speicherung | Neue Tabelle `withdrawals` (Migration v7, nur additiv): Vorgangsnummer, Eingang (Datum/Uhrzeit), Name, Vertragsangabe, E-Mail, Erklärung, zugeordneter Auftrag, Versandzustand, Bearbeitungsvermerk |
| Zuordnung | Eine Auftragsnummer (EK-JJJJ-NNNNN) in der Vertragsangabe wird dem Auftrag zugeordnet. Fehlende oder unbekannte Nummer verhindert den Widerruf **nicht** |
| Team | OS-Ereignis `order.withdrawal` und **kritische** Benachrichtigung „Widerruf eingegangen“ (Auftrag, Vorgangsnummer) |
| Erreichbarkeit | Footer auf jeder Seite („Widerrufsbelehrung“, „Vertrag widerrufen“), Statusseite, Bestellbestätigung, Hinweis im letzten Bestellschritt |
| Schutz | 10 Erklärungen pro Stunde und IP (Missbrauchsschutz); Hinweis auf Widerruf per E-Mail/Post als Ausweg |

**Nicht verändert:** Bestellablauf, Pflichtfelder, Zahlungen, Auftragsstatus, Rückzahlungen. Ein Widerruf ändert nichts automatisch –
die Bearbeitung erfolgt durch das Team im OS.

## 3. Schalter und Veröffentlichung

- `WIDERRUF_AKTIV=1` schaltet Seiten, Schnittstelle und Links frei. Ohne Schalter liefert der Produktivbetrieb **404** (E2E-Test belegt das);
  lokal ist die Strecke als Vorschau mit Entwurfshinweis sichtbar.
- Da statische Seiten den Schalter beim Build lesen, muss `WIDERRUF_AKTIV=1` auch in den Build-Variablen von Cloudflare gesetzt werden.
- Die Migration v7 läuft beim ersten Datenbankzugriff nach einer Veröffentlichung automatisch – sie ist rein additiv, wird aber nur mit
  Freigabe veröffentlicht.

## 4. Ablauf (Soll)

1. Kunde öffnet „Vertrag widerrufen“ (Footer, Statusseite, Bestätigung, E-Mail) → gibt Name, Vertrag und E-Mail an.
2. Kunde prüft die Erklärung und klickt „Widerruf bestätigen“.
3. System speichert den Eingang (Datum/Uhrzeit), sendet unverzüglich die Eingangsbestätigung, meldet den Widerruf dem Team.
4. Team prüft im OS: Auftrag zuordnen, Bearbeitung stoppen bzw. nicht einreichen, Rückzahlung **spätestens 14 Tage ab Eingang**
   über das ursprüngliche Zahlungsmittel, Vermerk „bearbeitet“. *(Rückzahlungs- und Stornierungsschritte werden erst nach Freigabe gebaut.)*

## 5. Erforderliche Kundeninformationen (vor Vertragsschluss / Vertragsbestätigung)

- Bedingungen, Fristen und Verfahren für die Ausübung des Widerrufsrechts sowie das Muster-Widerrufsformular (Belehrung, verlinkt im letzten Bestellschritt)
- Identität, Anschrift, Telefon und E-Mail des Unternehmers (bereits im Checkout und Impressum)
- **Vertragsbestätigung auf einem dauerhaften Datenträger** mit Vertragsinhalt und Widerrufsbelehrung – Teil der Resend-Umsetzung
- Hinweis auf die Online-Widerrufsfunktion (in der Belehrung enthalten)

## 6. Offene Punkte für die Kanzlei / eRecht24 (bewusst nicht umgesetzt)

1. **Beginn der Dienstleistung während der Widerrufsfrist**: ausdrückliches Verlangen im Bestellablauf? Wertersatz-Baustein des Musters?
2. **Erlöschen des Widerrufsrechts** nach vollständiger Erbringung: ob und wie zu belehren und einzuholen?
3. **Kennzeichenschilder** (nach Kundenvorgabe geprägt) als Teil eines gemischten Vertrags: Ausnahme vom Widerrufsrecht? Bausteine zu Waren/Rücksendung?
4. **Amtliche Gebühren** und bereits verauslagte Kosten bei Widerruf.
5. Endgültige Texte von Belehrung, Formular, Funktion, Eingangsbestätigung, Footer- und Checkout-Hinweisen.
6. AGB / weitere Kundeninformationen (technische Schritte zum Vertragsschluss, Speicherung des Vertragstextes, Sprache).

## 7. Tests

- `tests/withdrawal.test.ts`: amtliche Texte, Anbieterangaben, Online-Baustein, **keine** Sonderregeln zu Beginn/Wertersatz/Erlöschen in der Belehrung,
  Beschriftungen nach § 356a, Eingangsbestätigung mit Datum und Uhrzeit, Schalter, Speicherung und Zuordnung ohne Änderung am Auftrag.
- E2E: ohne Freischaltung sind `/widerruf`, `/widerrufsbelehrung` und `/api/widerruf` nicht erreichbar, kein Footer-Link.
- Browser (lokal): kompletter Ablauf mit Testauftrag EK-2026-00004 → Eingangsbestätigung, kritische OS-Benachrichtigung, Auftrag unverändert.
