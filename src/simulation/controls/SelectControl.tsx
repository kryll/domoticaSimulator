import { useId } from 'react';
import { inputClass } from '../../ui/Field';
import { SELECT_OPTION_LABELS, labelOf } from '../../devices/labels';
import type { ControlProps } from './types';

/** Entidad select: elegir una de sus opciones (select.select_option). */
export function SelectControl({ definition, state, onService }: ControlProps) {
  const id = useId();
  const options = definition.capabilities?.options ?? [];
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="sr-only">
        {definition.name}
      </label>
      <select id={id} className={inputClass} value={String(state?.state ?? '')} onChange={(e) => onService('select_option', { option: e.target.value })}>
        {options.map((o) => (
          <option key={o} value={o}>
            {labelOf(SELECT_OPTION_LABELS, o)}
          </option>
        ))}
      </select>
    </div>
  );
}
