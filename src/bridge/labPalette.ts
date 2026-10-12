// Acciones del laboratorio en la búsqueda global (Ctrl+K). Las ids están en src/search/search.ts.
import { useUiStore } from '../store/uiStore';
import { useBridgeStore } from './bridgeStore';
import { useLocalLab } from './localLab';

export type LabPaletteAction = 'lab-panel' | 'lab-settings' | 'lab-couple' | 'lab-start-all' | 'lab-stop-all' | 'lab-snapshots' | 'lab-traffic';

function requireConnected(): boolean {
  const b = useBridgeStore.getState();
  if (b.connection === 'connected') return true;
  useUiStore.getState().notify(!useLocalLab.getState().enabled ? 'El laboratorio está desactivado: actívalo en Ajustes → Laboratorio' : 'El laboratorio no está conectado desde esta pestaña', 'info');
  return false;
}

export function runLabPaletteAction(id: LabPaletteAction): void {
  const bridge = useBridgeStore.getState();
  switch (id) {
    case 'lab-panel':
      bridge.setPanel(true);
      return;
    case 'lab-settings':
      useUiStore.getState().setSettingsOpen(true, 'lab');
      return;
    case 'lab-snapshots':
      bridge.setPanel(true, 'snapshots');
      return;
    case 'lab-traffic':
      bridge.setPanel(true, 'traffic');
      return;
    case 'lab-couple':
      if (requireConnected()) void import('./runtime').then((m) => m.couple());
      return;
    case 'lab-start-all':
    case 'lab-stop-all':
      if (requireConnected()) void import('./runtime').then((m) => m.nodeAction(id === 'lab-start-all' ? 'start' : 'stop', 'all'));
      return;
  }
}
