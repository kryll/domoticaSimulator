// ZIP sin compresión (método «store») escrito a mano: puro, determinista y sin dependencias.

export interface ZipEntry {
  /** Ruta dentro del ZIP con «/» como separador (p. ej. "packages/salon.yaml"). */
  path: string;
  content: string | Uint8Array;
}

let table: Uint32Array | undefined;

function crcTable(): Uint32Array {
  if (table) return table;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  table = t;
  return t;
}

/** CRC-32 (IEEE 802.3) de unos bytes. */
export function crc32(data: Uint8Array): number {
  const t = crcTable();
  let crc = 0xffffffff;
  for (const byte of data) crc = (t[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();

function bytesOf(content: string | Uint8Array): Uint8Array {
  return typeof content === 'string' ? encoder.encode(content) : content;
}

/** Fecha y hora DOS fijas (1/1/1980 00:00) para que el ZIP sea determinista. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
/** Bit 11: nombres en UTF-8. */
const FLAGS = 0x0800;

class Writer {
  private chunks: Uint8Array[] = [];
  length = 0;

  u16(v: number): void {
    this.bytes(new Uint8Array([v & 0xff, (v >>> 8) & 0xff]));
  }

  u32(v: number): void {
    this.bytes(new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]));
  }

  bytes(b: Uint8Array): void {
    this.chunks.push(b);
    this.length += b.length;
  }

  result(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const c of this.chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  }
}

/** Empaqueta los ficheros en un ZIP sin compresión. Lanza Error si hay rutas repetidas o vacías. */
export function zipFiles(files: ZipEntry[]): Uint8Array {
  const seen = new Set<string>();
  const w = new Writer();
  const central: { name: Uint8Array; crc: number; size: number; offset: number }[] = [];
  for (const file of files) {
    const path = file.path.replace(/\\/g, '/').replace(/^\/+/, '');
    if (path === '') throw new Error('Ruta vacía en el ZIP');
    if (seen.has(path)) throw new Error(`Ruta repetida en el ZIP: ${path}`);
    seen.add(path);
    const name = encoder.encode(path);
    const data = bytesOf(file.content);
    const crc = crc32(data);
    const offset = w.length;
    w.u32(0x04034b50);
    w.u16(20); // versión necesaria
    w.u16(FLAGS);
    w.u16(0); // método store
    w.u16(DOS_TIME);
    w.u16(DOS_DATE);
    w.u32(crc);
    w.u32(data.length);
    w.u32(data.length);
    w.u16(name.length);
    w.u16(0);
    w.bytes(name);
    w.bytes(data);
    central.push({ name, crc, size: data.length, offset });
  }
  const cdStart = w.length;
  for (const e of central) {
    w.u32(0x02014b50);
    w.u16(20); // versión que lo creó
    w.u16(20);
    w.u16(FLAGS);
    w.u16(0);
    w.u16(DOS_TIME);
    w.u16(DOS_DATE);
    w.u32(e.crc);
    w.u32(e.size);
    w.u32(e.size);
    w.u16(e.name.length);
    w.u16(0); // extra
    w.u16(0); // comentario
    w.u16(0); // disco
    w.u16(0); // atributos internos
    w.u32(0); // atributos externos
    w.u32(e.offset);
    w.bytes(e.name);
  }
  const cdSize = w.length - cdStart;
  w.u32(0x06054b50);
  w.u16(0);
  w.u16(0);
  w.u16(central.length);
  w.u16(central.length);
  w.u32(cdSize);
  w.u32(cdStart);
  w.u16(0);
  return w.result();
}

/** Lee un ZIP sin compresión generado por zipFiles (para tests y verificación). */
export function readStoredZip(zip: Uint8Array): { path: string; content: Uint8Array }[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let end = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end === -1) throw new Error('ZIP no válido: falta el directorio central');
  const count = view.getUint16(end + 10, true);
  let p = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const result: { path: string; content: Uint8Array }[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP no válido: cabecera central');
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const offset = view.getUint32(p + 42, true);
    const path = decoder.decode(zip.subarray(p + 46, p + 46 + nameLen));
    if (method !== 0) throw new Error(`Método de compresión no soportado en ${path}`);
    const localNameLen = view.getUint16(offset + 26, true);
    const localExtraLen = view.getUint16(offset + 28, true);
    const start = offset + 30 + localNameLen + localExtraLen;
    const content = zip.slice(start, start + size);
    if (crc32(content) !== crc) throw new Error(`CRC incorrecto en ${path}`);
    result.push({ path, content });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return result;
}
