// Validación estructural de proyectos importados (mensajes en español).
import type {
  Action,
  Automation,
  Condition,
  Connection,
  Device,
  EntityState,
  EntityStateValue,
  Floor,
  Point,
  Project,
  ProjectSettings,
  Room,
  Scene,
  Script,
  Trigger,
  Person,
  Zone,
  EnvironmentSettings,
  Timeline,
  TimelineStep,
  ProjectVariant,
  EntityGroup,
  ReliabilitySettings,
  Wall,
  ChooseOption,
  RepeatAction,
  TimelineEventStep,
  TimelineAssertStep,
} from '../types';
import { INTEGRATIONS, PROTOCOLS } from '../devices/labels';

type Obj = Record<string, unknown>;

class SchemaError extends Error {}

function fail(path: string, msg: string): never {
  throw new SchemaError(`Proyecto no válido: ${path} ${msg}`);
}

function obj(v: unknown, path: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'debe ser un objeto');
  return v as Obj;
}

function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) fail(path, 'debe ser una lista');
  return v;
}

function str(o: Obj, key: string, path: string): string {
  const v = o[key];
  if (typeof v !== 'string') fail(`${path}.${key}`, 'debe ser un texto');
  return v;
}

function optStr(o: Obj, key: string, path: string): string | undefined {
  return o[key] === undefined ? undefined : str(o, key, path);
}

