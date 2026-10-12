// Avisos al importar YAML de Home Assistant: claves que el simulador ignora y valores que no
// admite (se importan de forma parcial). Recorre el YAML ya leído, sin tocar el parser.
import { isYamlMap, type YamlContext, type YamlMap, type YamlValue } from '../export/yaml';
import { findRoomByArea } from '../devices/areas';
import { NOTIFY_PERSISTENT } from '../simulation/notify';

export interface YamlWarning {
  /** Ruta en el YAML: "triggers[0].attribute", "[2].actions[1].target.device_id"... */
  path: string;
  message: string;
}

type Out = YamlWarning[];

const join = (base: string, key: string): string => (base === '' ? key : `${base}.${key}`);
const at = (base: string, i: number): string => `${base}[${i}]`;

/** Claves que HA admite en cualquier paso y que el simulador no usa (no cambian el resultado). */
const HARMLESS = new Set(['alias', 'enabled']);

function ignoredKey(out: Out, path: string, key: string): void {
  out.push({ path: join(path, key), message: `Clave «${key}» ignorada: el simulador no la admite` });
}

/** Avisa de las claves de `m` fuera de `known`. */
function checkKeys(out: Out, m: YamlMap, path: string, known: readonly string[]): void {
  for (const key of Object.keys(m)) {
    if (known.includes(key) || HARMLESS.has(key)) continue;
    ignoredKey(out, path, key);
  }
}

