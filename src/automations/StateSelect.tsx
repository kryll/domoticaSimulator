import { useId, useState } from 'react';
import type { EntityStateValue } from '../types';
import { useStateOptions } from './useStateOptions';
import { inputClass } from '../ui/Field';
import { parseStateInput, stateToInput } from '../ui/formValues';

const OTHER = '__other__';

export interface StateSelectProps {
  label: string;
  entityId: string;
  value: EntityStateValue | undefined;
  onChange: (value: EntityStateValue | undefined) => void;
  /** Texto de la opción vacía («cualquiera»); sin él el estado es obligatorio. */
  emptyLabel?: string;
}

/**
 * Selector de estado con los estados traducidos de la entidad («Encendida», «Detectado»…) y la
 * opción «Otro…» para escribir un valor libre.
 */
export function StateSelect({ label, entityId, value, onChange, emptyLabel }: StateSelectProps) {
  const options = useStateOptions(entityId);
  const id = useId();
  const text = stateToInput(value);
  const known = options.some((o) => o.value === text);
  const [forceOther, setForceOther] = useState(false);
  const other = forceOther || (text !== '' && !known) || options.length === 0;
  const selectValue = other ? OTHER : text;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-slate-600">
        {label}
      </label>
      {options.length > 0 && (
        <select
          id={id}
          className={inputClass}
          value={selectValue}
          onChange={(e) => {
            const v = e.target.value;
            if (v === OTHER) {
              setForceOther(true);
              return;
            }
            setForceOther(false);
            onChange(v === '' ? undefined : v);
          }}
        >
          <option value="">{emptyLabel ?? 'Elige un estado…'}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          <option value={OTHER}>Otro…</option>
        </select>
      )}
      {other && (
        <input
          id={options.length === 0 ? id : undefined}
          aria-label={options.length === 0 ? undefined : `${label}: otro valor`}
          className={inputClass}
          value={text}
          placeholder={options.length === 0 ? (emptyLabel ?? 'Estado') : 'Valor exacto (p. ej. on)'}
          onChange={(e) => onChange(parseStateInput(e.target.value))}
        />
      )}
    </div>
  );
}
