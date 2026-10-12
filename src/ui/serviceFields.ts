// Valores por defecto de los campos de datos de un servicio (funciones puras).
import type { EntityStateValue } from '../types';
import type { ServiceField } from '../simulation/serviceCatalog';
import { formatRgb } from '../devices/color';

export type ServiceDataRecord = Record<string, EntityStateValue>;

/** Valor inicial de un campo al incluirlo. */
export function defaultFieldValue(field: ServiceField): EntityStateValue {
  switch (field.type) {
    case 'percent':
      return 100;
    case 'kelvin':
      return Math.round(((field.min ?? 2000) + (field.max ?? 6500)) / 2 / 100) * 100;
    case 'temperature':
      return 21;
    case 'number':
      return field.min !== undefined && field.min > 0 ? field.min : 0;
    case 'color':
      return formatRgb([255, 180, 80]);
    case 'select':
      return field.options?.[0]?.value ?? '';
    case 'boolean':
      return true;
    case 'text':
      return '';
  }
}


/** Añade los campos obligatorios que falten con su valor por defecto. */
export function withRequiredDefaults(fields: ServiceField[], data: ServiceDataRecord | undefined): ServiceDataRecord | undefined {
  const missing = fields.filter((f) => f.required && data?.[f.key] === undefined);
  if (missing.length === 0) return data;
  const next: ServiceDataRecord = { ...data };
  for (const f of missing) next[f.key] = defaultFieldValue(f);
  return next;
}

/** Campos obligatorios sin valor. */
export function missingRequired(fields: ServiceField[], data: ServiceDataRecord | undefined): ServiceField[] {
  return fields.filter((f) => f.required && isEmptyValue(data?.[f.key]));
}

/** Sin valor: ausente o texto vacío. */
export function isEmptyValue(v: EntityStateValue | undefined): boolean {
  return v === undefined || (typeof v === 'string' && v.trim() === '');
}

/** Incluye un campo y quita los de su mismo grupo exclusivo (brillo absoluto o relativo...). */
export function includeField(fields: ServiceField[], data: ServiceDataRecord | undefined, field: ServiceField, value: EntityStateValue): ServiceDataRecord {
  const next: ServiceDataRecord = { ...data, [field.key]: value };
  if (field.exclusiveGroup) {
    for (const other of fields) if (other.key !== field.key && other.exclusiveGroup === field.exclusiveGroup) delete next[other.key];
  }
  return next;
}
