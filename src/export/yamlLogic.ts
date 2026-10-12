// YAML de Home Assistant para los disparadores, condiciones y acciones de la Fase 3
// (zone, device, not, choose, if, wait_for_trigger, repeat, notify, variables), con la sintaxis
// actual de HA como yaml.ts: `trigger:` en lugar de `platform:` y `action:` en lugar de `service:`.
import type {
  Action,
  Condition,
  DeviceActionTrigger,
  Id,
  NotCondition,
  Person,
  Trigger,
  Zone,
  ZoneCondition,
  ZoneTrigger,
} from '../types';
import { slugify } from '../devices/entities';
import { actionToYaml, conditionToYaml, formatHms, triggerToYaml, type YamlContext, type YamlMap, type YamlValue } from './yaml';

/** Contexto de personas y zonas (Project las tiene opcionales). */
export interface PeopleContext {
  people?: Person[];
  zones?: Zone[];
}

/** Id de la zona «Casa» implícita cuando el proyecto no define ninguna de tipo home. */
export const HOME_ZONE_ID = 'home';

/** entity_id de una persona: person.<slug del nombre> (o del id si no se conoce). */
export function personRef(personId: Id, ctx: PeopleContext): string {
  const person = ctx.people?.find((p) => p.id === personId);
  return `person.${slugify(person ? person.name : personId)}`;
}

/** entity_id de una zona: zone.home para la de casa; zone.<slug del nombre> para las demás. */
export function zoneRef(zoneId: Id, ctx: PeopleContext): string {
  const zone = ctx.zones?.find((z) => z.id === zoneId);
  if (zoneId === HOME_ZONE_ID || zone?.kind === 'home') return 'zone.home';
  return `zone.${slugify(zone ? zone.name : zoneId)}`;
}

/** Inversa de personRef: id de la persona (sin contexto, el texto tras el punto). */
export function resolvePersonRef(ref: string, ctx: PeopleContext): Id {
  const key = ref.replace(/^person\./, '');
  if (!ctx.people) return key;
  const person = ctx.people.find((p) => p.id === key || slugify(p.name) === key);
  if (!person) throw new Error(`Persona desconocida: ${ref}`);
  return person.id;
}

/** Inversa de zoneRef: id de la zona. zone.home -> la zona de tipo home o «home». */
export function resolveZoneRef(ref: string, ctx: PeopleContext): Id {
  const key = ref.replace(/^zone\./, '');
  if (key === 'home') return ctx.zones?.find((z) => z.kind === 'home')?.id ?? HOME_ZONE_ID;
  if (!ctx.zones) return key;
  const zone = ctx.zones.find((z) => z.id === key || slugify(z.name) === key);
  if (!zone) throw new Error(`Zona desconocida: ${ref}`);
  return zone.id;
}

type Fase3Trigger = ZoneTrigger | DeviceActionTrigger;
type Fase3Condition = NotCondition | ZoneCondition;

export function fase3TriggerToYaml(t: Fase3Trigger, ctx: YamlContext): YamlMap {
  if (t.type === 'zone') {
    return { trigger: 'zone', entity_id: personRef(t.personId, ctx), zone: zoneRef(t.zoneId, ctx), event: t.event };
  }
  // Disparador de dispositivo de un mando. En HA real lleva device_id; aquí se identifica por
  // la entidad de acción. Para exportar a HA real usar deviceActionAsStateTrigger.
  return { trigger: 'device', domain: 'sensor', entity_id: t.entityId, type: 'action', subtype: t.action };
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
  }
}
