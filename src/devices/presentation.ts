// Presentación del estado de un dispositivo en la simulación (lógica pura: el lienzo solo pinta).
import type { Device, DeviceDefinition, EntityCapabilities, EntityState, Project, ServiceData, SimulationState } from '../types';
import { kelvinToRgb, parseRgb, rgbToCss } from './color';
import { isDimmable, withDefaults } from './capabilities';
import { entitiesForDevice, type DeviceEntity } from './entities';
import { isInfra } from './roles';
import { callService, entityTimerKey, findTimer } from '../simulation/engine';
import { jamLock, motionPulse, openDoor, pressButton, setLeak } from '../simulation/events';
import { brightnessToPct, coverPosition } from '../simulation/services';

export type DeviceKind =
  | 'light'
  | 'switch'
  | 'motion'
  | 'contact'
  | 'climate_sensor'
  | 'thermostat'
  | 'cover'
  | 'lock'
  | 'camera'
  | 'media'
  | 'vacuum'
  | 'remote'
  | 'leak'
  | 'smoke'
  | 'infrastructure'
  | 'generic';

export interface DeviceViewEntity {
  entityId: string;
  name: string;
  domain: string;
  /** Estado tal cual (normalizado a texto: true → "on"). */
  state: string;
  unit?: string;
}

export interface DeviceView {
  kind: DeviceKind;
  /** Entidad principal (la que manejan la acción principal, la rueda y las teclas). */
  entityId?: string;
  active: boolean;
  unavailable: boolean;
  /** «on · 60 %», «21,5° · 50 %», «19,8° → 21°», «abierta», «45 %»... */
  summary: string;
  secondary?: string;
  brightnessPct?: number;
  /** Color de la luz encendida (de rgb_color o de la temperatura de color). */
  colorCss?: string;
  positionPct?: number;
  moving?: 'up' | 'down';
  volumePct?: number;
  /** Solo si hvac_action = heating. */
  heating?: boolean;
  /** Segundos que faltan para el autoapagado (movimiento) o para terminar un recorrido. */
  countdownSeconds?: number;
  entities: DeviceViewEntity[];
}

export interface ServiceQuickAction {
  entityId: string;
  /** Siempre "dominio.servicio". */
  service: string;
  data?: ServiceData;
  /** Texto para menús y tooltips («Encender», «Subir brillo»...). */
  label: string;
}

export interface StepQuickAction extends ServiceQuickAction {
  data: ServiceData;
}

export type QuickEvent = 'motion' | 'contact' | 'button' | 'leak' | 'smoke' | 'jam';

export interface EventQuickAction {
  event: QuickEvent;
  entityId: string;
  label: string;
}

export type QuickAction = ServiceQuickAction | EventQuickAction;

