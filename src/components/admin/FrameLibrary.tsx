"use client";

/**
 * Bibliothèque de cadres (lot 74, Admin → Thèmes → Cadres), construite comme celle des papiers peints et avec ses composants (boîte de
 * confirmation, messages, classes `a-wp-*`) : on importe autant de cadres qu'on veut (PNG / WebP transparent ou SVG), on voit chacun sur
 * un fond clair ET un fond sombre, on le renomme, on règle son épaisseur, on le supprime. Le cadre dessiné dans le kit du thème en ligne
 * est listé en tête (« Cadre du thème »), en lecture seule. Supprimer un cadre utilisé : la boîte dit « utilisé par N images » ; ces
 * images repassent à « Aucun », sans rien casser.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { deleteFrameAction, frameUsesAction, renameFrameAction, setFrameThicknessAction } from "@/app/admin/(espace)/cadres/actions";
import type { AdminFrame, ThemeFrameInfo } from "@/lib/frames";
import { FRAME_THICKNESS_MAX, FRAME_THICKNESS_MIN, frameThumb } from "@/themes/frame-library";

import { ConfirmDialog, toast } from "./editing";

const ACCEPTED = /\.(png|webp|avif|svg)$/i;
const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

/** Aperçu d'un cadre : deux moitiés, fond clair et fond sombre (les cadres sont dessinés sur transparent). */
function Preview({ src, label }: { src: string; label: string }) {
  return (
    <span className="a-wp-preview" aria-hidden="true">
      {(["light", "dark"] as const).map((tone) => (
        <span key={tone} className="a-wp-half" data-tone={tone}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" data-testid={`${label}-${tone}`} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        </span>
      ))}
    </span>
  );
}

function Card({ f, onChanged, onDelete }: { f: AdminFrame; onChanged: () => void; onDelete: (f: AdminFrame) => void }) {
  const [name, setName] = useState(f.name);
  const [thickness, setThickness] = useState(f.thickness);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const rename = async () => {
    const next = name.trim();
    if (next === f.name) return;
    const r = await renameFrameAction(f.id, next);
    if (!r.ok) {
      toast(r.message, "error");
      setName(f.name);
      return;
    }
    toast(`Renommé · « ${next} »`);
    onChanged();
  };
  return (
    <li className="a-wp-card" data-testid="frame" data-frame-id={f.id}>
      <Preview src={frameThumb(f)} label="frame-preview" />
      <label className="a-field">
        <span className="a-field-label">Nom</span>
        <input className="a-input" value={name} maxLength={60} aria-label={`Nom du cadre ${f.name}`} data-testid="frame-name" onChange={(e) => setName(e.target.value)} onBlur={() => void rename()} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
      </label>
      <label className="a-field">
        Épaisseur : {thickness} px
        <input
          type="range"
          min={FRAME_THICKNESS_MIN}
          max={FRAME_THICKNESS_MAX}
          step={1}
          value={thickness}
          data-testid="frame-thickness"
          onChange={(e) => {
            const v = Number(e.target.value);
            setThickness(v);
            clearTimeout(timer.current);
            timer.current = setTimeout(async () => {
              const r = await setFrameThicknessAction(f.id, v);
              if (!r.ok) toast(r.message, "error");
              else onChanged();
            }, 350);
          }}
        />
      </label>
      <p className="a-help" data-testid="frame-detected" data-detected={f.detected ? "yes" : "no"}>
        {f.detected ? "Le bord a été repéré automatiquement. Règle l'épaisseur si tu la veux plus fine ou plus large." : "Je n'ai pas pu repérer le bord (le fichier n'a pas de transparence au milieu) : une épaisseur moyenne est prévue, règle-la au curseur."}
      </p>
      <div className="a-wp-foot">
        <span className="a-wp-uses" data-testid="frame-uses">
          {f.uses ? `Utilisé par ${f.uses} ${plural(f.uses, "image", "images")}` : "Pas encore utilisé"}
        </span>
        <button type="button" className="a-btn a-btn-small a-btn-quiet a-danger-text" data-testid="frame-delete" onClick={() => onDelete(f)}>
          Supprimer
        </button>
      </div>
    </li>
  );
}

type Pending = { name: string; phase: "uploading" | "failed"; message?: string };

