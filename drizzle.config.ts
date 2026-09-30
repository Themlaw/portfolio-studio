import { defineConfig } from "drizzle-kit";

// Génération des migrations : npx drizzle-kit generate --name <nom>
// Elles sont commitées dans ./drizzle et appliquées au démarrage du serveur
// (src/instrumentation.ts → src/lib/db/bootstrap.ts).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
});
