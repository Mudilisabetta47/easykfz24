# Impressum und Anbieterangaben – Prüfung und Korrektur

Stand: 13.10.2026 · **veröffentlicht am 13.10.2026** (Freigabe Inhaber)

Grundsatz: **EasyKFZ24 ist eine Marke. Anbieter und Vertragspartner ist die MONVEX UG (haftungsbeschränkt).**
EasyKFZ24 erscheint nirgends mehr wie eine eigene Gesellschaft.

## 1. Ausgangslage (Live-Website easykfz24.de)

- Impressum: ausschließlich Platzhalter („[PLATZHALTER: Firmenname und Rechtsform]“ usw.) und Hinweis „Entwurf“.
- Footer: „Ein Service der [PLATZHALTER: Firmenname und Rechtsform]“.
- Vollmacht-Vorlage, Bestellbestätigung und Datenschutz: Anbieter als Platzhalter.
- Bestellprozess: „Ich bevollmächtige EasyKFZ24 …“ und „EasyKFZ24 übermittelt das Mandat …“ (Marke als Vertragspartei).
- Rechtsgrundlage stand bereits als § 5 DDG; kein Verweis auf § 5 TMG, kein Link zur eingestellten EU-OS-Plattform.

## 2. Geprüfte Unterlagen und Gesellschaftsstatus

| Quelle | Inhalt | Verwendung |
|---|---|---|
| Gründung mit Musterprotokoll, Notar Prof. Dr. Weitze-Scholl, Bremen, 23.09.2026 (UVZ-Nr. 824/2026) | Firma „MONVEX UG (haftungsbeschränkt)“, Sitz Bremen, Geschäftsführer Mohammed Al Bakhit (einzelvertretungsberechtigt) | Firma, Sitz, Vertretung |
| Handelsregisteranmeldung (UVZ-Nr. 825/2026, als **Entwurf** gekennzeichnet), Amtsgericht Bremen, „HRB neu HB“ | Inländische Geschäftsanschrift Kirchbachstraße 200, 28211 Bremen | Anschrift, Registergericht |
| Unternehmensstammdaten im EasyKFZ24 OS (Produktion, nur gelesen) | E-Mail kundenservice@easykfz24.de; Anschrift wie oben | E-Mail |
| Öffentliche Suche (Registerportale, Verzeichnisse) | **kein Eintrag** für MONVEX gefunden | Status „i. G.“ |
| Registerauszug „NI-Hannover HRB 222247“ | gehört zur **Metropol Tours GmbH** (Hannover) – **nicht** MONVEX | nicht verwendet; Test verhindert Verwendung |
| Kontoeröffnung Deutsche Bank, 29.09.2026 | „MONVEX UG (haftungsbeschränkt) i. Gr., Hauptstraße 19, 28865 Lilienthal“ | Abweichende Anschrift – Inhaber bestätigt Kirchbachstraße 200 |
| Gewerbeanmeldung (persönliches Einzelunternehmen, Marketing) | betrifft nicht EasyKFZ24 | nicht verwendet, keine Privatdaten veröffentlicht |

Ergebnis: Eine Eintragung ist nicht nachgewiesen. Die Website führt die Gesellschaft daher als
**„MONVEX UG (haftungsbeschränkt) i. G.“**, ohne Registernummer, mit Hinweis auf das zuständige Amtsgericht Bremen.
Nach der Eintragung genügt eine Änderung in `src/lib/site.ts` (`register: { court, number }`): „i. G.“ entfällt überall automatisch.

## 3. Umgesetzte Änderungen

- **Zentrale Quelle** `src/lib/site.ts`: Marke (`BRAND`), Anbieter (`PROVIDER`), `PROVIDER_NAME` (mit „i. G.“ bis zur Eintragung),
  `BRAND_NOTE` („EasyKFZ24 ist eine Marke der MONVEX UG (haftungsbeschränkt) i. G.“). Alle Seiten lesen von hier – keine Widersprüche mehr.
- **Impressum** neu: Angaben gemäß § 5 DDG, Rechtsform und Vertretung, Kontakt, Handelsregister (Status), Steuerangaben nur wenn vorhanden,
  Marke und Vertragspartner (inkl. Abgrenzung zu externen Dienstleistern und Behörden), Verantwortlicher nach § 18 Abs. 2 MStV,
  Verbraucherstreitbeilegung. Schlicht, ohne Animationen, mobil einspaltig, semantisch (`address`, `dl`, Überschriften je Abschnitt).
