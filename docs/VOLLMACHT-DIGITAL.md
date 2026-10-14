# Digitale Vollmacht & automatische Rückleitung

Stand: 15.10.2026 (Testaufträge, QES-Pflicht für alle Übermittlungswege, Aufbewahrung ergänzt) · Partner: kfz-api.de „Vollmacht für Dritte mit Nect“ (OpenAPI `/spec/api.yaml` 2.3.0)

## Dokumentierte Fakten (Grundlage der Umsetzung)

| Thema | laut Partner-Doku |
|---|---|
| Anlegen | `POST /powerOfAttorneys` – **kostenpflichtig und rechtsverbindlich**; laut kfz-api.de/preise Signatur 6,95 € **netto** (8,27 € brutto), monatliche Sammelrechnung |
| Abfragen | `GET /powerOfAttorneys/{processId}` – kostenlos; Status `offen`, `signiert`, `abgelehnt`, `verfallen`, `fehlgeschlagen` |
| Maßgeblich | `readyForApplication` – „signiert“ allein reicht für die Zulassung nicht |
| Webhook | **gibt es für Vollmachten nicht** – der Stand wird abgefragt |
| Rücksprung | `?powerOfAttorneyId=…&status=signed\|pending\|rejected\|expired\|failed` – **nur Anzeigehinweis, kein Nachweis** |
| Rücksprungadresse | im Dashboard: *Vollmachten › Einstellungen → Rücksprungadresse nach der Unterschrift* (nur HTTPS) |
| `redirectUrl` je Vorgang | nur mit gleichem Origin wie die Dashboard-Adresse, sonst 400; ohne Dashboard-Adresse nicht möglich |
| Wiederholung | gleiche `externalOrderId` + offener Vorgang + gleiche Angaben → derselbe Vorgang; andere Angaben → 409 |
| Dokument | das unterschriebene PDF liefert die API **nicht** aus → keine Dokumentansicht im OS |
| Sandbox | bildet Vollmachtsvorgänge **nicht** ab → lokale Tests mit `scripts/fake-kfz-api.mjs` (Testnachbau) |
| Firmen | Business Sign braucht eine eigene Freischaltung beim Partner (sonst 409) – aktuell nur Privatpersonen |
| SEPA | `bankAccount` = SEPA-Lastschriftmandat der Generalzolldirektion **für die Kfz-Steuer** (BMF-Formular 032021), im selben Nect-Vorgang; übermittelt erst mit einem Zulassungsantrag |
| Produktion | 403 „Produktion nicht freigegeben“ legt nichts an (auch nicht bei Nect) |

## Ablauf

1. Auftrag geht ein (bei aktivem Schalter mit Pflichtfeld **Geburtsort**, wie im Ausweis).
2. Im OS (Auftrag → Übersicht → „Digitale Vollmacht“) **„vorbereiten“**: Die Vorschau zeigt alle gesendeten Angaben, die
   SEPA-Wahl (Vorgabe: **ohne** Mandat), Kosten und Rechtshinweise – ohne Partneraufruf. Angefordert wird erst nach Haken
   „geprüft“ und Klick auf „Jetzt kostenpflichtig anfordern“, und nur genau dieser Stand (SHA-256-Prüfsumme über den
   Anfragerumpf; ändert sich etwas, wird abgewiesen). Fehlt eine Angabe, entsteht kein Vorgang und keine Kosten.
3. Server legt zuerst den Datensatz an (`externalOrderId` = `EK-JJJJ-NNNNN-V<Versuch>`), dann `POST`. Geht die Antwort
   verloren, liefert die Wiederholung mit derselben `externalOrderId` denselben Vorgang – keine Doppelkosten.
4. Der Partner schickt den Unterschriftslink (White-Label-E-Mail) – im OS zusätzlich „Unterschriftslink kopieren“.
5. Kunde identifiziert sich und unterschreibt bei Nect (inkl. SEPA-Mandat, wenn eine IBAN vorliegt).
6. Rückleitung auf `https://easykfz24.de/vollmacht/abschluss?powerOfAttorneyId=…&status=…`.
7. Die Seite fragt den **Server** – der Server fragt den Partner (`GET`, gedrosselt auf 1× je 15 s und Vorgang).
8. Angezeigt wird **nur** der vom Partner bestätigte Stand; der `status`-Parameter der URL wird ignoriert.
9. Änderungen werden im Auftrag gespeichert, im Verlauf protokolliert und als OS-Ereignis (mit Dublettenschlüssel) gemeldet.
10. Cron-Trigger des Workers (alle 10 Minuten, `worker.ts` → `/api/intern/zeitplan`) führt die Regel „Vollmacht-Abgleich“
    aus – auch wenn niemand das OS geöffnet hat und der Kunde nie zurückkommt. Nur kostenlose GET-Abfragen.

