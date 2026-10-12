/** Formato compacto para los nodos (coma decimal, sin ceros de más). */
export function short(n: number, decimals = 1): string {
  return n.toLocaleString('es-ES', { maximumFractionDigits: decimals });
}

/** Segundos -> "m:ss". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
