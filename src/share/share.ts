// Compartir un proyecto por URL (B20): JSON comprimido con deflate (CompressionStream nativo)
// y codificado en base64url. Si el navegador no tiene CompressionStream se usa JSON sin comprimir.
import type { Project } from '../types';
import { parseProject } from '../store/projectSchema';

/** Prefijos de formato: v1 = deflate, v0 = sin comprimir. */
const DEFLATE_PREFIX = 'v1.';
const PLAIN_PREFIX = 'v0.';
/** Parámetro del hash de la URL: #p=<código>. */
export const SHARE_HASH_KEY = 'p';

export interface ShareOptions {
  /** Quita las imágenes de fondo de las plantas (data URL pesadas). Por defecto true. */
  omitImages?: boolean;
  /** Quita las variantes guardadas. Por defecto true. */
  omitVariants?: boolean;
  /** Fuerza no comprimir (tests o navegadores sin CompressionStream). */
  compress?: boolean;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('El enlace compartido no es válido (caracteres no permitidos)');
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new Error('El enlace compartido no es válido (base64 incorrecto)');
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function hasCompressionStreams(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // Los errores de escritura se notifican también al leer: aquí solo se evita el rechazo sin manejar.
  const written = writer
    .write(bytes)
    .then(() => writer.close())
    .catch(() => undefined);
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  await written;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Proyecto preparado para compartir (sin imágenes ni variantes, según las opciones). */
export function shareableProject(project: Project, opts: ShareOptions = {}): Project {
  const next: Project = { ...project };
  if (opts.omitVariants ?? true) delete next.variants;
  if (opts.omitImages ?? true) {
    next.floors = project.floors.map((f) => {
      const copy = { ...f };
      delete copy.backgroundImage;
      return copy;
    });
  }
  return next;
}

/** Codifica el proyecto para el hash de la URL ("v1.<base64url>"). */
export async function encodeProjectToHash(project: Project, opts: ShareOptions = {}): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(shareableProject(project, opts)));
  if ((opts.compress ?? true) && hasCompressionStreams()) {
    return DEFLATE_PREFIX + bytesToBase64Url(await pipe(json, new CompressionStream('deflate')));
  }
  return PLAIN_PREFIX + bytesToBase64Url(json);
}

/**
 * Decodifica y valida (projectSchema) un proyecto compartido. Acepta el código solo, "#p=..." o
 * "p=...". Lanza Error en español si el enlace no es válido.
 */
export async function decodeProjectFromHash(hash: string): Promise<Project> {
  let code = hash.trim().replace(/^#/, '');
  const param = new URLSearchParams(code).get(SHARE_HASH_KEY);
  if (code.includes('=') && param !== null) code = param;
  let bytes: Uint8Array;
  if (code.startsWith(DEFLATE_PREFIX)) {
    if (!hasCompressionStreams()) throw new Error('Este navegador no puede descomprimir el enlace compartido');
    try {
      bytes = await pipe(base64UrlToBytes(code.slice(DEFLATE_PREFIX.length)), new DecompressionStream('deflate'));
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('El enlace')) throw e;
      throw new Error('El enlace compartido está dañado (no se puede descomprimir)');
    }
  } else if (code.startsWith(PLAIN_PREFIX)) {
    bytes = base64UrlToBytes(code.slice(PLAIN_PREFIX.length));
  } else {
    throw new Error('El enlace compartido no es válido (formato desconocido)');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('El enlace compartido está dañado (JSON no válido)');
  }
  return parseProject(raw);
}

/** URL completa para compartir: base (sin hash) + "#p=<código>". */
export async function shareUrl(baseUrl: string, project: Project, opts: ShareOptions = {}): Promise<string> {
  const base = baseUrl.split('#')[0] ?? baseUrl;
  return `${base}#${SHARE_HASH_KEY}=${await encodeProjectToHash(project, opts)}`;
}