Unterschrift ≠ Zahlung ≠ Zulassung: drei getrennte Angaben in Statusabfrage und OS.

## Anzeigen

**Kunde** (Abschlussseite und Statusabfrage), nur aus dem bestätigten Stand:

| Partnerstand | Text |
|---|---|
| signiert + `readyForApplication` | „Ihre Vollmacht wurde erfolgreich unterschrieben.“ |
| signiert, Angaben fehlen | „Ihre Vollmacht wurde unterschrieben.“ + Hinweis auf fehlende Angaben |
| offen / Abfrage gestört | „Ihre Unterschrift wird noch verarbeitet.“ (Seite prüft rund 3 Minuten automatisch nach) |
| abgelehnt | „Die Vollmacht wurde nicht unterschrieben.“ |
| verfallen | „Der Unterschriftslink ist abgelaufen.“ |
| fehlgeschlagen | „Bei der Verarbeitung ist ein Problem aufgetreten.“ |
| unbekannt / ohne / ungültige Parameter | „Wir konnten diesen Vorgang nicht zuordnen.“ |

**OS:** Vollmacht erstellt · Unterschriftslink versendet · ausstehend · unterschrieben · Unterschrieben, Angaben
unvollständig · abgelehnt · abgelaufen · Technischer Fehler – jeweils mit Zeitpunkt der letzten bestätigten Änderung
und der letzten Prüfung, Hinweisen des Partners, früheren Versuchen und „Stand jetzt abfragen“.

## Sicherheit

- Zugangsdaten nur serverseitig (Secrets); im Frontend nichts.
- Abschlussseite und Status-API geben **nur** Status und Zeitpunkt aus – keine Auftragsnummer, keine Namen, keine Adressen.
  Wer eine Vorgangsnummer kennt, erfährt nur, ob unterschrieben wurde.
- Vorgangsnummer streng geprüft (nur Ziffern), unbekannte Statuswerte verworfen; Seite `noindex`, `no-referrer`, `no-store`.
- Status-API mit Rate-Limit (60 Abfragen je 10 Minuten und IP).
- Keine offene Weiterleitung: `redirectUrl` nur HTTPS, gleicher Origin, ohne Zugangsdaten – und standardmäßig gar nicht gesendet.
- Protokolle ohne Personendaten (Geburtsort wird nur als „geändert“ protokolliert).
- Nur dokumentierte Felder werden übernommen und gesendet.
- Doppelklick/parallele Aufrufe: eindeutiger Datensatz je Auftrag und Versuch – der zweite Aufruf sendet nichts; zusätzlich
  liefert der Partner bei gleicher `externalOrderId` denselben offenen Vorgang.
- Verbindungsabbruch: Wiederholung mit derselben `externalOrderId` (kein zweiter Vorgang); im Testmodus kein neuer Versuch ohne neue Freigabe.
- Zeitplan-Endpunkt `/api/intern/zeitplan`: von außen immer 404 (Kennwort entsteht zufällig im Worker und verlässt ihn nie).
- `/api/version` nennt nur Commit und Build-Zeit (Repository ist öffentlich).

## Betriebsarten

| Betriebsart | Bedingung | Wer kann anfordern |
|---|---|---|
| **aus** (Standard) | keine Vollmacht-Variable gesetzt – oder kein Partner-Zugang (`KFZ_API_*`) | niemand; nur Abgleich bereits vorhandener Vorgänge |
| Testmodus | Partner-Zugang **und ausdrücklich** `VOLLMACHT_TESTMODUS=1` | nur der **Inhaber**, nur für einen **Testauftrag** (TEST-…) mit **Testfreigabe** |
| aktiv | Partner-Zugang und `VOLLMACHT_DIGITAL=1` (geht dem Testmodus vor) | alle mit Recht „Aufträge bearbeiten“ |

