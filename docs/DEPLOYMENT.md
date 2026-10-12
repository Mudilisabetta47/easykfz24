# EasyKFZ24 OS – Deployment- und Rollback-Plan

Gilt für den Wechsel von der ausgelieferten Version (Commit `0937ed6`, D1-Schema **3**) auf EasyKFZ24 OS Enterprise
(D1-Schema **6**). Jeder Schritt mit ⚠️ ändert die Produktion und wird **nur nach ausdrücklicher Freigabe** ausgeführt.

Infrastruktur bleibt unverändert: Worker `easykfz24` (OpenNext), D1 `easykfz24` (Bindung `DB`), R2 `easykfz24-uploads`
(EU, privat, Bindung `UPLOADS`), Deploy über Workers Builds bei Push auf `main` (`npm run build` → `npx wrangler deploy`).

---

## 0. Freigabe-Tore

| Tor | Was | Wer |
|---|---|---|
| A | Testbericht gelesen, offene Punkte akzeptiert (`docs/TESTBERICHT.md`) | Inhaber |
| B | Geheimnisse in Cloudflare gesetzt/geprüft (Abschnitt 2) | Inhaber (Dashboard) |
| C | ⚠️ Datenbank-Migration auf D1 (Abschnitt 4) | Freigabe Inhaber |
| D | ⚠️ Commit + Push auf `main` → automatischer Deploy (Abschnitt 5) | Freigabe Inhaber |

Ohne Tor C kein Tor D. Zwischen C und D läuft die alte Version weiter (verträglich mit Schema 6, getestet).

### Vorbereitungsstand 12.10.2026 (gegen die Produktion nur lesend geprüft)

| Punkt | Stand |
|---|---|
| Live-Version | Worker-Version `1e3473b6-b1a4-4d9f-8ad3-ab74b7bc4daa` (12.10.2026, 00:37 UTC) = Commit `0937ed6` → **Rollback-Ziel** |
| Produktions-D1 | Schema 3, **0 Aufträge, 0 Dokumente, 0 Ereignisse** (nur Schema + 3 Versionszeilen), 106 KB |
| R2 `easykfz24-uploads` | **0 Objekte** |
| Backup | `~/EasyKFZ24-Backups/2026-10-12/easykfz24-d1-20261012-120114.sql` (SHA-256 `83cd5585…dbc9736`), Time-Travel-Lesezeichen vor dem Backup `00000003-00000002-00005102-ba51ce2d225f7d5ccf9f744d64dae1e2` |
| Wiederherstellung | geprüft: Import in leere D1 **und** in SQLite → 17/17 Schemaobjekte identisch, Zeilen identisch, `integrity_check` ok |
| Migrations-SQL | `~/EasyKFZ24-Backups/2026-10-12/migration-v4-v6.sql` (SHA-256 `35dac762…dc25c260`), 79 Anweisungen, nur `CREATE`/`ADD COLUMN`/Versionszeilen |
| Probelauf | auf der wiederhergestellten Produktionskopie 18/18 (Bestandsauftrag vorher/nachher, Zahlungsseite, Webhook, Rollback); migriertes Schema = frisches Schema 6 (63/63) |
| Geheimnisse live | **nur `KFZ_API_WEBHOOK_SECRET`** – `ADMIN_PASSWORD`, `SESSION_SECRET` fehlen (Verwaltung sonst nicht nutzbar); `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` fehlen (Online-Zahlung ist live derzeit **nicht aktiv**, Seite zeigt „in Kürze freigeschaltet“) |
| Hinweis | `www.easykfz24.de` ist nicht erreichbar (kein DNS/keine Route) – nur `easykfz24.de` |

---

## 1. Vor dem Deploy (lokal, ohne Produktion)

```bash
npm run typecheck          # TypeScript ohne Fehler
npm test                   # 135 Unit-/Integrationstests
npm run build              # Next.js + Cloudflare-Worker (.open-next/worker.js)
npm run test:e2e           # 101 Endpunkte, Abläufe, Sicherheit – Node UND Cloudflare-Laufzeit (workerd, D1, R2)
```

Migrationstest mit echten Altdaten (Ablauf im Kopf von `scripts/e2e-migration.mjs`): der ausgelieferte Stand legt
Bestellungen mit Unterlagen (R2), eine Stripe-Zahlung und kfz-Meldungen an, danach Migration 3 → 6 auf beiden Wegen
(SQL vorab / Laufzeit) und Prüfung aller Daten mit der neuen Version. Ergebnis zuletzt: **11/11 Prüfungen je Weg**.

Prüfen, dass keine lokalen Daten oder Geheimnisse im Build liegen:

```bash
ls .next/standalone/data .open-next/server-functions/default/data   # → „No such file or directory“
find .next/standalone .open-next -name ".env*" -o -name ".dev.vars"  # → keine Ausgabe
```

---

