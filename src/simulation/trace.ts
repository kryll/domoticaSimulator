// Trazas de ejecución de automatizaciones: descripciones legibles en español de disparadores,
// condiciones y acciones, evaluación explicada de condiciones y gestión inmutable de las trazas.
import type {
  Action,
  Automation,
  AutomationTrace,
  Condition,
  EntityStateValue,
  Id,
  Project,
  ServiceAction,
  SimulationState,
  SunEvent,
  TraceAction,
  TraceCondition,
  TraceTrigger,
  Trigger,
  Weekday,
} from '../types';
import { stateLabel } from '../devices/stateLabels';
import { formatSimTime, isTimeBetween, MINUTE_MS, SECOND_MS, sunTimesAt, type SunConfig, type SunLocation } from './clock';
import { friendlyName, inNumericRange, sameState, toNumber } from './stateUtils';
import { describeServiceData } from './services';
import { serviceName } from './serviceCatalog';
import { isNotifyService, notificationContent } from './notify';
import { serviceAreaIds, serviceEntityIds } from '../automations/walk';
import { plural } from '../ui/plural';

/** Trazas que se conservan por automatización (las más recientes). */
export const MAX_TRACES_PER_AUTOMATION = 50;

// ---------- Etiquetas de estado ----------

// Tanda 2: la tabla de estados es única (devices/stateLabels.ts); se reexporta por compatibilidad.
export { stateLabel };

function deviceClassOf(sim: SimulationState, entityId: string): string | undefined {
  const dc = sim.entities[entityId]?.attributes?.device_class;
  return dc === undefined ? undefined : String(dc);
}

function label(sim: SimulationState, entityId: string, value: EntityStateValue): string {
  return stateLabel(entityId, value, deviceClassOf(sim, entityId));
}

const fmtNumber = (n: number): string => String(Math.round(n * 100) / 100).replace('.', ',');

function unitOf(sim: SimulationState, entityId: string): string {
  const u = sim.entities[entityId]?.attributes?.unit_of_measurement;
  return u === undefined ? '' : ` ${String(u)}`;
}

