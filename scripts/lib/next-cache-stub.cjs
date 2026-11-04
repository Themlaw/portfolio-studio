/**
 * `next/cache` hors de Next (tests sur une vraie base) : `unstable_cache` exige le cache d'une requête et refuse de
 * tourner dans un script. Ici il appelle directement la fonction (chaque lecture relit la base) et note la clé et les
 * étiquettes demandées dans `globalThis.__nextCacheCalls` ; `revalidateTag` ne fait rien. Branché par `registerHooks`
 * en tête du test (voir scripts/test-special89.mjs).
 */
exports.unstable_cache = (fn, key, options) => {
  (globalThis.__nextCacheCalls ??= []).push({ key, tags: options?.tags ?? [] });
  return fn;
};
exports.revalidateTag = () => {};
