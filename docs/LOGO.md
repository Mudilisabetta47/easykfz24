# EasyKFZ24 – Logo

Stand: 13.10.2026 · Variante **B „E-Pfeil“** (vom Inhaber gewählt)

## Aufbau

- **Bildmarke:** abgerundetes Quadrat in Markenblau, darin ein E, dessen Mittelbalken als Pfeil nach vorn läuft –
  schnell, digital, einfach.
- **Wortmarke:** „EASY“ (Dunkelblau) + „KFZ24“ (Markenblau), **eigene geometrische Konstruktion** (keine Schriftdatei, keine Fremdlizenz).
  Bewusst technisch-aufrecht als Anklang an Kennzeichen – ohne die amtliche Kennzeichenschrift, ohne EU-Sterne oder Hoheitszeichen.
- **Verbund:** Versalhöhe der Wortmarke = 60 % der Bildmarke, Abstand Bildmarke–Wortmarke = 30 % der Bildmarkenhöhe.

## Farben

| Name | Wert | Verwendung |
|---|---|---|
| Markenblau | `#2a55ff` | Bildmarke, „KFZ24“ auf hellem Grund |
| Dunkelblau | `#0a1433` | „EASY“ auf hellem Grund |
| Hellblau | `#7f9bff` | „KFZ24“ auf dunklem Grund |
| Weiß | `#ffffff` | Zeichen in der Bildmarke, „EASY“ auf dunklem Grund |

## Dateien (`public/logo/`)

| Datei | Einsatz |
|---|---|
| `easykfz24-logo.svg` / `.png` | Standard auf hellem Grund |
| `easykfz24-logo-negativ.svg` / `.png` | auf dunklem Grund |
| `easykfz24-logo-schwarz.svg` / `.png` | einfarbig schwarz (Druck, Fax, Stempel) |
| `easykfz24-logo-weiss.svg` / `.png` | einfarbig weiß auf Fotos/Farbflächen |
| `easykfz24-bildmarke.svg`, `icon-192.png`, `icon-512.png` | App-Symbol, Social Media |
| `easykfz24-bildmarke-vollflaeche.svg`, `/apple-touch-icon.png` | iOS-Startbildschirm (ohne eigene Rundung) |
| `easykfz24-logo-mail.png` | Kopf der Kunden-E-Mails |
| `/favicon.svg` | Browser-Tab |

SVG ist die Vorlage für Druck und Werbemittel; PNGs sind transparent.

## Regeln

- Schutzraum rundum mindestens ¼ der Bildmarkenhöhe; Mindestgröße der Bildmarke 16 px, des Verbunds 120 px Breite.
- Nicht verzerren, nicht drehen, keine Schatten oder Verläufe, Farben nicht tauschen, Wortmarke nicht in einer Schrift nachsetzen.
- Rechtlich: EasyKFZ24 ist eine Marke der MONVEX UG (haftungsbeschränkt) i. G. – das Logo steht nie allein für die Gesellschaft.
  Eine Anmeldung als Marke beim DPMA ist optional; vorher Recherche auf ähnliche Zeichen empfohlen.

## Erzeugen / ändern

```bash
python3 scripts/brand/logo.py
```

erzeugt die SVG-Dateien, `public/favicon.svg` und `src/components/logo-paths.generated.ts` (Wortmarke für die Website).
Die PNG-Exporte werden aus den SVG-Dateien gerendert (macOS: NSImage, transparenter Hintergrund).
