// Comandos MQTT de HA (topics /set) → llamadas a servicio del simulador. Funciones puras.
import type { ServiceData, ServiceDataValue } from '../../types';
import type { BridgeDevice, BridgeEntity, BridgeModel } from './model';
import { miredToKelvin, xyToRgb } from './color';

export interface BridgeCommand {
  entityId: string;
  /** "dominio.servicio" */
  service: string;
  data: ServiceData;
}

type Obj = Record<string, unknown>;

const numberOf = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

function parseJson(payload: string): Obj | undefined {
  try {
    const v: unknown = JSON.parse(payload);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : undefined;
  } catch {
    return undefined;
  }
}

const cmd = (entityId: string, service: string, data: ServiceData = {}): BridgeCommand => ({ entityId, service, data });

/** Comando JSON de una luz (esquema json de HA y Z2M) → light.turn_on / light.turn_off. */
function lightCommand(e: BridgeEntity, body: Obj, profile: 'z2m' | 'generic', suffix = ''): BridgeCommand | null {
  const key = (k: string): string => `${k}${suffix}`;
  const state = typeof body[key('state')] === 'string' ? String(body[key('state')]).toUpperCase() : undefined;
  if (state === 'OFF') return cmd(e.entityId, 'light.turn_off');
  if (state === 'TOGGLE') return cmd(e.entityId, 'light.toggle');
  const data: Record<string, ServiceDataValue> = {};
  const b = numberOf(body[key('brightness')]);
  if (b !== undefined) data.brightness = profile === 'z2m' ? Math.round((Math.max(0, Math.min(254, b)) * 255) / 254) : Math.round(Math.max(0, Math.min(255, b)));
  const ct = numberOf(body[key('color_temp')]);
  if (ct !== undefined && ct > 0) data.color_temp_kelvin = miredToKelvin(ct);
  const color = body[key('color')];
  if (typeof color === 'object' && color !== null) {
    const c = color as Obj;
    const r = numberOf(c.r);
    const g = numberOf(c.g);
    const bl = numberOf(c.b);
    const x = numberOf(c.x);
    const y = numberOf(c.y);
    if (r !== undefined && g !== undefined && bl !== undefined) data.rgb_color = [r, g, bl];
    else if (x !== undefined && y !== undefined) data.rgb_color = xyToRgb(x, y);
  }
  const transition = numberOf(body.transition);
  if (transition !== undefined) data.transition = transition;
  if (state !== 'ON' && Object.keys(data).length === 0) return null;
  return cmd(e.entityId, 'light.turn_on', data);
}

const onOffService = (domain: string, payload: string): string | undefined => {
  const p = payload.trim().toUpperCase();
  if (p === 'ON') return `${domain}.turn_on`;
  if (p === 'OFF') return `${domain}.turn_off`;
  if (p === 'TOGGLE') return `${domain}.toggle`;
  return undefined;
};

const VACUUM: Record<string, string> = {
  start: 'vacuum.start',
  pause: 'vacuum.pause',
  stop: 'vacuum.stop',
  return_to_base: 'vacuum.return_to_base',
  locate: 'vacuum.locate',
  clean_spot: 'vacuum.clean_spot',
};

const ALARM: Record<string, string> = {
  ARM_HOME: 'alarm_control_panel.alarm_arm_home',
  ARM_AWAY: 'alarm_control_panel.alarm_arm_away',
  ARM_NIGHT: 'alarm_control_panel.alarm_arm_night',
  ARM_VACATION: 'alarm_control_panel.alarm_arm_vacation',
  ARM_CUSTOM_BYPASS: 'alarm_control_panel.alarm_arm_custom_bypass',
  DISARM: 'alarm_control_panel.alarm_disarm',
  TRIGGER: 'alarm_control_panel.alarm_trigger',
};

