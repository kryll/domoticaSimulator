// Metadatos de los servicios de Home Assistant que soporta la simulación (services.ts):
// nombre en español y campos tipados para construir formularios.
import type { EntityCapabilities, EntityDomain, HelperType } from '../types';
import { ALARM_STATE_LABELS } from '../devices/labels';
import { isDimmable, withDefaults } from '../devices/capabilities';
import { HVAC_MODE_LABELS, PRESET_LABELS, labelOf } from '../devices/labels';
import { NOTIFY_PERSISTENT } from './notify';
import { FAN_SPEED_LABELS, SELECT_OPTION_LABELS } from '../devices/labels';

export { FAN_SPEED_LABELS, SELECT_OPTION_LABELS } from '../devices/labels';

export type ServiceFieldType = 'number' | 'percent' | 'kelvin' | 'color' | 'select' | 'boolean' | 'text' | 'temperature';

export interface ServiceFieldOption {
  value: string;
  label: string;
}

export interface ServiceField {
  key: string;
  label: string;
  type: ServiceFieldType;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: ServiceFieldOption[];
  /**
   * Campos del mismo grupo son excluyentes entre sí (vol.Exclusive de HA): p. ej. brightness_pct
   * y brightness_step_pct, o color_temp_kelvin y rgb_color. Solo se puede rellenar uno.
   */
  exclusiveGroup?: string;
  /** Campo obligatorio del servicio. */
  required?: boolean;
}

export interface ServiceInfo {
  /** Servicio completo, p. ej. "light.turn_on". */
  service: string;
  /** Nombre en español, p. ej. "Encender". */
  name: string;
  fields: ServiceField[];
}

/** Dominios con servicios: los de entidad y el genérico homeassistant. */
export type ServiceDomain = EntityDomain | HelperType | 'homeassistant' | 'notify' | 'tts';

const svc = (service: string, name: string, fields: ServiceField[] = []): ServiceInfo => ({ service, name, fields });

const options = (values: string[], table?: Record<string, string>): ServiceFieldOption[] =>
  values.map((value) => ({ value, label: table ? labelOf(table, value) : value }));

const MEDIA_TYPES: ServiceFieldOption[] = [
  { value: 'music', label: 'Música' },
  { value: 'video', label: 'Vídeo' },
  { value: 'playlist', label: 'Lista de reproducción' },
  { value: 'channel', label: 'Canal' },
  { value: 'url', label: 'URL' },
];

function lightServices(caps: EntityCapabilities): ServiceInfo[] {
  const modes = caps.colorModes ?? [];
  const fields: ServiceField[] = [];
  if (isDimmable(caps)) {
    fields.push({ key: 'brightness_pct', label: 'Brillo', type: 'percent', min: 0, max: 100, step: 1, unit: '%', exclusiveGroup: 'brightness' });
    fields.push({ key: 'brightness_step_pct', label: 'Variar brillo', type: 'number', min: -100, max: 100, step: 5, unit: '%', exclusiveGroup: 'brightness' });
  }
  if (modes.includes('color_temp')) {
    fields.push({ key: 'color_temp_kelvin', label: 'Temperatura de color', type: 'kelvin', min: caps.minKelvin ?? 2000, max: caps.maxKelvin ?? 6500, step: 100, unit: 'K', exclusiveGroup: 'color' });
  }
  if (modes.includes('rgb')) fields.push({ key: 'rgb_color', label: 'Color', type: 'color', exclusiveGroup: 'color' });
  return [svc('light.turn_on', 'Encender', fields), svc('light.turn_off', 'Apagar'), svc('light.toggle', 'Alternar', fields)];
}

function climateServices(caps: EntityCapabilities): ServiceInfo[] {
  const modes = options(caps.hvacModes ?? [], HVAC_MODE_LABELS);
  const temperature: ServiceField = {
    key: 'temperature',
    label: 'Consigna',
    type: 'temperature',
    min: caps.minTemp ?? 7,
    max: caps.maxTemp ?? 35,
    step: caps.tempStep ?? 0.5,
    unit: '°C',
  };
  const list = [
    svc('climate.set_temperature', 'Fijar consigna', [temperature, { key: 'hvac_mode', label: 'Modo', type: 'select', options: modes }]),
    svc('climate.set_hvac_mode', 'Cambiar modo', [{ key: 'hvac_mode', label: 'Modo', type: 'select', options: modes, required: true }]),
  ];
  const fans = caps.fanModes ?? [];
  if (fans.length > 0) {
    list.push(svc('climate.set_fan_mode', 'Cambiar ventilador', [{ key: 'fan_mode', label: 'Ventilador', type: 'select', options: options(fans, FAN_MODE_LABELS), required: true }]));
  }
  const presets = caps.presetModes ?? [];
  if (presets.length > 0) {
    list.push(svc('climate.set_preset_mode', 'Cambiar preset', [{ key: 'preset_mode', label: 'Preset', type: 'select', options: options(presets, PRESET_LABELS), required: true }]));
  }
  list.push(svc('climate.turn_on', 'Encender'), svc('climate.turn_off', 'Apagar'), svc('climate.toggle', 'Alternar'));
  return list;
}

