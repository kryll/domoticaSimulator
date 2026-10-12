import { useState } from 'react';
import { TextField } from '../ui/Field';
import { durationToInput, parseDurationInput } from '../ui/formValues';

/** Campo «Durante (min:s)» para el `for:` de disparadores y condiciones de estado. */
export function DurationField({
  value,
  onChange,
  label = 'Durante (min:s)',
}: {
  value: number | undefined;
  onChange: (seconds: number | undefined) => void;
  label?: string;
}) {
  const [draft, setDraft] = useState(() => durationToInput(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (parseDurationInput(draft) !== value) setDraft(durationToInput(value));
  }
  const parsed = parseDurationInput(draft);
  return (
    <TextField
      label={label}
      value={draft}
      placeholder="0:00"
      inputMode="numeric"
      aria-invalid={parsed === null}
      hint={parsed === null ? 'Formato min:s, p. ej. 2:30' : undefined}
      onChange={(e) => {
        setDraft(e.target.value);
        const next = parseDurationInput(e.target.value);
        if (next !== null && next !== value) onChange(next);
      }}
    />
  );
}
