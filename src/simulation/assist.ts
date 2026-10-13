// Intérprete de intenciones sencillo al estilo de Assist (HassTurnOn, HassTurnOff, HassLightSet,
// HassSetPosition, HassClimateSetTemperature, HassGetState, HassVacuumStart...) y ejecución de
// una frase dicha a un asistente (Assist, Alexa o Google) sobre el motor.
//
// parseIntent es puro: recibe la frase y las entidades candidatas. sayToAssistant aplica la
// intención con callService (la misma vía que las automatizaciones), comprueba la exposición
// de las entidades al asistente y la conexión a Internet de los asistentes de nube.
import type { AssistantInfo, Device, DeviceDefinition, EntityState, EntityStateValue, Id, Project, ServiceData, SimulationState, VoiceTarget } from '../types';
import { entitiesForDevice } from '../devices/entities';
import { allDefinitions } from '../devices/catalog';
import { stateLabel } from '../devices/stateLabels';
import { normalizeUtterance } from './conversation';
import { activateScene, callService, findScene, fireConversation, scheduleTimer, setEntityState } from './engine';
import { addLog } from './simLog';
import { internetAvailable, isHaRestarting } from './connectivity';
import { entityTimerKey } from './timers';
import { ASSISTANT_LABELS, OFFLINE_REPLY, isExposed, speechSeconds, withSpeech } from './voice';

export type IntentName =
  | 'HassTurnOn'
  | 'HassTurnOff'
  | 'HassLightSet'
  | 'HassSetPosition'
  | 'HassClimateSetTemperature'
  | 'HassGetState'
  | 'HassVacuumStart'
  | 'HassVacuumReturnToBase'
  | 'HassSceneActivate';

/** Entidad que un asistente puede manejar (nombre, área y alias normalizados). */
export interface IntentEntity {
  entityId: string;
  domain: string;
  /** Nombre del dispositivo. */
  name: string;
  deviceClass?: string;
  areaId?: Id;
  areaName?: string;
  aliases?: string[];
  deviceId?: Id;
}

export interface IntentScene {
  id: string;
  name: string;
}

export interface Intent {
  name: IntentName;
  /** Entidades de destino (vacío en HassSceneActivate). */
  entityIds: string[];
  /** Nombre con el que se refirió al destino («la luz del salón»). */
  target: string;
  data?: ServiceData;
  /** HassGetState: qué se pregunta. */
  query?: 'temperature' | 'humidity' | 'state';
  sceneId?: string;
  areaId?: Id;
}

export type ParseResult = { ok: true; intent: Intent } | { ok: false; reason: 'not_understood' | 'no_target'; target?: string };

// ---------- Normalización ----------

const WAKE = /^(oye |hey |ok |okay )?(alexa|google|siri|nabu|jarvis)\b\s*/;

/** Quita la palabra de activación («Alexa, …», «Ok Google, …») y normaliza. */
export function stripWakeWord(text: string): string {
  return normalizeUtterance(text).replace(WAKE, '').trim();
}

const STOP = new Set(['el', 'la', 'los', 'las', 'del', 'de', 'en', 'al', 'a', 'un', 'una', 'mi', 'por', 'favor', 'y', 'que', 'todo', 'todas', 'todos', 'toda']);

/** Singular sencillo para comparar («luces» → «luz», «persianas» → «persiana»). */
function stem(w: string): string {
  if (w === 'luces') return 'luz';
  return w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w;
}

const tokens = (s: string): string[] =>
  normalizeUtterance(s)
    .split(' ')
    .filter((t) => t !== '' && !STOP.has(t))
    .map(stem);