/** Comando del perfil genérico para una entidad y un subtopic ('' = /set directo). */
function genericCommand(e: BridgeEntity, sub: string, payload: string): BridgeCommand | null {
  const raw = payload.trim();
  switch (e.domain) {
    case 'light': {
      const body = parseJson(raw) ?? { state: raw };
      return lightCommand(e, body, 'generic');
    }
    case 'switch': {
      const s = onOffService('switch', raw);
      return s ? cmd(e.entityId, s) : null;
    }
    case 'fan': {
      if (sub === 'percentage') {
        const n = numberOf(raw);
        return n === undefined ? null : cmd(e.entityId, 'fan.set_percentage', { percentage: n });
      }
      const s = onOffService('fan', raw);
      return s ? cmd(e.entityId, s) : null;
    }
    case 'cover': {
      if (sub === 'position') {
        const n = numberOf(raw);
        return n === undefined ? null : cmd(e.entityId, 'cover.set_cover_position', { position: n });
      }
      const p = raw.toUpperCase();
      if (p === 'OPEN') return cmd(e.entityId, 'cover.open_cover');
      if (p === 'CLOSE') return cmd(e.entityId, 'cover.close_cover');
      if (p === 'STOP') return cmd(e.entityId, 'cover.stop_cover');
      return null;
    }
    case 'climate': {
      if (sub === 'mode') return raw === '' ? null : cmd(e.entityId, 'climate.set_hvac_mode', { hvac_mode: raw });
      if (sub === 'temperature') {
        const n = numberOf(raw);
        return n === undefined ? null : cmd(e.entityId, 'climate.set_temperature', { temperature: n });
      }
      if (sub === 'preset') return raw === '' ? null : cmd(e.entityId, 'climate.set_preset_mode', { preset_mode: raw });
      return null;
    }
    case 'lock': {
      const p = raw.toUpperCase();
      if (p === 'LOCK') return cmd(e.entityId, 'lock.lock');
      if (p === 'UNLOCK') return cmd(e.entityId, 'lock.unlock');
      if (p === 'OPEN') return cmd(e.entityId, 'lock.open');
      return null;
    }
    case 'media_player': {
      if (sub === 'power') {
        const s = onOffService('media_player', raw);
        return s ? cmd(e.entityId, s) : null;
      }
      if (sub === 'volume') {
        const n = numberOf(raw);
        return n === undefined ? null : cmd(e.entityId, 'media_player.volume_set', { volume_level: Math.max(0, Math.min(100, n)) / 100 });
      }
      if (sub === 'source') return raw === '' ? null : cmd(e.entityId, 'media_player.select_source', { source: raw });
      return null;
    }
    case 'vacuum': {
      const s = VACUUM[raw.toLowerCase()];
      return s ? cmd(e.entityId, s) : null;
    }
    case 'button':
      return raw.toUpperCase() === 'PRESS' ? cmd(e.entityId, 'button.press') : null;
    case 'siren': {
      const s = onOffService('siren', raw);
      return s ? cmd(e.entityId, s) : null;
    }
    case 'valve': {
      const p = raw.toUpperCase();
      if (p === 'OPEN') return cmd(e.entityId, 'valve.open_valve');
      if (p === 'CLOSE') return cmd(e.entityId, 'valve.close_valve');
      if (p === 'STOP') return cmd(e.entityId, 'valve.stop_valve');
      return null;
    }
    case 'alarm_control_panel': {
      const body = parseJson(raw) ?? { action: raw };
      const action = typeof body.action === 'string' ? body.action.toUpperCase() : '';
      const service = ALARM[action];
      if (!service) return null;
      const code = typeof body.code === 'string' && body.code !== '' && body.code !== 'None' ? body.code : undefined;
      return cmd(e.entityId, service, code === undefined ? {} : { code });
    }
    default:
      return null;
  }
}

/** Valores de un /set de Z2M: JSON, o texto que equivale a {state: texto}; /set/<prop> → {prop: texto}. */
function z2mBody(prop: string | undefined, payload: string): Obj {
  const raw = payload.trim();
  if (prop !== undefined) {
    const n = numberOf(raw);
    const parsed = parseJson(raw);
    return { [prop]: parsed ?? n ?? raw };
  }
  return parseJson(raw) ?? { state: raw };
}

