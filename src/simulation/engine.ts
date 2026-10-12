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
  RecordedEvent,
  WaitForTriggerAction,
  PendingStep,
  ParallelJoin,
  ServiceAction,
} from '../types';
import { catalog } from '../devices/catalog';
import { entitiesForDevice, entityDomain, initialEntityStates, slugify } from '../devices/entities';
import { entityCapabilities, findEntityOwner } from '../devices/capabilities';
import { mapActionEntities, mapTriggerEntities, triggerIdOf } from '../automations/walk';
import { resolveServiceTargets } from '../devices/areas';
import {
  aggregateGroupState,
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
import { ATTRIBUTE_SEPARATOR, recordAttributeSamples, recordSample, sampleValue } from './history';
import { latencyFor, nextRandom } from './latency';
import { applyEnvironment } from './thermal';
import {
  DAY_MS,
  formatSimDate,
  formatSimTime,
  HOUR_MS,
  MINUTE_MS,
  parseHHMM,
  projectSunLocation,
  SECOND_MS,
  startOfDay,
  sunTimesAt,
  type SunConfig,
  type SunLocation,
} from './clock';
import { internetAvailable, isCloudDevice, isHaRestarting } from './connectivity';
import { energyStep, initialBatteryLevel, LOW_BATTERY_LEVEL, loadWatts, type EnergyStep } from './energy';
import { friendlyName, inNumericRange, normalizeState, sameState, toNumber } from './stateUtils';
import { addTrace, describeTrigger, explainCondition, newTrace, setTraceAction, updateTrace, type SunSource } from './trace';
import { reconcileAvailability } from './availability';
import { scriptKeys } from './scriptKeys';
import {
  DEFAULT_NOTIFICATION_TITLE,
  deliverNotification,
  formatNotification,
  isCloudNotifyService,
  isNotifyService,
  notificationContent,
  type NotificationContent,
} from './notify';
import {
  applyService,
  coverPosition,
  coverStep,
  coverStepSeconds,
  describeServiceData,
  sceneServiceCalls,
  updateClimateCurrentTemperature,
} from './services';
import { countLabel, plural } from '../ui/plural';
import { allDefinitions } from '../devices/catalog';
import { applyHelperService, findHelperByEntity, helperEntities, isHelperDomain, timerFinishedState } from './helpers';
import { DEFAULT_ALARM_CODE } from './services';

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
  /** Fase 3: variables de la ejecución (acción variables y trigger.*). */
  variables?: Variables;
  /** Fase 3: contexto (ámbito, bloque, vuelta de repeat) de cada acción al reanudar una espera. */
  steps?: PendingStep[];
  /**
   * Traza que se va rellenando (pasos de primer nivel de una automatización). `offset`: paso de
   * la primera acción; `indexes`: paso de cada acción si no son consecutivas (al reanudar una
   * espera dentro de un choose/if/repeat); `nestedIndex`: paso cuyas acciones son hijas.
   */
  trace?: { id: Id; offset: number; indexes?: number[]; nestedIndex?: number };
  /** Tanda 3: rama de un `parallel` (id de la unión). */
  join?: Id;
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
  /** Fase 3 (B14): cambio de estado registrado. */
  change?: LogEntry['change'];
  /** Notificación enviada (acción notify o servicio notify.*). */
  notification?: LogEntry['notification'];
}

