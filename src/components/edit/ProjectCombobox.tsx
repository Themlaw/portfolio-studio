"use client";

/**
 * Choix d'un projet (panneau de l'éditeur ET toile) : champ qui cherche dans
 * les projets existants, « Créer “<texte exact>” » en dernier choix. Motif
 * combobox ARIA (liste, option active, ↑ ↓ Entrée Échap). Les projets « pas
 * encore sur une page » viennent en premier, signalés. Sans feuille de style
 * propre : classes préfixées (`ve-` dans l'admin, `pe-` sur la toile).
 */
import { useId, useMemo, useState } from "react";

export type ComboProject = { slug: string; title: string; draft?: boolean; onPage?: boolean };

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export default function ProjectCombobox({
  projects,
  value,
  onPick,
  onCreate,
  label,
  prefix,
  placeholder = "Nom d'un projet existant, ou d'un nouveau projet",
  autoFocus = false,
}: {
  projects: ComboProject[];
  value?: string;
  onPick: (slug: string) => void;
  onCreate?: (name: string) => void;
  label: string;
  prefix: "ve" | "pe";
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const current = projects.find((p) => p.slug === value);
  const q = fold(query.trim());
  const options = useMemo(() => {
    const found = projects.filter((p) => !q || fold(p.title).includes(q) || p.slug.includes(q));
    const fresh = found.filter((p) => !p.onPage && !p.draft);
    const rest = found.filter((p) => p.onPage || p.draft);
    const list: ({ kind: "project"; project: ComboProject; fresh: boolean } | { kind: "create"; name: string })[] = [
      ...fresh.map((project) => ({ kind: "project" as const, project, fresh: true })),
      ...rest.map((project) => ({ kind: "project" as const, project, fresh: false })),
    ].slice(0, 40);
    if (onCreate && query.trim()) list.push({ kind: "create", name: query.trim().slice(0, 120) });
    return list;
  }, [projects, q, query, onCreate]);

  const choose = (i: number) => {
    const o = options[i];
    if (!o) return;
    if (o.kind === "create") onCreate?.(o.name);
    else onPick(o.project.slug);
    setOpen(false);
    setQuery("");
    setActive(-1);
  };
  const listId = `${id}-list`;
  const optId = (i: number) => `${id}-opt-${i}`;
  const firstFresh = options.findIndex((o) => o.kind === "project" && o.fresh);
  const firstRest = options.findIndex((o) => o.kind === "project" && !o.fresh);

  return (
    <div className={`${prefix}-combo`}>
      <label htmlFor={`${id}-input`} className={`${prefix}-combo-label`}>
        {label}
        {current && <span className={`${prefix}-combo-current`}> · actuel : {current.title}</span>}
      </label>
      <input
        id={`${id}-input`}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? optId(active) : undefined}
        autoComplete="off"
        maxLength={120}
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={query}
        className={`${prefix}-combo-input`}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(options.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(-1, a - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            // Sans option active : le texte tapé crée le projet (ou choisit le seul trouvé).
            if (active >= 0) choose(active);
            else {
              const exact = options.findIndex((o) => o.kind === "project" && fold(o.project.title) === q);
              choose(exact >= 0 ? exact : options.findIndex((o) => o.kind === "create"));
            }
          } else if (e.key === "Escape") {
            setOpen(false);
            setActive(-1);
          }
        }}
      />
      {open && options.length > 0 && (
        <ul id={listId} role="listbox" aria-label={label} className={`${prefix}-combo-list`}>
          {options.map((o, i) => (
            <li
              key={o.kind === "create" ? "create" : o.project.slug}
              id={optId(i)}
              role="option"
              aria-selected={i === active}
              className={`${prefix}-combo-opt`}
              data-kind={o.kind}
              data-fresh={(o.kind === "project" && o.fresh) || undefined}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => choose(i)}
              onPointerEnter={() => setActive(i)}
            >
              {i === firstFresh && <span className={`${prefix}-combo-group`}>Pas encore sur une page</span>}
              {i === firstRest && firstFresh >= 0 && <span className={`${prefix}-combo-group`}>Déjà sur une page</span>}
              {o.kind === "create" ? (
                <>
                  Créer « <strong>{o.name}</strong> »
                </>
              ) : (
                <>
                  {o.project.title}
                  {o.project.draft && <small> (créé sur cette page)</small>}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
