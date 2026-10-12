import { useEffect } from 'react';
import type { Id } from '../types';
import { useSimulationStore } from '../store/simulationStore';
import { useUiStore, type CanvasMode } from '../store/uiStore';

/** Dispositivo bajo el puntero (lo actualiza el lienzo). */
let hoveredDeviceId: Id | null = null;
export function setHoveredDevice(id: Id | null): void {
  hoveredDeviceId = id;
}

/** ¿El foco está en un campo de texto o control que usa estas teclas? */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function isInteractive(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  // Botones, enlaces, menús y diálogos ya gestionan Espacio/Intro/flechas.
  return Boolean(target.closest('button, a[href], [role="menu"], [role="dialog"], [role="tab"], [role="separator"], summary'));
}

const MODE_KEYS: Record<string, CanvasMode> = { v: 'select', c: 'connect', r: 'room' };

/** Dispositivo objetivo del teclado: el que está bajo el ratón o, si no, el seleccionado. */
function targetDevice(): Id | null {
  if (hoveredDeviceId) return hoveredDeviceId;
  const sel = useUiStore.getState().selection;
  return sel?.kind === 'device' ? sel.id : null;
}

/** Atajos del lienzo. Se ignoran con el foco en campos de texto o con un diálogo modal abierto. */
export function useCanvasKeyboard(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if (isTypingTarget(e.target)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const ui = useUiStore.getState();
      const sim = useSimulationStore.getState();
      const key = e.key;
      const lower = key.toLowerCase();

      if (key === '?') {
        ui.setShortcutsOpen(true);
        e.preventDefault();
        return;
      }
      if (key === 'Escape') {
        if (ui.contextMenu) ui.openContextMenu(null);
        else if (ui.popoverDeviceId) ui.openPopover(null);
        else if (ui.connectFromId) ui.setConnectFrom(null);
        else if (ui.canvasMode === 'room' || ui.canvasMode === 'connect') ui.setCanvasMode('select');
        return;
      }
      if (isInteractive(e.target) && (key === ' ' || key === 'Enter' || key.startsWith('Arrow'))) return;

      if (!e.shiftKey && MODE_KEYS[lower]) {
        ui.setCanvasMode(MODE_KEYS[lower] ?? 'select');
        e.preventDefault();
        return;
      }
      if (!e.shiftKey && lower === 'u') {
        ui.setCanvasMode(ui.canvasMode === 'interact' ? 'select' : 'interact');
        e.preventDefault();
        return;
      }
      if (!e.shiftKey && lower === 'p') {
        if (sim.running) sim.pause();
        else sim.start();
        e.preventDefault();
        return;
      }

      const deviceId = targetDevice();
      if (!deviceId) return;
      if (key === 'ContextMenu' || (e.shiftKey && key === 'F10')) {
        const el = document.querySelector(`[data-testid="device-node-${deviceId}"]`);
        const r = el?.getBoundingClientRect();
        ui.openContextMenu({ deviceId, x: r ? r.left + r.width / 2 : 100, y: r ? r.bottom : 100 });
      } else if (key === ' ' || key === 'Enter') {
        sim.quickAction(deviceId);
      } else if (key === 'ArrowUp' || key === 'ArrowDown') {
        sim.step(deviceId, key === 'ArrowUp' ? 1 : -1);
      } else if (/^[0-9]$/.test(key)) {
        sim.setLevel(deviceId, Number(key) * 10);
      } else {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
    };
    // Fase de captura: se adelanta al movimiento de nodos con flechas de React Flow.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}