/** Palabras que indican el tipo de dispositivo. */
const DOMAIN_WORDS: Array<[RegExp, string[]]> = [
  [/\b(luz|luces|lampara|lamparas|bombilla|bombillas|foco|focos|tira)\b/, ['light']],
  [/\b(persiana|persianas|toldo|toldos|cortina|cortinas|estor|estores)\b/, ['cover']],
  [/\b(calefaccion|termostato|aire acondicionado|aire|climatizacion|radiador)\b/, ['climate']],
  [/\b(enchufe|enchufes|interruptor|rele)\b/, ['switch']],
  [/\b(ventilador|ventiladores)\b/, ['fan', 'switch']],
  [/\b(tele|television|televisor|altavoz|altavoces|musica)\b/, ['media_player']],
  [/\b(robot|aspiradora|aspirador|roomba)\b/, ['vacuum']],
  [/\b(cerradura|cerrojo)\b/, ['lock']],
  [/\b(valvula|riego)\b/, ['valve']],
];

function domainHint(text: string): string[] | undefined {
  for (const [re, domains] of DOMAIN_WORDS) if (re.test(text)) return domains;
  return undefined;
}

const CONTROLLABLE = new Set(['light', 'switch', 'fan', 'cover', 'climate', 'media_player', 'lock', 'vacuum', 'valve']);

function containsAll(hay: Set<string>, needle: string[]): boolean {
  return needle.length > 0 && needle.every((t) => hay.has(t));
}

/** Área nombrada en la frase (la de nombre más largo). */
function findArea(text: string, entities: IntentEntity[]): { id: Id; name: string } | undefined {
  const hay = new Set(tokens(text));
  const areas = new Map<Id, string>();
  for (const e of entities) if (e.areaId && e.areaName) areas.set(e.areaId, e.areaName);
  let best: { id: Id; name: string; n: number } | undefined;
  for (const [id, name] of areas) {
    const t = tokens(name);
    if (containsAll(hay, t) && (!best || t.length > best.n)) best = { id, name, n: t.length };
  }
  return best ? { id: best.id, name: best.name } : undefined;
}

/**
 * Entidades a las que se refiere la frase: por nombre del dispositivo o alias (todas sus
 * palabras en la frase) o, si no, por área y tipo de dispositivo.
 */
export function resolveTargets(text: string, entities: IntentEntity[], domains?: string[]): { entityIds: string[]; areaId?: Id } {
  const hay = new Set(tokens(text));
  const hint = domains ?? domainHint(text);
  const fits = (e: IntentEntity): boolean => (hint ? hint.includes(e.domain) : CONTROLLABLE.has(e.domain));
  let bestScore = 0;
  let byName: IntentEntity[] = [];
  for (const e of entities) {
    if (!fits(e)) continue;
    const names = [e.name, ...(e.aliases ?? [])];
    const score = Math.max(0, ...names.map((n) => (containsAll(hay, tokens(n)) ? tokens(n).length : 0)));
    if (score === 0) continue;
    if (score > bestScore) {
      bestScore = score;
      byName = [e];
    } else if (score === bestScore) byName.push(e);
  }
  const area = findArea(text, entities);
  // «Las luces del salón» (plural con área) son todas las del área; un nombre que es solo el
  // del área («Salón») tampoco gana a «la luz del salón».
  const plural = /\b(luces|lamparas|persianas|toldos|cortinas|estores|enchufes)\b/.test(normalizeUtterance(text));
  if (byName.length > 0 && !(area && hint && (plural || bestScore <= tokens(area.name).length))) {
    return { entityIds: byName.map((e) => e.entityId) };
  }
  if (area) {
    const inArea = entities.filter((e) => e.areaId === area.id && (hint ? hint.includes(e.domain) : e.domain === 'light'));
    if (inArea.length > 0) return { entityIds: inArea.map((e) => e.entityId), areaId: area.id };
  }
  if (byName.length > 0) return { entityIds: byName.map((e) => e.entityId) };
  // Sin nombre ni área: si solo hay un dispositivo de ese tipo («el robot»), es ese.
  if (hint) {
    const only = entities.filter((e) => hint.includes(e.domain));
    if (only.length === 1 && only[0]) return { entityIds: [only[0].entityId] };
  }
  return { entityIds: [] };
}

const num = (s: string | undefined): number | undefined => {
  if (s === undefined) return undefined;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};

