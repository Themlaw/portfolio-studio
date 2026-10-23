"use client";

/**
 * Curseurs dessinés (kit Photoshop, groupe « 9 · Curseur ») dans l'éditeur de
 * thème : aperçu sur les fonds du thème (taille réelle, 32 px), contrôle de
 * visibilité (src/themes/cursor.ts) et option pour revenir aux curseurs du
 * système sans perdre les dessins.
 */
/* eslint-disable @next/next/no-img-element -- PNG de 64 px servis par /media : next/image n'apporte rien. */
import { useEffect, useState } from "react";

import { cursorProblem } from "@/themes/cursor";
import { resolvePalette } from "@/themes/palette";
import type { KitAssets, KitCursor, Theme } from "@/themes/schema";

const NAMES = { default: "Normal", pointer: "Clic (survol de ce qui se clique)" } as const;

/** Pixels d'un PNG de même origine (canvas), ou null. */
function usePixels(url: string | undefined): Uint8ClampedArray | null {
  const [px, setPx] = useState<{ url: string; data: Uint8ClampedArray } | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d");
      if (!ctx || !alive) return;
      ctx.drawImage(img, 0, 0);
      setPx({ url, data: ctx.getImageData(0, 0, c.width, c.height).data });
    };
    img.src = url;
    return () => {
      alive = false;
    };
  }, [url]);
  return px && px.url === url ? px.data : null;
}

function CursorRow({ kind, cursor, grounds }: { kind: keyof typeof NAMES; cursor: KitCursor; grounds: { hex: string; label: string }[] }) {
  const pixels = usePixels(cursor.png2x);
  const problem = pixels ? cursorProblem(pixels, grounds) : null;
  return (
    <div className="a-cursor-row" data-cursor={kind}>
      <strong>{NAMES[kind]}</strong>
      <div className="a-cursor-grounds">
        {grounds.map((g) => (
          <span key={g.label} className="a-cursor-ground" style={{ background: g.hex }} title={g.label}>
            <img src={cursor.png2x} width={32} height={32} alt="" />
            <span className="a-cursor-hotspot" style={{ left: 8 + cursor.x, top: 8 + cursor.y }} aria-hidden="true" />
          </span>
        ))}
      </div>
      <span className="a-help">
        Point chaud : {cursor.x}, {cursor.y} px
      </span>
      {problem && (
        <p className="a-field-error" role="alert">
          ⚠ {problem}
        </p>
      )}
    </div>
  );
}

export default function CursorSettings({ theme, onChange }: { theme: Theme; onChange: (kit: KitAssets) => void }) {
  const kit = theme.assets.kit ?? {};
  const cursors = kit.cursors;
  const has = Boolean(cursors?.default || cursors?.pointer);
  const p = resolvePalette(theme.tokens.color, theme.tokens.palette);
  const grounds = [
    { hex: p.bg, label: "le fond" },
    { hex: p.bgDeep, label: "le fond profond" },
    { hex: p.surface, label: "la surface" },
  ];
  return (
    <section className="a-panel" aria-labelledby="t-curseurs">
      <h3 id="t-curseurs" className="a-subhead">
        Curseurs de la souris
      </h3>
      {!has ? (
        <p className="a-help">
          Les curseurs du système. Pour les dessiner : groupe « 9 · Curseur » du kit Photoshop (normal, et au survol de ce qui se clique).
        </p>
      ) : (
        <>
          <label className="a-guide-check">
            <input
              type="checkbox"
              checked={!cursors?.off}
              onChange={(e) => {
                const next = { ...cursors };
                if (e.target.checked) delete next.off;
                else next.off = true;
                onChange({ ...kit, cursors: next });
              }}
            />
            Utiliser les curseurs dessinés sur le site
          </label>
          <p className="a-help">
            Décoché : les curseurs du système, tes dessins restent gardés. Sur le site public seulement (pas dans l&apos;administration) ; les champs de texte
            gardent leur barre de saisie.
          </p>
          {cursors?.default && <CursorRow kind="default" cursor={cursors.default} grounds={grounds} />}
          {cursors?.pointer && <CursorRow kind="pointer" cursor={cursors.pointer} grounds={grounds} />}
        </>
      )}
    </section>
  );
}