## 2. Geheimnisse und Variablen (Cloudflare → Worker easykfz24 → Einstellungen → Variablen und Geheimnisse)

| Name | Pflicht | Hinweis |
|---|---|---|
| `ADMIN_PASSWORD` | ja | Inhaber-Anmeldung, mind. 12 Zeichen. Ohne: keine Anmeldung möglich. |
| `SESSION_SECRET` | ja | mind. 32 Zeichen, zufällig. **Achtung:** Sitzungen UND die Zwei-Faktor-Schlüssel sind damit verschlüsselt. Ändern = alle abgemeldet **und alle 2FA-Einrichtungen ungültig** (müssen neu eingerichtet werden). Nicht rotieren ohne Plan. |
| `KFZ_API_WEBHOOK_SECRET` | ja | wie bisher (Signaturprüfung der kfz-api.de-Webhooks) |
| `STRIPE_WEBHOOK_SECRET` | ja | wie bisher (Signaturprüfung, 5 Minuten Toleranz) |
| `STRIPE_SECRET_KEY` | ja | wie bisher; nur serverseitig (Checkout, „Zahlung bei Stripe abrufen“) |
| `PUBLIC_BASE_URL` | ja | `https://…` der Live-Seite (Links in E-Mails, Stripe-Rückkehr) |
| `RESEND_API_KEY` / `SMTP_URL`, `MAIL_FROM` | optional | ohne: Kunden-E-Mails bleiben Entwürfe, Versand meldet „nicht eingerichtet“ |
| `KFZ_API_BASE_URL`, `KFZ_API_LOGIN`, `KFZ_API_PASSWORD` | optional | nur für Verbindungstest/Abfragen; **keine Antragsübermittlung** (im Code gesperrt) |
| `PLATE_AVAILABILITY_URL`, `PLATE_AVAILABILITY_KEY` | optional | Wunschkennzeichen-Prüfung |

Keiner dieser Werte erscheint im Frontend (geprüft: Einstellungs- und Sitzungsantworten enthalten keine Schlüssel;
Build-Ausgabe enthält keine `.env`-Dateien).

---

## 3. Sicherung (vor Tor C, nur lesend)

```bash
# Vollständiger SQL-Export der Produktionsdatenbank (lesend)
npx wrangler d1 export easykfz24 --remote --output=backup/easykfz24-$(date +%Y%m%d-%H%M).sql

# Zeitpunkt für Time Travel merken (Wiederherstellungspunkt der letzten 30 Tage)
npx wrangler d1 time-travel info easykfz24
```

Den Export **nicht** ins Repository legen (enthält Kundendaten) – verschlüsselt ablegen. R2 wird nicht verändert
(neue Dateien nur hinzugefügt, Schlüsselformat unverändert), daher keine R2-Sicherung nötig.

---

## 4. ⚠️ Datenbank-Migration (Tor C)

Empfohlen: SQL **vor** dem Code-Deploy ausführen – nicht im ersten Worker-Aufruf (79 Anweisungen; der Worker hätte
sonst bei D1-Abfragegrenzen je Aufruf ein Risiko). Die Migration ist **rein additiv** (neue Tabellen, neue Spalten
mit Standardwerten, neue Indizes) – bestehende Daten werden nicht verändert oder gelöscht.

```bash
node --experimental-strip-types scripts/d1-migration-sql.mjs 4 > migration-v4-v6.sql
# Datei sichten (nur CREATE TABLE / ALTER TABLE ADD COLUMN / CREATE INDEX / INSERT INTO schema_migrations)
npx wrangler d1 execute easykfz24 --remote --file=migration-v4-v6.sql
npx wrangler d1 execute easykfz24 --remote --command "SELECT MAX(version) AS v FROM schema_migrations"   # → 6
```

Danach läuft die **alte** Version unverändert weiter (getestet: Bestellung mit Upload, Stripe-Webhook, kfz-Webhook
auf Schema 6). Einziger sichtbarer Unterschied bis zum Deploy: `/api/health` meldet `ok:false` (Schema 6, erwartet 3).

Fallback ohne Vorab-SQL: der neue Worker migriert beim ersten Datenbankzugriff selbst (ebenfalls getestet).

---

## 5. ⚠️ Deploy (Tor D)

```bash
cd <Projektordner> && pwd                     # immer zuerst prüfen (nie aus dem Home-Ordner)
git status                                     # nur erwartete Dateien, keine .env/.dev.vars/data/test-results
git add -A && git commit                       # Nachricht mit Co-Authored-By-Zeile
git push origin main                           # → Workers Builds: npm run build, npx wrangler deploy
```

Build-Log in Cloudflare beobachten (Workers & Pages → easykfz24 → Bereitstellungen). Die vorherige Version bleibt als
Rollback-Ziel erhalten.

---

## 6. Prüfungen direkt nach dem Deploy (Smoke-Test, ohne kostenpflichtige Aktionen)

