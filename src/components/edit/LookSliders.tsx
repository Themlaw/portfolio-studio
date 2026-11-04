"use client";

/** Les trois curseurs aimantés du lot 108, partagés par la barre du bloc (QuickMenus) et le panneau « Mise en page » (LookPanel). */
import { SPACE_LABELS, SPACE_MAX, SPACE_REF, SPACES, SIDE_MAX, SIDE_SPACES, WIDTH_MIN, WIDTH_REF, BLOCK_WIDTH_LABELS, BLOCK_WIDTHS, type BlockWidthVal, type SideSpace, type Space, type SpaceVal } from "@/lib/look";

import SnapSlider, { type SnapStop } from "./SnapSlider";

const SPACE_STOPS: readonly SnapStop<SpaceVal>[] = SPACES.map((k: Space) => ({ at: SPACE_REF[k], label: SPACE_LABELS[k], short: k === "none" ? "0" : SPACE_LABELS[k], key: k, value: k }));
const SIDE_STOPS: readonly SnapStop<SideSpace | number>[] = SIDE_SPACES.map((k) => ({ at: SPACE_REF[k], label: SPACE_LABELS[k], key: k, value: k }));
const WIDTH_STOPS: readonly SnapStop<BlockWidthVal>[] = BLOCK_WIDTHS.map((k) => ({ at: WIDTH_REF[k], label: BLOCK_WIDTH_LABELS[k], key: k, value: k }));

/** Espacement ou marge (haut / bas) : 0 à 240 px, crans Aucun / S / M / L / XL. `kind` donne le jeu de data-* des tests. */
export function SpaceSlider({ label, testId, value, onChange, attr, prefix }: { label: string; testId: string; attr?: string; prefix?: string; value: SpaceVal | undefined; onChange: (v: SpaceVal | undefined) => void }) {
  return <SnapSlider<SpaceVal> label={label} testId={testId} min={0} max={SPACE_MAX} unit="px" stops={SPACE_STOPS} value={value} snap={4} attr={attr} prefix={prefix} onCommit={onChange} />;
}
export function SidesSlider({ label, testId, value, onChange, attr }: { label: string; testId: string; attr?: string; value: SideSpace | number | undefined; onChange: (v: SideSpace | number | undefined) => void }) {
  return <SnapSlider<SideSpace | number> label={label} testId={testId} min={0} max={SIDE_MAX} unit="px" stops={SIDE_STOPS} value={value} snap={4} attr={attr} onCommit={onChange} />;
}
export function WidthSlider({ label, testId, value, onChange, attr }: { label: string; testId: string; attr?: string; value: BlockWidthVal | undefined; onChange: (v: BlockWidthVal | undefined) => void }) {
  return <SnapSlider<BlockWidthVal> label={label} testId={testId} min={WIDTH_MIN} max={100} unit="%" stops={WIDTH_STOPS} value={value} autoLabel="Pleine" autoAt={100} maxIsAuto snap={2} attr={attr} autoKey="full" onCommit={onChange} />;
}