function intent(name: IntentName, rest: string, entities: IntentEntity[], extra: Partial<Intent> = {}, domains?: string[]): ParseResult {
  const t = resolveTargets(rest, entities, domains);
  const target = rest.trim();
  if (t.entityIds.length === 0) return { ok: false, reason: 'no_target', target };
  const i: Intent = { name, entityIds: t.entityIds, target, ...extra };
  if (t.areaId !== undefined) i.areaId = t.areaId;
  return { ok: true, intent: i };
}

/** Interpreta una frase en español (sin acentos, tolerante con signos y artículos). */
export function parseIntent(text: string, entities: IntentEntity[], scenes: IntentScene[] = []): ParseResult {
  const t = stripWakeWord(text);
  if (t === '') return { ok: false, reason: 'not_understood' };
  let m: RegExpExecArray | null;

  // Escenas: «activa la escena Cine», «pon la escena noche».
  m = /^(?:activa|pon|ejecuta|enciende|lanza)\s+(?:la\s+)?escena\s+(.+)$/.exec(t);
  if (m?.[1]) {
    const wanted = tokens(m[1]);
    const scene = scenes.find((s) => containsAll(new Set(wanted), tokens(s.name)) || containsAll(new Set(tokens(s.name)), wanted));
    if (!scene) return { ok: false, reason: 'no_target', target: m[1] };
    return { ok: true, intent: { name: 'HassSceneActivate', entityIds: [], target: scene.name, sceneId: scene.id } };
  }

  // Preguntas: temperatura y humedad.
  m = /^(?:que|cual es la|cuanta)\s+(temperatura|humedad)\s+(?:hace|hay|tiene)?\s*(.*)$/.exec(t);
  if (m?.[1] !== undefined) {
    const query = m[1] === 'humedad' ? 'humidity' : 'temperature';
    const rest = m[2] ?? '';
    const area = findArea(rest, entities);
    const sensors = entities.filter((e) => e.domain === 'sensor' && e.deviceClass === query && (!area || e.areaId === area.id));
    const climates = query === 'temperature' ? entities.filter((e) => e.domain === 'climate' && (!area || e.areaId === area.id)) : [];
    const ids = (sensors.length > 0 ? sensors : climates).map((e) => e.entityId);
    if (ids.length === 0) return { ok: false, reason: 'no_target', target: rest };
    const i: Intent = { name: 'HassGetState', entityIds: ids, target: area?.name ?? rest, query };
    if (area) i.areaId = area.id;
    return { ok: true, intent: i };
  }
  m = /^(?:esta|estan|sigue|siguen)\s+(encendid[ao]s?|apagad[ao]s?|abiert[ao]s?|cerrad[ao]s?)\s+(.+)$/.exec(t) ?? /^(?:esta|estan)\s+(.+?)\s+(encendid[ao]s?|apagad[ao]s?|abiert[ao]s?|cerrad[ao]s?)$/.exec(t);
  if (m?.[1] && m[2]) {
    const rest = /^(encend|apagad|abiert|cerrad)/.test(m[1]) ? m[2] : m[1];
    return intent('HassGetState', rest, entities, { query: 'state' });
  }

  // Climatización: «pon la calefacción a 22 grados», «sube el termostato del salón a 21,5».
  m = /^(?:pon|sube|baja|ajusta|cambia|fija)\s+(.*?)\s*(?:a|en)\s+(\d+(?:[.,]\d+)?)\s*(?:grados|º|°c?)?$/.exec(t);
  if (m?.[2] && /\b(calefaccion|termostato|temperatura|aire|climatizacion|radiador)\b/.test(m[1] ?? '')) {
    return intent('HassClimateSetTemperature', m[1] ?? '', entities, { data: { temperature: num(m[2]) ?? 21 } }, ['climate']);
  }

  // Posición de persianas: «pon la persiana al 50 %», «sube la persiana del dormitorio al 80».
  m = /^(?:pon|sube|baja|abre|cierra|deja|ajusta)\s+(.*?)\s*(?:al?|hasta el?)\s+(\d+)\s*(?:%|por ciento)?$/.exec(t);
  if (m?.[2] && /\b(persiana|persianas|toldo|toldos|cortina|cortinas|estor|estores)\b/.test(m[1] ?? '')) {
    return intent('HassSetPosition', m[1] ?? '', entities, { data: { position: Math.max(0, Math.min(100, num(m[2]) ?? 0)) } }, ['cover']);
  }
  // Brillo: «pon la luz del salón al 30 %», «baja las luces de la cocina al 10 por ciento».
  if (m?.[2]) {
    return intent('HassLightSet', m[1] ?? '', entities, { data: { brightness_pct: Math.max(0, Math.min(100, num(m[2]) ?? 0)) } }, ['light']);
  }

  // Robot aspirador: «limpia la cocina», «pon el robot a limpiar», «manda el robot a la base».
  m = /^(?:manda|envia|devuelve|lleva|vuelve)\s+(.*?)\s*(?:a|a la)\s+(?:la\s+)?(?:base|cargar)$/.exec(t);
  if (m && /\b(robot|aspiradora|aspirador|roomba)\b/.test(t)) return intent('HassVacuumReturnToBase', m[1] ?? '', entities, {}, ['vacuum']);
  m = /^(?:limpia|aspira|friega|pasa el robot por|pasa la aspiradora por|pon (?:el robot|la aspiradora) a limpiar)\s*(.*)$/.exec(t);
  if (m) {
    const rest = m[1] ?? '';
    const robots = entities.filter((e) => e.domain === 'vacuum');
    const named = resolveTargets(rest, robots, ['vacuum']).entityIds;
    const ids = named.length > 0 ? named : robots.map((e) => e.entityId).slice(0, 1);
    if (ids.length === 0) return { ok: false, reason: 'no_target', target: 'el robot aspirador' };
    const area = findArea(rest, entities);
    const i: Intent = { name: 'HassVacuumStart', entityIds: ids, target: area?.name ?? 'la casa' };
    if (area) i.areaId = area.id;
    return { ok: true, intent: i };
  }

  // Encender y apagar (abrir y cerrar en persianas).
  m = /^(?:enciende|enciendeme|prende|activa|abre|pon en marcha|conecta)\s+(.+)$/.exec(t);
  if (m?.[1]) return intent('HassTurnOn', m[1], entities);
  m = /^(?:apaga|apagame|desactiva|cierra|para|deten|desconecta)\s+(.+)$/.exec(t);
  if (m?.[1]) return intent('HassTurnOff', m[1], entities);
  return { ok: false, reason: 'not_understood' };
}

