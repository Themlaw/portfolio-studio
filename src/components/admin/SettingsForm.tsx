"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { errorAt, TextField, TextI18n, Toggle } from "@/app/admin/_fields";
import { saveSettingsAction } from "@/app/admin/(espace)/reglages/actions";
import type { AdminSettings } from "@/lib/admin";

import { clone, SaveBar, same, toast, useUnsavedGuard } from "./editing";
import SocialsEditor from "./SocialsEditor";

export default function SettingsForm({ initial }: { initial: AdminSettings }) {
  const router = useRouter();
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
      toast("Enregistré · visible sur tout le site");
      // Hors de la transition : l'état « Enregistré » s'affiche sans attendre le rafraîchissement.
      setTimeout(() => router.refresh(), 0);
    });

  return (
    <form
      className="a-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <section className="a-panel" aria-labelledby="s-identite">
        <h2 id="s-identite">Identité</h2>
        <div className="a-form-grid">
          <TextI18n label="Nom affiché" help="En haut de chaque page et dans l'onglet du navigateur. Vide en anglais : le nom français est repris." value={site.name} onChange={(name) => setSite({ name })} error={errorAt(errors, "site.name")} />
          <TextField
            label="Adresse de contact"
            type="email"
            help="Les boutons « Écrire » ouvrent un e-mail vers cette adresse."
            value={site.email}
            onChange={(email) => setSite({ email })}
            error={errorAt(errors, "site.email")}
          />
          <TextI18n label="Métier" help="Sous ton nom (ex. Illustratrice & character designer)." value={site.role} onChange={(role) => setSite({ role })} error={errorAt(errors, "site.role")} />
          <TextI18n label="Mention en pied de page" help="Ex. Tous droits réservés." value={site.credit} onChange={(credit) => setSite({ credit })} error={errorAt(errors, "site.credit")} />
        </div>
      </section>

      <section className="a-panel" aria-labelledby="s-reseaux">
        <h2 id="s-reseaux">Réseaux</h2>
        <p className="a-help">Affichés en pied de page et sur la page À propos, dans cet ordre.</p>
        <SocialsEditor
          items={value.socials}
          onChange={(socials) => setValue((v) => ({ ...v, socials }))}
          errors={Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith("socials.")).map(([k, m]) => [k.slice("socials.".length), m]))}
          error={errors.socials}
        />
        <Toggle
          label="Icônes des réseaux dans l'en-tête"
          help="Juste avant le choix de langue (FR / EN), icônes seules ; sur téléphone, dans le menu."
          checked={Boolean(site.headerSocials)}
          onChange={(headerSocials) => setSite({ headerSocials })}
        />
      </section>

      <SaveBar dirty={dirty} saving={saving} onSave={save} error={error} />
    </form>
  );
}
