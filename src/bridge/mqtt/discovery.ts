// MQTT discovery de HA para el proyecto: perfil Zigbee2MQTT emulado y perfil genérico por
// dispositivo (homeassistant/device/<id>/config). Funciones puras.
//
// media_player y camera no existen como plataformas MQTT de HA: el reproductor se publica como
// sensor (estado) + switch (encendido) + number (volumen) + select (fuente), y la cámara como un
// sensor de estado. Sus entity_id en HA llevan un sufijo (_state, _power, _volume, _source).
import {
  z2mBridgeIdentifier,
  z2mDeviceIdentifier,
  type BridgeDevice,
  type BridgeEntity,
  type BridgeModel,
  type MqttMessage,
} from './model';
import { stableJson, supportedColorModes, type Fields } from './state';
import { kelvinToMired } from './color';
import type { AssistantInfo } from '../../types';

type Json = Fields[string];

export const ORIGIN_NAME = 'HA Simulator';
export const SIMULATED_VERSION = 'simulado';
/** Aviso en el hw_version del dispositivo: la radio no es real. */
export const RADIO_NOTE = 'Radio: modelada, no real';

const ORIGIN: Fields = { name: ORIGIN_NAME, sw_version: SIMULATED_VERSION };

/** Componentes de un dispositivo: object_id → configuración del componente. */
type Components = Record<string, Fields>;

/** Parte de objeto de un entity_id ("light.salon" → "salon"). */
function objectPart(entityId: string): string {
  const dot = entityId.indexOf('.');
  return dot === -1 ? entityId : entityId.slice(dot + 1);
}

const tpl = (path: string): string => `{{ value_json.${path} }}`;

function sensorExtras(e: BridgeEntity): Fields {
  const f: Fields = {};
  const d = e.definition;
  if (d.unit !== undefined) f.unit_of_measurement = d.unit;
  if (d.deviceClass !== undefined) f.device_class = d.deviceClass;
  const numeric = typeof d.initialState === 'number';
  if (numeric) f.state_class = d.deviceClass === 'energy' ? 'total_increasing' : 'measurement';
  if (d.deviceClass === 'battery') f.entity_category = 'diagnostic';
  return f;
}

function lightExtras(e: BridgeEntity, profile: 'z2m' | 'generic'): Fields {
  const modes = supportedColorModes(e, profile);
  const f: Fields = { schema: 'json', supported_color_modes: modes };
  if (!modes.includes('onoff')) {
    f.brightness = true;
    f.brightness_scale = profile === 'z2m' ? 254 : 255;
  } else f.brightness = false;
  if (modes.includes('color_temp')) {
    f.min_mireds = kelvinToMired(e.caps.maxKelvin ?? 6500);
    f.max_mireds = kelvinToMired(e.caps.minKelvin ?? 2000);
  }
  return f;
}

function climateExtras(e: BridgeEntity): Fields {
  const f: Fields = {
    modes: e.caps.hvacModes ?? ['off', 'heat'],
    temperature_unit: 'C',
  };
  if (e.caps.minTemp !== undefined) f.min_temp = e.caps.minTemp;
  if (e.caps.maxTemp !== undefined) f.max_temp = e.caps.maxTemp;
  if (e.caps.tempStep !== undefined) f.temp_step = e.caps.tempStep;
  return f;
}

function presetModes(e: BridgeEntity): string[] {
  return (e.caps.presetModes ?? []).filter((p) => p !== 'none');
}

/**
 * Componentes del perfil genérico de una entidad (normalmente uno; el reproductor, varios).
 * `assistant`: el reproductor de un altavoz inteligente lleva además un notify para anuncios.
 */
