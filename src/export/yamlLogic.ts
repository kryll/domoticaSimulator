// YAML de Home Assistant para los disparadores, condiciones y acciones de la Fase 3
// (zone, device, not, choose, if, wait_for_trigger, repeat, notify, variables), con la sintaxis
// actual de HA como yaml.ts: `trigger:` en lugar de `platform:` y `action:` en lugar de `service:`.
import type {
  Action,
  Condition,
  DeviceActionTrigger,
  NotCondition,
  Trigger,
  ZoneCondition,
  ZoneTrigger,
} from '../types';
import { actionToYaml, conditionToYaml, formatHms, triggerToYaml, type YamlContext, type YamlMap, type YamlValue } from './yaml';

export { HOME_ZONE_ID, personRef, resolvePersonRef, resolveZoneRef, zoneRef, type PeopleContext } from '../devices/refs';
import { personRef, zoneRef } from '../devices/refs';

type Fase3Trigger = ZoneTrigger | DeviceActionTrigger;
type Fase3Condition = NotCondition | ZoneCondition;

export function fase3TriggerToYaml(t: Fase3Trigger, ctx: YamlContext): YamlMap {
  if (t.type === 'zone') {
    return { trigger: 'zone', entity_id: personRef(t.personId, ctx), zone: zoneRef(t.zoneId, ctx), event: t.event };
  }
  // Disparador de dispositivo de un mando. En HA real necesitaría device_id, que el simulador no
  // conoce: se exporta siempre como disparador de estado de la entidad de acción (to: <acción>).
  return triggerToYaml(deviceActionAsStateTrigger(t), ctx);
}

/** Equivalente compatible con HA real (sin device_id): disparador de estado de la entidad de acción. */
export function deviceActionAsStateTrigger(t: DeviceActionTrigger): Trigger {
  return { type: 'state', entityId: t.entityId, to: t.action };
}

export function fase3ConditionToYaml(c: Fase3Condition, ctx: YamlContext): YamlMap {
  if (c.type === 'not') return { condition: 'not', conditions: c.conditions.map((x) => conditionToYaml(x, ctx)) };
  return { condition: 'zone', entity_id: personRef(c.personId, ctx), zone: zoneRef(c.zoneId, ctx) };
}

type Fase3Action = Exclude<Action, { type: 'service' | 'scene' | 'script' | 'delay' }>;

const seq = (actions: Action[], ctx: YamlContext): YamlValue[] => actions.map((a) => actionToYaml(a, ctx));
const conds = (cs: Condition[], ctx: YamlContext): YamlValue[] => cs.map((c) => conditionToYaml(c, ctx));

export function fase3ActionToYaml(a: Fase3Action, ctx: YamlContext): YamlMap {
  switch (a.type) {
    case 'choose': {
      const m: YamlMap = { choose: a.choices.map((o) => ({ conditions: conds(o.conditions, ctx), sequence: seq(o.sequence, ctx) })) };
      if (a.default && a.default.length > 0) m.default = seq(a.default, ctx);
      return m;
    }
    case 'if': {
      const m: YamlMap = { if: conds(a.conditions, ctx), then: seq(a.then, ctx) };
      if (a.else && a.else.length > 0) m.else = seq(a.else, ctx);
      return m;
    }
    case 'wait_for_trigger': {
      const m: YamlMap = { wait_for_trigger: a.triggers.map((t) => triggerToYaml(t, ctx)) };
      if (a.timeoutSeconds !== undefined) m.timeout = formatHms(a.timeoutSeconds);
      if (a.continueOnTimeout === false) m.continue_on_timeout = false;
      return m;
    }
    case 'repeat': {
      const r: YamlMap = {};
      if (a.count !== undefined) r.count = a.count;
      if (a.while !== undefined) r.while = conds(a.while, ctx);
      if (a.until !== undefined) r.until = conds(a.until, ctx);
      r.sequence = seq(a.sequence, ctx);
      return { repeat: r };
    }
    case 'notify': {
      const data: YamlMap = {};
      if (a.title !== undefined && a.title !== '') data.title = a.title;
      data.message = a.message;
      return { action: a.service ?? 'notify.notify', data };
    }
    case 'variables':
      return { variables: { ...a.variables } };
    case 'stop': {
      const m: YamlMap = { stop: a.message };
      if (a.error) m.error = true;
      return m;
    }
    case 'parallel':
      // Una rama de una sola acción se escribe tal cual; las de varias, como `sequence:`.
      return { parallel: a.branches.map((b): YamlValue => (b.length === 1 && b[0] ? actionToYaml(b[0], ctx) : { sequence: seq(b, ctx) })) };
  }
}
