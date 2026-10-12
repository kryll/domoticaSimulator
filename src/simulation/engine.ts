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
  SimulationState,
  Trigger,
} from '../types';
import { entityDomain, initialEntityStates, slugify } from '../devices/entities';
import { DAY_MS, DEFAULT_SUN, isTimeBetween, MINUTE_MS, parseHHMM, startOfDay, sunTimes, type SunConfig } from './clock';
import { applyService } from './services';

/** Profundidad máxima de llamadas anidadas (automatización → acción → automatización...). */
export const MAX_DEPTH = 10;
/** Entradas máximas del registro (se conservan las más recientes, al final). */
export const MAX_LOG_ENTRIES = 500;
const MAX_TICK_EVENTS = 10_000;
const MAX_TICK_DAYS = 400;

interface RunCtx {
  automationId?: Id;
  scriptId?: Id;
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

function addLog(
  sim: SimulationState,
  level: LogLevel,
  message: string,
  extra: { entityId?: string; automationId?: Id } = {},
): SimulationState {
  const entry: LogEntry = { id: `log-${nextSeq(sim.log)}`, timestamp: sim.now, level, message };
  if (extra.entityId !== undefined) entry.entityId = extra.entityId;
  if (extra.automationId !== undefined) entry.automationId = extra.automationId;
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

function merge(prev: EntityState, next: EntityState | EntityStateValue): EntityState {
  if (!isEntityState(next)) return { ...prev, state: next };
  return { state: next.state, attributes: { ...prev.attributes, ...next.attributes } };
}

function friendly(sim: SimulationState, entityId: string): string {
  const name = sim.entities[entityId]?.attributes?.friendly_name;
  return name === undefined ? entityId : String(name);
}

// ---------- Creación ----------

export function createSimulationState(project: Project, defs: DeviceDefinition[], now: number): SimulationState {
  const sim: SimulationState = {
    running: false,
    now,
    speed: 1,
    entities: initialEntityStates(project, defs),
    pending: [],
    log: [],
  };
  return addLog(sim, 'info', `Simulación preparada con ${Object.keys(sim.entities).length} entidades`);
}

// ---------- Condiciones ----------

export function evaluateCondition(c: Condition, sim: SimulationState): boolean {
  switch (c.type) {
    case 'state': {
      const current = sim.entities[c.entityId];
      return current !== undefined && sameState(current.state, c.state);
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
  }
}

// ---------- Automatizaciones ----------

function isRunning(sim: SimulationState, automationId: Id): boolean {
  return sim.pending.some((p) => p.automationId === automationId);
}

function runAutomation(sim: SimulationState, project: Project, a: Automation, exec: Exec, reason: string): SimulationState {
  if (!a.enabled) return sim;
  const extra = { automationId: a.id };
  if (exec.depth > MAX_DEPTH) {
    return addLog(sim, 'error', `Automatización «${a.name}» no ejecutada: posible bucle infinito (límite de ${MAX_DEPTH} niveles)`, extra);
  }
  const busy = exec.chain.includes(a.id) || isRunning(sim, a.id);
  if (busy && a.mode === 'single') {
    return addLog(sim, 'warning', `Automatización «${a.name}» ya está en ejecución (modo single): se ignora el disparo`, extra);
  }
  if (!a.conditions.every((c) => evaluateCondition(c, sim))) {
    return addLog(sim, 'info', `Automatización «${a.name}»: condiciones no cumplidas`, extra);
  }
  let next = sim;
  if (a.mode === 'restart') next = { ...next, pending: next.pending.filter((p) => p.automationId !== a.id) };
  next = addLog(next, 'info', `Automatización «${a.name}» disparada (${reason})`, extra);
  return runActionsInternal(next, project, a.actions, { automationId: a.id }, { depth: exec.depth + 1, chain: [...exec.chain, a.id] });
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
    if (a.triggers.some((t) => stateTriggerMatches(t, entityId, prev, next))) {
      result = runAutomation(result, project, a, exec, `cambio de ${entityId}`);
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
): SimulationState {
  const prev = sim.entities[entityId];
  if (!prev) return addLog(sim, 'warning', `Entidad desconocida: ${entityId}`, { entityId });
  const merged = merge(prev, next);
  let result: SimulationState = { ...sim, entities: { ...sim.entities, [entityId]: merged } };
  if (sameState(prev.state, merged.state)) return result;
  result = addLog(result, 'info', `${friendly(result, entityId)}: ${normalize(prev.state)} → ${normalize(merged.state)}`, { entityId });
  return fireStateTriggers(result, project, entityId, prev.state, merged.state, exec);
}

/** Cambia el estado de una entidad, lo registra y dispara las automatizaciones afectadas. */
export function setEntityState(
  sim: SimulationState,
  project: Project,
  entityId: string,
  next: EntityState | EntityStateValue,
): SimulationState {
  return applyChange(sim, project, entityId, next, ROOT);
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
    result = applyChange(result, project, entityId, state, inner);
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

function callService(
  sim: SimulationState,
  project: Project,
  action: Extract<Action, { type: 'service' }>,
  ctx: RunCtx,
  exec: Exec,
): SimulationState {
  const [domain = '', service = ''] = action.service.split('.');
  if (domain === 'scene' && service === 'turn_on') return activateSceneInternal(sim, project, action.entityId, exec);
  if (domain === 'script') {
    const ref = service === 'turn_on' ? action.entityId : action.service;
    return runScriptInternal(sim, project, ref, ctx, exec);
  }
  const current = sim.entities[action.entityId];
  if (!current) return addLog(sim, 'warning', `Servicio ${action.service}: entidad desconocida ${action.entityId}`, { entityId: action.entityId });
  const target = entityDomain(action.entityId);
  if (domain !== target && domain !== 'homeassistant') {
    return addLog(sim, 'warning', `El servicio ${action.service} no aplica a ${action.entityId}`, { entityId: action.entityId });
  }
  const next = applyService(target, service, current, action.data, sim.now);
  if (!next) return addLog(sim, 'warning', `Servicio no soportado en la simulación: ${action.service}`, { entityId: action.entityId });
  const logged = addLog(sim, 'info', `Servicio ${action.service} → ${action.entityId}`, { entityId: action.entityId, ...ctx });
  return applyChange(logged, project, action.entityId, next, exec);
}

function schedule(sim: SimulationState, rest: Action[], seconds: number, ctx: RunCtx): SimulationState {
  const logged = addLog(sim, 'info', `Esperando ${seconds} s`, ctx.automationId === undefined ? {} : { automationId: ctx.automationId });
  const last = logged.log[logged.log.length - 1];
  const pending: PendingAction = { id: `pending-${last?.id ?? logged.pending.length}`, dueAt: sim.now + seconds * 1000, actions: rest };
  if (ctx.automationId !== undefined) pending.automationId = ctx.automationId;
  if (ctx.scriptId !== undefined) pending.scriptId = ctx.scriptId;
  return { ...logged, pending: [...logged.pending, pending] };
}

function runActionsInternal(sim: SimulationState, project: Project, actions: Action[], ctx: RunCtx, exec: Exec): SimulationState {
  if (exec.depth > MAX_DEPTH) {
    return addLog(sim, 'error', `Acciones no ejecutadas: posible bucle infinito (límite de ${MAX_DEPTH} niveles)`);
  }
  let result = sim;
  for (const [i, action] of actions.entries()) {
    switch (action.type) {
      case 'delay':
        return schedule(result, actions.slice(i + 1), Math.max(0, action.seconds), ctx);
      case 'service':
        result = callService(result, project, action, ctx, exec);
        break;
      case 'scene':
        result = activateSceneInternal(result, project, action.sceneId, exec);
        break;
      case 'script':
        result = runScriptInternal(result, project, action.scriptId, ctx, exec);
        break;
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

function runPending(sim: SimulationState, project: Project, p: PendingAction): SimulationState {
  const rest = { ...sim, now: Math.max(sim.now, p.dueAt), pending: sim.pending.filter((x) => x.id !== p.id) };
  const ctx: RunCtx = {};
  if (p.automationId !== undefined) ctx.automationId = p.automationId;
  if (p.scriptId !== undefined) ctx.scriptId = p.scriptId;
  return runActions(rest, project, p.actions, ctx);
}

export interface TickOptions {
  sun?: SunConfig;
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
    if (!pending && !event) return { ...result, now: to };
    if (pending && (!event || pending.dueAt <= event.at)) {
      result = runPending(result, project, pending);
    } else if (event) {
      idx++;
      result = runAutomation({ ...result, now: event.at }, project, event.automation, ROOT, event.reason);
    }
  }
  return addLog({ ...result, now: to }, 'error', 'Demasiados eventos en un solo avance del reloj; se han descartado los restantes');
}
