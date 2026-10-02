"use client";

/**
 * Onglet « Structure » de l'éditeur visuel (v0.13) : l'arbre de la page.
 * Les conteneurs se déplient (composants indentés), la sélection suit la
 * toile. Glisser une ligne par sa poignée : avant ou après une autre, ou DANS
 * un conteneur (au milieu de sa ligne) s'il accepte ce composant — repère
 * rouge sinon. Clavier : ↑ ↓ (monter, descendre), ⇱ (sortir du conteneur),
 * flèches gauche / droite pour replier / déplier.
 */
import { useState } from "react";

import type { BlockCatalogEntry } from "@/blocks/editor-types";
import { renderSummary } from "@/blocks/summary";
import { canPlace, childrenOf, findBlock, isContainer, locate, MAX_NESTING, type TreeBlock } from "@/blocks/tree";
import type { DraftBlock } from "@/lib/edit/drafts";
import { own } from "@/lib/own";

type Op = "up" | "down" | "duplicate" | "delete" | "out" | "in";
type Target = { parent: string | null; index: number; refused?: boolean; row: string; where: "before" | "after" | "inside" };

export default function StructureTree({
  blocks,
  byType,
  selected,
  invalid,
  onSelect,
  onMove,
  onOp,
}: {
  blocks: DraftBlock[];
  byType: Record<string, BlockCatalogEntry>;
  selected: string | null;
  invalid: Set<string>;
  onSelect: (uid: string) => void;
  onMove: (uid: string, parent: string | null, index: number) => void;
  onOp: (op: Op, uid: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<{ uid: string; target: Target | null } | null>(null);
  const toggle = (uid: string, open?: boolean) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (open ?? next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });

  /** Cible sous le pointeur (lignes de l'arbre). */
  const targetAt = (moving: string, y: number): Target | null => {
    const rows = [...document.querySelectorAll<HTMLElement>(".ve-tree [data-row]")];
    const block = findBlock(blocks, moving);
    if (!block) return null;
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      if (y < r.top || y > r.bottom) continue;
      const uid = row.dataset.row!;
      if (uid === moving) return null;
      const at = locate(blocks, uid);
      if (!at) return null;
      const rowBlock = findBlock(blocks, uid)!;
      const third = (y - r.top) / r.height;
      // Milieu d'une ligne de conteneur : dedans (à la fin).
      if (isContainer(rowBlock.type) && third > 0.3 && third < 0.7) {
        const ok = canPlace(blocks, block, uid) && !inside(block, uid);
        return { parent: uid, index: childrenOf(rowBlock).length, refused: !ok, row: uid, where: "inside" };
      }
      const where = third <= 0.5 ? "before" : "after";
      const ok = (at.parent === null || canPlace(blocks, block, at.parent)) && !inside(block, at.parent);
      return { parent: at.parent, index: at.index + (where === "after" ? 1 : 0), refused: !ok, row: uid, where };
    }
    return null;
  };
  /** `parent` est-il le bloc déplacé ou l'un de ses composants ? */
  const inside = (block: TreeBlock, parent: string | null): boolean => {
    if (!parent) return false;
    if (block.uid === parent) return true;
    return childrenOf(block).some((c) => inside(c, parent));
  };

  const onGrip = (e: React.PointerEvent<HTMLButtonElement>, uid: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      window.getSelection()?.removeAllRanges();
    } catch {}
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    document.documentElement.setAttribute("data-ve-dragging", "");
    let target: Target | null = null;
    setDrag({ uid, target: null });
    const move = (ev: PointerEvent) => {
      target = targetAt(uid, ev.clientY);
      setDrag({ uid, target });
    };
    const up = (ev: PointerEvent) => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", cancel);
      document.documentElement.removeAttribute("data-ve-dragging");
      setDrag(null);
      if (ev.type === "pointerup" && target && !target.refused) onMove(uid, target.parent, target.index);
    };
    const cancel = (ev: PointerEvent) => up(ev);
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", cancel);
  };

  /** Conteneur voisin (après, sinon avant) qui accepterait ce bloc : « Entrer dans… ». */
  const enterTarget = (list: DraftBlock[], i: number): DraftBlock | undefined =>
    [list[i + 1], list[i - 1]].find((c) => c && isContainer(c.type) && c.uid !== list[i].uid && canPlace(blocks, list[i], c.uid) && !inside(list[i], c.uid));

  const render = (list: DraftBlock[], depth: number, parent: DraftBlock | null) =>
    list.map((b, i) => {
      const meta = own(byType, b.type);
      const summary = meta ? renderSummary(meta.summary, b.props) : "";
      const kids = childrenOf(b) as DraftBlock[];
      const container = isContainer(b.type);
      const open = !collapsed.has(b.uid);
      const t = drag?.target?.row === b.uid ? drag.target : null;
      return (
        <li
          key={b.uid}
          role="treeitem"
          aria-level={depth + 1}
          aria-selected={b.uid === selected}
          aria-expanded={container ? open : undefined}
          className="ve-tree-item"
        >
          <div
            className="ve-row"
            data-row={b.uid}
            data-depth={depth}
            aria-current={b.uid === selected || undefined}
            data-invalid={invalid.has(b.uid) || undefined}
            data-drop={t ? (t.refused ? "refused" : t.where) : undefined}
            data-dragging={drag?.uid === b.uid || undefined}
            style={{ paddingLeft: depth * 18 }}
          >
            <button type="button" className="ve-tree-grip" aria-label={`Glisser « ${meta?.label ?? b.type} »`} title="Glisser (dans un conteneur : au milieu de sa ligne)" onPointerDown={(e) => onGrip(e, b.uid)}>
              ⠿
            </button>
            {container ? (
              <button type="button" className="ve-tree-toggle" aria-label={open ? "Replier" : "Déplier"} onClick={() => toggle(b.uid)}>
                {open ? "▾" : "▸"}
              </button>
            ) : (
              <span className="ve-tree-toggle" aria-hidden="true" />
            )}
            <button
              type="button"
              className="ve-row-main"
              onClick={() => onSelect(b.uid)}
              onKeyDown={(e) => {
                if (container && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                  e.preventDefault();
                  toggle(b.uid, e.key === "ArrowRight");
                } else if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
                  // Navigation entre les lignes visibles de l'arbre.
                  e.preventDefault();
                  const rows = [...document.querySelectorAll<HTMLButtonElement>(".ve-tree .ve-row-main")];
                  const at = rows.indexOf(e.currentTarget);
                  const to = e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : at + (e.key === "ArrowDown" ? 1 : -1);
                  rows[Math.max(0, Math.min(rows.length - 1, to))]?.focus();
                }
              }}
            >
              <span className="ve-row-n">{i + 1}</span>
              <span className="ve-row-text">
                <strong>{meta?.label ?? b.type}</strong>
                {summary && <span className="ve-row-sum">{summary}</span>}
              </span>
              {invalid.has(b.uid) && <span className="a-tag a-tag-danger">À corriger</span>}
            </button>
            <span className="ve-tree-tools">
              <button type="button" className="a-icon-btn" aria-label={`Monter « ${meta?.label ?? b.type} »`} disabled={i === 0} onClick={() => onOp("up", b.uid)}>
                ↑
              </button>
              <button type="button" className="a-icon-btn" aria-label={`Descendre « ${meta?.label ?? b.type} »`} disabled={i === list.length - 1} onClick={() => onOp("down", b.uid)}>
                ↓
              </button>
              {parent && (
                <button type="button" className="a-icon-btn" aria-label={`Sortir « ${meta?.label ?? b.type} » du conteneur`} title="Sortir du conteneur" onClick={() => onOp("out", b.uid)}>
                  ⇱
                </button>
              )}
              {enterTarget(list, i) && (
                <button
                  type="button"
                  className="a-icon-btn"
                  aria-label={`Entrer « ${meta?.label ?? b.type} » dans « ${own(byType, enterTarget(list, i)!.type)?.label ?? "le conteneur"} »`}
                  title="Entrer dans le conteneur voisin"
                  onClick={() => onOp("in", b.uid)}
                >
                  ⇲
                </button>
              )}
            </span>
          </div>
          {container && open && (
            <ul role="group" className="ve-tree-group">
              {kids.length ? render(kids, depth + 1, b) : <li className="ve-tree-empty" style={{ paddingLeft: (depth + 1) * 18 + 30 }}>Vide : glisse un composant dedans.</li>}
            </ul>
          )}
        </li>
      );
    });

  return (
    <>
      <ul className="ve-tree" role="tree" aria-label="Structure de la page">
        {render(blocks, 0, null)}
      </ul>
      <p className="ve-hint">
        Glisse une ligne par sa poignée : entre deux lignes, ou au milieu d&apos;un conteneur pour l&apos;y ranger ({MAX_NESTING} niveaux de conteneurs au plus).
      </p>
    </>
  );
}
