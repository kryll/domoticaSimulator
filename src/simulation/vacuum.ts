// Robot aspirador (dominio vacuum de HA): servicios, limpieza por salas, batería, consumibles y
// base de autovaciado. Funciones puras: el motor (engine.ts) aplica los resultados y programa el
// paso periódico (temporizador `vacuum_step`).
//
// Estados de HA: cleaning, docked, returning, paused, idle y error (con el atributo `error`).
// La base (vaciado, lavado y secado de la mopa) no cambia el estado del robot: se ve en el
// sensor «Estado de la base» (dock_status), como en Roborock y Dreame.
import type { Device, DeviceDefinition, EntityCapabilities, EntityState, EntityStateValue, Floor, Id, Project, Room, ServiceData, ServiceDataValue } from '../types';
import { entitiesForDevice } from '../devices/entities';

type Attrs = Record<string, EntityStateValue>;

/** Segundos entre pasos de la limpieza y de la carga. */
export const VACUUM_STEP_SECONDS = 60;
/** Segundos que tarda en volver a la base. */
export const VACUUM_RETURN_SECONDS = 30;
/** Por debajo de este nivel interrumpe la limpieza y vuelve a cargar. */
export const VACUUM_LOW_BATTERY = 15;
/** Nivel al que retoma la limpieza interrumpida. */
export const VACUUM_RESUME_BATTERY = 80;
/** Nivel mínimo para empezar a limpiar. */
export const VACUUM_MIN_START_BATTERY = 20;
/** Carga en la base: % por minuto (de 0 a 100 en unas 3 h 20 min). */
export const VACUUM_CHARGE_PER_MIN = 0.5;
/** Fracción del suelo de una sala que se limpia de verdad (muebles). */
export const CLEANABLE_FRACTION = 0.8;
/** Primer número de segmento del mapa (como Roborock). */
export const FIRST_SEGMENT = 16;
/** Evento que lanza el simulador al terminar una limpieza (para usarlo como disparador). */
export const VACUUM_FINISHED_EVENT = 'hasim_vacuum_finished';

export const DEFAULT_VACUUM_RATE = 1;
export const DEFAULT_VACUUM_RUNTIME = 150;

/** Duración de las fases de la base (segundos). */
export const DOCK_PHASE_SECONDS: Record<'emptying' | 'washing_mop' | 'drying', number> = { emptying: 15, washing_mop: 180, drying: 2 * 3600 };
/** Consumo de la base en cada fase (W). */
export const DOCK_PHASE_WATTS: Record<'emptying' | 'washing_mop' | 'drying', number> = { emptying: 1000, washing_mop: 60, drying: 90 };
/** Potencia de carga por defecto (W). */
export const DEFAULT_CHARGE_WATTS = 30;

/** Vida útil en horas de uso de cada consumible. */
export const CONSUMABLE_LIFE_HOURS: Record<string, number> = { main_brush: 300, side_brush: 200, filter: 150, mop_pad: 180 };

/** Errores que se pueden simular (atributo `error`). */
export const VACUUM_ERRORS: Record<string, string> = {
  main_brush_jammed: 'Cepillo principal atascado',
  side_brush_jammed: 'Cepillo lateral atascado',
  wheel_stuck: 'Rueda atascada',
  robot_stuck: 'Robot atrapado',
  water_tank_empty: 'Depósito de agua vacío',
  dustbin_missing: 'Falta el depósito de polvo',
  cliff_sensor: 'Sensores de caída sucios',
  battery_empty: 'Batería agotada',
};

/** Consumo de batería según la potencia de aspiración (factor sobre el normal). */
const FAN_DRAIN: Record<string, number> = {
  off: 0.6,
  quiet: 0.8,
  silent: 0.8,
  balanced: 1,
  standard: 1,
  normal: 1,
  medium: 1.1,
  strong: 1.3,
  turbo: 1.3,
  max: 1.6,
  max_plus: 1.8,
};