function items(v: YamlValue | undefined): YamlValue[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Clave de la lista realmente usada (triggers o trigger...). */
function listKey(m: YamlMap, plural: string, singular: string): string | undefined {
  if (m[plural] !== undefined) return plural;
  return m[singular] !== undefined ? singular : undefined;
}

/** entity_id con varias entidades en disparadores y condiciones: solo se usa la primera. */
function checkSingleEntity(out: Out, m: YamlMap, path: string): void {
  const raw = m.entity_id;
  if (Array.isArray(raw) && raw.length > 1) {
    out.push({ path: join(path, 'entity_id'), message: `Hay ${raw.length} entidades y solo se usa la primera (${String(raw[0])})` });
  }
}

function checkStateValue(out: Out, m: YamlMap, path: string, key: string): void {
  const v = m[key];
  if (Array.isArray(v)) out.push({ path: join(path, key), message: `Una lista de estados en «${key}» no se admite: se ignora` });
}

const TRIGGER_KEYS: Record<string, readonly string[]> = {
  state: ['entity_id', 'from', 'to', 'for'],
  numeric_state: ['entity_id', 'above', 'below', 'for'],
  time: ['at'],
  sun: ['event', 'offset'],
  time_pattern: ['hours', 'minutes', 'seconds'],
  homeassistant: ['event'],
  event: ['event_type', 'event_data'],
  zone: ['entity_id', 'zone', 'event'],
  device: ['entity_id', 'subtype', 'action'],
};

/** Plataformas de disparador que el simulador no admite: el parser las descarta con un aviso. */
export const DROPPED_TRIGGERS: ReadonlySet<string> = new Set(['mqtt', 'webhook', 'template', 'tag', 'calendar', 'conversation', 'geo_location', 'persistent_notification']);

function checkTrigger(out: Out, v: YamlValue, path: string): void {
  if (!isYamlMap(v)) return;
  const platform = String(v.trigger ?? v.platform ?? '');
  if (DROPPED_TRIGGERS.has(platform)) {
    const extra = platform === 'mqtt' ? ` (tema «${String(v.topic ?? '')}»): el simulador no recibe mensajes MQTT` : ': el simulador no lo admite';
    out.push({ path, message: `Disparador «${platform}» ignorado${extra}` });
    return;
  }
  checkKeys(out, v, path, ['trigger', 'platform', 'id', ...(TRIGGER_KEYS[platform] ?? [])]);
  const many = Array.isArray(v.entity_id) && v.entity_id.length > 1;
  if (many && (platform === 'state' || platform === 'numeric_state')) {
    const n = Array.isArray(v.entity_id) ? v.entity_id.length : 0;
    out.push({ path: join(path, 'entity_id'), message: `Hay ${n} entidades: se crea un disparador por entidad${v.id === undefined ? '' : ' con el mismo id'}` });
  } else checkSingleEntity(out, v, path);
  if (platform === 'state') {
    checkStateValue(out, v, path, 'to');
    checkStateValue(out, v, path, 'from');
  }
}

const CONDITION_KEYS: Record<string, readonly string[]> = {
  state: ['entity_id', 'state', 'for'],
  numeric_state: ['entity_id', 'above', 'below'],
  time: ['after', 'before', 'weekday'],
  sun: ['after', 'before', 'after_offset', 'before_offset'],
  and: ['conditions'],
  or: ['conditions'],
  not: ['conditions'],
  zone: ['entity_id', 'zone'],
  trigger: ['id'],
};

function checkCondition(out: Out, v: YamlValue, path: string): void {
  if (!isYamlMap(v)) return;
  const kind = String(v.condition ?? '');
  checkKeys(out, v, path, ['condition', ...(CONDITION_KEYS[kind] ?? [])]);
  checkSingleEntity(out, v, path);
  if (kind === 'and' || kind === 'or' || kind === 'not') checkConditions(out, v.conditions, join(path, 'conditions'));
}

function checkConditions(out: Out, v: YamlValue | undefined, path: string): void {
  items(v).forEach((c, i) => checkCondition(out, c, Array.isArray(v) ? at(path, i) : path));
}

function checkActions(out: Out, v: YamlValue | undefined, path: string, ctx: YamlContext | undefined): void {
  items(v).forEach((a, i) => checkAction(out, a, Array.isArray(v) ? at(path, i) : path, ctx));
}

function checkTarget(out: Out, m: YamlMap, path: string, ctx: YamlContext | undefined): void {
  const target = m.target;
  if (target === undefined || target === null || !isYamlMap(target)) return;
  const tpath = join(path, 'target');
  checkKeys(out, target, tpath, ['entity_id', 'area_id']);
  if (!ctx?.rooms) return;
  for (const ref of items(target.area_id)) {
    if (typeof ref === 'string' && !findRoomByArea(ctx.rooms, ref)) {
      out.push({ path: join(tpath, 'area_id'), message: `El área «${ref}» no corresponde a ninguna sala del proyecto` });
    }
  }
}

function checkAction(out: Out, v0: YamlValue, path: string, ctx: YamlContext | undefined): void {
  if (!isYamlMap(v0)) return;
  // Tanda 3: continue_on_error se admite en cualquier acción.
  const v: YamlMap = { ...v0 };
  delete v.continue_on_error;
  if (v.stop !== undefined) return checkKeys(out, v, path, ['stop', 'error']);
  if (v.parallel !== undefined) {
    checkKeys(out, v, path, ['parallel']);
    items(v.parallel).forEach((b, i) => {
      const bpath = at(join(path, 'parallel'), i);
      if (isYamlMap(b) && b.sequence !== undefined) checkActions(out, b.sequence, join(bpath, 'sequence'), ctx);
      else checkAction(out, b, bpath, ctx);
    });
    return;
  }
  if (v.delay !== undefined && v.delay !== null) return checkKeys(out, v, path, ['delay']);
  if (v.choose !== undefined) {
    checkKeys(out, v, path, ['choose', 'default']);
    items(v.choose).forEach((o, i) => {
      const opath = at(join(path, 'choose'), i);
      if (!isYamlMap(o)) return;
      checkKeys(out, o, opath, ['conditions', 'sequence']);
      checkConditions(out, o.conditions, join(opath, 'conditions'));
      checkActions(out, o.sequence, join(opath, 'sequence'), ctx);
    });
    return checkActions(out, v.default, join(path, 'default'), ctx);
  }
  if (v.if !== undefined) {
    checkKeys(out, v, path, ['if', 'then', 'else']);
    checkConditions(out, v.if, join(path, 'if'));
    checkActions(out, v.then, join(path, 'then'), ctx);
    return checkActions(out, v.else, join(path, 'else'), ctx);
  }
  if (v.wait_for_trigger !== undefined) {
    checkKeys(out, v, path, ['wait_for_trigger', 'timeout', 'continue_on_timeout']);
    items(v.wait_for_trigger).forEach((t, i) => checkTrigger(out, t, Array.isArray(v.wait_for_trigger) ? at(join(path, 'wait_for_trigger'), i) : join(path, 'wait_for_trigger')));
    return;
  }
  if (v.repeat !== undefined) {
    checkKeys(out, v, path, ['repeat']);
    const r = v.repeat;
    if (!isYamlMap(r)) return;
    const rpath = join(path, 'repeat');
    checkKeys(out, r, rpath, ['count', 'while', 'until', 'sequence']);
    checkConditions(out, r.while, join(rpath, 'while'));
    checkConditions(out, r.until, join(rpath, 'until'));
    return checkActions(out, r.sequence, join(rpath, 'sequence'), ctx);
  }
  if (v.variables !== undefined) return checkKeys(out, v, path, ['variables']);
  if (typeof v.scene === 'string') return checkKeys(out, v, path, ['scene']);
  const service = typeof v.action === 'string' ? v.action : typeof v.service === 'string' ? v.service : '';
  const serviceKey = typeof v.action === 'string' ? 'action' : 'service';
  if (service !== NOTIFY_PERSISTENT && (service.startsWith('notify.') || service === 'persistent_notification.create')) {
    checkKeys(out, v, path, [serviceKey, 'data', 'target', 'entity_id']);
    const data = v.data;
    if (data !== undefined && isYamlMap(data)) checkKeys(out, data, join(path, 'data'), ['message', 'title']);
    return;
  }
  if (service === 'scene.turn_on' || service.startsWith('script.')) {
    checkKeys(out, v, path, [serviceKey, 'target', 'entity_id']);
    checkTarget(out, v, path, ctx);
    return;
  }
  checkKeys(out, v, path, [serviceKey, 'target', 'entity_id', 'data']);
  checkTarget(out, v, path, ctx);
}

const AUTOMATION_KEYS = ['id', 'alias', 'description', 'mode', 'initial_state', 'triggers', 'trigger', 'conditions', 'condition', 'actions', 'action'] as const;

/**
 * Avisos de una automatización en YAML (mapa ya leído). `base`: prefijo de la ruta ("" o "[2]").
 * Solo avisa: los errores que impiden importar los lanza el parser.
 */
export function collectYamlWarnings(m: YamlMap, base = '', ctx?: YamlContext): YamlWarning[] {
  const out: Out = [];
  checkKeys(out, m, base, AUTOMATION_KEYS);
  const tk = listKey(m, 'triggers', 'trigger');
  if (tk) items(m[tk]).forEach((t, i) => checkTrigger(out, t, Array.isArray(m[tk]) ? at(join(base, tk), i) : join(base, tk)));
  const ck = listKey(m, 'conditions', 'condition');
  if (ck) checkConditions(out, m[ck], join(base, ck));
  const ak = listKey(m, 'actions', 'action');
  if (ak) checkActions(out, m[ak], join(base, ak), ctx);
  checkBlueprintInputs(out, m, base);
  return out;
}

/** Avisa de las entradas de blueprint (`!input nombre`): su valor no se puede resolver aquí. */
function checkBlueprintInputs(out: Out, v: YamlValue, path: string): void {
  if (typeof v === 'string') {
    if (/^!input(\s|$)/.test(v)) {
      const name = v.slice('!input'.length).trim();
      out.push({ path, message: `Entrada de blueprint «!input ${name}»: el simulador no resuelve blueprints, pon la entidad o el valor real` });
    }
    return;
  }
  if (Array.isArray(v)) {
    v.forEach((x, i) => checkBlueprintInputs(out, x, at(path, i)));
    return;
  }
  if (isYamlMap(v)) for (const [k, x] of Object.entries(v)) checkBlueprintInputs(out, x, join(path, k));
}