export default function FrameLibrary({ initial, theme }: { initial: AdminFrame[]; theme: ThemeFrameInfo }) {
  const router = useRouter();
  const [list, setList] = useState(initial);
  const [seen, setSeen] = useState(initial);
  const [over, setOver] = useState(false);
  const [busy, start] = useTransition();
  const [queue, setQueue] = useState<Record<string, Pending>>({});
  const [target, setTarget] = useState<{ f: AdminFrame; images: number } | null>(null);
  const refresh = () => router.refresh();

  // Nouvelle lecture du serveur (router.refresh) : la liste locale la reprend.
  if (seen !== initial) {
    setSeen(initial);
    setList(initial);
  }

  const send = async (files: File[]) => {
    const ok = files.filter((f) => ACCEPTED.test(f.name) || /^image\/(png|webp|avif|svg\+xml)$/.test(f.type));
    for (const f of files) if (!ok.includes(f)) toast(`« ${f.name} » : un cadre doit être un PNG ou un WebP sur fond transparent, ou un SVG.`, "error");
    for (const f of ok) {
      const key = `${f.name}-${f.size}-${Math.random().toString(36).slice(2)}`;
      setQueue((q) => ({ ...q, [key]: { name: f.name, phase: "uploading" } }));
      try {
        const body = new FormData();
        body.append("file", f);
        const res = await fetch("/admin/api/cadres", { method: "POST", body });
        const json = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; reused?: boolean; entry?: { name: string } } | null;
        if (!json?.ok) {
          setQueue((q) => ({ ...q, [key]: { name: f.name, phase: "failed", message: json?.message ?? "Échec de l'envoi." } }));
          toast(json?.message ?? "Échec de l'envoi.", "error");
          continue;
        }
        toast(json.reused ? `Déjà dans la bibliothèque · « ${json.entry?.name} »` : `Cadre ajouté · « ${json.entry?.name} »`);
        setQueue((q) => Object.fromEntries(Object.entries(q).filter(([k]) => k !== key)));
        refresh();
      } catch {
        setQueue((q) => ({ ...q, [key]: { name: f.name, phase: "failed", message: "Échec de l'envoi." } }));
      }
    }
  };

  const askDelete = async (f: AdminFrame) => {
    const r = await frameUsesAction(f.id);
    setTarget({ f, images: r.ok ? r.data.images : f.uses });
  };
  const confirmDelete = () =>
    start(async () => {
      if (!target) return;
      const { f } = target;
      const r = await deleteFrameAction(f.id);
      setTarget(null);
      if (!r.ok) return toast(r.message, "error");
      toast(r.data.images ? `Supprimé · « ${f.name} » (${r.data.images} ${plural(r.data.images, "image repasse", "images repassent")} à « Aucun »)` : `Supprimé · « ${f.name} »`);
      refresh();
    });

  const pending = Object.entries(queue);

  return (
    <div className="a-wp" data-testid="frame-library">
      <section className="a-panel" aria-labelledby="fr-import">
        <h2 id="fr-import">Importer des cadres</h2>
        <label
          className="a-wp-drop"
          data-over={over || undefined}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void send([...e.dataTransfer.files]);
          }}
        >
          <input
            type="file"
            multiple
            accept="image/png,image/webp,image/avif,image/svg+xml,.png,.webp,.avif,.svg"
            className="sr-only"
            data-testid="frame-input"
            onChange={(e) => {
              void send([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <span>Dépose tes cadres ici, ou choisis-les</span>
          <small>PNG ou WebP sur fond transparent, ou SVG. Le bord est repéré tout seul.</small>
        </label>
        {pending.length > 0 && (
          <ul className="a-wp-queue" aria-label="Envois en cours">
            {pending.map(([key, p]) => (
              <li key={key} data-phase={p.phase}>
                <span>{p.name}</span>
                <span>{p.phase === "failed" ? (p.message ?? "Échec") : "Envoi…"}</span>
                {p.phase === "failed" && (
                  <button type="button" className="a-btn a-btn-small a-btn-quiet" onClick={() => setQueue((q) => Object.fromEntries(Object.entries(q).filter(([k]) => k !== key)))}>
                    Retirer
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="fr-liste">
        <h2 id="fr-liste" className="a-wp-h">
          Ma bibliothèque <span className="muted">{list.length + (theme ? 1 : 0)}</span>
        </h2>
        <ul className="a-wp-grid">
          {theme && (
            <li className="a-wp-card" data-testid="frame-theme">
              <Preview src={theme.thumb} label="frame-theme-preview" />
              <p>
                <strong>Cadre du thème</strong>
              </p>
              <p className="a-help">Le cadre dessiné dans le kit Photoshop de ton thème en ligne. Il se modifie en important un nouveau kit ; tu peux le choisir pour chaque image comme les autres.</p>
            </li>
          )}
          {list.map((f) => (
            <Card key={f.id} f={f} onChanged={refresh} onDelete={(x) => void askDelete(x)} />
          ))}
        </ul>
        {list.length === 0 && (
          <p className="a-help" data-testid="frame-empty">
            Aucun cadre importé pour l&apos;instant. Importe ton premier cadre ci-dessus.
          </p>
        )}
      </section>

      <ConfirmDialog open={target !== null} title={target ? `Supprimer le cadre « ${target.f.name} » ?` : ""} confirmLabel="Supprimer" danger busy={busy} onConfirm={confirmDelete} onClose={() => setTarget(null)}>
        {target && target.images > 0 ? (
          <p data-testid="frame-delete-uses">
            Ce cadre est utilisé par {target.images} {plural(target.images, "image", "images")}. Elle{target.images > 1 ? "s" : ""} repasse{target.images > 1 ? "nt" : ""} à « Aucun » : rien d&apos;autre ne change.
          </p>
        ) : (
          <p>Ce cadre n&apos;est utilisé nulle part.</p>
        )}
      </ConfirmDialog>
    </div>
  );
}
