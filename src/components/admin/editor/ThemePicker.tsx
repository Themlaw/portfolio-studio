"use client";

/**
 * Menu « Thème : <nom> ▾ » de la barre de l'éditeur de page (lot 63) : liste déroulante avec recherche, le thème en ligne
 * puis les derniers thèmes utilisés. Choisir un autre thème met l'éditeur en préparation de CE thème (aperçu admin du
 * lot 55, bandeau « Tu prépares le thème… ») ; choisir le thème en ligne arrête l'aperçu. Le brouillon est enregistré
 * avant, la page éditée ne change pas (rechargement de la même adresse).
 */
import { matchSorter } from "match-sorter";
import { useId, useState } from "react";
import { Button, Dialog, DialogTrigger, Input, ListBox, ListBoxItem, Popover, SearchField } from "react-aria-components";

import type { PreparingInfo } from "@/lib/edit/look-context";
import type { ThemeChoice } from "@/lib/edit/theme-usage";

import { toast } from "../editing";

export default function ThemePicker({ themes, preparing, flush }: { themes: ThemeChoice[]; preparing: PreparingInfo | null; flush: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const labelId = useId();
  const live = themes.find((t) => t.live);
  const currentId = preparing?.id ?? live?.id ?? "";
  const currentName = preparing?.name ?? live?.name ?? "";
  // Ordre d'origine (en ligne, puis derniers utilisés) tant qu'on ne tape rien ; sinon le meilleur résultat d'abord.
  const shown = query.trim() ? matchSorter(themes, query.trim(), { keys: ["name"], baseSort: (a, b) => a.index - b.index }) : themes;

  const choose = async (choice: ThemeChoice) => {
    if (busy) return;
    if (choice.id === currentId) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      await flush();
      const res = choice.live
        ? await fetch("/admin/apercu/quitter", { method: "POST", body: new URLSearchParams({ retour: window.location.pathname }), credentials: "same-origin", redirect: "manual" })
        : await fetch("/admin/apercu", { method: "POST", body: new URLSearchParams({ id: choice.id, retour: window.location.pathname }), credentials: "same-origin", redirect: "manual" });
      if (res.status >= 400) throw new Error(String(res.status));
      window.location.reload();
    } catch {
      setBusy(false);
      toast("Le thème n'a pas pu être changé. Réessaie.", "error");
    }
  };

  return (
    <DialogTrigger isOpen={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
      <Button className="a-btn ve-theme-btn" data-testid="theme-picker" data-preparing={preparing ? "true" : undefined} isDisabled={busy}>
        <span id={labelId}>Thème : <strong>{currentName}</strong></span> <span aria-hidden="true">▾</span>
      </Button>
      <Popover className="ve-theme-popover" placement="bottom start" offset={4}>
        <Dialog className="ve-theme-dialog" aria-label="Choisir un thème">
          <SearchField className="ve-theme-search" aria-label="Chercher un thème" value={query} onChange={setQuery} autoFocus>
            <Input className="a-input" placeholder="Chercher un thème…" data-testid="theme-picker-search" />
          </SearchField>
          <ListBox
            className="ve-theme-list"
            aria-label="Thèmes"
            selectionMode="none"
            items={shown.map((t) => ({ ...t }))}
            onAction={(key) => { const t = themes.find((x) => x.id === key); if (t) void choose(t); }}
            renderEmptyState={() => <p className="a-taginput-empty">Aucun thème ne correspond.</p>}
          >
            {(t) => (
              <ListBoxItem id={t.id} textValue={t.name} className="ve-theme-item" data-current={t.id === currentId || undefined} data-testid={`theme-choice-${t.id}`}>
                <span className="ve-theme-check" aria-hidden="true">{t.id === currentId ? "✓" : ""}</span>
                <span className="ve-theme-name">{t.name}</span>
                {t.live && <span className="a-badge ve-theme-live">En ligne</span>}
              </ListBoxItem>
            )}
          </ListBox>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
