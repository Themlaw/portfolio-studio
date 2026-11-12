"use client";

/** Historique des versions de Mon thème (lot 60) : vignette réelle, date, résumé, [Prévisualiser] [Revenir à cette version] [Garder une copie à part]. */
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { keepVersionCopyAction, pinVersionAction, revertVersionAction } from "@/app/admin/(espace)/themes/actions";
import type { VersionInfo } from "@/lib/themes/versions";
import type { Theme } from "@/themes/schema";

import { PreviewButton } from "./ThemeList";
import LiveThumb from "./LiveThumb";
import { ConfirmDialog, toast } from "./editing";
import { formatWhen } from "./theme-format";

type Mine = { id: string; name: string; version: number; publishedVersion: number | null; live: boolean };

export default function ThemeVersions({ mine, versions, themes = {} }: { mine: Mine; versions: VersionInfo[]; /** Maquette de chaque version (numéro → thème) : fond provisoire de la vignette. */ themes?: Record<number, Theme> }) {
  const router = useRouter();
  const t = useTranslations("themeVersions");
  const locale = useLocale();
  const [busy, startTransition] = useTransition();
  const [asking, setAsking] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const differs = mine.publishedVersion != null && mine.publishedVersion !== mine.version;
  const state = mine.live
    ? differs
      ? t("stateLiveDraft", { published: mine.publishedVersion ?? "", version: mine.version })
      : t("stateLive", { published: mine.publishedVersion ?? "" })
    : mine.publishedVersion != null
      ? t("stateOffline", { published: mine.publishedVersion, version: mine.version })
      : t("stateNever", { version: mine.version });

  const revert = (n: number, publish: boolean) =>
    startTransition(async () => {
      setError(null);
      const result = await revertVersionAction(mine.id, n, publish);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setAsking(null);
      toast(t(publish ? "revertedLive" : "revertedDraft", { n, version: result.data.version }));
      router.refresh();
    });
  const keep = (n: number) =>
    startTransition(async () => {
      const result = await keepVersionCopyAction(mine.id, n);
      if (!result.ok) return toast(result.message, "error");
      toast(t("copyKept", { name: result.data.name }));
      router.refresh();
    });
  const pin = (n: number, pinned: boolean) =>
    startTransition(async () => {
      const result = await pinVersionAction(mine.id, n, pinned);
      if (!result.ok) return toast(result.message, "error");
      toast(t(pinned ? "pinned" : "unpinned", { n }));
      router.refresh();
    });

  return (
    <>
      <p className="a-mine-state" data-testid="versions-state">
        {state}
      </p>
      <ol className="a-versions" data-testid="versions-list">
        {versions.map((v) => (
          <li key={v.n} className="a-card a-version" data-version={v.n} data-current={v.current || undefined} data-published={v.published || undefined}>
            <LiveThumb themeRef={`${mine.id}@${v.n}`} stamp={v.createdAt} theme={themes[v.n]} />
            <div className="a-version-body">
              <div className="a-card-head">
                <h3>{t("version", { n: v.n })}</h3>
                <span className="a-version-badges">
                  {v.published && (mine.live ? <span className="a-badge a-badge-live">● {t("live")}</span> : <span className="a-badge">{t("lastPublished")}</span>)}
                  {v.current && <span className="a-badge" data-testid="version-current">{t("current")}</span>}
                  {v.pinned && <span className="a-tag" title={t("pinnedTitle")}>★ {t("pinnedTag")}</span>}
                </span>
              </div>
              <p className="a-mine-meta">{formatWhen(v.createdAt, locale)}</p>
              <p className="a-version-summary" data-testid="version-summary">
                {v.summary}
              </p>
              <div className="a-card-actions">
                <PreviewButton id={`${mine.id}@${v.n}`} small testId="version-preview" />
                {!v.current && (
                  <button
                    type="button"
                    className="a-btn a-btn-small"
                    disabled={busy}
                    onClick={() => (mine.live ? (setError(null), setAsking(v.n)) : revert(v.n, false))}
                    data-testid="version-revert"
                  >
                    {t("revert")}
                  </button>
                )}
                <button type="button" className="a-btn a-btn-small" disabled={busy} onClick={() => keep(v.n)} data-testid="version-copy">
                  {t("keepCopy")}
                </button>
                <button type="button" className="a-btn a-btn-small a-btn-quiet" disabled={busy} onClick={() => pin(v.n, !v.pinned)} data-testid="version-pin" aria-pressed={v.pinned}>
                  {v.pinned ? t("unpin") : t("pin")}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <ConfirmDialog
        open={asking !== null}
        title={t("askTitle", { n: asking ?? "" })}
        confirmLabel={t("revertNoPublish")}
        busy={busy}
        onClose={() => {
          setAsking(null);
          setError(null);
        }}
        onConfirm={() => asking !== null && revert(asking, false)}
        extra={
          asking !== null && (
            <button type="button" className="a-btn a-btn-primary" disabled={busy} onClick={() => revert(asking, true)} data-testid="revert-publish">
              {t("revertPublish")}
            </button>
          )
        }
      >
        <p>
          {t("askBody", { published: mine.publishedVersion ?? "", n: asking ?? "" })}
        </p>
        <p className="muted">{t("askHelp")}</p>
        {error && <p className="a-alert">{error}</p>}
      </ConfirmDialog>
      {error && asking === null && <p className="a-alert">{error}</p>}
    </>
  );
}