export function isEventAction(a: QuickAction): a is EventQuickAction {
  return 'event' in a;
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

/** 21.5 → "21,5"; 21 → "21". */
export function formatNumber(n: number, decimals = 1): string {
  return String(Number(n.toFixed(decimals))).replace('.', ',');
}

const stateText = (st: EntityState | undefined): string => {
  if (!st) return 'desconocido';
  return st.state === true ? 'on' : st.state === false ? 'off' : String(st.state);
};

const MOTION_CLASSES = ['motion', 'occupancy', 'presence'];
const CONTACT_CLASSES = ['door', 'window', 'opening', 'garage_door'];
const SMOKE_CLASSES = ['smoke', 'gas', 'carbon_monoxide'];

/** Prioridad de dominio para elegir la entidad principal. */
const DOMAIN_PRIORITY = ['light', 'cover', 'climate', 'lock', 'media_player', 'vacuum', 'fan', 'switch', 'camera', 'binary_sensor'];

function primaryEntity(entities: DeviceEntity[]): DeviceEntity | undefined {
  for (const domain of DOMAIN_PRIORITY) {
    const e = entities.find((x) => x.definition.domain === domain);
    if (e) return e;
  }
  return (
    entities.find((e) => e.definition.key === 'action') ??
    entities.find((e) => e.definition.deviceClass === 'temperature') ??
    entities.find((e) => e.definition.domain === 'sensor' && e.definition.deviceClass !== 'battery') ??
    entities[0]
  );
}

function kindOf(def: DeviceDefinition, entity: DeviceEntity | undefined): DeviceKind {
  if (!entity) return isInfra(def) ? 'infrastructure' : 'generic';
  const { domain, deviceClass = '', key } = entity.definition;
  switch (domain) {
    case 'light':
      return 'light';
    case 'switch':
    case 'fan':
      return 'switch';
    case 'cover':
      return 'cover';
    case 'climate':
      return 'thermostat';
    case 'lock':
      return 'lock';
    case 'camera':
      return 'camera';
    case 'media_player':
      return 'media';
    case 'vacuum':
      return 'vacuum';
    case 'binary_sensor':
      if (MOTION_CLASSES.includes(deviceClass)) return 'motion';
      if (CONTACT_CLASSES.includes(deviceClass)) return 'contact';
      if (deviceClass === 'moisture') return 'leak';
      if (SMOKE_CLASSES.includes(deviceClass)) return 'smoke';
      return 'generic';
    case 'sensor':
      if (key === 'action') return 'remote';
      if (deviceClass === 'temperature' || deviceClass === 'humidity') return 'climate_sensor';
      return 'generic';
    default:
      return 'generic';
  }
}

function lightColor(st: EntityState): string {
  const rgb = st.attributes?.color_mode === 'rgb' ? parseRgb(st.attributes.rgb_color) : undefined;
  if (rgb) return rgbToCss(rgb);
  return rgbToCss(kelvinToRgb(num(st.attributes?.color_temp_kelvin) ?? 2700));
}

function sibling(entities: DeviceEntity[], sim: SimulationState, pred: (e: DeviceEntity) => boolean): EntityState | undefined {
  const e = entities.find(pred);
  return e ? sim.entities[e.entityId] : undefined;
}

function remaining(sim: SimulationState, entityId: string): number | undefined {
  const t = findTimer(sim, entityTimerKey(entityId));
  return t ? Math.max(0, Math.ceil((t.dueAt - sim.now) / 1000)) : undefined;
}

const COVER_LABEL = (pos: number): string => (pos >= 100 ? 'abierta' : pos <= 0 ? 'cerrada' : `${pos} %`);

const LOCK_LABELS: Record<string, string> = {
  locked: 'cerrada con llave',
  unlocked: 'sin llave',
  open: 'abierta',
  jammed: 'atascada',
  locking: 'cerrando',
  unlocking: 'abriendo',
};
const VACUUM_LABELS: Record<string, string> = {
  cleaning: 'limpiando',
  paused: 'en pausa',
  returning: 'volviendo a la base',
  docked: 'en la base',
  idle: 'parada',
  error: 'error',
};
const MEDIA_LABELS: Record<string, string> = { playing: 'reproduciendo', paused: 'en pausa', idle: 'inactivo', on: 'encendido', off: 'apagado' };
const CAMERA_LABELS: Record<string, string> = { idle: 'en reposo', recording: 'grabando', streaming: 'emitiendo', off: 'apagada' };
const HVAC_LABELS: Record<string, string> = { heating: 'calentando', cooling: 'enfriando', idle: 'en reposo', off: 'apagado' };

// ---------- Vista ----------

/** Todo lo que el lienzo necesita para pintar el estado de un dispositivo. */
export function deviceView(device: Device, def: DeviceDefinition, sim: SimulationState): DeviceView {
  const entities = entitiesForDevice(device, def);
  const primary = primaryEntity(entities);
  const kind = kindOf(def, primary);
  const st = primary ? sim.entities[primary.entityId] : undefined;
  const list: DeviceViewEntity[] = entities.map((e) => {
    const item: DeviceViewEntity = {
      entityId: e.entityId,
      name: e.friendlyName,
      domain: e.definition.domain,
      state: stateText(sim.entities[e.entityId]),
    };
    if (e.definition.unit !== undefined) item.unit = e.definition.unit;
    return item;
  });
  const unavailable = st?.state === 'unavailable' || (sim.offline?.[device.id] !== undefined);
  const base: DeviceView = { kind, active: false, unavailable, summary: '', entities: list };
  if (primary) base.entityId = primary.entityId;
  if (unavailable) return { ...base, summary: 'no disponible' };
  if (kind === 'infrastructure') return { ...base, active: true, summary: 'en línea' };
  if (!primary || !st) return { ...base, summary: '—' };

  const caps = withDefaults(primary.definition.domain, primary.definition.capabilities);
  const battery = num(sibling(entities, sim, (e) => e.definition.deviceClass === 'battery')?.state);
  const batteryText = battery === undefined ? undefined : `batería ${Math.round(battery)} %`;
  const s = stateText(st);

  switch (kind) {
    case 'light': {
      const on = s === 'on';
      const view: DeviceView = { ...base, active: on, summary: s };
      if (!on) return view;
      view.colorCss = lightColor(st);
      if (isDimmable(caps)) {
        const pct = brightnessToPct(num(st.attributes?.brightness) ?? 255);
        view.brightnessPct = pct;
        view.summary = `on · ${pct} %`;
      }
      if (st.attributes?.color_mode === 'color_temp' && st.attributes.color_temp_kelvin !== undefined) {
        view.secondary = `${String(st.attributes.color_temp_kelvin)} K`;
      } else if (st.attributes?.color_mode === 'rgb') view.secondary = 'color';
      return view;
    }
    case 'switch': {
      const view: DeviceView = { ...base, active: s === 'on', summary: s };
      const pct = num(st.attributes?.percentage);
      if (primary.definition.domain === 'fan' && s === 'on' && pct !== undefined) view.summary = `on · ${pct} %`;
      const power = num(sibling(entities, sim, (e) => e.definition.deviceClass === 'power')?.state);
      if (power !== undefined && power > 0) view.secondary = `${formatNumber(power)} W`;
      return view;
    }
    case 'motion': {
      const on = s === 'on';
      const view: DeviceView = { ...base, active: on, summary: on ? 'movimiento' : 'sin movimiento' };
      const left = on ? remaining(sim, primary.entityId) : undefined;
      if (left !== undefined) view.countdownSeconds = left;
      const lux = num(sibling(entities, sim, (e) => e.definition.deviceClass === 'illuminance')?.state);
      const secondary = [lux === undefined ? undefined : `${formatNumber(lux, 0)} lx`, batteryText].filter(Boolean).join(' · ');
      if (secondary) view.secondary = secondary;
      return view;
    }
    case 'contact':
      return { ...base, active: s === 'on', summary: s === 'on' ? 'abierta' : 'cerrada', ...(batteryText ? { secondary: batteryText } : {}) };
    case 'leak':
      return { ...base, active: s === 'on', summary: s === 'on' ? 'fuga' : 'seco', ...(batteryText ? { secondary: batteryText } : {}) };
    case 'smoke':
      return { ...base, active: s === 'on', summary: s === 'on' ? 'alarma' : 'normal', ...(batteryText ? { secondary: batteryText } : {}) };
    case 'climate_sensor': {
      const temp = num(sibling(entities, sim, (e) => e.definition.deviceClass === 'temperature')?.state);
      const hum = num(sibling(entities, sim, (e) => e.definition.deviceClass === 'humidity')?.state);
      const parts = [temp === undefined ? undefined : `${formatNumber(temp)}°`, hum === undefined ? undefined : `${formatNumber(hum, 0)} %`];
      const view: DeviceView = { ...base, summary: parts.filter(Boolean).join(' · ') || s };
      if (batteryText) view.secondary = batteryText;
      return view;
    }
    case 'thermostat': {
      const current = num(sibling(entities, sim, (e) => e.definition.deviceClass === 'temperature')?.state) ?? num(st.attributes?.current_temperature);
      const target = num(st.attributes?.temperature);
      const action = String(st.attributes?.hvac_action ?? (s === 'off' ? 'off' : 'idle'));
      const heating = action === 'heating';
      const summary =
        s === 'off'
          ? `${current === undefined ? '' : `${formatNumber(current)}° · `}apagado`
          : `${current === undefined ? '—' : `${formatNumber(current)}°`} → ${target === undefined ? '—' : `${formatNumber(target)}°`}`;
      const preset = st.attributes?.preset_mode;
      const secondary = [HVAC_LABELS[action] ?? action, s === 'off' ? undefined : s, preset === undefined ? undefined : String(preset)].filter(Boolean).join(' · ');
      return { ...base, active: heating || action === 'cooling', heating, summary, secondary };
    }
    case 'cover': {
      const pos = coverPosition(st);
      const moving = s === 'opening' ? 'up' : s === 'closing' ? 'down' : undefined;
      const view: DeviceView = { ...base, active: pos > 0 || moving !== undefined, positionPct: pos, summary: COVER_LABEL(pos) };
      if (moving) {
        view.moving = moving;
        view.summary = `${moving === 'up' ? 'subiendo' : 'bajando'} · ${pos} %`;
      }
      return view;
    }
    case 'lock':
      return { ...base, active: s !== 'locked', summary: LOCK_LABELS[s] ?? s, ...(batteryText ? { secondary: batteryText } : {}) };
    case 'camera': {
      const motion = sibling(entities, sim, (e) => e.definition.domain === 'binary_sensor' && MOTION_CLASSES.includes(e.definition.deviceClass ?? ''));
      const view: DeviceView = { ...base, active: s === 'recording' || s === 'streaming' || motion?.state === 'on', summary: CAMERA_LABELS[s] ?? s };
      if (motion?.state === 'on') view.secondary = 'movimiento';
      return view;
    }
    case 'media': {
      const vol = num(st.attributes?.volume_level);
      const muted = st.attributes?.is_volume_muted === true;
      const view: DeviceView = { ...base, active: s === 'playing' || s === 'on', summary: MEDIA_LABELS[s] ?? s };
      if (s !== 'off' && vol !== undefined) {
        view.volumePct = Math.round(vol * 100);
        view.summary = `${view.summary} · ${muted ? 'silencio' : `${view.volumePct} %`}`;
      }
      if (s !== 'off' && st.attributes?.source !== undefined) view.secondary = String(st.attributes.source);
      return view;
    }
    case 'vacuum': {
      const view: DeviceView = { ...base, active: s === 'cleaning' || s === 'returning', summary: VACUUM_LABELS[s] ?? s };
      const left = s === 'returning' ? remaining(sim, primary.entityId) : undefined;
      if (left !== undefined) view.countdownSeconds = left;
      if (batteryText) view.secondary = batteryText;
      return view;
    }
    case 'remote': {
      const view: DeviceView = { ...base, summary: s === 'none' || s === '' ? 'en espera' : s };
      if (batteryText) view.secondary = batteryText;
      return view;
    }
    default:
      return { ...base, active: s === 'on', summary: primary.definition.unit ? `${s} ${primary.definition.unit}` : s };
  }
}

// ---------- Acciones rápidas ----------

function svc(entityId: string, service: string, label: string, data?: ServiceData): ServiceQuickAction {
  return data ? { entityId, service, data, label } : { entityId, service, label };
}

const onOffLabel = (on: boolean): string => (on ? 'Apagar' : 'Encender');

function primaryOf(device: Device, def: DeviceDefinition, sim: SimulationState) {
  const entities = entitiesForDevice(device, def);
  const entity = primaryEntity(entities);
  const view = deviceView(device, def, sim);
  const st = entity ? sim.entities[entity.entityId] : undefined;
  const caps: EntityCapabilities = entity ? withDefaults(entity.definition.domain, entity.definition.capabilities) : {};
  return { entity, view, st, caps };
}

/** Acción principal (clic en modo Uso, ⏻, Espacio/Intro). null si no tiene. */
export function primaryAction(device: Device, def: DeviceDefinition, sim: SimulationState): QuickAction | null {
  const { entity, view, st } = primaryOf(device, def, sim);
  if (!entity || !st || view.unavailable) return null;
  const id = entity.entityId;
  const s = stateText(st);
  switch (view.kind) {
    case 'light':
      return svc(id, 'light.toggle', onOffLabel(s === 'on'));
    case 'switch':
      return svc(id, `${entity.definition.domain}.toggle`, onOffLabel(s === 'on'));
    case 'cover':
      return svc(id, 'cover.toggle', view.moving ? 'Detener' : coverPosition(st) > 0 ? 'Cerrar' : 'Abrir');
    case 'thermostat':
      return s === 'off' ? svc(id, 'climate.turn_on', 'Encender') : svc(id, 'climate.turn_off', 'Apagar');
    case 'lock':
      return s === 'locked' ? svc(id, 'lock.unlock', 'Quitar llave') : svc(id, 'lock.lock', 'Echar la llave');
    case 'media':
      if (s === 'off') return svc(id, 'media_player.turn_on', 'Encender');
      return svc(id, 'media_player.media_play_pause', s === 'playing' ? 'Pausar' : 'Reproducir');
    case 'vacuum':
      return s === 'cleaning' ? svc(id, 'vacuum.pause', 'Pausar limpieza') : svc(id, 'vacuum.start', 'Empezar a limpiar');
    case 'motion':
      return { event: 'motion', entityId: id, label: 'Simular movimiento' };
    case 'contact':
      return { event: 'contact', entityId: id, label: s === 'on' ? 'Cerrar' : 'Abrir' };
    case 'leak':
      return { event: 'leak', entityId: id, label: s === 'on' ? 'Secar' : 'Simular fuga' };
    case 'smoke':
      return { event: 'smoke', entityId: id, label: s === 'on' ? 'Silenciar alarma' : 'Simular humo' };
    case 'remote':
      return { event: 'button', entityId: id, label: 'Pulsar' };
    default:
      return null;
  }
}

const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));

