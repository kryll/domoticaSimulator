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

export function viaInfo(device: Pick<Device, 'protocol' | 'integration'>, def: Pick<DeviceDefinition, 'integrations' | 'role'>): ViaInfo {
  const transport = transportFor(device, def);
  const stage = PENDING_TRANSPORTS[transport];
  const label = stage ? `${TRANSPORT_LABELS[transport]}, pendiente de ${stage}: ahora ${TRANSPORT_LABELS.mqtt_discovery}` : TRANSPORT_LABELS[transport];
  let note: string | undefined;
  if (device.protocol === 'zigbee' && device.integration === 'zha') note = 'ZHA no tiene radio virtual: se representa por MQTT genérico.';
  else if (device.protocol === 'zigbee' && device.integration === 'hue') note = 'El puente Hue no se emula: se representa por MQTT genérico a través del hub.';
  if (def.role === 'ha_server') return { transport, label: 'Es el propio Home Assistant del lab', pending: false };
  return { transport, label, pending: stage !== undefined, ...(note ? { note } : {}) };
}
