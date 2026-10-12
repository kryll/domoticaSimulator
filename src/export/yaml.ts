// Serializador YAML propio (sin dependencias) y exportación al formato de Home Assistant.
import type { Action, Automation, Condition, Project, Scene, Script, Trigger } from '../types';
import { slugify } from '../devices/entities';

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
export interface YamlContext {
  scenes?: Scene[];
  scripts?: Script[];
}

function sceneEntity(id: string, ctx: YamlContext): string {
  const scene = ctx.scenes?.find((s) => s.id === id);
  return `scene.${scene ? slugify(scene.name) : id}`;
}

function scriptEntity(id: string, ctx: YamlContext): string {
  const script = ctx.scripts?.find((s) => s.id === id);
  return `script.${script ? slugify(script.name) : id}`;
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(Math.round(minutes));
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}:00`;
}

export function triggerToYaml(t: Trigger): YamlMap {
  switch (t.type) {
    case 'state': {
      const m: YamlMap = { platform: 'state', entity_id: t.entityId };
      if (t.from !== undefined) m.from = String(t.from);
      if (t.to !== undefined) m.to = String(t.to);
      return m;
    }
    case 'numeric_state': {
      const m: YamlMap = { platform: 'numeric_state', entity_id: t.entityId };
      if (t.above !== undefined) m.above = t.above;
      if (t.below !== undefined) m.below = t.below;
      return m;
    }
    case 'time':
      return { platform: 'time', at: t.at };
    case 'sun': {
      const m: YamlMap = { platform: 'sun', event: t.event };
      if (t.offsetMinutes) m.offset = formatOffset(t.offsetMinutes);
      return m;
    }
  }
}

export function conditionToYaml(c: Condition): YamlMap {
  switch (c.type) {
    case 'state':
      return { condition: 'state', entity_id: c.entityId, state: String(c.state) };
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
    case 'and':
    case 'or':
      return { condition: c.type, conditions: c.conditions.map(conditionToYaml) };
  }
}

export function actionToYaml(a: Action, ctx: YamlContext = {}): YamlMap {
  switch (a.type) {
    case 'service': {
      const m: YamlMap = { service: a.service, target: { entity_id: a.entityId } };
      if (a.data && Object.keys(a.data).length > 0) m.data = { ...a.data };
      return m;
    }
    case 'scene':
      return { service: 'scene.turn_on', target: { entity_id: sceneEntity(a.sceneId, ctx) } };
    case 'script':
      return { service: 'script.turn_on', target: { entity_id: scriptEntity(a.scriptId, ctx) } };
    case 'delay':
      return { delay: { seconds: a.seconds } };
  }
}

export function automationToObject(a: Automation, ctx: YamlContext = {}): YamlMap {
  const m: YamlMap = { id: a.id, alias: a.name, mode: a.mode };
  if (!a.enabled) m.initial_state = false;
  m.trigger = a.triggers.map(triggerToYaml);
  m.condition = a.conditions.map(conditionToYaml);
  m.action = a.actions.map((x) => actionToYaml(x, ctx));
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

/** scenes.yaml: los atributos se aplanan junto a state, como en HA. */
export function scenesToYaml(project: Project): string {
  return toYaml(
    project.scenes.map((s) => {
      const entities: YamlMap = {};
      for (const [entityId, st] of Object.entries(s.entities)) {
        entities[entityId] = { state: typeof st.state === 'boolean' ? (st.state ? 'on' : 'off') : st.state, ...st.attributes };
      }
      return { id: s.id, name: s.name, entities };
    }),
  );
}

/** scripts.yaml: mapa clave (slug del nombre, único) -> script. */
export function scriptsToYaml(project: Project): string {
  const root: YamlMap = {};
  for (const s of project.scripts) {
    const base = slugify(s.name);
    let key = base;
    for (let n = 2; key in root; n++) key = `${base}_${n}`;
    root[key] = { alias: s.name, sequence: s.sequence.map((a) => actionToYaml(a, project)) };
  }
  return toYaml(root);
}
