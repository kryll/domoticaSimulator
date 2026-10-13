// Voz: satélites de Assist (assist_satellite), anuncios en altavoces (Alexa Media Player,
// Google Cast con tts.speak) y burbujas de voz del lienzo. Funciones puras.
import type { AssistantInfo, Device, DeviceDefinition, EntityState, EntityStateValue, Id, Project, ServiceData, SimulationState, SpeechBubble, VoiceTarget } from '../types';
import { entitiesForDevice, slugify } from '../devices/entities';
import { isCloud } from '../devices/catalog';
import { effectiveIotClass } from '../devices/roles';

type Attrs = Record<string, EntityStateValue>;

/** Respuesta de Alexa y Google sin Internet. */
export const OFFLINE_REPLY = 'Lo siento, ahora mismo no puedo conectarme';

/** Entidades TTS virtuales de HA: Piper es local; Google Translate necesita Internet. */
export const TTS_ENTITIES: Record<string, { name: string; cloud: boolean }> = {
  'tts.piper': { name: 'Piper (local)', cloud: false },
  'tts.google_translate_es_es': { name: 'Google Translate (nube)', cloud: true },
};

export function ttsEntities(): Record<string, EntityState> {
  const out: Record<string, EntityState> = {};
  for (const [id, t] of Object.entries(TTS_ENTITIES)) out[id] = { state: 'unknown', attributes: { friendly_name: t.name } };
  return out;
}

/** Segundos que tarda en decir un texto (2-15 s). */
export function speechSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(2, Math.min(15, Math.round(1 + words * 0.4)));
}

/**
 * Servicios de assist_satellite: announce (dice un mensaje y vuelve a reposo) y
 * start_conversation (pregunta y queda escuchando la respuesta).
 */
export function assistSatelliteService(
  service: string,
  current: EntityState,
  data: ServiceData,
): { state: EntityState; warnings: string[]; after?: { seconds: number; state: EntityState }; then?: { seconds: number; state: EntityState } } | undefined {
  const attrs: Attrs = { ...current.attributes };
  const text = (k: string): string | undefined => (data[k] === undefined || Array.isArray(data[k]) ? undefined : String(data[k]));
  const base = (state: string, a: Attrs): EntityState => {
    const next: EntityState = { state, attributes: a };
    if (current.lastChanged !== undefined) next.lastChanged = current.lastChanged;
    return next;
  };
  if (service === 'announce') {
    const message = text('message') ?? text('media_id');
    if (message === undefined || message.trim() === '') return { state: base(String(current.state), attrs), warnings: ['Falta "message" en assist_satellite.announce'] };
    return { state: base('responding', { ...attrs, last_announcement: message }), warnings: [], after: { seconds: speechSeconds(message), state: { state: 'idle' } } };
  }
  if (service === 'start_conversation') {
    const message = text('start_message') ?? '';
    const seconds = message === '' ? 1 : speechSeconds(message);
    return {
      state: base('responding', { ...attrs, last_announcement: message }),
      warnings: [],
      after: { seconds, state: { state: 'listening' } },
      // Sin respuesta en 8 s, vuelve a reposo (como el satélite real).
      then: { seconds: seconds + 8, state: { state: 'idle' } },
    };
  }
  return undefined;
}

/** Deja la burbuja de voz de un dispositivo. */
export function withSpeech(sim: SimulationState, deviceId: Id, text: string, kind: SpeechBubble['kind']): SimulationState {
  return { ...sim, speech: { ...sim.speech, [deviceId]: { text, at: sim.now, kind } } };
}

/** Asistente de voz del dispositivo (del catálogo). */
export function assistantOf(def: DeviceDefinition | undefined): AssistantInfo | undefined {
  return def?.assistant;
}

/** Asistentes a los que se expone el dispositivo (por defecto, solo Assist). */
export function exposedTargets(device: Pick<Device, 'exposedTo'>): VoiceTarget[] {
  return device.exposedTo ?? ['assist'];
}

export function isExposed(device: Pick<Device, 'exposedTo'>, target: VoiceTarget): boolean {
  return exposedTargets(device).includes(target);
}

/** ¿El asistente depende de la nube (Alexa, Google, Siri)? */
export function isCloudAssistant(info: AssistantInfo | undefined): boolean {
  return info?.pipeline === 'cloud';
}

/** Prefijo de la palabra de activación («Alexa, », «Ok Google, »...). */
export function wakePrefix(info: AssistantInfo | undefined): string {
  switch (info?.kind) {
    case 'alexa':
      return 'Alexa, ';
    case 'google':
      return 'Ok Google, ';
    case 'siri':
      return 'Oye Siri, ';
    default:
      return '';
  }
}

export const ASSISTANT_LABELS: Record<VoiceTarget | 'siri', string> = { assist: 'Assist', alexa: 'Alexa', google: 'Google Assistant', siri: 'Siri' };

