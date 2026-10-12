// Parser YAML mínimo (bloques, escalares, comillas, flujo simple) y conversión a Automation.
import type { Action, Automation, ChooseOption, Condition, EntityStateValue, RepeatAction, SunEvent, Trigger } from '../types';
import { isYamlMap, type YamlContext, type YamlMap, type YamlValue } from '../export/yaml';
import { resolvePersonRef, resolveZoneRef } from '../export/yamlLogic';
import { findScene, findScript } from '../simulation/engine';
import { parseHHMM } from '../simulation/clock';
import { NOTIFY_PERSISTENT } from '../simulation/notify';

// ---------- Lexer de líneas ----------

interface Line {
  indent: number;
  text: string;
  no: number;
}

function err(no: number, msg: string): Error {
  return new Error(`YAML no válido (línea ${no}): ${msg}`);
}

/** Quita un comentario final "  # ..." respetando comillas. */
function stripComment(s: string): string {
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === '\\' && quote === '"') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && (i === 0 || s[i - 1] === ' ' || s[i - 1] === '\t')) {
      return s.slice(0, i).trimEnd();
    }
  }
  return s.trimEnd();
}

function tokenize(text: string): Line[] {
  const lines: Line[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    if (raw.includes('\t') && /^\s*\t/.test(raw)) throw err(i + 1, 'no se admiten tabuladores para sangrar');
    const content = stripComment(raw);
    if (content.trim() === '' || content.trim() === '---') return;
    lines.push({ indent: content.length - content.trimStart().length, text: content.trim(), no: i + 1 });
  });
  return lines;
}

// ---------- Escalares ----------

function parseDoubleQuoted(s: string, no: number): string {
  try {
    const v: unknown = JSON.parse(s);
    if (typeof v === 'string') return v;
  } catch {
    // se informa abajo
  }
  throw err(no, `cadena entre comillas dobles mal formada: ${s}`);
}

function splitFlow(inner: string): string[] {
  const parts: string[] = [];
  let quote: string | null = null;
  let current = '';
  for (const ch of inner) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ',') {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() !== '') parts.push(current.trim());
  return parts;
}

export function parseScalar(raw: string, no = 0): YamlValue {
  const s = raw.trim();
  if (s.startsWith('"')) return parseDoubleQuoted(s, no);
  if (s.startsWith("'")) {
    if (!s.endsWith("'") || s.length < 2) throw err(no, `cadena entre comillas simples mal formada: ${s}`);
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s.startsWith('[')) {
    if (!s.endsWith(']')) throw err(no, `lista en línea sin cerrar: ${s}`);
    return splitFlow(s.slice(1, -1)).map((p) => parseScalar(p, no));
  }
  if (s === '{}') return {};
  if (s.startsWith('{')) {
    if (!s.endsWith('}')) throw err(no, `mapa en línea sin cerrar: ${s}`);
    const map: YamlMap = {};
    for (const part of splitFlow(s.slice(1, -1))) {
      const kv = splitKey(part, no);
      if (!kv) throw err(no, `se esperaba "clave: valor" en el mapa en línea: ${part}`);
      map[kv.key] = parseScalar(kv.rest, no);
    }
    return map;
  }
  if (s === '' || s === 'null' || s === '~') return null;
  if (s === 'true' || s === 'True') return true;
  if (s === 'false' || s === 'False') return false;
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return Number(s);
  return s;
}

/** Separa "clave: valor" (el valor puede ser vacío). Devuelve undefined si no es un par. */
function splitKey(text: string, no: number): { key: string; rest: string } | undefined {
  let i = 0;
  let key: string;
  if (text.startsWith('"') || text.startsWith("'")) {
    const q = text[0];
    i = 1;
    while (i < text.length && text[i] !== q) i += text[i] === '\\' && q === '"' ? 2 : 1;
    const parsed = parseScalar(text.slice(0, i + 1), no);
    key = String(parsed);
    i++;
    if (text[i] !== ':') return undefined;
  } else {
    const m = /^([^:]*?):(\s|$)/.exec(text);
    if (!m || m[1] === undefined) return undefined;
    key = m[1].trim();
    i = m[1].length;
  }
  return { key, rest: text.slice(i + 1).trim() };
}

