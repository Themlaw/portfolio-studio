#!/usr/bin/env node
/**
 * Après `next build` : copie le module natif du tracé vectoriel
 * (@neplex/vectorizer et son binaire de plateforme) dans le standalone.
 * Le processus enfant du kit (kit-child.cjs) le charge ; le traceur de Next ne
 * le voit pas (et un outputFileTracingIncludes « * » recopiait tout le projet).
 */
import { cpSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

const from = path.resolve("node_modules/@neplex");
const to = path.resolve(".next/standalone/node_modules/@neplex");
if (!existsSync(path.resolve(".next/standalone"))) throw new Error("standalone absent : lancer next build d’abord");
for (const name of readdirSync(from)) cpSync(path.join(from, name), path.join(to, name), { recursive: true, dereference: true });
console.log(`copy-kit-native : @neplex/{${readdirSync(to).join(",")}} → standalone`);