function genericComponents(e: BridgeEntity, assistant?: AssistantInfo): Components {
  const t = e.stateTopic;
  const base: Fields = { unique_id: e.uniqueId, default_entity_id: e.entityId, name: e.name };
  switch (e.domain) {
    case 'light':
      return { [e.key]: { p: 'light', ...base, ...lightExtras(e, 'generic'), state_topic: t, command_topic: `${t}/set` } };
    case 'switch':
      return { [e.key]: { p: 'switch', ...base, state_topic: t, value_template: tpl('state'), command_topic: `${t}/set`, payload_on: 'ON', payload_off: 'OFF' } };
    case 'binary_sensor':
      return {
        [e.key]: {
          p: 'binary_sensor',
          ...base,
          state_topic: t,
          value_template: tpl('state'),
          payload_on: 'ON',
          payload_off: 'OFF',
          ...(e.definition.deviceClass ? { device_class: e.definition.deviceClass } : {}),
        },
      };
    case 'sensor':
      return { [e.key]: { p: 'sensor', ...base, state_topic: t, value_template: tpl('state'), ...sensorExtras(e) } };
    case 'cover':
      return {
        [e.key]: {
          p: 'cover',
          ...base,
          state_topic: t,
          value_template: tpl('state'),
          state_open: 'open',
          state_closed: 'closed',
          state_opening: 'opening',
          state_closing: 'closing',
          state_stopped: 'stopped',
          command_topic: `${t}/set`,
          position_topic: t,
          position_template: tpl('position'),
          set_position_topic: `${t}/position/set`,
          ...(e.definition.deviceClass ? { device_class: e.definition.deviceClass } : {}),
        },
      };
    case 'climate': {
      const presets = presetModes(e);
      return {
        [e.key]: {
          p: 'climate',
          ...base,
          ...climateExtras(e),
          mode_state_topic: t,
          mode_state_template: tpl('mode'),
          mode_command_topic: `${t}/mode/set`,
          temperature_state_topic: t,
          temperature_state_template: tpl('temperature'),
          temperature_command_topic: `${t}/temperature/set`,
          current_temperature_topic: t,
          current_temperature_template: tpl('current_temperature'),
          action_topic: t,
          action_template: "{{ value_json.action | default('idle') }}",
          ...(presets.length > 0
            ? {
                preset_modes: presets,
                preset_mode_state_topic: t,
                preset_mode_value_template: "{{ value_json.preset | default('none') }}",
                preset_mode_command_topic: `${t}/preset/set`,
              }
            : {}),
        },
      };
    }
    case 'lock':
      return { [e.key]: { p: 'lock', ...base, state_topic: t, value_template: tpl('state'), command_topic: `${t}/set`, payload_lock: 'LOCK', payload_unlock: 'UNLOCK', payload_open: 'OPEN' } };
    case 'fan':
      return {
        [e.key]: {
          p: 'fan',
          ...base,
          state_topic: t,
          state_value_template: tpl('state'),
          command_topic: `${t}/set`,
          payload_on: 'ON',
          payload_off: 'OFF',
          percentage_state_topic: t,
          percentage_value_template: "{{ value_json.percentage | default(0) }}",
          percentage_command_topic: `${t}/percentage/set`,
        },
      };
    case 'vacuum': {
      // Esquema state de MQTT: JSON {state, fan_speed}; la batería va en su propio sensor (HA ya no
      // admite battery_level en el vacuum MQTT). Los atributos (sala, error...) por json_attributes.
      const speeds = e.caps.fanSpeeds ?? [];
      const features = ['start', 'pause', 'stop', 'return_home', 'status', 'locate', 'clean_spot', 'send_command'];
      if (speeds.length > 0) features.push('fan_speed');
      return {
        [e.key]: {
          p: 'vacuum',
          ...base,
          state_topic: t,
          command_topic: `${t}/set`,
          send_command_topic: `${t}/command/set`,
          json_attributes_topic: t,
          json_attributes_template: '{{ value_json.attributes | tojson }}',
          supported_features: features,
          ...(speeds.length > 0 ? { set_fan_speed_topic: `${t}/fan_speed/set`, fan_speed_list: speeds } : {}),
        },
      };
    }
    case 'select':
      return {
        [e.key]: { p: 'select', ...base, state_topic: t, value_template: tpl('state'), command_topic: `${t}/set`, options: e.caps.options ?? [] },
      };
    case 'assist_satellite': {
      // assist_satellite no existe en MQTT: sensor de estado + notify para los anuncios.
      const obj = objectPart(e.entityId);
      const label = (suffix: string): string => (e.name ? `${e.name} · ${suffix}` : suffix);
      return {
        [`${e.key}_state`]: { p: 'sensor', unique_id: `${e.uniqueId}_state`, default_entity_id: `sensor.${obj}_state`, name: label('Estado'), state_topic: t, value_template: tpl('state'), device_class: 'enum', options: ['idle', 'listening', 'processing', 'responding'] },
        [`${e.key}_announce`]: { p: 'notify', unique_id: `${e.uniqueId}_announce`, default_entity_id: `notify.${obj}_announce`, name: label('Anuncio'), command_topic: `${t}/announce/set` },
      };
    }
    case 'button':
      return { [e.key]: { p: 'button', ...base, command_topic: `${t}/set`, payload_press: 'PRESS' } };
    case 'siren':
      return { [e.key]: { p: 'siren', ...base, state_topic: t, state_value_template: tpl('state'), command_topic: `${t}/set`, payload_on: 'ON', payload_off: 'OFF' } };
    case 'valve':
      return {
        [e.key]: {
          p: 'valve',
          ...base,
          state_topic: t,
          value_template: tpl('state'),
          command_topic: `${t}/set`,
          payload_open: 'OPEN',
          payload_close: 'CLOSE',
          payload_stop: 'STOP',
          state_open: 'open',
          state_closed: 'closed',
          state_opening: 'opening',
          state_closing: 'closing',
          reports_position: false,
        },
      };
    case 'alarm_control_panel': {
      // El código lo comprueba el simulador: HA lo pide y lo manda en el comando (REMOTE_CODE).
      const modes = e.caps.alarmModes ?? ['armed_home', 'armed_away'];
      return {
        [e.key]: {
          p: 'alarm_control_panel',
          ...base,
          state_topic: t,
          value_template: tpl('state'),
          command_topic: `${t}/set`,
          command_template: '{"action": "{{ action }}", "code": "{{ code }}"}',
          code: 'REMOTE_CODE',
          code_arm_required: e.caps.codeArmRequired === true,
          code_disarm_required: true,
          supported_features: [...modes.map((m) => m.replace(/^armed_/, 'arm_')), 'trigger'],
        },
      };
    }
    case 'media_player': {
      const obj = objectPart(e.entityId);
      const label = (suffix: string): string => (e.name ? `${e.name} · ${suffix}` : suffix);
      const sources = e.caps.sources ?? [];
      const comps: Components = {
        [`${e.key}_state`]: { p: 'sensor', unique_id: `${e.uniqueId}_state`, default_entity_id: `sensor.${obj}_state`, name: label('Estado'), state_topic: t, value_template: tpl('state') },
        [`${e.key}_power`]: {
          p: 'switch',
          unique_id: `${e.uniqueId}_power`,
          default_entity_id: `switch.${obj}_power`,
          name: label('Encendido'),
          state_topic: t,
          value_template: tpl('power'),
          command_topic: `${t}/power/set`,
          payload_on: 'ON',
          payload_off: 'OFF',
        },
        [`${e.key}_volume`]: {
          p: 'number',
          unique_id: `${e.uniqueId}_volume`,
          default_entity_id: `number.${obj}_volume`,
          name: label('Volumen'),
          state_topic: t,
          value_template: "{{ value_json.volume | default(0) }}",
          command_topic: `${t}/volume/set`,
          min: 0,
          max: 100,
          step: 1,
          unit_of_measurement: '%',
        },
      };
      if (assistant && assistant.kind !== 'assist') {
        // Anuncios de HA hacia el altavoz (notify.alexa_media_* o tts.speak en Google Cast).
        comps[`${e.key}_announce`] = {
          p: 'notify',
          unique_id: `${e.uniqueId}_announce`,
          default_entity_id: `notify.${obj}_announce`,
          name: label('Anuncio'),
          command_topic: `${t}/announce/set`,
        };
      }
      if (sources.length > 0) {
        comps[`${e.key}_source`] = {
          p: 'select',
          unique_id: `${e.uniqueId}_source`,
          default_entity_id: `select.${obj}_source`,
          name: label('Fuente'),
          state_topic: t,
          value_template: tpl('source'),
          command_topic: `${t}/source/set`,
          options: sources,
        };
      }
      return comps;
    }
    default:
      // camera y dominios sin plataforma MQTT: sensor de estado de solo lectura.
      return {
        [e.key]: {
          p: 'sensor',
          unique_id: e.uniqueId,
          default_entity_id: `sensor.${objectPart(e.entityId)}_state`,
          name: e.name ? `${e.name} · Estado` : 'Estado',
          state_topic: t,
          value_template: tpl('state'),
        },
      };
  }
}