function mediaServices(caps: EntityCapabilities): ServiceInfo[] {
  const sources = caps.sources ?? [];
  const source: ServiceField =
    sources.length > 0
      ? { key: 'source', label: 'Fuente', type: 'select', options: options(sources), required: true }
      : { key: 'source', label: 'Fuente', type: 'text', required: true };
  return [
    svc('media_player.turn_on', 'Encender'),
    svc('media_player.turn_off', 'Apagar'),
    svc('media_player.toggle', 'Alternar'),
    svc('media_player.media_play', 'Reproducir'),
    svc('media_player.media_pause', 'Pausar'),
    svc('media_player.media_play_pause', 'Reproducir/pausar'),
    svc('media_player.media_stop', 'Detener'),
    svc('media_player.media_next_track', 'Pista siguiente'),
    svc('media_player.media_previous_track', 'Pista anterior'),
    svc('media_player.play_media', 'Reproducir contenido', [
      { key: 'media_content_id', label: 'Contenido', type: 'text', required: true },
      { key: 'media_content_type', label: 'Tipo', type: 'select', options: MEDIA_TYPES, required: true },
    ]),
    svc('media_player.volume_set', 'Fijar volumen', [{ key: 'volume_level', label: 'Volumen', type: 'number', min: 0, max: 1, step: 0.05, required: true }]),
    svc('media_player.volume_up', 'Subir volumen'),
    svc('media_player.volume_down', 'Bajar volumen'),
    svc('media_player.volume_mute', 'Silenciar', [{ key: 'is_volume_muted', label: 'Silenciado', type: 'boolean', required: true }]),
    svc('media_player.select_source', 'Elegir fuente', [source]),
  ];
}

/** Tanda 3: modos del ventilador del aire acondicionado. */
export const FAN_MODE_LABELS: Record<string, string> = { auto: 'Automático', low: 'Bajo', medium: 'Medio', high: 'Alto', quiet: 'Silencioso', turbo: 'Turbo' };

const CODE: ServiceField = { key: 'code', label: 'Código', type: 'text' };
const ARM_NAMES: Record<string, string> = {
  armed_home: 'Armar en casa',
  armed_away: 'Armar fuera',
  armed_night: 'Armar noche',
  armed_vacation: 'Armar vacaciones',
  armed_custom_bypass: 'Armar personalizada',
};

function alarmServices(caps: EntityCapabilities): ServiceInfo[] {
  const modes = caps.alarmModes ?? ['armed_home', 'armed_away', 'armed_night'];
  const code: ServiceField = caps.codeArmRequired ? { ...CODE, required: true } : CODE;
  return [
    ...modes.map((m) => svc(`alarm_control_panel.alarm_arm_${m.replace(/^armed_/, '')}`, ARM_NAMES[m] ?? labelOf(ALARM_STATE_LABELS, m), [code])),
    svc('alarm_control_panel.alarm_disarm', 'Desarmar', [{ ...CODE, required: true }]),
    svc('alarm_control_panel.alarm_trigger', 'Disparar la alarma', [CODE]),
  ];
}

const VALUE_NUMBER: ServiceField = { key: 'value', label: 'Valor', type: 'number', required: true };

/** Tanda 3: servicios de los helpers. */
function helperServices(domain: HelperType): ServiceInfo[] {
  switch (domain) {
    case 'input_boolean':
      return ON_OFF('input_boolean');
    case 'input_number':
      return [svc('input_number.set_value', 'Fijar valor', [VALUE_NUMBER]), svc('input_number.increment', 'Subir un paso'), svc('input_number.decrement', 'Bajar un paso')];
    case 'input_select':
      return [
        svc('input_select.select_option', 'Elegir opción', [{ key: 'option', label: 'Opción', type: 'text', required: true }]),
        svc('input_select.select_next', 'Opción siguiente', [{ key: 'cycle', label: 'Volver al principio', type: 'boolean' }]),
        svc('input_select.select_previous', 'Opción anterior', [{ key: 'cycle', label: 'Volver al final', type: 'boolean' }]),
        svc('input_select.select_first', 'Primera opción'),
        svc('input_select.select_last', 'Última opción'),
      ];
    case 'input_text':
      return [svc('input_text.set_value', 'Fijar texto', [{ key: 'value', label: 'Texto', type: 'text', required: true }])];
    case 'input_datetime':
      return [
        svc('input_datetime.set_datetime', 'Fijar fecha y hora', [
          { key: 'date', label: 'Fecha (AAAA-MM-DD)', type: 'text' },
          { key: 'time', label: 'Hora (HH:MM:SS)', type: 'text' },
          { key: 'datetime', label: 'Fecha y hora', type: 'text' },
        ]),
      ];
    case 'timer':
      return [
        svc('timer.start', 'Iniciar', [{ key: 'duration', label: 'Duración (HH:MM:SS)', type: 'text' }]),
        svc('timer.pause', 'Pausar'),
        svc('timer.cancel', 'Cancelar'),
        svc('timer.finish', 'Terminar'),
        svc('timer.change', 'Cambiar tiempo', [{ key: 'duration', label: 'Tiempo a sumar (HH:MM:SS)', type: 'text', required: true }]),
      ];
    case 'counter':
      return [svc('counter.increment', 'Sumar'), svc('counter.decrement', 'Restar'), svc('counter.reset', 'Reiniciar'), svc('counter.set_value', 'Fijar valor', [VALUE_NUMBER])];
  }
}

