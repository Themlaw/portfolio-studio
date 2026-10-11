"use client";

/**
 * Sélecteur de couleur libre d'un texte (lot 7) : dernière pastille des couleurs
 * du texte (dégradé conique), qui ouvre une fenêtre avec zone saturation /
 * luminosité à glisser, curseurs de teinte, de luminosité et d'opacité, saisie
 * HEX / RGB / HSL, aperçu sur le fond du thème avec avertissement de contraste
 * (jamais bloquant), couleurs du thème et couleurs récentes.
 *
 * Écrit à la main (module pur src/lib/color.ts) : aucune dépendance de plus,
 * et pas de feuille injectée à l'exécution (la toile est une iframe sous CSP).
 * Clavier : flèches sur la zone (Maj = pas de 10), curseurs natifs, champs.
 * Fermeture : `useDismiss` (clic extérieur, Échap, focus dans l'autre cadre).
 *
 * La valeur émise est `#rrggbb[aa]` (format canonique de src/lib/color.ts) ou
 * une clé de la palette du thème ; la validation reste celle du schéma zod.
 * Les couleurs affichées ici sont des données calculées (jamais écrites en dur).
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { hslToHsv, hsvToHsl, hsvToRgb, isCustomColor, over, parseColor, rgbaToHex, rgbToHsv, wheelGradient, type Hsva } from "@/lib/color";
import { PALETTE, PALETTE_LABELS, type PaletteColor } from "@/lib/look";
import { AA, ratio } from "@/themes/contrast";

import { useDismiss } from "./useDismiss";

const RECENT_KEY = "pf.recentColors";
const RECENT_MAX = 8;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const hexOf = (h: Hsva) => rgbaToHex(hsvToRgb(h));
const solid = (h: number, s: number, v: number, a = 1) => rgbaToHex(hsvToRgb({ h, s, v, a }));

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter(isCustomColor).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}
function pushRecent(hex: string): string[] {
  const next = [hex, ...readRecent().filter((c) => c !== hex)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* stockage indisponible : les récents ne durent que la session */
  }
  return next;
}

/** Couleur CSS (variable du thème comprise) → valeur calculée dans le document de la toile. */
function resolveCss(css: string, doc: Document) {
  const probe = doc.createElement("span");
  probe.style.color = css;
  doc.body.appendChild(probe);
  const out = parseColor(doc.defaultView?.getComputedStyle(probe).color ?? "");
  probe.remove();
  return out;
}

const isPalette = (v: string | undefined): v is PaletteColor => (PALETTE as readonly string[]).includes(v ?? "");
const checker = "repeating-conic-gradient(var(--lk-line) 0 25%, transparent 0 50%) 0 0 / 10px 10px";

export type ColorPickerProps = {
  /** Couleur du style : clé de palette, couleur libre, ou rien. */
  value: string | undefined;
  onChange: (color: string | undefined) => void;
  /** Couleur CSS d'une teinte de la palette (toile : var(--t-color-…) ; panneau : valeur du thème). */
  swatch: (c: PaletteColor) => string;
};

