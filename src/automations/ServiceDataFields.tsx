import { useId } from 'react';
import type { EntityStateValue } from '../types';
import type { ServiceField } from '../simulation/serviceCatalog';
import { formatRgb, parseRgb } from '../devices/color';
import { inputClass } from '../ui/Field';
import { cx } from '../ui/cx';

export type ServiceDataRecord = Record<string, EntityStateValue>;

const toHex = (n: number) => n.toString(16).padStart(2, '0');

function numberOf(v: EntityStateValue | undefined): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

/** Valor inicial de un campo al incluirlo. */
function defaultValue(field: ServiceField): EntityStateValue {
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

function FieldControl({
  field,
  value,
  onChange,
  id,
}: {
  field: ServiceField;
  value: EntityStateValue;
  onChange: (v: EntityStateValue) => void;
  id: string;
}) {
  switch (field.type) {
    case 'percent':
    case 'kelvin': {
      const n = numberOf(value) ?? 0;
      return (
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="range"
            min={field.min ?? 0}
            max={field.max ?? 100}
            step={field.step ?? 1}
            value={n}
            aria-valuetext={`${n} ${field.unit ?? ''}`.trim()}
            onChange={(e) => onChange(Number(e.target.value))}
            className={cx('min-w-0 flex-1', field.type === 'kelvin' && 'ha-kelvin-range')}
          />
          <span className="w-16 shrink-0 text-right text-xs tabular-nums text-slate-700">
            {n} {field.unit}
          </span>
        </div>
      );
    }
    case 'temperature':
    case 'number': {
      const n = numberOf(value);
      return (
        <div className="flex items-center gap-1">
          <input
            id={id}
            type="number"
            className={inputClass}
            min={field.min}
            max={field.max}
            step={field.step ?? (field.type === 'temperature' ? 0.5 : 1)}
            value={n ?? ''}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (e.target.value !== '' && Number.isFinite(v)) onChange(v);
            }}
          />
          {field.unit && <span className="text-xs text-slate-600">{field.unit}</span>}
        </div>
      );
    }
    case 'color': {
      const rgb = parseRgb(typeof value === 'boolean' ? undefined : value) ?? [255, 255, 255];
      return (
        <input
          id={id}
          type="color"
          className="h-8 w-16 cursor-pointer rounded border border-slate-300 bg-white"
          value={`#${rgb.map(toHex).join('')}`}
          onChange={(e) => {
            const parsed = parseRgb(e.target.value);
            if (parsed) onChange(formatRgb(parsed));
          }}
        />
      );
    }
    case 'select':
      return (
        <select id={id} className={inputClass} value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case 'boolean':
      return (
        <select id={id} className={inputClass} value={value === true || value === 'true' ? 'true' : 'false'} onChange={(e) => onChange(e.target.value === 'true')}>
          <option value="true">Sí</option>
          <option value="false">No</option>
        </select>
      );
    case 'text':
      return <input id={id} className={inputClass} value={String(value)} onChange={(e) => onChange(e.target.value)} />;
  }
}

export interface ServiceDataFieldsProps {
  fields: ServiceField[];
  value: ServiceDataRecord | undefined;
  onChange: (data: ServiceDataRecord | undefined) => void;
}

/** Datos de una llamada a servicio con campos tipados; cada campo es opcional («Incluir»). */
export function ServiceDataFields({ fields, value, onChange }: ServiceDataFieldsProps) {
  const baseId = useId();
  if (fields.length === 0) return <p className="text-xs text-slate-500">Este servicio no necesita datos.</p>;
  const set = (key: string, v: EntityStateValue | undefined) => {
    const next: ServiceDataRecord = { ...value };
    if (v === undefined) delete next[key];
    else next[key] = v;
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };
  return (
    <div className="flex flex-col gap-1.5" role="group" aria-label="Datos del servicio">
      {fields.map((field) => {
        const id = `${baseId}-${field.key}`;
        const current = value?.[field.key];
        const included = current !== undefined;
        return (
          <div key={field.key} className="grid grid-cols-[8.5rem,1fr] items-center gap-2">
            <span className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={included}
                aria-label={`Incluir ${field.label}`}
                onChange={(e) => set(field.key, e.target.checked ? defaultValue(field) : undefined)}
                className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
              />
              <label htmlFor={included ? id : undefined} className={cx('text-xs font-medium', included ? 'text-slate-700' : 'text-slate-400')}>
                {field.label}
              </label>
            </span>
            {included ? (
              <FieldControl field={field} value={current} id={id} onChange={(v) => set(field.key, v)} />
            ) : (
              <span id={id} className="text-xs italic text-slate-400">
                sin cambiar
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
