"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { PdfView } from "@/lib/images/variants";
import type { LocalizedArtwork } from "@/lib/gallery";

import Lightbox from "./Lightbox";
import Picture from "./Picture";

const fill = (template: string, values: Record<string, number>) => template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ""));

/**
 * Pages d'un CV (bloc « CV ») : chaque page est une image cliquable qui
 * ouvre la visionneuse (← / →, Échap, balayage), focus rendu à la page à la
 * fermeture.
 */
export default function CvPages({
  pages,
  alt,
  texts,
}: {
  pages: PdfView["pages"];
  /** Texte alternatif du document (titre du bloc, ou texte alternatif du média). */
  alt: string;
  /** Gabarits ICU simples : {index}, {total}. */
  texts: { page: string; open: string; pages: string };
}) {
  const [open, setOpen] = useState<number | null>(null);
  const triggers = useRef<(HTMLButtonElement | null)[]>([]);
  const last = useRef<number | null>(null);
  const total = pages.length;

  const items = useMemo<LocalizedArtwork[]>(
    () =>
      pages.map((p, i) => {
        const label = fill(texts.page, { index: i + 1, total });
        return {
          id: `cv-page-${i + 1}`,
          slug: `cv-page-${i + 1}`,
          collection: "characters",
          title: label,
          alt: alt ? `${alt} — ${label}` : label,
          description: "",
          image: p.sources.largest.webp,
          sources: p.sources,
          width: p.w,
          height: p.h,
          year: 0,
          featured: false,
        };
      }),
    [pages, alt, texts.page, total],
  );

  useEffect(() => {
    if (open !== null) {
      last.current = open;
      return;
    }
    if (last.current !== null) {
      triggers.current[last.current]?.focus();
      last.current = null;
    }
  }, [open]);

  return (
    <>
      <ul className="cv-pages" data-count={total} aria-label={texts.pages}>
        {items.map((item, i) => (
          <li key={item.id}>
            <button
              type="button"
              className="cv-page"
              ref={(node) => {
                triggers.current[i] = node;
              }}
              onClick={() => setOpen(i)}
              aria-label={fill(texts.open, { index: i + 1, total })}
            >
              <Picture
                src={item.image}
                sources={item.sources}
                alt={item.alt}
                width={item.width}
                height={item.height}
                sizes={total === 1 ? "(min-width: 768px) 640px, 100vw" : "(min-width: 1236px) 600px, (min-width: 640px) 50vw, 100vw"}
                priority={i === 0}
              />
              {total > 1 && (
                <span className="cv-page-num" aria-hidden="true">
                  {i + 1} / {total}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <Lightbox items={items} index={open} onIndexChange={setOpen} onClose={() => setOpen(null)} />
    </>
  );
}