// ---------- Parser de bloques ----------

class Parser {
  private pos = 0;
  constructor(private readonly lines: Line[]) {}

  parseDocument(): YamlValue {
    const first = this.lines[0];
    if (!first) return null;
    const value = this.parseBlock(first.indent);
    const extra = this.lines[this.pos];
    if (extra) throw err(extra.no, 'sangría inesperada');
    return value;
  }

  private peek(): Line | undefined {
    return this.lines[this.pos];
  }

  private isSeqItem(line: Line): boolean {
    return line.text === '-' || line.text.startsWith('- ');
  }

  private parseBlock(indent: number): YamlValue {
    const line = this.peek();
    if (!line) return null;
    if (this.isSeqItem(line)) return this.parseSeq(indent);
    if (splitKey(line.text, line.no)) return this.parseMap(indent);
    this.pos++;
    return parseScalar(line.text, line.no);
  }

  private parseSeq(indent: number): YamlValue[] {
    const items: YamlValue[] = [];
    for (let line = this.peek(); line && line.indent === indent && this.isSeqItem(line); line = this.peek()) {
      const rest = line.text === '-' ? '' : line.text.slice(2).trim();
      if (rest === '') {
        this.pos++;
        const next = this.peek();
        items.push(next && next.indent > indent ? this.parseBlock(next.indent) : null);
      } else if (splitKey(rest, line.no) || rest.startsWith('- ')) {
        // "- clave: valor": el resto del elemento es un bloque sangrado tras "- ".
        const inner = indent + (line.text.length - rest.length);
        this.lines[this.pos] = { indent: inner, text: rest, no: line.no };
        items.push(this.parseBlock(inner));
      } else {
        this.pos++;
        items.push(parseScalar(rest, line.no));
      }
    }
    return items;
  }

  private parseMap(indent: number): YamlMap {
    const map: YamlMap = {};
    for (let line = this.peek(); line && line.indent === indent && !this.isSeqItem(line); line = this.peek()) {
      const kv = splitKey(line.text, line.no);
      if (!kv) throw err(line.no, `se esperaba "clave: valor" y se encontró "${line.text}"`);
      if (Object.prototype.hasOwnProperty.call(map, kv.key)) throw err(line.no, `clave repetida "${kv.key}"`);
      this.pos++;
      map[kv.key] = kv.rest === '' ? this.parseNested(indent) : parseScalar(kv.rest, line.no);
    }
    const after = this.peek();
    if (after && after.indent > indent) throw err(after.no, 'sangría inesperada');
    return map;
  }

  /** Valor de una clave vacía: bloque más sangrado, o lista al mismo nivel (estilo HA). */
  private parseNested(indent: number): YamlValue {
    const next = this.peek();
    if (!next) return null;
    if (next.indent > indent) return this.parseBlock(next.indent);
    if (next.indent === indent && this.isSeqItem(next)) return this.parseSeq(indent);
    return null;
  }
}

/** Parsea el subconjunto de YAML que genera el exportador (y el habitual de HA). */
export function parseYaml(text: string): YamlValue {
  return new Parser(tokenize(text)).parseDocument();
}

// ---------- YAML -> Automation ----------

type Ctx = YamlContext;

function req(m: YamlMap, key: string, where: string): YamlValue {
  const v = m[key];
  if (v === undefined || v === null) throw new Error(`Falta "${key}" en ${where}`);
  return v;
}

function str(v: YamlValue, where: string): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  throw new Error(`Se esperaba un texto en ${where}`);
}

function num(v: YamlValue | undefined, where: string): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  if (typeof v === 'boolean' || !Number.isFinite(n)) throw new Error(`Se esperaba un número en ${where}`);
  return n;
}

function stateValue(v: YamlValue, where: string): EntityStateValue {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  throw new Error(`Se esperaba un estado (texto, número o booleano) en ${where}`);
}

