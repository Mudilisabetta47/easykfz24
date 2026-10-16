# Verfügbarkeitsprüfung – Aktivierung am 16.10.2026

Der Inhaber hat die Live-Aktivierung angefordert und ein gemeinsames Kostenlimit von **10 € netto pro Tag**
für Website und OS freigegeben. Tagesgrenze: Europe/Berlin. Höchstens 100 erste Einzelprüfungen zu maximal
10 Cent je Referenz; technische Fehler/UNKNOWN bleiben vorsorglich im internen Budget gebunden.

## Erweiterung gegenüber dem ursprünglichen Draft

Die öffentliche Website erhält einen ausdrücklichen Prüfbutton im Kennzeichen-Konfigurator. Nur vollständige
Kombinationen und ausdrücklich ausgewählte Behörden werden geprüft. Katalog, Vorschläge und Tippen lösen
keine kostenpflichtigen Suchen aus. Keine öffentlichen Reservierungsaufrufe. Die bestehende serverseitige
KFZ-API-Anmeldung bleibt unverändert; weder Browser noch Logs erhalten Zugangsdaten.

Der neue öffentliche POST verlangt Same-Origin, JSON, höchstens 4 KiB, `confirmed: true`, eine gültige Referenz
und die separate Freigabe `KENNZEICHEN_PUBLIC_SEARCH_ENABLED=1`. Benutzerkennung und Drosselung beruhen auf
einer serverseitig gehashten IP; IP-Adressen werden nicht im Kennzeichen-Vorgang gespeichert. Öffentliche
Prüfungen und OS teilen sich das atomare Tagesbudget. Ein Ergebnis benennt seinen ursprünglichen Prüfzeitpunkt;
Wiederholungen mit gleicher Referenz zeigen dasselbe Ergebnis. Verfügbarkeit reserviert nichts.

`KENNZEICHEN_METADATA_ENABLED=1` erlaubt den kostenlosen Katalogabgleich auch vor Freigabe der Suche.
Unbekannte Anbieterformate bleiben gesperrt. Zur Diagnose werden nur Feldnamen/Typen ausgegeben, niemals Werte.

## Vorgehen

1. Produktionsstand und Einstellungen gesichert. Bisher aktive Version: `8d951ad8-f63f-4ae2-88a1-d1ab16266249`.
2. D1-Export vor Änderungen lokal geschützt unter `work/activation-backup/` außerhalb des Repositorys erstellt.
3. Additive Migration 12 → 13 lokal mit Bestandsdaten geprüft; keine bestehenden Geschäftstabellen geändert.
4. Typprüfung, Unit-/Integrationstests und vollständige End-to-End-Tests lokal auf Node und workerd.
5. Zuerst Deployment mit gesperrter Suche und kostenlosem Metadatenabgleich; danach Live-Format prüfen.
6. Erst nach erfolgreichem Abgleich Freigabe der Suchflags und Budget 1000 Cent; eine Einzelprüfung als Smoke-Test.
7. Bestehende Variablen einschließlich Mollie, Checkout und QES bleiben erhalten; Abgleich der Bindungen vor/nach Deployment.

Rollback: vorherige Worker-Version wiederherstellen; additive Kennzeichentabellen dürfen bestehen bleiben.
Keine Rücksetzung der Produktionsdatenbank erforderlich. Echte Reservierungen bleiben unabhängig von allen Flags gesperrt.
