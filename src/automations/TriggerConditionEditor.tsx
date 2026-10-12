import { useId, useState } from 'react';
import type { TriggerCondition } from '../types';
import { useTriggerIds } from './triggerIdsContext';
import { Button } from '../ui/Button';
import { inputClass } from '../ui/Field';

/** Condición «Disparado por» (`condition: trigger`): ids de los disparadores de la automatización. */
export function TriggerConditionEditor({ value, onChange }: { value: TriggerCondition; onChange: (c: TriggerCondition) => void }) {
  const available = useTriggerIds();
  const [draft, setDraft] = useState('');
  const inputId = useId();
  const all = [...new Set([...available, ...value.ids])];
  const toggle = (id: string, on: boolean) =>
    onChange({ ...value, ids: on ? [...new Set([...value.ids, id])] : value.ids.filter((x) => x !== id) });
  const addDraft = () => {
    const id = draft.trim();
    if (!id) return;
    toggle(id, true);
    setDraft('');
  };

  return (
    <div className="flex flex-col gap-2">
      {all.length === 0 ? (
        <p className="text-xs text-slate-600">
          Ningún disparador tiene ID. Escribe uno en «ID del disparador» o añádelo aquí.
        </p>
      ) : (
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
          <legend className="sr-only">Disparadores</legend>
          {all.map((id) => (
            <label key={id} className="flex items-center gap-1.5 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={value.ids.includes(id)}
                onChange={(e) => toggle(id, e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
              />
              <code className="text-xs">{id}</code>
              {!available.includes(id) && <span className="text-[11px] text-amber-700">(no existe)</span>}
            </label>
          ))}
        </fieldset>
      )}
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={inputId} className="text-xs font-medium text-slate-600">
            Otro ID
          </label>
          <input
            id={inputId}
            className={inputClass}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addDraft();
              }
            }}
          />
        </div>
        <Button size="sm" onClick={addDraft} disabled={draft.trim() === ''}>
          Añadir
        </Button>
      </div>
    </div>
  );
}
