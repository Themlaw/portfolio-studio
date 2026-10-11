"""Calques SVG des heros de planche-de-story, fanzine-riso et studio (docs/THEMES.md).
Déterministe (graines fixes). Usage : python3 scripts/theme-hero-svg.py"""
import math, os, random

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "themes")
HEAD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" width="1600" height="900" preserveAspectRatio="xMidYMid slice">'

def f(x):
    return f"{x:.1f}".rstrip("0").rstrip(".")

def write(slug, name, body):
    d = os.path.join(OUT, slug, "hero")
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, name), "w") as fh:
        fh.write(HEAD + body + "</svg>\n")

def wobble(rng, pts, amp=1.6):
    """Polyligne « à main levée » : léger tremblé."""
    return " ".join(("M" if i == 0 else "L") + f"{f(x + rng.uniform(-amp, amp))} {f(y + rng.uniform(-amp, amp))}" for i, (x, y) in enumerate(pts))

# ----------------------------------------------------------------- storyboard
def storyboard():
    rng = random.Random(7)
    slug = "planche-de-story"
    # 1. Kraft : dégradé, fibres, quelques points.
    fibers = []
    for _ in range(220):
        x, y = rng.uniform(0, 1600), rng.uniform(0, 900)
        a = rng.uniform(0, math.pi)
        l = rng.uniform(6, 22)
        fibers.append(f"M{f(x)} {f(y)}l{f(math.cos(a) * l)} {f(math.sin(a) * l)}")
    specks = "".join(f'<circle cx="{f(rng.uniform(0,1600))}" cy="{f(rng.uniform(0,900))}" r="{f(rng.uniform(0.8,1.8))}"/>' for _ in range(90))
    write(slug, "layer-1-kraft.svg",
        '<defs><radialGradient id="k" cx="62%" cy="38%" r="80%"><stop offset="0" stop-color="#ecdfc6"/><stop offset="1" stop-color="#ddcaa6"/></radialGradient></defs>'
        '<rect width="1600" height="900" fill="url(#k)"/>'
        f'<path d="{"".join(fibers)}" stroke="#a88d63" stroke-opacity="0.22" stroke-width="1.1" fill="none" stroke-linecap="round"/>'
        f'<g fill="#7d6644" fill-opacity="0.18">{specks}</g>')

    # 2. Cases : une rangée en haut, puis une colonne à droite (en « L »).
    # Zones réservées au texte du hero, mesurées par check-hero-overlap à
    # 1280, 1440, 1920 et 390 px : en dessous de y ≈ 300 et à gauche de
    # x ≈ 1200 (toile 1600 × 900) ; seule la toile x 110–1490 est visible
    # sur ordinateur (cover d'un cadre agrandi de 8 %).
    w, h = 245, 138
    x0, y0 = 655, 100
    cells = [(655, 100, 1), (935, 100, 2), (1215, 100, 3), (1215, 335, 5), (1215, 570, 6)]
    parts = []
    for (x, y, n) in cells:
        parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="#f5eedf" stroke="#2a231b" stroke-width="3"/>')
        parts.append(f'<rect x="{x}" y="{y + h + 10}" width="30" height="20" fill="none" stroke="#5a4c3a" stroke-opacity="0.6" stroke-width="1.4"/>')
        parts.append(f'<path d="M{x + 40} {y + h + 30}H{x + w}M{x} {y + h + 52}H{x + w}" stroke="#8a7350" stroke-opacity="0.55" stroke-width="1.2"/>')
    write(slug, "layer-2-cases.svg", "".join(parts))

    # 3. Croquis : graphite + crayon bleu de construction, une composition par case.
    g, b = [], []
    def P(*pts, amp=1.4, blue=False):
        (b if blue else g).append(wobble(rng, pts, amp))
    def circ(cx, cy, r, blue=False, n=18):
        pts = [(cx + r * math.cos(t), cy + r * math.sin(t)) for t in [i * 2 * math.pi / n for i in range(n + 1)]]
        P(*pts, amp=1.0, blue=blue)
    def figure(cx, base, s):
        circ(cx, base - 7.2 * s, 1.1 * s)
        P((cx, base - 6.1 * s), (cx + 0.3 * s, base - 3 * s))
        P((cx + 0.3 * s, base - 3 * s), (cx - 1 * s, base))
        P((cx + 0.3 * s, base - 3 * s), (cx + 1.3 * s, base))
        P((cx - 1.5 * s, base - 5 * s), (cx, base - 5.6 * s), (cx + 1.6 * s, base - 4.4 * s))
    for (x, y, n) in cells:
        cx, cy = x + w / 2, y + h / 2
        if n == 1:  # plan d'ensemble
            P((x, y + 100), (x + w, y + 96), blue=True)
            P((x + 10, y + 100), (x + 70, y + 60), (x + 120, y + 92), (x + 170, y + 48), (x + 240, y + 98))
            figure(x + 200, y + 136, 3)
        elif n == 2:  # plan moyen
            P((x + 30, y + h), (cx, y + 70), (x + w - 30, y + h), blue=True)
            figure(cx, y + h - 6, 13)
        elif n == 3:  # gros plan
            circ(cx, cy + 6, 52, blue=True)
            P((cx - 52, cy + 6), (cx + 52, cy + 6), blue=True)
            circ(cx - 18, cy - 2, 8); circ(cx + 20, cy - 2, 8)
            P((cx - 14, cy + 30), (cx, cy + 36), (cx + 16, cy + 29))
            P((cx - 40, cy - 40), (cx - 10, cy - 58), (cx + 30, cy - 52), (cx + 50, cy - 30))
        elif n == 4:  # amorce épaule
            P((x, y + h), (x + 40, y + 60), (x + 110, y + 40), (x + 130, y + h))
            figure(x + 200, y + 130, 7)
            P((x + 150, y + h), (x + 200, y + 30), blue=True)
        elif n == 5:  # action
            figure(cx - 10, y + 128, 9)
            for k in range(4):
                P((x + 30, y + 50 + k * 18), (x + 90 - k * 8, y + 50 + k * 18))
        elif n == 6:  # décor
            P((x + 40, y + 120), (x + 40, y + 60), (x + 90, y + 30), (x + 140, y + 60), (x + 140, y + 120), (x + 40, y + 120))
            P((x + 180, y + 120), (x + 190, y + 50)); circ(x + 192, y + 46, 26)
            P((x, y + 120), (x + w, y + 120), blue=True)
            for k in range(5):
                P((x + w * 0.5, y + 10), (x + k * 70, y + h), blue=True)
        elif n == 7:
            figure(cx - 50, y + 130, 8); figure(cx + 50, y + 130, 8.5)
            P((cx - 40, y + 60), (cx + 40, y + 60), blue=True)
        elif n == 9:
            circ(cx, cy, 40)
            P((cx - 90, cy + 50), (cx + 90, cy + 50), blue=True)
            P((cx - 30, cy - 10), (cx + 30, cy - 10))
    write(slug, "layer-3-croquis.svg",
        f'<path d="{"".join(b)}" fill="none" stroke="#4f7bab" stroke-opacity="0.55" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
        f'<path d="{"".join(g)}" fill="none" stroke="#2a231b" stroke-opacity="0.7" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>')

    # 4. Caméra : crayon rouge (panoramique, recadrage, rotation, numéros cerclés).
    c = cells
    red = []
    (x1, y1, _), (x2, y2, _) = c[0], c[1]
    red.append(wobble(rng, [(x1 + 60, y1 - 16), (x2 + w - 60, y2 - 16)], 1.2))
    red.append(wobble(rng, [(x2 + w - 78, y2 - 26), (x2 + w - 60, y2 - 16), (x2 + w - 78, y2 - 6)], 0.8))
    x3, y3, _ = c[2]
    dash = f'<rect x="{x3 + 70}" y="{y3 + 34}" width="{w - 140}" height="{h - 68}" fill="none" stroke="#b33a26" stroke-width="2.4" stroke-dasharray="10 7"/>'
    for (sx, sy, dx, dy) in [(x3 + 18, y3 + 14, x3 + 66, y3 + 30), (x3 + w - 18, y3 + h - 14, x3 + w - 66, y3 + h - 30)]:
        red.append(wobble(rng, [(sx, sy), (dx, dy)], 0.8))
    x5, y5, _ = c[3]
    arc = [(x5 + w - 60 + 34 * math.cos(t), y5 + 50 + 22 * math.sin(t)) for t in [i * 0.3 for i in range(17)]]
    red.append(wobble(rng, arc, 0.8))
    rings = "".join(f'<circle cx="{x + 15}" cy="{y + h + 20}" r="15" fill="none" stroke="#b33a26" stroke-width="2"/>' for (x, y, n) in c if n in (1, 3, 5))
    ticks = "".join(f'<path d="M{x + 9} {y + h + 20}l4 5 9-11" fill="none" stroke="#b33a26" stroke-width="2.4" stroke-linecap="round"/>' for (x, y, n) in c if n in (1, 3, 5))
    write(slug, "layer-4-camera.svg",
        f'<g stroke-linecap="round" stroke-linejoin="round"><path d="{"".join(red)}" fill="none" stroke="#b33a26" stroke-width="3"/>{dash}{rings}{ticks}</g>')

    # 5. Premier plan : scotch et crayon bleu posé sur la planche.
    tapes = []
    for (tx, ty, rot) in [(x0 - 18, y0 - 14, -32), (1215 + w - 46, y0 - 12, 28), (1215 + w - 40, 570 + h - 10, -24)]:
        tapes.append(f'<g transform="translate({tx} {ty}) rotate({rot})"><rect width="92" height="30" fill="#f1e6c9" fill-opacity="0.82"/>'
                     f'<path d="M0 0v30M92 0v30" stroke="#a88d63" stroke-opacity="0.5" stroke-dasharray="3 3"/></g>')
    pencil = ('<g transform="translate(1180 842) rotate(-9)">'
              '<path d="M0 0h330v26H0z" fill="#2c5580"/><path d="M0 9h330" stroke="#24476c" stroke-width="4"/>'
              '<path d="M330 0l58 13-58 13z" fill="#e3c79c"/><path d="M372 9l16 4-16 4z" fill="#2a231b"/>'
              '<path d="M-26 0h26v26h-26z" fill="#c9b9a0"/><path d="M-34 1h8v24h-8z" fill="#c4645c"/></g>')
    shadow = '<path d="M1172 868l420-58" stroke="#2a231b" stroke-opacity="0.12" stroke-width="10" stroke-linecap="round"/>'
    write(slug, "layer-5-scotch.svg", shadow + "".join(tapes) + pencil)

