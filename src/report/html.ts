// Utilidades para generar HTML seguro (lógica pura).

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapa texto para meterlo en HTML (contenido o atributos entre comillas). */
export function escapeHtml(text: string | number | undefined | null): string {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);
}

/**
 * Limpia un SVG generado por la interfaz antes de incrustarlo: quita <script>, <foreignObject>,
 * manejadores on*="…" y enlaces javascript:. Si no parece un SVG, devuelve ''.
 */
export function sanitizeSvg(svg: string): string {
  const trimmed = svg.trim();
  if (!/^(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(trimmed)) return '';
  return trimmed
    .replace(/<\?xml[^>]*>/gi, '')
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script[^>]*\/>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href\s*=\s*["']?)\s*javascript:[^"'\s>]*/gi, '$1#');
}