- **Footer** auf allen öffentlichen Seiten: Markenhinweis statt Platzhalter; Impressum-Link (auch mobil) geprüft.
- **404-Seite** neu mit Links zu Startseite, Impressum und Datenschutz.
- **Bestellprozess**: Vollmacht und SEPA-Hinweis nennen die Gesellschaft (Marke in Klammern); im Prüfschritt vor dem Absenden
  „Ihr Vertragspartner: MONVEX UG (haftungsbeschränkt) i. G., Anschrift“ mit Link zum Impressum. Keine Funktion geändert.
- **Vollmacht-Vorlage**: Bevollmächtigte ist die Gesellschaft, vertreten durch den Geschäftsführer, Anschrift.
- **Bestellbestätigung**: Postanschrift für Originale mit Firma und Marke.
- **Datenschutz**: Verantwortlicher = Gesellschaft; Datenschutzanfragen an die bekannte E-Mail; Hosting: Cloudflare, Inc.
- **Kunden-E-Mails** (Statusmails): Fußzeile mit Markenhinweis, Anschrift, Geschäftsführer, Sitz (Registerangaben nach Eintragung automatisch).
- **EasyKFZ24 OS**, Systemeinstellungen → Unternehmen: Hinweis, wenn der Firmenname von der Firma im Impressum abweicht (sperrt nichts).
- **Tests** `tests/legal.test.ts`: „i. G.“ ohne Eintragung, keine fremde/erfundene HRB, keine Platzhalter in Impressum/Footer/Vollmacht/Bestellung,
  kein § 5 TMG, kein OS-Plattform-Link, Vertragspartner im Bestellprozess = Impressum, Anbieterangaben in Kundenmails.

## 4. Vom Inhaber bestätigte Angaben (13.10.2026)

- **MONVEX UG (haftungsbeschränkt) i. G.**, Kirchbachstraße 200, 28211 Bremen (ladungsfähige Geschäftsanschrift)
- Geschäftsführer: Mohammed Al Bakhit · Telefon: 0421 499 58 207 · E-Mail: kundenservice@easykfz24.de
- Gesellschaft weiterhin in Gründung – **keine Handelsregisternummer**.
- „EasyKFZ24 ist eine Marke der MONVEX UG (haftungsbeschränkt) i. G.“

USt-IdNr./W-IdNr.: nicht genannt → Angabe entfällt.

**Live-Stammdaten im OS** (mit Freigabe, 13.10.2026): Firmenname „MONVEX UG (haftungsbeschränkt) i. G.“, Rechtsform
„UG (haftungsbeschränkt) in Gründung“, Geschäftsführer „Mohammed Al Bakhit“, Telefon „0421 499 58 207“, Rechnungsfußzeile
„EasyKFZ24 ist eine Marke der MONVEX UG (haftungsbeschränkt) i. G.“. Anschrift und E-Mail waren bereits korrekt. Damit führen Rechnungen
(Aussteller, Fußzeile), Kunden-Mailvorlagen (Signatur `{{firma}}`) und Website dieselbe Firma.

## 4a. Verbraucherstreitbeilegung – Prüfung der Voraussetzungen (13.10.2026)

Formulierung im Impressum: „Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer
Verbraucherschlichtungsstelle teilzunehmen.“ Zulässig, wenn keine Teilnahmepflicht besteht und keine Teilnahme zugesagt wurde.

| Voraussetzung | Ergebnis |
|---|---|
| Gesetzliche Teilnahmepflicht | Für einen Kfz-Zulassungsdienst besteht keine branchenspezifische Schlichtungspflicht (solche gibt es z. B. für Energie, Telekommunikation, Luftverkehr). |
| Vertragliche Pflicht | Keine AGB mit Schlichtungsklausel; keine Mitgliedschaft in einem Verband oder Gütesiegel mit Schlichtungszusage auf Website, in E-Mails oder Unterlagen gefunden (Suche nach Trusted Shops, Händlerbund, Gütesiegel, Käuferschutz u. a.: ohne Treffer). |
| Freiwillige Zusage | Keine Zusage auf Website, in E-Mail-Vorlagen oder Dokumenten. |
| Informationspflicht (§ 36 VSBG) | Gilt für Unternehmer mit Website/AGB; Ausnahme nach § 36 Abs. 3 für höchstens 10 Beschäftigte am 31.12. des Vorjahres. Die Angabe im Impressum ist unabhängig davon zulässig und bleibt bestehen. |
| Nach Entstehen einer Streitigkeit (§ 37 VSBG) | Kann eine Streitigkeit nicht beigelegt werden, ist der Verbraucher in Textform auf eine zuständige Verbraucherschlichtungsstelle hinzuweisen und mitzuteilen, ob teilgenommen wird – **Prozess für das Team**, ggf. als Mailvorlage im OS vorbereiten. |