function genericDeviceBlock(model: BridgeModel, bdev: BridgeDevice): Fields {
  const dev: Fields = {
    identifiers: [bdev.nodeId],
    name: bdev.device.name,
    manufacturer: bdev.def.brand,
    model: bdev.def.model,
    sw_version: SIMULATED_VERSION,
    hw_version: RADIO_NOTE,
  };
  if (bdev.areaName !== undefined) dev.suggested_area = bdev.areaName;
  const via = bdev.viaDeviceId === undefined ? undefined : model.devices.find((d) => d.device.id === bdev.viaDeviceId);
  if (via) dev.via_device = via.profile === 'z2m' ? z2mDeviceIdentifier(via.ieee) : via.nodeId;
  return dev;
}

/** Discovery por dispositivo del perfil genérico. */
export function genericDiscovery(model: BridgeModel, bdev: BridgeDevice): MqttMessage {
  const cmps: Components = {};
  if (bdev.infra) {
    cmps.connectivity = {
      p: 'binary_sensor',
      unique_id: `${bdev.nodeId}_connectivity`,
      name: 'Conectividad',
      device_class: 'connectivity',
      entity_category: 'diagnostic',
      state_topic: bdev.availabilityTopic,
      payload_on: 'online',
      payload_off: 'offline',
    };
  }
  for (const e of bdev.entities) Object.assign(cmps, genericComponents(e, bdev.def.assistant));
  const payload: Fields = {
    dev: genericDeviceBlock(model, bdev),
    o: ORIGIN,
    cmps,
    // Disponibilidad compartida: el orquestador (LWT) y el dispositivo (fallos del simulador).
    ...(bdev.infra
      ? { availability: [{ topic: model.bridgeStateTopic }], availability_mode: 'all' }
      : { availability: [{ topic: model.bridgeStateTopic }, { topic: bdev.availabilityTopic }], availability_mode: 'all' }),
  };
  return { topic: `${model.settings.discoveryPrefix}/device/${bdev.nodeId}/config`, payload: stableJson(payload), retain: true };
}

