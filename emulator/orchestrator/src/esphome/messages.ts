// Mensajes de la API nativa de ESPHome (api.proto) que usa el emulador: ids, codificación de las
// respuestas del dispositivo y lectura de los comandos del cliente (Home Assistant).
import type { EspCommand, EspEntityPlan, EspNodePlan, EspState } from '../../../../src/bridge/esphome/plan';
import { ProtoWriter, readProto } from './proto';

/** Versión de la API que anuncia el emulador. Por debajo de 1.15 el cliente no pide DeviceCapabilities. */
export const API_VERSION = { major: 1, minor: 14 } as const;
/** Versión de ESPHome que se anuncia (el emulador sigue la API de esa versión). */
export const ESPHOME_VERSION = '2026.9.0';

export const MSG = {
  HelloRequest: 1,
  HelloResponse: 2,
  AuthenticationRequest: 3,
  DisconnectRequest: 5,
  DisconnectResponse: 6,
  PingRequest: 7,
  PingResponse: 8,
  DeviceInfoRequest: 9,
  DeviceInfoResponse: 10,
  ListEntitiesRequest: 11,
  ListEntitiesBinarySensorResponse: 12,
  ListEntitiesLightResponse: 15,
  ListEntitiesSensorResponse: 16,
  ListEntitiesSwitchResponse: 17,
  ListEntitiesTextSensorResponse: 18,
  ListEntitiesDoneResponse: 19,
  SubscribeStatesRequest: 20,
  BinarySensorStateResponse: 21,
  LightStateResponse: 24,
  SensorStateResponse: 25,
  SwitchStateResponse: 26,
  TextSensorStateResponse: 27,
  SubscribeLogsRequest: 28,
  LightCommandRequest: 32,
  SwitchCommandRequest: 33,
  SubscribeHomeassistantServicesRequest: 34,
  GetTimeResponse: 37,
  SubscribeHomeAssistantStatesRequest: 38,
  HomeAssistantStateResponse: 40,
  ListEntitiesNumberResponse: 49,
  NumberStateResponse: 50,
  NumberCommandRequest: 51,
  ListEntitiesSelectResponse: 52,
  SelectStateResponse: 53,
  SelectCommandRequest: 54,
  ListEntitiesButtonResponse: 61,
  ButtonCommandRequest: 62,
  ListEntitiesTextResponse: 97,
  TextStateResponse: 98,
  TextCommandRequest: 99,
} as const;

/** Nombre de un tipo de mensaje para el inspector de tráfico. */
export function messageName(type: number): string {
  for (const [name, id] of Object.entries(MSG)) if (id === type) return name;
  return `Mensaje ${type}`;
}

export type Packet = { type: number; data: Buffer };

export function helloResponse(node: EspNodePlan): Packet {
  const w = new ProtoWriter().uint(1, API_VERSION.major).uint(2, API_VERSION.minor).string(3, `HA Simulator ${ESPHOME_VERSION}`, true).string(4, node.name, true);
  return { type: MSG.HelloResponse, data: w.finish() };
}

export function deviceInfoResponse(node: EspNodePlan): Packet {
  const w = new ProtoWriter()
    .string(2, node.name, true)
    .string(3, node.mac, true)
    .string(4, ESPHOME_VERSION, true)
    .string(5, 'emulado por HA Simulator', true)
    .string(6, `${node.model} (simulado)`, true)
    // Sin project_name (8/9): con él, HA tomaría fabricante y modelo de ahí en vez de 12 y 6.
    .string(12, node.manufacturer, true)
    .string(13, node.friendlyName, true)
    .string(16, node.area, false);
  return { type: MSG.DeviceInfoResponse, data: w.finish() };
}

/** Cabecera común de los ListEntities*: object_id, key y name. */
function base(e: EspEntityPlan): ProtoWriter {
  return new ProtoWriter().string(1, e.objectId, true).fixed32(2, e.key).string(3, e.name, true);
}

