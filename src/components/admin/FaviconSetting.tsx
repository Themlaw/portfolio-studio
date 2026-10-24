"use client";

/**
 * Icône de l'onglet (lot 83) : UN composant, deux emplacements (Réglages → Référencement, étape « Logo » de l'éditeur de thème).
 * C'est le MÊME réglage de site (`seo.faviconMode` + `seo.favicon`) : les deux écrans le lisent côté serveur et l'écrivent par
 * la même action (saveFaviconAction), enregistré à part, en ligne aussitôt.
 *
 * Trois façons de l'avoir :
 *  - Automatique : le logo du thème en ligne s'il existe, sinon un monogramme (initiales, forme, couleurs du thème) ;
 *  - Une de mes images : médiathèque + l'outil de cadrage des photos, verrouillé sur un carré ;
 *  - Kit Photoshop : le calque « Icône » du kit.
 * Aperçu : faux onglet clair et sombre à la taille réelle (16 px) et agrandi, icône d'écran d'accueil, avertissement si l'image
 * est trop fine pour 16 px. Le serveur calcule l'aperçu avec le thème EN LIGNE.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { MediaPicker } from "@/app/admin/_fields";
import { previewFaviconAction, saveFaviconAction } from "@/app/admin/(espace)/reglages/actions";
import "@/app/admin/look-layer.css";
import type { EditorContext } from "@/blocks/editor-types";
import FreeCropDialog from "@/components/edit/FreeCropDialog";
import type { AdminMediaRow } from "@/lib/admin";
import type { FaviconPreview } from "@/lib/favicon";
import { COLOR_LABELS, FAVICON_MODES, LETTERS_RE, MONO_COLOR_KEYS, MONO_SHAPES, SHAPE_LABELS, initialsOf, type FaviconInput, type FaviconModeId, type MonoColorKey, type MonoShape } from "@/lib/favicon-spec";

import { clone, same, toast, useUnsavedGuard } from "./editing";

const MODE_TEXT: Record<FaviconModeId, { title: string; help: string }> = {
  auto: { title: "Automatique", help: "Ton logo s'il existe, sinon un monogramme : tes initiales, dans la police de tes titres et les couleurs de ton thème. Elle change avec ton thème." },
  image: { title: "Une de mes images", help: "Une image de ta médiathèque, que tu recadres en carré." },
  kit: { title: "Kit Photoshop", help: "Tu la dessines dans le calque « Icône » du kit Photoshop (groupe « 4 · Icône »). Sans dessin, c'est l'icône automatique." },
};

function Tab({ tone, s16, s48, name }: { tone: "light" | "dark"; s16: string; s48: string; name: string }) {
  return (
    <figure className="a-fav-tab" data-tone={tone} data-testid={`fav-tab-${tone}`}>
      <div className="a-fav-tabbar">
        <img src={s16} width={16} height={16} alt={`Icône à la taille réelle (16 pixels), onglet ${tone === "dark" ? "sombre" : "clair"}`} data-testid={`fav-16-${tone}`} />
        <span className="a-fav-tabname">{name}</span>
        <span aria-hidden="true">×</span>
      </div>
      <div className="a-fav-zoom">
        <img src={s48} width={96} height={96} alt="" data-testid={`fav-zoom-${tone}`} />
        <figcaption>{tone === "dark" ? "Onglet sombre" : "Onglet clair"} · réel et agrandi</figcaption>
      </div>
    </figure>
  );
}

export default function FaviconSetting({
  initial,
  media,
  siteName,
  colors,
  scope,
  kitHref,
}: {
  initial: FaviconInput;
  media: AdminMediaRow[];
  siteName: string;
  /** Couleurs du thème en ligne (hex), par nom : le monogramme les suit. */
  colors: Record<MonoColorKey, string>;
  /** Où le composant est posé (identifiants des champs distincts quand les deux sont sur la même page). */
  scope: "reglages" | "guide";
  /** Lien vers le kit Photoshop du thème. */
  kitHref?: string;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [value, setValue] = useState(() => clone(initial));
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const [preview, setPreview] = useState<FaviconPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [cropping, setCropping] = useState(false);
  const dirty = !same(value, saved);
  useUnsavedGuard(dirty);
  const context = { media: media.filter((m) => m.status === "ready") } as unknown as EditorContext;
  const chosen = media.find((m) => m.id === value.mediaId);
  const seq = useRef(0);
  const id = (s: string) => `fav-${scope}-${s}`;
  const initials = initialsOf(siteName);

  // Quand l'autre emplacement a enregistré (router.refresh), le serveur renvoie le nouveau réglage : on le reprend s'il n'y a rien en cours.
  // Quand l'autre emplacement a enregistré (router.refresh), le serveur renvoie le nouveau réglage : repris s'il n'y a rien en cours.
  const [seen, setSeen] = useState(initial);
  if (!same(initial, seen)) {
    setSeen(clone(initial));
    setSaved(clone(initial));
    if (!dirty) setValue(clone(initial));
  }

  // Aperçu : recalculé quand le réglage change (léger délai, la dernière réponse gagne). En mode « image », les options du
  // monogramme ne changent rien : pas de nouveau décodage de l'image.
  const previewKey = JSON.stringify({ mode: value.mode, mediaId: value.mode === "image" ? value.mediaId : null, crop: value.mode === "image" ? value.crop : null, mono: value.mono });
  useEffect(() => {
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      const res = await previewFaviconAction(JSON.parse(previewKey));
      if (mine !== seq.current) return;
      if (res.ok) {
        setPreview(res.data);
        setPreviewError(null);
      } else {
        setPreview(null);
        setPreviewError(res.message);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [previewKey]);

  const set = (patch: Partial<FaviconInput>) => setValue((v) => ({ ...v, ...patch }));
  const setMono = (patch: Partial<FaviconInput["mono"]>) => setValue((v) => ({ ...v, mono: { ...v.mono, ...patch } }));
  const lettersOk = value.mono.letters === null || LETTERS_RE.test(value.mono.letters);

  const save = () =>
    start(async () => {
      const res = await saveFaviconAction(value);
      if (!res.ok) {
        setError(res.fieldErrors?.mediaId ?? res.message);
        return;
      }
      setError(null);
      setSaved(clone(value));
      toast("Icône enregistrée · visible sur tout le site");
      setTimeout(() => router.refresh(), 0);
    });

  const showMono = value.mode !== "image";
  const swatches = (field: "bg" | "ink", label: string) => (
    <div role="radiogroup" aria-label={label} className="a-fav-swatches" data-testid={`fav-${field}`}>
      {MONO_COLOR_KEYS.map((k) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value.mono[field] === k}
          aria-label={COLOR_LABELS[k]}
          title={COLOR_LABELS[k]}
          data-color={k}
          className="a-fav-swatch"
          style={{ background: colors[k] }}
          onClick={() => setMono({ [field]: k })}
        />
      ))}
    </div>
  );

  return (
    <div className="a-fav" data-testid="favicon-setting" data-scope={scope}>
      <fieldset className="a-fieldset a-fav-modes" data-testid="fav-modes">
        <legend>Comment choisir l&apos;icône</legend>
        <p className="a-help">La petite image à côté du nom du site dans l&apos;onglet du navigateur, et sur l&apos;écran d&apos;accueil d&apos;un téléphone.</p>
        {FAVICON_MODES.map((m) => (
          <label key={m} className="a-logo-choice">
            <input type="radio" name={id("mode")} checked={value.mode === m} onChange={() => set({ mode: m })} data-testid={`fav-mode-${m}`} />
            <span>
              <strong>{MODE_TEXT[m].title}</strong>
              <small>{MODE_TEXT[m].help}</small>
            </span>
          </label>
        ))}
      </fieldset>

      {value.mode === "image" && (
        <div className="a-fav-image" data-testid="fav-image">
          <MediaPicker
            label="Image de l'icône"
            help="Une image carrée donne le meilleur résultat. Sinon, tu choisis la partie à garder."
            value={value.mediaId ?? undefined}
            onChange={(v) => set({ mediaId: v ?? null, crop: null })}
            error={error && !value.mediaId ? error : undefined}
            context={context}
          />
          {chosen?.preview && chosen.width && chosen.height && (
            <button type="button" className="a-btn a-btn-small" onClick={() => setCropping(true)} data-testid="fav-crop">
              {value.crop ? "Changer le cadrage…" : "Cadrer en carré…"}
            </button>
          )}
          {value.crop && <span className="a-help">Cadrage choisi.</span>}
        </div>
      )}
      {value.mode === "kit" && kitHref && (
        <p className="a-help">
          <Link href={kitHref} className="a-btn a-btn-quiet" data-testid="fav-kit-link">
            Ouvrir le kit Photoshop
          </Link>
        </p>
      )}

      {showMono && (
        <div className="a-fav-mono" data-testid="fav-mono">
          <p className="a-card-label">Monogramme (quand il n&apos;y a pas de logo)</p>
          <label className="a-fav-letters">
            <span>Lettres (2 ou 3)</span>
            <input
              className="a-input"
              value={value.mono.letters ?? ""}
              placeholder={initials}
              maxLength={3}
              aria-invalid={!lettersOk}
              onChange={(e) => setMono({ letters: e.target.value.trim() === "" ? null : e.target.value.trim().toLocaleUpperCase("fr") })}
              data-testid="fav-letters"
            />
            <small className="a-help">{lettersOk ? "Vide : les initiales de ton nom." : "Écris 2 ou 3 lettres."}</small>
          </label>
          <div role="radiogroup" aria-label="Forme" className="a-fav-shapes" data-testid="fav-shape">
            {MONO_SHAPES.map((s: MonoShape) => (
              <label key={s} className="a-logo-choice">
                <input type="radio" name={id("shape")} checked={value.mono.shape === s} onChange={() => setMono({ shape: s })} data-testid={`fav-shape-${s}`} />
                <span>{SHAPE_LABELS[s]}</span>
              </label>
            ))}
          </div>
          <div className="a-fav-colors">
            <div>
              <span className="a-card-label">Couleur du fond</span>
              {swatches("bg", "Couleur du fond")}
            </div>
            <div>
              <span className="a-card-label">Couleur des lettres</span>
              {swatches("ink", "Couleur des lettres")}
            </div>
          </div>
        </div>
      )}

      <div className="a-fav-preview" data-testid="fav-preview" aria-live="polite">
        <p className="a-card-label">Voici comment l&apos;icône apparaîtra (avec le thème en ligne)</p>
        {preview ? (
          <>
            <div className="a-fav-tabs">
              <Tab tone="light" s16={preview.light.s16} s48={preview.light.s48} name={siteName} />
              <Tab tone="dark" s16={preview.dark.s16} s48={preview.dark.s48} name={siteName} />
              <figure className="a-fav-phone" data-testid="fav-phone">
                <img src={preview.light.s180} width={60} height={60} alt="Icône sur l'écran d'accueil d'un téléphone" />
                <figcaption>{siteName.slice(0, 14)}</figcaption>
              </figure>
            </div>
            {preview.fallback === "logo-large" && <p className="a-help">Ton logo est trop large pour une si petite icône : c&apos;est le monogramme qui est utilisé.</p>}
            {preview.warnings.map((w) => (
              <p key={w} className="ve-alert ve-warnings" role="status" data-testid="fav-warning">
                {w}
              </p>
            ))}
          </>
        ) : (
          <p className="a-help">{previewError ?? "Aperçu en préparation…"}</p>
        )}
      </div>

      <div className="a-fav-save">
        <p className="a-fav-state" aria-live="polite">
          {saving ? "Enregistrement…" : error ? <span className="a-danger-text">{error}</span> : dirty ? "Modifications non enregistrées" : "✓ Enregistré"}
        </p>
        <button type="button" className="a-btn a-btn-primary" onClick={save} disabled={saving || !dirty || !lettersOk} data-testid="fav-save">
          {saving ? "Enregistrement…" : "Enregistrer l'icône"}
        </button>
      </div>

      {cropping && chosen?.preview && chosen.width && chosen.height && (
        <div className="a-fav-crop">
          <FreeCropDialog
            square
            src={chosen.preview}
            px={{ w: chosen.width, h: chosen.height }}
            initial={value.crop}
            onClose={() => setCropping(false)}
            onSave={(rect) => {
              set({ crop: rect });
              setCropping(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
