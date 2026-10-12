// Tanda 3: generador de «día típico». A partir de las salas y los dispositivos del proyecto
// genera eventos de entrada realistas (personas que se mueven entre salas, puertas, luces, la
// TV, la ducha, salir y volver a casa) y los programa en el motor como temporizadores para que
// a 600x pase algo. Determinista con la semilla. Funciones puras.
import type { DayPlan, DayPlanEvent, DayProfile, DeviceDefinition, Id, Project, Room, SimulationState, TimelineEventStep } from '../types';
import { allDefinitions } from '../devices/catalog';
import { entitiesForDevice, type DeviceEntity } from '../devices/entities';
import { foldText } from '../devices/text';
import { DAY_MS, HOUR_MS, MINUTE_MS, SECOND_MS, startOfDay } from '../simulation/clock';
import { appendLog, cancelTimer, scheduleTimer } from '../simulation/engine';
import { projectZones } from '../simulation/logic';

export interface DayPlanOptions {
  people: number;
  profile: DayProfile;
  seed: number;
}

export const DAY_PROFILE_LABELS: Record<DayProfile, string> = {
  teletrabajo: 'Teletrabajo',
  oficina: 'Oficina',
  fin_de_semana: 'Fin de semana',
};

/** Tipo de estancia deducido del nombre de la sala. */
export type RoomKind = 'bedroom' | 'bathroom' | 'kitchen' | 'living' | 'entrance' | 'corridor' | 'office' | 'other';

const ROOM_WORDS: [RoomKind, string[]][] = [
  ['bathroom', ['bano', 'aseo', 'ducha', 'bath', 'wc']],
  ['bedroom', ['dormitorio', 'habitacion', 'cuarto', 'suite', 'bedroom']],
  ['kitchen', ['cocina', 'kitchen', 'office cocina']],
  ['living', ['salon', 'estar', 'comedor', 'living', 'sala']],
  ['entrance', ['entrada', 'recibidor', 'hall', 'vestibulo', 'porche']],
  ['corridor', ['pasillo', 'distribuidor', 'escalera', 'rellano']],
  ['office', ['despacho', 'estudio', 'oficina', 'trabajo']],
];

export function roomKind(name: string): RoomKind {
  const n = foldText(name);
  for (const [kind, words] of ROOM_WORDS) if (words.some((w) => n.includes(w))) return kind;
  return 'other';
}

/** Generador pseudoaleatorio determinista (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = Math.floor(seed) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface RoomInfo {
  room: Room;
  kind: RoomKind;
  motion: string[];
  lights: string[];
  doors: string[];
  humidity: string[];
  media: string[];
}

function collectRooms(project: Project, defs: DeviceDefinition[]): RoomInfo[] {
  const all = allDefinitions(project, defs);
  return project.rooms.map((room) => {
    const info: RoomInfo = { room, kind: roomKind(room.name), motion: [], lights: [], doors: [], humidity: [], media: [] };
    for (const device of project.devices.filter((d) => d.roomId === room.id)) {
      const def = all.find((d) => d.id === device.definitionId);
      if (!def) continue;
      const entities: DeviceEntity[] = entitiesForDevice(device, def);
      for (const e of entities) {
        const { domain, deviceClass } = e.definition;
        if (domain === 'binary_sensor' && ['motion', 'occupancy', 'presence'].includes(deviceClass ?? '')) info.motion.push(e.entityId);
        if (domain === 'binary_sensor' && ['door', 'window', 'opening', 'garage_door'].includes(deviceClass ?? '') && deviceClass !== 'window') info.doors.push(e.entityId);
        if (domain === 'light') info.lights.push(e.entityId);
        if (domain === 'sensor' && deviceClass === 'humidity') info.humidity.push(e.entityId);
        if (domain === 'media_player' && (def.category === 'display' || def.category === 'speaker')) info.media.push(e.entityId);
      }
    }
    return info;
  });
}

/** Actividad: estar en una sala de `from` a `to` (minutos desde medianoche). */
interface Stay {
  kind: RoomKind | 'away';
  from: number;
  to: number;
  label: string;
  /** Ducharse (humedad), ver la TV. */
  activity?: 'shower' | 'tv';
}

type Routine = Stay[];

const h = (hh: number, mm = 0): number => hh * 60 + mm;

