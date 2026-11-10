"use client";

/**
 * Champ de tags : recherche et création dans un même champ.
 *
 * - À chaque frappe, la liste se restreint (match-sorter : exact, puis début,
 *   puis début de mot, puis contient ; sans accents ni casse ; à rang égal, les
 *   tags les plus utilisés d'abord).
 * - Mode « edit » : la première option est toujours « Créer « mot tapé » »,
 *   sans correction, sauf si un tag a exactement la même clé : il vient en tête.
 *   Mode « filter » : jamais de création.
 * - Tags choisis = pastilles (TagGroup) supprimables au clic ou au clavier ;
 *   Retour arrière sur le champ vide : focus sur la dernière pastille, puis
 *   Retour arrière la retire.
 * - Annonces aria-live (« 3 suggestions », « tag « perso » ajouté »).
 * Habillage : attributs data-* de React Aria et tokens --admin-* (admin.css).
 */
import { useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, ComboBox, Input, ListBox, ListBoxItem, Popover, Tag, TagGroup, TagList, type Key } from "react-aria-components";

import { cleanTagLabel, MAX_TAGS_PER_MEDIA, rankTags, tagKey, tagLabelProblem, type TagOption } from "@/lib/tag-key";

export type { TagOption };


type Item = { id: string; label: string; count: number; create?: boolean; selected: boolean };

const CREATE = "__create__";
const keyId = (label: string) => `t:${tagKey(label)}`;

