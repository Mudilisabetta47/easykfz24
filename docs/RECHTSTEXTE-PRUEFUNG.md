# Rechtstexte zur anwaltlichen Prüfung

Stand: 13.10.2026 · Nichts hiervon ist ohne Prüfung veröffentlicht. Alle Funktionen sind technisch vorbereitet und per Schalter aus.

## 1. Widerruf (Schalter `WIDERRUF_AKTIV`, derzeit aus)

| Baustein | Ort | Prüfpunkt |
|---|---|---|
| Widerrufsbelehrung | `src/lib/withdrawal.ts` → `withdrawalNotice`, Seite `/widerrufsbelehrung` | Muster nach Anlage 1 zu Art. 246a EGBGB, angepasst auf Dienstleistung; Fristbeginn |
| Muster-Widerrufsformular | `WITHDRAWAL_FORM`, Seite `/widerruf` | Anlage 2 zu Art. 246a EGBGB |
| Elektronische Widerrufsfunktion | `/widerruf` (§ 356a BGB), Eingangsbestätigung per E-Mail | Pflicht seit 19.06.2026; Beschriftung „Vertrag widerrufen“ / „Widerruf bestätigen“ |
| **Vorzeitiger Leistungsbeginn** | Bestellabschluss (`OrderWizard`, Kennzeichnung „RECHTLICH ZU PRÜFEN“), Zeitpunkt in `finish.vorzeitigerBeginnAt` | Wortlaut nach § 356 Abs. 4, § 357a Abs. 2 BGB; **optional oder Pflicht?** Derzeit optional: ohne Erklärung meldet das OS „Bearbeitung erst nach Ablauf der Widerrufsfrist“ |
| Bestätigung in der Vertragsmail | `orderConfirmationMail` | Belehrung und Bestätigung des vorzeitigen Beginns nur mit `WIDERRUF_AKTIV=1` |

## 2. Vertragsbestätigung (§ 312f BGB)

Automatische Bestell- und Vertragsbestätigung ist umgesetzt (`src/lib/mail-templates.ts`, `orderContractInfo`):
Vertragspartner, Leistung, Preise inkl. MwSt. zzgl. amtlicher Gebühren, Zahlung, Bearbeitungsbeginn, Statusabfrage.
Prüfen: Vollständigkeit der Informationen nach Art. 246a § 1 EGBGB; ob AGB erforderlich sind (derzeit keine).

## 3. Bestellbutton und Pflichtinformationen vor Vertragsschluss

- Button „Zahlungspflichtig beauftragen“ (§ 312j Abs. 3 BGB) ✅
- Vertragspartner mit Anschrift und Kontakt vor dem Button ✅; Preis vor dem Absenden ✅
- Widerrufshinweis vor dem Button: nur mit `WIDERRUF_AKTIV=1` ⚠️

## 4. Datenschutzerklärung – Ergänzungsvorschläge (NICHT veröffentlicht)

Veröffentlicht ist bisher nur der Absatz zu Mollie B.V. (Firmendaten laut Mollie-Impressum). Vorschläge zur Prüfung –
Firmendaten in eckigen Klammern **vor Veröffentlichung beim jeweiligen Anbieter verifizieren** (hier bewusst nicht erfunden):

- **E-Mail-Versand (Resend):** „Für den Versand von Auftrags- und Statusmails nutzen wir den Dienst Resend ([Rechtsträger und
  Anschrift laut Resend-AVV]). Übermittelt werden Ihre E-Mail-Adresse und der Inhalt der Nachricht. Rechtsgrundlage: Art. 6 Abs. 1
  lit. b DSGVO; Auftragsverarbeitung nach Art. 28 DSGVO; Übermittlung in Drittländer [Grundlage laut AVV, z. B. EU-US Data Privacy
  Framework / Standardvertragsklauseln].“
- **Zulassungsschnittstelle (kfz-api.de):** „Für die elektronische Antragstellung beim Kraftfahrt-Bundesamt (i-Kfz) übermitteln
  wir die erforderlichen Antrags-, Halter- und Fahrzeugdaten an [Betreiber von kfz-api.de laut Impressum], der als
  [Auftragsverarbeiter / eigener Verantwortlicher – vertraglich klären] tätig ist. Rechtsgrundlage: Art. 6 Abs. 1 lit. b und c DSGVO.“
- **Digitale Vollmacht (Nect):** „Für die Online-Unterschrift der Vollmacht identifizieren Sie sich bei der [Nect GmbH, Anschrift
  laut Nect-Impressum] per Ausweis und Video. Nect verarbeitet dabei Ausweis- und biometrische Daten [Rolle und Rechtsgrundlage
  laut Vertrag/Datenschutzerklärung von Nect]. Wir erhalten nur den Stand der Unterschrift, keine Ausweiskopie.“
- **Hosting:** Cloudflare (Worker, Datenbank D1, Dateispeicher R2 in der EU) – Rechtsträger und Übermittlungsgrundlage laut
  Cloudflare-DPA ergänzen; Platzhalter „Hosting“ ersetzen.
- **Speicherdauer:** Platzhalter auf der Seite – Löschfristen festlegen (Aufbewahrung nach HGB/AO beachten).
- Markierung „Entwurf“ auf der Datenschutzseite erst nach Prüfung entfernen.

## 5. Rechnungen (Steuerberatung)

- Steuernummer bzw. USt-IdNr. fehlen (Rechnungserstellung gesperrt) – **vom Inhaber/der Steuerberatung einzutragen**.
- Umsatzsteuerliche Behandlung: Regelbesteuerung 19 % hinterlegt – bestätigen (oder Kleinunternehmer § 19 UStG).
- Korrekturrechnungen heißen jetzt „Stornorechnung (Rechnungskorrektur)“ statt „Gutschrift“ (Begriff ist der Abrechnung durch den
  Leistungsempfänger vorbehalten) – bestätigen.
- Amtliche Gebühren als durchlaufende Posten: derzeit nicht auf der Rechnung (Hinweistext) – Verfahren festlegen.
- Leistungsdatum = Datum „Zugelassen“; für Abmeldungen und Ummeldungen bestätigen.