function addLog(sim: SimulationState, level: LogLevel, message: string, extra: LogExtra = {}): SimulationState {
  const entry: LogEntry = { id: `log-${nextSeq(sim.log)}`, timestamp: sim.now, level, message };
  if (extra.entityId !== undefined) entry.entityId = extra.entityId;
  if (extra.automationId !== undefined) entry.automationId = extra.automationId;
  if (extra.change !== undefined) entry.change = extra.change;
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

function cancelStateFor(sim: SimulationState, entityId: string, project?: Project, next?: EntityStateValue): SimulationState {
  const stillInRange = (p: PendingAction): boolean => {
    // Tanda 3: numeric_state con `for` sigue contando mientras el valor no salga del rango.
    if (p.timer?.kind !== 'state_for' || !project || next === undefined) return false;
    const timer = p.timer;
    const t = project.automations.find((a) => a.id === timer.automationId)?.triggers[timer.triggerIndex];
    return t?.type === 'numeric_state' && inNumericRange(next, t.above, t.below);
  };
  const keep = sim.pending.filter((p) => !((p.timer?.kind === 'state_for' || p.timer?.kind === 'wait_for') && p.timer.entityId === entityId) || stillInRange(p));
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
    case 'wait_for':
    case 'helper_timer':
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
  if (sim.joins) next.joins = Object.fromEntries(Object.entries(sim.joins).map(([id, j]) => [id, { ...j, cont: renamePending(j.cont, map) }]));
  if (sim.history) {
    // Series de estado y de atributos («entity#atributo») con el entity_id nuevo.
    const history: NonNullable<SimulationState['history']> = {};
    for (const [key, samples] of Object.entries(sim.history)) {
      const cut = key.indexOf(ATTRIBUTE_SEPARATOR);
      const id = cut === -1 ? key : key.slice(0, cut);
      history[(map[id] ?? id) + (cut === -1 ? '' : key.slice(cut))] = samples;
    }
    next.history = history;
  }
  if (sim.offline) {
    const offline: Record<Id, Record<string, EntityState>> = {};
    for (const [deviceId, states] of Object.entries(sim.offline)) offline[deviceId] = renameKey(states, map);
    next.offline = offline;
  }
  return next;
}

// ---------- Creación ----------

export function createSimulationState(project: Project, defs: DeviceDefinition[], now: number): SimulationState {
  const devices = initialEntityStates(project, allDefinitions(project, defs));
  const entities = { ...devices, ...helperEntities(project), ...peopleEntities(project), ...groupEntities(project, devices) };
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
  let withAttrs = sim;
  for (const [id, e] of Object.entries(entities)) withAttrs = recordAttributeSamples(withAttrs, id, e);
  return addLog(withAttrs, 'info', `Simulación preparada con ${countLabel(Object.keys(sim.entities).length, 'entidad', 'entidades', { zero: 'ninguna entidad' })}`);
}

// ---------- Condiciones ----------

/** Ubicación del proyecto para calcular el sol (por defecto, Madrid). */
export function sunSourceOf(project?: Pick<Project, 'settings'>): SunLocation {
  return projectSunLocation(project ?? {});
}

/**
 * Evalúa una condición (incluidas not y zone de la Fase 3). Las condiciones de sol usan la
 * ubicación del proyecto (o Madrid).
 */
export function evaluateCondition(c: Condition, sim: SimulationState, project?: Pick<Project, 'settings'>, vars?: Variables): boolean {
  return explainCondition(c, sim, sunSourceOf(project), vars).result;
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
  return sim.pending.some((p) => p.automationId === automationId) || Object.values(sim.joins ?? {}).some((j) => j.cont.automationId === automationId);
}

function traceCtx(trace: AutomationTrace | undefined, offset = 0): RunCtx['trace'] {
  return trace ? { id: trace.id, offset } : undefined;
}

function withTrace(ctx: RunCtx, trace: RunCtx['trace']): RunCtx {
  return trace ? { ...ctx, trace } : ctx;
}

function enqueue(sim: SimulationState, a: Automation, trace: AutomationTrace, variables?: Variables): SimulationState {
  const logged = addLog(addTrace(sim, trace), 'info', `Automatización «${a.name}» en cola (modo queued): se ejecutará al terminar la anterior`, { automationId: a.id });
  const last = logged.log[logged.log.length - 1];
  const item: PendingAction = { id: `queue-${last?.id ?? 0}`, dueAt: sim.now, automationId: a.id, actions: a.actions, traceId: trace.id, traceOffset: 0 };
  if (variables && Object.keys(variables).length > 0) item.variables = variables;
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
  const ctx = withTrace(item.variables ? { automationId: a.id, variables: item.variables } : { automationId: a.id }, trace);
  const ran = runActionsInternal(started, project, item.actions, ctx, { depth: inner.depth, chain: [...exec.chain, a.id] });
  return drainQueue(ran, project, a, inner);
}

interface RunOpts {
  skipConditions?: boolean;
  manual?: boolean;
  /** Variables trigger.* del disparo. */
  variables?: Variables;
}

/** Quita las esperas de una automatización (modo restart) y marca sus pasos como no ejecutados. */
function cancelWhere(sim: SimulationState, match: (p: PendingAction) => boolean, detail: string): SimulationState {
  const dropped = [...sim.pending.filter((p) => !isTimer(p) && match(p)), ...(sim.queue ?? []).filter(match)];
  if (dropped.length === 0 && !Object.values(sim.joins ?? {}).some((j) => match(j.cont))) return sim;
  let result: SimulationState = { ...sim, pending: sim.pending.filter((p) => isTimer(p) || !match(p)) };
  if (sim.queue) result.queue = sim.queue.filter((p) => !match(p));
  // Tanda 3: las continuaciones de los `parallel` de esas ejecuciones tampoco siguen.
  if (sim.joins) result.joins = Object.fromEntries(Object.entries(sim.joins).filter(([, j]) => !match(j.cont)));
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
  const cancelled = cancelWhere(sim, () => true, detail);
  // Los disparadores con `for:` pendientes también se pierden al reiniciar.
  const dropTimer = (p: PendingAction): boolean => p.timer?.kind === 'state_for' || p.timer?.kind === 'wait_for';
  const result = cancelled.pending.some(dropTimer) ? { ...cancelled, pending: cancelled.pending.filter((p) => !dropTimer(p)) } : cancelled;
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
  // E1: con las automatizaciones en el HA real, el motor no las dispara (sí las manuales).
  if (sim.automationsExternal && !opts.manual) return sim;
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
    : a.conditions.map((c, index) => ({ index, ...explainCondition(c, sim, where, opts.variables) }));
  if (conditions.some((c) => !c.result)) {
    const logged = addLog(sim, 'info', `Automatización «${a.name}»: condiciones no cumplidas`, extra);
    return addTrace(logged, traced('conditions_failed', conditions));
  }
  if (busy && a.mode === 'queued') return enqueue(sim, a, traced('queued', conditions), opts.variables);
  const trace = traced('ran', conditions);
  let next = addTrace(sim, trace);
  if (a.mode === 'restart') next = cancelRuns(next, a.id);
  next = addLog(next, 'info', `Automatización «${a.name}» disparada (${reason})`, extra);
  const base: RunCtx = opts.variables ? { automationId: a.id, variables: opts.variables } : { automationId: a.id };
  const ctx = withTrace(base, traceCtx(trace));
  next = runActionsInternal(next, project, a.actions, ctx, { depth: exec.depth + 1, chain: [...exec.chain, a.id] });
  return drainQueue(next, project, a, exec);
}

function stateTriggerMatches(t: Trigger, entityId: string, prev: EntityStateValue, next: EntityStateValue, project: Project): boolean {
  if (t.enabled === false) return false;
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
    let immediate: number | undefined;
    for (const [i, t] of a.triggers.entries()) {
      if (!stateTriggerMatches(t, entityId, prev, next, project)) continue;
      if ((t.type === 'state' || t.type === 'numeric_state') && t.for !== undefined && t.for > 0) {
        const timer: SimTimer = { kind: 'state_for', entityId, automationId: a.id, triggerIndex: i };
        result = scheduleTimer(result, `for:${a.id}:${i}`, result.now + t.for * SECOND_MS, timer);
      } else {
        immediate ??= i;
      }
    }
    const t = immediate === undefined ? undefined : a.triggers[immediate];
    if (immediate !== undefined && t) {
      const trigger = traceTrigger(t, immediate, result);
      // Personas y zonas por su nombre («cambio de Ana»), no por su entity_id ni su id.
      const who = entityDomain(entityId) === 'person' || entityDomain(entityId) === 'zone' ? friendly(result, entityId) : entityId;
      const variables = triggerVariables(t, entityId, prev, next, immediate);
      result = runAutomationInternal(result, project, a, exec, `cambio de ${who}`, trigger, { variables });
    }
  }
  return result;
}

/** Paso «disparador» de la traza, con el id del disparador si lo tiene. */
function traceTrigger(t: Trigger, index: number, sim: SimulationState): { index: number; description: string; id?: string } {
  const description = describeTrigger(t, sim);
  return t.id === undefined || t.id === '' ? { index, description } : { index, description, id: t.id };
}