function list(v: YamlValue | undefined): YamlValue[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function asMap(v: YamlValue, where: string): YamlMap {
  if (!isYamlMap(v)) throw new Error(`Se esperaba un mapa en ${where}`);
  return v;
}

/** entity_id de un nodo: directo, en target, o primer elemento de una lista. */
function entityIdOf(m: YamlMap, where: string): string {
  const target = m.target;
  const raw = target !== undefined && isYamlMap(target) ? target.entity_id : m.entity_id;
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (first === undefined || first === null) throw new Error(`Falta "entity_id" en ${where}`);
  return str(first, where);
}

/** "HH:MM", "HH:MM:SS" -> "HH:MM" validado. */
function hhmm(v: YamlValue, where: string): string {
  const text = str(v, where);
  try {
    parseHHMM(text);
  } catch {
    throw new Error(`Hora no válida en ${where}: "${text}"`);
  }
  const [h = '0', m = '00'] = text.split(':');
  return `${h.padStart(2, '0')}:${m}`;
}

/** "+HH:MM:SS", "-HH:MM" o segundos -> minutos. */
function offsetMinutes(v: YamlValue, where: string): number {
  if (typeof v === 'number') return v / 60;
  const m = /^([+-])?(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(str(v, where).trim());
  if (!m) throw new Error(`Desplazamiento no válido en ${where}`);
  const total = Number(m[2]) * 60 + Number(m[3]) + Number(m[4] ?? 0) / 60;
  return m[1] === '-' ? -total : total;
}

function sunEvent(v: YamlValue, where: string): SunEvent {
  const event = str(v, where);
  if (event !== 'sunrise' && event !== 'sunset') throw new Error(`Evento solar no válido en ${where}: "${event}" (sunrise o sunset)`);
  return event;
}

/** Acepta la sintaxis actual (`trigger: state`) y la antigua (`platform: state`). */
export function parseTrigger(v: YamlValue, i = 0, ctx?: Ctx): Trigger {
  const where = `el disparador ${i + 1}`;
  const m = asMap(v, where);
  const platform = str(m.platform ?? m.trigger ?? null, where);
  switch (platform) {
    case 'state': {
      const t: Trigger = { type: 'state', entityId: entityIdOf(m, where) };
      if (m.from !== undefined && m.from !== null) t.from = stateValue(m.from, where);
      if (m.to !== undefined && m.to !== null) t.to = stateValue(m.to, where);
      const forSeconds = durationOf(m.for, where);
      if (forSeconds !== undefined) t.for = forSeconds;
      return t;
    }
    case 'numeric_state': {
      const t: Trigger = { type: 'numeric_state', entityId: entityIdOf(m, where) };
      const above = num(m.above, where);
      const below = num(m.below, where);
      if (above !== undefined) t.above = above;
      if (below !== undefined) t.below = below;
      return t;
    }
    case 'time':
      return { type: 'time', at: hhmm(req(m, 'at', where), where) };
    case 'sun': {
      const t: Trigger = { type: 'sun', event: sunEvent(req(m, 'event', where), where) };
      if (m.offset !== undefined && m.offset !== null) t.offsetMinutes = offsetMinutes(m.offset, where);
      return t;
    }
    case 'zone':
    case 'device':
      return parseFase3Trigger(platform, m, where, ctx ?? {});
    default:
      throw new Error(`Tipo de disparador no soportado en ${where}: "${platform}"`);
  }
}

export function parseCondition(v: YamlValue, i = 0, ctx?: Ctx): Condition {
  const where = `la condición ${i + 1}`;
  const m = asMap(v, where);
  const kind = str(req(m, 'condition', where), where);
  switch (kind) {
    case 'state': {
      const c: Condition = { type: 'state', entityId: entityIdOf(m, where), state: stateValue(req(m, 'state', where), where) };
      const forSeconds = durationOf(m.for, where);
      if (forSeconds !== undefined) c.for = forSeconds;
      return c;
    }
    case 'numeric_state': {
      const c: Condition = { type: 'numeric_state', entityId: entityIdOf(m, where) };
      const above = num(m.above, where);
      const below = num(m.below, where);
      if (above !== undefined) c.above = above;
      if (below !== undefined) c.below = below;
      return c;
    }
    case 'time': {
      const c: Condition = { type: 'time' };
      if (m.after !== undefined && m.after !== null) c.after = hhmm(m.after, where);
      if (m.before !== undefined && m.before !== null) c.before = hhmm(m.before, where);
      return c;
    }
    case 'sun': {
      const c: Condition = { type: 'sun' };
      if (m.after !== undefined && m.after !== null) {
        c.after = sunEvent(m.after, where);
        if (m.after_offset !== undefined && m.after_offset !== null) c.afterOffsetMinutes = offsetMinutes(m.after_offset, where);
      }
      if (m.before !== undefined && m.before !== null) {
        c.before = sunEvent(m.before, where);
        if (m.before_offset !== undefined && m.before_offset !== null) c.beforeOffsetMinutes = offsetMinutes(m.before_offset, where);
      }
      if (c.after === undefined && c.before === undefined) throw new Error(`La condición de sol de ${where} necesita "after" o "before"`);
      return c;
    }
    case 'and':
    case 'or':
      return { type: kind, conditions: list(m.conditions).map((x, j) => parseCondition(x, j, ctx)) };
    case 'not':
      return { type: 'not', conditions: list(m.conditions).map((x, j) => parseCondition(x, j, ctx)) };
    case 'zone':
      return {
        type: 'zone',
        personId: resolvePersonRef(entityIdOf(m, where), ctx ?? {}),
        zoneId: resolveZoneRef(str(req(m, 'zone', where), where), ctx ?? {}),
      };
    default:
      throw new Error(`Tipo de condición no soportado en ${where}: "${kind}"`);
  }
}

/** `for:` opcional ("00:05:00", segundos o {minutes: 5}) -> segundos; 0 o ausente -> undefined. */
function durationOf(v: YamlValue | undefined, where: string): number | undefined {
  if (v === undefined || v === null) return undefined;
  const seconds = delaySeconds(v, `${where} (for)`);
  return seconds > 0 ? seconds : undefined;
}

export function delaySeconds(v: YamlValue, where: string): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const m = /^(\d+):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/.exec(v.trim());
    if (!m) throw new Error(`Retardo no válido en ${where}: "${v}"`);
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0);
  }
  const d = asMap(v, where);
  const part = (k: string): number => num(d[k], where) ?? 0;
  return part('hours') * 3600 + part('minutes') * 60 + part('seconds') + part('milliseconds') / 1000;
}

