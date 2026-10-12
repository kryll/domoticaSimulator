import { SelectField } from '../ui/Field';
import { usePeople, useZones } from './zones';

export function PersonSelect({ value, onChange, label = 'Persona' }: { value: string; onChange: (id: string) => void; label?: string }) {
  const people = usePeople();
  const known = people.some((p) => p.id === value);
  return (
    <SelectField
      label={label}
      value={value}
      placeholder="— Elige una persona —"
      options={[
        ...people.map((p) => ({ value: p.id, label: p.name })),
        ...(value && !known ? [{ value, label: `${value} (no existe)` }] : []),
      ]}
      onChange={(e) => onChange(e.target.value)}
      hint={people.length === 0 ? 'Crea personas en la pestaña Hogar.' : undefined}
    />
  );
}

export function ZoneSelect({ value, onChange, label = 'Zona' }: { value: string; onChange: (id: string) => void; label?: string }) {
  const zones = useZones();
  return (
    <SelectField
      label={label}
      value={value}
      options={zones.map((z) => ({ value: z.id, label: z.name }))}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
