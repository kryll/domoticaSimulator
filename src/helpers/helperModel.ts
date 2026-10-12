// Alta, edición y baja de helpers en el proyecto (funciones puras sobre Project).
import type { EntityState, Helper, HelperType, Project } from '../types';
import { renameEntityRefs } from '../devices/renaming';
import { HELPER_TYPE_LABELS, helperEntityId, parseTimerDuration } from '../simulation/helpers';

/** Helper nuevo con valores razonables para cada tipo. */
export function defaultHelper(type: HelperType, id: string, name = HELPER_TYPE_LABELS[type]): Helper {
  switch (type) {
    case 'input_boolean':
      return { id, type, name, initial: false };
    case 'input_number':
      return { id, type, name, min: 0, max: 100, step: 1, mode: 'slider' };
    case 'input_select':
      return { id, type, name, options: ['Opción 1', 'Opción 2'] };
    case 'input_text':
      return { id, type, name, max: 100 };
    case 'input_datetime':
      return { id, type, name, has_date: false, has_time: true };
    case 'timer':
      return { id, type, name, duration: 300 };
    case 'counter':
      return { id, type, name, initial: 0, step: 1 };
  }
}

/** Nombre que no choca con el entity_id de otro helper del mismo tipo («Contador 2»...). */
export function uniqueHelperName(project: Pick<Project, 'helpers'>, h: Pick<Helper, 'type' | 'name' | 'id'>): string {
  const taken = new Set((project.helpers ?? []).filter((x) => x.id !== h.id).map(helperEntityId));
  const base = h.name.trim() || HELPER_TYPE_LABELS[h.type];
  if (!taken.has(helperEntityId({ type: h.type, name: base }))) return base;
  for (let i = 2; ; i++) {
    const name = `${base} ${i}`;
    if (!taken.has(helperEntityId({ type: h.type, name }))) return name;
  }
}

/** entity_id anterior → nuevo si al guardar cambia el del helper. */
export function helperRenameMapping(project: Pick<Project, 'helpers'>, next: Helper): Record<string, string> {
  const old = project.helpers?.find((h) => h.id === next.id);
  if (!old) return {};
  const from = helperEntityId(old);
  const to = helperEntityId(next);
  return from === to ? {} : { [from]: to };
}

/** Guarda un helper (nuevo o existente) y actualiza las referencias si cambia su entity_id. */
export function saveHelper(project: Project, helper: Helper): Project {
  const named: Helper = { ...helper, name: uniqueHelperName(project, helper) };
  const mapping = helperRenameMapping(project, named);
  const list = project.helpers ?? [];
  const exists = list.some((h) => h.id === named.id);
  const next: Project = { ...project, helpers: exists ? list.map((h) => (h.id === named.id ? named : h)) : [...list, named] };
  return Object.keys(mapping).length > 0 ? renameEntityRefs(next, mapping) : next;
}

export function removeHelper(project: Project, id: string): Project {
  const list = project.helpers ?? [];
  if (!list.some((h) => h.id === id)) return project;
  return { ...project, helpers: list.filter((h) => h.id !== id) };
}

/** ¿Lo usa alguna automatización, escena o script? (para avisar antes de borrar). */
export function helperUsage(project: Project, entityId: string): string[] {
  const used: string[] = [];
  const mentions = (x: unknown) => JSON.stringify(x).includes(`"${entityId}"`) || JSON.stringify(x).includes(`${entityId}`);
  for (const a of project.automations) if (mentions(a)) used.push(`automatización «${a.name}»`);
  for (const s of project.scripts) if (mentions(s)) used.push(`script «${s.name}»`);
  for (const s of project.scenes) if (mentions(s.entities)) used.push(`escena «${s.name}»`);
  return used;
}

/** Icono de cada tipo de helper (interfaz). */
export const HELPER_ICONS: Record<HelperType, string> = {
  input_boolean: '🔘',
  input_number: '🎚️',
  input_select: '📋',
  input_text: '✏️',
  input_datetime: '📅',
  timer: '⏲️',
  counter: '🔢',
};

/** Segundos que le quedan a un timer (en marcha: hasta finishes_at según el reloj simulado). */
export function timerRemaining(st: EntityState | undefined, now: number, fallback: number): number {
  const a = st?.attributes ?? {};
  if (st?.state === 'active' && typeof a.finishes_at === 'string') return Math.max(0, Math.ceil((Date.parse(a.finishes_at) - now) / 1000));
  if (st?.state === 'paused') return parseTimerDuration(a.remaining) ?? fallback;
  return parseTimerDuration(a.duration) ?? fallback;
}