/** Comandos de un /set de Z2M sobre un dispositivo (un JSON puede tocar varias entidades). */
function z2mCommands(bdev: BridgeDevice, body: Obj): BridgeCommand[] {
  const out: BridgeCommand[] = [];
  for (const e of bdev.entities) {
    const p = e.property;
    switch (e.domain) {
      case 'light': {
        const m = /_l\d+$/.exec(p);
        const suffix = m ? m[0] : '';
        const touches = ['state', 'brightness', 'color_temp', 'color'].some((k) => body[`${k}${suffix}`] !== undefined);
        if (!touches) break;
        const c = lightCommand(e, body, 'z2m', suffix);
        if (c) out.push(c);
        break;
      }
      case 'switch': {
        const v = body[p];
        const s = typeof v === 'string' ? onOffService('switch', v) : undefined;
        if (s) out.push(cmd(e.entityId, s));
        break;
      }
      case 'cover': {
        const pos = numberOf(body.position);
        if (pos !== undefined) out.push(cmd(e.entityId, 'cover.set_cover_position', { position: pos }));
        const st = typeof body.state === 'string' ? body.state.toUpperCase() : undefined;
        if (st === 'OPEN') out.push(cmd(e.entityId, 'cover.open_cover'));
        else if (st === 'CLOSE') out.push(cmd(e.entityId, 'cover.close_cover'));
        else if (st === 'STOP') out.push(cmd(e.entityId, 'cover.stop_cover'));
        break;
      }
      case 'climate': {
        if (typeof body.system_mode === 'string') out.push(cmd(e.entityId, 'climate.set_hvac_mode', { hvac_mode: body.system_mode }));
        const t = numberOf(body.occupied_heating_setpoint);
        if (t !== undefined) out.push(cmd(e.entityId, 'climate.set_temperature', { temperature: t }));
        if (typeof body.preset === 'string') out.push(cmd(e.entityId, 'climate.set_preset_mode', { preset_mode: body.preset }));
        break;
      }
      case 'lock': {
        const st = typeof body.state === 'string' ? body.state.toUpperCase() : undefined;
        if (st === 'LOCK') out.push(cmd(e.entityId, 'lock.lock'));
        else if (st === 'UNLOCK') out.push(cmd(e.entityId, 'lock.unlock'));
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** Índice topic → destino de los comandos del modelo. */
export interface CommandIndex {
  parse: (topic: string, payload: string) => BridgeCommand[] | null;
  /** Dispositivo al que pertenece un topic del lab (para el inspector de tráfico). */
  deviceOf: (topic: string) => string | undefined;
}

/**
 * Crea el intérprete de comandos del modelo: `(topic, payload)` → llamadas a servicio, o null si
 * el topic no es un comando del lab. Un /set de Z2M puede producir varias llamadas.
 */
export function createCommandParser(model: BridgeModel): CommandIndex {
  const generic = new Map<string, BridgeEntity>();
  const genericDevice = new Map<string, string>();
  const z2m = new Map<string, BridgeDevice>();
  for (const bdev of model.devices) {
    if (bdev.profile === 'z2m') z2m.set(bdev.friendlyName, bdev);
    else
      for (const e of bdev.entities) {
        generic.set(e.commandTopic, e);
        genericDevice.set(e.commandTopic, bdev.device.id);
      }
  }
  const base = `${model.settings.baseTopic}/`;
  const z2mBase = `${model.settings.z2mBaseTopic}/`;

  const parse = (topic: string, payload: string): BridgeCommand[] | null => {
    if (topic.startsWith(z2mBase)) {
      const rest = topic.slice(z2mBase.length);
      const m = /^(.+?)\/set(?:\/([^/]+))?$/.exec(rest);
      if (!m?.[1]) return null;
      const bdev = z2m.get(m[1]);
      if (!bdev) return null;
      return z2mCommands(bdev, z2mBody(m[2], payload));
    }
    if (topic.startsWith(base) && topic.endsWith('/set')) {
      const stem = topic.slice(0, -'/set'.length);
      const direct = generic.get(stem);
      if (direct) {
        const c = genericCommand(direct, '', payload);
        return c ? [c] : [];
      }
      const slash = stem.lastIndexOf('/');
      const owner = generic.get(stem.slice(0, slash));
      if (owner) {
        const c = genericCommand(owner, stem.slice(slash + 1), payload);
        return c ? [c] : [];
      }
    }
    return null;
  };

  const deviceOf = (topic: string): string | undefined => {
    if (topic.startsWith(z2mBase)) {
      const name = topic.slice(z2mBase.length).split('/')[0] ?? '';
      return z2m.get(name)?.device.id;
    }
    if (topic.startsWith(base)) {
      for (const bdev of model.devices) {
        if (bdev.profile === 'generic' && (topic === bdev.availabilityTopic || bdev.entities.some((e) => topic.startsWith(`${e.stateTopic}`)))) return bdev.device.id;
      }
      return undefined;
    }
    const prefix = `${model.settings.discoveryPrefix}/`;
    if (topic.startsWith(prefix)) {
      for (const bdev of model.devices) if (topic.includes(`/${bdev.nodeId}/`) || topic.includes(`/${bdev.ieee}/`)) return bdev.device.id;
    }
    return undefined;
  };

  return { parse, deviceOf };
}

/** Atajo: interpreta un único mensaje con el modelo dado. */
export function commandFromMqtt(model: BridgeModel, topic: string, payload: string): BridgeCommand[] | null {
  return createCommandParser(model).parse(topic, payload);
}