const HELPER_DOMAINS: HelperType[] = ['input_boolean', 'input_number', 'input_select', 'input_text', 'input_datetime', 'timer', 'counter'];

const ON_OFF = (domain: string): ServiceInfo[] => [
  svc(`${domain}.turn_on`, 'Encender'),
  svc(`${domain}.turn_off`, 'Apagar'),
  svc(`${domain}.toggle`, 'Alternar'),
];

/**
 * Servicios de un dominio (con sus campos filtrados por las capacidades de la entidad).
 * Sensores y sensores binarios no tienen servicios.
 */
export function servicesForDomain(domain: ServiceDomain | string, capabilities?: EntityCapabilities): ServiceInfo[] {
  const caps = withDefaults(domain, capabilities);
  switch (domain) {
    case 'light':
      return lightServices(caps);
    case 'switch':
      return ON_OFF('switch');
    case 'fan':
      return [
        svc('fan.turn_on', 'Encender', [{ key: 'percentage', label: 'Velocidad', type: 'percent', min: 0, max: 100, step: 1, unit: '%' }]),
        svc('fan.turn_off', 'Apagar'),
        svc('fan.toggle', 'Alternar'),
        svc('fan.set_percentage', 'Fijar velocidad', [{ key: 'percentage', label: 'Velocidad', type: 'percent', min: 0, max: 100, step: 1, unit: '%', required: true }]),
      ];
    case 'cover':
      return [
        svc('cover.open_cover', 'Abrir'),
        svc('cover.close_cover', 'Cerrar'),
        svc('cover.stop_cover', 'Detener'),
        svc('cover.toggle', 'Alternar'),
        svc('cover.set_cover_position', 'Fijar posición', [{ key: 'position', label: 'Posición', type: 'percent', min: 0, max: 100, step: 1, unit: '%', required: true }]),
      ];
    case 'lock':
      return [svc('lock.lock', 'Cerrar con llave'), svc('lock.unlock', 'Abrir cerradura'), svc('lock.open', 'Abrir la puerta')];
    case 'climate':
      return climateServices(caps);
    case 'media_player':
      return mediaServices(caps);
    case 'vacuum': {
      const list = [
        svc('vacuum.start', 'Empezar a limpiar'),
        svc('vacuum.pause', 'Pausar'),
        svc('vacuum.stop', 'Detener'),
        svc('vacuum.start_pause', 'Empezar/pausar'),
        svc('vacuum.return_to_base', 'Volver a la base'),
        svc('vacuum.locate', 'Localizar'),
        svc('vacuum.clean_spot', 'Limpieza localizada'),
        svc('vacuum.clean_area', 'Limpiar áreas', [{ key: 'cleaning_area_id', label: 'Áreas (ids de sala)', type: 'text', required: true }]),
        svc('vacuum.send_command', 'Enviar comando', [
          { key: 'command', label: 'Comando (p. ej. app_segment_clean)', type: 'text', required: true },
          { key: 'params', label: 'Parámetros (p. ej. [16, 17])', type: 'text' },
        ]),
      ];
      const speeds = caps.fanSpeeds ?? [];
      if (speeds.length > 0) list.push(svc('vacuum.set_fan_speed', 'Potencia de aspiración', [{ key: 'fan_speed', label: 'Potencia', type: 'select', options: options(speeds, FAN_SPEED_LABELS), required: true }]));
      return list;
    }
    case 'select':
      return [svc('select.select_option', 'Elegir opción', [{ key: 'option', label: 'Opción', type: caps.options?.length ? 'select' : 'text', ...(caps.options?.length ? { options: options(caps.options, SELECT_OPTION_LABELS) } : {}), required: true }])];
    case 'assist_satellite':
      return [
        svc('assist_satellite.announce', 'Anunciar', [{ key: 'message', label: 'Mensaje', type: 'text', required: true }]),
        svc('assist_satellite.start_conversation', 'Iniciar conversación', [{ key: 'start_message', label: 'Pregunta', type: 'text', required: true }]),
      ];
    case 'tts':
      return [
        svc('tts.speak', 'Decir (TTS)', [
          { key: 'media_player_entity_id', label: 'Reproductores (entity_id, separados por comas)', type: 'text', required: true },
          { key: 'message', label: 'Mensaje', type: 'text', required: true },
        ]),
      ];
    case 'camera':
      return [
        svc('camera.turn_on', 'Encender'),
        svc('camera.turn_off', 'Apagar'),
        svc('camera.snapshot', 'Hacer foto', [{ key: 'filename', label: 'Archivo', type: 'text', required: true }]),
        svc('camera.record', 'Grabar', [{ key: 'filename', label: 'Archivo', type: 'text', required: true }]),
      ];
    case 'button':
      return [svc('button.press', 'Pulsar')];
    case 'alarm_control_panel':
      return alarmServices(caps);
    case 'valve':
      return [svc('valve.open_valve', 'Abrir'), svc('valve.close_valve', 'Cerrar'), svc('valve.toggle', 'Alternar')];
    case 'siren':
      return ON_OFF('siren');
    case 'input_boolean':
    case 'input_number':
    case 'input_select':
    case 'input_text':
    case 'input_datetime':
    case 'timer':
    case 'counter':
      return helperServices(domain);
    case 'homeassistant':
      return ON_OFF('homeassistant');
    case 'notify':
      return [
        svc(NOTIFY_PERSISTENT, 'Notificación persistente', [
          { key: 'message', label: 'Mensaje', type: 'text', required: true },
          { key: 'title', label: 'Título', type: 'text' },
        ]),
      ];
    default:
      return [];
  }
}