// ---------- Perfil Zigbee2MQTT ----------

function z2mAvailability(model: BridgeModel, bdev: BridgeDevice): Fields {
  return {
    availability: [
      { topic: model.z2mBridgeStateTopic, value_template: tpl('state') },
      { topic: bdev.availabilityTopic, value_template: tpl('state') },
    ],
    availability_mode: 'all',
  };
}

function z2mDeviceBlock(model: BridgeModel, bdev: BridgeDevice): Fields {
  const dev: Fields = {
    identifiers: [z2mDeviceIdentifier(bdev.ieee)],
    name: bdev.device.name,
    manufacturer: bdev.def.brand,
    model: bdev.def.model,
    model_id: bdev.def.model,
    sw_version: SIMULATED_VERSION,
    hw_version: RADIO_NOTE,
    via_device: z2mBridgeIdentifier(model.coordinator.ieee),
  };
  if (bdev.areaName !== undefined) dev.suggested_area = bdev.areaName;
  return dev;
}

/** [componente, configuración] de una entidad en el formato de Zigbee2MQTT. */
function z2mComponent(model: BridgeModel, bdev: BridgeDevice, e: BridgeEntity): [string, Fields] {
  const t = `${model.settings.z2mBaseTopic}/${bdev.friendlyName}`;
  const p = e.property;
  const base: Fields = { unique_id: e.uniqueId, default_entity_id: e.entityId, name: e.name, state_topic: t };
  switch (e.domain) {
    case 'light':
      return ['light', { ...base, ...lightExtras(e, 'z2m'), command_topic: `${t}/set` }];
    case 'switch':
      return [
        'switch',
        { ...base, value_template: tpl(p), command_topic: `${t}/set`, payload_on: stableJson({ [p]: 'ON' }), payload_off: stableJson({ [p]: 'OFF' }), state_on: 'ON', state_off: 'OFF' },
      ];
    case 'binary_sensor': {
      const contact = p.startsWith('contact');
      return [
        'binary_sensor',
        {
          ...base,
          value_template: tpl(p),
          payload_on: contact ? false : true,
          payload_off: contact ? true : false,
          ...(e.definition.deviceClass ? { device_class: e.definition.deviceClass } : {}),
        },
      ];
    }
    case 'sensor':
      return ['sensor', { ...base, value_template: tpl(p), ...sensorExtras(e) }];
    case 'cover':
      return [
        'cover',
        {
          ...base,
          value_template: tpl('state'),
          state_open: 'OPEN',
          state_closed: 'CLOSE',
          command_topic: `${t}/set`,
          payload_open: 'OPEN',
          payload_close: 'CLOSE',
          payload_stop: 'STOP',
          position_topic: t,
          position_template: tpl('position'),
          set_position_topic: `${t}/set`,
          set_position_template: '{ "position": {{ position }} }',
          ...(e.definition.deviceClass ? { device_class: e.definition.deviceClass } : {}),
        },
      ];
    case 'climate': {
      const presets = presetModes(e);
      return [
        'climate',
        {
          unique_id: e.uniqueId,
          default_entity_id: e.entityId,
          name: e.name,
          ...climateExtras(e),
          mode_state_topic: t,
          mode_state_template: tpl('system_mode'),
          mode_command_topic: `${t}/set/system_mode`,
          temperature_state_topic: t,
          temperature_state_template: tpl('occupied_heating_setpoint'),
          temperature_command_topic: `${t}/set/occupied_heating_setpoint`,
          current_temperature_topic: t,
          current_temperature_template: tpl('local_temperature'),
          action_topic: t,
          action_template: "{% set values = {None: None, 'idle': 'idle', 'heat': 'heating', 'cool': 'cooling'} %}{{ values[value_json.running_state] }}",
          ...(presets.length > 0
            ? { preset_modes: presets, preset_mode_state_topic: t, preset_mode_value_template: tpl('preset'), preset_mode_command_topic: `${t}/set/preset` }
            : {}),
        },
      ];
    }
    case 'lock':
      return [
        'lock',
        {
          ...base,
          value_template: tpl('state'),
          command_topic: `${t}/set`,
          payload_lock: stableJson({ state: 'LOCK' }),
          payload_unlock: stableJson({ state: 'UNLOCK' }),
          state_locked: 'LOCK',
          state_unlocked: 'UNLOCK',
          state_jammed: 'JAMMED',
        },
      ];
    default:
      // Dominios poco habituales en Zigbee: sensor de estado de solo lectura.
      return ['sensor', { ...base, default_entity_id: `sensor.${objectPart(e.entityId)}_state`, value_template: tpl(p) }];
  }
}

