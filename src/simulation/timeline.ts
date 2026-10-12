// Línea de tiempo con aserciones (B14): reproduce eventos a horas fijas y comprueba estados.
// Determinista: misma entrada, mismo resultado.
import type {
  AssertOp,
  DeviceDefinition,
  EntityStateValue,
  LogEntry,
  Project,
  SimulationState,
  Timeline,
  TimelineAssertStep,
  TimelineEventStep,
  TimelineStep,
} from '../types';
import { DAY_MS, formatSimTime, MINUTE_MS, parseHHMM, startOfDay } from './clock';
import { activateScene, callService, createSimulationState, runScript, sameState, setEntityState, tick } from './engine';
import { openDoor, pressButton, triggerMotion } from './events';
import { findZone, movePerson } from './people';

export interface TimelineStepResult {
  /** Índice del paso en timeline.steps. */
  index: number;
  step: TimelineStep;
  /** Hora simulada (ms) a la que se ejecutó. */
  at: number;
  ok: boolean;
  /** Valor observado (solo aserciones; null si la entidad o el atributo no existen). */
  actual: EntityStateValue | null;
  expected: EntityStateValue | null;
  message: string;
}

export interface TimelineRun {
  results: TimelineStepResult[];
  /** true si todas las aserciones (y eventos) han ido bien. */
  passed: boolean;
  /** Estado final de la simulación (para inspeccionar el registro). */
  sim: SimulationState;
}

const OP_LABELS: Record<AssertOp, string> = { eq: '=', ne: '≠', gt: '>', lt: '<', gte: '≥', lte: '≤' };

