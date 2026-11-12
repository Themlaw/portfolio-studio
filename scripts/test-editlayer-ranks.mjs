#!/usr/bin/env node
/**
 * Vérifie que {boards} et {site} ont le même rang (position parmi les enfants
 * de premier niveau du fragment retourné) dans les deux retours d'EditLayer :
 * hors édition (celui qui contient `{null}`) et en édition (le dernier `return (`
 * du composant). Un décalage démonte/remonte BoardLayer et lui fait perdre son état.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const file = path.join(process.cwd(), "src/components/EditLayer.tsx");
const src = readFileSync(file, "utf8");

/** Extrait les enfants de premier niveau d'un fragment <>...</> à partir d'une position. */
function fragmentChildren(source, fromIndex) {
  const open = source.indexOf("<>", fromIndex);
  const close = source.indexOf("</>", open);
  if (open === -1 || close === -1) throw new Error("fragment introuvable");
  const body = source.slice(open + 2, close);
  const children = [];
  let i = 0;
  while (i < body.length) {
    const rest = body.slice(i);
    const ws = rest.match(/^\s+/);
    if (ws) { i += ws[0].length; continue; }
    if (body.startsWith("{", i)) {
      let depth = 0;
      let j = i;
      for (; j < body.length; j++) {
        if (body[j] === "{") depth++;
        else if (body[j] === "}") { depth--; if (depth === 0) { j++; break; } }
      }
      children.push(body.slice(i, j).trim());
      i = j;
    } else if (body.startsWith("<", i)) {
      // balise auto-fermante ou ouvrante ; on prend jusqu'à la fermeture correspondante au niveau 0
      if (body.startsWith("</", i)) throw new Error("balise fermante inattendue au premier niveau");
      let depth = 0;
      let j = i;
      let inTag = false;
      while (j < body.length) {
        const ch = body[j];
        if (ch === "<") {
          if (body.startsWith("</", j)) {
            depth--;
            j = body.indexOf(">", j) + 1;
            if (depth === 0) break;
            continue;
          } else {
            // ouvre une balise : on verra si elle se ferme en />
            inTag = true;
            depth++;
            j++;
            continue;
          }
        }
        if (inTag) {
          if (body.startsWith("/>", j)) { depth--; j += 2; inTag = false; if (depth === 0) break; continue; }
          if (ch === ">") { inTag = false; j++; continue; }
          j++; continue;
        }
        j++;
      }
      children.push(body.slice(i, j).trim());
      i = j;
    } else {
      // texte/expr inattendu, avance
      i++;
    }
  }
  return children.filter(Boolean);
}

const nullIdx = src.indexOf("{null}");
if (nullIdx === -1) throw new Error("retour hors édition ({null}) introuvable");
const viewChildren = fragmentChildren(src, src.lastIndexOf("<>", nullIdx));

const lastReturn = src.lastIndexOf("return (");
if (lastReturn === -1) throw new Error("dernier return introuvable");
const editChildren = fragmentChildren(src, src.indexOf("<>", lastReturn));

function rank(children, token) {
  const i = children.indexOf(token);
  if (i === -1) throw new Error(`token ${token} absent: ${JSON.stringify(children)}`);
  return i;
}

const checks = ["{boards}", "{site}"];
let ok = true;
for (const token of checks) {
  const rv = rank(viewChildren, token);
  const re = rank(editChildren, token);
  if (rv !== re) {
    console.error(`FAIL ${token}: rang ${rv} hors édition vs ${re} en édition`);
    console.error("  hors édition:", viewChildren);
    console.error("  en édition  :", editChildren);
    ok = false;
  } else {
    console.log(`OK ${token}: rang ${rv} dans les deux retours`);
  }
}

if (!ok) process.exit(1);
console.log("Tout est bon.");