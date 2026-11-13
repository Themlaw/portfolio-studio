"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { errorAt, TextField, TextI18n, Toggle } from "@/app/admin/_fields";
import { saveSettingsAction } from "@/app/admin/(espace)/reglages/actions";
import type { AdminSettings } from "@/lib/admin";

import { clone, SaveBar, same, toast, useUnsavedGuard } from "./editing";
import SocialsEditor from "./SocialsEditor";

export default function SettingsForm({ initial, pending }: { initial: AdminSettings; pending: { pageId: number; pageTitle: string } | null }) {
  const router = useRouter();
  const t = useTranslations("settings");
  const [saved, setSaved] = useState(initial);
  const [value, setValue] = useState(() => clone(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const dirty = !same(value, saved);
  useUnsavedGuard(dirty);

  const site = value.site;
  const setSite = (patch: Partial<AdminSettings["site"]>) => setValue((v) => ({ ...v, site: { ...v.site, ...patch } }));

  const save = () =>
    start(async () => {
      const result = await saveSettingsAction(value);
      if (!result.ok) {
        setError(result.message);
        setErrors(result.fieldErrors ?? {});
        return;
      }
      setError(null);
      setErrors({});
      setSaved(clone(value));
      toast(t("saved"));
      // Hors de la transition : l'état « Enregistré » s'affiche sans attendre le rafraîchissement.
      setTimeout(() => router.refresh(), 0);
    });

  return (
    <>
    {pending && (
      <div className="a-notice" role="status" data-testid="site-draft-notice">
        <p>
          <strong>{t("draftPending")}</strong>{t("draftBody")}
        </p>
        <Link className="a-btn a-btn-small" href={`/admin/pages/${pending.pageId}/editer`}>
          {t("openEditor")}
        </Link>
      </div>
    )}
    <form
      className="a-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <section className="a-panel" aria-labelledby="s-identite">
        <h2 id="s-identite">{t("identity")}</h2>
        <div className="a-form-grid">
          <TextI18n label={t("siteName")} help={t("siteNameHelp")} value={site.name} onChange={(name) => setSite({ name })} error={errorAt(errors, "site.name")} />
          <TextField
            label={t("contact")}
            type="email"
            help={t("contactHelp")}
            value={site.email}
            onChange={(email) => setSite({ email })}
            error={errorAt(errors, "site.email")}
          />
          <TextI18n label={t("role")} help={t("roleHelp")} value={site.role} onChange={(role) => setSite({ role })} error={errorAt(errors, "site.role")} />
          <TextI18n label={t("credit")} help={t("creditHelp")} value={site.credit} onChange={(credit) => setSite({ credit })} error={errorAt(errors, "site.credit")} />
        </div>
      </section>

      <section className="a-panel" aria-labelledby="s-reseaux">
        <h2 id="s-reseaux">{t("socials")}</h2>
        <p className="a-help">{t("socialsHelp")}</p>
        <SocialsEditor
          items={value.socials}
          onChange={(socials) => setValue((v) => ({ ...v, socials }))}
          errors={Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith("socials.")).map(([k, m]) => [k.slice("socials.".length), m]))}
          error={errors.socials}
        />
        <Toggle
          label={t("headerSocials")}
          help={t("headerSocialsHelp")}
          checked={Boolean(site.headerSocials)}
          onChange={(headerSocials) => setSite({ headerSocials })}
        />
      </section>

      <SaveBar dirty={dirty} saving={saving} onSave={save} error={error} />
    </form>
    </>
  );
}
