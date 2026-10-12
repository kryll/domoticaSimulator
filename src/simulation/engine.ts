// Motor de simulación: funciones puras e inmutables (no leen el reloj del sistema).
import type {
  Action,
  Automation,
  AutomationTrace,
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
  TraceCondition,
  TraceTrigger,
  Trigger,
} from '../types';
import { catalog } from '../devices/catalog';
import { entitiesForDevice, entityDomain, initialEntityStates, slugify } from '../devices/entities';
import { entityCapabilities, findEntityOwner } from '../devices/capabilities';
import {
  DAY_MS,
  formatSimDate,
  formatSimTime,
  HOUR_MS,
  MINUTE_MS,
  parseHHMM,
  SECOND_MS,
  startOfDay,
  sunTimesAt,
  type SunConfig,
  type SunLocation,
} from './clock';
import { internetAvailable, isCloudDevice, isHaRestarting } from './connectivity';
import { energyStep, initialBatteryLevel, LOW_BATTERY_LEVEL, loadWatts, projectSettings, type EnergyStep } from './energy';
import { friendlyName, inNumericRange, normalizeState, sameState, toNumber } from './stateUtils';
import { addTrace, describeTrigger, explainCondition, newTrace, setTraceAction, updateTrace, type SunSource } from './trace';
import { reconcileAvailability } from './availability';
import { scriptKeys } from './scriptKeys';
import { formatNotification, isNotifyService, notificationContent } from './notify';
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
export { sameState } from './stateUtils';

/** Profundidad máxima de llamadas anidadas (automatización → acción → automatización...). */
export const MAX_DEPTH = 10;
/** Entradas máximas del registro (se conservan las más recientes, al final). */
export const MAX_LOG_ENTRIES = 500;
const MAX_TICK_EVENTS = 10_000;
const MAX_TICK_DAYS = 400;

interface RunCtx {
  automationId?: Id;
  scriptId?: Id;
  /** Traza que se va rellenando (solo acciones de primer nivel de una automatización). */
  trace?: { id: Id; offset: number };
}

/** Contexto interno de ejecución: profundidad y cadena de automatizaciones/scripts activos. */
interface Exec {
  depth: number;
  chain: readonly Id[];
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

function addLog(
  sim: SimulationState,
  level: LogLevel,
  message: string,
  extra: { entityId?: string; automationId?: Id; notification?: LogEntry['notification'] } = {},
): SimulationState {
  const entry: LogEntry = { id: `log-${nextSeq(sim.log)}`, timestamp: sim.now, level, message };
  if (extra.entityId !== undefined) entry.entityId = extra.entityId;
  if (extra.automationId !== undefined) entry.automationId = extra.automationId;
  if (extra.notification !== undefined) entry.notification = extra.notification;
  const log = [...sim.log, entry];
  return { ...sim, log: log.length > MAX_LOG_ENTRIES ? log.slice(log.length - MAX_LOG_ENTRIES) : log };
}

// ---------- Estados ----------

const normalize = normalizeState;
const friendly = friendlyName;

function isEntityState(v: EntityState | EntityStateValue): v is EntityState {
  return typeof v === 'object' && v !== null && 'state' in v;
}

function merge(prev: EntityState, next: EntityState | EntityStateValue, replace: boolean): EntityState {
  if (!isEntityState(next)) return { state: next, attributes: { ...prev.attributes } };
  if (replace) return { state: next.state, attributes: { ...next.attributes } };
  return { state: next.state, attributes: { ...prev.attributes, ...next.attributes } };
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
      return { ...timer, entityId: ren(timer.entityId) };
  }
}

function renameActions(actions: Action[], mapping: Record<string, string>): Action[] {
  return actions.map((a) => (a.type === 'service' && mapping[a.entityId] ? { ...a, entityId: mapping[a.entityId] ?? a.entityId } : a));
}

function renamePending(p: PendingAction, mapping: Record<string, string>): PendingAction {
  const next: PendingAction = { ...p, actions: renameActions(p.actions, mapping) };
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
  const sim: SimulationState = {
    running: false,
    now,
    speed: 1,
    entities: initialEntityStates(project, defs),
    pending: [],
    queue: [],
    log: [],
    startedAt: now,
  };
  return addLog(sim, 'info', `Simulación preparada con ${Object.keys(sim.entities).length} entidades`);
}

// ---------- Condiciones ----------

/** Ubicación del proyecto para calcular el sol (por defecto, Madrid). */
export function sunSourceOf(project?: Pick<Project, 'settings'>): SunLocation {
  const settings = projectSettings(project ?? {});
  const where: SunLocation = { latitude: settings.latitude, longitude: settings.longitude };
  if (settings.timeZone !== undefined) where.timeZone = settings.timeZone;
  return where;
}

/** Evalúa una condición. Las condiciones de sol usan la ubicación del proyecto (o Madrid). */
export function evaluateCondition(c: Condition, sim: SimulationState, project?: Pick<Project, 'settings'>): boolean {
  return explainCondition(c, sim, sunSourceOf(project)).result;
}

