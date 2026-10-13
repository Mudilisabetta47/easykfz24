# Go-live-Bericht EasyKFZ24 OS Enterprise

**Datum:** 12.10.2026 · **Ergebnis: erfolgreich veröffentlicht, keine Fehler, kein Rollback nötig**

| | |
|---|---|
| Veröffentlichter Commit | `8d8c34b` (Push 10:38:22 UTC, `0937ed6..8d8c34b`) |
| Cloudflare-Build | Workers Builds `bf822e26-2e17-43fa-97ff-500805b20456` – **erfolgreich** (fertig 10:40:11 UTC) |
| Live-Version | `07433a67-4527-4599-879f-e7c44519e48d` (100 %, seit 10:40:05 UTC) |
| Rollback-Ziel | `2d4a3cea-a1ce-4341-8fd5-fb35c31f1f15` (vorherige Version inkl. gesetzter Secrets, mit Schema 6 verträglich – getestet) |
| Datenbank | D1 `easykfz24`, Schema **6** (Migration 10:35:58–10:36:00 UTC, siehe unten) |
| Dateispeicher | R2 `easykfz24-uploads` (EU), privat: r2.dev-Zugang **deaktiviert**, keine öffentliche Domain |

Ausgelöst wurden **keine** Zahlungen, Zulassungsaufträge, Test-Bestellungen oder E-Mails. Bestehende Daten wurden
nicht verändert oder gelöscht.

---

## Ablauf

| Zeit (UTC) | Schritt | Ergebnis |
|---|---|---|
| 10:2x | Secrets geprüft (nur Namen) | `ADMIN_PASSWORD`, `SESSION_SECRET`, `KFZ_API_WEBHOOK_SECRET` vorhanden; Mindestlängen erfüllt (Live-Anmeldeseite ohne Konfigurationswarnung) |
| 10:35 | Abschließende Sicherheitsprüfungen | Produktion Schema 3 unverändert; neues Backup (byte-gleich mit erstem Backup) wiederherstellbar; Time-Travel-Lesezeichen `00000006-00000000-00005102-ab0bea0a…`; Migrations-SQL = Commit `8d8c34b`, Prüfsumme ok; Probelauf auf dem Backup 63/63 |
| 10:35:58 | ⚠️ D1-Migration 3 → 6 (freigegeben) | `success`, 11 ms, Versionen 1–6, 63/63 Schemaobjekte = getestetes Schema 6, Altdaten unverändert |
| 10:36 | Backup nach Migration | gesichert, Lesezeichen `00000006-00000009-00005102-ddd70589…` |
| 10:38:22 | ⚠️ Push `8d8c34b` → `main` (freigegeben) | angenommen |
| 10:38–10:40 | Cloudflare-Build und Deploy | erfolgreich, Version `07433a67` live |
| 10:40–10:45 | Prüfungen nach Veröffentlichung | alle bestanden (unten) |

Backups, Migrationsdatei, Protokoll und Lesezeichen: `~/EasyKFZ24-Backups/2026-10-12/` (nur für den Inhaber lesbar).

---

## Prüfungen nach der Veröffentlichung

