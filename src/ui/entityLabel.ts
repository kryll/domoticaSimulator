import { foldText } from '../devices/text';

/** Etiquetas legibles de entidades: «Dispositivo · Entidad» sin repeticiones. */

function words(text: string): string[] {
  return foldText(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== '');
}

/** ¿El nombre de la entidad ya está contenido (palabra a palabra) en el del dispositivo? */
function redundant(deviceName: string, entityName: string): boolean {
  const dev = words(deviceName);
  const ent = words(entityName);
  if (ent.length === 0) return true;
  return ent.every((w) => dev.includes(w));
}

/**
 * «Termostato · Temperatura», pero «Termostato» (no «Termostato · Termostato») cuando la
 * entidad repite el nombre del dispositivo o este solo tiene una entidad.
 */
export function entityLabel(deviceName: string, entityName: string, singleEntity = false): string {
  if (singleEntity || redundant(deviceName, entityName)) return deviceName;
  return `${deviceName} · ${entityName}`;
}

export interface LabeledEntity {
  entityId: string;
  label: string;
}

/** Añade el entity_id solo a las etiquetas que salgan repetidas. */
export function disambiguate<T extends LabeledEntity>(items: T[]): T[] {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.label, (counts.get(i.label) ?? 0) + 1);
  return items.map((i) => ((counts.get(i.label) ?? 0) > 1 ? { ...i, label: `${i.label} (${i.entityId})` } : i));
}
