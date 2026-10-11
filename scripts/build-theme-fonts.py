#!/usr/bin/env python3
"""
Polices des thèmes en fichiers du dépôt (src/themes/fonts/*.woff2), servies par
next/font/local : aucun accès réseau au build (next/font/google cassait le build
quand Google change les adresses de ses fichiers).

Source : dépôt google/fonts (OFL), TTF d'origine. Pour chaque police : axes
variables autres que wght figés à leur valeur par défaut, wght réduit aux
graisses utilisées, sous-ensemble latin + latin-ext (mêmes plages que Google
Fonts), woff2. À relancer seulement pour ajouter une police (fontTools + brotli,
réseau) : python3 scripts/build-theme-fonts.py <dossier de sortie>
"""
import io, os, sys, urllib.request
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

OUT = sys.argv[1] if len(sys.argv) > 1 else "src/themes/fonts"
RAW = "https://raw.githubusercontent.com/google/fonts/main/ofl/"
# Plages unicode latin + latin-ext de Google Fonts.
UNICODES = (
    "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD,"
    "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF"
)
# (fichier de sortie, dossier, TTF, graisses : (min, max) pour une variable, None pour une statique)
FONTS = [
    ("young-serif-400", "youngserif", "YoungSerif-Regular.ttf", None),
    ("figtree-var", "figtree", "Figtree[wght].ttf", (300, 900)),
    ("spline-sans-mono-var", "splinesansmono", "SplineSansMono[wght].ttf", (300, 700)),
    ("bricolage-grotesque-var", "bricolagegrotesque", "BricolageGrotesque[opsz,wdth,wght].ttf", (400, 700)),
    ("chelsea-market-400", "chelseamarket", "ChelseaMarket-Regular.ttf", None),
    ("caveat-var", "caveat", "Caveat[wght].ttf", (400, 700)),
    ("kalam-400", "kalam", "Kalam-Regular.ttf", None),
    ("kalam-700", "kalam", "Kalam-Bold.ttf", None),
    ("courier-prime-400", "courierprime", "CourierPrime-Regular.ttf", None),
    ("courier-prime-700", "courierprime", "CourierPrime-Bold.ttf", None),
    ("big-shoulders-var", "bigshoulders", "BigShoulders[opsz,wght].ttf", (600, 800)),
    ("ibm-plex-sans-var", "ibmplexsans", "IBMPlexSans[wdth,wght].ttf", (400, 600)),
    ("ibm-plex-mono-400", "ibmplexmono", "IBMPlexMono-Regular.ttf", None),
    ("ibm-plex-mono-500", "ibmplexmono", "IBMPlexMono-Medium.ttf", None),
    ("inter-tight-var", "intertight", "InterTight[wght].ttf", (400, 600)),
    ("bowlby-one-400", "bowlbyone", "BowlbyOne-Regular.ttf", None),
    ("space-grotesk-var", "spacegrotesk", "SpaceGrotesk[wght].ttf", (400, 600)),
]

os.makedirs(OUT, exist_ok=True)
for name, folder, ttf, wght in FONTS:
    data = urllib.request.urlopen(RAW + folder + "/" + urllib.request.quote(ttf)).read()
    font = TTFont(io.BytesIO(data), lazy=False)
    if "fvar" in font:
        limits = {}
        for axis in font["fvar"].axes:
            limits[axis.axisTag] = (max(axis.minValue, wght[0]), min(axis.maxValue, wght[1])) if axis.axisTag == "wght" else axis.defaultValue
        font = instancer.instantiateVariableFont(font, limits)
        # Relecture complète (tables paresseuses) avant le sous-ensemble.
        buf = io.BytesIO()
        font.save(buf)
        font = TTFont(io.BytesIO(buf.getvalue()))
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=subset.parse_unicodes(UNICODES))
    sub.subset(font)
    path = os.path.join(OUT, name + ".woff2")
    font.flavor = "woff2"
    font.save(path)
    print(f"{name}.woff2 {os.path.getsize(path) // 1024} Ko")