export default function ColorPicker({ value, onChange, swatch }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const custom = isCustomColor(value) ? value : undefined;
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const id = useId();

  // Clic extérieur, Échap, focus dans l'autre cadre : le hook commun. Le bouton (aria-expanded) bascule lui-même ;
  // un curseur glissé hors de la fenêtre garde sa capture de pointeur : aucun pointerdown extérieur.
  useDismiss(pop, () => setOpen(false), { enabled: open });

  return (
    <>
      <button
        ref={trigger}
        type="button"
        data-checked={custom !== undefined || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label="Couleur personnalisée"
        title="Couleur personnalisée"
        className="tc-swatch tc-wheel"
        style={{ backgroundImage: wheelGradient() }}
        onClick={() => setOpen((o) => !o)}
      >
        {custom && <span className="tc-wheel-dot" style={{ background: custom }} />}
      </button>
      {open && (
        <Popover
          id={id}
          ref={pop}
          value={value}
          swatch={swatch}
          onChange={onChange}
          onClose={() => {
            setOpen(false);
            trigger.current?.focus();
          }}
        />
      )}
    </>
  );
}

/**
 * Émission regroupée vers le style : glisser produit des dizaines d'événements,
 * on n'en envoie qu'un toutes les 140 ms et au relâchement. Les couleurs ne
 * vont dans les « récentes » qu'à la validation (relâchement, champ, fermeture).
 */
function useEmitter(onChange: (c: string | undefined) => void, onRecent: (recent: string[]) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<string | null>(null);
  const unrecorded = useRef<string | null>(null);
  const target = useRef({ onChange, onRecent });
  useEffect(() => {
    target.current = { onChange, onRecent };
  });
  const flush = useCallback((record = false) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (latest.current) {
      target.current.onChange(latest.current);
      latest.current = null;
    }
    if (record && unrecorded.current) {
      const recent = pushRecent(unrecorded.current);
      unrecorded.current = null;
      target.current.onRecent(recent);
    }
  }, []);
  const schedule = useCallback(
    (hex: string, now: boolean) => {
      latest.current = unrecorded.current = hex;
      if (timer.current) clearTimeout(timer.current);
      if (now) flush(true);
      else timer.current = setTimeout(() => flush(), 140);
    },
    [flush],
  );
  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = latest.current = unrecorded.current = null;
  }, []);
  // Fermeture : ce qui attend encore est émis.
  useEffect(
    () => () => {
      target.current.onRecent = () => {};
      flush(true);
    },
    [flush],
  );
  return { schedule, flush, cancel };
}

