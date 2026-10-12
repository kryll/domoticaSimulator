import { useCallback } from 'react';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { useExtrasStore } from '../../store/extrasStore';
import { ContextMenu, type MenuEntry } from '../../ui/ContextMenu';
import { turnOffFloor } from './floorActions';

/** Menú contextual de la planta (clic derecho en el fondo del lienzo o en su pestaña). */
export function FloorContextMenu() {
  const menu = useExtrasStore((s) => s.floorMenu);
  const floor = useProjectStore((s) => s.project.floors.find((f) => f.id === menu?.floorId));
  const close = useCallback(() => useExtrasStore.getState().openFloorMenu(null), []);
  if (!menu || !floor) return null;
  const entries: MenuEntry[] = [
    { kind: 'header', label: floor.name },
    {
      kind: 'item',
      id: 'all-off',
      label: 'Apagar todo en esta planta',
      onSelect: () => {
        const n = turnOffFloor(floor.id);
        useUiStore.getState().notify(n === 0 ? `No había nada encendido en «${floor.name}»` : `Apagados ${n} elementos en «${floor.name}»`, n === 0 ? 'info' : 'success');
      },
    },
    { kind: 'separator' },
    { kind: 'item', id: 'walls', label: 'Dibujar pared', onSelect: () => useUiStore.getState().setCanvasMode('wall') },
    { kind: 'item', id: 'climate', label: useExtrasStore.getState().showClimate ? 'Ocultar capa Clima' : 'Mostrar capa Clima', onSelect: () => useExtrasStore.getState().toggleClimate() },
    { kind: 'item', id: 'signal', label: useExtrasStore.getState().showSignal ? 'Ocultar capa Señal' : 'Mostrar capa Señal', onSelect: () => useExtrasStore.getState().toggleSignal() },
  ];
  return <ContextMenu x={menu.x} y={menu.y} label={`Acciones de la planta ${floor.name}`} entries={entries} onClose={close} />;
}
