/**
 * Lot 130 : détection des chaînes françaises en dur dans l'interface d'administration (JSX et littéraux de code).
 * Utilisé par scripts/test-adminlang130.mjs (garde) et pour mesurer ce qui reste à extraire.
 * Une chaîne est « française » si elle contient une lettre accentuée propre au français, ou deux mots dont un mot-outil
 * français, ou un mot isolé du vocabulaire d'interface. Les chaînes qui ressemblent à du code (identifiant, classe CSS, URL,
 * sélecteur, expression) sont ignorées. Exceptions justifiées : scripts/adminlang130.allow.json (fichier -> extraits).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

const ACCENT = /[àâçéèêëîïôûùüÿœÀÂÇÉÈÊËÎÏÔÛÙÜŸŒ]/;
const STOP = new Set(
  "le la les des du de un une et ou pour dans sur avec ce cette ces pas est sont ton ta tes votre vos mon ma mes au aux par que qui ne se sa son ses en il elle nous vous plus ici déjà aucun aucune chaque tout toute tous quand si ni mais donc or car comme sans sous entre vers chez".split(" "),
);
const VOCAB = new Set(
  "annuler enregistrer supprimer fermer retour ajouter modifier valider oui non pages projets médias réglages thèmes messages corbeille sauvegardes journal publier publié brouillon aperçu choisir envoyer renommer dupliquer déplacer restaurer télécharger importer exporter chargement erreur succès titre description légende suivant précédent rechercher filtrer trier ouvrir copier coller couper quitter connexion déconnexion identifiant courriel actualiser réessayer continuer terminer commencer appliquer réinitialiser effacer vider activer désactiver afficher masquer gauche droite haut bas centre couleur police taille épaisseur opacité marge image vidéo texte lien bouton titre nom langue français anglais aucun aucune tout toutes tous".split(" "),
);

/** Ressemble à du code ou à une donnée technique, pas à une phrase. */
function looksTechnical(s) {
  const t = s.trim();
  if (!t) return true;
  if (/^[\w./:#@?&=%+~$*^|()[\]{}<>!,;\\-]+$/.test(t) && !/\s/.test(t) && !VOCAB.has(t.toLowerCase())) return true;
  if (/^(https?:|\/|\.\/|@\/|#|--|\[|\.)/.test(t) && !/\s{1}[a-zà-ÿ]{3,}\s/i.test(t)) return true;
  return false;
}

export function isFrench(s, uiContext = true) {
  const t = s.replace(/\s+/g, " ").trim();
  if (!t || t.length < 2) return false;
  if (looksTechnical(t) && !ACCENT.test(t)) return false;
  if (ACCENT.test(t)) {
    // une lettre accentuée dans une chaîne de lettres/espaces/ponctuation : français (ou nom propre : à lister en exception)
    return /[a-zà-ÿœ]{2}/i.test(t);
  }
  const words = t.toLowerCase().split(/[^a-zà-ÿœ']+/).filter(Boolean).map((w) => w.replace(/^[ldjmtsn]'/, ""));
  // un mot isolé sans accent : français seulement s'il est affiché (JSX, attribut ou propriété de libellé), pas une valeur de code
  if (words.length === 1) return uiContext && VOCAB.has(words[0]);
  return words.some((w) => STOP.has(w)) && words.some((w) => w.length > 2 && !/^\d+$/.test(w)) && /[a-z]{3}/i.test(t) && frenchish(words);
}
// deux mots ou plus avec un mot-outil : « de » seul ou « a » ne suffisent pas pour de l'anglais ; on exige un mot-outil non ambigu.
const AMBIG = new Set(["a", "on", "or", "an", "me", "the", "en", "son", "ne", "ni", "si", "par", "plus", "pas", "sur", "ce", "est", "ma", "ta", "ton", "mon"]);
function frenchish(words) {
  return words.some((w) => STOP.has(w) && !AMBIG.has(w)) || words.filter((w) => STOP.has(w)).length >= 2 || words.some((w) => VOCAB.has(w));
}

export function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx?|mts)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/** Chaînes françaises d'un fichier : [{ line, text }]. */
export function scanFile(file, source = readFileSync(file, "utf8")) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found = [];
  const LABEL_PROPS = /^(label|title|text|placeholder|alt|message|hint|help|caption|tooltip|confirmLabel|desc|intro|heading|name|aria-label|description|empty|cta)$/;
  const uiCtx = (node) => {
    const p = node.parent;
    if (ts.isJsxText(node) || ts.isJsxExpression(p) || ts.isJsxAttribute(p)) return true;
    if (ts.isPropertyAssignment(p) && p.initializer === node) return LABEL_PROPS.test(p.name.getText().replace(/["']/g, ""));
    return false;
  };
  const add = (node, text) => {
    if (!isFrench(text, uiCtx(node))) return;
    found.push({ line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, text: text.replace(/\s+/g, " ").trim() });
  };
  const visit = (n) => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isTypeNode(n) || ts.isLiteralTypeNode(n)) return;
    if (ts.isJsxText(n)) add(n, n.text);
    else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      const p = n.parent;
      if (ts.isJsxAttribute(p) && /^(className|id|key|name|type|href|src|role|htmlFor|data-.*|value|style|rel|target|method|autoComplete|inputMode|pattern|accept|viewBox|d|fill|stroke|width|height|testId)$/.test(p.name.getText())) return;
      if (ts.isElementAccessExpression(p) || ts.isCaseClause(p) || ts.isModuleDeclaration(p)) return;
      add(n, n.text);
    } else if (ts.isTemplateExpression(n)) {
      const parts = [n.head.text, ...n.templateSpans.map((s) => s.literal.text)];
      add(n, parts.join(" ¤ ").replace(/ ¤ /g, " "));
    }
    ts.forEachChild(n, visit);
  };
  // console.log / warn / error (journal technique) et Error(...) ne sont pas de l'interface
  const skipCalls = (n) => {
    if (ts.isCallExpression(n)) {
      const e = n.expression.getText();
      if (/^console\.(log|warn|error|info|debug)$/.test(e)) return;
    }
    return undefined;
  };
  const visit2 = (n) => {
    if (skipCalls(n) === undefined && ts.isCallExpression(n) && /^console\./.test(n.expression.getText())) return;
    visit(n);
  };
  // Clé de traduction (premier argument de t(...), getAdminT(...), useTranslations(...)) ou valeur de code comparée : pas de l'interface.
  const isKeyArg = (n) => {
    const p = n.parent;
    if (ts.isBinaryExpression(p) && /^[!=]==?$/.test(p.operatorToken.getText())) return true;
    if (ts.isCallExpression(p) && p.arguments[0] === n) return /^(t[A-Za-z0-9]*|[\w.]*\.t|getAdminT|useTranslations|[\w]*\.(rich|raw|has|markup))$/.test(p.expression.getText());
    return false;
  };
  // visite récursive avec saut des console.*
  const rec = (n) => {
    if (ts.isCallExpression(n) && /^console\.(log|warn|error|info|debug)$/.test(n.expression.getText())) return;
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isTypeNode(n) || ts.isLiteralTypeNode(n)) return;
    if (ts.isJsxText(n)) add(n, n.text);
    else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      const p = n.parent;
      if (ts.isJsxAttribute(p) && /^(className|id|key|name|type|href|src|role|htmlFor|data-.*|value|style|rel|target|method|autoComplete|inputMode|pattern|accept|viewBox|d|fill|stroke|width|height|slot|variant|size|align|orientation|mode|position|kind|tone|as|color|textValue)$/.test(p.name.getText())) return;
      if (ts.isElementAccessExpression(p) || ts.isCaseClause(p) || ts.isModuleDeclaration(p) || ts.isImportTypeNode(p) || isKeyArg(n)) return;
      add(n, n.text);
    } else if (ts.isTemplateExpression(n)) {
      if (!isKeyArg(n)) add(n, [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(" "));
    }
    ts.forEachChild(n, rec);
  };
  void visit2;
  rec(sf);
  return found;
}
