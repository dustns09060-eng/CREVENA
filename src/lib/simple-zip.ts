// STEP41 item 15: a minimal, dependency-free ZIP writer (STORE method — no
// compression) so "전체 다운로드" can bundle several PNGs into one file
// without pulling in a new npm package (bundle size / license / maintenance
// review avoided entirely). PNGs are already compressed, so STORE-only loses
// nothing meaningful over a DEFLATE-capable library for this use case.
// Implements just enough of the ZIP spec (local file header, central
// directory, end-of-central-directory record) for unmodified files with a
// real CRC-32 — every mainstream unzip tool (Windows Explorer, macOS
// Archive Utility, 7-Zip) reads STORE-method ZIPs correctly.

let crcTable: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16LE(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}
function writeUint32LE(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true);
}

export async function createZipBlob(files: { name: string; data: Blob }[]): Promise<Blob> {
  const encoder = new TextEncoder();
  const entries: { nameBytes: Uint8Array; data: Uint8Array; crc: number; offset: number }[] = [];
  const parts: BlobPart[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = new Uint8Array(await file.data.arrayBuffer());
    const crc = crc32(data);

    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    writeUint32LE(view, 0, 0x04034b50); // local file header signature
    writeUint16LE(view, 4, 20); // version needed
    writeUint16LE(view, 6, 0); // flags
    writeUint16LE(view, 8, 0); // compression: store
    writeUint16LE(view, 10, 0); // mod time
    writeUint16LE(view, 12, 0x21); // mod date (1980-01-01)
    writeUint32LE(view, 14, crc);
    writeUint32LE(view, 18, data.length); // compressed size == uncompressed (store)
    writeUint32LE(view, 22, data.length);
    writeUint16LE(view, 26, nameBytes.length);
    writeUint16LE(view, 28, 0); // extra field length
    header.set(nameBytes, 30);

    parts.push(header, data);
    entries.push({ nameBytes, data, crc, offset });
    offset += header.length + data.length;
  }

  const centralDirStart = offset;
  for (const entry of entries) {
    const central = new Uint8Array(46 + entry.nameBytes.length);
    const view = new DataView(central.buffer);
    writeUint32LE(view, 0, 0x02014b50); // central directory signature
    writeUint16LE(view, 4, 20); // version made by
    writeUint16LE(view, 6, 20); // version needed
    writeUint16LE(view, 8, 0); // flags
    writeUint16LE(view, 10, 0); // compression: store
    writeUint16LE(view, 12, 0); // mod time
    writeUint16LE(view, 14, 0x21); // mod date
    writeUint32LE(view, 16, entry.crc);
    writeUint32LE(view, 20, entry.data.length);
    writeUint32LE(view, 24, entry.data.length);
    writeUint16LE(view, 28, entry.nameBytes.length);
    writeUint16LE(view, 30, 0); // extra length
    writeUint16LE(view, 32, 0); // comment length
    writeUint16LE(view, 34, 0); // disk number start
    writeUint16LE(view, 36, 0); // internal attrs
    writeUint32LE(view, 38, 0); // external attrs
    writeUint32LE(view, 42, entry.offset);
    central.set(entry.nameBytes, 46);
    parts.push(central);
    offset += central.length;
  }
  const centralDirSize = offset - centralDirStart;

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeUint32LE(endView, 0, 0x06054b50); // end of central directory signature
  writeUint16LE(endView, 4, 0); // disk number
  writeUint16LE(endView, 6, 0); // disk with central directory
  writeUint16LE(endView, 8, entries.length); // entries on this disk
  writeUint16LE(endView, 10, entries.length); // total entries
  writeUint32LE(endView, 12, centralDirSize);
  writeUint32LE(endView, 16, centralDirStart);
  writeUint16LE(endView, 20, 0); // comment length
  parts.push(end);

  return new Blob(parts, { type: "application/zip" });
}