// ---------- Candidatos del proyecto ----------

/** Entidades del proyecto que un asistente puede manejar (todas, sin filtrar la exposición). */
export function intentEntities(project: Pick<Project, 'devices' | 'rooms' | 'customDefinitions'>, defs: DeviceDefinition[] = allDefinitions(project)): IntentEntity[] {
  const rooms = new Map(project.rooms.map((r) => [r.id, r.name]));
  const out: IntentEntity[] = [];
  for (const device of project.devices) {
    const def = defs.find((d) => d.id === device.definitionId);
    if (!def) continue;
    for (const e of entitiesForDevice(device, def)) {
      const d = e.definition;
      const sensor = d.domain === 'sensor' && (d.deviceClass === 'temperature' || d.deviceClass === 'humidity');
      if (!CONTROLLABLE.has(d.domain) && !sensor) continue;
      // El reproductor de un altavoz inteligente no es «la tele»: solo cuenta si el usuario lo nombra.
      const item: IntentEntity = { entityId: e.entityId, domain: d.domain, name: device.name, deviceId: device.id };
      if (d.deviceClass !== undefined) item.deviceClass = d.deviceClass;
      const area = device.roomId ? rooms.get(device.roomId) : undefined;
      if (device.roomId && area) {
        item.areaId = device.roomId;
        item.areaName = area;
      }
      if (device.aliases && device.aliases.length > 0) item.aliases = device.aliases;
      out.push(item);
    }
  }
  return out;
}

// ---------- Ejecución ----------