/** Variables trigger.* de un disparo por cambio de estado (para las plantillas {{ }}). */
function triggerVariables(t: Trigger, entityId: string, prev: EntityStateValue | undefined, next: EntityStateValue | undefined, index?: number): Variables {
  const vars: Variables = { 'trigger.platform': t.type === 'device_action' ? 'device' : t.type, 'trigger.entity_id': entityId };
  if (index !== undefined) vars['trigger.id'] = triggerIdOf(t, index);
  if (prev !== undefined) vars['trigger.from_state.state'] = normalize(prev);
  if (next !== undefined) vars['trigger.to_state.state'] = normalize(next);
  return vars;
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
    result = recordAttributeSamples({ ...result, entities: { ...result.entities, [e.entityId]: updated } }, e.entityId, updated);
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
  let result: SimulationState = recordAttributeSamples({ ...sim, entities: { ...sim.entities, [entityId]: merged } }, entityId, merged);
  if (!changed) return syncPower(syncClimate(result, project, entityId, merged), project, entityId, exec);
  result = recordSample(result, entityId, merged.state);
  if (!exec.quiet) {
    const change = { from: prev.state, to: merged.state };
    result = addLog(result, 'info', `${friendly(result, entityId)}: ${normalize(prev.state)} → ${normalize(merged.state)}`, { entityId, change });
  }
  result = cancelStateFor(result, entityId, project, merged.state);
  result = syncClimate(result, project, entityId, merged);
  result = syncPower(result, project, entityId, exec);
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
    if (!result.pending.some((x) => x.id === p.id) || !p.wait) continue;
    const hits = p.wait.triggers.map((t, i) => ({ t, i })).filter(({ t }) => stateTriggerMatches(t, entityId, prev, next, project));
    const now = hits.find(({ t }) => !(t.type === 'state' && t.for !== undefined && t.for > 0));
    if (now) {
      const vars = triggerVariables(now.t, entityId, prev, next, now.i);
      result = completeWait(result, project, p, `${friendly(result, entityId)} → ${normalize(next)}`, { depth: exec.depth + 1, chain: exec.chain }, vars);
      continue;
    }
    // Disparadores con `for:`: se confirma cuando la entidad lleve ese tiempo en el estado.
    for (const { t, i } of hits) {
      if (t.type !== 'state' || !t.for) continue;
      const timer: SimTimer = { kind: 'wait_for', entityId, waitId: p.id, triggerIndex: i };
      result = scheduleTimer(result, `waitfor:${p.id}:${i}`, result.now + t.for * SECOND_MS, timer);
    }
  }
  return result;
}

/** Termina una espera wait_for_trigger porque se cumplió un disparador y sigue con sus acciones. */
function completeWait(sim: SimulationState, project: Project, p: PendingAction, what: string, exec: Exec, vars: Variables = {}): SimulationState {
  const extra = p.automationId === undefined ? {} : { automationId: p.automationId };
  let result: SimulationState = {
    ...sim,
    pending: sim.pending.filter((x) => x.id !== p.id && !(x.timer?.kind === 'wait_for' && x.timer.waitId === p.id)),
  };
  result = addLog(result, 'info', `Espera completada: ${what}`, extra);
  // Como en HA, las variables wait.trigger.* quedan visibles para el resto de acciones.
  const waitVars: Variables = {};
  for (const [k, v] of Object.entries(vars)) waitVars[`wait.${k}`] = v;
  const withVars: PendingAction = Object.keys(waitVars).length === 0 ? p : addScopeToPending(p, waitVars);
  return continuePending(result, project, withVars, exec);
}

/** Añade variables al ámbito de todas las acciones restantes de una espera. */
function addScopeToPending(p: PendingAction, vars: Variables): PendingAction {
  const steps = p.actions.map((_, i) => {
    const s = p.steps?.[i] ?? {};
    return { ...s, scope: { ...(s.scope ?? p.variables ?? {}), ...vars } };
  });
  return { ...p, steps };
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
  opts: { replace?: boolean; quiet?: boolean; record?: boolean } = {},
): SimulationState {
  const exec: Exec = opts.quiet ? { ...ROOT, quiet: true } : ROOT;
  const result = applyChange(sim, project, entityId, next, exec, opts.replace ?? false);
  // record: false → cambio del sistema (disponibilidad, fallos), no un evento del usuario (B14).
  if (opts.quiet || opts.record === false) return result;
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
  /** Tanda 3: error que detiene la secuencia (salvo continue_on_error), como una excepción en HA. */
  fatal?: boolean;
}

const outcome = (sim: SimulationState, ok: boolean, detail?: string): Outcome => (detail === undefined ? { sim, ok } : { sim, ok, detail });
const fatalOutcome = (sim: SimulationState, detail: string): Outcome => ({ sim, ok: false, detail, fatal: true });

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
  if (blocked) return fatalOutcome(blocked, 'Home Assistant se está reiniciando');
  if (isNotifyService(fullService)) return notifyService(sim, project, fullService, data, ctx);
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
  if (group) return outcome(callGroupService(sim, project, group, service, data, ctx, exec), true);
  const current = sim.entities[entityId];
  if (!current) return outcome(addLog(sim, 'warning', `Servicio ${name}: entidad desconocida ${entityId}`, logExtra), false, `entidad desconocida ${entityId}`);
  if (domain !== target && domain !== 'homeassistant') {
    return outcome(addLog(sim, 'warning', `El servicio ${name} no aplica a ${entityId}`, logExtra), false, `el servicio no aplica a ${entityId}`);
  }
  if (cloudBlocked(sim, project, entityId)) {
    const msg = `Servicio ${name} no ejecutado: ${friendly(sim, entityId)} usa una integración en la nube y no hay Internet`;
    return fatalOutcome(addLog(sim, 'error', msg, logExtra), 'integración en la nube sin Internet');
  }
  if (current.state === 'unavailable') {
    return outcome(addLog(sim, 'warning', `Servicio ${name}: ${friendly(sim, entityId)} no está disponible`, logExtra), false, `${friendly(sim, entityId)} no está disponible`);
  }
  if (project.reliability?.latency && !exec.immediate) {
    if (sim.running) return delayServiceCall(sim, project, entityId, name, data, ctx);
    // En pausa el reloj no avanza: se aplica al momento y la latencia queda solo como información.
    const info = latencyFor(project, catalog, entityId);
    sim = addLog(sim, 'info', `Servicio ${name} → ${friendly(sim, entityId)}: latencia simulada de ${info.ms} ms${info.cloud ? ' (nube)' : ''}; con la simulación en pausa se aplica al momento`, logExtra);
  }
  if (isHelperDomain(target)) return helperServiceCall(sim, project, entityId, target, service, name, current, data, logExtra, exec);
  const caps = entityCapabilities(project, entityId);
  const owner = target === 'alarm_control_panel' ? findEntityOwner(project, entityId) : undefined;
  const res = applyService(target, service, current, data, { now: sim.now, capabilities: caps, code: owner?.device.alarmCode ?? DEFAULT_ALARM_CODE });
  if (!res) return fatalOutcome(addLog(sim, 'warning', `Servicio no soportado en la simulación: ${name}`, logExtra), 'servicio no soportado en la simulación');
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

