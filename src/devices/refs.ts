// Referencias de personas y zonas (person.<slug>, zone.<slug>) y sus inversas. Funciones puras y
// pequeñas: las usa el motor desde la carga inicial, sin arrastrar el generador de YAML.
import type { Id, Person, Zone } from '../types';
import { slugify } from './entities';

/** Contexto de personas y zonas (Project las tiene opcionales). */
export interface PeopleContext {
  people?: Person[];
  zones?: Zone[];
}

/** Id de la zona «Casa» implícita cuando el proyecto no define ninguna de tipo home. */
export const HOME_ZONE_ID = 'home';

/** entity_id de una persona: person.<slug del nombre> (o del id si no se conoce). */
export function personRef(personId: Id, ctx: PeopleContext): string {
  const person = ctx.people?.find((p) => p.id === personId);
  return `person.${slugify(person ? person.name : personId)}`;
}

/** entity_id de una zona: zone.home para la de casa; zone.<slug del nombre> para las demás. */
export function zoneRef(zoneId: Id, ctx: PeopleContext): string {
  const zone = ctx.zones?.find((z) => z.id === zoneId);
  if (zoneId === HOME_ZONE_ID || zone?.kind === 'home') return 'zone.home';
  return `zone.${slugify(zone ? zone.name : zoneId)}`;
}

/** Inversa de personRef: id de la persona (sin contexto, el texto tras el punto). */
export function resolvePersonRef(ref: string, ctx: PeopleContext): Id {
  const key = ref.replace(/^person\./, '');
  if (!ctx.people) return key;
  const person = ctx.people.find((p) => p.id === key || slugify(p.name) === key);
  if (!person) throw new Error(`Persona desconocida: ${ref}`);
  return person.id;
}

/** Inversa de zoneRef: id de la zona. zone.home -> la zona de tipo home o «home». */
export function resolveZoneRef(ref: string, ctx: PeopleContext): Id {
  const key = ref.replace(/^zone\./, '');
  if (key === 'home') return ctx.zones?.find((z) => z.kind === 'home')?.id ?? HOME_ZONE_ID;
  if (!ctx.zones) return key;
  const zone = ctx.zones.find((z) => z.id === key || slugify(z.name) === key);
  if (!zone) throw new Error(`Zona desconocida: ${ref}`);
  return zone.id;
}
