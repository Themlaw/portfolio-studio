/**
 * ag-psd sous Node sans node-canvas : les pixels sont des tableaux RGBA
 * (`useImageData`) ; on fournit seulement la fabrique d'ImageData. Toute
 * opération qui exigerait un vrai canvas (miniature JPEG, rendu de texte)
 * échoue explicitement.
 */
import { initializeCanvas } from "ag-psd";

let ready = false;

export function ensureAgPsd(): void {
  if (ready) return;
  initializeCanvas(
    () => {
      throw new Error("ag-psd : canvas indisponible côté serveur (useImageData seulement).");
    },
    (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4), colorSpace: "srgb" }) as unknown as ImageData,
  );
  ready = true;
}