/** Amanecer y atardecer del día simulado actual en la ubicación del proyecto. */
export function projectSunTimes(sim: Pick<SimulationState, 'now'>, project: Pick<Project, 'settings'>): { sunrise: number; sunset: number } {
  return sunTimesAt(sim.now, sunSourceOf(project));
}

/** ¿Es de noche (antes del amanecer o después del atardecer) en la ubicación del proyecto? */
export function isNight(sim: Pick<SimulationState, 'now'>, project: Pick<Project, 'settings'>): boolean {
  const { sunrise, sunset } = projectSunTimes(sim, project);
  return sim.now < sunrise || sim.now >= sunset;
}

// ---------- Automatizaciones ----------

function isRunning(sim: SimulationState, automationId: Id): boolean {
  return sim.pending.some((p) => p.automationId === automationId);
}

function traceCtx(trace: AutomationTrace | undefined, offset = 0): RunCtx['trace'] {
  return trace ? { id: trace.id, offset } : undefined;
}

function withTrace(ctx: RunCtx, trace: RunCtx['trace']): RunCtx {
  return trace ? { ...ctx, trace } : ctx;
}

function enqueue(sim: SimulationState, a: Automation, trace: AutomationTrace): SimulationState {
  const logged = addLog(addTrace(sim, trace), 'info', `Automatización «${a.name}» en cola (modo queued): se ejecutará al terminar la anterior`, { automationId: a.id });
  const last = logged.log[logged.log.length - 1];
  const item: PendingAction = { id: `queue-${last?.id ?? 0}`, dueAt: sim.now, automationId: a.id, actions: a.actions, traceId: trace.id, traceOffset: 0 };
  return { ...logged, queue: [...(logged.queue ?? []), item] };
}

/** Si la automatización ya no está ocupada, lanza su siguiente ejecución en cola. */
function drainQueue(sim: SimulationState, project: Project, a: Automation, exec: Exec): SimulationState {
  if (exec.chain.includes(a.id) || isRunning(sim, a.id)) return sim;
  const item = sim.queue?.find((q) => q.automationId === a.id);
  if (!item) return sim;
  let rest: SimulationState = { ...sim, queue: (sim.queue ?? []).filter((q) => q.id !== item.id) };
  if (exec.depth > MAX_DEPTH) {
    if (item.traceId !== undefined) rest = updateTrace(rest, item.traceId, (t) => ({ ...t, result: 'error' }));
    return addLog(rest, 'error', `Cola de «${a.name}» descartada: posible bucle infinito`, { automationId: a.id });
  }
  let started = addLog(rest, 'info', `Automatización «${a.name}»: ejecutando disparo en cola`, { automationId: a.id });
  const trace = item.traceId === undefined ? undefined : { id: item.traceId, offset: 0 };
  if (trace) started = updateTrace(started, trace.id, (t) => ({ ...t, result: 'ran' }));
  const inner: Exec = { depth: exec.depth + 1, chain: exec.chain };
  const ctx = withTrace({ automationId: a.id }, trace);
  const ran = runActionsInternal(started, project, item.actions, ctx, { depth: inner.depth, chain: [...exec.chain, a.id] });
  return drainQueue(ran, project, a, inner);
}

interface RunOpts {
  skipConditions?: boolean;
  manual?: boolean;
}

/** Quita las esperas de una automatización (modo restart) y marca sus pasos como no ejecutados. */
function cancelWhere(sim: SimulationState, match: (p: PendingAction) => boolean, detail: string): SimulationState {
  const dropped = [...sim.pending.filter((p) => !isTimer(p) && match(p)), ...(sim.queue ?? []).filter(match)];
  if (dropped.length === 0) return sim;
  let result: SimulationState = { ...sim, pending: sim.pending.filter((p) => isTimer(p) || !match(p)) };
  if (sim.queue) result.queue = sim.queue.filter((p) => !match(p));
  for (const p of dropped) {
    if (p.traceId === undefined) continue;
    result = updateTrace(result, p.traceId, (t) => ({
      ...t,
      actions: t.actions.map((x) => (x.status === 'waiting' || (t.result === 'queued' && x.status === 'skipped') ? { ...x, status: 'skipped', detail } : x)),
    }));
  }
  return result;
}

/** Quita las esperas de una automatización (modo restart) y marca sus pasos como no ejecutados. */
function cancelRuns(sim: SimulationState, automationId: Id): SimulationState {
  return cancelWhere(sim, (p) => p.automationId === automationId && !sim.queue?.includes(p), 'cancelada: la automatización se reinició');
}

/** Detalle de las trazas cuyas esperas se cancelan al reiniciarse Home Assistant. */
export const HA_RESTART_CANCEL_DETAIL = 'cancelada: Home Assistant se reinició';

/**
 * Cancela todas las esperas de automatizaciones y scripts y las ejecuciones en cola (como al
 * reiniciar Home Assistant). Los temporizadores internos de los dispositivos siguen.
 */
