// Motor de simulación: funciones puras e inmutables (no leen el reloj del sistema).
import type {
  Action,
  Automation,
  Condition,
  DeviceDefinition,
  EntityState,
  EntityStateValue,
  Id,
  LogEntry,
  LogLevel,
  PendingAction,
  Project,
  Scene,
  Script,
  ServiceData,
  SimTimer,
  SimulationState,
  Trigger,
  RecordedEvent,
  WaitForTriggerAction,
} from '../types';
import { entitiesForDevice, entityDomain, initialEntityStates, slugify } from '../devices/entities';
import { entityCapabilities, findEntityOwner } from '../devices/capabilities';
import { catalog } from '../devices/catalog';
import { mapActionEntities, mapTriggerEntities } from '../automations/walk';
import {
  addNotification,
  aggregateGroupState,
  expandRepeat,
  fase3TriggerMatches,
  findGroupByEntity,
  groupEntities,
  groupEntityId,
  groupsContaining,
  MAX_ACTION_STEPS,
  memberService,
  peopleEntities,
  renderData,
  renderTemplate,
  WAIT_FOREVER,
  type Variables,
} from './logic';
import { recordSample, sampleValue } from './history';
import { latencyFor, nextRandom } from './latency';
import { applyEnvironment } from './thermal';
import { DAY_MS, DEFAULT_SUN, isTimeBetween, MINUTE_MS, parseHHMM, SECOND_MS, startOfDay, sunTimes, type SunConfig } from './clock';
import {
  applyService,
  coverPosition,
  coverStep,
  coverStepSeconds,
  describeServiceData,
  sceneServiceCalls,
  updateClimateCurrentTemperature,
} from './services';

export { capturableEntities, captureSceneEntities, type CapturableEntities } from './scenes';

/** Profundidad máxima de llamadas anidadas (automatización → acción → automatización...). */
export const MAX_DEPTH = 10;
/** Entradas máximas del registro (se conservan las más recientes, al final). */
export const MAX_LOG_ENTRIES = 500;
const MAX_TICK_EVENTS = 10_000;
const MAX_TICK_DAYS = 400;

interface RunCtx {
  automationId?: Id;
  scriptId?: Id;
  /** Fase 3: variables de la ejecución (acción variables). */
  variables?: Variables;
}

/** Contexto interno de ejecución: profundidad y cadena de automatizaciones/scripts activos. */
interface Exec {
  depth: number;
  chain: readonly Id[];
  /** Fase 3: no registra los cambios de estado (sensores del modelo térmico). */
  quiet?: boolean;
  /** Fase 3: la llamada ya pasó por la latencia simulada. */
  immediate?: boolean;
}

const ROOT: Exec = { depth: 0, chain: [] };

// ---------- Registro ----------

function nextSeq(log: LogEntry[]): number {
  const last = log[log.length - 1];
  const n = last ? Number(last.id.replace(/^log-/, '')) : 0;
  return Number.isFinite(n) ? n + 1 : log.length + 1;
}

/** Añade una entrada al registro (id secuencial, registro acotado). */
export function appendLog(
  sim: SimulationState,
  level: LogLevel,
  message: string,
  extra: { entityId?: string; automationId?: Id } = {},
): SimulationState {
  return addLog(sim, level, message, extra);
}

interface LogExtra {
  entityId?: string;
  automationId?: Id;
  change?: LogEntry['change'];
}

function addLog(sim: SimulationState, level: LogLevel, message: string, extra: LogExtra = {}): SimulationState {
  const entry: LogEntry = { id: `log-${nextSeq(sim.log)}`, timestamp: sim.now, level, message };
  if (extra.entityId !== undefined) entry.entityId = extra.entityId;
  if (extra.automationId !== undefined) entry.automationId = extra.automationId;
  if (extra.change !== undefined) entry.change = extra.change;
  const log = [...sim.log, entry];
  return { ...sim, log: log.length > MAX_LOG_ENTRIES ? log.slice(log.length - MAX_LOG_ENTRIES) : log };
}

// ---------- Estados ----------

function normalize(v: EntityStateValue): string {
  if (v === true) return 'on';
  if (v === false) return 'off';
  return String(v);
}

/** Compara estados como HA (true ≡ "on", 21 ≡ "21"). */
export function sameState(a: EntityStateValue, b: EntityStateValue): boolean {
  return normalize(a) === normalize(b);
}