/** Tanda 3: servicio sobre un helper (input_*, timer, counter). */
function helperServiceCall(
  sim: SimulationState,
  project: Project,
  entityId: string,
  domain: Parameters<typeof applyHelperService>[0],
  service: string,
  name: string,
  current: EntityState,
  data: ServiceData | undefined,
  logExtra: LogExtra,
  exec: Exec,
): Outcome {
  const res = applyHelperService(domain, entityId, service, current, data, sim.now, findHelperByEntity(project, entityId));
  if (!res) return fatalOutcome(addLog(sim, 'warning', `Servicio no soportado en la simulación: ${name}`, logExtra), 'servicio no soportado en la simulación');
  const desc = describeServiceData(data);
  let next = addLog(sim, 'info', `Servicio ${name} → ${friendly(sim, entityId)}${desc ? ` (${desc})` : ''}`, logExtra);
  for (const w of res.warnings) next = addLog(next, 'warning', `${friendly(sim, entityId)}: ${w}`, logExtra);
  if (res.timer) {
    next = cancelTimer(next, entityTimerKey(entityId));
    if ('start' in res.timer) next = scheduleTimer(next, entityTimerKey(entityId), next.now + res.timer.start * SECOND_MS, { kind: 'helper_timer', entityId });
  }
  next = applyChange(next, project, entityId, res.state, exec, true);
  if (res.event) next = fireEventInternal(next, project, res.event.type, res.event.data, exec);
  return outcome(next, res.warnings.length === 0, res.warnings.length > 0 ? res.warnings.join('; ') : undefined);
}

/** Datos de un evento como variables trigger.event.* */
function eventVariables(t: Trigger, index: number, eventType: string, data: Record<string, EntityStateValue>): Variables {
  const vars: Variables = { 'trigger.platform': 'event', 'trigger.id': triggerIdOf(t, index), 'trigger.event.event_type': eventType };
  for (const [k, v] of Object.entries(data)) vars[`trigger.event.data.${k}`] = v;
  return vars;
}

function eventMatches(t: Trigger, eventType: string, data: Record<string, EntityStateValue>): boolean {
  if (t.enabled === false || t.type !== 'event' || t.eventType !== eventType) return false;
  return Object.entries(t.eventData ?? {}).every(([k, v]) => data[k] !== undefined && sameState(data[k] ?? '', v));
}

function fireEventInternal(sim: SimulationState, project: Project, eventType: string, data: Record<string, EntityStateValue>, exec: Exec): SimulationState {
  const shown = Object.entries(data).map(([k, v]) => `${k}: ${String(v)}`).join(', ');
  let result = addLog(sim, 'info', `Evento ${eventType}${shown ? ` (${shown})` : ''}`, typeof data.entity_id === 'string' ? { entityId: data.entity_id } : {});
  // Esperas wait_for_trigger con disparador de evento.
  for (const p of result.pending.filter((x) => x.wait?.triggers.some((t) => eventMatches(t, eventType, data)))) {
    if (!result.pending.some((x) => x.id === p.id) || !p.wait) continue;
    const i = p.wait.triggers.findIndex((t) => eventMatches(t, eventType, data));
    const t = p.wait.triggers[i];
    const vars = t ? eventVariables(t, i, eventType, data) : {};
    result = completeWait(result, project, p, `evento ${eventType}`, { depth: exec.depth + 1, chain: exec.chain }, vars);
  }
  for (const a of project.automations) {
    const i = a.triggers.findIndex((t) => eventMatches(t, eventType, data));
    const t = a.triggers[i];
    if (!t) continue;
    result = runAutomationInternal(result, project, a, exec, `evento ${eventType}`, traceTrigger(t, i, result), { variables: eventVariables(t, i, eventType, data) });
  }
  return result;
}

/**
 * Tanda 3: lanza un evento en el bus de HA (`event_type` y sus datos): dispara las
 * automatizaciones con `trigger: event` que coinciden y completa las esperas de ese evento.
 */
export function fireEvent(sim: SimulationState, project: Project, eventType: string, data: Record<string, EntityStateValue> = {}): SimulationState {
  return fireEventInternal(sim, project, eventType, data, ROOT);
}

/**
 * Tanda 3: arranque (start) o parada (shutdown) de Home Assistant: dispara las automatizaciones
 * con `trigger: homeassistant` de ese evento. Lo llaman el inicio de la simulación y el escenario
 * «Home Assistant se reinicia» (setFailures).
 */
export function fireHomeAssistantEvent(sim: SimulationState, project: Project, event: 'start' | 'shutdown'): SimulationState {
  let result = addLog(sim, 'info', event === 'start' ? 'Home Assistant arranca' : 'Home Assistant se detiene');
  for (const a of project.automations) {
    const i = a.triggers.findIndex((t) => t.enabled !== false && t.type === 'homeassistant' && t.event === event);
    const t = a.triggers[i];
    if (!t) continue;
    const variables: Variables = { 'trigger.platform': 'homeassistant', 'trigger.id': triggerIdOf(t, i), 'trigger.event': event };
    result = runAutomationInternal(result, project, a, ROOT, event === 'start' ? 'arranque de Home Assistant' : 'parada de Home Assistant', traceTrigger(t, i, result), { variables });
  }
  return result;
}

/**
 * Envía una notificación: vía única para el servicio notify.* (Fase 2) y la acción `notify`
 * (Fase 3). La deja en la bandeja (SimulationState.notifications) y en el registro
 * (LogEntry.notification). No necesita entidad ni Internet.
 */
function sendNotification(sim: SimulationState, content: NotificationContent, extra: LogExtra): Outcome {
  return outcome(addLog(deliverNotification(sim, content), 'info', formatNotification(content), { ...extra, notification: content }), true);
}

/** notify.* (p. ej. notify.persistent_notification): datos message/title → sendNotification. */
function notifyService(sim: SimulationState, project: Project, service: string, data: ServiceData | undefined, ctx: RunCtx): Outcome {
  const extra = ctx.automationId === undefined ? {} : { automationId: ctx.automationId };
  const content = notificationContent(data);
  if (!content) return outcome(addLog(sim, 'warning', `Servicio ${service}: falta el mensaje ("message")`, extra), false, 'falta el mensaje');
  return notifyOffline(sim, project, service, extra) ?? sendNotification(sim, content, extra);
}