const ROUTINES: Record<DayProfile, Routine> = {
  teletrabajo: [
    { kind: 'bedroom', from: h(0), to: h(7, 30), label: 'duerme' },
    { kind: 'bathroom', from: h(7, 30), to: h(7, 55), label: 'se ducha', activity: 'shower' },
    { kind: 'kitchen', from: h(7, 55), to: h(8, 30), label: 'desayuna' },
    { kind: 'office', from: h(8, 30), to: h(13, 45), label: 'teletrabaja' },
    { kind: 'kitchen', from: h(13, 45), to: h(15, 0), label: 'come' },
    { kind: 'office', from: h(15, 0), to: h(18, 30), label: 'teletrabaja' },
    { kind: 'away', from: h(18, 45), to: h(20, 0), label: 'sale a pasear' },
    { kind: 'kitchen', from: h(20, 30), to: h(21, 30), label: 'cena' },
    { kind: 'living', from: h(21, 30), to: h(23, 30), label: 've la TV', activity: 'tv' },
    { kind: 'bathroom', from: h(23, 30), to: h(23, 40), label: 'se lava los dientes' },
    { kind: 'bedroom', from: h(23, 40), to: h(24), label: 'se acuesta' },
  ],
  oficina: [
    { kind: 'bedroom', from: h(0), to: h(6, 45), label: 'duerme' },
    { kind: 'bathroom', from: h(6, 45), to: h(7, 5), label: 'se ducha', activity: 'shower' },
    { kind: 'kitchen', from: h(7, 5), to: h(7, 30), label: 'desayuna' },
    { kind: 'away', from: h(7, 45), to: h(18, 15), label: 'está en la oficina' },
    { kind: 'living', from: h(18, 30), to: h(20, 15), label: 'descansa en el salón' },
    { kind: 'kitchen', from: h(20, 15), to: h(21, 15), label: 'cena' },
    { kind: 'living', from: h(21, 15), to: h(23, 0), label: 've la TV', activity: 'tv' },
    { kind: 'bathroom', from: h(23, 0), to: h(23, 10), label: 'se lava los dientes' },
    { kind: 'bedroom', from: h(23, 10), to: h(24), label: 'se acuesta' },
  ],
  fin_de_semana: [
    { kind: 'bedroom', from: h(0), to: h(9, 30), label: 'duerme' },
    { kind: 'kitchen', from: h(9, 30), to: h(10, 30), label: 'desayuna' },
    { kind: 'bathroom', from: h(10, 30), to: h(10, 55), label: 'se ducha', activity: 'shower' },
    { kind: 'living', from: h(10, 55), to: h(12, 0), label: 'lee en el salón' },
    { kind: 'away', from: h(12, 0), to: h(16, 30), label: 'sale a comer fuera' },
    { kind: 'living', from: h(16, 30), to: h(19, 0), label: 've una película', activity: 'tv' },
    { kind: 'kitchen', from: h(20, 30), to: h(21, 45), label: 'cena' },
    { kind: 'living', from: h(21, 45), to: h(23, 45), label: 've la TV', activity: 'tv' },
    { kind: 'bedroom', from: h(23, 50), to: h(24), label: 'se acuesta' },
  ],
};

/** Sala de cada tipo (si no existe, la más parecida: despacho → dormitorio, salón → cocina...). */
const FALLBACK: Record<RoomKind, RoomKind[]> = {
  bedroom: ['other', 'living'],
  bathroom: ['bedroom'],
  kitchen: ['living', 'other'],
  living: ['kitchen', 'other'],
  entrance: ['corridor', 'living'],
  corridor: ['entrance'],
  office: ['bedroom', 'living', 'other'],
  other: ['living', 'bedroom'],
};

function pickRoom(rooms: RoomInfo[], kind: RoomKind, person: number): RoomInfo | undefined {
  for (const k of [kind, ...FALLBACK[kind]]) {
    const list = rooms.filter((r) => r.kind === k);
    if (list.length > 0) return list[person % list.length];
  }
  return rooms[0];
}

/** ¿Es de noche para encender luces? (antes de las 8:00 o desde las 20:00). */
const isDark = (minute: number): boolean => minute < h(8) || minute >= h(20);