function serviceData(m: YamlMap, where: string): Record<string, EntityStateValue> | undefined {
  const data = m.data;
  if (data === undefined || data === null) return undefined;
  const result: Record<string, EntityStateValue> = {};
  for (const [k, v] of Object.entries(asMap(data, where))) {
    // Listas numéricas (rgb_color: [255, 0, 0]) se guardan como texto "[255, 0, 0]".
    if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'number')) result[k] = `[${v.join(', ')}]`;
    else result[k] = stateValue(v, `${where} (data.${k})`);
  }
  return result;
}

function resolveScene(entityId: string, ctx: Ctx | undefined, where: string): string {
  const key = entityId.replace(/^scene\./, '');
  if (!ctx?.scenes) return key;
  const scene = findScene({ scenes: ctx.scenes }, entityId);
  if (!scene) throw new Error(`Escena desconocida en ${where}: ${entityId}`);
  return scene.id;
}

function resolveScript(entityId: string, ctx: Ctx | undefined, where: string): string {
  const key = entityId.replace(/^script\./, '');
  if (!ctx?.scripts) return key;
  const script = findScript({ scripts: ctx.scripts }, entityId);
  if (!script) throw new Error(`Script desconocido en ${where}: ${entityId}`);
  return script.id;
}

/** Acepta la sintaxis actual (`action: light.turn_on`) y la antigua (`service: light.turn_on`). */
export function parseAction(v: YamlValue, i = 0, ctx?: Ctx): Action {
  const where = `la acción ${i + 1}`;
  const m = asMap(v, where);
  if (m.delay !== undefined && m.delay !== null) return { type: 'delay', seconds: delaySeconds(m.delay, where) };
  const logic = parseFase3Action(m, where, ctx);
  if (logic) return logic;
  if (typeof m.scene === 'string') return { type: 'scene', sceneId: resolveScene(m.scene, ctx, where) };
  const service = str(m.service ?? m.action ?? null, where);
  if (service === 'scene.turn_on') return { type: 'scene', sceneId: resolveScene(entityIdOf(m, where), ctx, where) };
  if (service === 'script.turn_on') return { type: 'script', scriptId: resolveScript(entityIdOf(m, where), ctx, where) };
  if (service.startsWith('script.')) return { type: 'script', scriptId: resolveScript(service, ctx, where) };
  if (!/^[a-z_]+\.[a-z0-9_]+$/.test(service)) throw new Error(`Servicio no válido en ${where}: "${service}"`);
  const noTarget = service.startsWith('notify.') && m.entity_id === undefined && m.target === undefined;
  const action: Action = { type: 'service', service, entityId: noTarget ? '' : entityIdOf(m, where) };
  const data = serviceData(m, where);
  if (data) action.data = data;
  return action;
}

