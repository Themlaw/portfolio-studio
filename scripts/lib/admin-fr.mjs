/**
 * Lot 130 : traducteur FRANÇAIS de l'admin pour les tests Node (les modules purs prennent un traducteur `t` ; l'interface par défaut est en français).
 * `node scripts/admin-messages.mjs` doit avoir assemblé messages/admin.fr.json (fait par npm test via la garde adminlang130).
 */
import { readFileSync } from "node:fs";

import { makeAdminTranslator } from "../../src/i18n/admin-lang.ts";

const messages = JSON.parse(readFileSync(new URL("../../messages/admin.fr.json", import.meta.url), "utf8"));
/** `frT("blockHelp")` -> t("starterText") === "Texte". */
export const frT = (namespace) => makeAdminTranslator("fr", messages, namespace);