/**
 * Genera el día típico: para cada persona, su rutina según el perfil con variaciones aleatorias
 * (deterministas con la semilla). Cada cambio de sala crea movimiento en las salas por las que
 * pasa (el pasillo o distribuidor y la de destino), enciende y apaga luces si es de noche, la
 * ducha sube la humedad del baño, la TV se enciende y apaga, y al salir o volver a casa se abre la
 * puerta de entrada y la persona cambia de zona.
 */
export function generateDayPlan(project: Project, defs: DeviceDefinition[], opts: DayPlanOptions): DayPlan {
  const random = seededRandom(opts.seed);
  const rooms = collectRooms(project, defs);
  const people = Math.max(1, Math.min(8, Math.floor(opts.people)));
  const events: DayPlanEvent[] = [];
  const corridor = rooms.find((r) => r.kind === 'corridor');
  const entrance = rooms.find((r) => r.kind === 'entrance') ?? corridor;
  const homeZone = projectZones(project).find((z) => z.kind === 'home');
  const workZone = projectZones(project).find((z) => z.kind === 'work');
  const add = (minute: number, person: number, step: TimelineEventStep, description: string): void => {
    const at = Math.max(0, Math.min(DAY_MS - SECOND_MS, Math.round(minute * MINUTE_MS)));
    events.push({ at, person, step, description });
  };
  const motionIn = (r: RoomInfo | undefined, minute: number, person: number, who: string): void => {
    for (const id of r?.motion ?? []) add(minute, person, { at: '', kind: 'event', event: 'motion', entityId: id, value: true }, `${who}: movimiento en ${r?.room.name ?? ''}`);
  };
  for (let p = 0; p < people; p++) {
    const who = project.people?.[p]?.name ?? `Persona ${p + 1}`;
    const personId = project.people?.[p]?.id;
    const jitter = (): number => Math.round((random() - 0.5) * 30);
    let current: RoomInfo | undefined;
    for (const stay of ROUTINES[opts.profile]) {
      const from = Math.max(0, stay.from + (stay.from === 0 ? 0 : jitter()));
      const to = Math.min(h(24) - 1, stay.to + (stay.to >= h(24) ? 0 : jitter()));
      if (to <= from) continue;
      if (stay.kind === 'away') {
        // Sale: pasa por la entrada, abre y cierra la puerta y cambia de zona.
        if (current && isDark(from)) for (const id of current.lights) add(from - 1, p, svc(id, 'light.turn_off'), `${who} apaga la luz de ${current.room.name}`);
        motionIn(entrance, from, p, who);
        for (const id of entrance?.doors ?? []) {
          add(from + 0.2, p, door(id, true), `${who} abre la puerta de ${entrance?.room.name ?? 'la entrada'}`);
          add(from + 0.5, p, door(id, false), `${who} cierra la puerta`);
        }
        if (personId) add(from + 1, p, person(personId, opts.profile === 'oficina' ? (workZone?.id ?? '') : ''), `${who} ${stay.label}`);
        if (personId && homeZone) add(to, p, person(personId, homeZone.id), `${who} vuelve a casa`);
        for (const id of entrance?.doors ?? []) {
          add(to + 0.5, p, door(id, true), `${who} abre la puerta al volver`);
          add(to + 0.8, p, door(id, false), `${who} cierra la puerta`);
        }
        motionIn(entrance, to + 1, p, who);
        current = entrance;
        continue;
      }
      const target = pickRoom(rooms, stay.kind, p);
      if (!target) continue;
      if (target !== current && from > 0) {
        if (current && isDark(from)) for (const id of current.lights) add(from - 0.5, p, svc(id, 'light.turn_off'), `${who} apaga la luz de ${current.room.name}`);
        if (corridor && corridor !== target && corridor !== current) motionIn(corridor, from - 0.3, p, who);
        motionIn(target, from, p, who);
        if (isDark(from) && stay.kind !== 'bedroom') for (const id of target.lights) add(from + 0.1, p, svc(id, 'light.turn_on'), `${who} enciende la luz de ${target.room.name}`);
      }
      current = target;
      // Movimiento mientras está despierto en la sala (cada 10-20 min).
      if (stay.kind !== 'bedroom' || stay.from > 0) {
        for (let m = from + 10 + random() * 10; m < to - 2 && stay.label !== 'duerme'; m += 10 + random() * 10) motionIn(target, m, p, who);
      }
      if (stay.activity === 'shower') {
        for (const id of target.humidity) {
          add(from + 2, p, state(id, 85), `${who} se ducha: sube la humedad`);
          add(from + 15, p, state(id, 70), 'La humedad del baño baja');
          add(Math.min(to + 25, h(24) - 1), p, state(id, 55), 'La humedad del baño vuelve a la normalidad');
        }
      }
      if (stay.activity === 'tv') {
        for (const id of target.media) {
          add(from + 1, p, svc(id, 'media_player.turn_on'), `${who} enciende ${id.startsWith('media_player.') ? 'la TV' : id}`);
          add(to - 1, p, svc(id, 'media_player.turn_off'), `${who} apaga la TV`);
        }
      }
      if (stay.label === 'se acuesta' && isDark(from)) for (const id of target.lights) add(from + 5, p, svc(id, 'light.turn_off'), `${who} apaga la luz y se duerme`);
    }
  }
  events.sort((a, b) => a.at - b.at || a.person - b.person);
  return { profile: opts.profile, people, seed: opts.seed, events: dedupe(events) };
}