/** Dispositivos con Alexa Media Player (para notify.alexa_media_*). */
function alexaDevices(project: Pick<Project, 'devices'>, defs: DeviceDefinition[]): Array<{ device: Device; def: DeviceDefinition }> {
  const out: Array<{ device: Device; def: DeviceDefinition }> = [];
  for (const device of project.devices) {
    const def = defs.find((d) => d.id === device.definitionId);
    if (def && device.integration === 'alexa_media_player') out.push({ device, def });
  }
  return out;
}

/** Servicio notify de Alexa Media Player de un Echo: notify.alexa_media_<nombre>. */
export function alexaNotifyService(device: Pick<Device, 'name'>): string {
  return `notify.alexa_media_${slugify(device.name)}`;
}

export function isAlexaNotify(service: string): boolean {
  return service === 'notify.alexa_media' || service.startsWith('notify.alexa_media_');
}

/**
 * Echos a los que va un notify de Alexa Media Player: el del nombre del servicio o, con
 * notify.alexa_media, los de `target` (entity_id del reproductor o nombre del Echo).
 */
export function alexaNotifyTargets(project: Pick<Project, 'devices'>, defs: DeviceDefinition[], service: string, data: ServiceData | undefined): Device[] {
  const all = alexaDevices(project, defs);
  if (service.startsWith('notify.alexa_media_')) {
    const slug = service.slice('notify.alexa_media_'.length);
    return all.filter((x) => slugify(x.device.name) === slug).map((x) => x.device);
  }
  const raw = data?.target;
  const wanted = (Array.isArray(raw) ? raw.map(String) : String(raw ?? '').split(','))
    .map((x) => x.replace(/[[\]"']/g, '').trim())
    .filter((x) => x !== '');
  return all
    .filter((x) => wanted.some((w) => w === x.device.name || slugify(w) === slugify(x.device.name) || entitiesForDevice(x.device, x.def).some((e) => e.entityId === w)))
    .map((x) => x.device);
}

/** Reproductores de un tts.speak (media_player_entity_id: texto con uno o varios, o lista). */
export function ttsTargets(data: ServiceData | undefined): string[] {
  const raw = data?.media_player_entity_id;
  if (raw === undefined) return [];
  const list = Array.isArray(raw) ? raw.map(String) : String(raw).replace(/[[\]"']/g, '').split(',');
  return list.map((x) => x.trim()).filter((x) => x !== '');
}

/** Dispositivo dueño de una entidad (por su entity_id). */
export function deviceOfEntity(project: Pick<Project, 'devices'>, defs: DeviceDefinition[], entityId: string): Device | undefined {
  for (const device of project.devices) {
    const def = defs.find((d) => d.id === device.definitionId);
    if (def && entitiesForDevice(device, def).some((e) => e.entityId === entityId)) return device;
  }
  return undefined;
}

/** ¿El dispositivo usa una integración de nube con su integración actual? */
export function deviceIsCloud(device: Device, def: DeviceDefinition): boolean {
  return isCloud(effectiveIotClass(device, def));
}

/** Activa o quita un asistente en la exposición de un dispositivo (sin repetir; orden estable). */
export function toggleExposure(device: Pick<Device, 'exposedTo'>, target: VoiceTarget, on: boolean): VoiceTarget[] {
  const current = exposedTargets(device);
  const set = new Set(current);
  if (on) set.add(target);
  else set.delete(target);
  return (['assist', 'alexa', 'google'] as const).filter((t) => set.has(t));
}

/**
 * «Exponer todos los de esta sala»: los dispositivos de la sala con entidades controlables
 * pasan a estar expuestos a `target`. Devuelve [id, exposedTo] de los que cambian.
 */
export function exposeRoom(project: Pick<Project, 'devices'>, defs: DeviceDefinition[], roomId: Id, target: VoiceTarget): Array<[Id, VoiceTarget[]]> {
  const controllable = new Set(['light', 'switch', 'fan', 'cover', 'climate', 'lock', 'media_player', 'vacuum', 'valve', 'sensor', 'binary_sensor']);
  const out: Array<[Id, VoiceTarget[]]> = [];
  for (const d of project.devices) {
    if (d.roomId !== roomId || isExposed(d, target)) continue;
    const def = defs.find((x) => x.id === d.definitionId);
    if (!def || def.assistant || !def.entities.some((e) => controllable.has(e.domain))) continue;
    out.push([d.id, toggleExposure(d, target, true)]);
  }
  return out;
}

/** ¿Se usa el control por voz de Alexa o Google en la nube (algo expuesto y un altavoz suyo)? */
export function cloudVoiceInUse(project: Pick<Project, 'devices' | 'customDefinitions'>, defs: DeviceDefinition[]): Array<'alexa' | 'google'> {
  const kinds: Array<'alexa' | 'google'> = [];
  for (const kind of ['alexa', 'google'] as const) {
    const speaker = project.devices.some((d) => defs.find((x) => x.id === d.definitionId)?.assistant?.kind === kind);
    const exposed = project.devices.some((d) => d.exposedTo?.includes(kind));
    if (speaker && exposed) kinds.push(kind);
  }
  return kinds;
}
