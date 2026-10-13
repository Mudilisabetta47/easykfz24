# Digitale Vollmacht & automatische Rückleitung

Stand: 13.10.2026 (Testmodus und Zeitsteuerung ergänzt) · Partner: kfz-api.de „Vollmacht für Dritte mit Nect“ (OpenAPI `/spec/api.yaml` 2.3.0)

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
| Testmodus | Partner-Zugang **und ausdrücklich** `VOLLMACHT_TESTMODUS=1` | nur der **Inhaber**, nur für den Auftrag mit **Testfreigabe** |
| aktiv | Partner-Zugang und `VOLLMACHT_DIGITAL=1` (geht dem Testmodus vor) | alle mit Recht „Aufträge bearbeiten“ |

**Testfreigabe** (OS → Auftrag → Digitale Vollmacht, nur Inhaber): gilt für genau einen Auftrag, 24 Stunden, und wird beim
ersten Anfordern an diesen Versuch gebunden. Wiederholungen desselben Versuchs (gleiche Referenz) und der Abgleich bleiben
möglich; ein weiterer kostenpflichtiger Versuch (V2) braucht eine neue Freigabe. Eine neue Freigabe ersetzt die alte;
„zurückziehen“ beendet sie. Alles steht im Auftragsverlauf und im Protokoll. Kunden sehen davon nichts; das Bestellformular
bleibt unverändert (kein Geburtsort-Pflichtfeld).

## Schalter (Umgebungsvariablen)

| Variable | Wirkung | Vorgabe |
|---|---|---|
| `VOLLMACHT_TESTMODUS=1` | Testmodus: nur Inhaber, nur für einen freigegebenen Auftrag; Bestellformular unverändert | aus |
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

## Erster echter Test (Testmodus) – Ablauf

Voraussetzungen: dieser Stand ist veröffentlicht; KBA-/Produktionsfreigabe bei kfz-api.de ist erfolgt (laut Dashboard
geplant 14.10.2026, 08:00 Uhr); OS → KFZ-API-Center → „Verbindungstest“ zeigt „Verbindung und Anmeldung in Ordnung“;
in Cloudflare (Worker easykfz24 → Einstellungen → Variablen) **`VOLLMACHT_TESTMODUS=1`** gesetzt – erst nach ausdrücklicher
Zustimmung des Inhabers; nach dem Test wieder entfernen.

1. OS → Neuer Auftrag: **eigener** Auftrag, Privatperson, Angaben genau wie im **Personalausweis** (Name, Geburtsdatum,
   Anschrift), eigene E-Mail, FIN des eigenen Fahrzeugs; Leistung nicht „Abmeldung“. IBAN nur, wenn das Kfz-Steuer-Mandat mitgetestet werden soll.
2. Im Auftrag „Digitale Vollmacht“: Geburtsort (wie im Ausweis) speichern.
3. „Testfreigabe für diesen Auftrag erteilen“ (nur Inhaber).
4. „Digitale Vollmacht vorbereiten“ → Vorschau prüfen (Angaben, SEPA ja/nein, 6,95 € netto / 8,27 € brutto, Hinweise) →
   Haken → „Jetzt kostenpflichtig anfordern“ (einmal).
5. Partner-E-Mail mit Unterschriftslink (Marke EasyKFZ24) öffnen, bei Nect mit Personalausweis identifizieren, unterschreiben.
6. Rückleitung auf `https://easykfz24.de/vollmacht/abschluss?powerOfAttorneyId=…&status=…` prüfen (Anzeige nur aus Server-Abfrage).
7. OS: „Stand jetzt abfragen“ → „unterschrieben“ (bzw. „Angaben unvollständig“ ohne `readyForApplication`).
8. Statusabfrage (Auftragsnummer + E-Mail) zeigt den Vollmachtsstand getrennt von Zahlung und Bearbeitung.
9. Nach spätestens 10 Minuten: OS → Einstellungen → Automatisierungen → „Vollmacht-Abgleich“ zeigt Läufe des Cron-Triggers.
10. Testfreigabe zurückziehen; Testauftrag stornieren (es wird kein Zulassungsantrag gestellt); `VOLLMACHT_TESTMODUS` wieder entfernen.

## Vor dem Einschalten für alle Kunden (Checkliste)

1. ✅ Rücksprungadresse im kfz-api.de-Dashboard hinterlegt (*Vollmacht-Einstellungen → Rücksprungadresse*:
   `https://easykfz24.de/vollmacht/abschluss`; gelesen am 13.10.2026, vom Inhaber gespeichert). Markenname EasyKFZ24,
   Reply-To kundenservice@easykfz24.de und Logo sind ebenfalls gesetzt.
2. Erster echter Test (oben) erfolgreich.
3. `VOLLMACHT_DIGITAL=1` in Cloudflare setzen (macht das Geburtsort-Feld im Bestellformular zur Pflicht).
4. Für Firmenkunden Business Sign beim Partner freischalten lassen.
5. Kunden-E-Mails zum Vollmachtsstand erst nach Anbindung von Resend.
