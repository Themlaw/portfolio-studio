"use client";

/**
 * Sélecteur de couleur libre d'un texte (lot 7) : dernière pastille des couleurs
 * du texte (dégradé conique), qui ouvre une fenêtre avec une roue chromatique
 * (teinte = angle, saturation = rayon), un curseur de luminosité, un curseur
 * d'opacité, saisie HEX / RGB / HSL, aperçu sur le fond du thème avec
 * avertissement de contraste (jamais bloquant) et couleurs récentes. Pas de seconde rangée « couleurs du thème » (lot 26) :
 * les pastilles nommées du site sont déjà à côté (barre du texte, choix de carte ou de fond), la roue ne les redouble pas.
 *
 * Roue, luminosité et opacité : @uiw/react-color-wheel / -shade-slider / -alpha
 * (styles en ligne uniquement : aucune feuille injectée, la toile reste sous CSP ;
 * les couleurs qu'ils dessinent sont des données). Conversions : src/lib/color.ts.
 * Clavier : flèches sur la roue (gauche / droite = teinte, haut / bas = saturation,
 * Maj = pas de 10), flèches sur les curseurs (natif @uiw), champs.
 * Fermeture : `useDismiss` (clic extérieur, Échap, focus dans l'autre cadre).
 *
 * La valeur émise est `#rrggbb[aa]` (format canonique de src/lib/color.ts) ou
 * une clé de la palette du thème ; la validation reste celle du schéma zod.
 * Les couleurs affichées ici sont des données calculées (jamais écrites en dur).
 */
import Alpha from "@uiw/react-color-alpha";
import ShadeSlider from "@uiw/react-color-shade-slider";
import Wheel from "@uiw/react-color-wheel";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { hslToHsv, hsvToHsl, hsvToRgb, isCustomColor, over, parseColor, rgbaToHex, rgbToHsv, wheelGradient, type Hsva } from "@/lib/color";
import { PALETTE, type PaletteColor } from "@/lib/look";
import { AA, ratio } from "@/themes/contrast";

import { useDismiss } from "./useDismiss";

const RECENT_KEY = "pf.recentColors";
const RECENT_MAX = 8;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const hexOf = (h: Hsva) => rgbaToHex(hsvToRgb(h));

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
const WHEEL = 168; // px : la bibliothèque calcule la position du doigt dans une roue de cette largeur
/** Variables du curseur d'opacité de @uiw : fond du damier et pastille sur les tokens de l'interface. */
const alphaVars = { "--alpha-background-color": "var(--lk-surface)", "--alpha-pointer-background-color": "var(--lk-surface)", "--alpha-pointer-box-shadow": "0 0 0 1.5px var(--lk-ink)", borderRadius: 7, border: "1px solid var(--lk-line)" } as React.CSSProperties;

export type ColorPickerProps = {
  /** Couleur du style : clé de palette, couleur libre, ou rien. */
  value: string | undefined;
  onChange: (color: string | undefined) => void;
  /** Couleur CSS d'une teinte de la palette (toile : var(--t-color-…) ; panneau : valeur du thème). */
  swatch: (c: PaletteColor) => string;
};

/**
 * Variante « couleur de base du site » (lot 17f, panneau « Couleurs ») : roue, luminosité, HEX / RVB / TSL,
 * sans opacité ni couleurs du thème (c'est le thème qu'on règle), avec « Revenir au thème » ; le contrôle de
 * contraste est celui du panneau (il connaît tous les couples), pas l'aperçu sur le fond.
 */
export type SolidOptions = { onReset?: () => void; resetLabel?: string };

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
 * `live` (lot 19b, couleurs du thème) : chaque changement est émis aussitôt, sans attendre ces 140 ms, pour que
 * l'aperçu suive la main ; le gestionnaire reste léger (aperçu en direct, pas d'écriture).
 */
