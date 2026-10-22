"use client";

/**
 * Vignette RÉELLE de l'accueil (lot 60) : la vraie page d'accueil du site, rendue avec un thème (`<thème>`) ou une version de Mon thème
 * (`<thème>@<n>`), dans un cadre réduit. Le proxy donne l'aperçu à CETTE requête seulement (`?vignette=`, session admin vérifiée) :
 * plusieurs vignettes montrent chacune leur thème sur le même écran.
 *
 * Chargement paresseux : le cadre n'est créé que quand la vignette approche de l'écran (IntersectionObserver ; une section repliée n'est
 * jamais demandée), et UNE vignette à la fois se charge (file commune : la suivante démarre quand la précédente est chargée).
 */
import { useEffect, useRef, useState } from "react";

const WIDTH = 1280;
const HEIGHT = 800;
/** Au plus ce temps pour une vignette avant de passer à la suivante (page lente ou en erreur). */
const SLOT_MAX_MS = 15_000;

/** File commune des chargements : un seul à la fois. */
const waiting: (() => void)[] = [];
let busy = false;
function acquire(go: () => void) {
  if (!busy) {
    busy = true;
    go();
  } else waiting.push(go);
}
function release() {
  const next = waiting.shift();
  if (next) next();
  else busy = false;
}
function cancel(go: () => void) {
  const i = waiting.indexOf(go);
  if (i >= 0) waiting.splice(i, 1);
}

export default function LiveThumb({ themeRef, stamp }: { themeRef: string; /** Change quand le thème change : recharge le cadre. */ stamp?: string | number }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.375);
  const [load, setLoad] = useState(false);
  const released = useRef(false);
  const finishRef = useRef<() => void>(() => {});

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / WIDTH));
    ro.observe(el);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const go = () => {
      released.current = false;
      setLoad(true);
      timer = setTimeout(() => finish(), SLOT_MAX_MS);
    };
    const finish = () => {
      if (released.current) return;
      released.current = true;
      if (timer) clearTimeout(timer);
      release();
    };
    finishRef.current = finish;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          acquire(go);
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => {
      ro.disconnect();
      io.disconnect();
      cancel(go);
      if (timer) clearTimeout(timer);
      // Vignette quittée pendant son chargement : la file continue.
      if (timer) finish();
    };
  }, []);

  const src = `/fr?vignette=${encodeURIComponent(themeRef)}${stamp !== undefined ? `&t=${encodeURIComponent(String(stamp))}` : ""}`;
  return (
    <div ref={box} className="a-theme-thumb a-live-thumb" data-testid="live-thumb" data-ref={themeRef} aria-hidden="true">
      {load && (
        <iframe
          key={src}
          src={src}
          title=""
          tabIndex={-1}
          loading="lazy"
          referrerPolicy="same-origin"
          onLoad={() => finishRef.current()}
          onError={() => finishRef.current()}
          style={{ width: WIDTH, height: HEIGHT, transform: `scale(${scale})` }}
        />
      )}
    </div>
  );
}
