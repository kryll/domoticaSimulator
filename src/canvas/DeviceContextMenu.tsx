import { useCallback } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { useUiStore } from '../store/uiStore';
import { isDeviceOffline } from '../simulation/events';
import { capturableEntities } from '../simulation/scenes';
import { primaryAction, stepAction } from '../devices/presentation';
import { ContextMenu, type MenuEntry } from '../ui/ContextMenu';
import { isInfra } from '../devices/roles';
import { offlineBlockReason } from '../simulation/availability';
import { catalog } from '../devices/catalog';
import { definitionOf, entitiesOfDevice } from './analysis';
import { createAutomationForDevice, duplicateDevice } from './actions';
import { SCENE_DOMAINS } from '../scenes/sceneEntities';

/** Menú contextual del dispositivo (clic derecho o Mayús+F10 / tecla Menú). */
export function DeviceContextMenu() {
  const menu = useUiStore((s) => s.contextMenu);
  if (!menu) return null;
  return <DeviceMenuBody deviceId={menu.deviceId} x={menu.x} y={menu.y} />;
}

function DeviceMenuBody({ deviceId, x, y }: { deviceId: string; x: number; y: number }) {
  const close = useCallback(() => useUiStore.getState().openContextMenu(null), []);
  const device = useProjectStore((s) => s.project.devices.find((d) => d.id === deviceId));
  const sim = useSimulationStore((s) => s.sim);
  if (!device) return null;

  const def = definitionOf(device);
  const store = useSimulationStore.getState();
  const ui = useUiStore.getState();
  const offline = isDeviceOffline(sim, device.id);
  const entries: MenuEntry[] = [{ kind: 'header', label: device.name }];

  if (def && !offline) {
    const primary = primaryAction(device, def, sim);
    if (primary) entries.push({ kind: 'item', id: 'primary', label: primary.label, hint: 'Espacio', onSelect: () => store.quickAction(device.id) });
    const up = stepAction(device, def, sim, 1);
    const down = stepAction(device, def, sim, -1);
    if (up) entries.push({ kind: 'item', id: 'step-up', label: up.label, hint: '↑', onSelect: () => store.step(device.id, 1) });
    if (down) entries.push({ kind: 'item', id: 'step-down', label: down.label, hint: '↓', onSelect: () => store.step(device.id, -1) });
  }
  entries.push({ kind: 'item', id: 'popover', label: 'Control completo…', hint: 'Doble clic', onSelect: () => ui.openPopover(device.id) });
  entries.push({ kind: 'separator' });
  entries.push({ kind: 'item', id: 'automation', label: 'Crear automatización con este dispositivo', onSelect: () => createAutomationForDevice(device.id) });
  entries.push({ kind: 'item', id: 'templates', label: 'Plantillas con este dispositivo…', onSelect: () => ui.openTemplates({ deviceId: device.id }) });
  const sceneIds = capturableEntities(
    sim,
    entitiesOfDevice(device)
      .filter((r) => SCENE_DOMAINS.has(r.definition.domain))
      .map((r) => r.entityId),
  ).capturable;
  entries.push({
    kind: 'item',
    id: 'add-to-scene', label: 'Añadir a escena…',
    disabled: sceneIds.length === 0,
    ...(offline ? { hint: 'sin conexión' } : {}),
    onSelect: () => ui.setAddToScene(sceneIds),
  });
  const blocked = offline ? offlineBlockReason(sim, useProjectStore.getState().project, catalog, device.id) : null;
  entries.push({
    kind: 'item',
    id: 'offline',
    label: offline ? 'Reconectar' : 'Simular sin conexión',
    ...(blocked ? { disabled: true, note: blocked } : {}),
    onSelect: () => store.setDeviceOffline(device.id, !offline),
  });
  if (def && isInfra(def) && def.role !== 'ha_server') {
    const down = (sim.failures?.devicesDown ?? []).includes(device.id);
    entries.push({
      kind: 'item',
      id: 'failure',
      label: down ? 'Restaurar tras la caída' : 'Simular caída',
      hint: 'Escenario',
      onSelect: () => {
        const current = useSimulationStore.getState().sim.failures?.devicesDown ?? [];
        store.setFailures({ devicesDown: down ? current.filter((id) => id !== device.id) : [...current, device.id] });
        if (!down) ui.setBottomTab('impact');
      },
    });
  }
  entries.push({ kind: 'separator' });
  entries.push({ kind: 'item', id: 'duplicate', label: 'Duplicar', onSelect: () => duplicateDevice(device.id) });
  entries.push({
    kind: 'item',
    id: 'connect-from', label: 'Conectar desde aquí',
    onSelect: () => {
      ui.setCanvasMode('connect');
      ui.setConnectFrom(device.id);
      ui.notify(`Haz clic en el dispositivo al que conectar «${device.name}» (Esc para cancelar)`, 'info');
    },
  });
  entries.push({
    kind: 'item',
    id: 'delete', label: 'Eliminar',
    danger: true,
    hint: 'Supr',
    onSelect: () => {
      useProjectStore.getState().removeElements({ deviceIds: [device.id] });
      ui.select(null);
      ui.openPopover(null);
    },
  });

  return <ContextMenu x={x} y={y} label={`Acciones de ${device.name}`} entries={entries} onClose={close} />;
}