function numAt(o: Obj, key: string, path: string): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${path}.${key}`, 'debe ser un número');
  return v;
}

function optNum(o: Obj, key: string, path: string): number | undefined {
  return o[key] === undefined ? undefined : numAt(o, key, path);
}

function oneOf<T extends string>(o: Obj, key: string, allowed: readonly T[], path: string): T {
  const v = o[key];
  const found = allowed.find((a) => a === v);
  if (found === undefined) fail(`${path}.${key}`, `tiene un valor no válido (${JSON.stringify(v)})`);
  return found;
}

function stateValue(v: unknown, path: string): EntityStateValue {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  return fail(path, 'debe ser texto, número o booleano');
}

function optStateValue(o: Obj, key: string, path: string): EntityStateValue | undefined {
  return o[key] === undefined ? undefined : stateValue(o[key], `${path}.${key}`);
}

/** `for` en segundos (número no negativo), opcional. */
function optDuration(o: Obj, path: string): number | undefined {
  const v = optNum(o, 'for', path);
  if (v !== undefined && v < 0) fail(`${path}.for`, 'no puede ser negativo');
  return v;
}

function stateRecord(v: unknown, path: string): Record<string, EntityStateValue> {
  const o = obj(v, path);
  const result: Record<string, EntityStateValue> = {};
  for (const [k, val] of Object.entries(o)) {
    // Listas numéricas (rgb_color: [255, 0, 0]) se normalizan al texto "[255, 0, 0]".
    if (Array.isArray(val) && val.length > 0 && val.every((x) => typeof x === 'number' && Number.isFinite(x))) result[k] = `[${val.join(', ')}]`;
    else result[k] = stateValue(val, `${path}.${k}`);
  }
  return result;
}

function point(v: unknown, path: string): Point {
  const o = obj(v, path);
  return { x: numAt(o, 'x', path), y: numAt(o, 'y', path) };
}

function floor(v: unknown, path: string): Floor {
  const o = obj(v, path);
  const f: Floor = { id: str(o, 'id', path), name: str(o, 'name', path), level: numAt(o, 'level', path), pixelsPerMeter: numAt(o, 'pixelsPerMeter', path) };
  if (f.pixelsPerMeter <= 0) fail(`${path}.pixelsPerMeter`, 'debe ser mayor que 0');
  const bg = optStr(o, 'backgroundImage', path);
  if (bg !== undefined) {
    // Solo imágenes incrustadas: una URL externa filtraría la visita o cargaría contenido ajeno.
    if (!/^data:image\/[a-z0-9.+-]+[;,]/i.test(bg)) fail(`${path}.backgroundImage`, 'debe ser una imagen incrustada (data:image/…)');
    f.backgroundImage = bg;
  }
  if (o.walls !== undefined) f.walls = arr(o.walls, `${path}.walls`).map((w, i) => wall(w, `${path}.walls[${i}]`));
  return f;
}

function room(v: unknown, path: string): Room {
  const o = obj(v, path);
  return {
    id: str(o, 'id', path),
    floorId: str(o, 'floorId', path),
    name: str(o, 'name', path),
    polygon: arr(o.polygon, `${path}.polygon`).map((p, i) => point(p, `${path}.polygon[${i}]`)),
  };
}

function device(v: unknown, path: string): Device {
  const o = obj(v, path);
  const d: Device = {
    id: str(o, 'id', path),
    definitionId: str(o, 'definitionId', path),
    name: str(o, 'name', path),
    floorId: str(o, 'floorId', path),
    position: point(o.position, `${path}.position`),
    protocol: oneOf(o, 'protocol', PROTOCOLS, path),
    integration: oneOf(o, 'integration', INTEGRATIONS, path),
  };
  const roomId = optStr(o, 'roomId', path);
  if (roomId !== undefined) d.roomId = roomId;
  if (o.ups !== undefined) {
    if (typeof o.ups !== 'boolean') fail(`${path}.ups`, 'debe ser verdadero o falso');
    d.ups = o.ups;
  }
  const load = optNum(o, 'loadWatts', path);
  if (load !== undefined) {
    if (load < 0) fail(`${path}.loadWatts`, 'no puede ser negativo');
    d.loadWatts = load;
  }
  if (o.showAs !== undefined) d.showAs = oneOf(o, 'showAs', ['light', 'switch'] as const, path);
  return d;
}

function connection(v: unknown, path: string): Connection {
  const o = obj(v, path);
  return { id: str(o, 'id', path), sourceId: str(o, 'sourceId', path), targetId: str(o, 'targetId', path), protocol: oneOf(o, 'protocol', PROTOCOLS, path) };
}

function trigger(v: unknown, path: string): Trigger {
  const o = obj(v, path);
  const type = oneOf(o, 'type', ['state', 'numeric_state', 'time', 'sun', 'zone', 'device_action'] as const, path);
  if (type === 'time') return { type, at: str(o, 'at', path) };
  if (type === 'zone') {
    return { type, personId: str(o, 'personId', path), zoneId: str(o, 'zoneId', path), event: oneOf(o, 'event', ['enter', 'leave'] as const, path) };
  }
  if (type === 'device_action') return { type, entityId: str(o, 'entityId', path), action: str(o, 'action', path) };
  if (type === 'sun') {
    const t: Trigger = { type, event: oneOf(o, 'event', ['sunrise', 'sunset'] as const, path) };
    const off = optNum(o, 'offsetMinutes', path);
    if (off !== undefined) t.offsetMinutes = off;
    return t;
  }
  if (type === 'numeric_state') {
    const t: Trigger = { type, entityId: str(o, 'entityId', path) };
    const above = optNum(o, 'above', path);
    const below = optNum(o, 'below', path);
    if (above !== undefined) t.above = above;
    if (below !== undefined) t.below = below;
    return t;
  }
  const t: Trigger = { type, entityId: str(o, 'entityId', path) };
  const from = optStateValue(o, 'from', path);
  const to = optStateValue(o, 'to', path);
  if (from !== undefined) t.from = from;
  if (to !== undefined) t.to = to;
  const forSeconds = optDuration(o, path);
  if (forSeconds !== undefined) t.for = forSeconds;
  return t;
}

function condition(v: unknown, path: string): Condition {
  const o = obj(v, path);
  const type = oneOf(o, 'type', ['state', 'numeric_state', 'time', 'sun', 'and', 'or', 'not', 'zone'] as const, path);
  switch (type) {
    case 'state': {
      const c: Condition = { type, entityId: str(o, 'entityId', path), state: stateValue(o.state, `${path}.state`) };
      const forSeconds = optDuration(o, path);
      if (forSeconds !== undefined) c.for = forSeconds;
      return c;
    }
    case 'numeric_state': {
      const c: Condition = { type, entityId: str(o, 'entityId', path) };
      const above = optNum(o, 'above', path);
      const below = optNum(o, 'below', path);
      if (above !== undefined) c.above = above;
      if (below !== undefined) c.below = below;
      return c;
    }
    case 'time': {
      const c: Condition = { type };
      const after = optStr(o, 'after', path);
      const before = optStr(o, 'before', path);
      if (after !== undefined) c.after = after;
      if (before !== undefined) c.before = before;
      return c;
    }
    case 'sun': {
      const c: Condition = { type };
      const events = ['sunrise', 'sunset'] as const;
      if (o.after !== undefined) c.after = oneOf(o, 'after', events, path);
      if (o.before !== undefined) c.before = oneOf(o, 'before', events, path);
      const afterOffset = optNum(o, 'afterOffsetMinutes', path);
      const beforeOffset = optNum(o, 'beforeOffsetMinutes', path);
      if (afterOffset !== undefined) c.afterOffsetMinutes = afterOffset;
      if (beforeOffset !== undefined) c.beforeOffsetMinutes = beforeOffset;
      return c;
    }
    case 'and':
    case 'or':
    case 'not':
      return { type, conditions: conditions(o.conditions, `${path}.conditions`) };
    case 'zone':
      return { type, personId: str(o, 'personId', path), zoneId: str(o, 'zoneId', path) };
  }
}

function conditions(v: unknown, path: string): Condition[] {
  return arr(v, path).map((c, i) => condition(c, `${path}[${i}]`));
}

function action(v: unknown, path: string): Action {
  const o = obj(v, path);
  const type = oneOf(
    o,
    'type',
    ['service', 'scene', 'script', 'delay', 'choose', 'if', 'wait_for_trigger', 'repeat', 'notify', 'variables'] as const,
    path,
  );
  switch (type) {
    case 'service': {
      const a: Action = { type, service: str(o, 'service', path), entityId: str(o, 'entityId', path) };
      if (o.data !== undefined) a.data = stateRecord(o.data, `${path}.data`);
      return a;
    }
    case 'scene':
      return { type, sceneId: str(o, 'sceneId', path) };
    case 'script':
      return { type, scriptId: str(o, 'scriptId', path) };
    case 'delay':
      return { type, seconds: numAt(o, 'seconds', path) };
    case 'choose': {
      const choices: ChooseOption[] = arr(o.choices, `${path}.choices`).map((c, i) => {
        const co = obj(c, `${path}.choices[${i}]`);
        return { conditions: conditions(co.conditions, `${path}.choices[${i}].conditions`), sequence: actions(co.sequence, `${path}.choices[${i}].sequence`) };
      });
      const a: Action = { type, choices };
      if (o.default !== undefined) a.default = actions(o.default, `${path}.default`);
      return a;
    }
    case 'if': {
      const a: Action = { type, conditions: conditions(o.conditions, `${path}.conditions`), then: actions(o.then, `${path}.then`) };
      if (o.else !== undefined) a.else = actions(o.else, `${path}.else`);
      return a;
    }
    case 'wait_for_trigger': {
      const a: Action = { type, triggers: arr(o.triggers, `${path}.triggers`).map((t, i) => trigger(t, `${path}.triggers[${i}]`)) };
      const timeout = optNum(o, 'timeoutSeconds', path);
      if (timeout !== undefined) a.timeoutSeconds = timeout;
      if (o.continueOnTimeout !== undefined) a.continueOnTimeout = bool(o, 'continueOnTimeout', path);
      return a;
    }
    case 'repeat': {
      const a: RepeatAction = { type, sequence: actions(o.sequence, `${path}.sequence`) };
      const count = optNum(o, 'count', path);
      if (count !== undefined) a.count = count;
      if (o.while !== undefined) a.while = conditions(o.while, `${path}.while`);
      if (o.until !== undefined) a.until = conditions(o.until, `${path}.until`);
      return a;
    }
    case 'notify': {
      const a: Action = { type, message: str(o, 'message', path) };
      const title = optStr(o, 'title', path);
      const service = optStr(o, 'service', path);
      if (title !== undefined) a.title = title;
      if (service !== undefined) a.service = service;
      return a;
    }
    case 'variables':
      return { type, variables: stateRecord(o.variables, `${path}.variables`) };
  }
}

function actions(v: unknown, path: string): Action[] {
  return arr(v, path).map((a, i) => action(a, `${path}[${i}]`));
}

function automation(v: unknown, path: string): Automation {
  const o = obj(v, path);
  if (typeof o.enabled !== 'boolean') fail(`${path}.enabled`, 'debe ser verdadero o falso');
  return {
    id: str(o, 'id', path),
    name: str(o, 'name', path),
    enabled: o.enabled,
    mode: oneOf(o, 'mode', ['single', 'restart', 'queued', 'parallel'] as const, path),
    triggers: arr(o.triggers, `${path}.triggers`).map((t, i) => trigger(t, `${path}.triggers[${i}]`)),
    conditions: arr(o.conditions, `${path}.conditions`).map((c, i) => condition(c, `${path}.conditions[${i}]`)),
    actions: actions(o.actions, `${path}.actions`),
  };
}

function entityState(v: unknown, path: string): EntityState {
  const o = obj(v, path);
  const st: EntityState = { state: stateValue(o.state, `${path}.state`) };
  if (o.attributes !== undefined) st.attributes = stateRecord(o.attributes, `${path}.attributes`);
  const lastChanged = optNum(o, 'lastChanged', path);
  if (lastChanged !== undefined) st.lastChanged = lastChanged;
  return st;
}

function scene(v: unknown, path: string): Scene {
  const o = obj(v, path);
  const entities: Record<string, EntityState> = {};
  for (const [k, val] of Object.entries(obj(o.entities, `${path}.entities`))) entities[k] = entityState(val, `${path}.entities.${k}`);
  return { id: str(o, 'id', path), name: str(o, 'name', path), entities };
}

function script(v: unknown, path: string): Script {
  const o = obj(v, path);
  return { id: str(o, 'id', path), name: str(o, 'name', path), sequence: actions(o.sequence, `${path}.sequence`) };
}

function settings(v: unknown, path: string): ProjectSettings {
  const o = obj(v, path);
  const s: ProjectSettings = {
    latitude: numAt(o, 'latitude', path),
    longitude: numAt(o, 'longitude', path),
    electricityPriceEurKwh: numAt(o, 'electricityPriceEurKwh', path),
  };
  if (s.latitude < -90 || s.latitude > 90) fail(`${path}.latitude`, 'debe estar entre -90 y 90');
  if (s.longitude < -180 || s.longitude > 180) fail(`${path}.longitude`, 'debe estar entre -180 y 180');
  if (s.electricityPriceEurKwh < 0) fail(`${path}.electricityPriceEurKwh`, 'no puede ser negativo');
  const tz = optStr(o, 'timeZone', path);
  if (tz !== undefined) s.timeZone = tz;
  if (o.currency !== undefined) s.currency = oneOf(o, 'currency', ['EUR'] as const, path);
  if (o.prices !== undefined) {
    const prices: Record<string, number> = {};
    const po = obj(o.prices, `${path}.prices`);
    for (const key of Object.keys(po)) {
      const n = numAt(po, key, `${path}.prices`);
      if (n < 0) fail(`${path}.prices.${key}`, 'no puede ser negativo');
      prices[key] = n;
    }
    s.prices = prices;
  }
  const acc = optNum(o, 'batteryAcceleration', path);
  if (acc !== undefined) {
    if (acc < 0) fail(`${path}.batteryAcceleration`, 'no puede ser negativo');
    s.batteryAcceleration = acc;
  }
  return s;
}

function list<T>(o: Obj, key: string, parse: (v: unknown, path: string) => T): T[] {
  return arr(o[key], key).map((item, i) => parse(item, `${key}[${i}]`));
}

function checkUniqueIds(name: string, items: { id: string }[]): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) fail(name, `contiene el id repetido "${item.id}"`);
    seen.add(item.id);
  }
}

function checkReferences(p: Project): void {
  const floorIds = new Set(p.floors.map((f) => f.id));
  const deviceIds = new Set(p.devices.map((d) => d.id));
  for (const r of p.rooms) if (!floorIds.has(r.floorId)) fail(`la sala «${r.name}»`, `apunta a una planta inexistente (${r.floorId})`);
  for (const d of p.devices) if (!floorIds.has(d.floorId)) fail(`el dispositivo «${d.name}»`, `apunta a una planta inexistente (${d.floorId})`);
  for (const c of p.connections) {
    if (!deviceIds.has(c.sourceId) || !deviceIds.has(c.targetId)) fail(`la conexión ${c.id}`, 'apunta a un dispositivo inexistente');
  }
}

// ---------- Fase 3 ----------

function bool(o: Obj, key: string, path: string): boolean {
  const v = o[key];
  if (typeof v !== 'boolean') fail(`${path}.${key}`, 'debe ser verdadero o falso');
  return v;
}

function wall(v: unknown, path: string): Wall {
  const o = obj(v, path);
  return { a: point(o.a, `${path}.a`), b: point(o.b, `${path}.b`), material: oneOf(o, 'material', ['drywall', 'brick', 'concrete', 'glass'] as const, path) };
}

function person(v: unknown, path: string): Person {
  const o = obj(v, path);
  const p: Person = { id: str(o, 'id', path), name: str(o, 'name', path) };
  const color = optStr(o, 'color', path);
  if (color !== undefined) p.color = color;
  return p;
}

function zone(v: unknown, path: string): Zone {
  const o = obj(v, path);
  return { id: str(o, 'id', path), name: str(o, 'name', path), kind: oneOf(o, 'kind', ['home', 'work', 'other'] as const, path) };
}

function environment(v: unknown, path: string): EnvironmentSettings {
  const o = obj(v, path);
  const e: EnvironmentSettings = { enabled: bool(o, 'enabled', path), outdoorMean: numAt(o, 'outdoorMean', path), outdoorAmplitude: numAt(o, 'outdoorAmplitude', path) };
  const tau = optNum(o, 'tauHours', path);
  const windowFactor = optNum(o, 'windowFactor', path);
  const rate = optNum(o, 'hvacRatePerHour', path);
  const range = (v: number, key: string, min: number, max: number): number => {
    if (v < min || v > max) fail(`${path}.${key}`, `debe estar entre ${min} y ${max}`);
    return v;
  };
  if (tau !== undefined) e.tauHours = range(tau, 'tauHours', 0.5, 1000);
  if (windowFactor !== undefined) e.windowFactor = range(windowFactor, 'windowFactor', 1, 20);
  if (rate !== undefined) e.hvacRatePerHour = range(rate, 'hvacRatePerHour', 0, 10);
  return e;
}

const EVENT_KINDS = ['state', 'service', 'motion', 'button', 'door', 'person', 'scene', 'script'] as const;
const ASSERT_OPS = ['eq', 'ne', 'gt', 'lt', 'gte', 'lte'] as const;

function timelineStep(v: unknown, path: string): TimelineStep {
  const o = obj(v, path);
  const at = str(o, 'at', path);
  if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(at)) fail(`${path}.at`, 'debe tener el formato HH:MM');
  const kind = oneOf(o, 'kind', ['event', 'assert'] as const, path);
  if (kind === 'assert') {
    const step: TimelineAssertStep = { at, kind, entityId: str(o, 'entityId', path), expect: stateValue(o.expect, `${path}.expect`) };
    if (o.op !== undefined) step.op = oneOf(o, 'op', ASSERT_OPS, path);
    const attribute = optStr(o, 'attribute', path);
    if (attribute !== undefined) step.attribute = attribute;
    return step;
  }
  const step: TimelineEventStep = { at, kind, event: oneOf(o, 'event', EVENT_KINDS, path) };
  for (const key of ['entityId', 'service', 'personId', 'zoneId', 'sceneId', 'scriptId'] as const) {
    const value = optStr(o, key, path);
    if (value !== undefined) step[key] = value;
  }
  const value = optStateValue(o, 'value', path);
  if (value !== undefined) step.value = value;
  if (o.data !== undefined) step.data = stateRecord(o.data, `${path}.data`);
  return step;
}

function timeline(v: unknown, path: string): Timeline {
  const o = obj(v, path);
  const t: Timeline = { id: str(o, 'id', path), name: str(o, 'name', path), steps: arr(o.steps, `${path}.steps`).map((s, i) => timelineStep(s, `${path}.steps[${i}]`)) };
  const startAt = optNum(o, 'startAt', path);
  if (startAt !== undefined) t.startAt = startAt;
  return t;
}

function group(v: unknown, path: string): EntityGroup {
  const o = obj(v, path);
  const entityIds = arr(o.entityIds, `${path}.entityIds`).map((e, i) => {
    if (typeof e !== 'string') fail(`${path}.entityIds[${i}]`, 'debe ser un texto');
    return e;
  });
  return { id: str(o, 'id', path), name: str(o, 'name', path), domain: oneOf(o, 'domain', ['light', 'switch', 'cover'] as const, path), entityIds };
}

function reliability(v: unknown, path: string): ReliabilitySettings {
  const o = obj(v, path);
  const r: ReliabilitySettings = { latency: bool(o, 'latency', path) };
  const rate = optNum(o, 'failureRate', path);
  if (rate !== undefined) {
    if (rate < 0 || rate > 1) fail(`${path}.failureRate`, 'debe estar entre 0 y 1');
    r.failureRate = rate;
  }
  const seed = optNum(o, 'seed', path);
  if (seed !== undefined) r.seed = seed;
  return r;
}

function variant(v: unknown, path: string): ProjectVariant {
  const o = obj(v, path);
  const snap = obj(o.snapshot, `${path}.snapshot`);
  // La instantánea se valida como un proyecto completo (sin sus propias variantes).
  const snapshot: Omit<Project, 'variants'> = parseProject({ ...snap, variants: undefined });
  return { id: str(o, 'id', path), name: str(o, 'name', path), snapshot };
}

function optList<T>(o: Obj, key: string, parse: (v: unknown, path: string) => T): T[] | undefined {
  return o[key] === undefined ? undefined : list(o, key, parse);
}

/** Campos opcionales de la Fase 3 del proyecto. */
function parseFase3(o: Obj, project: Project): void {
  const people = optList(o, 'people', person);
  const zones = optList(o, 'zones', zone);
  const timelines = optList(o, 'timelines', timeline);
  const variants = optList(o, 'variants', variant);
  const groups = optList(o, 'groups', group);
  if (people) project.people = people;
  if (zones) project.zones = zones;
  if (o.environment !== undefined) project.environment = environment(o.environment, 'environment');
  if (timelines) project.timelines = timelines;
  if (variants) project.variants = variants;
  if (groups) project.groups = groups;
  if (o.reliability !== undefined) project.reliability = reliability(o.reliability, 'reliability');
  for (const [name, items] of [['people', people], ['zones', zones], ['timelines', timelines], ['variants', variants], ['groups', groups]] as const) {
    if (items) checkUniqueIds(name, items);
  }
}

/** Valida y normaliza un objeto desconocido como Project. Lanza Error en español. */
export function parseProject(raw: unknown): Project {
  const o = obj(raw, 'el documento');
  if (o.version !== 1) fail('version', `no soportada (${JSON.stringify(o.version)}); se esperaba 1`);
  const project: Project = {
    id: str(o, 'id', 'proyecto'),
    name: str(o, 'name', 'proyecto'),
    version: 1,
    createdAt: str(o, 'createdAt', 'proyecto'),
    updatedAt: str(o, 'updatedAt', 'proyecto'),
    floors: list(o, 'floors', floor),
    rooms: list(o, 'rooms', room),
    devices: list(o, 'devices', device),
    connections: list(o, 'connections', connection),
    automations: list(o, 'automations', automation),
    scenes: list(o, 'scenes', scene),
    scripts: list(o, 'scripts', script),
  };
  // Los proyectos anteriores a la fase 2 no tienen ajustes: se importan sin ellos.
  if (o.settings !== undefined) project.settings = settings(o.settings, 'settings');
  if (project.floors.length === 0) fail('floors', 'debe tener al menos una planta');
  checkUniqueIds('floors', project.floors);
  checkUniqueIds('rooms', project.rooms);
  checkUniqueIds('devices', project.devices);
  checkUniqueIds('connections', project.connections);
  checkUniqueIds('automations', project.automations);
  checkUniqueIds('scenes', project.scenes);
  checkUniqueIds('scripts', project.scripts);
  checkReferences(project);
  parseFase3(o, project);
  return project;
}
