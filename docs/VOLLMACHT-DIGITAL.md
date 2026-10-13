# Digitale Vollmacht & automatische Rückleitung

Stand: 13.10.2026 · Partner: kfz-api.de „Vollmacht für Dritte mit Nect“ (OpenAPI `/spec/api.yaml` 2.3.0)

## Dokumentierte Fakten (Grundlage der Umsetzung)

| Thema | laut Partner-Doku |
|---|---|
| Anlegen | `POST /powerOfAttorneys` – **kostenpflichtig (6,95 € je Vorgang) und rechtsverbindlich** |
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

## Ablauf

1. Auftrag geht ein (bei aktivem Schalter mit Pflichtfeld **Geburtsort**, wie im Ausweis).
2. Mitarbeiter fordert im OS (Auftrag → Übersicht → „Digitale Vollmacht“) den Vorgang an – **nur manuell**, mit Kostenhinweis.
   Vorab-Prüfung der Pflichtangaben; fehlt etwas, entsteht kein Vorgang und keine Kosten.
3. Server legt zuerst den Datensatz an (`externalOrderId` = `EK-JJJJ-NNNNN-V<Versuch>`), dann `POST`. Geht die Antwort
   verloren, liefert die Wiederholung mit derselben `externalOrderId` denselben Vorgang – keine Doppelkosten.
4. Der Partner schickt den Unterschriftslink (White-Label-E-Mail) – im OS zusätzlich „Unterschriftslink kopieren“.
5. Kunde identifiziert sich und unterschreibt bei Nect (inkl. SEPA-Mandat, wenn eine IBAN vorliegt).
6. Rückleitung auf `https://easykfz24.de/vollmacht/abschluss?powerOfAttorneyId=…&status=…`.
7. Die Seite fragt den **Server** – der Server fragt den Partner (`GET`, gedrosselt auf 1× je 15 s und Vorgang).
8. Angezeigt wird **nur** der vom Partner bestätigte Stand; der `status`-Parameter der URL wird ignoriert.
9. Änderungen werden im Auftrag gespeichert, im Verlauf protokolliert und als OS-Ereignis (mit Dublettenschlüssel) gemeldet.
10. Zeitregel „Vollmacht-Abgleich“ prüft offene bzw. unvollständige Vorgänge alle 10 Minuten – auch wenn der Kunde
    das Fenster schließt und nie zurückkommt.

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

## Schalter (Umgebungsvariablen)

| Variable | Wirkung | Vorgabe |
|---|---|---|
| `VOLLMACHT_DIGITAL=1` | Anfordern neuer Vorgänge + Pflichtfeld Geburtsort | aus |
| `VOLLMACHT_EMAIL_SENDEN=0` | Partner schickt **keine** E-Mail | Partner sendet |
| `VOLLMACHT_RUECKSPRUNG_URL` | im Dashboard hinterlegte Adresse | `https://easykfz24.de/vollmacht/abschluss` |
| `VOLLMACHT_REDIRECT_SENDEN=1` | `redirectUrl` je Vorgang mitsenden | aus |

Ohne `VOLLMACHT_DIGITAL` bleibt alles wie bisher: kein Geburtsort-Feld, keine Anforderung, keine Kosten.
Abschlussseite, Abgleich und Zeitregel sind harmlos (nur kostenlose Abfragen vorhandener Vorgänge).

## Getestet (13.10.2026, Testnachbau, keine echten Vorgänge)

Anforderung ohne Geburtsort (abgewiesen, kein Vorgang) · Anforderung V1 · doppelte Anforderung (derselbe Vorgang) ·
Rückkehr mit `status=signed` bei offenem Vorgang („wird noch verarbeitet“) · Unterschrift bestätigt (Erfolg, OS
„unterschrieben“) · Rückkehr mit `status=pending` bei unterschriebenem Vorgang (Erfolg) · ohne Parameter, nur `status`,
`powerOfAttorneyId=abc`, Skript-Einschleusung, unbekannte Nummer (neutral) · unbekannter Statuswert (ignoriert) ·
abgelaufen → OS „Neuen Vorgang anfordern“ → V2 · Partner offline (bisheriger Stand, `checkFailed`) · unterschrieben
mit fehlenden Angaben · Statusabfrage mit Vollmacht-Block getrennt von Zahlung und Bearbeitung · Mobil 375 px ohne
Querscrollen · Unit-Tests 195/195 · E2E Node und Worker je 59/59 · Produktions-Build.

## Vor dem Einschalten (Checkliste)

1. Im kfz-api.de-Dashboard unter *Vollmachten › Einstellungen → Rücksprungadresse nach der Unterschrift*
   `https://easykfz24.de/vollmacht/abschluss` eintragen und speichern (macht der Inhaber – von hier aus **nicht** gesetzt).
2. Dort White-Label-Absender/Logo für die Partner-E-Mail prüfen.
3. Secrets `KFZ_API_LOGIN` / `KFZ_API_PASSWORD` gesetzt lassen; `VOLLMACHT_DIGITAL=1` setzen.
4. Einen echten Vorgang (6,95 €) mit eigenem Auftrag durchspielen.
5. Für Firmenkunden Business Sign beim Partner freischalten lassen.
6. Kunden-E-Mails zum Vollmachtsstand erst nach Anbindung von Resend.
