import { useTranslations } from "next-intl";

import Eyebrow from "@/components/Eyebrow";
import { Link } from "@/i18n/navigation";

/** Contenu de la page 404, dans le langage du thème (tokens et variantes). */
export default function NotFoundView() {
  const t = useTranslations("notFound");
  return (
    <section className="page-top shell">
      <div className="max-w-2xl">
        <Eyebrow>{t("eyebrow")}</Eyebrow>
        <h1 className="mt-4 font-display text-[clamp(2.75rem,8vw,6rem)] text-ink">{t("title")}</h1>
        <p className="mt-6 text-base leading-relaxed text-ink-soft">{t("body")}</p>
        <Link href="/" className="btn mt-10">
          {t("back")}
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}
