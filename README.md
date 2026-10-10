# EasyKFZ24

Digitaler Kfz-Zulassungsservice: öffentliche Website mit scrollgesteuerter Inszenierung, Auftragsstrecke mit Upload,
Statusabfrage für Kunden und eine Verwaltung (`/admin`) für die Sachbearbeitung.

Stack: Next.js 15 (App Router) · React 19 · zod · SQLite über `node:sqlite` · handgeschriebenes CSS auf Design-Tokens ·
eigene Motion-Engine ohne Animationsbibliothek.

## Start

```bash
cp .env.example .env.local   # ADMIN_PASSWORD (≥ 12 Zeichen) und SESSION_SECRET (≥ 32 Zeichen) setzen
npm install
npm run dev                  # http://localhost:3000
```

| Befehl | Zweck |
|---|---|
| `npm run typecheck` | TypeScript prüfen |
| `npm test` | Tests der reinen Module (`node --test`) |
| `npm run build` / `npm start` | Produktionsbuild / -server |

Node ≥ 22.13 (wegen `node:sqlite`). Datenbank und Uploads liegen in `./data` (bzw. `DATA_DIR`) und werden beim ersten
Zugriff angelegt. `./data` ist nicht im Repository und muss gesichert werden.

## Seiten

| Route | Inhalt |
|---|---|
| `/` | Startseite mit Hero-Bühne in fünf Akten, Leistungen, Ablauf, Unterlagen, Status-Demo, Kennzeichen, Deutschland, Vertrauen, Händler, Preise, FAQ |
| `/kfz-anmelden` | Leistungen, benötigte Unterlagen je Leistung, Ablauf, Preise, FAQ |
| `/kfz-anmelden/auftrag` | Auftragsstrecke in sieben Schritten (`?leistung=halterwechsel` wählt vor) |
| `/kfz-anmelden/auftrag/bestaetigung` | Auftragsnummer `EK-JJJJ-NNNNN` und nächste Schritte |
| `/kfz-anmelden/vollmacht` | Druckbare Vollmacht-Vorlage |
| `/status` | Statusabfrage mit Auftragsnummer + E-Mail („Anmelden“ in der Navigation) |
| `/impressum`, `/datenschutz` | Entwürfe mit markierten Platzhaltern |
| `/admin` | Kennzahlen, Liste mit Suche und Statusfilter, Detailseite mit Workflow, Checkliste, Dokumenten, Notizen, Verlauf, Druckansicht |

## Aufbau

```
src/lib/        Reine Module, getestet: Leistungen, Prüfregeln (FIN, IBAN mod 97, eVB, Kennzeichen …),
                Auftragsschema, Preise, Status-Workflow, Checkliste, Magic Bytes, Rate-Limit, Sitzungstoken
src/server/     Datenbank, Auftragsdaten, Admin-Anmeldung, Ratenbegrenzung (nur serverseitig)
src/motion/     Motion-Engine: eine rAF-Schleife, Smooth Scroll auf echtem Scrollwert, Scroll-Timelines,
                Reveals, Cursor/Magnet/Tiefe; scenes/ = Bühnen der Startseite
src/components/ UI-Bausteine, home/ (Startseite), order/ (Auftragsstrecke), admin/
src/styles/     tokens.css (einzige Quelle für Farben, Typo, Abstände, Bewegung), base, components, home, forms, info, admin
tests/          node --test
```

### Motion-Prinzip

Jede scrollgesteuerte Bewegung ist eine reine Funktion des Scrollfortschritts `p` (0 … 1): Spur (`*__track`, z. B. 520vh)
legt die Dauer fest, die Bühne (`*__stage`, sticky, 100svh) wird bespielt. Rückwärts scrollen ergibt framegenau dasselbe
Bild. Gemessen wird nur in `refreshAll()` (Resize, ResizeObserver, Fonts), pro Frame wird nur gerechnet und ausschließlich
`transform`, `opacity` und `filter` geschrieben.

- Smooth Scroll nur bei feinem Zeiger; Touch behält nativen Scroll.
- `prefers-reduced-motion` (oder zum Testen `?motion=reduced`): keine Sticky-Spuren, alle Inhalte im Endzustand.
- Ohne JavaScript ist die Seite ebenfalls vollständig lesbar.

## Anbindungen

