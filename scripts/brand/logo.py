#!/usr/bin/env python3
"""EasyKFZ24-Logo: Bildmarke „E-Pfeil“ + eigene geometrische Wortmarke (keine Fremdschrift).

Erzeugt die Logodateien in public/logo/, das Favicon und die Pfade für src/components/logo-paths.generated.ts.
Aufruf:  python3 scripts/brand/logo.py      (PNG-Exporte separat, siehe docs/LOGO.md)
"""
import json, math, os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BLUE, INK, ACCENT_DARK = '#2a55ff', '#0a1433', '#7f9bff'
W, GAP = 16, 11  # Strichstärke und Buchstabenabstand der Wortmarke (Versalhöhe 100)

def r2(x): return round(x, 2)

def s_path():
    r, c1, c2 = 21, (30, 29), (30, 71)
    a, b = math.radians(-35), math.radians(145)
    s = (c1[0] + r * math.cos(a), c1[1] + r * math.sin(a)); e = (c2[0] + r * math.cos(b), c2[1] + r * math.sin(b))
    return f"M{r2(s[0])},{r2(s[1])} A{r},{r} 0 1 0 30,50 A{r},{r} 0 1 1 {r2(e[0])},{r2(e[1])}"

def two_path():
    r, c = 21, (29, 29)
    a, b = math.radians(205), math.radians(36.8)  # Bogen endet am Tangentenpunkt zur Ecke unten links
    s = (c[0] + r * math.cos(a), c[1] + r * math.sin(a)); e = (c[0] + r * math.cos(b), c[1] + r * math.sin(b))
    return f"M{r2(s[0])},{r2(s[1])} A{r},{r} 0 1 1 {r2(e[0])},{r2(e[1])} L8,92 H55"

# Buchstaben als Mittellinien (Strich 16, oben/unten über die Versalhöhe hinaus und am Ende beschnitten)
GLYPHS = {
    'E': ([('M54,8 H8 V92 H54 M8,50 H47', 'butt')], 58),
    'A': ([('M6,108 L36,8 L66,108 M17,66 H55', 'butt')], 72),
    'S': ([(s_path(), 'butt')], 60),
    'Y': ([('M5,-6 L33,50 L61,-6 M33,50 V108', 'butt')], 66),
    'K': ([('M8,-6 V108 M57,-6 L8,67.5', 'butt'), ('M26.33,40 L61,108', 'round')], 64),
    'F': ([('M8,108 V8 H52 M8,50 H45', 'butt')], 54),
    'Z': ([('M4,8 H54 L7,92 H57', 'butt')], 60),
    '2': ([(two_path(), 'butt')], 60),
    '4': ([('M44,108 V8 L7,67 H61', 'butt')], 62),
}

def wordmark(c_easy, c_kfz):
    parts, x = [], 0
    for txt, col in (('EASY', c_easy), ('KFZ24', c_kfz)):
        for ch in txt:
            segs, adv = GLYPHS[ch]
            for d, cap in segs:
                parts.append({'d': d, 'x': x, 'cap': cap, 'part': 'easy' if txt == 'EASY' else 'kfz', 'color': col})
            x += adv + GAP
        x += 6
    return parts, x - GAP - 6

def svg_paths(parts):
    return ''.join(f'<path d="{p["d"]}" transform="translate({p["x"]},0)" stroke="{p["color"]}" stroke-linecap="{p["cap"]}"/>' for p in parts)

def glyph(fg='#fff'):
    # E, dessen Mittelbalken als Pfeil nach vorn läuft; Balken enden vor der Pfeilspitze; optisch zentriert
    return (f'<g transform="translate(-3,0)" fill="none" stroke="{fg}" stroke-width="10" stroke-linejoin="round">'
            '<path d="M58,27 H28 V73 H58" stroke-linecap="butt"/><path d="M28,50 H76" stroke-linecap="butt"/>'
            '<path d="M67,40.5 L77,50 L67,59.5" stroke-linecap="round"/></g>')

def mark(bg=BLUE, fg='#fff', full=False):
    rx = '' if full else ' rx="24"'
    return f'<rect width="100" height="100"{rx} fill="{bg}"/>' + glyph(fg)

def lockup(c_easy, c_kfz, mark_bg=BLUE, mark_fg='#fff'):
    parts, ww = wordmark(c_easy, c_kfz)
    s, gap = 0.6, 30
    total = r2(100 + gap + ww * s)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total} 100" role="img" aria-label="EasyKFZ24"><title>EasyKFZ24</title>'
            f'{mark(mark_bg, mark_fg)}<g transform="translate({100 + gap},20) scale({s})"><clipPath id="wm"><rect x="-20" y="0" width="{ww + 40}" height="100"/></clipPath>'
            f'<g clip-path="url(#wm)" fill="none" stroke-width="{W}" stroke-linejoin="round">{svg_paths(parts)}</g></g></svg>')

def mark_svg(bg=BLUE, fg='#fff', full=False):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="EasyKFZ24"><title>EasyKFZ24</title>{mark(bg, fg, full)}</svg>'

if __name__ == '__main__':
    out = os.path.join(ROOT, 'public', 'logo'); os.makedirs(out, exist_ok=True)
    files = {
        'easykfz24-logo.svg': lockup(INK, BLUE),
        'easykfz24-logo-negativ.svg': lockup('#ffffff', ACCENT_DARK),
        'easykfz24-logo-schwarz.svg': lockup('#000000', '#000000', '#000000', '#ffffff'),
        'easykfz24-logo-weiss.svg': lockup('#ffffff', '#ffffff', '#ffffff', '#000000'),
        'easykfz24-bildmarke.svg': mark_svg(),
        'easykfz24-bildmarke-vollflaeche.svg': mark_svg(full=True),
    }
    for name, svg in files.items():
        open(os.path.join(out, name), 'w').write(svg)
    open(os.path.join(ROOT, 'public', 'favicon.svg'), 'w').write(mark_svg())
    parts, ww = wordmark('', '')
    ts = ['// Erzeugt von scripts/brand/logo.py – nicht von Hand ändern.', '',
          f'export const WORDMARK_WIDTH = {ww};', f'export const WORDMARK_STROKE = {W};',
          'export const WORDMARK_PATHS: { d: string; x: number; cap: "butt" | "round"; part: "easy" | "kfz" }[] = ' +
          json.dumps([{k: p[k] for k in ('d', 'x', 'cap', 'part')} for p in parts]) + ';', '']
    open(os.path.join(ROOT, 'src', 'components', 'logo-paths.generated.ts'), 'w').write('\n'.join(ts))
    print('Logo-Dateien erzeugt:', sorted(files), '+ favicon.svg + logo-paths.generated.ts')