const MODES: readonly Automation['mode'][] = ['single', 'restart', 'queued', 'parallel'];

function objectToAutomation(m: YamlMap, ctx: Ctx | undefined, fallbackId: string): Automation {
  const mode = m.mode === undefined || m.mode === null ? 'single' : str(m.mode, 'mode');
  const validMode = MODES.find((x) => x === mode);
  if (!validMode) throw new Error(`Modo no válido: "${mode}" (single, restart, queued o parallel)`);
  const triggers = list(m.triggers ?? m.trigger).map((t, i) => parseTrigger(t, i, ctx));
  if (triggers.length === 0) throw new Error('La automatización necesita al menos un disparador ("trigger")');
  return {
    id: m.id === undefined || m.id === null ? fallbackId : str(m.id, 'id'),
    name: m.alias === undefined || m.alias === null ? 'Automatización sin nombre' : str(m.alias, 'alias'),
    enabled: m.initial_state !== false,
    mode: validMode,
    triggers,
    conditions: list(m.conditions ?? m.condition).map((c, i) => parseCondition(c, i, ctx)),
    actions: list(m.actions ?? m.action).map((a, i) => parseAction(a, i, ctx)),
  };
}

function parseRoot(text: string): YamlValue {
  const root = parseYaml(text);
  if (root === null) throw new Error('El YAML está vacío');
  return root;
}

/**
 * Parsea una automatización (mapa, o lista con un único elemento). Con ctx se resuelven
 * scene.<slug>/script.<slug> a ids del proyecto; sin él se usa el texto tras el punto.
 */
export function parseAutomationYaml(text: string, ctx?: Ctx): Automation {
  const root = parseRoot(text);
  const items = Array.isArray(root) ? root : [root];
  if (items.length !== 1) throw new Error(`Se esperaba una única automatización y hay ${items.length}`);
  const [only] = items;
  return objectToAutomation(asMap(only ?? null, 'la automatización'), ctx, crypto.randomUUID());
}

/** Parsea un automations.yaml completo (lista de automatizaciones). */
export function parseAutomationsYaml(text: string, ctx?: Ctx): Automation[] {
  const root = parseRoot(text);
  return list(root).map((item, i) => objectToAutomation(asMap(item, `la automatización ${i + 1}`), ctx, crypto.randomUUID()));
}

// ---------- Fase 3: zone, device, choose, if, wait_for_trigger, repeat, notify, variables ----------