/** Rueda y ↑/↓: ±10 % de brillo, posición, volumen o velocidad; ± un paso (0,5 °C) de consigna. */
export function stepAction(device: Device, def: DeviceDefinition, sim: SimulationState, direction: 1 | -1): StepQuickAction | null {
  const { entity, view, st, caps } = primaryOf(device, def, sim);
  if (!entity || !st || view.unavailable) return null;
  const id = entity.entityId;
  const up = direction === 1;
  const step = (service: string, label: string, data: ServiceData): StepQuickAction => ({ entityId: id, service, data, label });
  switch (view.kind) {
    case 'light':
      return isDimmable(caps) ? step('light.turn_on', up ? 'Subir brillo' : 'Bajar brillo', { brightness_step_pct: 10 * direction }) : null;
    case 'cover':
      return step('cover.set_cover_position', up ? 'Subir 10 %' : 'Bajar 10 %', { position: clamp(coverPosition(st) + 10 * direction, 0, 100) });
    case 'media': {
      const vol = num(st.attributes?.volume_level) ?? 0;
      return step('media_player.volume_set', up ? 'Subir volumen' : 'Bajar volumen', { volume_level: clamp(Math.round(vol * 10 + direction) / 10, 0, 1) });
    }
    case 'thermostat': {
      const inc = caps.tempStep ?? 0.5;
      const target = num(st.attributes?.temperature) ?? 21;
      const next = clamp(target + inc * direction, caps.minTemp ?? 7, caps.maxTemp ?? 35);
      return step('climate.set_temperature', `${up ? 'Subir' : 'Bajar'} consigna (${formatNumber(next)}°)`, { temperature: Number(next.toFixed(2)) });
    }
    case 'switch': {
      if (entity.definition.domain !== 'fan') return null;
      const pct = num(st.attributes?.percentage) ?? 0;
      return step('fan.set_percentage', up ? 'Más velocidad' : 'Menos velocidad', { percentage: clamp(pct + 10 * direction, 0, 100) });
    }
    default:
      return null;
  }
}

