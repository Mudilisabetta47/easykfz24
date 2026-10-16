# Leistungskarten – Layoutkorrektur und Browserprüfung

Stand: 16.10.2026 · Branch `codex/kennzeichen-api` · Draft-PR #1

## Ursache und Korrektur

Die animierte Desktopansicht begrenzte jede Karte auf `min(62svh, 560px)`.
Der Inhalt aus Überschrift, Beschreibung, Tags, Preis, Rabatt und CTA war bei geringer Fensterhöhe größer.
Gleichzeitig wurde die Bühne auf `100svh` begrenzt und ihr Überlauf abgeschnitten.

Die Karten erhalten jetzt ihre Höhe aus dem Inhalt. Das Raster verwendet gleich hohe Zeilen, die horizontale
Schiene streckt alle Karten auf die Höhe der größten Karte. Preise bleiben mit automatischem oberen Abstand
am Kartenfuß; alle CTA-Flächen reservieren dieselbe Höhe für bis zu zwei Textzeilen. Dadurch bleiben auch
320-px-Ansichten und umgebrochene Buttontexte ausgerichtet. Die vorhandene Innenpolsterung bleibt vollständig erhalten.

Die horizontale Sticky-Animation wird erst nach Messung aktiviert, wenn Überschrift, Karten und obere/untere
Abstände vollständig in die Fensterhöhe passen. Andernfalls bleibt ein normales, vertikal scrollbareres Raster.
Bei Größenänderungen wird neu gemessen, bei reduzierter Bewegung bleibt die Ansicht statisch.
Es wurde kein neuer `overflow: hidden`-Trick ergänzt; das Abschneiden der Leistungsbühne wurde entfernt.

Der blaue SCROLL-Kreis im Ausgangsbild ist der dekorative Mauszeiger des Ablaufabschnitts, kein eigener Button.
Die Karten enden jetzt innerhalb ihrer Bühne: horizontal bleiben mindestens 64 px Bühnenpolsterung nach unten;
im Raster greift der bestehende Abschnittsabstand (mindestens 80 px). Damit bleibt der Kreis mit 38 px Radius
außerhalb der Leistungskarten. Cursor-, Hover-, Reveal-, Tilt- und horizontale Scrollanimationen bleiben erhalten.

Farben, Schriftarten, Radien und Schatten werden weiterhin unverändert aus den vorhandenen Design-Tokens bezogen.
Die neue CTA-Mindesthöhe lässt längere Texte umbrechen. Keine Änderungen an Kennzeichen-API, Zahlungen,
Checkout oder sonstigen Geschäftsprozessen. Kein Deployment.

## Browserprüfungen

Alle vier Karten wurden pro Ansicht aufgerufen und im Browser vermessen. Einheitliche Höhen, Preis-, Rabatt-
und Buttonpositionen sowie fehlender horizontaler und vertikaler Kartenüberlauf wurden anhand der DOM-Geometrie geprüft.
Screenshots zeigen tatsächliche Browserdarstellungen, keine nachgebauten Mockups.

| Effektiver CSS-Viewport | Layout | Höhe je Karte | Unterer CTA-Abstand | Kartenüberlauf |
|---|---|---:|---:|---:|
| 320 × 568 | grid | 563 px | 25–25 px | 0 px |
| 390 × 844 | grid | 537 px | 25–25 px | 0 px |
| 820 × 1180 | grid | 574 px | 30–30 px | 0 px |
| 1440 × 1000 | horizontal | 591 px | 37–37 px | 0 px |
| 1440 × 600 | grid | 591 px | 37–37 px | 0 px |
| 1152 × 640 | grid | 570 px | 35–36 px | 0 px |
| 960 × 533 | grid | 553 px | 32–33 px | 0 px |
| 720 × 400 | grid | 565 px | 29–29 px | 0 px |
| 1440 × 900 | statisch (reduzierte Bewegung) | 591 px | 37–37 px | 0 px |

Die Viewports 1152 × 640, 960 × 533 und 720 × 400 entsprechen für eine Ausgangsfläche von 1440 × 800
den effektiven CSS-Fenstergrößen bei 125 %, 150 % und 200 % Browserzoom. Dies ist eine Prüfung der entsprechenden
Layoutgrößen, keine Behauptung einer über Browsermenüs umgestellten Zoomstufe. Zusätzlich wurde Chrome bei
vorhandenen 90 % Zoom vermessen. Für verlässliche Screenshots wurde nach einer unterbrochenen Chrome-Steuerung
der getrennte In-App-Browser verwendet. Dessen temporäre Größenanpassung wurde zurückgesetzt.

## Kontrollbilder

Die Bilder werden als Chat-Ausgaben bereitgestellt und sind nicht ins Repository eingecheckt.

- `Leistungskarten-Desktop.jpg`: Beginn der horizontalen Schiene, 1440 × 1000.
- `Leistungskarten-Desktop-vierte-Karte.jpg`: Ende der Schiene einschließlich Abmeldung.
- `Leistungskarten-Desktop-niedrig.jpg`: alle vier Karten bei 1440 × 600 im Raster.
- `Leistungskarten-Tablet.jpg`: alle vier Karten bei 820 × 1180.
- `Leistungskarten-Smartphone.jpg`: alle vier Karten bei 390 × 844.
- `Leistungskarten-Smartphone-320.jpg`: alle vier Karten bei 320 × 568.
- `Leistungskarten-Zoom-200-Viewport.jpg`: alle vier Karten im effektiven 200-%-Viewport.
- `Leistungskarten-Messwerte.json`: unverarbeitete Geometriemessungen.

Technische Änderungen ausschließlich in `src/styles/home.css` und `src/motion/scenes/sections.ts`.

## Abschließende Prüfungen

- Typprüfung bestanden.
- 318/318 Unit-/Integrationstests bestanden.
- Next.js-Produktionsbuild einschließlich Cloudflare-Worker bestanden.
- 71/71 End-to-End-Tests auf Node und 71/71 auf lokalem Cloudflare workerd bestanden.
- `git diff --check` bestanden.
- Desktop-Kontrollbilder zuletzt zusätzlich mit dem gebauten Produktionsserver aufgenommen.
- Kein Deployment; Änderungen nur auf dem bestehenden Feature-Branch.
