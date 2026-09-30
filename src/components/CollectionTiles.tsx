import Image from "next/image";

import Eyebrow from "@/components/Eyebrow";
import { Link } from "@/i18n/navigation";
import type { AppPathname } from "@/i18n/routing";

export type Tile = {
  href: AppPathname;
  eyebrow: string;
  title: string;
  intro: string;
  count: string;
  image: string;
  imageAlt: string;
  width: number;
  height: number;
};

export default function CollectionTiles({
  tiles,
  cta,
}: {
  tiles: Tile[];
  cta: string;
}) {
  return (
    <div className="flex flex-col gap-[clamp(2.5rem,6vw,5rem)]">
      {tiles.map((tile, index) => (
        <Link
          key={tile.href}
          href={tile.href}
          className="tile mat-hover group grid items-center gap-8 md:grid-cols-12"
        >
          <div
            className={`md:col-span-8 ${
              index % 2 === 1 ? "md:order-2 md:col-start-5" : ""
            }`}
          >
            <div className="tile-media mat">
              <Image
                src={tile.image}
                alt={tile.imageAlt}
                width={tile.width}
                height={tile.height}
                sizes="(min-width: 768px) 66vw, 100vw"
                className="h-auto w-full rounded-[2px]"
              />
            </div>
          </div>

          <div
            className={`md:col-span-4 ${
              index % 2 === 1 ? "md:order-1 md:row-start-1" : ""
            }`}
          >
            <Eyebrow>{tile.eyebrow}</Eyebrow>
            <h3 className="mt-3 font-display text-[clamp(2rem,4.4vw,3.25rem)] text-ink transition-colors group-hover:text-primary">
              {tile.title}
            </h3>
            <p className="mt-4 text-sm leading-relaxed text-ink-soft">
              {tile.intro}
            </p>
            <p className="eyebrow mt-6 flex items-center gap-2">
              {cta}
              <span
                aria-hidden="true"
                className="transition-transform duration-500 ease-soft group-hover:translate-x-1"
              >
                →
              </span>
            </p>
            <p className="eyebrow mt-2">{tile.count}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}