/** Discovery de las entidades de un dispositivo Z2M (un topic por entidad, como Zigbee2MQTT). */
export function z2mDiscovery(model: BridgeModel, bdev: BridgeDevice): MqttMessage[] {
  const prefix = model.settings.discoveryPrefix;
  const common: Fields = { ...z2mAvailability(model, bdev), device: z2mDeviceBlock(model, bdev), origin: ORIGIN };
  const out: MqttMessage[] = bdev.entities.map((e) => {
    const [component, config] = z2mComponent(model, bdev, e);
    return { topic: `${prefix}/${component}/${bdev.ieee}/${e.objectId}/config`, payload: stableJson({ ...config, ...common }), retain: true };
  });
  out.push({
    topic: `${prefix}/sensor/${bdev.ieee}/linkquality/config`,
    payload: stableJson({
      unique_id: `${bdev.ieee}_linkquality_zigbee2mqtt`,
      name: 'Linkquality',
      state_topic: `${model.settings.z2mBaseTopic}/${bdev.friendlyName}`,
      value_template: tpl('linkquality'),
      unit_of_measurement: 'lqi',
      state_class: 'measurement',
      entity_category: 'diagnostic',
      enabled_by_default: false,
      icon: 'mdi:signal',
      ...common,
    }),
    retain: true,
  });
  return out;
}

