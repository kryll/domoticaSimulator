// Etiquetas de las entidades de escena (sin dependencias de React).
import type { Project } from '../types';
import { projectEntities, type EntityRef } from '../canvas/analysis';
import { disambiguate, entityLabel } from '../ui/entityLabel';

/** Dominios cuyo estado tiene sentido guardar en una escena. */
export const SCENE_DOMAINS = new Set(['light', 'switch', 'cover', 'climate', 'media_player', 'fan', 'lock', 'vacuum']);

export interface LabeledRef extends EntityRef {
  label: string;
}

/** Entidades del proyecto con su etiqueta «Dispositivo · Entidad» sin duplicados. */
export function labeledEntities(project: Project, filter: (r: EntityRef) => boolean = () => true): LabeledRef[] {
  const all = projectEntities(project);
  const perDevice = new Map<string, number>();
  for (const r of all) perDevice.set(r.device.id, (perDevice.get(r.device.id) ?? 0) + 1);
  return disambiguate(
    all.filter(filter).map((r) => ({ ...r, label: entityLabel(r.device.name, r.definition.name, perDevice.get(r.device.id) === 1) })),
  );
}