export function cancelAllRuns(sim: SimulationState, detail = HA_RESTART_CANCEL_DETAIL): SimulationState {
  const before = userWaits(sim).length + (sim.queue?.length ?? 0);
  const result = cancelWhere(sim, () => true, detail);
  return before === 0 ? result : addLog(result, 'warning', `${before} espera${before === 1 ? '' : 's'} de automatizaciones o scripts cancelada${before === 1 ? '' : 's'}: Home Assistant se reinició`);
}

/** Aviso y bloqueo mientras Home Assistant se reinicia. */
function haBlocked(sim: SimulationState, what: string, extra: { entityId?: string; automationId?: Id } = {}): SimulationState | undefined {
  if (!isHaRestarting(sim)) return undefined;
  return addLog(sim, 'warning', `${what}: Home Assistant se está reiniciando`, extra);
}

function runAutomationInternal(
  sim: SimulationState,
  project: Project,
  a: Automation,
  exec: Exec,
  reason: string,
  trigger: TraceTrigger,
  opts: RunOpts = {},
): SimulationState {
  if (!a.enabled && !opts.manual) return sim;
  const extra = { automationId: a.id };
  const traced = (result: AutomationTrace['result'], conditions: TraceCondition[] = []): AutomationTrace =>
    newTrace(sim, project, a, trigger, conditions, result);
  if (isHaRestarting(sim)) {
    const logged = addLog(sim, 'warning', `Automatización «${a.name}» no ejecutada: Home Assistant se está reiniciando`, extra);
    return addTrace(logged, traced('ha_unavailable'));
  }
  if (exec.depth > MAX_DEPTH) {
    const logged = addLog(sim, 'error', `Automatización «${a.name}» no ejecutada: posible bucle infinito (límite de ${MAX_DEPTH} niveles)`, extra);
    return addTrace(logged, traced('error'));
  }
  const busy = exec.chain.includes(a.id) || isRunning(sim, a.id);
  if (busy && a.mode === 'single') {
    const logged = addLog(sim, 'warning', `Automatización «${a.name}» ya está en ejecución (modo single): se ignora el disparo`, extra);
    return addTrace(logged, traced('skipped_single'));
  }
  const where = sunSourceOf(project);
  const conditions: TraceCondition[] = opts.skipConditions
    ? []
    : a.conditions.map((c, index) => ({ index, ...explainCondition(c, sim, where) }));
  if (conditions.some((c) => !c.result)) {
    const logged = addLog(sim, 'info', `Automatización «${a.name}»: condiciones no cumplidas`, extra);
    return addTrace(logged, traced('conditions_failed', conditions));
  }
  if (busy && a.mode === 'queued') return enqueue(sim, a, traced('queued', conditions));
  const trace = traced('ran', conditions);
  let next = addTrace(sim, trace);
  if (a.mode === 'restart') next = cancelRuns(next, a.id);
  next = addLog(next, 'info', `Automatización «${a.name}» disparada (${reason})`, extra);
  const ctx = withTrace({ automationId: a.id }, traceCtx(trace));
  next = runActionsInternal(next, project, a.actions, ctx, { depth: exec.depth + 1, chain: [...exec.chain, a.id] });
  return drainQueue(next, project, a, exec);
}

