import { useEffect } from 'react';
import type { Id } from '../types';
import { useSimulationStore } from '../store/simulationStore';
import { primarySelection, selectedDeviceIds, useUiStore, type CanvasMode } from '../store/uiStore';
import { copyPayloadText, copySelection, deleteSelection, duplicateSelection, pasteText, selectAllOnFloor } from './selectionActions';

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
  const sel = primarySelection(useUiStore.getState());
  return sel?.kind === 'device' ? sel.id : null;
}

/** ¿Hay texto seleccionado en la página? (entonces Ctrl+C copia ese texto). */
function hasTextSelection(): boolean {
  const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
  return Boolean(sel && !sel.isCollapsed && sel.toString().trim() !== '');
}

function modalOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null;
}

/** ¿El evento de portapapeles es para el lienzo (no para un campo de texto ni un diálogo)? */
function canvasClipboardTarget(e: Event): boolean {
  return !isTypingTarget(e.target) && !isTypingTarget(document.activeElement) && !modalOpen() && !inMenuOrDialog(e.target);
}

/** Atajos con Ctrl/Cmd (selección múltiple). Ctrl+C y Ctrl+V llegan como eventos copy/paste. */
function onModifierKey(e: KeyboardEvent, clip: { copied: boolean; pasted: boolean }): void {
  if (e.altKey || inMenuOrDialog(e.target)) return;
  const ui = useUiStore.getState();
  if (ui.canvasMode === 'interact') return;
  const lower = e.key.toLowerCase();
  if (lower === 'a' && !e.shiftKey) {
    selectAllOnFloor();
    e.preventDefault();
  } else if (lower === 'd' && !e.shiftKey) {
    if (selectedDeviceIds(ui).length === 0) return;
    duplicateSelection();
    e.preventDefault();
  } else if (lower === 'c' && !e.shiftKey) {
    if (selectedDeviceIds(ui).length === 0 || hasTextSelection()) return;
    // Si el navegador no lanza el evento copy, se copia con la API del portapapeles (o en memoria).
    clip.copied = false;
    setTimeout(() => {
      if (!clip.copied) void copySelection();
    }, 0);
  } else if (lower === 'v' && !e.shiftKey) {
    clip.pasted = false;
    setTimeout(() => {
      if (!clip.pasted) pasteText(null);
    }, 0);
  }
}

/** Atajos del lienzo. Se ignoran con el foco en campos de texto o con un diálogo modal abierto. */
export function useCanvasKeyboard(): void {
  useEffect(() => {
    const clip = { copied: true, pasted: true };
    const onCopy = (e: ClipboardEvent) => {
      if (!canvasClipboardTarget(e) || hasTextSelection()) return;
      const ui = useUiStore.getState();
      const ids = selectedDeviceIds(ui);
      const text = copyPayloadText(ids);
      if (!text) return;
      clip.copied = true;
      e.clipboardData?.setData('text/plain', text);
      e.preventDefault();
      ui.notify(ids.length === 1 ? '1 dispositivo copiado' : `${ids.length} dispositivos copiados`, 'info');
    };
    const onPaste = (e: ClipboardEvent) => {
      if (!canvasClipboardTarget(e) || useUiStore.getState().canvasMode === 'interact') return;
      clip.pasted = true;
      const ids = pasteText(e.clipboardData?.getData('text/plain') ?? null);
      if (ids.length > 0) e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (isTypingTarget(e.target)) return;
      if (modalOpen()) return;
      if (e.ctrlKey || e.metaKey) {
        onModifierKey(e, clip);
        return;
      }
      if (e.altKey) return;
      const ui = useUiStore.getState();
      const sim = useSimulationStore.getState();
      const key = e.key;
      const lower = key.toLowerCase();

      if (key === 'Escape') {
        if (ui.contextMenu) ui.openContextMenu(null);
        else if (ui.popoverDeviceId) ui.openPopover(null);
        else if (ui.connectFromId) ui.setConnectFrom(null);
        else if (ui.canvasMode === 'room' || ui.canvasMode === 'connect' || ui.canvasMode === 'wall') ui.setCanvasMode('select');
        else if (ui.selection.length > 0) ui.select(null);
        return;
      }
      if (inMenuOrDialog(e.target)) return;
      if (key === '?') {
        ui.setShortcutsOpen(true);
        e.preventDefault();
        return;
      }
      if (isInteractive(e.target) && (key === ' ' || key === 'Enter' || key.startsWith('Arrow'))) return;
      if ((key === 'Delete' || key === 'Backspace') && ui.canvasMode !== 'interact') {
        if (ui.selection.length === 0) return;
        void deleteSelection();
        e.preventDefault();
        e.stopPropagation();
        return;
      }

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
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('paste', onPaste);
    };
  }, []);
}