function toNum(v: EntityStateValue | null): number | undefined {
  if (v === null || typeof v === 'boolean' || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Compara un valor observado con el esperado según el operador. */
export function compareValues(actual: EntityStateValue | null, expected: EntityStateValue, op: AssertOp = 'eq'): boolean {
  if (op === 'eq') return actual !== null && sameState(actual, expected);
  if (op === 'ne') return actual === null || !sameState(actual, expected);
  const a = toNum(actual);
  const e = toNum(expected);
  if (a === undefined || e === undefined) return false;
  switch (op) {
    case 'gt':
      return a > e;
    case 'lt':
      return a < e;
    case 'gte':
      return a >= e;
    case 'lte':
      return a <= e;
  }
}

/** Horas absolutas de los pasos: relativas al día de inicio; si una va antes que la anterior, pasa al día siguiente. */
export function stepTimes(steps: TimelineStep[], startMs: number): number[] {
  const day = startOfDay(startMs);
  let prev = startMs;
  return steps.map((s) => {
    let t = day + parseHHMM(s.at) * MINUTE_MS;
    while (t < prev) t += DAY_MS;
    prev = t;
    return t;
  });
}

function truthy(v: EntityStateValue | undefined): boolean {
  return !(v === false || v === 'off' || v === 'closed' || v === 0);
}

function applyEvent(sim: SimulationState, project: Project, step: TimelineEventStep): SimulationState | string {
  const entity = step.entityId ?? '';
  switch (step.event) {
    case 'state':
      if (step.value === undefined) return 'falta el valor del estado';
      return setEntityState(sim, project, entity, step.value);
    case 'service':
      if (!step.service) return 'falta el servicio';
      return callService(sim, project, entity, step.service, step.data);
    case 'motion':
      return triggerMotion(sim, project, entity, truthy(step.value));
    case 'button':
      return pressButton(sim, project, entity, step.value === undefined ? 'single' : String(step.value));
    case 'door':
      return openDoor(sim, project, entity, truthy(step.value));
    case 'person':
      if (!step.personId) return 'falta la persona';
      return movePerson(sim, project, step.personId, step.zoneId ?? null);
    case 'scene':
      return step.sceneId ? activateScene(sim, project, step.sceneId) : 'falta la escena';
    case 'script':
      return step.scriptId ? runScript(sim, project, step.scriptId) : 'falta el script';
  }
}

function describeEvent(step: TimelineEventStep, project: Project): string {
  switch (step.event) {
    case 'state':
      return `${step.entityId ?? '?'} → ${String(step.value)}`;
    case 'service':
      return `${step.service ?? '?'} en ${step.entityId ?? '?'}`;
    case 'motion':
      return `movimiento en ${step.entityId ?? '?'}`;
    case 'button':
      return `pulsación ${String(step.value ?? 'single')} en ${step.entityId ?? '?'}`;
    case 'door':
      return `${truthy(step.value) ? 'abrir' : 'cerrar'} ${step.entityId ?? '?'}`;
    case 'person': {
      // Nombres, no ids: «Ana → Trabajo».
      const person = project.people?.find((p) => p.id === step.personId)?.name ?? step.personId ?? '?';
      const zone = step.zoneId ? (findZone(project, step.zoneId)?.name ?? step.zoneId) : 'fuera';
      return `${person} → ${zone}`;
    }
    case 'scene':
      return `escena ${project.scenes.find((x) => x.id === step.sceneId)?.name ?? step.sceneId ?? '?'}`;
    case 'script':
      return `script ${project.scripts.find((x) => x.id === step.scriptId)?.name ?? step.scriptId ?? '?'}`;
  }
}

function observe(sim: SimulationState, step: TimelineAssertStep): EntityStateValue | null {
  const st = sim.entities[step.entityId];
  if (!st) return null;
  if (step.attribute === undefined) return st.state;
  return st.attributes?.[step.attribute] ?? null;
}

/** Inicio por defecto si la prueba no tiene startAt ni se indica otro: 1/1/2026 00:00. */
export const DEFAULT_TIMELINE_START = Date.UTC(2026, 0, 1);

/** Hora de inicio de la prueba: su startAt guardado o, si no tiene, fallbackNow. */
export function timelineStart(timeline: Pick<Timeline, 'startAt'>, fallbackNow: number): number {
  return timeline.startAt ?? fallbackNow;
}

/** Prueba nueva a partir de un registro (recordTimeline) con su hora de inicio guardada. */
export function recordedTimeline(log: LogEntry[], opts: { id: string; name: string; startAt: number }): Timeline {
  return { id: opts.id, name: opts.name, startAt: opts.startAt, steps: recordTimeline(log) };
}

/**
 * Ejecuta la línea de tiempo sobre una simulación nueva que empieza en timeline.startAt (o, si no
 * lo tiene, en fallbackStartMs). Avanza el reloj
 * hasta cada paso (ejecutando automatizaciones y temporizadores), aplica los eventos y evalúa las
 * aserciones. Una hora mal formada o un evento incompleto cuentan como fallo del paso.
 */
export function runTimeline(project: Project, defs: DeviceDefinition[], timeline: Timeline, fallbackStartMs?: number): TimelineRun {
  const startMs = timelineStart(timeline, fallbackStartMs ?? DEFAULT_TIMELINE_START);
  let sim: SimulationState = { ...createSimulationState(project, defs, startMs), speed: 1 };
  const results: TimelineStepResult[] = [];
  let times: number[];
  try {
    times = stepTimes(timeline.steps, startMs);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { results: timeline.steps.map((step, index) => ({ index, step, at: startMs, ok: false, actual: null, expected: null, message })), passed: false, sim };
  }
  timeline.steps.forEach((step, index) => {
    const at = times[index] ?? sim.now;
    if (at > sim.now) sim = tick(sim, project, at - sim.now, { defs });
    if (step.kind === 'event') {
      const next = applyEvent(sim, project, step);
      if (typeof next === 'string') {
        results.push({ index, step, at, ok: false, actual: null, expected: null, message: `Evento no válido: ${next}` });
        return;
      }
      sim = next;
      results.push({ index, step, at, ok: true, actual: null, expected: null, message: `Evento: ${describeEvent(step, project)}` });
      return;
    }
    const actual = observe(sim, step);
    const op = step.op ?? 'eq';
    const ok = compareValues(actual, step.expect, op);
    const what = step.attribute === undefined ? step.entityId : `${step.entityId}.${step.attribute}`;
    const shown = actual === null ? 'no existe' : String(actual);
    const message = ok
      ? `${what} ${OP_LABELS[op]} ${String(step.expect)} ✓`
      : `${what}: se esperaba ${OP_LABELS[op]} ${String(step.expect)} y es ${shown}`;
    results.push({ index, step, at, ok, actual, expected: step.expect, message });
  });
  return { results, passed: results.every((r) => r.ok), sim };
}

function timeText(ms: number): string {
  const withSeconds = Math.floor(ms / 1000) % 60 !== 0;
  return formatSimTime(ms, { seconds: withSeconds });
}

/**
 * Convierte un registro de la simulación en pasos: los eventos de usuario (anotados con `event`)
 * pasan a pasos de evento y los demás cambios de estado a aserciones con el valor final de cada
 * entidad en ese instante. Así, al grabar una sesión se obtiene una prueba de regresión.
 */
export function recordTimeline(log: LogEntry[]): TimelineStep[] {
  const steps: TimelineStep[] = [];
  for (const entry of log) {
    const at = timeText(entry.timestamp);
    if (entry.event) {
      const ev = entry.event;
      if (ev.kind === 'state') steps.push({ at, kind: 'event', event: 'state', entityId: ev.entityId, value: ev.value });
      else if (ev.kind === 'person') {
        const step: TimelineEventStep = { at, kind: 'event', event: 'person', personId: ev.personId };
        if (ev.zoneId !== null) step.zoneId = ev.zoneId;
        steps.push(step);
      } else if (ev.kind === 'physical') {
        const step: TimelineEventStep = { at, kind: 'event', event: ev.event, entityId: ev.entityId };
        if (ev.value !== undefined) step.value = ev.value;
        steps.push(step);
      } else {
        const step: TimelineEventStep = { at, kind: 'event', event: 'service', entityId: ev.entityId, service: ev.service };
        if (ev.data) step.data = { ...ev.data };
        steps.push(step);
      }
      continue;
    }
    if (!entry.change || entry.entityId === undefined) continue;
    const entityId = entry.entityId;
    // Una sola aserción por entidad e instante: la del último valor.
    const previous = steps.findIndex((s) => s.kind === 'assert' && s.entityId === entityId && s.at === at);
    if (previous !== -1) steps.splice(previous, 1);
    steps.push({ at, kind: 'assert', entityId, expect: entry.change.to });
  }
  return steps;
}
