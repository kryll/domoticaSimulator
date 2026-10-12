import { downloadDataUrl } from '../ui/download';

const IGNORED_CLASSES = ['react-flow__controls', 'react-flow__minimap'];

/** Excluye del PNG los controles del lienzo y los elementos marcados con data-export-ignore. */
export function includeInExport(node: Node): boolean {
  if (!(node instanceof HTMLElement)) return true;
  if (node.dataset.exportIgnore !== undefined) return false;
  return !IGNORED_CLASSES.some((c) => node.classList.contains(c));
}

/** Renderiza un elemento del DOM (el lienzo) a PNG y lo descarga. */
export async function exportElementToPng(element: HTMLElement, filename: string): Promise<void> {
  // Carga perezosa: html-to-image solo se descarga al exportar.
  const { toPng } = await import('html-to-image');
  const dataUrl = await toPng(element, {
    backgroundColor: '#f8fafc',
    pixelRatio: 2,
    cacheBust: true,
    filter: includeInExport,
  });
  downloadDataUrl(dataUrl, filename.endsWith('.png') ? filename : `${filename}.png`);
}

/** Exporta el lienzo actual (#ha-canvas) a PNG. */
export async function exportCanvasPng(filename: string): Promise<void> {
  const el = document.getElementById('ha-canvas');
  if (!el) throw new Error('No se encontró el lienzo');
  await exportElementToPng(el, filename);
}
