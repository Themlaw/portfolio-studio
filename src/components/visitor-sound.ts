"use client";

/**
 * Son des vidéos : la règle du navigateur et le choix du visiteur (lot 127).
 *
 * - Le réglage de l'artiste (« Son au départ » : activé / coupé, activé par défaut) dit ce que la vidéo fait SANS autre information.
 * - Le choix du visiteur (bouton son, une fois par visite, pour toutes les vidéos de la page) PRIME sur le réglage.
 * - Les navigateurs refusent de lancer une lecture AVEC son avant un geste du visiteur (clic, toucher, touche ; le défilement ne compte
 *   pas) : `startPlayback` tente le son, retombe sur une lecture muette si le navigateur refuse, puis `unmuteOnGesture` remet le son au
 *   premier geste.
 */

let choice: boolean | null = null;
const listeners = new Set<() => void>();

/** Le visiteur a choisi (bouton son) : `true` = avec son. Les boutons son de la page se mettent à jour. */
export function setVisitorSound(on: boolean): void {
  choice = on;
  for (const fn of listeners) fn();
}
/** Oublie le choix du visiteur (tests). */
export function resetVisitorSound(): void {
  choice = null;
  for (const fn of listeners) fn();
}
/** Le son est-il voulu pour une vidéo dont le réglage de l'artiste est `setting` (vrai = activé) ? Le visiteur prime. */
export function wantsSound(setting: boolean): boolean {
  return choice ?? setting;
}
/** Choix du visiteur : `null` tant qu'il n'a pas touché au son. */
export function visitorSound(): boolean | null {
  return choice;
}
/** Prévient quand le visiteur change de choix (icônes des boutons son). */
export function subscribeVisitorSound(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Une vidéo (avec ses réglages de l'emplacement) doit-elle démarrer muette ? Une vidéo sans son : sans objet (non). */
export function startsMuted(video: { hasAudio: boolean; soundOff?: boolean }): boolean {
  return video.hasAudio ? !wantsSound(!video.soundOff) : false;
}

const isDenied = (e: unknown) => e instanceof DOMException && e.name === "NotAllowedError";

/** Commandes du son : un geste dessus est le choix du visiteur, pas un « premier geste » qui remet le son tout seul. */
const SOUND_CONTROLS = ".vid-sound, [data-vp='mute'], [data-vp='volume']";

/** Premier geste du visiteur après un repli muet : remet le son si la vidéo joue encore et si le son est toujours voulu. */
export function unmuteOnGesture(el: HTMLVideoElement, stillWanted: () => boolean): () => void {
  const events = ["pointerdown", "keydown", "touchend"] as const;
  const off = () => {
    for (const name of events) document.removeEventListener(name, onGesture, true);
  };
  const onGesture = (event: Event) => {
    off();
    if (event.target instanceof Element && event.target.closest(SOUND_CONTROLS)) return;
    if (!el.paused && el.muted && stillWanted()) el.muted = false;
  };
  for (const name of events) document.addEventListener(name, onGesture, true);
  return off;
}

/**
 * Lance la lecture. `withSound` : tente le son ; si le navigateur refuse, joue MUET et rend `"muted"` (appeler `unmuteOnGesture`).
 * `"blocked"` : même muette, la lecture est refusée. `"aborted"` : interrompue (pause pendant le démarrage), sans conséquence.
 */
export async function startPlayback(el: HTMLVideoElement, withSound: boolean): Promise<"sound" | "muted" | "blocked" | "aborted"> {
  el.muted = !withSound;
  try {
    await el.play();
    return withSound ? "sound" : "muted";
  } catch (e) {
    if (!isDenied(e)) return "aborted";
    if (!withSound) return "blocked";
  }
  el.muted = true;
  try {
    await el.play();
    return "muted";
  } catch (e) {
    return isDenied(e) ? "blocked" : "aborted";
  }
}