# ------------------------------------------------------------------- fanzine
def fanzine():
    rng = random.Random(11)
    slug = "fanzine-riso"
    # 1. Papier + trame rose (motif de points, fondu depuis le coin haut droit).
    write(slug, "layer-1-papier.svg",
        '<defs><pattern id="d" width="18" height="18" patternUnits="userSpaceOnUse"><g fill="#ff5fa2"><circle cx="5" cy="5" r="5"/><circle cx="14" cy="14" r="5"/></g></pattern>'
        '<radialGradient id="f" cx="1360" cy="170" r="760" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset="0.55" stop-color="#fff" stop-opacity="0.45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>'
        '<mask id="m"><rect width="1600" height="900" fill="url(#f)"/></mask></defs>'
        '<rect width="1600" height="900" fill="#fbf2c9"/>'
        '<rect width="1600" height="900" fill="url(#d)" fill-opacity="0.5" mask="url(#m)"/>')

    # 2. Encre bleue : soleil, collines, personnage (silhouette chat).
    blue = ('<g fill="#0b5bc2" fill-opacity="0.88">'
            '<circle cx="1215" cy="265" r="170"/>'
            '<path d="M1120 900C1180 790 1260 740 1360 750S1520 700 1640 660V900z"/>'
            '<path transform="translate(70 -40)" d="M1270 420c-30-80-10-140 30-170l26 70c24-6 50-6 74 0l26-70c40 30 60 90 30 170 30 40 34 120-30 160-60 36-130 36-190 0-64-40-60-120-30-160z"/>'
            '</g>')
    write(slug, "layer-2-bleu.svg", blue)

    # 3. Encre rose, décalée (défaut de repérage) : anneau, éclair, joues, étoile.
    pink = ('<g fill="#ff5fa2" fill-opacity="0.85" transform="translate(14 -9)">'
            '<path d="M1215 75a190 190 0 1 1 0 380a190 190 0 1 1 0-380zm0 24a166 166 0 1 0 0 332a166 166 0 1 0 0-332z"/>'
                        '<path transform="translate(860 190) scale(0.68) translate(-880 -300)" d="M880 170l40 90 96 8-74 62 24 94-86-52-84 52 22-94-72-62 96-8z"/>'
            '<ellipse cx="1372" cy="480" rx="22" ry="12"/><ellipse cx="1508" cy="480" rx="22" ry="12"/>'
            '</g>')
    write(slug, "layer-3-rose.svg", pink)

    # 4. Trame bleu nuit en bande diagonale + repères de calage.
    marks = "".join(
        f'<g transform="translate({x} {y})" fill="none" stroke="#1d1b3d" stroke-width="2"><circle r="12"/><path d="M-20 0h40M0-20v40"/></g>'
        for (x, y) in [(1560, 40), (1560, 860)]
    )
    write(slug, "layer-4-trame.svg",
        '<defs><pattern id="t" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(15)"><circle cx="7" cy="7" r="3" fill="#1d1b3d"/></pattern>'
        '<linearGradient id="b" x1="1500" y1="0" x2="1000" y2="900" gradientUnits="userSpaceOnUse"><stop offset="0.25" stop-color="#fff" stop-opacity="0"/><stop offset="0.42" stop-color="#fff"/><stop offset="0.58" stop-color="#fff" stop-opacity="0"/></linearGradient>'
        '<mask id="mb"><rect width="1600" height="900" fill="url(#b)"/></mask></defs>'
        f'<rect x="640" width="960" height="900" fill="url(#t)" fill-opacity="0.7" mask="url(#mb)"/>{marks}')

    # 5. Gribouillis bleu nuit : étoiles, spirale, flèche, yeux du chat.
    paths = []
    def star(x, y, r):
        pts = []
        for i in range(11):
            a = -math.pi / 2 + i * math.pi / 5
            rr = r if i % 2 == 0 else r * 0.45
            pts.append((x + rr * math.cos(a), y + rr * math.sin(a)))
        paths.append(wobble(rng, pts, 1.6))
    star(1470, 120, 30); star(1050, 90, 18); star(1560, 300, 16)
    spiral = [(690 + (6 + t * 4.2) * math.cos(t), 120 + (6 + t * 4.2) * math.sin(t) - 20) for t in [i * 0.35 for i in range(40)]]
    paths.append(wobble(rng, spiral, 1.0))
    paths.append(wobble(rng, [(1420, 505), (1440, 516), (1460, 505)], 0.6))
    eyes = '<g fill="#1d1b3d"><ellipse cx="1400" cy="430" rx="11" ry="16"/><ellipse cx="1480" cy="430" rx="11" ry="16"/></g>'
    write(slug, "layer-5-gribouillis.svg",
        f'<path d="{"".join(paths)}" fill="none" stroke="#1d1b3d" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>{eyes}')

