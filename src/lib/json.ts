/** Analyse JSON tolérante : `undefined` si le texte est absent ou corrompu. */
export function parseJson(text: string | null | undefined): unknown {
  if (text === null || text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
