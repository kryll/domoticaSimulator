// Entrar y salir del modo presentación (solo lectura, a pantalla completa si el navegador deja).
import { useUiStore, type CanvasMode } from '../store/uiStore';
import { useViewStore } from '../store/viewStore';

let previousMode: CanvasMode = 'select';
let enteredFullscreen = false;

function onFullscreenChange() {
  // Si el navegador sale de pantalla completa (Esc), se sale también de la presentación.
  if (enteredFullscreen && !document.fullscreenElement && useViewStore.getState().presentation) exitPresentation();
}

/** Activa la vista de presentación: modo Uso, sin selección ni menús, y pantalla completa. */
export function enterPresentation(opts: { fullscreen?: boolean } = {}): void {
  const ui = useUiStore.getState();
  if (!useViewStore.getState().presentation) previousMode = ui.canvasMode === 'interact' ? 'select' : ui.canvasMode;
  ui.select(null);
  ui.openPopover(null);
  ui.openContextMenu(null);
  ui.setConnectFrom(null);
  // Primero la bandera: así el aviso de «modo Uso» no aparece en la presentación.
  useViewStore.getState().setPresentation(true);
  ui.setCanvasMode('interact');
  enteredFullscreen = false;
  if (opts.fullscreen !== false && typeof document !== 'undefined' && document.documentElement.requestFullscreen && !document.fullscreenElement) {
    document.documentElement
      .requestFullscreen()
      .then(() => {
        enteredFullscreen = true;
        document.addEventListener('fullscreenchange', onFullscreenChange);
      })
      .catch(() => {
        // Sin permiso (sin gesto del usuario, iframe, móvil): la vista ocupa la ventana.
      });
  }
}

/** Vuelve al editor. */
export function exitPresentation(): void {
  if (!useViewStore.getState().presentation) return;
  useViewStore.getState().setPresentation(false);
  const ui = useUiStore.getState();
  ui.openPopover(null);
  ui.setCanvasMode(previousMode === 'room' || previousMode === 'wall' || previousMode === 'connect' ? 'select' : previousMode);
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  if (enteredFullscreen && document.fullscreenElement && document.exitFullscreen) {
    void document.exitFullscreen().catch(() => undefined);
  }
  enteredFullscreen = false;
}

/** Bandera del hash para abrir un enlace compartido directamente en modo presentación. */
export const PRESENT_FLAG = 'modo=presentacion';

/** ¿La URL pide el modo presentación? (#p=...&modo=presentacion) */
export function wantsPresentation(hash: string): boolean {
  return hash
    .replace(/^#/, '')
    .split('&')
    .some((part) => part === PRESENT_FLAG);
}

/** Añade (o quita) la bandera de presentación a una URL de compartir. */
export function withPresentationFlag(url: string, on: boolean): string {
  const [base, hash = ''] = url.split('#');
  const parts = hash.split('&').filter((p) => p !== '' && p !== PRESENT_FLAG);
  if (on) parts.push(PRESENT_FLAG);
  return parts.length > 0 ? `${base ?? ''}#${parts.join('&')}` : (base ?? '');
}