function toNumber(v: EntityStateValue | undefined): number | undefined {
  if (v === undefined || typeof v === 'boolean' || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function inNumericRange(v: EntityStateValue | undefined, above?: number, below?: number): boolean {
  const n = toNumber(v);
  if (n === undefined) return false;
  return (above === undefined || n > above) && (below === undefined || n < below);
}

function isEntityState(v: EntityState | EntityStateValue): v is EntityState {
  return typeof v === 'object' && v !== null && 'state' in v;
}

function merge(prev: EntityState, next: EntityState | EntityStateValue, replace: boolean): EntityState {
  if (!isEntityState(next)) return { state: next, attributes: { ...prev.attributes } };
  if (replace) return { state: next.state, attributes: { ...next.attributes } };
  return { state: next.state, attributes: { ...prev.attributes, ...next.attributes } };
}

function friendly(sim: SimulationState, entityId: string): string {
  const name = sim.entities[entityId]?.attributes?.friendly_name;
  return name === undefined ? entityId : String(name);
}

/** "2 min", "1 h 5 min", "30 s"... */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} h`);
  if (m) parts.push(`${m} min`);
  if (sec || parts.length === 0) parts.push(`${sec} s`);
  return parts.join(' ');
}

// ---------- Temporizadores internos ----------

/** Clave del temporizador propio de una entidad (autoapagado, recorrido, vuelta a la base). */
export function entityTimerKey(entityId: string): string {
  return `entity:${entityId}`;
}

/** ¿Es un temporizador interno del motor (no una espera de automatización o script)? */
export function isTimer(p: PendingAction): boolean {
  return p.timer !== undefined;
}

/** Esperas (delay) de automatizaciones y scripts, sin los temporizadores internos. */
export function userWaits(sim: SimulationState): PendingAction[] {
  return sim.pending.filter((p) => !isTimer(p));
}

/** Programa un temporizador interno; sustituye al que tenga la misma clave. */
export function scheduleTimer(sim: SimulationState, key: string, dueAt: number, timer: SimTimer): SimulationState {
  const pending = sim.pending.filter((p) => p.key !== key);
  return { ...sim, pending: [...pending, { id: `timer:${key}`, dueAt, actions: [], timer, key }] };
}

export function cancelTimer(sim: SimulationState, key: string): SimulationState {
  if (!sim.pending.some((p) => p.key === key)) return sim;
  return { ...sim, pending: sim.pending.filter((p) => p.key !== key) };
}

/** Temporizador interno con esa clave, si existe. */
export function findTimer(sim: SimulationState, key: string): PendingAction | undefined {
  return sim.pending.find((p) => p.key === key);
}

function cancelStateFor(sim: SimulationState, entityId: string): SimulationState {
  const keep = sim.pending.filter((p) => !(p.timer?.kind === 'state_for' && p.timer.entityId === entityId));
  return keep.length === sim.pending.length ? sim : { ...sim, pending: keep };
}

// ---------- Renombrado ----------

function renameKey<T>(record: Record<string, T>, mapping: Record<string, string>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(record)) out[mapping[k] ?? k] = v;
  return out;
}

function renameTimer(timer: SimTimer, mapping: Record<string, string>): SimTimer {
  const ren = (id: string): string => mapping[id] ?? id;
  switch (timer.kind) {
    case 'set_states':
      return { ...timer, setStates: renameKey(timer.setStates, mapping) };
    case 'cover_step':
    case 'state_for':
    case 'service_call':
      return { ...timer, entityId: ren(timer.entityId) };
  }
}

function renameActions(actions: Action[], mapping: Record<string, string>): Action[] {
  return actions.map((a) => mapActionEntities(a, (id) => mapping[id] ?? id));
}

function renamePending(p: PendingAction, mapping: Record<string, string>): PendingAction {
  const next: PendingAction = { ...p, actions: renameActions(p.actions, mapping) };
  if (p.wait) next.wait = { ...p.wait, triggers: p.wait.triggers.map((t) => mapTriggerEntities(t, (id) => mapping[id] ?? id)) };
  if (p.timer) {
    next.timer = renameTimer(p.timer, mapping);
    const entityId = p.key?.startsWith('entity:') ? p.key.slice(7) : undefined;
    if (entityId !== undefined && mapping[entityId]) {
      next.key = entityTimerKey(mapping[entityId] ?? entityId);
      next.id = `timer:${next.key}`;
    }
  }
  return next;
}

/**
 * Traslada el estado de la simulación a entity_id nuevos (dispositivo renombrado): entidades,
 * temporizadores (claves, entityId, setStates, state_for), esperas, cola y dispositivos offline.
 * `mapping`: entity_id anterior -> entity_id nuevo. Función pura.
 */
export function renameEntities(sim: SimulationState, mapping: Record<string, string>): SimulationState {
  const pairs = Object.entries(mapping).filter(([from, to]) => from !== to);
  if (pairs.length === 0) return sim;
  const map = Object.fromEntries(pairs);
  const next: SimulationState = {
    ...sim,
    entities: renameKey(sim.entities, map),
    pending: sim.pending.map((p) => renamePending(p, map)),
  };
  if (sim.queue) next.queue = sim.queue.map((p) => renamePending(p, map));
  if (sim.offline) {
    const offline: Record<Id, Record<string, EntityState>> = {};
    for (const [deviceId, states] of Object.entries(sim.offline)) offline[deviceId] = renameKey(states, map);
    next.offline = offline;
  }
  return next;
}

// ---------- Creación ----------

export function createSimulationState(project: Project, defs: DeviceDefinition[], now: number): SimulationState {
  const devices = initialEntityStates(project, defs);
  const entities = { ...devices, ...peopleEntities(project), ...groupEntities(project, devices) };
  const sim: SimulationState = {
    running: false,
    now,
    speed: 1,
    entities,
    pending: [],
    queue: [],
    log: [],
    startedAt: now,
    notifications: [],
    // B23: el historial empieza con el estado inicial de cada entidad.
    history: Object.fromEntries(Object.entries(entities).map(([id, e]) => [id, [{ t: now, v: sampleValue(e.state) }]])),
  };
  return addLog(sim, 'info', `Simulación preparada con ${Object.keys(sim.entities).length} entidades`);
}

// ---------- Condiciones ----------

export function evaluateCondition(c: Condition, sim: SimulationState): boolean {
  switch (c.type) {
    case 'state': {
      const current = sim.entities[c.entityId];
      if (current === undefined || !sameState(current.state, c.state)) return false;
      if (!c.for) return true;
      const since = current.lastChanged ?? sim.startedAt;
      return since === undefined || sim.now - since >= c.for * SECOND_MS;
    }
    case 'numeric_state':
      return inNumericRange(sim.entities[c.entityId]?.state, c.above, c.below);
    case 'time':
      try {
        return isTimeBetween(sim.now, c.after, c.before);
      } catch {
        return false;
      }
    case 'and':
      return c.conditions.every((x) => evaluateCondition(x, sim));
    case 'or':
      return c.conditions.some((x) => evaluateCondition(x, sim));
    case 'not':
      return !c.conditions.some((x) => evaluateCondition(x, sim));
    case 'zone':
      return Object.entries(sim.entities).some(
        ([id, e]) => entityDomain(id) === 'person' && e.attributes?.person_id === c.personId && String(e.attributes.zone_id ?? '') === c.zoneId,
      );
  }
}

// ---------- Automatizaciones ----------

function isRunning(sim: SimulationState, automationId: Id): boolean {
  return sim.pending.some((p) => p.automationId === automationId);
}

function enqueue(sim: SimulationState, a: Automation): SimulationState {
  const logged = addLog(sim, 'info', `Automatización «${a.name}» en cola (modo queued): se ejecutará al terminar la anterior`, { automationId: a.id });
  const last = logged.log[logged.log.length - 1];
  const item: PendingAction = { id: `queue-${last?.id ?? 0}`, dueAt: sim.now, automationId: a.id, actions: a.actions };
  return { ...logged, queue: [...(logged.queue ?? []), item] };
}

/** Si la automatización ya no está ocupada, lanza su siguiente ejecución en cola. */
function drainQueue(sim: SimulationState, project: Project, a: Automation, exec: Exec): SimulationState {
  if (exec.chain.includes(a.id) || isRunning(sim, a.id)) return sim;
  const item = sim.queue?.find((q) => q.automationId === a.id);
  if (!item) return sim;
  const rest: SimulationState = { ...sim, queue: (sim.queue ?? []).filter((q) => q.id !== item.id) };
  if (exec.depth > MAX_DEPTH) {
    return addLog(rest, 'error', `Cola de «${a.name}» descartada: posible bucle infinito`, { automationId: a.id });
  }
  const started = addLog(rest, 'info', `Automatización «${a.name}»: ejecutando disparo en cola`, { automationId: a.id });
  const inner: Exec = { depth: exec.depth + 1, chain: exec.chain };
  const ran = runActionsInternal(started, project, item.actions, { automationId: a.id }, { depth: inner.depth, chain: [...exec.chain, a.id] });
  return drainQueue(ran, project, a, inner);
}

interface RunOpts {
  skipConditions?: boolean;
  manual?: boolean;
}

function runAutomationInternal(
  sim: SimulationState,
  project: Project,
  a: Automation,
  exec: Exec,
  reason: string,
  opts: RunOpts = {},
): SimulationState {
  if (!a.enabled && !opts.manual) return sim;
  const extra = { automationId: a.id };
  if (exec.depth > MAX_DEPTH) {
    return addLog(sim, 'error', `Automatización «${a.name}» no ejecutada: posible bucle infinito (límite de ${MAX_DEPTH} niveles)`, extra);
  }
  const busy = exec.chain.includes(a.id) || isRunning(sim, a.id);
  if (busy && a.mode === 'single') {
    return addLog(sim, 'warning', `Automatización «${a.name}» ya está en ejecución (modo single): se ignora el disparo`, extra);
  }
  if (!opts.skipConditions && !a.conditions.every((c) => evaluateCondition(c, sim))) {
    return addLog(sim, 'info', `Automatización «${a.name}»: condiciones no cumplidas`, extra);
  }
  if (busy && a.mode === 'queued') return enqueue(sim, a);
  let next = sim;
  if (a.mode === 'restart') next = { ...next, pending: next.pending.filter((p) => p.automationId !== a.id) };
  next = addLog(next, 'info', `Automatización «${a.name}» disparada (${reason})`, extra);
  next = runActionsInternal(next, project, a.actions, { automationId: a.id }, { depth: exec.depth + 1, chain: [...exec.chain, a.id] });
  return drainQueue(next, project, a, exec);
}

function stateTriggerMatches(t: Trigger, entityId: string, prev: EntityStateValue, next: EntityStateValue, project: Project): boolean {
  if (t.type === 'state') {
    if (t.entityId !== entityId || sameState(prev, next)) return false;
    return (t.from === undefined || sameState(prev, t.from)) && (t.to === undefined || sameState(next, t.to));
  }
  if (t.type === 'numeric_state') {
    if (t.entityId !== entityId) return false;
    return inNumericRange(next, t.above, t.below) && !inNumericRange(prev, t.above, t.below);
  }
  return fase3TriggerMatches(t, project, entityId, prev, next);
}

function fireStateTriggers(
  sim: SimulationState,
  project: Project,
  entityId: string,
  prev: EntityStateValue,
  next: EntityStateValue,
  exec: Exec,
): SimulationState {
  let result = sim;
  for (const a of project.automations) {
    let immediate = false;
    for (const [i, t] of a.triggers.entries()) {
      if (!stateTriggerMatches(t, entityId, prev, next, project)) continue;
      if (t.type === 'state' && t.for !== undefined && t.for > 0) {
        const timer: SimTimer = { kind: 'state_for', entityId, automationId: a.id, triggerIndex: i };
        result = scheduleTimer(result, `for:${a.id}:${i}`, result.now + t.for * SECOND_MS, timer);
      } else {
        immediate = true;
      }
    }
    if (immediate) result = runAutomationInternal(result, project, a, exec, `cambio de ${entityId}`);
  }
  return result;
}

/** Si cambia un sensor de temperatura, actualiza current_temperature del climate de su dispositivo. */
function syncClimate(sim: SimulationState, project: Project, entityId: string, st: EntityState): SimulationState {
  if (entityDomain(entityId) !== 'sensor' || st.attributes?.device_class !== 'temperature') return sim;
  const celsius = toNumber(st.state);
  const owner = findEntityOwner(project, entityId);
  if (celsius === undefined || !owner) return sim;
  let result = sim;
  for (const e of entitiesForDevice(owner.device, owner.def)) {
    const climate = result.entities[e.entityId];
    if (e.definition.domain !== 'climate' || !climate || climate.state === 'unavailable') continue;
    const updated = updateClimateCurrentTemperature(climate, celsius);
    result = { ...result, entities: { ...result.entities, [e.entityId]: updated } };
    const before = climate.attributes?.hvac_action;
    const after = updated.attributes?.hvac_action;
    if (before !== after && after !== undefined) {
      result = addLog(result, 'info', `${friendly(result, e.entityId)}: ${String(before ?? '—')} → ${String(after)} (${celsius} °C)`, { entityId: e.entityId });
    }
  }
  return result;
}

function applyChange(
  sim: SimulationState,
  project: Project,
  entityId: string,
  next: EntityState | EntityStateValue,
  exec: Exec,
  replace = false,
): SimulationState {
  const prev = sim.entities[entityId];
  if (!prev) return addLog(sim, 'warning', `Entidad desconocida: ${entityId}`, { entityId });
  const merged = merge(prev, next, replace);
  const changed = !sameState(prev.state, merged.state);
  const lastChanged = changed ? sim.now : prev.lastChanged;
  if (lastChanged !== undefined) merged.lastChanged = lastChanged;
  let result: SimulationState = { ...sim, entities: { ...sim.entities, [entityId]: merged } };
  if (!changed) return syncClimate(result, project, entityId, merged);
  result = recordSample(result, entityId, merged.state);
  if (!exec.quiet) {
    const change = { from: prev.state, to: merged.state };
    result = addLog(result, 'info', `${friendly(result, entityId)}: ${normalize(prev.state)} → ${normalize(merged.state)}`, { entityId, change });
  }
  result = cancelStateFor(result, entityId);
  result = syncClimate(result, project, entityId, merged);
  result = syncGroups(result, project, entityId, exec);
  result = resumeWaits(result, project, entityId, prev.state, merged.state, exec);
  return fireStateTriggers(result, project, entityId, prev.state, merged.state, exec);
}

/** Fase 3 (B19): recalcula el estado agregado de los grupos que contienen la entidad. */
function syncGroups(sim: SimulationState, project: Project, entityId: string, exec: Exec): SimulationState {
  let result = sim;
  for (const g of groupsContaining(project, entityId)) {
    const id = groupEntityId(g);
    const current = result.entities[id];
    const next = aggregateGroupState(g, result.entities);
    if (current && sameState(current.state, next.state)) continue;
    if (!current) {
      result = { ...result, entities: { ...result.entities, [id]: { ...next, lastChanged: result.now } } };
      continue;
    }
    result = applyChange(result, project, id, next, { ...exec, depth: exec.depth + 1 });
  }
  return result;
}

/** Fase 3 (B11): reanuda los wait_for_trigger cuyo disparador coincide con el cambio. */
function resumeWaits(
  sim: SimulationState,
  project: Project,
  entityId: string,
  prev: EntityStateValue,
  next: EntityStateValue,
  exec: Exec,
): SimulationState {
  const matching = sim.pending.filter((p) => p.wait?.triggers.some((t) => stateTriggerMatches(t, entityId, prev, next, project)));
  let result = sim;
  for (const p of matching) {
    if (!result.pending.some((x) => x.id === p.id)) continue;
    result = { ...result, pending: result.pending.filter((x) => x.id !== p.id) };
    const extra = p.automationId === undefined ? {} : { automationId: p.automationId };
    result = addLog(result, 'info', `Espera completada: ${friendly(result, entityId)} → ${normalize(next)}`, extra);
    result = continuePending(result, project, p, { depth: exec.depth + 1, chain: exec.chain });
  }
  return result;
}

/**
 * Cambia el estado de una entidad (evento físico o manual), lo registra y dispara las
 * automatizaciones afectadas. Por defecto fusiona atributos; con `replace` los sustituye.
 */
export function setEntityState(
  sim: SimulationState,
  project: Project,
  entityId: string,
  next: EntityState | EntityStateValue,
  opts: { replace?: boolean; quiet?: boolean } = {},
): SimulationState {
  const exec: Exec = opts.quiet ? { ...ROOT, quiet: true } : ROOT;
  const result = applyChange(sim, project, entityId, next, exec, opts.replace ?? false);
  if (opts.quiet) return result;
  const value = isEntityState(next) ? next.state : next;
  return annotateEvent(sim, result, { kind: 'state', entityId, value });
}

/** Fase 3 (B14): marca la primera entrada nueva del registro como evento de usuario. */
function annotateEvent(before: SimulationState, after: SimulationState, event: RecordedEvent): SimulationState {
  const id = `log-${nextSeq(before.log)}`;
  const idx = after.log.findIndex((e) => e.id === id);
  const entry = after.log[idx];
  if (idx === -1 || !entry) return after;
  const log = [...after.log];
  log[idx] = { ...entry, event };
  return { ...after, log };
}

/**
 * Fase 3 (B14): sustituye los eventos anotados entre `before` y `after` por uno solo (en la
 * primera entrada nueva). Lo usan los eventos físicos compuestos (movimiento, pulsación).
 */
export function markRecordedEvent(before: SimulationState, after: SimulationState, event: RecordedEvent): SimulationState {
  const first = nextSeq(before.log);
  let marked = false;
  const log = after.log.map((e) => {
    const n = Number(e.id.replace(/^log-/, ''));
    if (!(n >= first)) return e;
    if (!marked) {
      marked = true;
      return { ...e, event };
    }
    if (!e.event) return e;
    const copy = { ...e };
    delete copy.event;
    return copy;
  });
  return marked ? { ...after, log } : after;
}

// ---------- Escenas y scripts ----------

/** Busca una escena por id o por entity_id "scene.<slug del nombre>". */
export function findScene(project: Pick<Project, 'scenes'>, ref: string): Scene | undefined {
  const key = ref.startsWith('scene.') ? ref.slice(6) : ref;
  return project.scenes.find((s) => s.id === key || slugify(s.name) === key);
}

/** Busca un script por id o por entity_id "script.<slug del nombre>". */
export function findScript(project: Pick<Project, 'scripts'>, ref: string): Script | undefined {
  const key = ref.startsWith('script.') ? ref.slice(7) : ref;
  return project.scripts.find((s) => s.id === key || slugify(s.name) === key);
}

function activateSceneInternal(sim: SimulationState, project: Project, sceneId: Id, exec: Exec): SimulationState {
  const scene = findScene(project, sceneId);
  if (!scene) return addLog(sim, 'warning', `Escena desconocida: ${sceneId}`);
  if (exec.depth > MAX_DEPTH) return addLog(sim, 'error', `Escena «${scene.name}» no activada: posible bucle infinito`);
  let result = addLog(sim, 'info', `Escena «${scene.name}» activada`);
  const inner = { depth: exec.depth + 1, chain: exec.chain };
  for (const [entityId, state] of Object.entries(scene.entities)) {
    const calls = result.entities[entityId] ? sceneServiceCalls(entityId, state) : undefined;
    if (!calls) {
      result = applyChange(result, project, entityId, state, inner);
      continue;
    }
    for (const c of calls) result = callServiceInternal(result, project, entityId, c.service, c.data, {}, inner);
  }
  return result;
}

function runScriptInternal(sim: SimulationState, project: Project, scriptId: Id, ctx: RunCtx, exec: Exec): SimulationState {
  const script = findScript(project, scriptId);
  if (!script) return addLog(sim, 'warning', `Script desconocido: ${scriptId}`);
  if (exec.chain.includes(script.id)) {
    return addLog(sim, 'error', `Script «${script.name}» no ejecutado: se llama a sí mismo (bucle)`);
  }
  const result = addLog(sim, 'info', `Script «${script.name}» ejecutado`);
  const inner: RunCtx = { scriptId: script.id };
  if (ctx.automationId !== undefined) inner.automationId = ctx.automationId;
  return runActionsInternal(result, project, script.sequence, inner, { depth: exec.depth + 1, chain: [...exec.chain, script.id] });
}

export function activateScene(sim: SimulationState, project: Project, sceneId: Id): SimulationState {
  return activateSceneInternal(sim, project, sceneId, ROOT);
}

export function runScript(sim: SimulationState, project: Project, scriptId: Id): SimulationState {
  return runScriptInternal(sim, project, scriptId, {}, ROOT);
}

// ---------- Acciones ----------

function callServiceInternal(
  sim: SimulationState,
  project: Project,
  entityId: string,
  fullService: string,
  data: ServiceData | undefined,
  ctx: RunCtx,
  exec: Exec,
): SimulationState {
  const target = entityDomain(entityId);
  const [domain = '', service = ''] = fullService.includes('.') ? fullService.split('.') : [target, fullService];
  const name = `${domain}.${service}`;
  if (domain === 'scene' && service === 'turn_on') return activateSceneInternal(sim, project, entityId, exec);
  if (domain === 'script') {
    const ref = service === 'turn_on' ? entityId : name;
    return runScriptInternal(sim, project, ref, ctx, exec);
  }
  const logExtra = { entityId, ...(ctx.automationId === undefined ? {} : { automationId: ctx.automationId }) };
  const group = findGroupByEntity(project, entityId);
  if (group) return callGroupService(sim, project, group, service, data, ctx, exec);
  const current = sim.entities[entityId];
  if (!current) return addLog(sim, 'warning', `Servicio ${name}: entidad desconocida ${entityId}`, logExtra);
  if (domain !== target && domain !== 'homeassistant') {
    return addLog(sim, 'warning', `El servicio ${name} no aplica a ${entityId}`, logExtra);
  }
  if (current.state === 'unavailable') {
    return addLog(sim, 'warning', `Servicio ${name}: ${friendly(sim, entityId)} no está disponible`, logExtra);
  }
  if (project.reliability?.latency && !exec.immediate) return delayServiceCall(sim, project, entityId, name, data, ctx);
  const caps = entityCapabilities(project, entityId);
  const res = applyService(target, service, current, data, { now: sim.now, capabilities: caps });
  if (!res) return addLog(sim, 'warning', `Servicio no soportado en la simulación: ${name}`, logExtra);
  const desc = describeServiceData(data);
  let next = addLog(sim, 'info', `Servicio ${name} → ${friendly(sim, entityId)}${desc ? ` (${desc})` : ''}`, logExtra);
  for (const w of res.warnings) next = addLog(next, 'warning', `${friendly(sim, entityId)}: ${w}`, logExtra);
  next = cancelTimer(next, entityTimerKey(entityId));
  next = applyChange(next, project, entityId, res.state, exec, true);
  if (res.coverTarget !== undefined) {
    const seconds = coverStepSeconds(coverPosition(res.state), res.coverTarget, caps);
    next = scheduleTimer(next, entityTimerKey(entityId), next.now + seconds * SECOND_MS, { kind: 'cover_step', entityId, target: res.coverTarget });
  }
  if (res.after) {
    const timer: SimTimer = { kind: 'set_states', setStates: { [entityId]: res.after.state } };
    next = scheduleTimer(next, entityTimerKey(entityId), next.now + res.after.seconds * SECOND_MS, timer);
  }
  return next;
}

/** Fase 3 (B19): servicio sobre un grupo → mismo servicio en cada miembro. */
function callGroupService(
  sim: SimulationState,
  project: Project,
  group: NonNullable<ReturnType<typeof findGroupByEntity>>,
  service: string,
  data: ServiceData | undefined,
  ctx: RunCtx,
  exec: Exec,
): SimulationState {
  const id = groupEntityId(group);
  const groupState = sim.entities[id]?.state ?? 'off';
  const extra = { entityId: id, ...(ctx.automationId === undefined ? {} : { automationId: ctx.automationId }) };
  let result = addLog(sim, 'info', `Servicio ${group.domain}.${service} → grupo «${group.name}» (${group.entityIds.length} miembros)`, extra);
  const inner: Exec = { ...exec, depth: exec.depth + 1 };
  if (inner.depth > MAX_DEPTH) return addLog(result, 'error', `Grupo «${group.name}»: posible bucle infinito`, extra);
  for (const member of group.entityIds) {
    result = callServiceInternal(result, project, member, memberService(group, groupState, service, member), data, ctx, inner);
  }
  return result;
}

/** Fase 3 (B22): aplica la llamada tras la latencia simulada; en la nube puede fallar. */
function delayServiceCall(
  sim: SimulationState,
  project: Project,
  entityId: string,
  service: string,
  data: ServiceData | undefined,
  ctx: RunCtx,
): SimulationState {
  const rel = project.reliability;
  let state = sim.rngState ?? rel?.seed ?? 1;
  const [r1, s1] = nextRandom(state);
  const [r2, s2] = nextRandom(s1);
  state = s2;
  const info = latencyFor(project, catalog, entityId, r1);
  const extra = { entityId, ...(ctx.automationId === undefined ? {} : { automationId: ctx.automationId }) };
  const next: SimulationState = { ...sim, rngState: state };
  if (info.cloud && (rel?.failureRate ?? 0) > 0 && r2 < (rel?.failureRate ?? 0)) {
    return addLog(next, 'error', `Servicio ${service} → ${friendly(sim, entityId)}: falló la llamada a la nube (fallo simulado)`, extra);
  }
  const timer: SimTimer = { kind: 'service_call', entityId, service };
  if (data !== undefined) timer.data = data;
  if (ctx.automationId !== undefined) timer.automationId = ctx.automationId;
  const key = `latency:${entityId}:${sim.now}:${state}`;
  const logged = addLog(next, 'info', `Servicio ${service} → ${friendly(sim, entityId)}: en camino (${info.ms} ms${info.cloud ? ', nube' : ''})`, extra);
  return scheduleTimer(logged, key, sim.now + info.ms, timer);
}

/**
 * Llama a un servicio de HA sobre una entidad: vía única para el usuario y las automatizaciones.
 * `service` puede ser "light.turn_on" o solo "turn_on" (se usa el dominio de la entidad).
 * Siempre registra la llamada, aunque el estado no cambie, y dispara las automatizaciones.
 * rgb_color admite [r, g, b] o el texto "[r, g, b]".
 */
export function callService(
  sim: SimulationState,
  project: Project,
  entityId: string,
  service: string,
  data?: ServiceData,
): SimulationState {
  const result = callServiceInternal(sim, project, entityId, service, data, {}, ROOT);
  const event: RecordedEvent = { kind: 'service', entityId, service };
  const plain = data ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Array.isArray(v) ? `[${v.join(', ')}]` : v])) : undefined;
  if (plain && Object.keys(plain).length > 0) event.data = plain;
  return annotateEvent(sim, result, event);
}

/**
 * Ejecuta una automatización a mano (botón «Ejecutar»): aunque esté desactivada y, con
 * skipConditions, sin evaluar sus condiciones (como «Ejecutar acciones» en HA).
 */
export function runAutomation(
  sim: SimulationState,
  project: Project,
  automationId: Id,
  opts: { skipConditions?: boolean } = {},
): SimulationState {
  const a = project.automations.find((x) => x.id === automationId);
  if (!a) return addLog(sim, 'warning', `Automatización desconocida: ${automationId}`);
  const reason = opts.skipConditions ? 'ejecución manual sin condiciones' : 'ejecución manual';
  return runAutomationInternal(sim, project, a, ROOT, reason, { manual: true, skipConditions: opts.skipConditions ?? false });
}

function schedule(sim: SimulationState, rest: Action[], seconds: number, ctx: RunCtx): SimulationState {
  const logged = addLog(sim, 'info', `Esperando ${seconds} s`, ctx.automationId === undefined ? {} : { automationId: ctx.automationId });
  const last = logged.log[logged.log.length - 1];
  const pending: PendingAction = { id: `pending-${last?.id ?? logged.pending.length}`, dueAt: sim.now + seconds * 1000, actions: rest };
  if (ctx.automationId !== undefined) pending.automationId = ctx.automationId;
  if (ctx.scriptId !== undefined) pending.scriptId = ctx.scriptId;
  if (ctx.variables !== undefined && Object.keys(ctx.variables).length > 0) pending.variables = ctx.variables;
  return { ...logged, pending: [...logged.pending, pending] };
}

/** Fase 3 (B11): wait_for_trigger deja el resto de acciones esperando al disparador. */
function scheduleWait(sim: SimulationState, rest: Action[], a: WaitForTriggerAction, ctx: RunCtx): SimulationState {
  const extra = ctx.automationId === undefined ? {} : { automationId: ctx.automationId };
  const timeout = a.timeoutSeconds !== undefined ? Math.max(0, a.timeoutSeconds) : undefined;
  const logged = addLog(sim, 'info', timeout === undefined ? 'Esperando a un disparador' : `Esperando a un disparador (máximo ${formatDuration(timeout)})`, extra);
  const last = logged.log[logged.log.length - 1];
  const pending: PendingAction = {
    id: `wait-${last?.id ?? logged.pending.length}`,
    dueAt: timeout === undefined ? WAIT_FOREVER : sim.now + timeout * SECOND_MS,
    actions: rest,
    wait: { triggers: a.triggers, continueOnTimeout: a.continueOnTimeout ?? true, ...(timeout === undefined ? { forever: true } : {}) },
  };
  if (ctx.automationId !== undefined) pending.automationId = ctx.automationId;
  if (ctx.scriptId !== undefined) pending.scriptId = ctx.scriptId;
  if (ctx.variables !== undefined && Object.keys(ctx.variables).length > 0) pending.variables = ctx.variables;
  return { ...logged, pending: [...logged.pending, pending] };
}

function allConditions(conds: Condition[], sim: SimulationState): boolean {
  return conds.every((c) => evaluateCondition(c, sim));
}

function runActionsInternal(sim: SimulationState, project: Project, actions: Action[], ctx: RunCtx, exec: Exec): SimulationState {
  if (exec.depth > MAX_DEPTH) {
    return addLog(sim, 'error', `Acciones no ejecutadas: posible bucle infinito (límite de ${MAX_DEPTH} niveles)`);
  }
  let result = sim;
  let queue: Action[] = actions;
  let vars: Variables = ctx.variables ?? {};
  const extra = ctx.automationId === undefined ? {} : { automationId: ctx.automationId };
  for (let steps = 0; queue.length > 0; steps++) {
    if (steps >= MAX_ACTION_STEPS) {
      return addLog(result, 'error', `Acciones detenidas: más de ${MAX_ACTION_STEPS} pasos sin espera (¿repeat infinito?)`, extra);
    }
    const [action, ...rest] = queue;
    queue = rest;
    if (!action) continue;
    const c: RunCtx = Object.keys(vars).length > 0 ? { ...ctx, variables: vars } : ctx;
    switch (action.type) {
      case 'delay':
        return schedule(result, rest, Math.max(0, action.seconds), c);
      case 'service':
        result = callServiceInternal(result, project, action.entityId, action.service, renderData(action.data, vars, result), c, exec);
        break;
      case 'scene':
        result = activateSceneInternal(result, project, action.sceneId, exec);
        break;
      case 'script':
        result = runScriptInternal(result, project, action.scriptId, c, exec);
        break;
      case 'choose': {
        const index = action.choices.findIndex((o) => allConditions(o.conditions, result));
        const chosen = index === -1 ? action.default ?? [] : (action.choices[index]?.sequence ?? []);
        result = addLog(result, 'info', index === -1 ? 'choose: ninguna opción se cumple; se usa la opción por defecto' : `choose: se cumple la opción ${index + 1}`, extra);
        queue = [...chosen, ...rest];
        break;
      }
      case 'if': {
        const ok = allConditions(action.conditions, result);
        result = addLog(result, 'info', ok ? 'if: condiciones cumplidas (then)' : 'if: condiciones no cumplidas (else)', extra);
        queue = [...(ok ? action.then : action.else ?? []), ...rest];
        break;
      }
      case 'repeat':
        queue = [...expandRepeat(action, (conds) => allConditions(conds, result)), ...rest];
        break;
      case 'wait_for_trigger':
        return scheduleWait(result, rest, action, c);
      case 'notify': {
        const title = renderTemplate(action.title ?? 'Home Assistant', vars, result);
        const message = renderTemplate(action.message, vars, result);
        result = addLog(addNotification(result, title, message), 'info', `Notificación: ${title} — ${message}`, extra);
        break;
      }
      case 'variables': {
        const rendered: Variables = {};
        for (const [k, v] of Object.entries(action.variables)) rendered[k] = typeof v === 'string' ? renderTemplate(v, vars, result) : v;
        vars = { ...vars, ...rendered };
        break;
      }
    }
  }
  return result;
}

/** Ejecuta una lista de acciones. Un delay deja el resto como PendingAction. */
export function runActions(sim: SimulationState, project: Project, actions: Action[], ctx: RunCtx = {}): SimulationState {
  const chain = [ctx.automationId, ctx.scriptId].filter((x): x is Id => x !== undefined);
  return runActionsInternal(sim, project, actions, ctx, { depth: 0, chain });
}

// ---------- Reloj ----------

interface TimedEvent {
  at: number;
  automation: Automation;
  reason: string;
}

function triggerOffsetsMs(t: Trigger, day: number, sun: SunConfig): { at: number; reason: string } | undefined {
  if (t.type === 'time') {
    try {
      return { at: day + parseHHMM(t.at) * MINUTE_MS, reason: `hora ${t.at}` };
    } catch {
      return undefined;
    }
  }
  if (t.type === 'sun') {
    const times = sunTimes(day, sun);
    const base = t.event === 'sunrise' ? times.sunrise : times.sunset;
    return { at: base + (t.offsetMinutes ?? 0) * MINUTE_MS, reason: t.event === 'sunrise' ? 'amanecer' : 'atardecer' };
  }
  return undefined;
}

function collectTimedEvents(project: Project, from: number, to: number, sun: SunConfig): TimedEvent[] {
  const events: TimedEvent[] = [];
  const firstDay = startOfDay(from) - DAY_MS; // por si un offset negativo cae en el día anterior
  const lastDay = Math.min(startOfDay(to) + DAY_MS, firstDay + MAX_TICK_DAYS * DAY_MS);
  for (const automation of project.automations) {
    for (const t of automation.triggers) {
      for (let day = firstDay; day <= lastDay; day += DAY_MS) {
        const occ = triggerOffsetsMs(t, day, sun);
        if (occ && occ.at > from && occ.at <= to) events.push({ ...occ, automation });
      }
    }
  }
  return events.sort((a, b) => a.at - b.at);
}

function earliestPending(sim: SimulationState, to: number): PendingAction | undefined {
  let best: PendingAction | undefined;
  for (const p of sim.pending) {
    if (p.dueAt <= to && (!best || p.dueAt < best.dueAt)) best = p;
  }
  return best;
}

function runTimer(sim: SimulationState, project: Project, timer: SimTimer): SimulationState {
  switch (timer.kind) {
    case 'set_states': {
      let result = sim;
      for (const [entityId, st] of Object.entries(timer.setStates)) {
        if (result.entities[entityId]?.state === 'unavailable') continue;
        result = applyChange(result, project, entityId, st, ROOT);
      }
      return result;
    }
    case 'cover_step': {
      const current = sim.entities[timer.entityId];
      if (!current || (current.state !== 'opening' && current.state !== 'closing')) return sim;
      const step = coverStep(current, timer.target);
      const result = applyChange(sim, project, timer.entityId, step.state, ROOT, true);
      if (step.done) return result;
      const caps = entityCapabilities(project, timer.entityId);
      const seconds = coverStepSeconds(coverPosition(step.state), timer.target, caps);
      return scheduleTimer(result, entityTimerKey(timer.entityId), result.now + seconds * SECOND_MS, timer);
    }
    case 'state_for': {
      const a = project.automations.find((x) => x.id === timer.automationId);
      const t = a?.triggers[timer.triggerIndex];
      const current = sim.entities[timer.entityId];
      if (!a || !current || t?.type !== 'state' || t.entityId !== timer.entityId || !t.for) return sim;
      if (t.to !== undefined && !sameState(current.state, t.to)) return sim;
      if (current.lastChanged !== undefined && sim.now - current.lastChanged < t.for * SECOND_MS) return sim;
      const reason = `${timer.entityId} lleva ${formatDuration(t.for)} en ${normalize(current.state)}`;
      return runAutomationInternal(sim, project, a, ROOT, reason);
    }
    case 'service_call': {
      const ctx: RunCtx = timer.automationId === undefined ? {} : { automationId: timer.automationId };
      return callServiceInternal(sim, project, timer.entityId, timer.service, timer.data, ctx, { ...ROOT, immediate: true });
    }
  }
}

function runPending(sim: SimulationState, project: Project, p: PendingAction): SimulationState {
  const rest = { ...sim, now: Math.max(sim.now, p.dueAt), pending: sim.pending.filter((x) => x.id !== p.id) };
  if (p.timer) return runTimer(rest, project, p.timer);
  if (p.wait) {
    const extra = p.automationId === undefined ? {} : { automationId: p.automationId };
    if (!p.wait.continueOnTimeout) {
      const stopped = addLog(rest, 'warning', 'Tiempo de espera agotado: se detienen las acciones (continue_on_timeout: false)', extra);
      const automation = project.automations.find((a) => a.id === p.automationId);
      return automation ? drainQueue(stopped, project, automation, ROOT) : stopped;
    }
    return continuePending(addLog(rest, 'info', 'Tiempo de espera agotado: se continúa', extra), project, p, ROOT);
  }
  return continuePending(rest, project, p, ROOT);
}

/** Ejecuta las acciones restantes de una espera (delay o wait_for_trigger) ya retirada. */
function continuePending(sim: SimulationState, project: Project, p: PendingAction, exec: Exec): SimulationState {
  const ctx: RunCtx = {};
  if (p.automationId !== undefined) ctx.automationId = p.automationId;
  if (p.scriptId !== undefined) ctx.scriptId = p.scriptId;
  if (p.variables !== undefined) ctx.variables = p.variables;
  const chain = [...exec.chain, ...[p.automationId, p.scriptId].filter((x): x is Id => x !== undefined)];
  const ran = runActionsInternal(sim, project, p.actions, ctx, { depth: exec.depth, chain });
  const automation = project.automations.find((a) => a.id === p.automationId);
  return automation ? drainQueue(ran, project, automation, ROOT) : ran;
}

export interface TickOptions {
  sun?: SunConfig;
  /** Fase 3: catálogo para el modelo de entorno (por defecto el catálogo incluido). */
  defs?: DeviceDefinition[];
}

/**
 * Avanza el reloj deltaMs × speed, ejecuta en orden cronológico los disparadores de hora/sol
 * cruzados en (now, now + avance] y las acciones pendientes vencidas. No comprueba `running`.
 */
export function tick(sim: SimulationState, project: Project, deltaMs: number, opts: TickOptions = {}): SimulationState {
  const advance = deltaMs * sim.speed;
  if (!(advance > 0)) return sim;
  const to = sim.now + advance;
  const timed = collectTimedEvents(project, sim.now, to, opts.sun ?? DEFAULT_SUN);
  let result = sim;
  let idx = 0;
  for (let guard = 0; guard < MAX_TICK_EVENTS; guard++) {
    const pending = earliestPending(result, to);
    const event = timed[idx];
    // Fase 3 (B13): único punto de llamada del modelo de entorno.
    if (!pending && !event) return applyEnvironment({ ...result, now: to }, project, opts.defs ?? catalog, advance);
    if (pending && (!event || pending.dueAt <= event.at)) {
      result = runPending(result, project, pending);
    } else if (event) {
      idx++;
      result = runAutomationInternal({ ...result, now: event.at }, project, event.automation, ROOT, event.reason);
    }
  }
  return addLog({ ...result, now: to }, 'error', 'Demasiados eventos en un solo avance del reloj; se han descartado los restantes');
}