export interface VacuumRoom {
  id: Id;
  name: string;
  /** Superficie útil que limpia (m²). */
  areaM2: number;
  segment: number;
}

/** Contexto del robot en el proyecto (salas, entidades hermanas y capacidades). */
export interface VacuumContext {
  rooms: VacuumRoom[];
  /** Sala de la base (la del dispositivo). */
  homeRoomId?: Id;
  caps: EntityCapabilities;
  battery: number;
  /** Modo de limpieza (select mop_mode) y si tiene mopa. */
  mopMode?: string;
  hasMop: boolean;
  /** Clave de entidad → entity_id de las entidades hermanas. */
  siblings: Record<string, string>;
}

// ---------- Utilidades ----------

const num = (v: unknown): number | undefined => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
};
const round = (n: number, d = 1): number => Math.round(n * 10 ** d) / 10 ** d;
const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));

/** Superficie de un polígono en m² (fórmula del área de Gauss). */
export function polygonAreaM2(room: Pick<Room, 'polygon'>, pixelsPerMeter: number): number {
  const pts = room.polygon;
  let twice = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (a && b) twice += a.x * b.y - b.x * a.y;
  }
  const ppm = pixelsPerMeter > 0 ? pixelsPerMeter : 50;
  return Math.abs(twice) / 2 / (ppm * ppm);
}

/** Salas del mapa del robot en orden, con su número de segmento y la superficie que limpia. */
export function vacuumRooms(project: Pick<Project, 'rooms' | 'floors'>, device: Pick<Device, 'floorId' | 'vacuumRooms'>): VacuumRoom[] {
  const floors = new Map<Id, Floor>(project.floors.map((f) => [f.id, f]));
  const ids = device.vacuumRooms ?? project.rooms.filter((r) => r.floorId === device.floorId).map((r) => r.id);
  const out: VacuumRoom[] = [];
  ids.forEach((id, i) => {
    const room = project.rooms.find((r) => r.id === id);
    if (!room) return;
    const ppm = floors.get(room.floorId)?.pixelsPerMeter ?? 50;
    out.push({ id: room.id, name: room.name, areaM2: round(polygonAreaM2(room, ppm) * CLEANABLE_FRACTION, 1), segment: FIRST_SEGMENT + i });
  });
  return out;
}

/** Ids de vacuumRooms que no existen en el proyecto (para el validador). */
export function unknownVacuumRooms(project: Pick<Project, 'rooms'>, device: Pick<Device, 'vacuumRooms'>): Id[] {
  return (device.vacuumRooms ?? []).filter((id) => !project.rooms.some((r) => r.id === id));
}

/** Minutos estimados para limpiar unas salas (sin contar la vuelta a cargar). */
export function estimateMinutes(rooms: VacuumRoom[], caps: EntityCapabilities, mopMode?: string): number {
  const rate = effectiveRate(caps, mopMode);
  return Math.ceil(rooms.reduce((s, r) => s + r.areaM2, 0) / rate);
}

function effectiveRate(caps: EntityCapabilities, mopMode?: string): number {
  const base = caps.cleaningRateM2Min ?? DEFAULT_VACUUM_RATE;
  return mopMode === 'mop' || mopMode === 'vacuum_mop' ? base * 0.85 : base;
}

/** Lista "a, b, c" (atributos de HA en el simulador) → lista. */
export function splitList(v: EntityStateValue | undefined): string[] {
  if (v === undefined || v === '') return [];
  return String(v)
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x !== '');
}