**Testaufträge** (OS → Auftragscenter → „Testaufträge“, nur Inhaber, nur im Testmodus): Der Inhaber öffnet ein Testfenster
(120 Minuten, höchstens 3 Testaufträge) und legt darin Testaufträge an – der Kunden-Checkout bleibt gesperrt. Testaufträge
haben eine eigene Nummernfolge `TEST-JJJJ-NNNNN`, sind im OS rot gekennzeichnet, erscheinen nicht in Listen, Dashboard oder
Kundenstamm und laufen durch keine Automatisierung. Gesperrt sind Zahlung (auch Mollie), Rechnung, Freigabe zur Übermittlung,
Verknüpfung mit kfz-api.de und jede Kundenmail. Das Anlegen fordert **keine** Vollmacht an. Widerrufsfrist-Sperre gilt
unverändert (Zustimmung zum vorzeitigen Beginn nur, wenn ausdrücklich angehakt). Echte Kundenaufträge werden im Testmodus
nie verwendet (keine Testfreigabe, keine Anforderung).

**Testfreigabe** (OS → Testauftrag → Digitale Vollmacht, nur Inhaber, nur für Testaufträge): gilt für genau einen Auftrag, 24 Stunden, und wird beim
ersten Anfordern an diesen Versuch gebunden. Wiederholungen desselben Versuchs (gleiche Referenz) und der Abgleich bleiben
möglich; ein weiterer kostenpflichtiger Versuch (V2) braucht eine neue Freigabe. Eine neue Freigabe ersetzt die alte;
„zurückziehen“ beendet sie. Alles steht im Auftragsverlauf und im Protokoll. Kunden sehen davon nichts; das Bestellformular
bleibt unverändert (kein Geburtsort-Pflichtfeld).

## Übermittlung an Partner und Behörde (Partnervertrag POWR § 3)

- Zulassung, Ummeldung (Halterwechsel, Umzug) und Wiederzulassung brauchen eine **qualifiziert signierte Vollmacht** –
  **unabhängig** vom Schalter `VOLLMACHT_DIGITAL`. Erfüllt ist das nur durch den per `GET` beim Partner abgeglichenen Stand
  `signiert` **und** `readyForApplication`. Checkout-Bestätigung, Rücksprung-Parameter, Webhook-Inhalte und Häkchen zählen nie;
  die Checkliste enthält für diese Vorgänge kein Papier-Häkchen „Vollmacht im Original“ mehr.
- Ausnahme Abmeldung (Außerbetriebsetzung): keine QES nötig, Papiervollmacht-Häkchen bleibt.
- Freigabe zur Übermittlung: zusätzlich gesperrt ohne bestätigte QES und für Testaufträge.
- Manuelle Verknüpfung eines kfz-api.de-Vorgangs (Recht „KFZ-API bearbeiten“): nur mit interner Freigabe und – soweit nötig –
  bestätigter QES; nie für Testaufträge. Lösen bleibt möglich.
- Eingehende Webhooks: echter externer Stand wird immer protokolliert und übernommen (Status, Belege), aber nichts als erfüllt
  markiert (keine Freigabe, kein Vollmachtsstand). Fehlen Freigabe oder QES oder ist es ein Testauftrag: Eintrag „WARNUNG …“
  im Verlauf, kritische OS-Benachrichtigung „Beim Partner ohne Freigabe/QES“ (einmal je Stand) und Fehler am Auftrag
  (`extern_ohne_freigabe`, auch in der Liste).
- Website: Ohne eingeschaltete digitale Vollmacht nimmt der Checkout nur Abmeldungen an (sonst entstünden bezahlte Aufträge,
  die nicht übermittelt werden dürfen).

## Nachweis der QES und Aufbewahrung (Partnervertrag § 4 Abs. 6)

- Gespeichert werden Vorgangsnummer, Stand, `readyForApplication`, Zeitpunkte (angefordert, abgeglichen, Statuswechsel),
  anfordernde Person und jeder Statuswechsel samt Partner-Hinweis im Auftragsverlauf.
- **Offen:** Das signierte PDF liefert die API nicht. Bis zu einer verlässlichen Vereinbarung mit POWR (Aufbewahrung durch
  POWR für MONVEX bzw. Abruf/Download) liegt der QES-Nachweis selbst **nicht** bei EasyKFZ24.
- Löschsperre: Unterlagen, Auftragsangaben, Korrespondenz und Vollmachtsnachweise übermittelter Anträge (Freigabe oder
  kfz-api.de-Vorgang) werden mindestens 2 Jahre nach der letzten Änderung weder endgültig gelöscht noch anonymisiert; die
  DSGVO-Prüfung nennt je Auftrag das Datum, ab dem erneut geprüft wird (keine unbefristete Aufbewahrung). Bei der
  Anonymisierung übriger Aufträge werden Nachrichten (Text **und** HTML) geleert und Partner-Hinweise/Links der
  Vollmachtsvorgänge entfernt.

