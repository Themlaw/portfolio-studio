#!/usr/bin/env python3
"""Pilote HTTP de la mesure mémoire (scripts/mem-scenario.sh) : session admin, export du kit, envois.
Usage : memdrive.py BASE EMAIL PASSWORD ACTION [fichier]
  prepare KIT.zip   exporte le kit du thème galerie-lumineuse et l'écrit dans KIT.zip
  image JPEG        envoie l'image (multipart) -> job « image »
  import KIT.zip    envoie l'archive (morceaux) -> job « kit-import » ; affiche l'id d'import
  wait ID           attend la fin de l'import (done / failed)
"""
import json, sys, time, urllib.request, uuid

base, email, password, action = sys.argv[1:5]
arg = sys.argv[5] if len(sys.argv) > 5 else None
# Cookie de session posé à la main : en production le cookie est « Secure », un client qui respecte le drapeau ne le renverrait pas en http://localhost.
op = urllib.request.build_opener()
COOKIE = {"v": ""}

def call(method, path, data=None, headers=None, timeout=600):
    h = {"origin": base, **(headers or {})}
    if COOKIE["v"]:
        h["cookie"] = COOKIE["v"]
    req = urllib.request.Request(base + path, data=data, method=method, headers=h)
    try:
        with op.open(req, timeout=timeout) as r:
            return r.status, r.read(), r.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers

s, b, hd = call("POST", "/api/auth/sign-in/email", json.dumps({"email": email, "password": password}).encode(), {"content-type": "application/json"})
if s != 200:
    sys.exit(f"connexion refusée ({s}) {b[:200]!r}")
COOKIE["v"] = "; ".join(c.split(";")[0] for c in hd.get_all("Set-Cookie") or [])
THEME = "galerie-lumineuse"

if action == "prepare":
    for _ in range(150):
        s, b, _ = call("POST", f"/admin/api/theme-kit/{THEME}")
        if s == 200 and json.loads(b).get("ready"):
            break
        time.sleep(2)
    s, b, h = call("GET", f"/admin/api/theme-kit/{THEME}")
    open(arg, "wb").write(b)
    print(f"kit exporté : {len(b)} octets (HTTP {s})")
elif action == "image":
    boundary = uuid.uuid4().hex
    data = open(arg, "rb").read()
    ext, ctype = ("png", "image/png") if arg.endswith(".png") else ("jpg", "image/jpeg")
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"grande-image.{ext}\"\r\nContent-Type: {ctype}\r\n\r\n").encode() + data + f"\r\n--{boundary}--\r\n".encode()
    s, b, _ = call("POST", "/admin/api/upload", body, {"content-type": f"multipart/form-data; boundary={boundary}"})
    print(f"image envoyée : HTTP {s} {b[:200]!r}")
elif action == "import":
    data = open(arg, "rb").read()
    s, b, _ = call("POST", "/admin/api/upload/init", json.dumps({"name": "kit.zip", "size": len(data), "type": "application/zip", "purpose": {"kind": "kit", "themeId": THEME}}).encode(), {"content-type": "application/json"})
    if s != 200:
        sys.exit(f"init refusé {s} {b[:200]!r}")
    uid = json.loads(b)["upload"]["id"]
    off = 0
    while off < len(data):
        part = data[off:off + 8 * 1024 * 1024]
        s, b, _ = call("PUT", f"/admin/api/upload/{uid}/chunk?offset={off}", part, {"content-length": str(len(part))})
        if s != 200:
            sys.exit(f"morceau refusé {s} {b[:200]!r}")
        off = json.loads(b)["upload"]["offset"]
    s, b, _ = call("POST", f"/admin/api/upload/{uid}/complete")
    print(f"import demandé : HTTP {s} id={json.loads(b).get('kitImport', {}).get('id')}")
elif action == "wait":
    end = time.time() + 900
    st = {}
    while time.time() < end:
        s, b, _ = call("GET", f"/admin/api/theme-kit/{THEME}/import/{arg}")
        st = json.loads(b) if s == 200 else {}
        if st.get("status") in ("done", "failed"):
            break
        time.sleep(1)
    print(f"import {arg} : {st.get('status')}")
