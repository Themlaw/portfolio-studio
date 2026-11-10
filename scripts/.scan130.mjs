import path from "node:path";
import { scanFile, walk } from "/home/user/pf/wt-m130/scripts/lib/i18n-scan.mjs";
const R="/home/user/pf/wt-m130/";
const dirs=process.argv.slice(2);
let tot=0;
for (const d of dirs) for (const f of walk(R+d)) { const h=scanFile(f); if(h.length){tot+=h.length; console.log(h.length, path.relative(R,f));} }
console.log("TOTAL",tot);