/** Números de segmento de los params de app_segment_clean: [16, 17], "[16, 17]" o [{segments: [...]}]. */
export function parseSegments(v: ServiceDataValue | undefined): number[] {
  if (v === undefined) return [];
  if (Array.isArray(v)) return v.filter((n) => Number.isFinite(n));
  if (typeof v === 'number') return [v];
  const text = String(v);
  const inner = /segments"?\s*:\s*\[([^\]]*)\]/.exec(text)?.[1] ?? text;
  return inner
    .replace(/[[\]{}]/g, ' ')
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** Ids de área de vacuum.clean_area (cleaning_area_id: lista o texto). */
export function parseAreaIds(v: ServiceDataValue | undefined): string[] {
  if (v === undefined) return [];
  if (Array.isArray(v)) return v.map(String);
  return String(v)
    .replace(/[[\]"']/g, ' ')
    .split(/[\s,]+/)
    .filter((x) => x !== '');
}

// ---------- Contexto ----------

/** Batería con decimales (atributo battery_precise) si coincide con el sensor redondeado. */
function preciseBattery(st: EntityState | undefined, sensor: number | undefined): number {
  const precise = num(st?.attributes?.battery_precise);
  const level = sensor ?? num(st?.attributes?.battery_level) ?? 100;
  return precise !== undefined && Math.round(precise) === Math.round(level) ? precise : level;
}

/** Contexto del robot `entityId` (vacuum.*) en el proyecto, o undefined si no es de un dispositivo. */
export function vacuumContext(
  project: Pick<Project, 'rooms' | 'floors' | 'devices'>,
  defs: DeviceDefinition[],
  entities: Readonly<Record<string, EntityState>>,
  entityId: string,
): VacuumContext | undefined {
  for (const device of project.devices) {
    const def = defs.find((d) => d.id === device.definitionId);
    if (!def) continue;
    const refs = entitiesForDevice(device, def);
    const main = refs.find((r) => r.entityId === entityId);
    if (!main) continue;
    const siblings: Record<string, string> = {};
    for (const r of refs) siblings[r.definition.key] = r.entityId;
    const batteryId = refs.find((r) => r.definition.deviceClass === 'battery')?.entityId;
    const mopId = siblings.mop_mode;
    const ctx: VacuumContext = {
      rooms: vacuumRooms(project, device),
      caps: main.definition.capabilities ?? {},
      battery: preciseBattery(entities[entityId], num(batteryId ? entities[batteryId]?.state : undefined)),
      hasMop: refs.some((r) => r.definition.key === 'mop_pad_left'),
      siblings,
    };
    if (device.roomId !== undefined) ctx.homeRoomId = device.roomId;
    const mop = mopId ? entities[mopId]?.state : undefined;
    if (mop !== undefined) ctx.mopMode = String(mop);
    return ctx;
  }
  return undefined;
}

// ---------- Servicios ----------

export interface VacuumServiceResult {
  state: EntityState;
  warnings: string[];
  /** Aviso informativo para el registro (localizar...). */
  notice?: string;
  /** Segundos hasta el próximo paso (undefined: no hace falta). */
  next?: number;
}

const ACTIVE = new Set(['cleaning', 'returning']);

function withState(current: EntityState, state: string, attrs: Attrs): EntityState {
  const next: EntityState = { state, attributes: attrs };
  if (current.lastChanged !== undefined) next.lastChanged = current.lastChanged;
  return next;
}

function roomName(ctx: VacuumContext | undefined, id: string | undefined): string {
  return ctx?.rooms.find((r) => r.id === id)?.name ?? id ?? '';
}

/** Atributos de una nueva limpieza de las salas `rooms`. */
function startJob(attrs: Attrs, rooms: VacuumRoom[], ctx: VacuumContext | undefined): Attrs {
  const next: Attrs = { ...attrs, cleaned_area: 0, cleaning_time: 0, job_area: round(rooms.reduce((s, r) => s + r.areaM2, 0)) };
  delete next.error;
  delete next.resume_after_charge;
  const first = rooms[0];
  if (first) {
    next.rooms_queue = rooms.map((r) => r.id).join(', ');
    next.current_room = first.id;
    next.current_room_name = first.name;
    next.room_left_m2 = first.areaM2;
    next.status = `Limpiando: ${first.name}`;
  } else {
    // Sin salas (dispositivo sin plano): limpieza genérica de 20 m² alrededor de la base.
    next.rooms_queue = '';
    next.room_left_m2 = 20;
    next.job_area = 20;
    next.status = 'Limpiando';
    const home = ctx?.homeRoomId;
    if (home) {
      next.current_room = home;
      next.current_room_name = roomName(ctx, home);
    }
  }
  return next;
}

function clearJob(attrs: Attrs): Attrs {
  const next = { ...attrs };
  for (const k of ['rooms_queue', 'room_left_m2', 'resume_after_charge']) delete next[k];
  return next;
}

/** Salas de una lista de segmentos (avisa de los que no existen). */
function roomsFromSegments(segments: number[], ctx: VacuumContext | undefined, warnings: string[]): VacuumRoom[] {
  const rooms: VacuumRoom[] = [];
  for (const s of segments) {
    const r = ctx?.rooms.find((x) => x.segment === s);
    if (r) rooms.push(r);
    else warnings.push(`El segmento ${s} no corresponde a ninguna sala del mapa`);
  }
  return rooms;
}

function roomsFromAreas(ids: string[], ctx: VacuumContext | undefined, warnings: string[]): VacuumRoom[] {
  const rooms: VacuumRoom[] = [];
  for (const id of ids) {
    const r = ctx?.rooms.find((x) => x.id === id);
    if (r) rooms.push(r);
    else warnings.push(`El área ${id} no está en el mapa del robot`);
  }
  return rooms;
}

/** Arranca la limpieza de unas salas (o de todas), comprobando la batería y los errores. */
function clean(current: EntityState, attrs: Attrs, rooms: VacuumRoom[], ctx: VacuumContext | undefined, warnings: string[]): VacuumServiceResult {
  const battery = ctx?.battery ?? 100;
  if (battery < VACUUM_MIN_START_BATTERY) {
    warnings.push(`Batería baja (${Math.round(battery)} %): el robot no empieza a limpiar hasta tener al menos un ${VACUUM_MIN_START_BATTERY} %`);
    return { state: withState(current, String(current.state), attrs), warnings };
  }
  return { state: withState(current, 'cleaning', startJob(attrs, rooms, ctx)), warnings, next: VACUUM_STEP_SECONDS };
}

function goHome(current: EntityState, attrs: Attrs, keepJob = false): VacuumServiceResult {
  if (current.state === 'docked') return { state: withState(current, 'docked', attrs), warnings: [] };
  const base = keepJob ? attrs : clearJob(attrs);
  const next: Attrs = { ...base, return_left: VACUUM_RETURN_SECONDS, status: 'Volviendo a la base' };
  delete next.error;
  return { state: withState(current, 'returning', next), warnings: [], next: VACUUM_RETURN_SECONDS };
}

/**
 * Servicio vacuum.* sobre el robot. Con `ctx` limpia por salas; sin él, limpieza genérica.
 * `service` sin dominio (start, pause, stop, start_pause, return_to_base, locate, clean_spot,
 * set_fan_speed, send_command, clean_area).
 */
export function vacuumService(service: string, current: EntityState, data: ServiceData, caps: EntityCapabilities, ctx?: VacuumContext): VacuumServiceResult | undefined {
  const attrs: Attrs = { ...current.attributes };
  const st = String(current.state);
  const warnings: string[] = [];
  const all = ctx?.rooms ?? [];
  const keep = (extra: Partial<VacuumServiceResult> = {}): VacuumServiceResult => ({ state: withState(current, st, attrs), warnings, ...extra });
  switch (service) {
    case 'start': {
      if (st === 'cleaning') return keep();
      // Reanuda la limpieza en pausa (o interrumpida) si quedan salas.
      if ((st === 'paused' || st === 'error' || st === 'idle') && attrs.room_left_m2 !== undefined) {
        const next: Attrs = { ...attrs, status: `Limpiando${attrs.current_room_name ? `: ${String(attrs.current_room_name)}` : ''}` };
        delete next.error;
        return { state: withState(current, 'cleaning', next), warnings, next: VACUUM_STEP_SECONDS };
      }
      return clean(current, attrs, all, ctx, warnings);
    }
    case 'pause':
      if (!ACTIVE.has(st)) return keep();
      return { state: withState(current, 'paused', { ...attrs, status: 'En pausa' }), warnings };
    case 'stop': {
      if (st === 'docked') return keep();
      const next = clearJob({ ...attrs, status: 'Detenido' });
      delete next.return_left;
      return { state: withState(current, 'idle', next), warnings };
    }
    case 'start_pause':
      return vacuumService(st === 'cleaning' ? 'pause' : 'start', current, data, caps, ctx);
    case 'return_to_base':
      return goHome(current, attrs);
    case 'locate':
      return keep({ notice: 'emite un pitido: «¡Estoy aquí!»' });
    case 'clean_spot':
      return { state: withState(current, 'cleaning', { ...startJob(attrs, [], undefined), job_area: 2, room_left_m2: 2, status: 'Limpieza localizada' }), warnings, next: VACUUM_STEP_SECONDS };
    case 'set_fan_speed': {
      const speed = data.fan_speed === undefined ? undefined : String(data.fan_speed);
      const list = caps.fanSpeeds ?? [];
      if (speed === undefined) warnings.push('Falta "fan_speed" en vacuum.set_fan_speed');
      else if (list.length === 0) warnings.push('Este robot no permite elegir la potencia de aspiración');
      else if (!list.includes(speed)) warnings.push(`Potencia no admitida: ${speed} (admite ${list.join(', ')})`);
      else attrs.fan_speed = speed;
      return keep();
    }
    case 'clean_area': {
      const rooms = roomsFromAreas(parseAreaIds(data.cleaning_area_id ?? data.area_id), ctx, warnings);
      if (rooms.length === 0) {
        warnings.push('vacuum.clean_area sin áreas válidas: el robot no se mueve');
        return keep();
      }
      return clean(current, attrs, rooms, ctx, warnings);
    }
    case 'send_command': {
      const command = data.command === undefined ? '' : String(data.command);
      if (command === 'app_segment_clean') {
        const rooms = roomsFromSegments(parseSegments(data.params), ctx, warnings);
        if (rooms.length === 0) {
          warnings.push('app_segment_clean sin segmentos válidos: el robot no se mueve');
          return keep();
        }
        return clean(current, attrs, rooms, ctx, warnings);
      }
      if (command === 'reset_consumable') {
        const what = String(data.params ?? '').replace(/[[\]"']/g, '').replace(/_work_time$/, '');
        if (CONSUMABLE_LIFE_HOURS[what] === undefined) warnings.push(`Consumible desconocido: ${what || '—'} (main_brush, side_brush, filter o mop_pad)`);
        else attrs[`wear_${what}`] = 0;
        return keep({ next: 0 });
      }
      if (command === 'app_start' || command === 'app_pause' || command === 'app_charge') {
        return vacuumService(command === 'app_start' ? 'start' : command === 'app_pause' ? 'pause' : 'return_to_base', current, data, caps, ctx);
      }
      warnings.push(command === '' ? 'Falta "command" en vacuum.send_command' : `Comando ${command}: el simulador no lo reconoce (se ignora)`);
      return keep();
    }
    default:
      return undefined;
  }
}

/** Pone el robot en error (evento físico: cepillo atascado, depósito vacío...). */
export function vacuumErrorState(current: EntityState, code: string): EntityState {
  const text = VACUUM_ERRORS[code] ?? code;
  return withState(current, 'error', { ...current.attributes, error: text, error_code: code, status: `Error: ${text}` });
}

// ---------- Paso periódico ----------

export interface VacuumStepResult {
  vacuum: EntityState;
  battery: number;
  /** Sensores hermanos por clave de entidad (consumibles, superficie, tiempo, base...). */
  sensors: Record<string, EntityStateValue>;
  logs: Array<{ level: 'info' | 'warning' | 'error'; message: string }>;
  /** La limpieza acaba de terminar. */
  finished?: { areaM2: number; minutes: number };
  /** Segundos hasta el siguiente paso (undefined: no hace falta). */
  next?: number;
}

function wearPct(attrs: Attrs, key: string): number {
  const minutes = num(attrs[`wear_${key}`]) ?? 0;
  const life = (CONSUMABLE_LIFE_HOURS[key] ?? 200) * 60;
  return Math.max(0, Math.round(100 - (minutes / life) * 100));
}

/** Valor de los sensores de consumibles y de la limpieza a partir de los atributos. */
export function vacuumSensors(attrs: Attrs, ctx: Pick<VacuumContext, 'siblings'>): Record<string, EntityStateValue> {
  const out: Record<string, EntityStateValue> = {};
  for (const key of Object.keys(CONSUMABLE_LIFE_HOURS)) {
    if (ctx.siblings[`${key}_left`] !== undefined) out[`${key}_left`] = wearPct(attrs, key);
  }
  if (ctx.siblings.cleaned_area !== undefined) out.cleaned_area = round(num(attrs.cleaned_area) ?? 0, 1);
  if (ctx.siblings.cleaning_time !== undefined) out.cleaning_time = Math.round(num(attrs.cleaning_time) ?? 0);
  if (ctx.siblings.dock_status !== undefined) out.dock_status = String(attrs.dock_phase ?? 'idle');
  if (ctx.siblings.dust_bag !== undefined && attrs.dust_bag !== undefined) out.dust_bag = Math.round(num(attrs.dust_bag) ?? 0);
  return out;
}

/** ¿Hace falta otro paso? (limpiando, volviendo, cargando o con la base trabajando). */
export function vacuumNextDelay(st: EntityState, battery: number): number | undefined {
  const s = String(st.state);
  const a = st.attributes ?? {};
  if (s === 'cleaning') return VACUUM_STEP_SECONDS;
  if (s === 'returning') return Math.max(1, num(a.return_left) ?? VACUUM_RETURN_SECONDS);
  if (s === 'docked') {
    const phase = a.dock_phase;
    if (phase === 'emptying' || phase === 'washing_mop' || phase === 'drying') return Math.min(VACUUM_STEP_SECONDS, Math.max(1, num(a.dock_phase_left) ?? 1));
    if (battery < 100) return VACUUM_STEP_SECONDS;
  }
  return undefined;
}

function wearAll(attrs: Attrs, minutes: number, ctx: VacuumContext): void {
  const mopping = ctx.hasMop && ctx.mopMode !== 'vacuum';
  for (const key of Object.keys(CONSUMABLE_LIFE_HOURS)) {
    if (key === 'mop_pad' && !mopping) continue;
    if (key !== 'mop_pad' && ctx.mopMode === 'mop') continue;
    attrs[`wear_${key}`] = round((num(attrs[`wear_${key}`]) ?? 0) + minutes, 2);
  }
}

/** Fases de la base al volver: vaciar (autovaciado) y lavar y secar la mopa. */
function dockPhases(ctx: VacuumContext, attrs: Attrs): Array<'emptying' | 'washing_mop' | 'drying'> {
  const phases: Array<'emptying' | 'washing_mop' | 'drying'> = [];
  if ((num(attrs.cleaned_area) ?? 0) <= 0) return phases;
  if (ctx.caps.selfEmpty) phases.push('emptying');
  if (ctx.caps.mopWash && ctx.hasMop && ctx.mopMode !== 'vacuum') phases.push('washing_mop', 'drying');
  return phases;
}

const DOCK_LABELS: Record<string, string> = { emptying: 'Vaciando el depósito', washing_mop: 'Lavando la mopa', drying: 'Secando la mopa' };

/**
 * Avanza el robot `seconds` segundos: limpia la sala actual y pasa a la siguiente, baja la
 * batería y gasta los consumibles; vuelve a la base al terminar o con poca batería; en la base
 * carga y hace el vaciado y el lavado de la mopa. Determinista.
 */
export function vacuumStep(current: EntityState, ctx: VacuumContext, seconds: number, name = 'El robot'): VacuumStepResult {
  const attrs: Attrs = { ...current.attributes };
  const logs: VacuumStepResult['logs'] = [];
  let state = String(current.state);
  let battery = ctx.battery;
  let finished: VacuumStepResult['finished'];
  const minutes = seconds / 60;

  if (state === 'cleaning') {
    const fan = String(attrs.fan_speed ?? '');
    const drain = (100 / (ctx.caps.runtimeMinutes ?? DEFAULT_VACUUM_RUNTIME)) * (FAN_DRAIN[fan] ?? 1);
    battery = clamp(battery - drain * minutes, 0, 100);
    attrs.cleaning_time = round((num(attrs.cleaning_time) ?? 0) + minutes, 2);
    wearAll(attrs, minutes, ctx);
    let budget = effectiveRate(ctx.caps, ctx.mopMode) * minutes;
    let left = num(attrs.room_left_m2) ?? 0;
    let queue = splitList(attrs.rooms_queue);
    while (budget > 0 && left > 0) {
      const done = Math.min(budget, left);
      budget -= done;
      left = round(left - done, 2);
      attrs.cleaned_area = round((num(attrs.cleaned_area) ?? 0) + done, 2);
      if (left > 0) break;
      const finishedRoom = queue[0];
      if (finishedRoom) logs.push({ level: 'info', message: `${name}: sala «${roomName(ctx, finishedRoom)}» limpia` });
      queue = queue.slice(1);
      const nextRoom = ctx.rooms.find((r) => r.id === queue[0]);
      if (nextRoom) {
        left = nextRoom.areaM2;
        attrs.current_room = nextRoom.id;
        attrs.current_room_name = nextRoom.name;
      }
    }
    attrs.rooms_queue = queue.join(', ');
    attrs.room_left_m2 = left;
    const job = num(attrs.job_area) ?? 0;
    attrs.progress = job > 0 ? Math.min(100, Math.round(((num(attrs.cleaned_area) ?? 0) / job) * 100)) : 100;
    if (left <= 0) {
      finished = { areaM2: round(num(attrs.cleaned_area) ?? 0, 1), minutes: Math.round(num(attrs.cleaning_time) ?? 0) };
      logs.push({ level: 'info', message: `${name} ha terminado de limpiar: ${String(finished.areaM2).replace('.', ',')} m² en ${finished.minutes} min` });
      const home = goHome(current, attrs);
      Object.assign(attrs, home.state.attributes);
      for (const k of ['rooms_queue', 'room_left_m2']) delete attrs[k];
      state = 'returning';
    } else if (battery <= VACUUM_LOW_BATTERY) {
      logs.push({ level: 'warning', message: `${name}: batería baja (${Math.round(battery)} %): vuelve a cargar y seguirá después` });
      Object.assign(attrs, { return_left: VACUUM_RETURN_SECONDS, status: 'Volviendo a cargar', resume_after_charge: true });
      state = 'returning';
    } else {
      attrs.status = `Limpiando: ${String(attrs.current_room_name ?? '')} (${String(attrs.progress)} %)`.replace(': (', ' (');
    }
  } else if (state === 'returning') {
    const left = (num(attrs.return_left) ?? VACUUM_RETURN_SECONDS) - seconds;
    battery = clamp(battery - (100 / (ctx.caps.runtimeMinutes ?? DEFAULT_VACUUM_RUNTIME)) * minutes * 0.5, 0, 100);
    if (left > 0) attrs.return_left = left;
    else {
      delete attrs.return_left;
      state = 'docked';
      if (ctx.homeRoomId) {
        attrs.current_room = ctx.homeRoomId;
        attrs.current_room_name = roomName(ctx, ctx.homeRoomId);
      }
      const phases = attrs.resume_after_charge === true ? [] : dockPhases(ctx, attrs);
      const first = phases[0];
      if (first) {
        attrs.dock_phase = first;
        attrs.dock_phase_left = DOCK_PHASE_SECONDS[first];
        attrs.dock_queue = phases.slice(1).join(', ');
        attrs.status = DOCK_LABELS[first] ?? 'En la base';
      } else attrs.status = attrs.resume_after_charge === true ? 'Cargando para seguir' : 'Cargando';
      logs.push({ level: 'info', message: `${name} ha llegado a la base` });
    }
  } else if (state === 'docked') {
    battery = clamp(battery + VACUUM_CHARGE_PER_MIN * minutes, 0, 100);
    const phase = attrs.dock_phase;
    if (phase === 'emptying' || phase === 'washing_mop' || phase === 'drying') {
      const left = (num(attrs.dock_phase_left) ?? 0) - seconds;
      if (left > 0) attrs.dock_phase_left = left;
      else {
        if (phase === 'emptying') {
          const area = num(attrs.cleaned_area) ?? 0;
          attrs.dust_bag = clamp(Math.round((num(attrs.dust_bag) ?? 10) + Math.max(1, area / 30)), 0, 100);
          logs.push({ level: 'info', message: `${name}: la base ha vaciado el depósito (bolsa al ${String(attrs.dust_bag)} %)` });
          if ((num(attrs.dust_bag) ?? 0) >= 90) logs.push({ level: 'warning', message: `${name}: la bolsa de la base está casi llena, cámbiala` });
        }
        const queue = splitList(attrs.dock_queue);
        const nextPhase = queue[0];
        if (nextPhase === 'emptying' || nextPhase === 'washing_mop' || nextPhase === 'drying') {
          attrs.dock_phase = nextPhase;
          attrs.dock_phase_left = DOCK_PHASE_SECONDS[nextPhase];
          attrs.dock_queue = queue.slice(1).join(', ');
          attrs.status = DOCK_LABELS[nextPhase] ?? 'En la base';
        } else {
          attrs.dock_phase = 'idle';
          delete attrs.dock_phase_left;
          delete attrs.dock_queue;
          attrs.status = battery >= 100 ? 'En la base' : 'Cargando';
        }
      }
    } else if (attrs.resume_after_charge === true && battery >= VACUUM_RESUME_BATTERY) {
      delete attrs.resume_after_charge;
      state = 'cleaning';
      attrs.status = `Limpiando: ${String(attrs.current_room_name ?? '')}`;
      logs.push({ level: 'info', message: `${name}: batería al ${Math.round(battery)} %, retoma la limpieza` });
      const firstRoom = ctx.rooms.find((r) => r.id === splitList(attrs.rooms_queue)[0]);
      if (firstRoom) {
        attrs.current_room = firstRoom.id;
        attrs.current_room_name = firstRoom.name;
      }
    } else attrs.status = battery >= 100 ? 'En la base' : 'Cargando';
  }
  attrs.battery_level = Math.round(battery);
  const vacuum = withState(current, state, attrs);
  const result: VacuumStepResult = { vacuum, battery: round(battery, 2), sensors: vacuumSensors(attrs, ctx), logs };
  if (finished) result.finished = finished;
  const next = vacuumNextDelay(vacuum, battery);
  if (next !== undefined) result.next = next;
  return result;
}

// ---------- Energía ----------

/** Consumo de red del robot (carga y base): limpiando va a batería y no consume de la red. */
export function vacuumMainsWatts(st: EntityState | undefined, battery: number | undefined, caps: EntityCapabilities): number {
  if (!st || st.state !== 'docked') return 0;
  const phase = st.attributes?.dock_phase;
  if (phase === 'emptying' || phase === 'washing_mop' || phase === 'drying') return DOCK_PHASE_WATTS[phase];
  return (battery ?? 100) < 100 ? (caps.powerWatts ?? DEFAULT_CHARGE_WATTS) : 0;
}
