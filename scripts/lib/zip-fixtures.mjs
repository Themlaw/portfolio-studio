/**
 * Archives ZIP fabriquées champ par champ (tests) : noms, tailles déclarées,
 * méthode, drapeaux et CRC au choix, pour construire des archives piégées
 * que l'écrivain sûr (src/lib/themes/zip.ts) refuserait de produire.
 */
export function rawZip(entries) {
  const locals = [];
  const cens = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const body = e.body;
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0);
    loc.writeUInt16LE(e.flags ?? 0, 6);
    loc.writeUInt16LE(e.method ?? 0, 8);
    loc.writeUInt32LE(e.crc ?? 0, 14);
    loc.writeUInt32LE(body.length, 18);
    loc.writeUInt32LE(e.usize ?? body.length, 22);
    loc.writeUInt16LE(name.length, 26);
    locals.push(loc, name, body);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(e.flags ?? 0, 8);
    cen.writeUInt16LE(e.method ?? 0, 10);
    cen.writeUInt32LE(e.crc ?? 0, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(e.usize ?? body.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    cens.push(cen, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(cens);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