## Schalter (Umgebungsvariablen)

| Variable | Wirkung | Vorgabe |
|---|---|---|
| `VOLLMACHT_TESTMODUS=1` | Testmodus: Testaufträge des Inhabers, Anforderung nur mit Testfreigabe; Bestellformular unverändert | aus |
| `VOLLMACHT_DIGITAL=1` | Anfordern neuer Vorgänge für alle geeigneten Aufträge + Pflichtfeld Geburtsort | aus |
| `VOLLMACHT_EMAIL_SENDEN=0` | Partner schickt **keine** E-Mail | Partner sendet |
| `VOLLMACHT_RUECKSPRUNG_URL` | im Dashboard hinterlegte Adresse | `https://easykfz24.de/vollmacht/abschluss` |
| `VOLLMACHT_REDIRECT_SENDEN=1` | `redirectUrl` je Vorgang mitsenden | aus |

Ohne beide Variablen ist die Betriebsart **aus**: kein Geburtsort-Feld, keine Anforderung, keine Kosten.
Abschlussseite, Abgleich und Zeitregel sind harmlos (nur kostenlose Abfragen vorhandener Vorgänge).

## Getestet (13.10.2026, Testnachbau, keine echten Vorgänge)

Anforderung ohne Geburtsort (abgewiesen, kein Vorgang) · Anforderung V1 · doppelte Anforderung (derselbe Vorgang) ·
Rückkehr mit `status=signed` bei offenem Vorgang („wird noch verarbeitet“) · Unterschrift bestätigt (Erfolg, OS
„unterschrieben“) · Rückkehr mit `status=pending` bei unterschriebenem Vorgang (Erfolg) · ohne Parameter, nur `status`,
`powerOfAttorneyId=abc`, Skript-Einschleusung, unbekannte Nummer (neutral) · unbekannter Statuswert (ignoriert) ·
abgelaufen → OS „Neuen Vorgang anfordern“ → V2 · Partner offline (bisheriger Stand, `checkFailed`) · unterschrieben
mit fehlenden Angaben · Statusabfrage mit Vollmacht-Block getrennt von Zahlung und Bearbeitung · Mobil 375 px ohne
Querscrollen · Unit-Tests 195/195 · E2E Node und Worker je 59/59 · Produktions-Build.

**Testmodus und Zeitsteuerung (13.10.2026, ebenfalls ohne echte Vorgänge):** Anforderung ohne bestätigte Vorschau abgewiesen ·
Prüfsumme bei nachträglich umgeschalteter SEPA-Wahl abgewiesen · SEPA nur auf ausdrückliche Wahl · Doppelklick im Browser →
genau ein Vorgang · Testmodus: ohne Freigabe niemand, Mitarbeiter gesperrt, fremder Auftrag gesperrt, genau ein Versuch,
V2 ohne neue Freigabe gesperrt, abgelaufene Freigabe gesperrt, Zurückziehen · Testfreigabe durch Nicht-Inhaber 403 ·
Cron in workerd (`wrangler dev`, geplanter Lauf): offener Vorgang abgeglichen → „unterschrieben“ samt Verlaufseintrag;
`/api/intern/zeitplan` von außen 404 · Unit-Tests 204/204 · E2E Node und Worker je 60/60 · Produktions-Build.

## Getestet (15.10.2026, Testnachbau, nur synthetische Daten)

Testauftrag (nur Inhaber, nur Testmodus, nur offenes Fenster, höchstens 3, TEST-Nummer, keine Anforderung/Mail/Kundenstamm) ·
unberechtigter Zugriff (alle anderen Rollen 403, ohne Sitzung 401) · Testauftrag ohne Zahlung, Rechnung, Freigabe,
Verknüpfung, Mollie · Testfreigabe nur für Testaufträge, echte Aufträge im Testmodus gesperrt · Vollmacht signiert /
unvollständig / abgelehnt / fehlgeschlagen / Identifizierung abgebrochen · fehlende QES trotz abgehakter Checkliste, Zahlung
und Sicherheitscodes (Schalter aus) · Abmeldung ohne QES · manuelle Verknüpfung · Webhook mit falscher Signatur, mit
manipulierten Zusatzfeldern, ohne Freigabe/QES (Warnung, OS-Meldung, Fehler am Auftrag), nach Freigabe ohne Warnung ·
Lösch- und Anonymisierungssperre inkl. Nachrichten · Migration v10 → v11 (SQL vorab und zur Laufzeit) · Unit 283/283 ·
E2E Node und Worker je 70/70 · Produktions-Build.