/** Teclas 1-9 (10-90 %) y 0 (apagar / cerrar). */
export function setLevelAction(device: Device, def: DeviceDefinition, sim: SimulationState, pct: number): ServiceQuickAction | null {
  const { entity, view, st, caps } = primaryOf(device, def, sim);
  if (!entity || !st || view.unavailable) return null;
  const id = entity.entityId;
  const level = clamp(Math.round(pct), 0, 100);
  switch (view.kind) {
    case 'light':
      if (level === 0) return svc(id, 'light.turn_off', 'Apagar');
      return isDimmable(caps) ? svc(id, 'light.turn_on', `Brillo ${level} %`, { brightness_pct: level }) : svc(id, 'light.turn_on', 'Encender');
    case 'switch':
      if (entity.definition.domain === 'fan') return svc(id, 'fan.set_percentage', `Velocidad ${level} %`, { percentage: level });
      return level === 0 ? svc(id, 'switch.turn_off', 'Apagar') : svc(id, 'switch.turn_on', 'Encender');
    case 'cover':
      return svc(id, 'cover.set_cover_position', `Posición ${level} %`, { position: level });
    case 'media':
      return level === 0 ? svc(id, 'media_player.turn_off', 'Apagar') : svc(id, 'media_player.volume_set', `Volumen ${level} %`, { volume_level: level / 100 });
    case 'thermostat':
      return level === 0 ? svc(id, 'climate.turn_off', 'Apagar') : null;
    default:
      return null;
  }
}

