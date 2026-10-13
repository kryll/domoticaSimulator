// Protobuf mínimo (proto3) para la API nativa de ESPHome: lo justo para codificar los mensajes del
// servidor y leer los del cliente. Tipos de cable: 0 varint, 2 longitud, 5 fixed32/float.

const WIRE_VARINT = 0;
const WIRE_LEN = 2;
const WIRE_FIXED32 = 5;

export class ProtoWriter {
  private readonly parts: Buffer[] = [];

  private tag(field: number, wire: number): void {
    this.raw(encodeVarint((field << 3) | wire));
  }

  private raw(buf: Buffer): void {
    this.parts.push(buf);
  }

  /** uint32/enum/int32 (no se escribe el 0, como en proto3). */
  uint(field: number, value: number | undefined): this {
    if (value === undefined || value === 0) return this;
    this.tag(field, WIRE_VARINT);
    this.raw(encodeVarint(value < 0 ? BigInt.asUintN(64, BigInt(Math.trunc(value))) : value));
    return this;
  }

  bool(field: number, value: boolean | undefined): this {
    return value ? this.uint(field, 1) : this;
  }

  fixed32(field: number, value: number): this {
    this.tag(field, WIRE_FIXED32);
    const b = Buffer.alloc(4);
    b.writeUInt32LE(value >>> 0);
    this.raw(b);
    return this;
  }

  float(field: number, value: number | undefined): this {
    if (value === undefined || value === 0 || !Number.isFinite(value)) return this;
    this.tag(field, WIRE_FIXED32);
    const b = Buffer.alloc(4);
    b.writeFloatLE(value);
    this.raw(b);
    return this;
  }

  bytes(field: number, value: Buffer): this {
    this.tag(field, WIRE_LEN);
    this.raw(encodeVarint(value.length));
    this.raw(value);
    return this;
  }

  /** Texto (no se escribe si está vacío, salvo force). */
  string(field: number, value: string | undefined, force = false): this {
    if (value === undefined || (value === '' && !force)) return this;
    return this.bytes(field, Buffer.from(value, 'utf8'));
  }

  strings(field: number, values: readonly string[] | undefined): this {
    for (const v of values ?? []) this.bytes(field, Buffer.from(v, 'utf8'));
    return this;
  }

  /** Enteros repetidos empaquetados (proto3). */
  packed(field: number, values: readonly number[] | undefined): this {
    if (!values || values.length === 0) return this;
    return this.bytes(field, Buffer.concat(values.map((v) => encodeVarint(v))));
  }

  message(field: number, sub: ProtoWriter): this {
    return this.bytes(field, sub.finish());
  }

  finish(): Buffer {
    return Buffer.concat(this.parts);
  }
}

export function encodeVarint(value: number | bigint): Buffer {
  let v = BigInt(value);
  const out: number[] = [];
  while (v >= 0x80n) {
    out.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  out.push(Number(v));
  return Buffer.from(out);
}

/** Lee un varint en `buf` desde `pos`. undefined si está incompleto. */
export function decodeVarint(buf: Buffer, pos: number): { value: number; next: number } | undefined {
  let result = 0n;
  let shift = 0n;
  for (let i = pos; i < buf.length; i++) {
    const byte = buf[i] ?? 0;
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value: Number(BigInt.asUintN(53, result)), next: i + 1 };
    shift += 7n;
    if (shift > 70n) throw new Error('varint demasiado largo');
  }
  return undefined;
}

export type ProtoValue = { wire: 0; value: number } | { wire: 2; value: Buffer } | { wire: 5; value: Buffer } | { wire: 1; value: Buffer };

/** Campos de un mensaje: número de campo → valores (en orden). */
export class ProtoFields {
  constructor(private readonly fields: Map<number, ProtoValue[]>) {}

  private first(field: number): ProtoValue | undefined {
    return this.fields.get(field)?.[0];
  }

  uint(field: number): number {
    const v = this.first(field);
    return v?.wire === 0 ? v.value : 0;
  }

  bool(field: number): boolean {
    return this.uint(field) !== 0;
  }

  fixed32(field: number): number {
    const v = this.first(field);
    return v?.wire === 5 ? v.value.readUInt32LE(0) : 0;
  }

  float(field: number): number {
    const v = this.first(field);
    return v?.wire === 5 ? v.value.readFloatLE(0) : 0;
  }

  string(field: number): string {
    const v = this.first(field);
    return v?.wire === 2 ? v.value.toString('utf8') : '';
  }

  has(field: number): boolean {
    return this.fields.has(field);
  }
}

export function readProto(buf: Buffer): ProtoFields {
  const fields = new Map<number, ProtoValue[]>();
  let pos = 0;
  while (pos < buf.length) {
    const key = decodeVarint(buf, pos);
    if (!key) throw new Error('mensaje protobuf truncado');
    pos = key.next;
    const field = Math.floor(key.value / 8);
    const wire = key.value & 7;
    let value: ProtoValue;
    if (wire === WIRE_VARINT) {
      const v = decodeVarint(buf, pos);
      if (!v) throw new Error('varint truncado');
      value = { wire: 0, value: v.value };
      pos = v.next;
    } else if (wire === WIRE_LEN) {
      const len = decodeVarint(buf, pos);
      if (!len || len.next + len.value > buf.length) throw new Error('campo truncado');
      value = { wire: 2, value: buf.subarray(len.next, len.next + len.value) };
      pos = len.next + len.value;
    } else if (wire === WIRE_FIXED32) {
      if (pos + 4 > buf.length) throw new Error('fixed32 truncado');
      value = { wire: 5, value: buf.subarray(pos, pos + 4) };
      pos += 4;
    } else if (wire === 1) {
      if (pos + 8 > buf.length) throw new Error('fixed64 truncado');
      value = { wire: 1, value: buf.subarray(pos, pos + 8) };
      pos += 8;
    } else throw new Error(`tipo de cable no admitido: ${wire}`);
    const list = fields.get(field) ?? [];
    list.push(value);
    fields.set(field, list);
  }
  return new ProtoFields(fields);
}
