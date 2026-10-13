// Hashes cortos y estables (FNV-1a de 32 bits) para identificadores del puente: IEEE, MAC, homeId...
// Funciones puras, sin dependencias.

/** FNV-1a de 32 bits con semilla. */
export function fnv1a(text: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