| Bereich | Stand | Aktivieren |
|---|---|---|
| **Zahlung** (Visa, Mastercard, PayPal, Klarna, Apple Pay, Google Pay) | Stripe Checkout fertig angebunden: Weiterleitung nach dem Absenden, Zahlungslink `/zahlung/[nr]`, Webhook `/api/zahlung/webhook` setzt „bezahlt“. Ohne Schlüssel bleibt die Zahlung „offen“ und wird im Admin gepflegt. | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PUBLIC_BASE_URL` in der `.env`; Methoden im Stripe-Dashboard einschalten. **Vor dem Livegang nötig**, sonst sind die angezeigten Zahlarten nicht nutzbar. |
| **Versand** (DHL, UPS) | Kunde wählt den Versandpartner; Admin trägt die Sendungsnummer ein; Statusabfrage zeigt den Tracking-Link. | Labels/Sendungsanlage per API (DHL Paket DE Versenden, UPS Shipping) benötigen Geschäftskundenzugänge. |
| **Wunschkennzeichen-Verfügbarkeit** | Konfigurator mit allen Ortskennzeichen, Platzhaltern und Vorschlägen; Status „wird bei Reservierung geprüft“. | Dienst mit Verfügbarkeitsdaten über `PLATE_AVAILABILITY_URL`/`_KEY` (Format in `src/server/plate-availability.ts`). |
| **Logos** der Partner | Neutrale Schriftmarken | Offizielle Dateien nach `public/brands/` legen und in `src/lib/shipping.ts` / `src/lib/payment.ts` eintragen. |

## Kennzeichenschrift

Die Schilder werden als SVG gezeichnet. Liegt eine Kennzeichenschrift (FE-Schrift) als `assets-src/fonts/fe-schrift.ttf`
(oder `.otf`/`.woff2`) vor, übernimmt `npm run plate-font` deren Zeichen als Vektorpfade nach
`src/lib/plate-font.generated.ts`; `dev`, `build`, `test` und `typecheck` erledigen das automatisch. Fehlende Umlaute werden
aus A/O/U und zwei Punkten zusammengesetzt. Ohne Schriftdatei greift die eingebaute Nachzeichnung.

Schriftdatei und erzeugte Datei sind bewusst nicht im Repository (`.gitignore`): Die vorliegende „FE-Font“ (1997) enthält
keine Lizenzangabe und ist als „eingeschränkt einbettbar“ markiert. Erst mit geklärter Lizenz einchecken bzw. auf dem
Server ablegen.

## Preise

Alle Preise enden auf ,99 (`src/lib/pricing.config.ts`). Neukundenpreise werden auf …9,99 bzw. ,99 abgerundet –
die Ersparnis liegt dadurch immer bei mindestens 10 % der Servicepauschale. Komplett-Pakete (Leistung + Wunschkennzeichen
+ Schilder + Versand) greifen automatisch, sobald alle Bausteine gewählt sind.

## Sicherheit

- Uploads: max. 10 MB je Datei, Typ über die ersten Bytes geprüft (PDF, JPG, PNG, WebP, HEIC), gespeichert außerhalb von
  `public/`, abrufbar nur über `/api/admin/dokumente/[id]` mit Admin-Sitzung.
- Formular: Honeypot, Ratenbegrenzung je IP (5 Aufträge/h), vollständige Prüfung auf dem Server.
- Admin: Passwort aus `ADMIN_PASSWORD`, HMAC-signiertes HttpOnly-Cookie (8 h), Passwortwechsel beendet alle Sitzungen,
  Login-Drosselung (5 Fehlversuche/15 min je IP, 30 insgesamt). Jede Admin-Seite und -Aktion prüft die Sitzung selbst.
- IBAN wird in Listen maskiert.
- Die Ratenbegrenzung liegt im Prozessspeicher und wertet `X-Forwarded-For` aus – nur hinter einem Proxy betreiben, der
  diesen Header setzt; bei mehreren Instanzen einen gemeinsamen Speicher (z. B. Redis) verwenden.

## Vor dem Livegang

1. **Platzhalter** in `src/lib/site.ts` ersetzen (Firma, Anschrift, Kontakt, Register, USt-ID, Betreiberzeile im Footer).
   Impressum und Datenschutz rechtlich prüfen lassen.
2. **Preise** in `src/lib/pricing.config.ts` bestätigen (aktuell Vorschläge mit ,99-Endungen, `PRICES_FINAL = true`).
   Mit `PRICES_FINAL = false` nennt die Website keine Beträge. Amtliche Gebühren werden nie als feste Beträge genannt.
3. **Neukundenrabatt** (`NEW_CUSTOMER_PROMO`): 10 % nur auf die Servicepauschale der ersten Beauftragung je E-Mail-Adresse,
   serverseitig geprüft. Durchgestrichen wird nur der reguläre Preis. Mit „nur für kurze Zeit“ erst werben, wenn
   `validUntil` gesetzt ist – die Website zeigt das Enddatum dann automatisch.
4. **Logo**: Bildmarke in `src/components/Logo.tsx` und `public/favicon.svg` ist ein Entwurf – bei vorhandenem Logo ersetzen.
5. **Vollmacht-Vorlage** juristisch prüfen.
6. Es werden keine E-Mails versendet; Kunden sehen Hinweise über die Statusabfrage.
7. Händlerzugang und Express sind als „Bald verfügbar“ gekennzeichnet.

8. **Kennzeichenschrift**: Lizenz klären (siehe „Kennzeichenschrift“) und die Schriftdatei auf dem Server unter `assets-src/fonts/` ablegen.