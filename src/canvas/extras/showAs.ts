// «Mostrar como luz» (B19): Device.showAs con todas las referencias al día (entity_id y servicios).
import type { Device, Id } from '../../types';
import { catalog, getDefinition } from '../../devices/catalog';
import { applyShowAs, entityIdMappingForShowAs } from '../../devices/renaming';
import { useProjectStore } from '../../store/projectStore';
import { updateWithRename } from '../../store/entityRename';

/** Cambia cómo se muestra un relé (luz o interruptor) en el proyecto y en la simulación. */
export function setDeviceShowAs(deviceId: Id, showAs: Device['showAs']): void {
  const device = useProjectStore.getState().project.devices.find((d) => d.id === deviceId);
  const def = device ? getDefinition(device.definitionId, catalog) : undefined;
  if (!device || !def || device.showAs === showAs) return;
  updateWithRename(entityIdMappingForShowAs(device, def, showAs), (p) => applyShowAs(p, deviceId, showAs, catalog));
}