/** Quita eventos idénticos en el mismo segundo (dos personas que encienden la misma luz). */
function dedupe(events: DayPlanEvent[]): DayPlanEvent[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    const key = `${Math.floor(e.at / SECOND_MS)}|${e.step.event}|${e.step.entityId ?? e.step.personId ?? ''}|${String(e.step.value ?? e.step.service ?? e.step.zoneId ?? '')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function svc(entityId: string, service: string): TimelineEventStep {
  return { at: '', kind: 'event', event: 'service', entityId, service };
}

function door(entityId: string, open: boolean): TimelineEventStep {
  return { at: '', kind: 'event', event: 'door', entityId, value: open };
}

function state(entityId: string, value: number): TimelineEventStep {
  return { at: '', kind: 'event', event: 'state', entityId, value };
}

function person(personId: Id, zoneId: Id): TimelineEventStep {
  return { at: '', kind: 'event', event: 'person', personId, zoneId };
}

/** Prefijo de las claves de los temporizadores del día típico. */
export const DAY_PLAN_KEY = 'dayplan:';

/** "HH:MM:SS" de un desplazamiento en ms desde medianoche. */
export function planTime(at: number): string {
  const s = Math.floor(at / SECOND_MS);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/**
 * Programa en el motor los eventos del plan que caen en (max(fromMs, ahora), toMs], repitiendo el
 * día si el intervalo abarca varios días, como temporizadores internos (se ejecutan al avanzar el
 * reloj). Sustituye un día típico anterior.
 */
export function applyDayPlan(sim: SimulationState, _project: Project, plan: DayPlan, fromMs: number, toMs: number): SimulationState {
  let result = clearDayPlan(sim);
  const start = Math.max(fromMs, sim.now);
  let count = 0;
  for (let day = startOfDay(start), d = 0; day <= toMs && d < 31; day += DAY_MS, d++) {
    plan.events.forEach((e, i) => {
      const at = day + e.at;
      if (at <= start || at > toMs) return;
      result = scheduleTimer(result, `${DAY_PLAN_KEY}${d}:${i}`, at, { kind: 'timeline_event', step: { ...e.step, at: planTime(e.at) }, description: `Día típico: ${e.description}` });
      count++;
    });
  }
  return appendLog(result, 'info', `Día típico (${DAY_PROFILE_LABELS[plan.profile].toLowerCase()}, ${plan.people} ${plan.people === 1 ? 'persona' : 'personas'}): ${count} ${count === 1 ? 'evento programado' : 'eventos programados'}`);
}

/** Quita los eventos pendientes de un día típico. */
export function clearDayPlan(sim: SimulationState): SimulationState {
  let result = sim;
  for (const p of sim.pending) if (p.key?.startsWith(DAY_PLAN_KEY)) result = cancelTimer(result, p.key);
  return result;
}

/** Resumen por hora para la interfaz: número de eventos en cada hora del día. */
export function eventsPerHour(plan: DayPlan): number[] {
  const out = Array.from({ length: 24 }, () => 0);
  for (const e of plan.events) {
    const i = Math.min(23, Math.floor(e.at / HOUR_MS));
    out[i] = (out[i] ?? 0) + 1;
  }
  return out;
}
