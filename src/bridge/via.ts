// Textos de la «Vía hacia HA» de cada dispositivo (no engañar: se dice qué es real y qué no).
import { PENDING_TRANSPORTS, type Device, type DeviceDefinition, type DeviceTransport } from '../types';
import { nativeDecision, type NativeTransport } from './native';

export const TRANSPORT_LABELS: Record<DeviceTransport, string> = {
  z2m_mqtt: 'Zigbee2MQTT emulado (MQTT)',
  mqtt_discovery: 'MQTT discovery genérico',
  zwave_js: 'Z-Wave JS (mock)',
  matter: 'Matter (matter.js)',
  esphome: 'ESPHome (API nativa emulada)',
  shelly: 'Shelly (API RPC emulada)',
};

/** Aviso fijo: ninguna radio es real (Zigbee, Thread, Z-Wave... se modelan en el motor). */
export const RADIO_LABEL = 'Radio: modelada, no real';

export interface ViaInfo {
  transport: DeviceTransport;
  /** Texto para la interfaz, p. ej. «Matter (matter.js), pendiente de E3: ahora MQTT discovery genérico». */
  label: string;
  pending: boolean;
  /** Nota adicional (ZHA o Hue sin radio virtual). */
  note?: string;
}

/** Nota de la vía de los asistentes de voz y robots (qué llega por su integración real). */
function voiceNote(device: Pick<Device, 'integration'>, def: Partial<Pick<DeviceDefinition, 'assistant' | 'category'>>, native: boolean): string | undefined {
  const kind = def.assistant?.kind;
  if (kind === 'assist' && device.integration === 'esphome') {
    return native
      ? 'Llega por la integración ESPHome real. La plataforma host no tiene micrófono, así que no hay voice_assistant ni assist_satellite: el satélite se publica como sensor de estado y un texto «Anuncio» (lo que escribas en HA se anuncia en el simulador).'
      : 'Con el perfil esphome llegaría por la integración ESPHome real (sensor de estado y texto de anuncio; sin micrófono no hay assist_satellite). Ahora: sensor de estado y notify de anuncios por MQTT.';
  }
  if (kind === 'assist' && device.integration === 'wyoming') {
    return 'Candidato para más adelante: un contenedor wyoming-satellite real con audio de fichero llegaría por la integración Wyoming. Ahora: sensor de estado y notify de anuncios por MQTT.';
  }
  if (kind === 'alexa' || kind === 'google') {
    return 'El control por voz de Alexa y Google se simula en la app (sus nubes necesitan cuentas reales). En HA llegan el reproductor y un notify para anuncios por MQTT.';
  }
  if (kind === 'siri') return 'En HA solo es un reproductor (integración Apple TV); Siri no se modela en el laboratorio.';
  if (def.category === 'vacuum') return 'El robot llega como vacuum MQTT (esquema state) con su batería, consumibles y selects aparte; su integración real (Roborock, Dreame...) necesita la nube del fabricante.';
  return undefined;
}

/**
 * Vía hacia HA de un dispositivo. `active`: vías reales activas en el orquestador (perfiles zwave,
 * esphome y shelly, de `status.capabilities`); sin ellas, esos dispositivos siguen por MQTT con el aviso.
 */
export function viaInfo(device: Device, def: DeviceDefinition, active: ReadonlySet<NativeTransport> = new Set()): ViaInfo {
  if (def.role === 'ha_server') return { transport: 'mqtt_discovery', label: 'Es el propio Home Assistant del lab', pending: false };
  const decision = nativeDecision(device, def, active);
  const { transport } = decision;
  const stage = PENDING_TRANSPORTS[transport];
  let label: string = TRANSPORT_LABELS[transport];
  let pending = false;
  let note: string | undefined;
  if (stage) {
    label = `${TRANSPORT_LABELS[transport]}, pendiente de ${stage}: ahora ${TRANSPORT_LABELS.mqtt_discovery}`;
    pending = true;
  } else if (decision.profile && !decision.native) {
    label = `${TRANSPORT_LABELS[transport]} no disponible: ahora ${TRANSPORT_LABELS.mqtt_discovery}`;
    pending = true;
    note = `Sigue por MQTT porque ${decision.reason ?? 'su vía real no está activa'}.`;
  }
  if (device.protocol === 'zigbee' && device.integration === 'zha') note = 'ZHA no tiene radio virtual: se representa por MQTT genérico.';
  else if (device.protocol === 'zigbee' && device.integration === 'hue') note = 'El puente Hue no se emula: se representa por MQTT genérico a través del hub.';
  else {
    const voice = voiceNote(device, def, decision.native);
    if (voice) note = note ? `${note} ${voice}` : voice;
  }
  return { transport, label, pending, ...(note ? { note } : {}) };
}