export function listEntityPacket(e: EspEntityPlan): Packet {
  switch (e.kind) {
    case 'binary_sensor':
      return { type: MSG.ListEntitiesBinarySensorResponse, data: base(e).string(5, e.deviceClass).finish() };
    case 'sensor':
      return {
        type: MSG.ListEntitiesSensorResponse,
        data: base(e).string(6, e.unit).uint(7, e.accuracyDecimals).string(9, e.deviceClass).uint(10, e.stateClass).finish(),
      };
    case 'switch':
      return { type: MSG.ListEntitiesSwitchResponse, data: base(e).string(9, e.deviceClass === 'outlet' || e.deviceClass === 'switch' ? e.deviceClass : undefined).finish() };
    case 'text_sensor':
      return { type: MSG.ListEntitiesTextSensorResponse, data: base(e).finish() };
    case 'light':
      return {
        type: MSG.ListEntitiesLightResponse,
        data: base(e).float(9, e.minMireds).float(10, e.maxMireds).packed(12, e.colorModes).finish(),
      };
    case 'number':
      return {
        type: MSG.ListEntitiesNumberResponse,
        data: base(e).float(6, e.min ?? 0).float(7, e.max ?? 100).float(8, e.step ?? 1).string(11, e.unit).uint(12, 2).finish(),
      };
    case 'select':
      return { type: MSG.ListEntitiesSelectResponse, data: base(e).strings(6, e.options).finish() };
    case 'button':
      return { type: MSG.ListEntitiesButtonResponse, data: base(e).string(8, e.deviceClass).finish() };
    case 'text':
      return { type: MSG.ListEntitiesTextResponse, data: base(e).uint(8, 0).uint(9, 255).finish() };
    default:
      throw new Error(`Entidad ESPHome sin codificar: ${String(e.kind)}`);
  }
}

export function stateResponse(e: EspEntityPlan, s: EspState): Packet | undefined {
  const w = new ProtoWriter().fixed32(1, e.key);
  switch (e.kind) {
    case 'binary_sensor':
      if (s.type !== 'binary') return undefined;
      return { type: MSG.BinarySensorStateResponse, data: w.bool(2, s.state).bool(3, s.missing).finish() };
    case 'switch':
      if (s.type !== 'binary') return undefined;
      return { type: MSG.SwitchStateResponse, data: w.bool(2, s.state).bool(4, s.missing).finish() };
    case 'sensor':
      if (s.type !== 'float') return undefined;
      return { type: MSG.SensorStateResponse, data: w.float(2, s.state).bool(3, s.missing).finish() };
    case 'number':
      if (s.type !== 'float') return undefined;
      return { type: MSG.NumberStateResponse, data: w.float(2, s.state).bool(3, s.missing).finish() };
    case 'text_sensor':
      if (s.type !== 'text') return undefined;
      return { type: MSG.TextSensorStateResponse, data: w.string(2, s.state).bool(3, s.missing).finish() };
    case 'select':
      if (s.type !== 'text') return undefined;
      return { type: MSG.SelectStateResponse, data: w.string(2, s.state).bool(3, s.missing).finish() };
    case 'text':
      if (s.type !== 'text') return undefined;
      return { type: MSG.TextStateResponse, data: w.string(2, s.state).bool(3, s.missing).finish() };
    case 'light': {
      if (s.type !== 'light') return undefined;
      w.bool(2, s.on).float(3, s.brightness).uint(11, s.colorMode).float(10, s.rgb ? 1 : undefined);
      if (s.rgb) w.float(4, s.rgb[0]).float(5, s.rgb[1]).float(6, s.rgb[2]);
      w.float(8, s.mireds);
      return { type: MSG.LightStateResponse, data: w.finish() };
    }
    default:
      return undefined;
  }
}

/** Lee un comando del cliente; undefined si el tipo no es un comando. */
export function parseCommand(type: number, data: Buffer): EspCommand | undefined {
  const f = readProto(data);
  const key = f.fixed32(1);
  switch (type) {
    case MSG.SwitchCommandRequest:
      return { type: 'switch', key, state: f.bool(2) };
    case MSG.ButtonCommandRequest:
      return { type: 'button', key };
    case MSG.NumberCommandRequest:
      return { type: 'number', key, state: f.float(2) };
    case MSG.SelectCommandRequest:
      return { type: 'select', key, state: f.string(2) };
    case MSG.TextCommandRequest:
      return { type: 'text', key, state: f.string(2) };
    case MSG.LightCommandRequest: {
      const cmd: Extract<EspCommand, { type: 'light' }> = { type: 'light', key };
      if (f.bool(2)) cmd.state = f.bool(3);
      if (f.bool(4)) cmd.brightness = f.float(5);
      if (f.bool(6)) cmd.rgb = [f.float(7), f.float(8), f.float(9)];
      if (f.bool(12)) cmd.mireds = f.float(13);
      return cmd;
    }
    default:
      return undefined;
  }
}
