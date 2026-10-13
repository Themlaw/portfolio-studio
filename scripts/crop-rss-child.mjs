// Enfant de mesure (test-crop.mjs) : un recadrage d'un JPEG de 100 Mpx, puis la mémoire résidente maximale (Mo).
// Usage : node --import tsx scripts/crop-rss-child.mjs <DATA_DIR> <clé de l'original> <id>
const [dir, key, id] = process.argv.slice(2);
process.env.DATA_DIR = dir;
process.env.BETTER_AUTH_SECRET = "test-secret-0123456789abcdef-0123456789abcdef";
const crop = await import("../src/lib/images/crop.ts");
const cache = await import("../src/lib/images/crop-cache.ts");
const out = await cache.ensureCrop({ id: Number(id), key, width: key.includes("big6") ? 10000 : 10000, height: 10000 }, crop.toUnits({ x: 0.1, y: 0.1, w: 0.3, h: 0.3 }), 960, "webp");
console.log("OUT", out.size);
console.log("MAXRSS", Math.round(process.resourceUsage().maxRSS / 1024));