| # | Prüfung | Erwartung |
|---|---|---|
| 1 | `https://<domain>/api/health` | `ok:true`, `schema:6`, `platform:cloudflare`, `db:true`, `uploads:true` |
| 2 | Startseite, eine SEO-Seite, `/status` | laden, FE-Schrift sichtbar |
| 3 | `/admin` → Anmeldung Inhaber | Desktop startet, Startbildschirm ohne Fehler |
| 4 | Systemeinstellungen → Diagnose | D1 ok, R2 schreiben/lesen/löschen ok, Schema 6/6 |
| 5 | Auftragscenter: bestehende Aufträge, ein Dokument öffnen | Altaufträge und Altunterlagen vorhanden |
| 6 | Kundenverwaltung | Kunden aus Altaufträgen erscheinen (Übernahme in kleinen Schritten beim Öffnen) |
| 7 | KFZ-API Center → „Verbindung prüfen“ / PING aus dem kfz-api.de-Dashboard | PING bestätigt, Ereignis protokolliert |
| 8 | Stripe-Dashboard → Webhook → „Testereignis senden“ | 200, keine Buchung (Test-Session ohne Auftrag) |
| 9 | `npx wrangler tail easykfz24` während 1–8 | keine Fehler (`[os] Fehler`, 5xx) |

Eine echte Testbestellung mit Zahlung ist **nicht** Teil des Smoke-Tests (kostenpflichtig) – nur nach Freigabe.

---

## 7. Einstellungen nach dem Deploy (einmalig)

1. **Stripe-Dashboard → Webhook-Endpunkt** um die Ereignisse `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed` und `checkout.session.expired` ergänzen (bisher nur `completed`).
2. **R2:** öffentliche `r2.dev`-URL des Buckets `easykfz24-uploads` deaktiviert lassen/deaktivieren (Uploads nur über
   die geschützte Route mit Rechteprüfung und Protokoll).
3. **Inhaber-Zwei-Faktor** einrichten (Systemeinstellungen → Konto). Wiederherstellung bei Geräteverlust:
   `npx wrangler d1 execute easykfz24 --remote --command "UPDATE settings SET value = '' WHERE key = 'owner_totp'"` ⚠️
4. **Unternehmensdaten** (Systemeinstellungen → Unternehmen) vollständig ausfüllen – vorher sind Rechnungen gesperrt.
5. **Benutzer** für Mitarbeitende anlegen (eigene Rolle, eigene E-Mail), Zwei-Faktor empfehlen.
6. Empfehlung: Cloudflare **WAF-Rate-Limit** für `POST /admin/login` und `POST /api/admin/os/unlock`
   (z. B. 20 Anfragen/Minute je IP) als zusätzliche Schicht zur eingebauten Sperre (10 Fehlversuche/15 Min je IP,
   60 gesamt).

---

## 8. Rollback

**Code (jederzeit, Sekunden):** Die neue Version ändert nur additiv am Schema – die alte Version läuft auf Schema 6
(getestet). Daher genügt:

```bash
npx wrangler deployments list               # im Repo-Ordner; vorherige Version-ID ermitteln
npx wrangler rollback <version-id>          # ⚠️ Freigabe
```

oder im Dashboard: Bereitstellungen → vorherige Version → „Rollback“. Danach `/api/health` (meldet `ok:false` wegen
Schema 6 – erwartet) und eine Bestellung im Auftragsverlauf prüfen. Daten aus dem OS (Kunden, Aufgaben, Rechnungen,
Nachrichten) bleiben in D1 erhalten und sind nach einem erneuten Deploy wieder da.

**Datenbank (nur bei Datenfehlern, verlustbehaftet):** Time Travel auf den Zeitpunkt vor der Migration setzt **alle**
Änderungen danach zurück (auch neue Bestellungen/Zahlungen!) – nur als letzte Möglichkeit:

```bash
npx wrangler d1 time-travel restore easykfz24 --timestamp=<ISO-Zeitpunkt vor Tor C>   # ⚠️ Freigabe
```

Vorher die Bestellungen seit der Migration aus dem SQL-Export bzw. dem Auftragscenter sichern. Danach zwingend die alte
Code-Version (Schema 3) ausrollen.

**Entscheidungshilfe:**

| Symptom | Maßnahme |
|---|---|
| OS lädt nicht / 5xx in der Verwaltung, Website ok | Code-Rollback, Fehler lokal nachstellen |
| Website-Bestellung schlägt fehl | sofort Code-Rollback (Bestellweg ist Kerngeschäft) |
| Webhooks (Stripe/kfz) liefern 5xx | Code-Rollback; Stripe/kfz-api.de stellen erneut zu, Dubletten werden erkannt |
| Daten falsch geschrieben | Code-Rollback, gezielte Korrektur per SQL; Time Travel nur nach Abwägung |