# -------------------------------------------------------------------- studio
def studio():
    """Planche-contact d'un studio : grille de 12 colonnes au filet, rangée de
    photogrammes en haut à droite, la prise retenue en cobalt, hirondelles."""
    slug = "studio"
    cols = "".join(f"M{f(40 + i * 1520 / 12)} 0V900" for i in range(13))
    write(slug, "layer-1-grille.svg",
        '<rect width="1600" height="900" fill="#fbfbfa"/>'
        f'<path d="{cols}M0 90H1600" stroke="#e7e7e3" stroke-width="1"/>')
    fw, fh, gap = 150, 84, 14
    x0, y0 = 760, 112
    frames = []
    for r in range(2):
        for c in range(4):
            x, y = x0 + c * (fw + gap), y0 + r * (fh + 34)
            frames.append(f'<rect x="{x}" y="{y}" width="{fw}" height="{fh}" fill="#ececea" stroke="#cfcfca"/>'
                          f'<rect x="{x}" y="{y + fh + 8}" width="{18 + 6 * (r * 4 + c)}" height="5" fill="#bdbdb7"/>')
    write(slug, "layer-2-planche.svg", "".join(frames))
    sx, sy = x0 + 2 * (fw + gap), y0 + (fh + 34)
    write(slug, "layer-3-prise.svg",
        f'<rect x="{sx}" y="{sy}" width="{fw}" height="{fh}" fill="#1f3fd1"/>'
        f'<rect x="{sx}" y="{sy + fh + 8}" width="54" height="5" fill="#1f3fd1"/>'
        f'<rect x="{x0 + 4 * (fw + gap) + 26}" y="{y0}" width="84" height="84" fill="#1f3fd1"/>')
    x1, y1 = x0 + 4 * (fw + gap) - gap, y0 + 2 * (fh + 34)
    marks = "".join(f"M{f(x + dx)} {f(y)}h{f(18 * sx_)}M{f(x)} {f(y + dy)}v{f(18 * sy_)}"
                    for (x, y, dx, dy, sx_, sy_) in [(x0 - 14, y0 - 14, -8, -8, -1, -1), (x1 + 14, y0 - 14, 8, -8, 1, -1), (x0 - 14, y1, -8, 8, -1, 1), (x1 + 14, y1, 8, 8, 1, 1)])
    write(slug, "layer-4-reperes.svg", f'<path d="{marks}" stroke="#141414" stroke-width="1.5" fill="none"/>')

storyboard()
fanzine()
studio()
for slug in ("planche-de-story", "fanzine-riso", "studio"):
    d = os.path.join(OUT, slug, "hero")
    print(slug, {n: os.path.getsize(os.path.join(d, n)) for n in sorted(os.listdir(d))})
