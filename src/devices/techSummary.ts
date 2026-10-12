// Ficha técnica coherente con la integración efectiva del dispositivo (lógica pura).
// Evita textos contradictorios como «Local · Local (sondeo)» o «Requiere hub IKEA» con ZHA.
import type { Device, DeviceDefinition, IotClass, Project } from '../types';
import { catalog, isCloud } from './catalog';
import { CATEGORY_LABELS, INTEGRATION_LABELS, POWER_LABELS, PROTOCOL_LABELS, ROLE_LABELS } from './labels';
import { effectiveIotClass, isInfra, isZigbeeCoordinator, requiredHubBrand, ZIGBEE_COORDINATOR_INTEGRATIONS } from './roles';

export interface DeviceTechSummary {
  /** Integración efectiva («ZHA», «Philips Hue»...). */
  integration: string;
  protocol: string;
  iotClass: IotClass;
  cloud: boolean;
  /** «Local» o «Nube». */
  locality: 'Local' | 'Nube';
  /** Cómo recibe HA los cambios: «al instante (push)» o «por sondeo». */
  updates: string;
  /** «Local, al instante (push)», «Nube, por sondeo»... (sin repeticiones). */
  connectivity: string;
  /** Dependencia de hub o coordinador según la integración efectiva, si hay. */
  hub?: string;
  /** Falta el hub o el coordinador que necesita la integración actual. */
  hubMissing: boolean;
  /** Filas «etiqueta → valor» listas para pintar la ficha. */
  rows: Array<[string, string]>;
  /** Resumen en una línea. */
  text: string;
}

const UPDATES: Record<IotClass, string> = {
  local_push: 'al instante (push)',
  local_polling: 'por sondeo',
  cloud_push: 'al instante (push)',
  cloud_polling: 'por sondeo',
};

function hubText(device: Device, def: DeviceDefinition, project: Pick<Project, 'devices'>, defs: DeviceDefinition[]): { text?: string; missing: boolean } {
  const present = (pred: (d: DeviceDefinition) => boolean): DeviceDefinition | undefined => {
    for (const d of project.devices) {
      if (d.id === device.id) continue;
      const x = defs.find((y) => y.id === d.definitionId);
      if (x && pred(x)) return x;
    }
    return undefined;
  };
  if (isInfra(def)) return { missing: false };
  const brand = requiredHubBrand(device, def);
  if (brand) {
    const hub = present((d) => d.role === 'hub' && d.brand === brand);
    return hub ? { text: `A través de ${hub.name}`, missing: false } : { text: `Necesita el hub de ${brand} (no está en el proyecto)`, missing: true };
  }
  if (device.protocol === 'zigbee' && ZIGBEE_COORDINATOR_INTEGRATIONS.includes(device.integration)) {
    const coordinator = present(isZigbeeCoordinator);
    const via = INTEGRATION_LABELS[device.integration];
    const extra = def.requiresHub ? `; no necesita el hub de ${def.requiresHub}` : '';
    return coordinator
      ? { text: `Coordinador Zigbee (${via})${extra}`, missing: false }
      : { text: `Necesita un coordinador Zigbee para ${via} (no está en el proyecto)`, missing: true };
  }
  return { missing: false };
}

/**
 * Ficha técnica del dispositivo según su integración y protocolo actuales: conectividad
 * (local o nube, push o sondeo) sin repetir y dependencia de hub o coordinador real.
 */
export function deviceTechSummary(device: Device, def: DeviceDefinition, project: Pick<Project, 'devices'>, defs: DeviceDefinition[] = catalog): DeviceTechSummary {
  const iotClass = effectiveIotClass(device, def);
  const cloud = isCloud(iotClass);
  const locality = cloud ? 'Nube' : 'Local';
  const updates = UPDATES[iotClass];
  const connectivity = `${locality}, ${updates}`;
  const integration = INTEGRATION_LABELS[device.integration];
  const protocol = PROTOCOL_LABELS[device.protocol];
  const hub = hubText(device, def, project, defs);
  const rows: Array<[string, string]> = [
    ['Marca', def.brand],
    ['Modelo', def.model],
    ['Categoría', CATEGORY_LABELS[def.category]],
    ['Papel en la red', ROLE_LABELS[def.role]],
    ['Integración', integration],
    ['Protocolo', protocol],
    ['Conectividad', connectivity],
    ['Alimentación', POWER_LABELS[def.power]],
  ];
  if (hub.text) rows.push([hub.missing ? 'Falta' : 'Depende de', hub.text]);
  if (def.rangeMeters) rows.push(['Alcance', `${def.rangeMeters} m`]);
  const summary: DeviceTechSummary = {
    integration,
    protocol,
    iotClass,
    cloud,
    locality,
    updates,
    connectivity,
    hubMissing: hub.missing,
    rows,
    text: `${integration} por ${protocol} · ${connectivity}${hub.text ? ` · ${hub.text}` : ''}`,
  };
  if (hub.text) summary.hub = hub.text;
  return summary;
}