export default function TagInput({
  label,
  value,
  onChange,
  options,
  mode = "edit",
  placeholder,
  help,
  hideLabel = false,
  max = MAX_TAGS_PER_MEDIA,
  disabled = false,
  size = "default",
}: {
  label: string;
  /** Libellés choisis. */
  value: string[];
  onChange: (next: string[]) => void;
  /** Tags connus (avec leur nombre d'usages). */
  options: TagOption[];
  mode?: "edit" | "filter";
  placeholder?: string;
  help?: string;
  hideLabel?: boolean;
  max?: number;
  disabled?: boolean;
  /** compact : 32 px de haut (cartes de l'Uploader). */
  size?: "default" | "compact";
}) {
  const t = useTranslations("fields");
  const [input, setInput] = useState("");
  const [announce, setAnnounce] = useState("");
  const [error, setError] = useState<string | null>(null);
  const tagsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const helpId = useId();

  const selectedKeys = useMemo(() => new Set(value.map(tagKey)), [value]);
  // Identité stable : React Aria resynchronise sa sélection à chaque nouveau tableau.
  const valueKeys = useMemo(() => value.map(keyId), [value]);
  const known = useMemo(() => {
    // Tags connus + tags choisis absents de la liste (créés dans ce champ).
    const map = new Map(options.map((o) => [tagKey(o.label), o]));
    for (const v of value) if (!map.has(tagKey(v))) map.set(tagKey(v), { label: v, count: 0 });
    return [...map.values()];
  }, [options, value]);

  const items: Item[] = useMemo(() => {
    const ranked = rankTags(known, input).map((o) => ({ id: keyId(o.label), label: o.label, count: o.count ?? 0, selected: selectedKeys.has(tagKey(o.label)) }));
    const typed = cleanTagLabel(input);
    if (mode !== "edit" || !typed) return ranked;
    // Un tag de même clé : en tête, pas de création.
    const exact = ranked.find((r) => tagKey(r.label) === tagKey(typed));
    if (exact) return [exact, ...ranked.filter((r) => r !== exact)];
    return [{ id: CREATE, label: typed, count: 0, create: true, selected: false }, ...ranked];
  }, [known, input, mode, selectedKeys]);

  // « N suggestions » annoncé après la frappe (sans bavarder à chaque touche).
  useEffect(() => {
    if (!input.trim()) return;
    const n = items.filter((i) => !i.create).length;
    const timer = setTimeout(() => setAnnounce(t("suggestions", { count: n })), 400);
    return () => clearTimeout(timer);
  }, [items, input, t]);

  const full = mode === "edit" && value.length >= max;

  const add = (labelToAdd: string) => {
    const clean = cleanTagLabel(labelToAdd);
    const problem = tagLabelProblem(clean);
    if (problem) return setError(problem);
    if (selectedKeys.has(tagKey(clean))) return;
    if (mode === "edit" && value.length >= max) return setError(t("tagsMaxPerFile", { max }));
    setError(null);
    onChange([...value, clean]);
    setAnnounce(t("tagAdded", { tag: clean }));
  };
  const remove = (key: string) => {
    const gone = value.find((v) => tagKey(v) === key);
    if (!gone) return;
    onChange(value.filter((v) => tagKey(v) !== key));
    setAnnounce(t("tagRemoved", { tag: gone }));
  };

  const onSelection = (keys: Key[]) => {
    const before = new Set(value.map(keyId));
    const now = new Set(keys.map(String));
    // Ajout : une seule clé nouvelle par sélection.
    for (const k of now) {
      if (before.has(k)) continue;
      if (k === CREATE) add(input);
      else add(items.find((i) => i.id === k)?.label ?? "");
    }
    // Option déjà choisie re-sélectionnée : retirée (comportement d'une liste à cocher).
    for (const k of before) if (!now.has(k)) remove(k.slice(2));
    setInput("");
  };

  const lastTag = () => tagsRef.current?.querySelector<HTMLElement>('[role="row"]:last-of-type');

  const boxRef = useRef<HTMLDivElement>(null);
  const labelId = useId();

  return (
    <div className="a-taginput" data-mode={mode} data-size={size} data-disabled={disabled || undefined}>
      <span id={labelId} className={hideLabel ? "sr-only" : "a-taginput-label"} onClick={() => inputRef.current?.focus()}>
        {label}
      </span>
      {/* Pastilles HORS du ComboBox (React Aria n'accepte pas une autre collection
          dans la sienne), dans la même boîte visuelle que le champ. */}
      <div ref={boxRef} className="a-taginput-box" data-disabled={disabled || undefined} data-full={full || undefined} onClick={(e) => e.target === e.currentTarget && inputRef.current?.focus()}>
        {value.length > 0 && (
          <TagGroup
            aria-label={mode === "filter" ? t("filterTags", { label }) : t("chosenTags", { label })}
            className="a-taginput-tags"
            onRemove={(keys) => {
              for (const k of keys) remove(String(k).slice(2));
              // Plus de pastille : retour au champ.
              setTimeout(() => {
                if (!tagsRef.current?.querySelector('[role="row"]')) inputRef.current?.focus();
              }, 0);
            }}
          >
            <TagList ref={tagsRef} className="a-taginput-list">
              {value.map((v) => (
                <Tag key={keyId(v)} id={keyId(v)} textValue={v} className="a-tagpill">
                  <span className="a-tag-label">{v}</span>
                  <Button slot="remove" className="a-tag-remove" aria-label={t("removeTag", { tag: v })}>
                    ✕
                  </Button>
                </Tag>
              ))}
            </TagList>
          </TagGroup>
        )}
        <ComboBox<Item, "multiple">
          className="a-taginput-combo"
          aria-labelledby={labelId}
          aria-describedby={help || full ? helpId : undefined}
          selectionMode="multiple"
          allowsCustomValue={mode === "edit"}
          allowsEmptyCollection
          menuTrigger="focus"
          items={items}
          value={valueKeys}
          onChange={onSelection}
          inputValue={input}
          onInputChange={(v) => {
            setInput(v);
            setError(null);
          }}
          // Au plafond, le champ reste actif (une liste ouverte sur un champ désactivé
          // resterait bloquée) : l'ajout est refusé avec un message.
          isDisabled={disabled}
        >
          <Input
            ref={inputRef}
            className="a-taginput-input"
            placeholder={full ? "" : (placeholder ?? (mode === "filter" ? t("filterPlaceholder") : t("addPlaceholder")))}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !input && value.length) {
                e.preventDefault();
                lastTag()?.focus();
              }
              // Entrée sans option active : crée le tag tapé (mode edit).
              if (e.key === "Enter" && mode === "edit" && cleanTagLabel(input) && !e.currentTarget.getAttribute("aria-activedescendant")) {
                e.preventDefault();
                add(input);
                setInput("");
              }
            }}
          />
          <Popover className="a-taginput-popover" placement="bottom start" offset={4} triggerRef={boxRef}>
            <ListBox<Item> className="a-taginput-listbox" renderEmptyState={() => <p className="a-taginput-empty">{mode === "filter" ? t("noTagMatch") : t("noTagYet")}</p>}>
              {(item) => (
                <ListBoxItem id={item.id} textValue={item.create ? t("createTagText", { tag: item.label }) : item.label} className="a-taginput-option" data-create={item.create || undefined}>
                  {item.create ? (
                    <>
                      <span className="a-taginput-create">{t("create")}</span> « {item.label} »
                    </>
                  ) : (
                    <>
                      <span className="a-taginput-check" aria-hidden="true">
                        {item.selected ? "✓" : ""}
                      </span>
                      <span className="a-taginput-option-label">{item.label}</span>
                      {item.count > 0 && <span className="a-taginput-count">{item.count}</span>}
                    </>
                  )}
                </ListBoxItem>
              )}
            </ListBox>
          </Popover>
        </ComboBox>
      </div>
      {(help || full) && (
        <p id={helpId} className="a-help">
          {full ? t("tagsMax", { max }) : help}
        </p>
      )}
      {error && (
        <p className="a-field-error" role="alert">
          {error}
        </p>
      )}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {announce}
      </span>
    </div>
  );
}