const ALL_DOMAINS: ServiceDomain[] = ['light', 'switch', 'fan', 'cover', 'lock', 'climate', 'media_player', 'vacuum', 'camera', 'button', 'alarm_control_panel', 'valve', 'siren', 'select', 'assist_satellite', ...HELPER_DOMAINS, 'homeassistant', 'notify', 'tts'];



/** Metadatos de un servicio completo ("light.turn_on"), si la simulación lo soporta. */
export function serviceInfo(service: string): ServiceInfo | undefined {
  const domain = service.split('.')[0] ?? '';
  // Alexa Media Player: notify.alexa_media y notify.alexa_media_<echo> (anuncio o TTS en el Echo).
  if (service === 'notify.alexa_media' || service.startsWith('notify.alexa_media_')) {
    const fields: ServiceField[] = [{ key: 'message', label: 'Mensaje', type: 'text', required: true }];
    if (service === 'notify.alexa_media') fields.push({ key: 'target', label: 'Echos (nombres o entity_id)', type: 'text', required: true });
    return svc(service, 'Anuncio en Alexa', fields);
  }
  const full: EntityCapabilities = {
    colorModes: ['brightness', 'color_temp', 'rgb'],
    presetModes: ['eco'],
    fanModes: ['auto'],
    fanSpeeds: ['quiet', 'balanced', 'turbo', 'max'],
    alarmModes: ['armed_home', 'armed_away', 'armed_night', 'armed_vacation', 'armed_custom_bypass'],
  };
  return servicesForDomain(domain, full).find((s) => s.service === service);
}

/** Nombre en español de un servicio ("light.turn_on" → "Encender"); el propio servicio si no se conoce. */
export function serviceName(service: string): string {
  return serviceInfo(service)?.name ?? service;
}

/** ¿Soporta la simulación este servicio? */
export function isKnownService(service: string): boolean {
  const domain = service.split('.')[0] ?? '';
  return ALL_DOMAINS.some((d) => d === domain) && serviceInfo(service) !== undefined;
}

/** Campos obligatorios que faltan en los datos de una llamada (vacío si no falta ninguno o el servicio no se conoce). */
export function missingRequiredFields(service: string, data: Record<string, unknown> | undefined): ServiceField[] {
  const info = serviceInfo(service);
  if (!info) return [];
  return info.fields.filter((f) => f.required && (data?.[f.key] === undefined || data[f.key] === ''));
}

/** Grupos excluyentes con más de un campo rellenado (p. ej. brillo absoluto y relativo a la vez). */
export function exclusiveConflicts(service: string, data: Record<string, unknown> | undefined): ServiceField[][] {
  const info = serviceInfo(service);
  if (!info || !data) return [];
  const groups = new Map<string, ServiceField[]>();
  for (const f of info.fields) {
    if (f.exclusiveGroup === undefined || data[f.key] === undefined) continue;
    groups.set(f.exclusiveGroup, [...(groups.get(f.exclusiveGroup) ?? []), f]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}