function useEmitter(onChange: (c: string | undefined) => void, onRecent: (recent: string[]) => void, live = false) {
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
      else if (live) flush();
      else timer.current = setTimeout(() => flush(), 140);
    },
    [flush, live],
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
  solid,
  live,
}: ColorPickerProps & { id: string; ref: React.Ref<HTMLDivElement>; onClose: () => void; solid?: SolidOptions; live?: boolean }) {
  const box = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<{ hsva: Hsva; bg: string | null; recent: string[] } | null>(null);
  const [edit, setEdit] = useState<{ k: string; v: string } | null>(null);

  // Lecture du thème dans le document de la toile, une fois ouvert.
  useLayoutEffect(() => {
    const doc = box.current?.ownerDocument ?? document;
    const start = isCustomColor(value) ? parseColor(value) : resolveCss(swatch(isPalette(value) ? value : "ink"), doc);
    const bg = resolveCss(swatch("bg"), doc);
    setState({
      hsva: rgbToHsv(start ?? { r: 0, g: 0, b: 0, a: 1 }),
      bg: bg ? rgbaToHex({ ...bg, a: 1 }) : null,
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

  const { schedule, flush, cancel } = useEmitter(onChange, (recent) => setState((s) => (s ? { ...s, recent } : s)), live);

  // Relâchement d'un glisser (la bibliothèque n'a pas de rappel de fin) : émission immédiate + récentes.
  useEffect(() => {
    const doc = box.current?.ownerDocument;
    if (!ready || !doc) return;
    const end = () => flush(true);
    doc.addEventListener("pointerup", end);
    return () => doc.removeEventListener("pointerup", end);
  }, [ready, flush]);

  // Focus sur la roue à l'ouverture.
  useEffect(() => {
    if (ready) box.current?.querySelector<HTMLElement>(".cp-wheel")?.focus({ preventScroll: true });
  }, [ready]);

  if (!state) return <div className="cp" ref={(el) => void (box.current = el)} />;
  const { hsva, bg } = state;
  const rgba = hsvToRgb(hsva);
  const hex = rgbaToHex(rgba);
  const hsl = hsvToHsl(hsva);

  /** Applique une couleur ; l'émission vers le style est regroupée (glisser = beaucoup d'événements). */
  const apply = (input: Hsva, now = false) => {
    const next = solid ? { ...input, a: 1 } : input;
    setState((s) => (s ? { ...s, hsva: next } : s));
    schedule(hexOf(next), now);
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
      data-inline={solid ? "" : undefined}
      role="dialog"
      aria-label={solid ? "Choisir la couleur" : "Couleur personnalisée"}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          flush(true);
          onClose();
        }
      }}
    >
      <div className="cp-wheelbox">
        <Wheel
          className="cp-wheel"
          width={WHEEL}
          height={WHEEL}
          color={{ h: hsva.h, s: hsva.s * 100, v: hsva.v * 100, a: hsva.a }}
          onChange={(c) => apply({ ...hsva, h: c.hsva.h, s: c.hsva.s / 100 })}
          role="slider"
          aria-label="Roue des couleurs : flèches gauche et droite pour la teinte, haut et bas pour la saturation"
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuenow={Math.round(hsva.h)}
          aria-valuetext={`Teinte ${Math.round(hsva.h)} degrés, saturation ${pct(hsva.s)} %`}
          onKeyDown={(e: React.KeyboardEvent) => {
            const step = e.shiftKey ? 10 : 1;
            const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step / 100], ArrowDown: [0, -step / 100] };
            if (!d[e.key]) return;
            e.preventDefault();
            apply({ ...hsva, h: (hsva.h + d[e.key][0] + 360) % 360, s: clamp(hsva.s + d[e.key][1], 0, 1) });
          }}
        />
      </div>
      <div className="cp-slider">
        <span>Luminosité</span>
        <ShadeSlider
          hsva={{ h: hsva.h, s: hsva.s * 100, v: hsva.v * 100, a: hsva.a }}
          style={alphaVars}
          radius={7}
          onChange={(c) => apply({ ...hsva, v: clamp(c.v / 100, 0, 1) })}
          innerProps={{ role: "slider", "aria-label": "Luminosité : flèches gauche et droite", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(hsva.v * 100) }}
        />
      </div>
      {!solid && <div className="cp-slider">
        <span>Opacité</span>
        <Alpha
          hsva={{ h: hsva.h, s: hsva.s * 100, v: hsva.v * 100, a: hsva.a }}
          style={alphaVars}
          radius={7}
          onChange={(c) => apply({ ...hsva, a: clamp(c.a, 0, 1) })}
          innerProps={{ role: "slider", "aria-label": "Opacité : flèches gauche et droite", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(hsva.a * 100) }}
        />
      </div>}

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

      {!solid && <><div className="cp-preview" style={bg ? { background: bg } : undefined}>
        <span className="cp-sample" style={{ color: hex }}>
          Aa Exemple de texte
        </span>
      </div>
      <p className="cp-contrast" role="status" data-low={low || undefined}>
        {contrast === null ? "Contraste non mesurable ici." : low ? `Contraste avec le fond du thème : ${contrast.toFixed(1).replace(".", ",")}:1, insuffisant (AA : 4,5:1).` : `Contraste avec le fond du thème : ${contrast.toFixed(1).replace(".", ",")}:1, suffisant.`}
      </p></>}

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
            if (solid) solid.onReset?.();
            else onChange(undefined);
            onClose();
          }}
        >
          {solid ? (solid.resetLabel ?? "Revenir au thème") : "Retirer la couleur"}
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

/**
 * Sélecteur déjà ouvert, sans pastille (panneau « Couleurs », lot 17f) : à poser dans le flux de la
 * page. `value` est lu à l'ouverture ; remonter le composant (clé) pour le recharger.
 */
export function SolidColorPicker({ value, onChange, swatch, onClose, solid, live }: ColorPickerProps & { onClose: () => void; solid: SolidOptions; live?: boolean }) {
  const id = useId();
  return <Popover id={id} ref={null} value={value} swatch={swatch} onChange={onChange} onClose={onClose} solid={solid} live={live} />;
}