/** Entidad de conectividad del bridge Z2M (el dispositivo «Zigbee2MQTT Bridge» de HA). */
export function z2mBridgeDiscovery(model: BridgeModel): MqttMessage {
  const ieee = model.coordinator.ieee;
  const id = z2mBridgeIdentifier(ieee);
  return {
    topic: `${model.settings.discoveryPrefix}/binary_sensor/${id}/connection_state/config`,
    payload: stableJson({
      unique_id: `bridge_${ieee}_connection_state_zigbee2mqtt`,
      name: 'Connection state',
      state_topic: model.z2mBridgeStateTopic,
      value_template: tpl('state'),
      payload_on: 'online',
      payload_off: 'offline',
      device_class: 'connectivity',
      entity_category: 'diagnostic',
      device: { identifiers: [id], name: 'Zigbee2MQTT Bridge (simulado)', manufacturer: 'Zigbee2MQTT', model: 'Bridge', sw_version: SIMULATED_VERSION, hw_version: RADIO_NOTE },
      origin: ORIGIN,
    }),
    retain: true,
  };
}

// ---------- bridge/info y bridge/devices de Z2M ----------

const binary = (name: string, access: number, on: Json, off: Json): Fields => ({ type: 'binary', name, property: name, access, value_on: on, value_off: off });
const numeric = (name: string, access: number, extra: Fields = {}): Fields => ({ type: 'numeric', name, property: name, access, ...extra });
const enumExpose = (name: string, access: number, values: string[]): Fields => ({ type: 'enum', name, property: name, access, values });

/** Exposes de Zigbee2MQTT de una entidad (tablas propias por dominio; no usa zigbee-herdsman-converters). */
export function z2mExposes(e: BridgeEntity): Fields[] {
  const p = e.property;
  switch (e.domain) {
    case 'light': {
      const modes = supportedColorModes(e, 'z2m');
      const features: Fields[] = [{ ...binary('state', 7, 'ON', 'OFF'), value_toggle: 'TOGGLE' }];
      if (!modes.includes('onoff')) features.push(numeric('brightness', 7, { value_min: 0, value_max: 254 }));
      if (modes.includes('color_temp')) {
        features.push(numeric('color_temp', 7, { unit: 'mired', value_min: kelvinToMired(e.caps.maxKelvin ?? 6500), value_max: kelvinToMired(e.caps.minKelvin ?? 2000) }));
      }
      if (modes.includes('xy')) {
        features.push({ type: 'composite', name: 'color_xy', property: 'color', access: 7, features: [numeric('x', 7), numeric('y', 7)] });
      }
      return [{ type: 'light', features }];
    }
    case 'switch': {
      const m = /_l(\d+)$/.exec(p);
      return [{ type: 'switch', ...(m ? { endpoint: `l${m[1] ?? ''}` } : {}), features: [{ ...binary(p, 7, 'ON', 'OFF'), value_toggle: 'TOGGLE' }] }];
    }
    case 'binary_sensor':
      return [p.startsWith('contact') ? binary(p, 1, false, true) : binary(p, 1, true, false)];
    case 'sensor':
      if (p === 'action') return [enumExpose('action', 1, e.caps.buttonActions ?? ['single', 'double', 'hold'])];
      return [numeric(p, 1, e.definition.unit !== undefined ? { unit: e.definition.unit } : {})];
    case 'cover':
      return [{ type: 'cover', features: [enumExpose('state', 7, ['OPEN', 'CLOSE', 'STOP']), numeric('position', 7, { unit: '%', value_min: 0, value_max: 100 })] }];
    case 'climate':
      return [
        {
          type: 'climate',
          features: [
            numeric('occupied_heating_setpoint', 7, { unit: '°C', value_min: e.caps.minTemp ?? 7, value_max: e.caps.maxTemp ?? 35, value_step: e.caps.tempStep ?? 0.5 }),
            numeric('local_temperature', 5, { unit: '°C' }),
            enumExpose('system_mode', 7, e.caps.hvacModes ?? ['off', 'heat']),
            enumExpose('running_state', 5, ['idle', 'heat', 'cool']),
          ],
        },
      ];
    case 'lock':
      return [{ type: 'lock', features: [binary('state', 7, 'LOCK', 'UNLOCK'), enumExpose('lock_state', 1, ['locked', 'unlocked', 'not_fully_locked'])] }];
    default:
      return [enumExpose(p, 1, [])];
  }
}

