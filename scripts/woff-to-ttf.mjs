/**
 * WOFF 1.0 -> TTF/OTF. A WOFF file is an sfnt whose tables have each been zlib-deflated,
 * so unwrapping it needs nothing beyond node's zlib — which is why this exists instead of
 * a woff2/brotli dependency. Used by scripts/build-print-fonts.mjs to turn the
 * @fontsource/inter .woff subsets into the TTFs that @pdf-lib/fontkit can embed.
 */
import zlib from 'node:zlib';

const pad4 = (n) => (n + 3) & ~3;

export const woffToSfnt = (buf) => {
  if (buf.readUInt32BE(0) !== 0x774f4646) throw new Error('not a WOFF file (bad signature)');
  const flavor = buf.readUInt32BE(4);
  const numTables = buf.readUInt16BE(12);

  const dir = [];
  for (let i = 0; i < numTables; i++) {
    const p = 44 + i * 20;
    dir.push({
      tag: buf.readUInt32BE(p),
      offset: buf.readUInt32BE(p + 4),
      compLength: buf.readUInt32BE(p + 8),
      origLength: buf.readUInt32BE(p + 12),
      checksum: buf.readUInt32BE(p + 16),
    });
  }
  // sfnt requires the table directory sorted by tag.
  dir.sort((a, b) => a.tag - b.tag);

  const tables = dir.map((t) => {
    const raw = buf.subarray(t.offset, t.offset + t.compLength);
    const data = t.compLength < t.origLength ? zlib.inflateSync(raw) : raw;
    if (data.length !== t.origLength) {
      throw new Error(`table length mismatch: got ${data.length}, expected ${t.origLength}`);
    }
    return { ...t, data };
  });

  const headerSize = 12 + numTables * 16;
  const totalSize = tables.reduce((n, t) => n + pad4(t.data.length), headerSize);
  const out = Buffer.alloc(totalSize);

  // sfnt header. searchRange/entrySelector/rangeShift are derived from the largest
  // power of two <= numTables, per the OpenType spec.
  const maxPow2 = Math.floor(Math.log2(numTables));
  out.writeUInt32BE(flavor, 0);
  out.writeUInt16BE(numTables, 4);
  out.writeUInt16BE((1 << maxPow2) * 16, 6);
  out.writeUInt16BE(maxPow2, 8);
  out.writeUInt16BE(numTables * 16 - (1 << maxPow2) * 16, 10);

  let recordAt = 12;
  let dataAt = headerSize;
  for (const t of tables) {
    out.writeUInt32BE(t.tag, recordAt);
    out.writeUInt32BE(t.checksum, recordAt + 4);
    out.writeUInt32BE(dataAt, recordAt + 8);
    out.writeUInt32BE(t.data.length, recordAt + 12);
    recordAt += 16;
    t.data.copy(out, dataAt);
    dataAt += pad4(t.data.length);
  }
  return out;
};