/** "2 min", "1 h 5 min", "30 s"... */
export function formatSeconds(seconds: number): string {
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

function rangeText(above: number | undefined, below: number | undefined, unit: string): string {
  if (above !== undefined && below !== undefined) return `entre ${fmtNumber(above)} y ${fmtNumber(below)}${unit}`;
  if (above !== undefined) return `por encima de ${fmtNumber(above)}${unit}`;
  if (below !== undefined) return `por debajo de ${fmtNumber(below)}${unit}`;
  return 'con cualquier valor';
}

function sunEventText(event: SunEvent, offsetMinutes = 0): string {
  const name = event === 'sunrise' ? 'amanecer' : 'atardecer';
  if (!offsetMinutes) return name;
  const abs = formatSeconds(Math.abs(offsetMinutes) * 60);
  return `${name} ${offsetMinutes < 0 ? `(${abs} antes)` : `(${abs} después)`}`;
}

const capitalize = (s: string): string => (s === '' ? s : s[0]?.toUpperCase() + s.slice(1));

// ---------- Personas y zonas (Fase 3) ----------

/** Nombre de una persona (atributo friendly_name de su entidad person.*); si no, su id. */
export function personName(sim: SimulationState, personId: Id): string {
  const e = Object.entries(sim.entities).find(([id, st]) => id.startsWith('person.') && st.attributes?.person_id === personId)?.[1];
  const name = e?.attributes?.friendly_name;
  return name === undefined ? personId : String(name);
}

/** Nombre de una zona (atributo friendly_name de su entidad zone.*); «Casa» para home. */
export function zoneName(sim: SimulationState, zoneId: Id): string {
  const e = Object.entries(sim.entities).find(([id, st]) => id.startsWith('zone.') && String(st.attributes?.zone_id ?? '') === zoneId)?.[1];
  const name = e?.attributes?.friendly_name;
  if (name !== undefined) return String(name);
  return zoneId === 'home' ? 'Casa' : zoneId;
}

/** ¿Está la persona en la zona? (mismo criterio que el motor: atributo zone_id de su entidad). */
function personInZone(sim: SimulationState, personId: Id, zoneId: Id): boolean {
  return Object.entries(sim.entities).some(
    ([id, e]) => id.startsWith('person.') && e.attributes?.person_id === personId && String(e.attributes.zone_id ?? '') === zoneId,
  );
}

// ---------- Disparadores ----------

/** «Luz salón cambió a Encendida», «Son las 07:30», «Atardecer (15 min antes)»... */
export function describeTrigger(t: Trigger, sim: SimulationState): string {
  if (t.enabled === false) return `(desactivado) ${describeTrigger({ ...t, enabled: true }, sim)}`;
  switch (t.type) {
    case 'state': {
      const name = friendlyName(sim, t.entityId);
      let text = `${name} cambió`;
      if (t.from !== undefined) text += ` de ${label(sim, t.entityId, t.from)}`;
      if (t.to !== undefined) text += ` a ${label(sim, t.entityId, t.to)}`;
      if (t.from === undefined && t.to === undefined) text += ' de estado';
      if (t.for) text += ` durante ${formatSeconds(t.for)}`;
      return text;
    }
    case 'numeric_state':
      return `${friendlyName(sim, t.entityId)} pasa a estar ${rangeText(t.above, t.below, unitOf(sim, t.entityId))}`;
    case 'time':
      return `Son las ${t.at}`;
    case 'sun':
      return capitalize(sunEventText(t.event, t.offsetMinutes));
    case 'zone':
      return `${personName(sim, t.personId)} ${t.event === 'enter' ? 'llega a' : 'sale de'} ${zoneName(sim, t.zoneId)}`;
    case 'device_action':
      return `${friendlyName(sim, t.entityId)}: acción «${t.action}»`;
    case 'time_pattern':
      return describeTimePattern(t);
    case 'homeassistant':
      return t.event === 'start' ? 'Home Assistant arranca' : 'Home Assistant se detiene';
    case 'event': {
      const id = t.eventData?.entity_id;
      const who = typeof id === 'string' ? ` de ${friendlyName(sim, id)}` : '';
      const rest = Object.entries(t.eventData ?? {}).filter(([k]) => k !== 'entity_id');
      const data = rest.length > 0 ? ` (${rest.map(([k, v]) => `${k}: ${String(v)}`).join(', ')})` : '';
      return `Evento ${t.eventType}${who}${data}`;
    }
  }
}

/** Tanda 3: «Cada 5 min», «A los 30 min de cada hora», «Cada 2 h»... */
export function describeTimePattern(t: { hours?: string; minutes?: string; seconds?: string }): string {
  const part = (v: string | undefined, unit: string, every: (n: string) => string): string | undefined => {
    if (v === undefined || v === '*') return undefined;
    return v.startsWith('/') ? every(v.slice(1)) : `${unit} ${v}`;
  };
  const items = [
    part(t.hours, 'hora', (n) => `cada ${n} h`),
    part(t.minutes, 'minuto', (n) => `cada ${n} min`),
    part(t.seconds, 'segundo', (n) => `cada ${n} s`),
  ].filter((x): x is string => x !== undefined);
  return items.length === 0 ? 'Patrón de hora: cada segundo' : `Patrón de hora: ${items.join(', ')}`;
}

/** Nombres cortos de los días (lunes primero). */
export const WEEKDAY_LABELS: Record<Weekday, string> = { mon: 'lunes', tue: 'martes', wed: 'miércoles', thu: 'jueves', fri: 'viernes', sat: 'sábado', sun: 'domingo' };
const WEEKDAY_ORDER: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Día de la semana de la hora simulada (hora de pared en UTC). */
export function weekdayOf(ms: number): Weekday {
  return WEEKDAY_ORDER[new Date(ms).getUTCDay()] ?? 'mon';
}

// ---------- Condiciones ----------

export interface ConditionExplanation {
  result: boolean;
  description: string;
  detail: string;
  /** Subcondiciones de and/or. */
  children?: TraceCondition[];
}

/** Dónde calcular el sol: ubicación real o (tests) horas fijas. */
export type SunSource = SunLocation | SunConfig;

function sunBoundary(event: SunEvent, offsetMinutes: number | undefined, now: number, where: SunSource): number {
  const times = sunTimesAt(now, where);
  return (event === 'sunrise' ? times.sunrise : times.sunset) + (offsetMinutes ?? 0) * MINUTE_MS;
}

/** Evalúa una condición `sun` (después de / antes de amanecer o atardecer, con desplazamiento). */
export function evaluateSunCondition(c: Extract<Condition, { type: 'sun' }>, now: number, where: SunSource): boolean {
  const after = c.after === undefined ? undefined : sunBoundary(c.after, c.afterOffsetMinutes, now, where);
  const before = c.before === undefined ? undefined : sunBoundary(c.before, c.beforeOffsetMinutes, now, where);
  if (after !== undefined && before !== undefined) {
    return after <= before ? now >= after && now < before : now >= after || now < before;
  }
  if (after !== undefined) return now >= after;
  if (before !== undefined) return now < before;
  return true;
}

function describeSunCondition(c: Extract<Condition, { type: 'sun' }>): string {
  const parts: string[] = [];
  if (c.after) parts.push(`después del ${sunEventText(c.after, c.afterOffsetMinutes)}`);
  if (c.before) parts.push(`antes del ${sunEventText(c.before, c.beforeOffsetMinutes)}`);
  return parts.length === 0 ? 'Sol (sin límites)' : capitalize(parts.join(' y '));
}

function timeRangeText(after?: string, before?: string): string {
  if (after !== undefined && before !== undefined) return `Hora entre ${after} y ${before}`;
  if (after !== undefined) return `Hora a partir de las ${after}`;
  if (before !== undefined) return `Hora antes de las ${before}`;
  return 'Cualquier hora';
}

function since(sim: SimulationState, entityId: string): number | undefined {
  return sim.entities[entityId]?.lastChanged ?? sim.startedAt;
}

/**
 * Evalúa una condición y explica el resultado: descripción («Hora entre 20:00 y 07:30»),
 * resultado y detalle («son las 15:12»).
 */
export function explainCondition(c: Condition, sim: SimulationState, where: SunSource, vars?: Record<string, EntityStateValue>): ConditionExplanation {
  if (c.enabled === false) {
    // Tanda 3: una condición desactivada se ignora (cuenta como cumplida), como en HA.
    const inner = explainCondition({ ...c, enabled: true }, sim, where, vars);
    return { result: true, description: inner.description, detail: 'desactivada: se ignora' };
  }
  switch (c.type) {
    case 'state': {
      const current = sim.entities[c.entityId];
      const name = friendlyName(sim, c.entityId);
      let description = `${name} está ${label(sim, c.entityId, c.state)}`;
      if (c.for) description += ` desde hace al menos ${formatSeconds(c.for)}`;
      if (!current) return { result: false, description, detail: 'la entidad no existe' };
      if (!sameState(current.state, c.state)) return { result: false, description, detail: `está ${label(sim, c.entityId, current.state)}` };
      if (!c.for) return { result: true, description, detail: `está ${label(sim, c.entityId, current.state)}` };
      const from = since(sim, c.entityId);
      const elapsed = from === undefined ? Number.POSITIVE_INFINITY : (sim.now - from) / SECOND_MS;
      const enough = elapsed >= c.for;
      const detail = Number.isFinite(elapsed) ? `lleva ${formatSeconds(elapsed)}` : 'desde el inicio';
      return { result: enough, description, detail };
    }
    case 'numeric_state': {
      const unit = unitOf(sim, c.entityId);
      const description = `${friendlyName(sim, c.entityId)} ${rangeText(c.above, c.below, unit)}`;
      const value = sim.entities[c.entityId]?.state;
      const n = toNumber(value);
      if (n === undefined) {
        return { result: false, description, detail: value === undefined ? 'la entidad no existe' : `no es un número (${label(sim, c.entityId, value)})` };
      }
      return { result: inNumericRange(value, c.above, c.below), description, detail: `vale ${fmtNumber(n)}${unit}` };
    }
    case 'time': {
      const days = c.weekday ?? [];
      const dayText = days.length > 0 ? `${c.after === undefined && c.before === undefined ? 'Días' : ', días'}: ${days.map((d) => WEEKDAY_LABELS[d]).join(', ')}` : '';
      const description = c.after === undefined && c.before === undefined && days.length > 0 ? dayText : timeRangeText(c.after, c.before) + dayText;
      const today = weekdayOf(sim.now);
      const detail = `son las ${formatSimTime(sim.now)}${days.length > 0 ? ` del ${WEEKDAY_LABELS[today]}` : ''}`;
      try {
        return { result: isTimeBetween(sim.now, c.after, c.before) && (days.length === 0 || days.includes(today)), description, detail };
      } catch {
        return { result: false, description, detail: 'hora no válida' };
      }
    }
    case 'sun': {
      const times = sunTimesAt(sim.now, where);
      const detail = `son las ${formatSimTime(sim.now)}; amanecer ${formatSimTime(times.sunrise)}, atardecer ${formatSimTime(times.sunset)}`;
      return { result: evaluateSunCondition(c, sim.now, where), description: describeSunCondition(c), detail };
    }
    case 'and':
    case 'or': {
      const parts = c.conditions.map((x) => explainCondition(x, sim, where, vars));
      const ok = parts.filter((p) => p.result).length;
      const result = c.type === 'and' ? parts.every((p) => p.result) : parts.some((p) => p.result);
      const joined = parts.map((p) => p.description).join(c.type === 'and' ? ' y ' : ' o ');
      const description = c.type === 'and' ? `Todas: ${joined || '(ninguna)'}` : `Alguna: ${joined || '(ninguna)'}`;
      const children: TraceCondition[] = parts.map((p, index) => ({ index, ...p }));
      return { result, description, detail: `se cumplen ${ok} de ${parts.length}`, children };
    }
    case 'not': {
      // Fase 3: se cumple si no se cumple ninguna.
      const parts = c.conditions.map((x) => explainCondition(x, sim, where, vars));
      const ok = parts.filter((p) => p.result).length;
      const description = `Ninguna: ${parts.map((p) => p.description).join(' o ') || '(ninguna)'}`;
      const children: TraceCondition[] = parts.map((p, index) => ({ index, ...p }));
      return { result: ok === 0, description, detail: `se cumplen ${ok} de ${parts.length}`, children };
    }
    case 'zone': {
      const person = personName(sim, c.personId);
      const description = `${person} está en ${zoneName(sim, c.zoneId)}`;
      const result = personInZone(sim, c.personId, c.zoneId);
      const current = Object.entries(sim.entities).find(([id, e]) => id.startsWith('person.') && e.attributes?.person_id === c.personId)?.[1];
      if (!current) return { result: false, description, detail: 'la persona no existe' };
      const at = String(current.attributes?.zone_id ?? '');
      return { result, description, detail: at === '' ? 'está fuera' : `está en ${zoneName(sim, at)}` };
    }
    case 'trigger': {
      // Tanda 1: `condition: trigger`, con el id del disparo en las variables (trigger.id).
      const description = `Disparado por ${c.ids.length === 1 ? 'el disparador' : 'uno de los disparadores'} ${c.ids.map((x) => `«${x}»`).join(', ') || '(ninguno)'}`;
      const fired = vars?.['trigger.id'];
      if (fired === undefined) return { result: false, description, detail: 'sin disparo (ejecución manual)' };
      return { result: c.ids.includes(String(fired)), description, detail: `disparó «${String(fired)}»` };
    }
  }
}

/** Descripción breve de una lista de condiciones (para choose/if/repeat). */
function describeConditions(cs: Condition[], sim: SimulationState): string {
  if (cs.length === 0) return 'siempre';
  // La descripción no depende de la ubicación del sol: basta con horas fijas.
  return cs.map((c) => explainCondition(c, sim, { sunrise: '07:00', sunset: '20:00' }).description).join(' y ');
}

/** «Hora entre 20:00 y 07:30 → no (son las 15:12)». */
export function formatTraceCondition(c: Pick<TraceCondition, 'description' | 'result' | 'detail'>): string {
  return `${c.description} → ${c.result ? 'sí' : 'no'} (${c.detail})`;
}

// ---------- Acciones ----------

/** « Luz salón», « Luz salón, Luz cocina y área Salón»: destinos de una llamada a servicio. */
function describeTargets(a: ServiceAction, sim: SimulationState, project: Partial<Pick<Project, 'rooms'>>): string {
  const names = serviceEntityIds(a).map((id) => friendlyName(sim, id));
  for (const roomId of serviceAreaIds(a)) names.push(`área ${project.rooms?.find((r) => r.id === roomId)?.name ?? roomId}`);
  if (names.length === 0) return a.entityId === '' ? '' : ` ${friendlyName(sim, a.entityId)}`;
  const last = names.pop() ?? '';
  return ` ${names.length > 0 ? `${names.join(', ')} y ${last}` : last}`;
}

/** «Encender Luz salón (brillo 47 %)», «Esperar 2 min», «Activar escena Cine»... */
export function describeAction(a: Action, sim: SimulationState, project: Pick<Project, 'scenes' | 'scripts'> & Partial<Pick<Project, 'rooms'>>): string {
  if (a.enabled === false) return `(desactivada) ${describeAction({ ...a, enabled: true }, sim, project)}`;
  switch (a.type) {
    case 'service': {
      if (isNotifyService(a.service)) {
        const n = notificationContent(a.data);
        return n ? `Notificar: ${n.title ? `${n.title} — ` : ''}${n.message}` : 'Notificar (sin mensaje)';
      }
      const data = describeServiceData(a.data);
      const target = a.service.startsWith('script.') && a.service !== 'script.turn_on' ? '' : describeTargets(a, sim, project);
      return `${serviceName(a.service)}${target}${data ? ` (${data})` : ''}`;
    }
    case 'scene': {
      const scene = project.scenes.find((s) => s.id === a.sceneId);
      return `Activar escena ${scene ? scene.name : a.sceneId}`;
    }
    case 'script': {
      const script = project.scripts.find((s) => s.id === a.scriptId);
      return `Ejecutar script ${script ? script.name : a.scriptId}`;
    }
    case 'delay':
      return `Esperar ${formatSeconds(a.seconds)}`;
    // Fase 3: acciones con lógica (las anidadas se resumen en la descripción del paso).
    case 'choose':
      return `Elegir entre ${a.choices.length} opci${a.choices.length === 1 ? 'ón' : 'ones'}${a.default && a.default.length > 0 ? ' (con opción por defecto)' : ''}`;
    case 'if':
      return `Si ${describeConditions(a.conditions, sim)}: ${a.then.length} acci${a.then.length === 1 ? 'ón' : 'ones'}${a.else && a.else.length > 0 ? `; si no: ${a.else.length}` : ''}`;
    case 'wait_for_trigger': {
      const what = a.triggers.map((t) => describeTrigger(t, sim)).join(' o ') || '(sin disparador)';
      return `Esperar a: ${what}${a.timeoutSeconds !== undefined ? ` (máximo ${formatSeconds(a.timeoutSeconds)})` : ''}`;
    }
    case 'repeat': {
      const n = a.sequence.length;
      const body = `${n} acci${n === 1 ? 'ón' : 'ones'}`;
      if (a.count !== undefined) return `Repetir ${a.count} ${plural(a.count, 'vez', 'veces')}: ${body}`;
      if (a.while) return `Repetir mientras ${describeConditions(a.while, sim)}: ${body}`;
      return `Repetir hasta ${describeConditions(a.until ?? [], sim)}: ${body}`;
    }
    case 'notify':
      return `Notificar: ${a.title ? `${a.title} — ` : ''}${a.message}`;
    case 'variables':
      return `Variables: ${Object.keys(a.variables).join(', ') || '(ninguna)'}`;
    case 'stop':
      return `${a.error ? 'Detener con error' : 'Detener'}: ${a.message || '(sin motivo)'}`;
    case 'parallel':
      return `En paralelo: ${a.branches.length} ${plural(a.branches.length, 'rama', 'ramas')}`;
  }
}

// ---------- Gestión de trazas ----------

/** Crea una traza nueva con las acciones de la automatización en estado 'skipped'. */
export function newTrace(
  sim: SimulationState,
  project: Pick<Project, 'scenes' | 'scripts'> & Partial<Pick<Project, 'rooms'>>,
  a: Automation,
  trigger: TraceTrigger,
  conditions: TraceCondition[],
  result: AutomationTrace['result'],
): AutomationTrace {
  const seq = (sim.traces ?? []).reduce((max, t) => Math.max(max, Number(t.id.replace(/^trace-/, '')) || 0), 0) + 1;
  const actions: TraceAction[] = a.actions.map((x, index) => ({ index, description: describeAction(x, sim, project), status: 'skipped' }));
  return { id: `trace-${seq}`, automationId: a.id, startedAt: sim.now, trigger, conditions, actions, result };
}

/** Añade una traza conservando como mucho MAX_TRACES_PER_AUTOMATION por automatización. */
export function addTrace(sim: SimulationState, trace: AutomationTrace): SimulationState {
  const all = [...(sim.traces ?? []), trace];
  const same = all.filter((t) => t.automationId === trace.automationId);
  const drop = new Set(same.slice(0, Math.max(0, same.length - MAX_TRACES_PER_AUTOMATION)).map((t) => t.id));
  return { ...sim, traces: drop.size === 0 ? all : all.filter((t) => !drop.has(t.id)) };
}

export function updateTrace(sim: SimulationState, traceId: Id, fn: (t: AutomationTrace) => AutomationTrace): SimulationState {
  if (!sim.traces?.some((t) => t.id === traceId)) return sim;
  return { ...sim, traces: sim.traces.map((t) => (t.id === traceId ? fn(t) : t)) };
}

/** Actualiza el paso `index` de una traza. */
export function setTraceAction(sim: SimulationState, traceId: Id, index: number, patch: Partial<Omit<TraceAction, 'index'>>): SimulationState {
  return updateTrace(sim, traceId, (t) => ({
    ...t,
    actions: t.actions.map((x) => {
      if (x.index !== index) return x;
      const next: TraceAction = { ...x, ...patch };
      if (patch.detail === undefined && 'detail' in patch) delete next.detail;
      return next;
    }),
  }));
}

/** Trazas de una automatización, de la más reciente a la más antigua. */
export function tracesFor(sim: SimulationState, automationId: Id): AutomationTrace[] {
  return (sim.traces ?? []).filter((t) => t.automationId === automationId).reverse();
}

/** Última traza de una automatización, si la hay. */
export function lastTrace(sim: SimulationState, automationId: Id): AutomationTrace | undefined {
  return tracesFor(sim, automationId)[0];
}

/** Resultado de la traza en español, para la interfaz. */
export const TRACE_RESULT_LABELS: Record<AutomationTrace['result'], string> = {
  ran: 'Ejecutada',
  conditions_failed: 'Condiciones no cumplidas',
  skipped_single: 'Ignorada (ya en ejecución)',
  queued: 'En cola',
  error: 'Error',
  ha_unavailable: 'Home Assistant no disponible',
};

export const TRACE_ACTION_STATUS_LABELS: Record<TraceAction['status'], string> = {
  done: 'Hecho',
  waiting: 'Esperando',
  skipped: 'No ejecutado',
  error: 'Error',
};
