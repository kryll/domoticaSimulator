// Aplicar arreglos rápidos desde la interfaz: un único paso de deshacer, colocación en la sala de
// destino y selección de lo añadido.
import type { Project } from '../types';
import { useProjectStore } from '../store/projectStore';
import { primarySelection, useUiStore } from '../store/uiStore';
import type { QuickFix } from '../network/quickFixes';
import { placeDevicesAt, targetRoomId } from '../canvas/placeDevice';

/**
 * Lleva los dispositivos que añade un arreglo a la sala de destino (la seleccionada o la última
 * dibujada en su planta) con placeNewDevices, y les asigna la sala.
 */
export function relocateAdded(before: Project, after: Project, selection: ReturnType<typeof primarySelection>): Project {
  const existing = new Set(before.devices.map((d) => d.id));
  const added = after.devices.filter((d) => !existing.has(d.id));
  if (added.length === 0) return after;
  let project = after;
  for (const floorId of new Set(added.map((d) => d.floorId))) {
    const roomId = targetRoomId(before, floorId, selection);
    if (!roomId) continue;
    const onFloor = added.filter((d) => d.floorId === floorId);
    const others = { ...project, devices: project.devices.filter((d) => !onFloor.some((x) => x.id === d.id)) };
    const spots = placeDevicesAt(others, floorId, onFloor.length, { roomId });
    const moved = new Map(onFloor.map((d, i) => [d.id, spots[i]]));
    project = {
      ...project,
      devices: project.devices.map((d) => {
        const spot = moved.get(d.id);
        return spot ? { ...d, position: spot, roomId } : d;
      }),
    };
  }
  return project;
}

/** Aplica un arreglo rápido en un único paso de deshacer y selecciona lo que indique. */
export function applyQuickFix(fix: QuickFix): void {
  const store = useProjectStore.getState();
  const ui = useUiStore.getState();
  const selection = primarySelection(ui);
  store.update((p) => relocateAdded(p, fix.apply(p), selection));
  const after = useProjectStore.getState().project;
  const select = (fix.selectAfter ?? []).filter((id) => after.devices.some((d) => d.id === id));
  if (select.length > 0) {
    const first = after.devices.find((d) => d.id === select[0]);
    if (first && ui.activeFloorId !== first.floorId) ui.setActiveFloor(first.floorId);
    useUiStore.getState().setSelection(select);
    useUiStore.getState().focusDevices(select);
  }
  useUiStore.getState().notify(`Arreglo aplicado: ${fix.label}`, 'success', {
    action: { label: 'Deshacer', run: () => useProjectStore.getState().undo() },
  });
}