export interface AssistReply {
  sim: SimulationState;
  /** Respuesta hablada. */
  response: string;
  /** Intención reconocida (si la hubo). */
  intent?: Intent;
  /** true si se ha hecho algo (o se ha respondido a una pregunta). */
  ok: boolean;
}

const fmt = (n: number): string => String(Math.round(n * 10) / 10).replace('.', ',');

function stateWord(domain: string, st: EntityStateValue): string {
  return stateLabel(domain, st).toLowerCase();
}

/** Servicio de HA de una intención sobre una entidad. */
function serviceFor(i: Intent, domain: string): { service: string; data?: ServiceData } | undefined {
  switch (i.name) {
    case 'HassTurnOn':
      if (domain === 'cover') return { service: 'cover.open_cover' };
      if (domain === 'lock') return { service: 'lock.lock' };
      if (domain === 'vacuum') return { service: 'vacuum.start' };
      if (domain === 'valve') return { service: 'valve.open_valve' };
      return { service: `${domain}.turn_on` };
    case 'HassTurnOff':
      if (domain === 'cover') return { service: 'cover.close_cover' };
      if (domain === 'lock') return undefined; // por seguridad no se abre una cerradura por voz
      if (domain === 'vacuum') return { service: 'vacuum.return_to_base' };
      if (domain === 'valve') return { service: 'valve.close_valve' };
      return { service: `${domain}.turn_off` };
    case 'HassLightSet':
      return domain === 'light' ? { service: 'light.turn_on', data: i.data ?? {} } : undefined;
    case 'HassSetPosition':
      return domain === 'cover' ? { service: 'cover.set_cover_position', data: i.data ?? {} } : undefined;
    case 'HassClimateSetTemperature':
      return domain === 'climate' ? { service: 'climate.set_temperature', data: i.data ?? {} } : undefined;
    case 'HassVacuumStart':
      return domain === 'vacuum' ? (i.areaId ? { service: 'vacuum.clean_area', data: { cleaning_area_id: i.areaId } } : { service: 'vacuum.start' }) : undefined;
    case 'HassVacuumReturnToBase':
      return domain === 'vacuum' ? { service: 'vacuum.return_to_base' } : undefined;
    default:
      return undefined;
  }
}

function doneText(i: Intent, names: string): string {
  switch (i.name) {
    case 'HassTurnOn':
      return `He encendido ${names}`;
    case 'HassTurnOff':
      return `He apagado ${names}`;
    case 'HassLightSet':
      return `Brillo de ${names} al ${String(i.data?.brightness_pct ?? '')} %`;
    case 'HassSetPosition':
      return `${names} al ${String(i.data?.position ?? '')} %`;
    case 'HassClimateSetTemperature':
      return `Temperatura de ${names} a ${fmt(Number(i.data?.temperature ?? 0))} grados`;
    case 'HassVacuumStart':
      return `El robot empieza a limpiar ${i.target}`;
    case 'HassVacuumReturnToBase':
      return 'El robot vuelve a la base';
    default:
      return 'Hecho';
  }
}

function answer(i: Intent, sim: SimulationState): string {
  const states = i.entityIds.map((id) => ({ id, st: sim.entities[id] })).filter((x): x is { id: string; st: EntityState } => x.st !== undefined);
  if (states.length === 0) return 'No tengo ese dato';
  if (i.query === 'temperature' || i.query === 'humidity') {
    const values = states
      .map(({ id, st }) => (id.startsWith('climate.') ? Number(st.attributes?.current_temperature) : Number(st.state)))
      .filter((n) => Number.isFinite(n));
    if (values.length === 0) return 'No tengo ese dato ahora mismo';
    const avg = values.reduce((s, n) => s + n, 0) / values.length;
    const where = i.areaId ? ` en ${i.target}` : '';
    return i.query === 'temperature' ? `${where ? `En ${i.target}` : 'Ahora'} hace ${fmt(avg)} grados` : `La humedad${where} es del ${Math.round(avg)} %`;
  }
  const first = states[0];
  if (!first) return 'No tengo ese dato';
  const domain = first.id.split('.')[0] ?? '';
  const name = String(first.st.attributes?.friendly_name ?? first.id);
  return `${name} está ${stateWord(domain, first.st.state)}`;
}