| # | Prüfung | Ergebnis |
|---|---|---|
| 1 | **Neue Verwaltung** unter `/admin` | ✅ `/admin` leitet ohne Sitzung zur Anmeldung, Seite „EasyKFZ24 OS – bitte anmelden“ (neue Oberfläche), keine Konsolenfehler; Header `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, `X-Frame-Options: SAMEORIGIN` |
| 2 | **Health-Check / Schema** | ✅ `{"ok":true,"schema":6,"expected":6,"platform":"cloudflare","db":true,"uploads":true}` |
| 3 | **Anmeldung** | ✅ Anmeldestrecke arbeitet: falsche Zugangsdaten → 401 „Benutzername oder Passwort ist nicht korrekt“ (protokolliert); Verwaltungs-API ohne Sitzung → 401 gesperrt. Eine echte Anmeldung habe ich bewusst **nicht** durchgeführt (Inhaber-Passwort nur bei dir) |
| 4 | **D1 und R2** | ✅ D1 lesen und schreiben über die neue Version (Benutzerprüfung + Protokolleintrag); Bindungen D1/R2 aktiv. ⏳ Der Schreib-/Lese-/Löschtest auf R2 läuft über die Diagnose nach Anmeldung (siehe „Deine nächsten Schritte“) |
| 5 | **kfz-api.de-Webhook** | ✅ Endpunkt live, Signaturprüfung aktiv: ohne bzw. mit falscher Signatur → 401, nichts gespeichert; Secret gesetzt. ⏳ Echter PING aus dem kfz-api.de-Dashboard empfohlen |
| 6 | **Bestellstrecke** | ✅ Startseite, `/kfz-anmelden`, `/kennzeichen`, `/status`, Impressum, Datenschutz → 200; Bestell-API prüft Eingaben (unvollständig → 422 mit Feldfehlern, nichts gespeichert) |
| 7 | **Zahlungsseite** | ✅ ungültiger Zahlungslink → „Zahlungslink ungültig“, keine Daten; „Bezahlen“ mit ungültigem Link → Weiterleitung zur Statusseite; gefälschter Stripe-Webhook abgewiesen (503 „nicht konfiguriert“, da Stripe-Schlüssel noch fehlen). Vor dem Go-live geprüft: Bestands-Zahlungslinks und Stripe-Checkout-Anfrage identisch zur Vorversion |
| 8 | **Fehlerprotokolle / Bereitstellung** | ✅ Live-Mitschnitt (`wrangler tail`) während der Prüfungen: 16 Anfragen, **0 Ausnahmen, 0 Serverfehler**, 1 erwartete Warnung (eigener Test „Webhook ohne Signatur“); Bereitstellung 100 % auf `07433a67` |
| + | **Keine Geheimnisse im Frontend** | ✅ 14 ausgelieferte JS-Dateien (629 KB) ohne Schlüsselmuster und ohne einen der lokalen Geheimwerte |
| + | **Kennzeichenschrift** | ✅ nicht als Datei abrufbar (`.ttf`/`.enc` → 404) |

### Datenbank nach dem Go-live (lesend geprüft)

Schema-Versionen 1–6 · Aufträge 0 · Dokumente 0 · Kunden 0 · Benutzer 0 · Zahlungen 0 · kfz-Meldungen 0 ·
Protokoll: 2 Einträge `entsperren.fehlgeschlagen` (meine beiden absichtlichen Fehlanmeldungen, 10:41 UTC) ·
R2: 0 Objekte.

Hinweis: Die beiden Fehlversuche zählen 15 Minuten lang zur Anmeldesperre derselben IP (Grenze 10) – ohne Auswirkung
auf eine normale Anmeldung.

---

## Deine nächsten Schritte

1. **Anmelden** unter https://easykfz24.de/admin – Benutzername leer lassen, Passwort = `ADMIN_PASSWORD`.
2. **Zwei-Faktor einrichten:** Systemeinstellungen → Konto → Zwei-Faktor (Code-App, z. B. Authenticator).
3. **R2-Test:** Systemeinstellungen → System & Diagnose → Speichertest (schreibt, liest und löscht eine Prüfdatei).
4. **Unternehmensdaten** (Systemeinstellungen → Unternehmen) – erst danach sind Rechnungen möglich.
5. **kfz-api.de:** im Dashboard von kfz-api.de einen PING senden → erscheint im KFZ-API Center als „PING“.
6. **Mitarbeitende** als Benutzer mit passender Rolle anlegen.
7. **Online-Zahlung** (wenn gewünscht): `STRIPE_SECRET_KEY` und `STRIPE_WEBHOOK_SECRET` als Secret setzen und im
   Stripe-Webhook die Ereignisse `checkout.session.completed`, `…async_payment_succeeded`, `…async_payment_failed`,
   `…expired` aktivieren. Bis dahin zeigt die Zahlungsseite „Online-Zahlung wird in Kürze freigeschaltet“.
8. Optional: `PUBLIC_BASE_URL=https://easykfz24.de`, E-Mail-Versand (`RESEND_API_KEY`/`MAIL_FROM`), DNS für
   `www.easykfz24.de` (derzeit nicht erreichbar), WAF-Rate-Limit für die Anmeldung.

## Rollback (falls nötig)

```bash
npx wrangler rollback 2d4a3cea-a1ce-4341-8fd5-fb35c31f1f15
```

Die Datenbank bleibt dabei auf Schema 6 (mit der Vorversion getestet). Eine Wiederherstellung per Time Travel ist nur
bei Datenfehlern vorgesehen (Lesezeichen vor der Migration im Backup-Ordner).