/** Ejecuta una acción rápida sobre el motor (servicio o evento físico). */
export function applyQuickAction(sim: SimulationState, project: Project, action: QuickAction): SimulationState {
  if (!isEventAction(action)) return callService(sim, project, action.entityId, action.service, action.data);
  const on = sim.entities[action.entityId]?.state === 'on';
  switch (action.event) {
    case 'motion':
      return motionPulse(sim, project, action.entityId);
    case 'contact':
      return openDoor(sim, project, action.entityId, !on);
    case 'leak':
    case 'smoke':
      return setLeak(sim, project, action.entityId, !on);
    case 'button':
      return pressButton(sim, project, action.entityId, 'single');
    case 'jam':
      return jamLock(sim, project, action.entityId);
  }
}

// ---------- Iconos ----------

const CLASS_ICONS: Record<string, string> = {
  motion: '🏃',
  occupancy: '🧍',
  presence: '🧍',
  door: '🚪',
  window: '🪟',
  opening: '🚪',
  garage_door: '🚪',
  moisture: '💧',
  smoke: '🔥',
  gas: '🔥',
  carbon_monoxide: '🔥',
  temperature: '🌡️',
  humidity: '🌡️',
  illuminance: '☀️',
};

const CATEGORY_ICONS: Record<DeviceDefinition['category'], string> = {
  light: '💡',
  plug: '🔌',
  switch: '🎚️',
  sensor: '📟',
  climate: '♨️',
  cover: '🪟',
  lock: '🔒',
  camera: '📷',
  speaker: '🔊',
  display: '📺',
  vacuum: '🧹',
  hub: '🛰️',
  network: '📶',
  server: '🏠',
};

/**
 * Icono (emoji) del dispositivo o de una de sus entidades: distingue movimiento, puerta,
 * temperatura, fuga, humo, mando y relé aunque compartan categoría (C9).
 */
export function deviceIcon(def: DeviceDefinition, entityDeviceClass?: string): string {
  const cls = entityDeviceClass ?? primaryEntityDefinition(def)?.deviceClass;
  if (cls !== undefined && CLASS_ICONS[cls]) return CLASS_ICONS[cls];
  if (def.entities.some((e) => e.key === 'action')) return '🎛️';
  if (def.role === 'coordinator') return '📡';
  if (def.category === 'cover') return '🪟';
  if (def.category === 'switch' && def.entities.some((e) => e.domain === 'switch')) return '🎚️';
  return CATEGORY_ICONS[def.category];
}

function primaryEntityDefinition(def: DeviceDefinition) {
  for (const domain of DOMAIN_PRIORITY) {
    const e = def.entities.find((x) => x.domain === domain);
    if (e) return e;
  }
  return def.entities.find((e) => e.key === 'action') ?? def.entities.find((e) => e.deviceClass === 'temperature') ?? def.entities[0];
}
