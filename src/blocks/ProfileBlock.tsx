import Image from "next/image";
import { z } from "zod";

import Eyebrow from "@/components/Eyebrow";
import { getMedia } from "@/lib/media";
import { getSite, getSocials } from "@/lib/settings";

import { localized, tr, type BlockContext, localizedText } from "./types";

export const profileSchema = z.object({
  portraitMediaId: z.number().int().positive().optional(),
  portraitCaption: localized,
  eyebrow: localized,
  /** Le premier paragraphe est l'accroche (encre pleine). */
  paragraphs: z.array(localizedText).min(1).max(30),
  contactEyebrow: localized,
  contactLabel: localized,
  socialEyebrow: localized,
});

/** Page « À propos » : portrait encadré, présentation, contact et réseaux. */
export default async function ProfileBlock({ props, ctx }: { props: z.infer<typeof profileSchema>; ctx: BlockContext }) {
  const [site, socials, portrait] = await Promise.all([
    getSite(ctx.locale),
    getSocials(),
    getMedia(props.portraitMediaId),
  ]);
  const [lead, ...rest] = props.paragraphs;

  return (
    <section className="shell pt-[clamp(6rem,14vh,10rem)]">
      <div className="grid gap-[clamp(2.5rem,6vw,5rem)] md:grid-cols-12">
        <div className="md:col-span-5 lg:col-span-4">
          <div className="mat md:sticky md:top-28">
            {portrait && (
              <Image
                src={portrait.url}
                alt={portrait.alt ? tr(portrait.alt, ctx.locale) : ""}
                width={portrait.width ?? 900}
                height={portrait.height ?? 1100}
                sizes="(min-width: 768px) 33vw, 100vw"
                className="h-auto w-full rounded-[2px]"
                priority
              />
            )}
            <p className="eyebrow pt-3">{tr(props.portraitCaption, ctx.locale)}</p>
          </div>
        </div>

        <div className="md:col-span-7 lg:col-span-7 lg:col-start-6">
          <Eyebrow>{tr(props.eyebrow, ctx.locale)}</Eyebrow>
          <h1 className="mt-4 font-display text-[clamp(2.75rem,7vw,5rem)] text-ink">{site.name}</h1>
          <p className="caption-text mt-4 font-caption text-[0.72rem] tracking-[0.2em] uppercase text-secondary">
            {site.role}
          </p>

          <div className="mt-10 space-y-6 text-base leading-relaxed text-ink-soft">
            <p className="text-ink">{tr(lead, ctx.locale)}</p>
            {rest.map((p, i) => (
              <p key={i}>{tr(p, ctx.locale)}</p>
            ))}
          </div>

          <hr className="rule my-12" />

          <div className="grid gap-10 sm:grid-cols-2">
            <div>
              <Eyebrow>{tr(props.contactEyebrow, ctx.locale)}</Eyebrow>
              <a
                href={`mailto:${site.email}`}
                className="link-underline mt-3 block font-display text-xl break-words lg:text-2xl"
              >
                {site.email}
              </a>
              <a className="btn mt-6" href={`mailto:${site.email}`}>
                {tr(props.contactLabel, ctx.locale)}
                <span aria-hidden="true">→</span>
              </a>
            </div>

            <div>
              <Eyebrow>{tr(props.socialEyebrow, ctx.locale)}</Eyebrow>
              <ul className="mt-3 space-y-2">
                {socials.map((s) => (
                  <li key={s.label}>
                    <a href={s.href} className="text-ink-soft transition-colors hover:text-primary">
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