function parseFase3Trigger(platform: string, m: YamlMap, where: string, ctx: Ctx): Trigger {
  if (platform === 'zone') {
    const event = str(req(m, 'event', where), where);
    if (event !== 'enter' && event !== 'leave') throw new Error(`Evento de zona no válido en ${where}: "${event}"`);
    return {
      type: 'zone',
      personId: resolvePersonRef(entityIdOf(m, where), ctx),
      zoneId: resolveZoneRef(str(req(m, 'zone', where), where), ctx),
      event,
    };
  }
  const action = m.subtype ?? m.action;
  if (action === undefined || action === null) throw new Error(`Falta "subtype" en ${where}`);
  return { type: 'device_action', entityId: entityIdOf(m, where), action: str(action, where) };
}

function conditionList(v: YamlValue | undefined, ctx: Ctx | undefined): Condition[] {
  return list(v).map((c, i) => parseCondition(c, i, ctx));
}

function actionList(v: YamlValue | undefined, ctx: Ctx | undefined): Action[] {
  return list(v).map((a, i) => parseAction(a, i, ctx));
}

function textOf(v: YamlValue | undefined, where: string): string | undefined {
  return v === undefined || v === null ? undefined : str(v, where);
}

/** Acciones de la Fase 3; undefined si el mapa no es ninguna de ellas. */
function parseFase3Action(m: YamlMap, where: string, ctx: Ctx | undefined): Action | undefined {
  if (m.choose !== undefined) {
    const choices: ChooseOption[] = list(m.choose).map((o, i) => {
      const om = asMap(o, `${where} (opción ${i + 1})`);
      return { conditions: conditionList(om.conditions, ctx), sequence: actionList(om.sequence, ctx) };
    });
    const a: Action = { type: 'choose', choices };
    if (m.default !== undefined && m.default !== null) a.default = actionList(m.default, ctx);
    return a;
  }
  if (m.if !== undefined) {
    const a: Action = { type: 'if', conditions: conditionList(m.if, ctx), then: actionList(m.then, ctx) };
    if (m.else !== undefined && m.else !== null) a.else = actionList(m.else, ctx);
    return a;
  }
  if (m.wait_for_trigger !== undefined) {
    const a: Action = { type: 'wait_for_trigger', triggers: list(m.wait_for_trigger).map((t, i) => parseTrigger(t, i, ctx)) };
    if (m.timeout !== undefined && m.timeout !== null) a.timeoutSeconds = delaySeconds(m.timeout, `${where} (timeout)`);
    if (m.continue_on_timeout === false) a.continueOnTimeout = false;
    return a;
  }
  if (m.repeat !== undefined) {
    const r = asMap(m.repeat, `${where} (repeat)`);
    const a: RepeatAction = { type: 'repeat', sequence: actionList(r.sequence, ctx) };
    const count = num(r.count, `${where} (repeat.count)`);
    if (count !== undefined) a.count = count;
    if (r.while !== undefined && r.while !== null) a.while = conditionList(r.while, ctx);
    if (r.until !== undefined && r.until !== null) a.until = conditionList(r.until, ctx);
    if (a.count === undefined && !a.while && !a.until) throw new Error(`repeat necesita count, while o until en ${where}`);
    return a;
  }
  if (m.variables !== undefined) {
    const variables: Record<string, EntityStateValue> = {};
    for (const [k, v] of Object.entries(asMap(m.variables, `${where} (variables)`))) variables[k] = stateValue(v, `${where} (variables.${k})`);
    return { type: 'variables', variables };
  }
  // notify.persistent_notification se queda como servicio (Fase 2); el resto de notify.* y
  // persistent_notification.create son la acción `notify` (Fase 3). El motor trata igual ambas.
  const service = m.service ?? m.action;
  if (typeof service === 'string' && service !== NOTIFY_PERSISTENT && (service.startsWith('notify.') || service === 'persistent_notification.create')) {
    const data = m.data === undefined || m.data === null ? {} : asMap(m.data, `${where} (data)`);
    const a: Action = { type: 'notify', message: textOf(data.message, where) ?? '' };
    const title = textOf(data.title, where);
    if (title !== undefined) a.title = title;
    if (service !== 'notify.notify') a.service = service;
    return a;
  }
  return undefined;
}