## Erster echter Test (Testmodus) – Ablauf

Voraussetzungen (alle vom Inhaber, nichts davon automatisch):
- KOPA-Schlüssel und Produktionsfreigabe durch POWR liegen vor (Partnervertrag § 1 Abs. 3, § 2); OS → KFZ-API-Center →
  „Verbindungstest“ zeigt „Verbindung und Anmeldung in Ordnung“.
- Kosten bekannt und akzeptiert: ein Vorgang 6,95 € netto (8,27 € brutto), auch wenn die Unterschrift scheitert.
- In Cloudflare (Worker easykfz24 → Einstellungen → Variablen) **`VOLLMACHT_TESTMODUS=1`** gesetzt; `BESTELLUNG_AKTIV`
  bleibt 0, `VOLLMACHT_DIGITAL` bleibt aus. Nach dem Test wieder entfernen.

1. OS → Auftragscenter → „Testaufträge“ → „Testfenster öffnen“ (120 Minuten).
2. „+ Testauftrag anlegen“: Privatperson = einwilligende Testperson (z. B. Inhaber), Angaben genau wie im Personalausweis
   (Name, Geburtsdatum, **Geburtsort**, Anschrift), eigene E-Mail, FIN des eigenen Fahrzeugs; Leistung Zulassung, Ummeldung
   oder Wiederzulassung. Beide Häkchen zum vorzeitigen Beginn setzen (sonst Widerrufsfrist-Sperre). Keine Daten Dritter.
3. Testauftrag öffnen (rot „TESTAUFTRAG“) → „Digitale Vollmacht“ → „Testfreigabe für diesen Auftrag erteilen“ (24 h, ein Versuch).
4. „Digitale Vollmacht vorbereiten“ → Vorschau prüfen (Angaben, SEPA nein, Kosten, Hinweise) → Haken → „Jetzt kostenpflichtig
   anfordern“ – **genau einmal**. Das ist der einzige kostenpflichtige Schritt.
5. Link-E-Mail des Partners öffnen, bei Nect identifizieren und unterschreiben (Abbruch ist ebenfalls ein gültiges Testergebnis).
6. Rückleitung auf `https://easykfz24.de/vollmacht/abschluss?powerOfAttorneyId=…` – Anzeige nur aus der Server-Abfrage.
7. OS: „Stand jetzt abfragen“ → „unterschrieben“ bzw. „Angaben unvollständig“/„abgelehnt“; Verlauf prüfen.
8. Prüfen, dass „Zur Übermittlung freigeben“ für den Testauftrag gesperrt bleibt.
9. Nach spätestens 10 Minuten: Automatisierung „Vollmacht-Abgleich“ zeigt Läufe des Cron-Triggers.
10. Testfreigabe zurückziehen, Testfenster schließen, Testauftrag stornieren, `VOLLMACHT_TESTMODUS` in Cloudflare entfernen.
    Danach „Testaufträge“ → „Testdaten löschen“ (nur Inhaber, nur stornierte, nie übermittelte Testaufträge): Personen-,
    Fahrzeug- und Kontodaten sowie Unterlagen werden entfernt; Testnummer, Verlauf sowie Vorgangsnummer und Stand der
    Vollmacht bleiben zur Prüfung der Partnerabrechnung. Ein Testauftrag ist nie ein Antrag – keine Aufbewahrung nach § 4 Abs. 6.
11. Ergebnis und den Weg zum signierten PDF (Portal/POWR) dokumentieren – Voraussetzung für `VOLLMACHT_DIGITAL=1`.

## Vor dem Einschalten für alle Kunden (Checkliste)

1. ✅ Rücksprungadresse im kfz-api.de-Dashboard hinterlegt (*Vollmacht-Einstellungen → Rücksprungadresse*:
   `https://easykfz24.de/vollmacht/abschluss`; gelesen am 13.10.2026, vom Inhaber gespeichert). Markenname EasyKFZ24,
   Reply-To kundenservice@easykfz24.de und Logo sind ebenfalls gesetzt.
2. Erster echter Test (oben) erfolgreich.
3. `VOLLMACHT_DIGITAL=1` in Cloudflare setzen (macht das Geburtsort-Feld im Bestellformular zur Pflicht).
4. Für Firmenkunden Business Sign beim Partner freischalten lassen.
5. Kunden-E-Mails zum Vollmachtsstand erst nach Anbindung von Resend.