const POWER_SOURCE: Record<string, string> = { battery: 'Battery', mains: 'Mains (single phase)', usb: 'DC Source', poe: 'DC Source' };

function networkAddress(ieee: string): number {
  return (parseInt(ieee.slice(-4), 16) % 0xfff7) + 1;
}

/** bridge/state, bridge/info y bridge/devices del Z2M emulado (retenidos). */
export function z2mBridgeMessages(model: BridgeModel): MqttMessage[] {
  const base = model.settings.z2mBaseTopic;
  const coordIeee = model.coordinator.ieee;
  const devices: Json[] = [
    {
      ieee_address: coordIeee,
      type: 'Coordinator',
      network_address: 0,
      friendly_name: 'Coordinator',
      supported: true,
      disabled: false,
      interview_completed: true,
      interviewing: false,
      definition: null,
      power_source: 'Mains (single phase)',
      endpoints: {},
    },
  ];
  for (const bdev of model.devices) {
    if (bdev.profile !== 'z2m') continue;
    const router = bdev.def.role === 'router' || bdev.def.power !== 'battery';
    devices.push({
      ieee_address: bdev.ieee,
      type: router ? 'Router' : 'EndDevice',
      network_address: networkAddress(bdev.ieee),
      friendly_name: bdev.friendlyName,
      supported: true,
      disabled: false,
      interview_completed: true,
      interviewing: false,
      manufacturer: bdev.def.brand,
      model_id: bdev.def.model,
      power_source: POWER_SOURCE[bdev.def.power] ?? 'Unknown',
      software_build_id: SIMULATED_VERSION,
      definition: {
        model: bdev.def.model,
        vendor: bdev.def.brand,
        description: bdev.def.name,
        exposes: [...bdev.entities.flatMap(z2mExposes), numeric('linkquality', 1, { unit: 'lqi', value_min: 0, value_max: 255 })],
        options: [],
        supports_ota: false,
      },
      endpoints: {},
    });
  }
  const info: Fields = {
    version: SIMULATED_VERSION,
    commit: SIMULATED_VERSION,
    coordinator: { ieee_address: coordIeee, type: 'Simulado (HA Simulator)', meta: {} },
    network: { channel: model.zigbeeChannel, pan_id: 6754, extended_pan_id: coordIeee },
    log_level: 'info',
    permit_join: false,
    restart_required: false,
    config: { homeassistant: { enabled: true, discovery_topic: model.settings.discoveryPrefix }, mqtt: { base_topic: base }, advanced: { last_seen: 'disable' } },
  };
  return [
    { topic: `${base}/bridge/info`, payload: stableJson(info), retain: true },
    { topic: `${base}/bridge/devices`, payload: stableJson(devices), retain: true },
  ];
}
