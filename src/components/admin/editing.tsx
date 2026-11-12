"use client";

/**
 * Briques communes des écrans d'édition : toasts « Enregistré » (aria-live),
 * état enregistré / non enregistré avec bouton « Enregistrer », garde de
 * sortie de page, boîte de confirmation nommant l'objet.
 */
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

/* ---- Toasts ------------------------------------------------------------- */

type ToastAction = { label: string; run: () => void; /** Libellé traduit au rendu (undoToast). */ undo?: boolean };
type Toast = { id: number; message: string; /** Nom de l'objet supprimé : message « Supprimé · « Nom » » composé au rendu, dans la langue courante. */ undoName?: string; tone: "success" | "error"; count: number; action?: ToastAction; ms?: number };
let toasts: Toast[] = [];
let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
/** Durée d'affichage ; au plus trois toasts à la fois. */
const TOAST_MS = 3000;
const MAX_TOASTS = 3;

function schedule(id: number) {
  clearTimeout(timers.get(id));
  const t = toasts.find((x) => x.id === id);
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      toasts = toasts.filter((x) => x.id !== id);
      emit();
    }, t?.ms ?? (t?.action ? TOAST_MS * 2 : TOAST_MS)),
  );
}

/**
 * Un message identique déjà affiché est fusionné (compteur ×N) et prolongé.
 * `action` : un bouton (ex. « Annuler ») ; le toast reste alors plus longtemps. `ms` : durée choisie.
 */
export function toast(message: string, tone: Toast["tone"] = "success", action?: ToastAction, ms?: number, undoName?: string) {
  const same = action ? undefined : toasts.find((t) => t.message === message && t.tone === tone && !t.action);
  if (same) {
    toasts = toasts.map((t) => (t === same ? { ...t, count: t.count + 1 } : t));
    schedule(same.id);
  } else {
    const id = nextId++;
    toasts = [...toasts, { id, message, tone, count: 1, action, ms, undoName }];
    while (toasts.length > MAX_TOASTS) {
      clearTimeout(timers.get(toasts[0].id));
      toasts = toasts.slice(1);
    }
    schedule(id);
  }
  emit();
}

/** Durée du toast « Supprimé · Annuler » (lot 23). */
export const UNDO_MS = 10_000;

/**
 * Après une suppression (mise à la corbeille) : « Supprimé · « Nom » » et un bouton « Annuler » qui restaure,
 * affichés 10 s. `undo` est appelée au clic.
 */
export function undoToast(name: string, undo: () => void) {
  // Le texte (« Supprimé · « Nom » », « Annuler ») est composé par le Toaster dans la langue de l'interface.
  toast(`undo:${name}`, "success", { label: "", run: undo, undo: true }, UNDO_MS, name);
}

const EMPTY: Toast[] = [];

export function Toaster() {
  const t = useTranslations("common");
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
    () => EMPTY,
  );
  return (
    <div className="a-toasts" role="status" aria-live="polite">
      {list.map((it) => (
        <div key={it.id} className={`a-toast a-toast-${it.tone}`}>
          {it.tone === "success" && <span aria-hidden="true">✓ </span>}
          {it.undoName !== undefined ? t("deleted", { name: it.undoName }) : it.message}
          {it.count > 1 && <span className="a-toast-count"> ×{it.count}</span>}
          {it.action && (
            <button
              type="button"
              className="a-toast-action"
              onClick={() => {
                it.action?.run();
                toasts = toasts.filter((x) => x.id !== it.id);
                emit();
              }}
            >
              {it.action.undo ? t("cancel") : it.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---- Modifications non enregistrées ------------------------------------ */

/**
 * Avertit avant de quitter la page (fermeture, rechargement, lien interne de
 * l'admin) tant que `dirty` est vrai.
 */
export function useUnsavedGuard(dirty: boolean, stillUnsaved?: () => boolean) {
  const leaveMessage = useTranslations("common")("unsavedLeave");
  // Relu au moment de quitter : l'indicateur peut être en retard d'un rendu
  // (enregistrement déjà fait) ; seul l'état réel décide.
  const still = useRef(stillUnsaved);
  useEffect(() => {
    still.current = stillUnsaved;
  });
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (still.current && !still.current()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey) return;
      if (still.current && !still.current()) return;
      if (!window.confirm(leaveMessage)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, leaveMessage]);
}

/** Barre d'état + « Enregistrer », collée en bas de l'écran d'édition. */
export function SaveBar({
  dirty,
  saving,
  onSave,
  error,
  note,
  label,
  testId,
  className,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  error?: string | null;
  note?: React.ReactNode;
  label?: string;
  testId?: string;
  /** Classe en plus (ex. l'en-tête collant de l'éditeur de thème, lot 61). */
  className?: string;
}) {
  const t = useTranslations("common");
  return (
    <div className={`a-savebar${className ? ` ${className}` : ""}`} data-dirty={dirty}>
      <p className="a-save-state" aria-live="polite">
        {saving ? (
          t("saving")
        ) : error ? (
          <span className="a-danger-text">{error}</span>
        ) : dirty ? (
          <>
            <span className="a-dot" aria-hidden="true" /> {t("unsaved")}
          </>
        ) : (
          <>
            <span aria-hidden="true">✓</span> {t("saved")}
          </>
        )}
        {note && <span className="a-save-note">{note}</span>}
      </p>
      <button type="button" className="a-btn a-btn-primary" onClick={onSave} disabled={saving || !dirty} data-testid={testId}>
        {saving ? t("saving") : (label ?? t("save"))}
      </button>
    </div>
  );
}

/* ---- Confirmation ------------------------------------------------------ */

/**
 * Boîte de confirmation (dialog natif, modal : focus piégé, Échap ferme).
 * `open` pilote l'affichage ; le titre nomme toujours l'objet.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onClose,
  extra,
  confirmDisabled = false,
}: {
  open: boolean;
  title: string;
  children?: React.ReactNode;
  /** Absent : pas de bouton de confirmation, « Fermer » seul (sélecteur où un clic choisit). */
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm?: () => void;
  onClose: () => void;
  extra?: React.ReactNode;
  confirmDisabled?: boolean;
}) {
  const t = useTranslations("common");
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const close = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);
  return (
    <dialog
      ref={ref}
      className="a-dialog"
      aria-labelledby="a-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      {open && (
        <>
          <h2 id="a-dialog-title">{title}</h2>
          {children && <div className="a-dialog-body">{children}</div>}
          <div className="a-dialog-actions">
            {extra}
            <button type="button" className="a-btn" onClick={close} disabled={busy}>
              {confirmLabel === undefined ? t("close") : t("cancel")}
            </button>
            {confirmLabel !== undefined && (
              <button
                type="button"
                className={`a-btn ${danger ? "a-btn-danger" : "a-btn-primary"}`}
                onClick={onConfirm}
                disabled={busy || confirmDisabled}
              >
                {busy ? t("pleaseWait") : confirmLabel}
              </button>
            )}
          </div>
        </>
      )}
    </dialog>
  );
}

/** Copie profonde JSON (état d'édition), et comparaison. */
export const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
