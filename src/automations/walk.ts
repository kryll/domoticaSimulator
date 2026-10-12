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
    case 'zone':
      return c;
  }
}

const mapConds = (cs: Condition[], map: EntityMapper): Condition[] => cs.map((c) => mapConditionEntities(c, map));

/** Reescribe los entity_id de una acción y de todas sus acciones anidadas. */
export function mapActionEntities(a: Action, map: EntityMapper): Action {
  const seq = (xs: Action[]): Action[] => xs.map((x) => mapActionEntities(x, map));
  switch (a.type) {
    case 'service':
      return { ...a, entityId: map(a.entityId) };
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
    case 'scene':
    case 'script':
    case 'delay':
    case 'notify':
    case 'variables':
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
