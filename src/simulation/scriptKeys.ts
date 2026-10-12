// Claves (object_id) de los scripts: slug del nombre, con sufijo _2, _3... si se repite. Única
// fuente para la exportación YAML (scripts.yaml), los entity_id script.<clave> y findScript.
import type { Id, Script } from '../types';
import { slugify } from '../devices/entities';

const cache = new WeakMap<readonly Script[], Record<Id, string>>();

/** id del script -> clave, en el orden del proyecto (calculado una vez por lista de scripts). */
export function scriptKeys(scripts: readonly Script[]): Record<Id, string> {
  const hit = cache.get(scripts);
  if (hit) return hit;
  const keys: Record<Id, string> = {};
  const used = new Set<string>();
  for (const s of scripts) {
    const base = slugify(s.name);
    let key = base;
    for (let n = 2; used.has(key); n++) key = `${base}_${n}`;
    used.add(key);
    keys[s.id] = key;
  }
  cache.set(scripts, keys);
  return keys;
}

/** entity_id script.<clave> de un script (o script.<id> si no está en la lista). */
export function scriptEntityId(scripts: readonly Script[], id: Id): string {
  return `script.${scriptKeys(scripts)[id] ?? id}`;
}
