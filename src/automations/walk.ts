// Recorridos genéricos de triggers, condiciones y acciones (incluidas las anidadas de la Fase 3:
// choose, if, repeat, wait_for_trigger, not). Funciones puras.
import type { Action, Condition, Trigger } from '../types';

export type EntityMapper = (entityId: string) => string;

export function mapTriggerEntities(t: Trigger, map: EntityMapper): Trigger {
  switch (t.type) {
    case 'state':
    case 'numeric_state':
    case 'device_action':
      return { ...t, entityId: map(t.entityId) };
    case 'time':
    case 'sun':
    case 'zone':
      return t;
  }
}

export function mapConditionEntities(c: Condition, map: EntityMapper): Condition {
  switch (c.type) {
    case 'state':
    case 'numeric_state':
      return { ...c, entityId: map(c.entityId) };
    case 'and':
    case 'or':
    case 'not':
      return { ...c, conditions: c.conditions.map((x) => mapConditionEntities(x, map)) };
    case 'time':
    case 'sun':
    case 'zone':
      return c;
  }
}

const mapConds = (cs: Condition[], map: EntityMapper): Condition[] => cs.map((c) => mapConditionEntities(c, map));

const domainOf = (id: string): string => (id.includes('.') ? id.slice(0, id.indexOf('.')) : '');

/** Dominios de servicio que no dependen del dominio de la entidad de destino. */
const NEUTRAL_SERVICE_DOMAINS = new Set(['homeassistant', 'scene', 'script', 'notify', 'persistent_notification']);

/**
 * Servicio tras cambiar de dominio la entidad (switch.x → light.x por «Mostrar como luz»):
 * «switch.turn_on» pasa a «light.turn_on». Los servicios neutros (homeassistant.*) no cambian.
 */
export function remapServiceDomain(service: string, oldEntityId: string, newEntityId: string): string {
  const from = domainOf(oldEntityId);
  const to = domainOf(newEntityId);
  if (from === to || !service.includes('.')) return service;
  const [domain = '', name = ''] = service.split('.');
  if (domain !== from || NEUTRAL_SERVICE_DOMAINS.has(domain)) return service;
  return `${to}.${name}`;
}

const TEMPLATE_BLOCK = /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g;
const QUOTED_ENTITY = /(['"])([a-z_]+\.[a-z0-9_]+)\1/g;

/** Reescribe los entity_id entre comillas dentro de las plantillas {{ ... }} de un texto. */
export function mapTemplateEntities(text: string, map: EntityMapper): string {
  if (!text.includes('{')) return text;
  return text.replace(TEMPLATE_BLOCK, (block) => block.replace(QUOTED_ENTITY, (whole, q: string, id: string) => {
    const to = map(id);
    return to === id ? whole : `${q}${to}${q}`;
  }));
}

function mapDataTemplates<V>(data: Record<string, V>, map: EntityMapper): Record<string, V> {
  let changed = false;
  const out: Record<string, V> = {};
  for (const [k, v] of Object.entries(data)) {
    const next = typeof v === 'string' ? (mapTemplateEntities(v, map) as V) : v;
    if (next !== v) changed = true;
    out[k] = next;
  }
  return changed ? out : data;
}

/**
 * Reescribe los entity_id de una acción y de todas sus acciones anidadas: destino de los
 * servicios (y su dominio si la entidad cambia de dominio), condiciones, disparadores de espera y
 * entidades citadas en plantillas {{ states('x') }}.
 */
export function mapActionEntities(a: Action, map: EntityMapper): Action {
  const seq = (xs: Action[]): Action[] => xs.map((x) => mapActionEntities(x, map));
  switch (a.type) {
    case 'service': {
      const entityId = map(a.entityId);
      const next: Action = { ...a, entityId, service: remapServiceDomain(a.service, a.entityId, entityId) };
      if (a.data) next.data = mapDataTemplates(a.data, map);
      return next;
    }
    case 'choose': {
      const next: Action = { ...a, choices: a.choices.map((o) => ({ conditions: mapConds(o.conditions, map), sequence: seq(o.sequence) })) };
      if (a.default) next.default = seq(a.default);
      return next;
    }
    case 'if': {
      const next: Action = { ...a, conditions: mapConds(a.conditions, map), then: seq(a.then) };
      if (a.else) next.else = seq(a.else);
      return next;
    }
    case 'repeat': {
      const next: Action = { ...a, sequence: seq(a.sequence) };
      if (a.while) next.while = mapConds(a.while, map);
      if (a.until) next.until = mapConds(a.until, map);
      return next;
    }
    case 'wait_for_trigger':
      return { ...a, triggers: a.triggers.map((t) => mapTriggerEntities(t, map)) };
    case 'notify': {
      const next: Action = { ...a, message: mapTemplateEntities(a.message, map) };
      if (a.title !== undefined) next.title = mapTemplateEntities(a.title, map);
      return next;
    }
    case 'variables':
      return { ...a, variables: mapDataTemplates(a.variables, map) };
    case 'scene':
    case 'script':
    case 'delay':
      return a;
  }
}

/** entity_id que lee un disparador. */
export function triggerEntityIds(t: Trigger): string[] {
  return t.type === 'state' || t.type === 'numeric_state' || t.type === 'device_action' ? [t.entityId] : [];
}

/** entity_id que lee una condición (anidadas incluidas). */
export function conditionEntityIds(c: Condition): string[] {
  switch (c.type) {
    case 'state':
    case 'numeric_state':
      return [c.entityId];
    case 'and':
    case 'or':
    case 'not':
      return c.conditions.flatMap(conditionEntityIds);
    case 'time':
    case 'sun':
    case 'zone':
      return [];
  }
}

/** Acciones hijas directas (ramas de choose/if, cuerpo de repeat). */
export function childActions(a: Action): Action[] {
  switch (a.type) {
    case 'choose':
      return [...a.choices.flatMap((o) => o.sequence), ...(a.default ?? [])];
    case 'if':
      return [...a.then, ...(a.else ?? [])];
    case 'repeat':
      return a.sequence;
    default:
      return [];
  }
}

/** Condiciones propias de una acción (choose, if, repeat). */
export function actionConditions(a: Action): Condition[] {
  switch (a.type) {
    case 'choose':
      return a.choices.flatMap((o) => o.conditions);
    case 'if':
      return a.conditions;
    case 'repeat':
      return [...(a.while ?? []), ...(a.until ?? [])];
    default:
      return [];
  }
}

/** Todas las acciones en profundidad (la propia y las anidadas), en orden. */
export function flattenActions(actions: Action[]): Action[] {
  return actions.flatMap((a) => [a, ...flattenActions(childActions(a))]);
}

/** entity_id que leen o escriben una lista de acciones (anidadas incluidas). */
export function actionEntityIds(actions: Action[]): string[] {
  const ids: string[] = [];
  for (const a of flattenActions(actions)) {
    if (a.type === 'service') ids.push(a.entityId);
    if (a.type === 'wait_for_trigger') ids.push(...a.triggers.flatMap(triggerEntityIds));
    ids.push(...actionConditions(a).flatMap(conditionEntityIds));
  }
  return ids;
}