function failedText(target: string): string {
  return `No he podido hacerlo: ${target} no responde`;
}

/** Destino de voz del asistente del dispositivo (Siri no tiene exposición desde HA). */
function voiceTarget(info: AssistantInfo): VoiceTarget | undefined {
  return info.kind === 'siri' ? undefined : info.kind;
}

/** Cambia el estado del satélite (assist_satellite) si lo tiene. */
function satelliteState(sim: SimulationState, project: Project, satelliteId: string | undefined, state: string, quiet: boolean): SimulationState {
  if (!satelliteId || !sim.entities[satelliteId] || sim.entities[satelliteId]?.state === 'unavailable') return sim;
  return setEntityState(sim, project, satelliteId, state, { quiet, record: false });
}

/**
 * Frase dicha al asistente del dispositivo `deviceId`. Assist ejecuta primero las frases
 * personalizadas (disparador conversation) y después las intenciones; Alexa y Google solo
 * manejan las entidades expuestas y necesitan Internet. Deja la frase y la respuesta en el
 * registro y en la burbuja del nodo.
 */
export function sayToAssistant(sim: SimulationState, project: Project, deviceId: Id, text: string): AssistReply {
  const defs = allDefinitions(project);
  const device: Device | undefined = project.devices.find((d) => d.id === deviceId);
  const def = device ? defs.find((d) => d.id === device.definitionId) : undefined;
  const info = def?.assistant;
  if (!device || !def || !info) return { sim, response: '', ok: false };
  const refs = entitiesForDevice(device, def);
  const satellite = refs.find((r) => r.definition.domain === 'assist_satellite')?.entityId;
  const main = satellite ?? refs[0]?.entityId;
  const extra = main ? { entityId: main } : {};
  const said = text.trim();
  if (said === '') return { sim, response: '', ok: false };
  const failures = sim.failures;
  const powerless = failures?.powerOutage === true && device.ups !== true;
  const noInternet = failures !== undefined && (failures.internet || failures.powerOutage) && !internetAvailable(project, defs, failures);
  // Sin Internet el Echo o el Nest siguen encendidos (HA los ve no disponibles), pero no entienden.
  const cloudDown = info.pipeline === 'cloud' && noInternet && !powerless && !failures?.devicesDown.includes(device.id);
  if (!cloudDown && (powerless || sim.offline?.[device.id] || (main && sim.entities[main]?.state === 'unavailable'))) {
    return { sim: addLog(sim, 'warning', `«${device.name}» no está disponible: no oye nada`, extra), response: '', ok: false };
  }
  const muted = refs.find((r) => r.definition.key === 'mute');
  if (muted && sim.entities[muted.entityId]?.state === 'on') {
    return { sim: addLog(sim, 'warning', `«${device.name}» tiene el micrófono silenciado`, extra), response: '', ok: false };
  }
  let result = addLog(withSpeech(sim, device.id, said, 'heard'), 'info', `🗣 A «${device.name}»: «${said}»`, extra);
  result = satelliteState(result, project, satellite, 'listening', true);
  result = satelliteState(result, project, satellite, 'processing', true);

  const finish = (s: SimulationState, response: string, ok: boolean, level: 'info' | 'warning' | 'error' = 'info', i?: Intent): AssistReply => {
    let r = addLog(withSpeech(s, device.id, response, 'response'), level, `💬 «${device.name}» (${ASSISTANT_LABELS[info.kind]}): «${response}»`, extra);
    if (satellite && r.entities[satellite]) {
      r = satelliteState(r, project, satellite, 'responding', false);
      r = scheduleTimer(r, entityTimerKey(satellite), r.now + speechSeconds(response) * 1000, { kind: 'set_states', setStates: { [satellite]: { state: 'idle' } } });
    }
    const reply: AssistReply = { sim: r, response, ok };
    if (i) reply.intent = i;
    return reply;
  };

  if (cloudDown) {
    return finish(addLog(result, 'error', `Sin Internet, ${ASSISTANT_LABELS[info.kind]} no entiende nada: el control por voz no funciona`, extra), OFFLINE_REPLY, false, 'warning');
  }
  if (isHaRestarting(result)) return finish(result, 'No puedo conectar con Home Assistant ahora mismo', false, 'warning');
  const target = voiceTarget(info);
  if (!target) {
    return finish(result, 'Siri solo maneja lo que está en la app Casa (con el puente HomeKit de HA); el simulador no lo modela', false, 'warning');
  }

  // Assist: las frases personalizadas tienen prioridad sobre las intenciones.
  if (target === 'assist') {
    const conv = fireConversation(result, project, said, device.id);
    if (conv.matched) return finish(conv.sim, 'Hecho', true);
  }

  const all = intentEntities(project, defs);
  const exposedDevices = new Set(project.devices.filter((d) => isExposed(d, target)).map((d) => d.id));
  const exposed = all.filter((e) => e.deviceId !== undefined && exposedDevices.has(e.deviceId));
  const scenes = project.scenes.map((s) => ({ id: s.id, name: s.name }));
  const parsed = parseIntent(said, exposed, scenes);
  if (!parsed.ok) {
    if (parsed.reason === 'no_target') {
      // ¿Existe pero no está expuesta a este asistente?
      const hidden = parseIntent(said, all, scenes);
      if (hidden.ok) {
        const names = [...new Set(hidden.intent.entityIds.map((id) => String(result.entities[id]?.attributes?.friendly_name ?? id)))].join(', ');
        const logged = addLog(result, 'warning', `${names}: no está expuesto a ${ASSISTANT_LABELS[target]} (Propiedades → Asistentes)`, extra);
        return finish(logged, `No encuentro «${parsed.target ?? 'eso'}» entre tus dispositivos`, false, 'warning');
      }
      return finish(result, `No encuentro «${parsed.target ?? 'eso'}» entre tus dispositivos`, false, 'warning');
    }
    return finish(result, 'Lo siento, no te he entendido', false, 'warning');
  }
  const i = parsed.intent;
  if (i.name === 'HassSceneActivate' && i.sceneId) {
    const scene = findScene(project, i.sceneId);
    if (!scene) return finish(result, 'No encuentro esa escena', false, 'warning', i);
    const r = activateScene(result, project, scene.id);
    return finish(r, `Escena ${scene.name} activada`, true, 'info', i);
  }
  if (i.name === 'HassGetState') return finish(result, answer(i, result), true, 'info', i);

  let r = result;
  const names: string[] = [];
  let failed = false;
  let lockRefused = false;
  for (const id of i.entityIds) {
    const domain = id.split('.')[0] ?? '';
    const call = serviceFor(i, domain);
    if (!call) {
      if (domain === 'lock') lockRefused = true;
      continue;
    }
    const before = r.log.length;
    r = callService(r, project, id, call.service, call.data);
    const errors = r.log.slice(before).some((e) => (e.level === 'error' || e.level === 'warning') && e.entityId === id && !e.message.startsWith('🗣'));
    if (errors) failed = true;
    names.push(String(r.entities[id]?.attributes?.friendly_name ?? id));
  }
  if (lockRefused && names.length === 0) return finish(r, 'Por seguridad, no abro cerraduras por voz', false, 'warning', i);
  if (names.length === 0) return finish(r, 'Eso no lo sé hacer con ese dispositivo', false, 'warning', i);
  const label = names.length > 2 ? `${names.length} dispositivos` : names.join(' y ');
  if (failed) return finish(r, failedText(label), false, 'warning', i);
  return finish(r, doneText(i, label), true, 'info', i);
}

/** Frases de ejemplo para el campo «Decir…». */
export const EXAMPLE_PHRASES = ['Enciende la luz del salón', '¿Qué temperatura hace en el dormitorio?', 'Pon la persiana al 50 %', 'Activa la escena Cine', 'Apaga la luz del pasillo', 'Limpia la cocina'];