function Popover({
  id,
  ref,
  value,
  swatch,
  onChange,
  onClose,
}: ColorPickerProps & { id: string; ref: React.Ref<HTMLDivElement>; onClose: () => void }) {
  const box = useRef<HTMLDivElement | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ hsva: Hsva; bg: string | null; theme: string[]; recent: string[] } | null>(null);
  const [edit, setEdit] = useState<{ k: string; v: string } | null>(null);

  // Lecture du thème dans le document de la toile, une fois ouvert.
  useLayoutEffect(() => {
    const doc = box.current?.ownerDocument ?? document;
    const start = isCustomColor(value) ? parseColor(value) : resolveCss(swatch(isPalette(value) ? value : "ink"), doc);
    const bg = resolveCss(swatch("bg"), doc);
    setState({
      hsva: rgbToHsv(start ?? { r: 0, g: 0, b: 0, a: 1 }),
      bg: bg ? rgbaToHex({ ...bg, a: 1 }) : null,
      theme: PALETTE.map((c) => {
        const rgba = resolveCss(swatch(c), doc);
        return rgba ? rgbaToHex(rgba) : "";
      }),
      recent: readRecent(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ready = state !== null;

  // Décalage si la fenêtre dépasse de l'écran (écran étroit, barre près du bord).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !ready) return;
    const view = el.ownerDocument.documentElement.clientWidth;
    el.style.translate = "0 0";
    const r = el.getBoundingClientRect();
    const shift = Math.min(0, view - 8 - r.right) + Math.max(0, 8 - (r.left + Math.min(0, view - 8 - r.right)));
    if (shift) el.style.translate = `${shift}px 0`;
    // Sous la barre, la fenêtre sort vite de l'écran : on fait défiler la toile pour la montrer en entier.
    el.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [ready]);

  useEffect(() => {
    if (ready) area.current?.focus({ preventScroll: true });
  }, [ready]);

  const { schedule, flush, cancel } = useEmitter(onChange, (recent) => setState((s) => (s ? { ...s, recent } : s)));

  if (!state) return <div className="cp" ref={(el) => void (box.current = el)} />;
  const { hsva, bg } = state;
  const rgba = hsvToRgb(hsva);
  const hex = rgbaToHex(rgba);
  const hsl = hsvToHsl(hsva);

  /** Applique une couleur ; l'émission vers le style est regroupée (glisser = beaucoup d'événements). */
  const apply = (next: Hsva, now = false) => {
    setState((s) => (s ? { ...s, hsva: next } : s));
    schedule(hexOf(next), now);
  };

  const fromArea = (clientX: number, clientY: number, now: boolean) => {
    const r = area.current!.getBoundingClientRect();
    apply({ ...hsva, s: clamp((clientX - r.left) / r.width, 0, 1), v: 1 - clamp((clientY - r.top) / r.height, 0, 1) }, now);
  };

  const field = (k: string, derived: string) => (edit?.k === k ? edit.v : derived);
  const fieldProps = (k: string, derived: string, onValue: (text: string) => void) => ({
    value: field(k, derived),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setEdit({ k, v: e.target.value });
      onValue(e.target.value);
    },
    onBlur: () => {
      setEdit(null);
      flush(true);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        setEdit(null);
        flush(true);
      }
    },
  });
  const rgbField = (k: "r" | "g" | "b", label: string) => (
    <input
      key={k}
      inputMode="numeric"
      aria-label={label}
      {...fieldProps(`rgb-${k}`, String(rgba[k]), (t) => {
        if (!/^\d{1,3}$/.test(t)) return;
        apply(rgbToHsv({ ...rgba, [k]: clamp(Number(t), 0, 255) }, hsva.h));
      })}
    />
  );
  const hslField = (k: "h" | "s" | "l", label: string) => (
    <input
      key={k}
      inputMode="numeric"
      aria-label={label}
      {...fieldProps(`hsl-${k}`, String(Math.round(k === "h" ? hsl.h : hsl[k] * 100)), (t) => {
        if (!/^\d{1,3}$/.test(t)) return;
        const n = Number(t);
        apply(hslToHsv({ ...hsl, [k]: k === "h" ? clamp(n, 0, 360) : clamp(n, 0, 100) / 100 }));
      })}
    />
  );

  const contrast = bg ? ratio(rgbaToHex(over(rgba, parseColor(bg)!)), bg) : null;
  const low = contrast !== null && contrast < AA;
  const pct = (n: number) => String(Math.round(n * 100));

  return (
    <div
      id={id}
      ref={(el) => {
        box.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) (ref as React.RefObject<HTMLDivElement | null>).current = el;
      }}
      className="cp"
      role="dialog"
      aria-label="Couleur personnalisée"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          flush(true);
          onClose();
        }
      }}
    >
      <div
        ref={area}
        className="cp-area"
        role="slider"
        tabIndex={0}
        aria-label="Saturation et luminosité : flèches gauche et droite pour la saturation, haut et bas pour la luminosité"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsva.s * 100)}
        aria-valuetext={`Saturation ${pct(hsva.s)} %, valeur ${pct(hsva.v)} %`}
        style={{ backgroundImage: `linear-gradient(to top, ${solid(0, 0, 0)}, ${solid(0, 0, 0, 0)}), linear-gradient(to right, ${solid(0, 0, 1)}, ${solid(hsva.h, 1, 1)})` }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          fromArea(e.clientX, e.clientY, false);
        }}
        onPointerMove={(e) => e.buttons && e.currentTarget.hasPointerCapture(e.pointerId) && fromArea(e.clientX, e.clientY, false)}
        onPointerUp={(e) => fromArea(e.clientX, e.clientY, true)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.01;
          const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
          if (!d[e.key]) return;
          e.preventDefault();
          apply({ ...hsva, s: clamp(hsva.s + d[e.key][0], 0, 1), v: clamp(hsva.v + d[e.key][1], 0, 1) });
        }}
      >
        <span className="cp-knob" style={{ left: `${hsva.s * 100}%`, top: `${(1 - hsva.v) * 100}%`, background: hex }} />
      </div>

      <label className="cp-slider">
        <span>Teinte</span>
        <input
          type="range"
          min={0}
          max={360}
          value={Math.round(hsva.h)}
          style={{ backgroundImage: `linear-gradient(to right, ${Array.from({ length: 7 }, (_, i) => solid(i * 60, 1, 1)).join(", ")})` }}
          onChange={(e) => apply({ ...hsva, h: Number(e.target.value) })}
        />
      </label>
      <label className="cp-slider">
        <span>Luminosité</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(hsl.l * 100)}
          style={{ backgroundImage: `linear-gradient(to right, ${[0, 0.5, 1].map((l) => rgbaToHex(hsvToRgb(hslToHsv({ ...hsl, l, a: 1 })))).join(", ")})` }}
          onChange={(e) => apply(hslToHsv({ ...hsl, l: Number(e.target.value) / 100 }))}
        />
      </label>
      <label className="cp-slider">
        <span>Opacité</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(hsva.a * 100)}
          style={{ backgroundImage: `linear-gradient(to right, ${solid(hsva.h, hsva.s, hsva.v, 0)}, ${solid(hsva.h, hsva.s, hsva.v)}), ${checker}` }}
          onChange={(e) => apply({ ...hsva, a: Number(e.target.value) / 100 })}
        />
      </label>

      <div className="cp-fields">
        <span className="cp-flabel">HEX</span>
        <input
          className="cp-hex"
          spellCheck={false}
          maxLength={9}
          aria-label="Valeur hexadécimale"
          {...fieldProps("hex", hex, (t) => {
            const c = parseColor(t);
            if (c && /^#?[0-9a-f]{3,8}$/i.test(t.trim())) apply(rgbToHsv(c, hsva.h));
          })}
        />
        <span className="cp-flabel">RGB</span>
        <span className="cp-triple">{[rgbField("r", "Rouge"), rgbField("g", "Vert"), rgbField("b", "Bleu")]}</span>
        <span className="cp-flabel">HSL</span>
        <span className="cp-triple">{[hslField("h", "Teinte (degrés)"), hslField("s", "Saturation (pour cent)"), hslField("l", "Luminosité (pour cent)")]}</span>
      </div>

      <div className="cp-preview" style={bg ? { background: bg } : undefined}>
        <span className="cp-sample" style={{ color: hex }}>
          Aa Exemple de texte
        </span>
      </div>
      <p className="cp-contrast" role="status" data-low={low || undefined}>
        {contrast === null ? "Contraste non mesurable ici." : low ? `Contraste avec le fond du thème : ${contrast.toFixed(1).replace(".", ",")}:1, insuffisant (AA : 4,5:1).` : `Contraste avec le fond du thème : ${contrast.toFixed(1).replace(".", ",")}:1, suffisant.`}
      </p>

      <div className="cp-chips" role="group" aria-label="Couleurs du thème">
        <span className="cp-flabel">Thème</span>
        {PALETTE.map((c, i) => (
          <button
            key={c}
            type="button"
            className="cp-chip"
            style={{ background: swatch(c) }}
            title={PALETTE_LABELS[c]}
            aria-label={PALETTE_LABELS[c]}
            onClick={() => {
              const rgbaT = state.theme[i] ? parseColor(state.theme[i]) : null;
              if (rgbaT) setState({ ...state, hsva: rgbToHsv(rgbaT, hsva.h) });
              cancel();
              onChange(c);
            }}
          />
        ))}
      </div>
      {state.recent.length > 0 && (
        <div className="cp-chips" role="group" aria-label="Couleurs récentes">
          <span className="cp-flabel">Récentes</span>
          {state.recent.map((c) => (
            <button key={c} type="button" className="cp-chip" style={{ background: c }} title={c} aria-label={`Couleur récente ${c}`} onClick={() => apply(rgbToHsv(parseColor(c)!, hsva.h), true)} />
          ))}
        </div>
      )}
      <div className="cp-foot">
        <button
          type="button"
          onClick={() => {
            cancel();
            onChange(undefined);
            onClose();
          }}
        >
          Retirer la couleur
        </button>
        <button
          type="button"
          onClick={() => {
            flush(true);
            onClose();
          }}
        >
          Fermer
        </button>
      </div>
    </div>
  );
}
