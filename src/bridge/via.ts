// Textos de la «Vía hacia HA» de cada dispositivo (no engañar: se dice qué es real y qué no).
import { PENDING_TRANSPORTS, transportFor, type Device, type DeviceDefinition, type DeviceTransport } from '../types';

export const TRANSPORT_LABELS: Record<DeviceTransport, string> = {
  z2m_mqtt: 'Zigbee2MQTT emulado (MQTT)',
  mqtt_discovery: 'MQTT discovery genérico',
  zwave_js: 'Z-Wave JS (mock-server)',
  matter: 'Matter (matter.js)',
  esphome: 'ESPHome (plataforma host)',
  shelly: 'Emulador Shelly RPC',
};

/** Aviso fijo: ninguna radio es real (Zigbee, Thread, Z-Wave... se modelan en el motor). */
export const RADIO_LABEL = 'Radio: modelada, no real';

export interface ViaInfo {
  transport: DeviceTransport;
  /** Texto para la interfaz, p. ej. «Z-Wave JS (mock-server), pendiente de E2: ahora MQTT discovery genérico». */
  label: string;
  pending: boolean;
  /** Nota adicional (ZHA o Hue sin radio virtual). */
  note?: string;
}

/** Nota de la vía de los asistentes de voz y robots (qué llegaría por su integración real y cuándo). */
function voiceNote(device: Pick<Device, 'integration'>, def: Partial<Pick<DeviceDefinition, 'assistant' | 'category'>>): string | undefined {
  const kind = def.assistant?.kind;
  if (kind === 'assist' && device.integration === 'esphome') {
    return 'Candidato para E2: el firmware real de voz de ESPHome en la plataforma host llegaría por la integración ESPHome (assist_satellite real); sin micrófono, la frase se inyectaría como audio o texto. Ahora: sensor de estado y notify de anuncios por MQTT.';
  }
  if (kind === 'assist' && device.integration === 'wyoming') {
    return 'Candidato para E2: un contenedor wyoming-satellite real con audio de fichero llegaría por la integración Wyoming. Ahora: sensor de estado y notify de anuncios por MQTT.';
  }
  if (kind === 'alexa' || kind === 'google') {
    return 'El control por voz de Alexa y Google se simula en la app (sus nubes necesitan cuentas reales). En HA llegan el reproductor y un notify para anuncios por MQTT.';
  }
  if (kind === 'siri') return 'En HA solo es un reproductor (integración Apple TV); Siri no se modela en el laboratorio.';
  if (def.category === 'vacuum') return 'El robot llega como vacuum MQTT (esquema state) con su batería, consumibles y selects aparte; su integración real (Roborock, Dreame...) necesita la nube del fabricante.';
  return undefined;
}

export function viaInfo(device: Pick<Device, 'protocol' | 'integration'>, def: Pick<DeviceDefinition, 'integrations' | 'role'> & Partial<Pick<DeviceDefinition, 'assistant' | 'category'>>): ViaInfo {
  const transport = transportFor(device, def);
  const stage = PENDING_TRANSPORTS[transport];
  const label = stage ? `${TRANSPORT_LABELS[transport]}, pendiente de ${stage}: ahora ${TRANSPORT_LABELS.mqtt_discovery}` : TRANSPORT_LABELS[transport];
  let note: string | undefined;
  if (device.protocol === 'zigbee' && device.integration === 'zha') note = 'ZHA no tiene radio virtual: se representa por MQTT genérico.';
  else if (device.protocol === 'zigbee' && device.integration === 'hue') note = 'El puente Hue no se emula: se representa por MQTT genérico a través del hub.';
  else note = voiceNote(device, def);
  if (def.role === 'ha_server') return { transport, label: 'Es el propio Home Assistant del lab', pending: false };
  return { transport, label, pending: stage !== undefined, ...(note ? { note } : {}) };
}