**Vom Inhaber zu bestätigen:** keine außerhalb der Website eingegangene Zusage oder Mitgliedschaft mit Schlichtungspflicht.
Ändert sich das (z. B. Beitritt zu einem Gütesiegel mit Schlichtung), ist die Formulierung anzupassen.

## 5. Weitere Befunde und Maßnahmen

- **Stammdaten im OS (Produktion)**: Schreibweise des Geschäftsführers mit Freigabe korrigiert („Al Bakhkit“ → „Al Bakhit“, laut Gründungsurkunde),
  13.10.2026, nur dieses Feld. **Offen:** Firmenname lautet dort weiterhin „Easykfz24.de eine Marke der MONVEX UG (Haftungsbeschränkt)“ (erscheint auf
  Rechnungen und in Mailvorlagen; Vorschlag „MONVEX UG (haftungsbeschränkt) i. G.“), Telefon leer, Steuernummer fehlt für Rechnungen.
  Das OS zeigt die Abweichung zum Impressum unter Systemeinstellungen → Unternehmen an.
- **Bestellbutton** geändert: „Auftrag verbindlich absenden“ → **„Zahlungspflichtig beauftragen“** (§ 312j Abs. 3 BGB). Nur der Text, keine Funktion.
- **Vorvertragliche Informationen im Checkout**: Identität, Anschrift, Telefon und E-Mail des Vertragspartners werden vor dem Absenden angezeigt.
- **Widerruf** – im Entwicklungsstand vorbereitet, nicht aktiv, nicht Teil dieses Releases (siehe `docs/WIDERRUF-VORBEREITUNG.md`).
  Bisheriger Befund:
  - Widerrufsbelehrung für Dienstleistungen (14 Tage ab Vertragsschluss) und Muster-Widerrufsformular,
  - ausdrückliches Verlangen des Kunden, dass vor Ablauf der Widerrufsfrist mit der Leistung begonnen wird, und Hinweis auf das Erlöschen
    des Widerrufsrechts bei vollständiger Erbringung sowie auf Wertersatz bei Widerruf nach Leistungsbeginn,
  - elektronische Widerrufsfunktion („Widerrufsbutton“) für online geschlossene Verträge,
  - Vertragsbestätigung auf einem dauerhaften Datenträger (E-Mail) inkl. Widerrufsbelehrung – gehört zur Resend-Umsetzung.
- **Keine AGB / Kundeninformationen**: technische Schritte zum Vertragsschluss, Speicherung des Vertragstextes, Vertragssprache,
  Zahlungs- und Leistungsbedingungen – ergänzen und prüfen lassen.
- **Datenschutzerklärung** bleibt ein Entwurf: Löschfristen, vollständige Empfänger (Zahlungsdienst, Zulassungs-/API-Partner, E-Mail-Dienst),
  Drittlandübermittlung, zuständige Aufsichtsbehörde.
- **Externe Partner (kfz-api.de)**: Falls ein Partner Vorgänge bei der Behörde durchführt, sollte die Vollmacht eine Untervollmacht vorsehen.
- **Unternehmensgegenstand** laut Musterprotokoll nennt den Kfz-Zulassungsdienst nicht ausdrücklich; Gewerbeanmeldung der UG nicht in den Unterlagen –
  mit Notar/Steuerberatung klären.
- **Zahlungsanbieter**: Im Stripe-Konto sollte als Unternehmen die MONVEX UG (haftungsbeschränkt) i. G. hinterlegt sein (nicht prüfbar ohne Dashboard-Zugang).

## 6. Separater Release

Zweig `release/rechtsangaben` auf Basis des Live-Stands `8d8c34b` – enthält **nur** die Rechts- und Anbieterangaben
(zentrale Konfiguration, Impressum, Footer, 404-Seite, Datenschutz-Verantwortlicher, Vollmacht, Bestellbestätigung, Vertragspartner und Button im
Checkout, Fußzeile der Statusmails, Hinweis in den Systemeinstellungen, Tests, diese Dokumentation). Keine Änderungen an Ortsauswahl,
Startseiten-Bild, Carbon, Express oder Regionendaten.

## 7. Prüfungen

- Release-Zweig: Unit-Tests 143/143, E2E Node 42/42, E2E Worker 42/42, Typprüfung, Produktions-Build inkl. Cloudflare-Worker.
- Entwicklungsstand (alle Änderungen): Unit-Tests 166/166, E2E Node 56/56, E2E Worker 56/56.
- Browser: Impressum Desktop und Mobil (375 px, einspaltig, kein seitliches Scrollen); Impressum-Link und Markenhinweis auf Startseite, Bestellung,
  Vollmacht, Bestätigung, Status, Kennzeichen-Seiten, Datenschutz und 404-Seite.
