/**
 * Signal « publié » entre les onglets du même navigateur (lot 118). L'éditeur l'envoie après chaque publication ; les pages du site
 * ouvertes dans un autre onglet par l'artiste (aperçu, site) se rafraîchissent : le cache du routeur de Next (navigation interne,
 * `staleTimes`) ne peut plus montrer l'état d'avant la publication. Code client uniquement.
 */
const NAME = "portfolio-publish";

export function announcePublished(): void {
  try {
    const channel = new BroadcastChannel(NAME);
    channel.postMessage({ at: Date.now() });
    channel.close();
  } catch {
    // navigateur sans BroadcastChannel : le repli ci-dessous suffit
  }
  try {
    localStorage.setItem(NAME, String(Date.now()));
  } catch {
    // stockage indisponible (navigation privée) : tant pis, le rechargement manuel reste possible
  }
}

/** Écoute le signal ; renvoie la fonction qui arrête l'écoute. */
export function onPublished(callback: () => void): () => void {
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(NAME);
    channel.onmessage = () => callback();
  } catch {
    channel = null;
  }
  const onStorage = (e: StorageEvent) => {
    if (e.key === NAME) callback();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    channel?.close();
    window.removeEventListener("storage", onStorage);
  };
}
