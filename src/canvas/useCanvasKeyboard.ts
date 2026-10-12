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
  // Botones, enlaces y pestañas ya gestionan Espacio/Intro/flechas.
  return Boolean(target.closest('button, a[href], [role="tab"], [role="separator"], summary'));
}

/** ¿El foco está dentro de un menú o diálogo (popover, menú contextual)? */
function inMenuOrDialog(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('[role="menu"], [role="dialog"]'));
}

/** Nodo de dispositivo con el foco del teclado (React Flow pone data-id en el envoltorio). */
function focusedDevice(): Id | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  const nodeEl = active.closest<HTMLElement>('.react-flow__node-device');
  return nodeEl?.dataset.id ?? null;
}

const MODE_KEYS: Record<string, CanvasMode> = { v: 'select', c: 'connect', r: 'room' };

/** Dispositivo objetivo del teclado: el enfocado, el que está bajo el ratón o el seleccionado. */
function targetDevice(): Id | null {
  const focused = focusedDevice();
  if (focused) return focused;
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

      if (key === 'Escape') {
        if (ui.contextMenu) ui.openContextMenu(null);
        else if (ui.popoverDeviceId) ui.openPopover(null);
        else if (ui.connectFromId) ui.setConnectFrom(null);
        else if (ui.canvasMode === 'room' || ui.canvasMode === 'connect' || ui.canvasMode === 'wall') ui.setCanvasMode('select');
        return;
      }
      if (inMenuOrDialog(e.target)) return;
      if (key === '?') {
        ui.setShortcutsOpen(true);
        e.preventDefault();
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
        if (!sim.setLevel(deviceId, Number(key) * 10)) ui.notify('Este dispositivo no admite nivel', 'info');
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
