"use client";

/**
 * Menu « Thème : <nom> ▾ » de la barre de l'éditeur de page (lot 63) : liste déroulante avec recherche. Mon thème d'abord (avec sa
 * version), puis les modèles, puis les anciens thèmes (lot 60), chaque groupe du plus récemment utilisé au plus ancien. Choisir un autre thème met l'éditeur en préparation de CE thème (aperçu admin du
 * lot 55, bandeau « Tu prépares le thème… ») ; choisir le thème en ligne arrête l'aperçu. Le brouillon est enregistré
 * avant, la page éditée ne change pas (rechargement de la même adresse).
 */
import { matchSorter } from "match-sorter";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button, Dialog, DialogTrigger, Input, ListBox, ListBoxItem, Popover, SearchField } from "react-aria-components";

import type { PreparingInfo } from "@/lib/edit/look-context";
import type { ThemeChoice } from "@/lib/edit/theme-usage";

import { toast } from "../editing";

export default function ThemePicker({ themes, preparing, flush }: { themes: ThemeChoice[]; preparing: PreparingInfo | null; flush: () => Promise<unknown> }) {
  const t = useTranslations("editorPanelsTheme");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const labelId = useId();
  const live = themes.find((th) => th.live);
  const currentId = preparing?.id ?? live?.id ?? "";
  const current = themes.find((th) => th.id === currentId);
  const currentName = (preparing?.name ?? live?.name ?? "") + (current?.version ? ` · v${current.version}` : "");
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
      toast(t("changeFailed"), "error");
    }
  };

  return (
    <DialogTrigger isOpen={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
      <Button className="a-btn ve-theme-btn" data-testid="theme-picker" data-preparing={preparing ? "true" : undefined} isDisabled={busy} aria-label={t("buttonLabel", { name: currentName })} data-name={currentName}>
        <span id={labelId} className="ve-theme-cur"><span className="ve-theme-cap">{t("caption")}<span className="ve-theme-colon">{t("colon")}</span></span><strong>{currentName}</strong></span> <span aria-hidden="true">▾</span>
      </Button>
      <Popover className="ve-theme-popover" placement="bottom start" offset={4}>
        <Dialog className="ve-theme-dialog" aria-label={t("choose")}>
          <SearchField className="ve-theme-search" aria-label={t("search")} value={query} onChange={setQuery} autoFocus>
            <Input className="a-input" placeholder={t("searchPlaceholder")} data-testid="theme-picker-search" />
          </SearchField>
          <ListBox
            className="ve-theme-list"
            aria-label={t("list")}
            selectionMode="none"
            items={shown.map((th) => ({ ...th }))}
            onAction={(key) => { const th = themes.find((x) => x.id === key); if (th) void choose(th); }}
            renderEmptyState={() => <p className="a-taginput-empty">{t("none")}</p>}
          >
            {(th) => (
              <ListBoxItem id={th.id} textValue={th.name} className="ve-theme-item" data-current={th.id === currentId || undefined} data-testid={`theme-choice-${th.id}`}>
                <span className="ve-theme-check" aria-hidden="true">{th.id === currentId ? "✓" : ""}</span>
                <span className="ve-theme-name">
                  {th.name}
                  {th.kind === "mine" && th.version ? <span className="ve-theme-kind" data-testid="theme-choice-version">{t("version", { version: th.version })}</span> : null}
                  {th.kind === "old" ? <span className="ve-theme-kind">{t("old")}</span> : null}
                </span>
                {th.live && <span className="a-badge ve-theme-live">{t("live")}</span>}
              </ListBoxItem>
            )}
          </ListBox>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