/** Las notificaciones a la app (notify.* salvo la persistente) necesitan Internet. */
function notifyOffline(sim: SimulationState, project: Project, service: string, extra: LogExtra): Outcome | undefined {
  const f = sim.failures;
  if (!f || (!f.internet && !f.powerOutage) || !isCloudNotifyService(service) || internetAvailable(project, catalog, f)) return undefined;
  return fatalOutcome(addLog(sim, 'error', `Notificación ${service} no enviada: necesita Internet`, extra), 'notificación en la nube sin Internet');
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
  let result = addLog(sim, 'info', `Servicio ${group.domain}.${service} → grupo «${group.name}» (${countLabel(group.entityIds.length, 'miembro', 'miembros', { zero: 'sin miembros' })})`, extra);
  const inner: Exec = { ...exec, depth: exec.depth + 1 };
  if (inner.depth > MAX_DEPTH) return addLog(result, 'error', `Grupo «${group.name}»: posible bucle infinito`, extra);
  for (const member of group.entityIds) {
    result = callServiceCore(result, project, member, memberService(group, groupState, service, member), data, ctx, inner).sim;
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
): Outcome {
  const rel = project.reliability;
  let state = sim.rngState ?? rel?.seed ?? 1;
  const [r1, s1] = nextRandom(state);
  const [r2, s2] = nextRandom(s1);
  state = s2;
  const info = latencyFor(project, catalog, entityId, r1);
  const extra = { entityId, ...(ctx.automationId === undefined ? {} : { automationId: ctx.automationId }) };
  const next: SimulationState = { ...sim, rngState: state };
  if (info.cloud && (rel?.failureRate ?? 0) > 0 && r2 < (rel?.failureRate ?? 0)) {
    return fatalOutcome(addLog(next, 'error', `Servicio ${service} → ${friendly(sim, entityId)}: falló la llamada a la nube (fallo simulado)`, extra), 'fallo simulado de la nube');
  }
  const timer: SimTimer = { kind: 'service_call', entityId, service };
  if (data !== undefined) timer.data = data;
  if (ctx.automationId !== undefined) timer.automationId = ctx.automationId;
  const key = `latency:${entityId}:${sim.now}:${state}`;
  const logged = addLog(next, 'info', `Servicio ${service} → ${friendly(sim, entityId)}: en camino (${info.ms} ms${info.cloud ? ', nube' : ''})`, extra);
  return outcome(scheduleTimer(logged, key, sim.now + info.ms, timer), true, `en camino (${info.ms} ms${info.cloud ? ', nube' : ''})`);
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
  const result = callServiceCore(sim, project, entityId, service, data, {}, ROOT).sim;
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
  const trigger = traceTrigger(t, triggerIndex, sim);
  const variables: Variables = { 'trigger.platform': t.type === 'device_action' ? 'device' : t.type, 'trigger.id': triggerIdOf(t, triggerIndex) };
  return runAutomationInternal(sim, project, a, ROOT, `prueba del disparador: ${trigger.description}`, trigger, { manual: true, variables });
}

function schedule(sim: SimulationState, rest: Step[], seconds: number, ctx: RunCtx): SimulationState {
  const logged = addLog(sim, 'info', `Esperando ${seconds} s`, ctx.automationId === undefined ? {} : { automationId: ctx.automationId });
  const last = logged.log[logged.log.length - 1];
  const pending: PendingAction = { id: `pending-${last?.id ?? logged.pending.length}`, dueAt: sim.now + seconds * 1000, actions: rest.map((s) => s.action) };
  if (ctx.automationId !== undefined) pending.automationId = ctx.automationId;
  if (ctx.scriptId !== undefined) pending.scriptId = ctx.scriptId;
  if (ctx.join !== undefined) pending.join = ctx.join;
  setPendingSteps(pending, rest);
  setPendingTrace(pending, ctx);
  return { ...logged, pending: [...logged.pending, pending] };
}

/**
 * Próxima vez (ms, estrictamente después de `after`) en que se cumple alguno de los disparadores
 * de hora o de sol (con su desplazamiento). undefined si no hay ninguno.
 */
export function nextTimedOccurrence(triggers: Trigger[], after: number, sun: SunSource): number | undefined {
  let best: number | undefined;
  for (const t of triggers) {
    if (t.type !== 'time' && t.type !== 'sun') continue;
    for (let day = startOfDay(after) - DAY_MS; day <= startOfDay(after) + 2 * DAY_MS; day += DAY_MS) {
      const occ = triggerOffsetsMs(t, day, sun);
      if (occ && occ.at > after && (best === undefined || occ.at < best)) best = occ.at;
    }
  }
  return best;
}

/** Fase 3 (B11): wait_for_trigger deja el resto de acciones esperando al disparador. */
function scheduleWait(sim: SimulationState, project: Project, rest: Step[], a: WaitForTriggerAction, ctx: RunCtx): SimulationState {
  const extra = ctx.automationId === undefined ? {} : { automationId: ctx.automationId };
  const timeout = a.timeoutSeconds !== undefined ? Math.max(0, a.timeoutSeconds) : undefined;
  const timeoutAt = timeout === undefined ? undefined : sim.now + timeout * SECOND_MS;
  const timedAt = nextTimedOccurrence(a.triggers, sim.now, sunSourceOf(project));
  const until = timedAt === undefined ? '' : `; disparador de hora o sol a las ${formatSimTime(timedAt)}`;
  const logged = addLog(sim, 'info', `${timeout === undefined ? 'Esperando a un disparador' : `Esperando a un disparador (máximo ${formatDuration(timeout)})`}${until}`, extra);
  const last = logged.log[logged.log.length - 1];
  const wait: PendingAction['wait'] = { triggers: a.triggers, continueOnTimeout: a.continueOnTimeout ?? true };
  if (timeout === undefined) wait.forever = true;
  if (timeoutAt !== undefined) wait.timeoutAt = timeoutAt;
  if (timedAt !== undefined) wait.timedAt = timedAt;
  const pending: PendingAction = {
    id: `wait-${last?.id ?? logged.pending.length}`,
    dueAt: Math.min(timeoutAt ?? WAIT_FOREVER, timedAt ?? WAIT_FOREVER),
    actions: rest.map((s) => s.action),
    wait,
  };
  if (ctx.automationId !== undefined) pending.automationId = ctx.automationId;
  if (ctx.scriptId !== undefined) pending.scriptId = ctx.scriptId;
  if (ctx.join !== undefined) pending.join = ctx.join;
  setPendingSteps(pending, rest);
  setPendingTrace(pending, ctx);
  return { ...logged, pending: [...logged.pending, pending] };
}

/** Guarda el ámbito, el bloque y la vuelta de repeat de cada acción restante. */
function setPendingSteps(pending: PendingAction, rest: Step[]): void {
  const steps: PendingStep[] = rest.map((s) => {
    const ps: PendingStep = { block: s.block };
    if (Object.keys(s.scope).length > 0) ps.scope = s.scope;
    if (s.repeatIndex !== undefined) ps.repeatIndex = s.repeatIndex;
    return ps;
  });
  if (steps.some((s) => s.scope !== undefined || s.block !== 0 || s.repeatIndex !== undefined)) pending.steps = steps;
}

function allConditions(conds: Condition[], sim: SimulationState, project: Project, vars?: Variables): boolean {
  return conds.every((c) => evaluateCondition(c, sim, project, vars));
}

/** Paso de la ejecución: la acción y el paso de primer nivel de la traza al que pertenece. */
interface Step {
  action: Action;
  trace?: number;
  /** Es hija (rama de choose/if, cuerpo de repeat) del paso `trace`. */
  nested?: boolean;
  /** Variables visibles (ámbito). */
  scope: Variables;
  /** Bloque (secuencia) al que pertenece: 0 es el nivel superior. */
  block: number;
  /** Continuación de un repeat: número de la siguiente vuelta. */
  repeatIndex?: number;
}

/** Guarda en la espera la traza y el paso de cada acción restante. */
function setPendingTrace(pending: PendingAction, ctx: RunCtx): void {
  if (!ctx.trace) return;
  pending.traceId = ctx.trace.id;
  pending.traceOffset = ctx.trace.offset;
  const indexes = ctx.trace.indexes;
  if (indexes && indexes.some((x, i) => x !== ctx.trace!.offset + i)) pending.traceIndexes = indexes;
}

function runActionsInternal(sim: SimulationState, project: Project, actions: Action[], ctx: RunCtx, exec: Exec): SimulationState {
  if (exec.depth > MAX_DEPTH) {
    return addLog(sim, 'error', `Acciones no ejecutadas: posible bucle infinito (límite de ${MAX_DEPTH} niveles)`);
  }
  let result = sim;
  const baseScope: Variables = ctx.variables ?? {};
  let queue: Step[] = actions.map((action, i) => {
    const meta = ctx.steps?.[i];
    const step: Step = { action, scope: meta?.scope ?? baseScope, block: meta?.block ?? 0 };
    if (meta?.repeatIndex !== undefined) step.repeatIndex = meta.repeatIndex;
    if (!ctx.trace) return step;
    const trace = ctx.trace.indexes?.[i] ?? ctx.trace.offset + i;
    return { ...step, trace, nested: trace === ctx.trace.nestedIndex || meta?.repeatIndex !== undefined };
  });
  let nextBlock = Math.max(0, ...queue.map((q) => q.block)) + 1;
  const plainCtx: RunCtx = { ...ctx };
  delete plainCtx.trace;
  delete plainCtx.steps;
  delete plainCtx.variables;
  const extra = ctx.automationId === undefined ? {} : { automationId: ctx.automationId };
  const traceId = ctx.trace?.id;
  /** Marca el paso de la traza: los de primer nivel siempre; los anidados solo si fallan. */
  const traceStep = (r: Outcome, step: Step): SimulationState => {
    if (traceId === undefined || step.trace === undefined) return r.sim;
    if (step.nested && r.ok) return r.sim;
    const status = r.ok ? ('done' as const) : ('error' as const);
    const patch = r.detail === undefined ? { status, at: r.sim.now } : { status, at: r.sim.now, detail: r.detail };
    return setTraceAction(r.sim, traceId, step.trace, patch);
  };
  /**
   * Las acciones hijas (ramas de choose/if, cuerpo de repeat) forman un bloque nuevo: heredan el
   * paso de su padre y su ámbito, y sus variables no salen del bloque (como en HA).
   */
  const children = (xs: Action[], parent: Step, scope: Variables = parent.scope): Step[] => {
    const block = nextBlock++;
    return xs.map((action) => (parent.trace === undefined ? { action, scope, block } : { action, trace: parent.trace, nested: true, scope, block }));
  };
  /** Contexto de la espera: el resto de pasos y el paso que queda «esperando». */
  const waitCtx = (c: RunCtx, step: Step, rest: Step[]): RunCtx => {
    if (traceId === undefined || step.trace === undefined) return withoutTrace(c);
    const indexes = rest.map((s) => s.trace ?? step.trace ?? 0);
    return { ...c, trace: { id: traceId, offset: step.trace + 1, indexes } };
  };
  const markWaiting = (s: SimulationState, step: Step): SimulationState =>
    traceId === undefined || step.trace === undefined ? s : setTraceAction(s, traceId, step.trace, { status: 'waiting', at: s.now });
  /** Tanda 3: termina la ejecución con error (stop con error o fallo sin continue_on_error). */
  const abortRun = (r: Outcome, step: Step, message?: string): SimulationState => {
    let s = traceStep({ ...r, ok: false }, { ...step, nested: false });
    if (traceId !== undefined) s = updateTrace(s, traceId, (t) => ({ ...t, result: 'error' }));
    if (message !== undefined) s = addLog(s, 'error', message, extra);
    return abortJoin(s, ctx.join);
  };
  for (let steps = 0; queue.length > 0; steps++) {
    const [step, ...rest] = queue;
    queue = rest;
    if (!step) continue;
    if (steps >= MAX_ACTION_STEPS) {
      const detail = `más de ${MAX_ACTION_STEPS} pasos sin espera (¿repeat infinito?)`;
      return traceStep(outcome(addLog(result, 'error', `Acciones detenidas: ${detail}`, extra), false, detail), { ...step, nested: false });
    }
    const action = step.action;
    const vars = step.scope;
    const c: RunCtx = Object.keys(vars).length > 0 ? { ...plainCtx, variables: vars } : plainCtx;
    if (action.enabled === false) {
      // Tanda 3: acción desactivada (enabled: false): se salta.
      result = traceStep(outcome(addLog(result, 'info', 'Acción desactivada: se salta', extra), true, 'desactivada'), step);
      continue;
    }
    /** Tanda 3: un error detiene la secuencia salvo con continue_on_error. */
    const checked = (r: Outcome): Outcome | undefined => (r.fatal && !action.continueOnError ? r : undefined);
    switch (action.type) {
      case 'delay':
        return schedule(markWaiting(result, step), rest, Math.max(0, action.seconds), waitCtx(c, step, rest));
      case 'service': {
        const r = callServiceAction(result, project, action, renderData(action.data, vars, result), c, exec);
        if (checked(r)) return abortRun(r, step, `Acciones detenidas por un error: ${r.detail ?? 'error'} (continue_on_error permite seguir)`);
        result = traceStep(r, step);
        break;
      }
      case 'scene':
        result = traceStep(activateSceneInternal(result, project, action.sceneId, exec), step);
        break;
      case 'script':
        result = traceStep(runScriptInternal(result, project, action.scriptId, c, exec), step);
        break;
      case 'stop': {
        const detail = action.message.trim() === '' ? 'sin motivo' : action.message;
        const logged = addLog(result, action.error ? 'error' : 'info', `Secuencia detenida${action.error ? ' con error' : ''}: ${detail}`, extra);
        if (action.error) return abortRun(outcome(logged, false, detail), step);
        return abortJoin(traceStep(outcome(logged, true, `detenida: ${detail}`), { ...step, nested: false }), ctx.join);
      }
      case 'parallel': {
        const seq = nextSeq(result.log);
        const logged = addLog(result, 'info', `parallel: ${countLabel(action.branches.length, 'rama', 'ramas')} a la vez`, extra);
        const joinId = `join-${seq}`;
        const cont: PendingAction = { id: `${joinId}-cont`, dueAt: WAIT_FOREVER, actions: queue.map((q) => q.action) };
        if (ctx.automationId !== undefined) cont.automationId = ctx.automationId;
        if (ctx.scriptId !== undefined) cont.scriptId = ctx.scriptId;
        if (ctx.join !== undefined) cont.join = ctx.join;
        setPendingSteps(cont, queue);
        setPendingTrace(cont, waitCtx(c, step, queue));
        let joined: SimulationState = { ...logged, joins: { ...logged.joins, [joinId]: { remaining: action.branches.length + 1, cont } } };
        for (const branch of action.branches) {
          const bctx: RunCtx = { ...plainCtx, join: joinId };
          if (Object.keys(vars).length > 0) bctx.variables = vars;
          if (traceId !== undefined && step.trace !== undefined) bctx.trace = { id: traceId, offset: step.trace, indexes: branch.map(() => step.trace ?? 0), nestedIndex: step.trace };
          joined = runActionsInternal(joined, project, branch, bctx, exec);
          if (!joined.joins?.[joinId]) return joined; // una rama se detuvo (stop o error)
        }
        const j = joined.joins?.[joinId];
        if (!j) return joined;
        if (j.remaining <= 1) {
          result = traceStep(outcome(removeJoin(joined, joinId), true, `${countLabel(action.branches.length, 'rama terminada', 'ramas terminadas')}`), step);
          break;
        }
        return markWaiting({ ...joined, joins: { ...joined.joins, [joinId]: { ...j, remaining: j.remaining - 1 } } }, step);
      }
      case 'choose': {
        const index = action.choices.findIndex((o) => allConditions(o.conditions, result, project, vars));
        const chosen = index === -1 ? action.default ?? [] : (action.choices[index]?.sequence ?? []);
        const detail = index === -1 ? (action.default ? 'ninguna opción se cumple: opción por defecto' : 'ninguna opción se cumple') : `se cumple la opción ${index + 1}`;
        result = traceStep(outcome(addLog(result, 'info', `choose: ${detail}`, extra), true, detail), step);
        queue = [...children(chosen, step), ...rest];
        break;
      }
      case 'if': {
        const ok = allConditions(action.conditions, result, project, vars);
        const detail = ok ? 'condiciones cumplidas (then)' : 'condiciones no cumplidas (else)';
        result = traceStep(outcome(addLog(result, 'info', `if: ${detail}`, extra), true, detail), step);
        queue = [...children(ok ? action.then : action.else ?? [], step), ...rest];
        break;
      }
      case 'repeat': {
        const index = step.repeatIndex ?? 1;
        const count = action.count === undefined ? undefined : Math.floor(action.count);
        let run: boolean;
        if (count !== undefined) run = index <= count;
        else if (action.while !== undefined) run = allConditions(action.while, result, project, vars);
        else if (action.until !== undefined) run = index === 1 || !allConditions(action.until, result, project, vars);
        else run = false;
        if (index === 1 && !step.nested) result = traceStep(outcome(result, true, run ? undefined : 'ninguna vuelta'), step);
        if (!run) break;
        const repeatVars: Variables = { 'repeat.index': index, 'repeat.first': index === 1 };
        if (count !== undefined) repeatVars['repeat.last'] = index === count;
        const again: Step = step.trace === undefined ? { ...step, repeatIndex: index + 1 } : { ...step, nested: true, repeatIndex: index + 1 };
        queue = [...children(action.sequence, step, { ...step.scope, ...repeatVars }), again, ...rest];
        break;
      }
      case 'wait_for_trigger':
        return scheduleWait(markWaiting(result, step), project, rest, action, waitCtx(c, step, rest));
      case 'notify': {
        const content: NotificationContent = {
          title: renderTemplate(action.title ?? DEFAULT_NOTIFICATION_TITLE, vars, result),
          message: renderTemplate(action.message, vars, result),
        };
        const r = notifyOffline(result, project, action.service ?? 'notify.notify', extra) ?? sendNotification(result, content, extra);
        if (checked(r)) return abortRun(r, step, `Acciones detenidas por un error: ${r.detail ?? 'error'}`);
        result = traceStep(r, step);
        break;
      }
      case 'variables': {
        const rendered: Variables = {};
        for (const [k, v] of Object.entries(action.variables)) rendered[k] = typeof v === 'string' ? renderTemplate(v, vars, result) : v;
        // Visibles para el resto del mismo bloque (y lo que cuelga de él), no fuera.
        queue = queue.map((q) => (q.block === step.block ? { ...q, scope: { ...q.scope, ...rendered } } : q));
        result = traceStep(outcome(result, true), step);
        break;
      }
    }
  }
  return finishBranch(result, project, ctx.join);
}

/** Tanda 3: quita una unión de ramas `parallel`. */
function removeJoin(sim: SimulationState, joinId: Id): SimulationState {
  if (!sim.joins?.[joinId]) return sim;
  const joins = { ...sim.joins };
  delete joins[joinId];
  return { ...sim, joins };
}

/** Tanda 3: una rama de `parallel` termina; con la última, sigue la secuencia que esperaba. */
function finishBranch(sim: SimulationState, project: Project, joinId: Id | undefined): SimulationState {
  const j = joinId === undefined ? undefined : sim.joins?.[joinId];
  if (!j || joinId === undefined) return sim;
  if (j.remaining > 1) return { ...sim, joins: { ...sim.joins, [joinId]: { ...j, remaining: j.remaining - 1 } } };
  return continuePending(removeJoin(sim, joinId), project, j.cont, ROOT);
}

/** Tanda 3: `stop` o un error dentro de un `parallel`: se cancelan las demás ramas y lo que seguía. */
function abortJoin(sim: SimulationState, joinId: Id | undefined): SimulationState {
  let result = sim;
  for (let id = joinId; id !== undefined; ) {
    const j: ParallelJoin | undefined = result.joins?.[id];
    const current: Id = id;
    result = removeJoin({ ...result, pending: result.pending.filter((p) => p.join !== current) }, current);
    id = j?.cont.join;
  }
  return result;
}

function withoutTrace(ctx: RunCtx): RunCtx {
  if (!ctx.trace) return ctx;
  const rest: RunCtx = { ...ctx };
  delete rest.trace;
  return rest;
}

/**
 * Acción de servicio con uno o varios destinos (Tanda 1): el entity_id principal, los de
 * targets.entityIds y las entidades del dominio del servicio en cada sala de targets.areaIds.
 * Se aplica a cada entidad; el paso va bien si va bien en todas.
 */
function callServiceAction(sim: SimulationState, project: Project, action: ServiceAction, data: ServiceData | undefined, ctx: RunCtx, exec: Exec): Outcome {
  const hasTargets = (action.targets?.entityIds?.length ?? 0) > 0 || (action.targets?.areaIds?.length ?? 0) > 0;
  if (!hasTargets) return callServiceCore(sim, project, action.entityId, action.service, data, ctx, exec);
  const ids = resolveServiceTargets(project, catalog, action);
  if (ids.length === 0) {
    const extra = ctx.automationId === undefined ? {} : { automationId: ctx.automationId };
    return outcome(addLog(sim, 'warning', `Servicio ${action.service}: ninguna entidad en los destinos`, extra), false, 'ninguna entidad en los destinos');
  }
  let result = sim;
  const failed: string[] = [];
  const notes: string[] = [];
  for (const id of ids) {
    const r = callServiceCore(result, project, id, action.service, data, ctx, exec);
    result = r.sim;
    if (!r.ok) failed.push(r.detail ?? id);
    else if (r.detail !== undefined) notes.push(r.detail);
  }
  if (failed.length > 0) return outcome(result, false, `${failed.length} de ${countLabel(ids.length, 'destino', 'destinos')} ${plural(failed.length, 'falló', 'fallaron')}: ${failed.join('; ')}`);
  return outcome(result, true, notes.length > 0 ? notes.join('; ') : countLabel(ids.length, 'destino', 'destinos', { zero: 'sin destinos' }));
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
      const variables = triggerVariables(t, timer.entityId, undefined, current.state, timer.triggerIndex);
      return runAutomationInternal(sim, project, a, ROOT, reason, traceTrigger(t, timer.triggerIndex, sim), { variables });
    }
    case 'service_call': {
      const ctx: RunCtx = timer.automationId === undefined ? {} : { automationId: timer.automationId };
      return callServiceCore(sim, project, timer.entityId, timer.service, timer.data, ctx, { ...ROOT, immediate: true }).sim;
    }
    case 'wait_for': {
      const p = sim.pending.find((x) => x.id === timer.waitId);
      const t = p?.wait?.triggers[timer.triggerIndex];
      const current = sim.entities[timer.entityId];
      if (!p || !current || t?.type !== 'state' || t.entityId !== timer.entityId || !t.for) return sim;
      if (t.to !== undefined && !sameState(current.state, t.to)) return sim;
      if (current.lastChanged !== undefined && sim.now - current.lastChanged < t.for * SECOND_MS) return sim;
      const vars = triggerVariables(t, timer.entityId, undefined, current.state, timer.triggerIndex);
      return completeWait(sim, project, p, `${friendly(sim, timer.entityId)} lleva ${formatDuration(t.for)} en ${normalize(current.state)}`, ROOT, vars);
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
  if (p.wait) {
    const extra = p.automationId === undefined ? {} : { automationId: p.automationId };
    const timedAt = p.wait.timedAt;
    if (timedAt !== undefined && p.dueAt === timedAt && (p.wait.timeoutAt === undefined || timedAt <= p.wait.timeoutAt)) {
      // Se cumple un disparador de hora o de sol de la espera, en su momento exacto.
      const t = p.wait.triggers.find((x) => nextTimedOccurrence([x], timedAt - 1, sunSourceOf(project)) === timedAt);
      const what = t ? describeTrigger(t, rest) : formatSimTime(timedAt);
      return completeWait({ ...rest, pending: [...rest.pending, p] }, project, p, what, ROOT, { 'trigger.platform': t?.type ?? 'time' });
    }
    if (!p.wait.continueOnTimeout) {
      let stopped = addLog(rest, 'warning', 'Tiempo de espera agotado: se detienen las acciones (continue_on_timeout: false)', extra);
      if (p.traceId !== undefined) stopped = setTraceAction(stopped, p.traceId, (p.traceOffset ?? 1) - 1, { status: 'error', detail: 'tiempo de espera agotado' });
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
  if (p.steps !== undefined) ctx.steps = p.steps;
  if (p.join !== undefined) ctx.join = p.join;
  let ready: SimulationState = sim;
  if (p.traceId !== undefined && p.traceOffset !== undefined) {
    // El paso que esperaba (traceOffset - 1) queda hecho; `at` sigue siendo el inicio de la espera.
    ready = setTraceAction(ready, p.traceId, p.traceOffset - 1, { status: 'done', detail: undefined });
    ctx.trace = { id: p.traceId, offset: p.traceOffset, nestedIndex: p.traceOffset - 1 };
    if (p.traceIndexes !== undefined) ctx.trace.indexes = p.traceIndexes;
  }
  const chain = [...exec.chain, ...[p.automationId, p.scriptId].filter((x): x is Id => x !== undefined)];
  const ran = runActionsInternal(ready, project, p.actions, ctx, { depth: exec.depth, chain });
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
  /** Catálogo con el que calcular energía, baterías y el modelo de entorno (por defecto, el incluido). */
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
  const sun: SunSource = opts.sun ?? sunSourceOf(project);
  const timed = collectTimedEvents(project, sim.now, to, sun);
  let result = sim;
  let idx = 0;
  for (let guard = 0; guard < MAX_TICK_EVENTS; guard++) {
    const pending = earliestPending(result, to);
    const event = timed[idx];
    if (!pending && !event) {
      // Fase 3 (B13): único punto de llamada del modelo de entorno, con el sol real del proyecto.
      const ready = advanceEnergy(result, project, defs, to);
      return applyEnvironment(ready, project, defs, advance, (day) => sunTimesAt(day, sun));
    }
    if (pending && (!event || pending.dueAt <= event.at)) {
      result = runPending(advanceEnergy(result, project, defs, pending.dueAt), project, pending);
    } else if (event) {
      idx++;
      const t = event.automation.triggers[event.triggerIndex];
      const ready = advanceEnergy(result, project, defs, event.at);
      const trigger: TraceTrigger = t ? traceTrigger(t, event.triggerIndex, ready) : { index: event.triggerIndex, description: event.reason };
      const variables: Variables = { 'trigger.platform': t?.type ?? 'time', 'trigger.id': t ? triggerIdOf(t, event.triggerIndex) : String(event.triggerIndex) };
      result = runAutomationInternal({ ...ready, now: event.at }, project, event.automation, ROOT, event.reason, trigger, { variables });
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
