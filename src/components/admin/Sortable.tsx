"use client";

/**
 * Liste réordonnable (dnd-kit) : poignée visible, clavier (Espace pour saisir,
 * flèches pour déplacer, Espace pour poser, Échap pour annuler), annonces
 * aria-live en français. Aucune mise en page ne saute : l'élément déplacé
 * garde sa place pendant le glisser (transform seulement).
 */
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToHorizontalAxis, restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  horizontalListSortingStrategy,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslations } from "next-intl";
import { createContext, useContext, useId } from "react";

type HandleProps = ReturnType<typeof useSortable>["listeners"] & ReturnType<typeof useSortable>["attributes"];
const HandleContext = createContext<{ props: HandleProps | undefined; label: string }>({ props: undefined, label: "" });

export function DragHandle() {
  const { props, label } = useContext(HandleContext);
  const t = useTranslations("sortable");
  return (
    <button type="button" className="a-handle" aria-label={t("move", { label })} {...props}>
      <svg width="12" height="18" viewBox="0 0 12 18" aria-hidden="true">
        {[3, 9, 15].flatMap((y) => [3, 9].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" fill="currentColor" />))}
      </svg>
    </button>
  );
}

function Item({ id, label, children, style: extra }: { id: string; label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  const { setNodeRef, transform, transition, isDragging, listeners, attributes } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      className="a-sortable-item"
      data-dragging={isDragging || undefined}
      style={{ ...extra, transform: CSS.Translate.toString(transform), transition }}
    >
      <HandleContext.Provider value={{ props: { ...attributes, ...listeners } as HandleProps, label }}>{children}</HandleContext.Provider>
    </li>
  );
}

export function SortableList<T>({
  items,
  getId,
  getLabel,
  onReorder,
  render,
  className = "a-sortable",
  layout = "vertical",
  itemStyle,
  after,
}: {
  items: T[];
  getId: (item: T) => string;
  getLabel: (item: T) => string;
  onReorder: (next: T[]) => void;
  render: (item: T, index: number) => React.ReactNode;
  className?: string;
  /** vertical (liste), horizontal (bande), grid (cartes). */
  layout?: "vertical" | "horizontal" | "grid";
  itemStyle?: (item: T) => React.CSSProperties | undefined;
  /** Éléments non déplaçables affichés après la liste (envois en cours…). */
  after?: React.ReactNode;
}) {
  // Identifiant stable : sans lui, dnd-kit génère des id d'accessibilité
  // différents au rendu serveur et au client (écart d'hydratation).
  const t = useTranslations("sortable");
  const dndId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = items.map(getId);
  const labelOf = (id: string | number) => {
    const item = items.find((i) => getId(i) === String(id));
    return item ? t("quoted", { label: getLabel(item) }) : t("theItem");
  };
  const pos = (id: string | number | undefined) => (id === undefined ? 0 : ids.indexOf(String(id)) + 1);
  const announcements: Announcements = {
    onDragStart: ({ active }) => t("picked", { label: labelOf(active.id), position: pos(active.id), total: ids.length }),
    onDragOver: ({ active, over }) => (over ? t("over", { label: labelOf(active.id), position: pos(over.id), total: ids.length }) : t("outside", { label: labelOf(active.id) })),
    onDragEnd: ({ active, over }) => (over ? t("dropped", { label: labelOf(active.id), position: pos(over.id), total: ids.length }) : t("putBack", { label: labelOf(active.id) })),
    onDragCancel: ({ active }) => t("cancelled", { label: labelOf(active.id) }),
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    onReorder(arrayMove(items, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  };
  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={
        layout === "vertical"
          ? [restrictToVerticalAxis, restrictToParentElement]
          : layout === "horizontal"
            ? [restrictToHorizontalAxis]
            : [restrictToParentElement]
      }
      onDragEnd={onDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: t("instructions"),
        },
      }}
    >
      <SortableItems items={items} getId={getId} getLabel={getLabel} render={render} className={className} layout={layout} itemStyle={itemStyle} after={after} />
    </DndContext>
  );
}

/**
 * Éléments réordonnables seuls, dans un DndContext fourni par l'appelant
 * (planche : la bande et le bandeau Bibliothèque partagent le même contexte).
 */
export function SortableItems<T>({
  items,
  getId,
  getLabel,
  render,
  className = "a-sortable",
  layout = "vertical",
  itemStyle,
  after,
}: {
  items: T[];
  getId: (item: T) => string;
  getLabel: (item: T) => string;
  render: (item: T, index: number) => React.ReactNode;
  className?: string;
  layout?: "vertical" | "horizontal" | "grid";
  itemStyle?: (item: T) => React.CSSProperties | undefined;
  after?: React.ReactNode;
}) {
  return (
    <SortableContext
      items={items.map(getId)}
      strategy={layout === "vertical" ? verticalListSortingStrategy : layout === "horizontal" ? horizontalListSortingStrategy : rectSortingStrategy}
    >
      <ol className={className}>
        {items.map((item, i) => (
          <Item key={getId(item)} id={getId(item)} label={getLabel(item)} style={itemStyle?.(item)}>
            {render(item, i)}
          </Item>
        ))}
        {after}
      </ol>
    </SortableContext>
  );
}
