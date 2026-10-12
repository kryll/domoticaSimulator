// Qué hace cada resultado de la búsqueda global (Ctrl+K) al elegirlo.
import type { AppActionId, SearchEntry } from '../search/search';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { useUiStore } from '../store/uiStore';
import { useExtrasStore } from '../store/extrasStore';
import { useViewStore } from '../store/viewStore';
import { useLayoutStore } from '../store/layoutStore';
import { exportProjectJson } from '../store/persistence';
import { automationsToYaml } from '../export/yaml';
import { devicesToCsv } from '../export/csv';
import { knownDefinitions } from '../canvas/analysis';
import { enterPresentation } from '../presentation/presentationMode';
import { downloadText, safeFilename } from './download';
import { isBridgeLive } from '../bridge/useBridge';

/** Lleva el plano a un dispositivo: su planta, seleccionado y centrado. */
export function revealDevice(deviceId: string): void {
  const device = useProjectStore.getState().project.devices.find((d) => d.id === deviceId);
  if (!device) return;
  const ui = useUiStore.getState();
  useExtrasStore.getState().setCenterView('plan');
  if (ui.activeFloorId !== device.floorId) ui.setActiveFloor(device.floorId);
  useUiStore.getState().select({ kind: 'device', id: device.id });
  useUiStore.getState().focusDevices([device.id]);
}

function revealRoom(roomId: string): void {
  const project = useProjectStore.getState().project;
  const room = project.rooms.find((r) => r.id === roomId);
  if (!room) return;
  const ui = useUiStore.getState();
  useExtrasStore.getState().setCenterView('plan');
  if (ui.activeFloorId !== room.floorId) ui.setActiveFloor(room.floorId);
  useUiStore.getState().select({ kind: 'room', id: room.id });
  const inside = project.devices.filter((d) => d.roomId === room.id).map((d) => d.id);
  if (inside.length > 0) useUiStore.getState().focusDevices(inside);
}

export function runAppAction(id: AppActionId): void {
  const project = useProjectStore.getState().project;
  const ui = useUiStore.getState();
  const base = safeFilename(project.name);
  switch (id) {
    case 'export-packages':
      useExtrasStore.getState().openDialog('packages');
      return;
    case 'export-yaml':
      downloadText(automationsToYaml(project), 'automations.yaml', 'text/yaml');
      return;
    case 'export-csv':
      downloadText(devicesToCsv(project, knownDefinitions()), `${base}-dispositivos.csv`, 'text/csv');
      return;
    case 'export-png':
      void import('../export/png').then((m) => m.exportCanvasPng(`${base}-plano.png`)).catch((err: unknown) => ui.notify(String(err), 'error'));
      return;
    case 'export-json':
      downloadText(exportProjectJson(project), `${base}.json`, 'application/json');
      return;
    case 'report-pdf':
      useViewStore.getState().setProposalOpen(true);
      return;
    case 'validate':
      ui.setBottomTab('validation');
      return;
    case 'simulation-start':
      useSimulationStore.getState().start();
      return;
    case 'simulation-pause':
      useSimulationStore.getState().pause();
      return;
    case 'new-automation': {
      const a = useProjectStore.getState().addAutomation();
      ui.showAutomation(a.id, 'visual');
      return;
    }
    case 'new-scene':
      useProjectStore.getState().addScene({ name: 'Nueva escena', entities: {} });
      ui.setBottomTab('scenes');
      return;
    case 'new-script':
      useProjectStore.getState().addScript();
      ui.setBottomTab('scenes');
      return;
    case 'new-helper':
      ui.setBottomTab('helpers');
      return;
    case 'import-ha':
      useLayoutStore.getState().setImportHaOpen(true);
      return;
    case 'day-plan':
      if (isBridgeLive()) {
        ui.notify('El laboratorio está en vivo: el día típico no está disponible', 'info');
        return;
      }
      useLayoutStore.getState().setDayPlanOpen(true);
      return;
    case 'presentation':
      enterPresentation();
      return;
    case 'dashboard':
      useExtrasStore.getState().setCenterView('dashboard');
      return;
    case 'settings':
      ui.setSettingsOpen(true);
      return;
  }
}

/** Ejecuta el resultado elegido: centra el dispositivo, abre la automatización o lanza la acción. */
export function runSearchEntry(e: SearchEntry): void {
  const ui = useUiStore.getState();
  useLayoutStore.getState().setDrawer(null);
  switch (e.kind) {
    case 'device':
      revealDevice(e.id);
      return;
    case 'entity':
      if (e.deviceId) revealDevice(e.deviceId);
      return;
    case 'automation':
      ui.showAutomation(e.id, 'visual');
      return;
    case 'scene':
    case 'script':
      ui.setBottomTab('scenes');
      return;
    case 'helper':
      ui.setBottomTab('helpers');
      return;
    case 'room':
      revealRoom(e.id);
      return;
    case 'action':
      runAppAction(e.id as AppActionId);
      return;
  }
}
