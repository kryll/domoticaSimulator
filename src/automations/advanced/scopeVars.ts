// Variables disponibles en un punto del editor de acciones (solo interfaz).
import type { Action, Trigger } from '../../types';

export interface ActionScope {
  /** Variables de las acciones «Variables» del nivel superior anteriores a este punto. */
  topLevel: string[];
  /** Variables de las acciones «Variables» de las secuencias anidadas que lo contienen. */
  local: string[];
  /** Dentro de un «Repetir»: existen repeat.index y repeat.first. */
  inRepeat: boolean;
  /** Repetir un número de veces: existe además repeat.last. */
  repeatCount?: boolean;
  /** Hay un «Esperar a un disparador» antes en la ejecución: existe wait.trigger.*. */
  afterWait?: boolean;
  /** Tipos de disparador de la automatización (vacío en scripts: no hay trigger.*). */
  triggerTypes: Array<Trigger['type']>;
  /** Profundidad de la secuencia (0 = acciones de la automatización o del script). */
  depth: number;
}

export const ROOT_SCOPE: ActionScope = { topLevel: [], local: [], inRepeat: false, triggerTypes: [], depth: 0 };

export interface ScopeVariable {
  name: string;
  kind: 'top' | 'local' | 'repeat' | 'trigger';
  hint: string;
}

/** Nombres que definen las acciones «Variables» anteriores a `index` en una secuencia. */
export function definedBefore(actions: Action[], index: number): string[] {
  const names: string[] = [];
  for (const a of actions.slice(0, index)) if (a.type === 'variables') names.push(...Object.keys(a.variables));
  return names;
}

/** Ámbito de la acción `index` de una secuencia, a partir del ámbito de la secuencia. */
export function scopeForItem(parent: ActionScope, actions: Action[], index: number): ActionScope {
  const names = definedBefore(actions, index);
  const afterWait = parent.afterWait === true || actions.slice(0, index).some((a) => a.type === 'wait_for_trigger');
  return parent.depth === 0
    ? { ...parent, afterWait, topLevel: [...parent.topLevel, ...names] }
    : { ...parent, afterWait, local: [...parent.local, ...names] };
}

const STATE_TRIGGERS = new Set<Trigger['type']>(['state', 'numeric_state', 'device_action']);

/** Variables trigger.* según los tipos de disparador (las que resuelve el motor). */
export function triggerVariables(types: Array<Trigger['type']>): ScopeVariable[] {
  if (types.length === 0) return [];
  const out: ScopeVariable[] = [{ name: 'trigger.platform', kind: 'trigger', hint: 'Tipo de disparador' }];
  if (types.some((t) => STATE_TRIGGERS.has(t) || t === 'zone')) {
    out.push({ name: 'trigger.entity_id', kind: 'trigger', hint: 'Entidad que disparó' });
    out.push({ name: 'trigger.from_state.state', kind: 'trigger', hint: 'Estado anterior' });
    out.push({ name: 'trigger.to_state.state', kind: 'trigger', hint: 'Estado nuevo' });
  }
  return out;
}

/** Todas las variables utilizables en ese punto, sin repetir (la local tapa a la de nivel superior). */
export function availableVariables(scope: ActionScope): ScopeVariable[] {
  const seen = new Set<string>();
  const out: ScopeVariable[] = [];
  const add = (v: ScopeVariable) => {
    if (seen.has(v.name)) return;
    seen.add(v.name);
    out.push(v);
  };
  for (const n of [...scope.local].reverse()) add({ name: n, kind: 'local', hint: 'Variable local' });
  for (const n of scope.topLevel) add({ name: n, kind: 'top', hint: 'Variable de la automatización' });
  if (scope.inRepeat) {
    add({ name: 'repeat.index', kind: 'repeat', hint: 'Vuelta actual (desde 1)' });
    add({ name: 'repeat.first', kind: 'repeat', hint: '¿Primera vuelta?' });
    if (scope.repeatCount) add({ name: 'repeat.last', kind: 'repeat', hint: '¿Última vuelta?' });
  }
  if (scope.afterWait) {
    add({ name: 'wait.trigger.entity_id', kind: 'trigger', hint: 'Entidad que terminó la espera' });
    add({ name: 'wait.trigger.to_state.state', kind: 'trigger', hint: 'Estado que terminó la espera' });
  }
  for (const v of triggerVariables(scope.triggerTypes)) add(v);
  return out;
}

/** Inserta `token` en `text` en la posición del cursor (o al final). */
export function insertAt(text: string, token: string, start?: number | null, end?: number | null): { text: string; caret: number } {
  const s = start ?? text.length;
  const e = end ?? s;
  const before = text.slice(0, s);
  const sep = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
  const next = `${before}${sep}${token}${text.slice(e)}`;
  return { text: next, caret: before.length + sep.length + token.length };
}