function stateTriggerMatches(t: Trigger, entityId: string, prev: EntityStateValue, next: EntityStateValue): boolean {
  if (t.type === 'state') {
    if (t.entityId !== entityId || sameState(prev, next)) return false;
    return (t.from === undefined || sameState(prev, t.from)) && (t.to === undefined || sameState(next, t.to));
  }
  if (t.type === 'numeric_state') {
    if (t.entityId !== entityId) return false;
    return inNumericRange(next, t.above, t.below) && !inNumericRange(prev, t.above, t.below);
  }
  return false;
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
    let immediate: number | undefined;
    for (const [i, t] of a.triggers.entries()) {
      if (!stateTriggerMatches(t, entityId, prev, next)) continue;
      if (t.type === 'state' && t.for !== undefined && t.for > 0) {
        const timer: SimTimer = { kind: 'state_for', entityId, automationId: a.id, triggerIndex: i };
        result = scheduleTimer(result, `for:${a.id}:${i}`, result.now + t.for * SECOND_MS, timer);
      } else {
        immediate ??= i;
      }
    }
    const t = immediate === undefined ? undefined : a.triggers[immediate];
    if (immediate !== undefined && t) {
      const trigger: TraceTrigger = { index: immediate, description: describeTrigger(t, result) };
      result = runAutomationInternal(result, project, a, exec, `cambio de ${entityId}`, trigger);
    }
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

const POWERED_DOMAINS = new Set(['light', 'switch', 'fan', 'cover', 'media_player', 'vacuum', 'camera']);

/** El sensor `power` del dispositivo refleja la carga actual (enchufes y relés con medición). */
function syncPower(sim: SimulationState, project: Project, entityId: string, exec: Exec): SimulationState {
  if (!POWERED_DOMAINS.has(entityDomain(entityId))) return sim;
  const owner = findEntityOwner(project, entityId);
  if (!owner) return sim;
  const sensor = entitiesForDevice(owner.device, owner.def).find((e) => e.definition.domain === 'sensor' && e.definition.deviceClass === 'power');
  const current = sensor ? sim.entities[sensor.entityId] : undefined;
  if (!sensor || !current || current.state === 'unavailable') return sim;
  const watts = Math.round(loadWatts(owner.device, owner.def, sim.entities) * 10) / 10;
  if (toNumber(current.state) === watts) return sim;
  return applyChange(sim, project, sensor.entityId, watts, exec);
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
  if (!changed) return syncPower(syncClimate(result, project, entityId, merged), project, entityId, exec);
  result = addLog(result, 'info', `${friendly(result, entityId)}: ${normalize(prev.state)} → ${normalize(merged.state)}`, { entityId });
  result = cancelStateFor(result, entityId);
  result = syncClimate(result, project, entityId, merged);
  result = syncPower(result, project, entityId, exec);
  return fireStateTriggers(result, project, entityId, prev.state, merged.state, exec);
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
  opts: { replace?: boolean } = {},
): SimulationState {
  return applyChange(sim, project, entityId, next, ROOT, opts.replace ?? false);
}

// ---------- Escenas y scripts ----------

/** Busca una escena por id o por entity_id "scene.<slug del nombre>". */
export function findScene(project: Pick<Project, 'scenes'>, ref: string): Scene | undefined {
  const key = ref.startsWith('scene.') ? ref.slice(6) : ref;
  return project.scenes.find((s) => s.id === key || slugify(s.name) === key);
}

/** Busca un script por id o por entity_id "script.<clave>" (slug del nombre; _2, _3... si se repite). */
export function findScript(project: Pick<Project, 'scripts'>, ref: string): Script | undefined {
  const key = ref.startsWith('script.') ? ref.slice(7) : ref;
  const byId = project.scripts.find((s) => s.id === key);
  if (byId) return byId;
  const keys = scriptKeys(project.scripts);
  return project.scripts.find((s) => keys[s.id] === key);
}

interface Outcome {
  sim: SimulationState;
  ok: boolean;
  detail?: string;
}

const outcome = (sim: SimulationState, ok: boolean, detail?: string): Outcome => (detail === undefined ? { sim, ok } : { sim, ok, detail });

function activateSceneInternal(sim: SimulationState, project: Project, sceneId: Id, exec: Exec): Outcome {
  const blocked = haBlocked(sim, `Escena ${findScene(project, sceneId)?.name ?? sceneId} no activada`);
  if (blocked) return outcome(blocked, false, 'Home Assistant se está reiniciando');
  const scene = findScene(project, sceneId);
  if (!scene) return outcome(addLog(sim, 'warning', `Escena desconocida: ${sceneId}`), false, 'escena desconocida');
  if (exec.depth > MAX_DEPTH) return outcome(addLog(sim, 'error', `Escena «${scene.name}» no activada: posible bucle infinito`), false, 'posible bucle infinito');
  let result = addLog(sim, 'info', `Escena «${scene.name}» activada`);
  const inner = { depth: exec.depth + 1, chain: exec.chain };
  let failed = 0;
  for (const [entityId, state] of Object.entries(scene.entities)) {
    const calls = result.entities[entityId] ? sceneServiceCalls(entityId, state) : undefined;
    if (!calls) {
      result = applyChange(result, project, entityId, state, inner);
      continue;
    }
    for (const c of calls) {
      const r = callServiceCore(result, project, entityId, c.service, c.data, {}, inner);
      result = r.sim;
      if (!r.ok) failed++;
    }
  }
  return outcome(result, true, failed > 0 ? `${failed} llamada${failed === 1 ? '' : 's'} sin efecto` : undefined);
}

function runScriptInternal(sim: SimulationState, project: Project, scriptId: Id, ctx: RunCtx, exec: Exec): Outcome {
  const blocked = haBlocked(sim, `Script ${findScript(project, scriptId)?.name ?? scriptId} no ejecutado`);
  if (blocked) return outcome(blocked, false, 'Home Assistant se está reiniciando');
  const script = findScript(project, scriptId);
  if (!script) return outcome(addLog(sim, 'warning', `Script desconocido: ${scriptId}`), false, 'script desconocido');
  if (exec.chain.includes(script.id)) {
    return outcome(addLog(sim, 'error', `Script «${script.name}» no ejecutado: se llama a sí mismo (bucle)`), false, 'bucle');
  }
  const result = addLog(sim, 'info', `Script «${script.name}» ejecutado`);
  const inner: RunCtx = { scriptId: script.id };
  if (ctx.automationId !== undefined) inner.automationId = ctx.automationId;
  return outcome(runActionsInternal(result, project, script.sequence, inner, { depth: exec.depth + 1, chain: [...exec.chain, script.id] }), true);
}

export function activateScene(sim: SimulationState, project: Project, sceneId: Id): SimulationState {
  return activateSceneInternal(sim, project, sceneId, ROOT).sim;
}

export function runScript(sim: SimulationState, project: Project, scriptId: Id): SimulationState {
  return runScriptInternal(sim, project, scriptId, {}, ROOT).sim;
}

// ---------- Acciones ----------

/** ¿La entidad es de una integración de nube y no hay Internet? */
function cloudBlocked(sim: SimulationState, project: Project, entityId: string): boolean {
  const f = sim.failures;
  if (!f || (!f.internet && !f.powerOutage)) return false;
  const owner = findEntityOwner(project, entityId);
  return owner !== undefined && isCloudDevice(owner.device, owner.def) && !internetAvailable(project, catalog, f);
}

function callServiceCore(
  sim: SimulationState,
  project: Project,
  entityId: string,
  fullService: string,
  data: ServiceData | undefined,
  ctx: RunCtx,
  exec: Exec,
): Outcome {
  const blocked = haBlocked(sim, `Servicio ${fullService.includes('.') ? fullService : `${entityDomain(entityId)}.${fullService}`} no ejecutado`, { entityId });
  if (blocked) return outcome(blocked, false, 'Home Assistant se está reiniciando');
  if (isNotifyService(fullService)) return sendNotification(sim, fullService, data, ctx);
  const target = entityDomain(entityId);
  const [domain = '', service = ''] = fullService.includes('.') ? fullService.split('.') : [target, fullService];
  const name = `${domain}.${service}`;
  if (domain === 'scene' && service === 'turn_on') return activateSceneInternal(sim, project, entityId, exec);
  if (domain === 'script') {
    const ref = service === 'turn_on' ? entityId : name;
    return runScriptInternal(sim, project, ref, ctx, exec);
  }
  const logExtra = { entityId, ...(ctx.automationId === undefined ? {} : { automationId: ctx.automationId }) };
  const current = sim.entities[entityId];
  if (!current) return outcome(addLog(sim, 'warning', `Servicio ${name}: entidad desconocida ${entityId}`, logExtra), false, `entidad desconocida ${entityId}`);
  if (domain !== target && domain !== 'homeassistant') {
    return outcome(addLog(sim, 'warning', `El servicio ${name} no aplica a ${entityId}`, logExtra), false, `el servicio no aplica a ${entityId}`);
  }
  if (cloudBlocked(sim, project, entityId)) {
    const msg = `Servicio ${name} no ejecutado: ${friendly(sim, entityId)} usa una integración en la nube y no hay Internet`;
    return outcome(addLog(sim, 'error', msg, logExtra), false, 'integración en la nube sin Internet');
  }
  if (current.state === 'unavailable') {
    return outcome(addLog(sim, 'warning', `Servicio ${name}: ${friendly(sim, entityId)} no está disponible`, logExtra), false, `${friendly(sim, entityId)} no está disponible`);
  }
  const caps = entityCapabilities(project, entityId);
  const res = applyService(target, service, current, data, { now: sim.now, capabilities: caps });
  if (!res) return outcome(addLog(sim, 'warning', `Servicio no soportado en la simulación: ${name}`, logExtra), false, 'servicio no soportado en la simulación');
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
  return outcome(next, true, res.warnings.length > 0 ? res.warnings.join('; ') : undefined);
}

/** notify.*: deja la notificación en el registro (no necesita entidad). */
function sendNotification(sim: SimulationState, service: string, data: ServiceData | undefined, ctx: RunCtx): Outcome {
  const extra = ctx.automationId === undefined ? {} : { automationId: ctx.automationId };
  const content = notificationContent(data);
  if (!content) return outcome(addLog(sim, 'warning', `Servicio ${service}: falta el mensaje ("message")`, extra), false, 'falta el mensaje');
  return outcome(addLog(sim, 'info', formatNotification(content), { ...extra, notification: content }), true);
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
  return callServiceCore(sim, project, entityId, service, data, {}, ROOT).sim;
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
  return runAutomationInternal(sim, project, a, ROOT, reason, { manual: true }, { manual: true, skipConditions: opts.skipConditions ?? false });
}

/**
 * «Probar disparador»: simula que se cumple el disparador `triggerIndex` (sin cambiar la
 * entidad) y ejecuta la automatización evaluando de verdad sus condiciones. Deja traza.
 */
export function testTrigger(sim: SimulationState, project: Project, automationId: Id, triggerIndex: number): SimulationState {
  const a = project.automations.find((x) => x.id === automationId);
  if (!a) return addLog(sim, 'warning', `Automatización desconocida: ${automationId}`);
  const t = a.triggers[triggerIndex];
  if (!t) return addLog(sim, 'warning', `La automatización «${a.name}» no tiene el disparador ${triggerIndex + 1}`, { automationId });
  const description = describeTrigger(t, sim);
  return runAutomationInternal(sim, project, a, ROOT, `prueba del disparador: ${description}`, { index: triggerIndex, description }, { manual: true });
}

function schedule(sim: SimulationState, rest: Action[], seconds: number, ctx: RunCtx): SimulationState {
  const logged = addLog(sim, 'info', `Esperando ${seconds} s`, ctx.automationId === undefined ? {} : { automationId: ctx.automationId });
  const last = logged.log[logged.log.length - 1];
  const pending: PendingAction = { id: `pending-${last?.id ?? logged.pending.length}`, dueAt: sim.now + seconds * 1000, actions: rest };
  if (ctx.automationId !== undefined) pending.automationId = ctx.automationId;
  if (ctx.scriptId !== undefined) pending.scriptId = ctx.scriptId;
  if (ctx.trace) {
    pending.traceId = ctx.trace.id;
    pending.traceOffset = ctx.trace.offset;
  }
  return { ...logged, pending: [...logged.pending, pending] };
}

function runActionsInternal(sim: SimulationState, project: Project, actions: Action[], ctx: RunCtx, exec: Exec): SimulationState {
  if (exec.depth > MAX_DEPTH) {
    return addLog(sim, 'error', `Acciones no ejecutadas: posible bucle infinito (límite de ${MAX_DEPTH} niveles)`);
  }
  let result = sim;
  for (const [i, action] of actions.entries()) {
    const traceIndex = ctx.trace ? ctx.trace.offset + i : undefined;
    const mark = (r: Outcome): SimulationState => {
      if (!ctx.trace || traceIndex === undefined) return r.sim;
      const patch = r.detail === undefined ? { status: r.ok ? ('done' as const) : ('error' as const), at: sim.now } : { status: r.ok ? ('done' as const) : ('error' as const), at: sim.now, detail: r.detail };
      return setTraceAction(r.sim, ctx.trace.id, traceIndex, patch);
    };
    switch (action.type) {
      case 'delay': {
        const seconds = Math.max(0, action.seconds);
        if (ctx.trace && traceIndex !== undefined) {
          result = setTraceAction(result, ctx.trace.id, traceIndex, { status: 'waiting', at: result.now });
        }
        const next = ctx.trace && traceIndex !== undefined ? { ...ctx, trace: { id: ctx.trace.id, offset: traceIndex + 1 } } : ctx;
        return schedule(result, actions.slice(i + 1), seconds, next);
      }
      case 'service':
        result = mark(callServiceCore(result, project, action.entityId, action.service, action.data, withoutTrace(ctx), exec));
        break;
      case 'scene':
        result = mark(activateSceneInternal(result, project, action.sceneId, exec));
        break;
      case 'script':
        result = mark(runScriptInternal(result, project, action.scriptId, withoutTrace(ctx), exec));
        break;
    }
  }
  return result;
}

function withoutTrace(ctx: RunCtx): RunCtx {
  if (!ctx.trace) return ctx;
  const rest: RunCtx = { ...ctx };
  delete rest.trace;
  return rest;
}

/** Ejecuta una lista de acciones. Un delay deja el resto como PendingAction. */
export function runActions(sim: SimulationState, project: Project, actions: Action[], ctx: Omit<RunCtx, 'trace'> = {}): SimulationState {
  const chain = [ctx.automationId, ctx.scriptId].filter((x): x is Id => x !== undefined);
  return runActionsInternal(sim, project, actions, ctx, { depth: 0, chain });
}

// ---------- Reloj ----------

interface TimedEvent {
  at: number;
  automation: Automation;
  reason: string;
  triggerIndex: number;
}

function triggerOffsetsMs(t: Trigger, day: number, sun: SunSource): { at: number; reason: string } | undefined {
  if (t.type === 'time') {
    try {
      return { at: day + parseHHMM(t.at) * MINUTE_MS, reason: `hora ${t.at}` };
    } catch {
      return undefined;
    }
  }
  if (t.type === 'sun') {
    const times = sunTimesAt(day, sun);
    const base = t.event === 'sunrise' ? times.sunrise : times.sunset;
    return { at: base + (t.offsetMinutes ?? 0) * MINUTE_MS, reason: t.event === 'sunrise' ? 'amanecer' : 'atardecer' };
  }
  return undefined;
}

function collectTimedEvents(project: Project, from: number, to: number, sun: SunSource): TimedEvent[] {
  const events: TimedEvent[] = [];
  const firstDay = startOfDay(from) - DAY_MS; // por si un offset negativo cae en el día anterior
  const lastDay = Math.min(startOfDay(to) + DAY_MS, firstDay + MAX_TICK_DAYS * DAY_MS);
  for (const automation of project.automations) {
    for (const [triggerIndex, t] of automation.triggers.entries()) {
      if (t.type !== 'time' && t.type !== 'sun') continue;
      for (let day = firstDay; day <= lastDay; day += DAY_MS) {
        const occ = triggerOffsetsMs(t, day, sun);
        if (occ && occ.at > from && occ.at <= to) events.push({ ...occ, automation, triggerIndex });
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
      return runAutomationInternal(sim, project, a, ROOT, reason, { index: timer.triggerIndex, description: describeTrigger(t, sim) });
    }
  }
}

function runPending(sim: SimulationState, project: Project, p: PendingAction): SimulationState {
  const rest = { ...sim, now: Math.max(sim.now, p.dueAt), pending: sim.pending.filter((x) => x.id !== p.id) };
  if (p.timer) return runTimer(rest, project, p.timer);
  if (isHaRestarting(rest)) {
    // Normalmente ya se cancelaron al empezar el reinicio; por si acaso, no se ejecutan.
    const dropped = p.traceId === undefined ? rest : setTraceAction(rest, p.traceId, (p.traceOffset ?? 1) - 1, { status: 'skipped', detail: HA_RESTART_CANCEL_DETAIL });
    return addLog(dropped, 'warning', 'Espera descartada: Home Assistant se está reiniciando', p.automationId === undefined ? {} : { automationId: p.automationId });
  }
  const ctx: RunCtx = {};
  if (p.automationId !== undefined) ctx.automationId = p.automationId;
  if (p.scriptId !== undefined) ctx.scriptId = p.scriptId;
  let ready: SimulationState = rest;
  if (p.traceId !== undefined && p.traceOffset !== undefined) {
    ready = setTraceAction(ready, p.traceId, p.traceOffset - 1, { status: 'done', detail: undefined }); // `at` sigue siendo el inicio de la espera
    ctx.trace = { id: p.traceId, offset: p.traceOffset };
  }
  const chain = [ctx.automationId, ctx.scriptId].filter((x): x is Id => x !== undefined);
  const ran = runActionsInternal(ready, project, p.actions, ctx, { depth: 0, chain });
  const automation = project.automations.find((a) => a.id === p.automationId);
  return automation ? drainQueue(ran, project, automation, ROOT) : ran;
}

// ---------- Energía y baterías ----------

function batteryEntity(project: Project, defs: DeviceDefinition[], deviceId: Id): { entityId: string; isSensor: boolean } | undefined {
  const device = project.devices.find((d) => d.id === deviceId);
  const def = device ? defs.find((d) => d.id === device.definitionId) : undefined;
  if (!device || !def) return undefined;
  const entities = entitiesForDevice(device, def);
  const sensor = entities.find((e) => e.definition.domain === 'sensor' && e.definition.deviceClass === 'battery');
  if (sensor) return { entityId: sensor.entityId, isSensor: true };
  const first = entities[0];
  return first ? { entityId: first.entityId, isSensor: false } : undefined;
}

/** Refleja el nivel de batería en su sensor (o en el atributo battery_level de la entidad principal). */
function mirrorBattery(sim: SimulationState, project: Project, defs: DeviceDefinition[], deviceId: Id, level: number): SimulationState {
  const target = batteryEntity(project, defs, deviceId);
  const current = target ? sim.entities[target.entityId] : undefined;
  if (!target || !current || current.state === 'unavailable') return sim;
  const rounded = Math.round(level);
  if (target.isSensor) return toNumber(current.state) === rounded ? sim : applyChange(sim, project, target.entityId, rounded, ROOT);
  if (toNumber(current.attributes?.battery_level) === rounded) return sim;
  return applyChange(sim, project, target.entityId, { state: current.state, attributes: { battery_level: rounded } }, ROOT);
}

/**
 * Sensores `energy` (kWh) de enchufes y relés: valor inicial del catálogo + energía acumulada.
 * Se actualizan sin registro ni disparadores (cambian continuamente, como un contador).
 */
function syncEnergySensors(sim: SimulationState, project: Project, defs: DeviceDefinition[]): SimulationState {
  let entities = sim.entities;
  for (const device of project.devices) {
    const kwh = sim.energy?.kwhByDevice[device.id];
    const def = kwh === undefined ? undefined : defs.find((d) => d.id === device.definitionId);
    if (!def || kwh === undefined) continue;
    for (const e of entitiesForDevice(device, def)) {
      if (e.definition.deviceClass !== 'energy') continue;
      const current = entities[e.entityId];
      if (!current || current.state === 'unavailable') continue;
      const value = Math.round(((toNumber(e.definition.initialState) ?? 0) + kwh) * 100) / 100;
      if (toNumber(current.state) === value) continue;
      entities = { ...entities, [e.entityId]: { ...current, state: value, lastChanged: sim.now } };
    }
  }
  return entities === sim.entities ? sim : { ...sim, entities };
}

/** Nivel de batería de partida (sensor battery o 100 %) de un dispositivo aún sin registrar. */
function previousBattery(sim: SimulationState, project: Project, defs: DeviceDefinition[], deviceId: Id): number {
  const device = project.devices.find((d) => d.id === deviceId);
  const def = device ? defs.find((d) => d.id === device.definitionId) : undefined;
  return device && def ? initialBatteryLevel(device, def, sim.entities) : 100;
}

function deviceName(project: Project, deviceId: Id): string {
  return project.devices.find((d) => d.id === deviceId)?.name ?? deviceId;
}

function applyEnergyStep(sim: SimulationState, project: Project, defs: DeviceDefinition[], step: EnergyStep): SimulationState {
  let result: SimulationState = { ...sim, energy: step.energy, batteries: step.batteries };
  for (const [deviceId, level] of Object.entries(step.batteries)) {
    const before = sim.batteries?.[deviceId] ?? previousBattery(sim, project, defs, deviceId);
    if (Math.round(level) !== Math.round(before)) result = mirrorBattery(result, project, defs, deviceId, level);
  }
  result = syncEnergySensors(result, project, defs);
  for (const id of step.lowCrossed) {
    result = addLog(result, 'warning', `Batería baja: «${deviceName(project, id)}» está por debajo del ${LOW_BATTERY_LEVEL} %`);
  }
  if (step.depleted.length > 0) {
    for (const id of step.depleted) result = addLog(result, 'error', `«${deviceName(project, id)}» se ha quedado sin batería y deja de estar disponible`);
    result = reconcileAvailability(result, project, defs);
  }
  return result;
}

/** Acumula energía y descarga baterías entre la hora actual y `to`, y avanza el reloj a `to`. */
function advanceEnergy(sim: SimulationState, project: Project, defs: DeviceDefinition[], to: number): SimulationState {
  if (!(to > sim.now)) return sim;
  const step = energyStep(sim, project, defs, to - sim.now);
  return applyEnergyStep({ ...sim, now: to }, project, defs, step);
}

/**
 * Cambia el nivel de batería de un dispositivo (p. ej. «cambiar pilas» o pruebas): actualiza su
 * sensor y su disponibilidad (al 0 % deja de estar disponible; al recargar vuelve).
 */
export function setDeviceBattery(sim: SimulationState, project: Project, defs: DeviceDefinition[], deviceId: Id, level: number): SimulationState {
  const value = Math.max(0, Math.min(100, level));
  const before = sim.batteries?.[deviceId];
  let result: SimulationState = { ...sim, batteries: { ...sim.batteries, [deviceId]: value } };
  result = reconcileAvailability(result, project, defs);
  result = mirrorBattery(result, project, defs, deviceId, value);
  if (before !== undefined && before < LOW_BATTERY_LEVEL && value >= LOW_BATTERY_LEVEL) {
    result = addLog(result, 'info', `Batería de «${deviceName(project, deviceId)}» repuesta (${Math.round(value)} %)`);
  }
  return result;
}

export interface TickOptions {
  /** Horas de sol fijas (tests); sin ellas se usa la ubicación del proyecto. */
  sun?: SunConfig;
  /** Catálogo con el que calcular energía y baterías (por defecto, el del proyecto). */
  defs?: DeviceDefinition[];
}

/**
 * Avanza el reloj deltaMs × speed, ejecuta en orden cronológico los disparadores de hora/sol
 * cruzados en (now, now + avance] y las acciones pendientes vencidas, y acumula energía y
 * descarga de baterías entre medias. No comprueba `running`.
 */
export function tick(sim: SimulationState, project: Project, deltaMs: number, opts: TickOptions = {}): SimulationState {
  const advance = deltaMs * sim.speed;
  if (!(advance > 0)) return sim;
  const defs = opts.defs ?? catalog;
  const to = sim.now + advance;
  const timed = collectTimedEvents(project, sim.now, to, opts.sun ?? sunSourceOf(project));
  let result = sim;
  let idx = 0;
  for (let guard = 0; guard < MAX_TICK_EVENTS; guard++) {
    const pending = earliestPending(result, to);
    const event = timed[idx];
    if (!pending && !event) return advanceEnergy(result, project, defs, to);
    if (pending && (!event || pending.dueAt <= event.at)) {
      result = runPending(advanceEnergy(result, project, defs, pending.dueAt), project, pending);
    } else if (event) {
      idx++;
      const t = event.automation.triggers[event.triggerIndex];
      const ready = advanceEnergy(result, project, defs, event.at);
      const trigger: TraceTrigger = { index: event.triggerIndex, description: t ? describeTrigger(t, ready) : event.reason };
      result = runAutomationInternal({ ...ready, now: event.at }, project, event.automation, ROOT, event.reason, trigger);
    }
  }
  return addLog(advanceEnergy(result, project, defs, to), 'error', 'Demasiados eventos en un solo avance del reloj; se han descartado los restantes');
}

/** Paso máximo de jumpTo: así la energía y las baterías se integran por tramos cortos. */
export const JUMP_STEP_MS = HOUR_MS;

/**
 * Salta a una hora futura ejecutando por pasos todo lo que ocurra entre medias (esperas,
 * temporizadores, disparadores de hora y de sol). No va hacia atrás. Conserva la velocidad.
 */
export function jumpTo(sim: SimulationState, project: Project, defs: DeviceDefinition[], targetMs: number): SimulationState {
  if (!Number.isFinite(targetMs) || targetMs < sim.now) {
    return addLog(sim, 'warning', 'No se puede saltar hacia atrás en el tiempo: la simulación solo avanza');
  }
  if (targetMs === sim.now) return sim;
  const target = Math.min(targetMs, sim.now + MAX_TICK_DAYS * DAY_MS);
  let result: SimulationState = { ...sim, speed: 1 };
  while (result.now < target) {
    result = tick(result, project, Math.min(JUMP_STEP_MS, target - result.now), { defs });
  }
  result = { ...result, now: target, speed: sim.speed };
  return addLog(result, 'info', `Salto en el tiempo hasta las ${formatSimTime(target)} del ${formatSimDate(target)}`);
}
