// Exportación del inventario de dispositivos a CSV.
import type { DeviceDefinition, Project } from '../types';
import { INTEGRATION_LABELS, PROTOCOL_LABELS } from '../devices/labels';
import { isCloud } from '../devices/catalog';
import { effectiveIotClass } from '../devices/roles';

/** Separador de campos: punto y coma, como espera Excel con configuración regional española. */
export const CSV_SEPARATOR = ';';
/** Marca de orden de bytes UTF-8 para que Excel detecte la codificación. */
export const CSV_BOM = '\uFEFF';

export const CSV_HEADERS = ['Nombre', 'Marca', 'Modelo', 'Planta', 'Sala', 'Protocolo', 'Integración', 'Conectividad'] as const;

/** Escapa un campo CSV (RFC 4180 con separador «;») y neutraliza fórmulas de hoja de cálculo. */
export function csvField(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function devicesToCsv(project: Project, defs: DeviceDefinition[]): string {
  const rows: string[][] = [[...CSV_HEADERS]];
  for (const device of project.devices) {
    const def = defs.find((d) => d.id === device.definitionId);
    const floor = project.floors.find((f) => f.id === device.floorId);
    const room = project.rooms.find((r) => r.id === device.roomId);
    const iot = def ? effectiveIotClass(device, def) : undefined;
    rows.push([
      device.name,
      def?.brand ?? '',
      def?.model ?? '',
      floor?.name ?? '',
      room?.name ?? '',
      PROTOCOL_LABELS[device.protocol],
      INTEGRATION_LABELS[device.integration],
      iot === undefined ? '' : isCloud(iot) ? 'Nube' : 'Local',
    ]);
  }
  return `${CSV_BOM}${rows.map((r) => r.map(csvField).join(CSV_SEPARATOR)).join('\r\n')}\r\n`;
}
