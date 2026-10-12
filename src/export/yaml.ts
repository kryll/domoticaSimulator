// Serializador YAML propio (sin dependencias) y exportación al formato de Home Assistant
// (sintaxis actual: triggers:/- trigger:, conditions:/- condition:, actions:/- action:).
import type { Action, Automation, Condition, EntityStateValue, Project, Room, Scene, Script, ServiceAction, Trigger } from '../types';
import { areaId } from '../devices/areas';
import { serviceAreaIds, serviceEntityIds } from '../automations/walk';
import { slugify } from '../devices/entities';
import { sceneEntityState } from '../simulation/scenes';
import { scriptEntityId, scriptKeys } from '../simulation/scriptKeys';
import { fase3ActionToYaml, fase3ConditionToYaml, fase3TriggerToYaml, type PeopleContext } from './yamlLogic';

export type YamlScalar = string | number | boolean | null;
export type YamlValue = YamlScalar | YamlValue[] | YamlMap;
export interface YamlMap {
  [key: string]: YamlValue;
}

// ---------- Serializador genérico ----------

const RESERVED = /^(true|false|yes|no|on|off|y|n|null|~)$/i;
const NUMBER_LIKE = /^[-+]?(\.?\d|\.inf|\.nan)/i;
const SPECIAL_START = /^[-?:,[\]{}#&*!|>'"%@`]/;

function hasControlChars(s: string): boolean {
  return [...s].some((ch) => {
    const code = ch.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
}

function needsQuotes(s: string): boolean {
  return (
    s === '' ||
    s !== s.trim() ||
    RESERVED.test(s) ||
    NUMBER_LIKE.test(s) ||
    SPECIAL_START.test(s) ||
    /[:#]/.test(s) ||
    hasControlChars(s)
  );
}

export function formatScalar(v: YamlScalar): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : v > 0 ? '.inf' : v < 0 ? '-.inf' : '.nan';
  return needsQuotes(v) ? JSON.stringify(v) : v;
}

export function isYamlMap(v: YamlValue): v is YamlMap {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function inlineValue(v: YamlValue): string | undefined {
  if (Array.isArray(v)) return v.length === 0 ? '[]' : undefined;
  if (isYamlMap(v)) return Object.keys(v).length === 0 ? '{}' : undefined;
  return formatScalar(v);
}

function emitSeq(items: YamlValue[], indent: number): string[] {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];
  for (const item of items) {
    const inline = inlineValue(item);
    if (inline !== undefined) {
      lines.push(`${pad}- ${inline}`);
    } else if (isYamlMap(item)) {
      const [first = '', ...rest] = emitMap(item, indent + 2);
      lines.push(`${pad}- ${first.trimStart()}`, ...rest);
    } else {
      lines.push(`${pad}-`, ...emitNode(item, indent + 2));
    }
  }
  return lines;
}

function emitMap(map: YamlMap, indent: number): string[] {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];
  for (const [key, value] of Object.entries(map)) {
    const k = formatScalar(key);
    const inline = inlineValue(value);
    if (inline !== undefined) lines.push(`${pad}${k}: ${inline}`);
    else lines.push(`${pad}${k}:`, ...emitNode(value, indent + 2));
  }
  return lines;
}

function emitNode(v: YamlValue, indent: number): string[] {
  const inline = inlineValue(v);
  if (inline !== undefined) return [' '.repeat(indent) + inline];
  return Array.isArray(v) ? emitSeq(v, indent) : emitMap(v as YamlMap, indent);
}

/** Convierte un valor en YAML (bloques, sangría de 2 espacios, termina en salto de línea). */
export function toYaml(value: YamlValue): string {
  return `${emitNode(value, 0).join('\n')}\n`;
}

// ---------- Home Assistant ----------

/** Escenas y scripts para resolver entity_id legibles (scene.<slug>, script.<slug>). */
export interface YamlContext extends PeopleContext {
  scenes?: Scene[];
  scripts?: Script[];
  /** Salas, para escribir y leer `area_id` (slug del nombre de la sala). */
  rooms?: Room[];
}

function sceneEntity(id: string, ctx: YamlContext): string {
  const scene = ctx.scenes?.find((s) => s.id === id);
  return `scene.${scene ? slugify(scene.name) : id}`;
}

function scriptEntity(id: string, ctx: YamlContext): string {
  return scriptEntityId(ctx.scripts ?? [], id);
}

/** Estado de HA como texto: los booleanos se escriben 'on'/'off'. */
export function stateToYaml(v: EntityStateValue): string {
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  return String(v);
}

/**
 * Estado para `to:`/`from:`/`state:`: los booleanos como 'on'/'off' y los números se conservan
 * como números (HA los convierte a texto al comparar, así que `to: 21.5` equivale a "21.5", pero
 * así la ida y vuelta devuelve el mismo tipo).
 */
export function stateValueToYaml(v: EntityStateValue): string | number {
  return typeof v === 'number' ? v : stateToYaml(v);
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(Math.round(minutes));
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}:00`;
}

/** Segundos -> "HH:MM:SS" (formato de `for:` y `delay:` en HA). */
export function formatHms(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/** Lista numérica escrita como texto ("[255, 0, 0]") -> lista YAML; el resto, tal cual. */
function dataValueToYaml(v: EntityStateValue): YamlValue {
  if (typeof v === 'string' && /^\[\s*-?[\d.]+(\s*,\s*-?[\d.]+)*\s*\]$/.test(v.trim())) {
    return v.trim().slice(1, -1).split(',').map((x) => Number(x.trim()));
  }
  return v;
}

function dataToYaml(data: Record<string, EntityStateValue>): YamlMap {
  const m: YamlMap = {};
  for (const [k, v] of Object.entries(data)) m[k] = dataValueToYaml(v);
  return m;
}

export function triggerToYaml(t: Trigger, ctx: YamlContext = {}): YamlMap {
  const m = triggerBodyToYaml(t, ctx);
  if (t.id === undefined || t.id === '') return m;
  // `id` justo después de `trigger:`, como lo escribe el editor de HA.
  const [first, ...rest] = Object.entries(m);
  return Object.fromEntries([...(first ? [first] : []), ['id', t.id], ...rest.filter(([k]) => k !== 'id')]) as YamlMap;
}

function triggerBodyToYaml(t: Trigger, ctx: YamlContext): YamlMap {
  switch (t.type) {
    case 'state': {
      const m: YamlMap = { trigger: 'state', entity_id: t.entityId };
      if (t.from !== undefined) m.from = stateValueToYaml(t.from);
      if (t.to !== undefined) m.to = stateValueToYaml(t.to);
      if (t.for !== undefined && t.for > 0) m.for = formatHms(t.for);
      return m;
    }
    case 'numeric_state': {
      const m: YamlMap = { trigger: 'numeric_state', entity_id: t.entityId };
      if (t.above !== undefined) m.above = t.above;
      if (t.below !== undefined) m.below = t.below;
      return m;
    }
    case 'time':
      return { trigger: 'time', at: t.at };
    case 'sun': {
      const m: YamlMap = { trigger: 'sun', event: t.event };
      if (t.offsetMinutes) m.offset = formatOffset(t.offsetMinutes);
      return m;
    }
    case 'zone':
    case 'device_action':
      return fase3TriggerToYaml(t, ctx);
  }
}

export function conditionToYaml(c: Condition, ctx: YamlContext = {}): YamlMap {
  switch (c.type) {
    case 'state': {
      const m: YamlMap = { condition: 'state', entity_id: c.entityId, state: stateValueToYaml(c.state) };
      if (c.for !== undefined && c.for > 0) m.for = formatHms(c.for);
      return m;
    }
    case 'numeric_state': {
      const m: YamlMap = { condition: 'numeric_state', entity_id: c.entityId };
      if (c.above !== undefined) m.above = c.above;
      if (c.below !== undefined) m.below = c.below;
      return m;
    }
    case 'time': {
      const m: YamlMap = { condition: 'time' };
      if (c.after !== undefined) m.after = c.after;
      if (c.before !== undefined) m.before = c.before;
      return m;
    }
    case 'sun': {
      const m: YamlMap = { condition: 'sun' };
      if (c.after !== undefined) m.after = c.after;
      if (c.afterOffsetMinutes) m.after_offset = formatOffset(c.afterOffsetMinutes);
      if (c.before !== undefined) m.before = c.before;
      if (c.beforeOffsetMinutes) m.before_offset = formatOffset(c.beforeOffsetMinutes);
      return m;
    }
    case 'and':
    case 'or':
      return { condition: c.type, conditions: c.conditions.map((x) => conditionToYaml(x, ctx)) };
    case 'not':
    case 'zone':
      return fase3ConditionToYaml(c, ctx);
    case 'trigger':
      return { condition: 'trigger', id: c.ids.length === 1 ? (c.ids[0] ?? '') : [...c.ids] };
  }
}

/** Una lista de un elemento se escribe como valor suelto (como hace HA). */
const oneOrList = (xs: string[]): YamlValue => (xs.length === 1 ? (xs[0] ?? '') : [...xs]);

/** `target:` de una llamada a servicio: entity_id (uno o varios) y area_id (slug de la sala). */
function serviceTargetToYaml(a: ServiceAction, ctx: YamlContext): YamlMap | undefined {
  const target: YamlMap = {};
  const entities = serviceEntityIds(a);
  if (entities.length > 0) target.entity_id = oneOrList(entities);
  const areas = serviceAreaIds(a).map((id) => {
    const room = ctx.rooms?.find((r) => r.id === id);
    return room ? areaId(room) : id;
  });
  if (areas.length > 0) target.area_id = oneOrList(areas);
  return Object.keys(target).length > 0 ? target : undefined;
}

export function actionToYaml(a: Action, ctx: YamlContext = {}): YamlMap {
  switch (a.type) {
    case 'service': {
      // notify.* no tiene entidad de destino.
      const target = serviceTargetToYaml(a, ctx);
      const m: YamlMap = target ? { action: a.service, target } : a.service.startsWith('notify.') ? { action: a.service } : { action: a.service, target: { entity_id: a.entityId } };
      if (a.data && Object.keys(a.data).length > 0) m.data = dataToYaml(a.data);
      return m;
    }
    case 'scene':
      return { action: 'scene.turn_on', target: { entity_id: sceneEntity(a.sceneId, ctx) } };
    case 'script':
      return { action: 'script.turn_on', target: { entity_id: scriptEntity(a.scriptId, ctx) } };
    case 'delay':
      return { delay: { seconds: a.seconds } };
    default:
      return fase3ActionToYaml(a, ctx);
  }
}

export function automationToObject(a: Automation, ctx: YamlContext = {}): YamlMap {
  const m: YamlMap = { id: a.id, alias: a.name, mode: a.mode };
  if (!a.enabled) m.initial_state = false;
  m.triggers = a.triggers.map((t) => triggerToYaml(t, ctx));
  m.conditions = a.conditions.map((c) => conditionToYaml(c, ctx));
  m.actions = a.actions.map((x) => actionToYaml(x, ctx));
  return m;
}

/** Una automatización como mapa YAML (formato del editor YAML de HA). */
export function automationToYaml(a: Automation, ctx: YamlContext = {}): string {
  return toYaml(automationToObject(a, ctx));
}

/** automations.yaml completo del proyecto. */
export function automationsToYaml(project: Project): string {
  return toYaml(project.automations.map((a) => automationToObject(a, project)));
}

/**
 * scenes.yaml: los atributos se aplanan junto a state, como en HA. Solo se exportan los
 * atributos relevantes por dominio (sin friendly_name, unidades ni device_class).
 */
export function scenesToYaml(project: Project): string {
  return toYaml(
    project.scenes.map((s) => {
      const entities: YamlMap = {};
      for (const [entityId, raw] of Object.entries(s.entities)) {
        const st = sceneEntityState(entityId, raw);
        entities[entityId] = { state: typeof st.state === 'boolean' ? stateToYaml(st.state) : st.state, ...dataToYaml(st.attributes ?? {}) };
      }
      return { id: s.id, name: s.name, entities };
    }),
  );
}

/** scripts.yaml: mapa clave (slug del nombre, único) -> script. */
export function scriptsToYaml(project: Project): string {
  const root: YamlMap = {};
  const keys = scriptKeys(project.scripts);
  for (const s of project.scripts) {
    root[keys[s.id] ?? s.id] = { alias: s.name, sequence: s.sequence.map((a) => actionToYaml(a, project)) };
  }
  return toYaml(root);
}
