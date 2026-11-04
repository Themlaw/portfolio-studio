/**
 * `next/cache` hors de Next (tests sur une vraie base) : `unstable_cache` exige le cache d'une requête et refuse de
 * tourner dans un script. Ici il appelle directement la fonction (chaque lecture relit la base) ; `revalidateTag` ne fait
 * rien. Branché par `registerHooks` en tête du test (voir scripts/test-special89.mjs).
 */
exports.unstable_cache = (fn) => fn;
exports.revalidateTag = () => {};
