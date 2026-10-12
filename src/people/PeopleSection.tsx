import { useEffect, useState } from 'react';
import type { Person } from '../types';
import { useSimulationStore } from '../store/simulationStore';
import { personZoneId } from '../simulation/logic';
import { Button } from '../ui/Button';
import { TextField, inputClass } from '../ui/Field';
import { usePeople, useZones } from './zones';
import { addPerson, movePersonTo, removePerson, updatePerson } from './personActions';
import { ZonesSection } from './ZonesSection';
import { confirmDialog } from '../ui/confirm';

const OUTSIDE = '';

function PersonRow({ person }: { person: Person }) {
  const zones = useZones();
  const zoneId = useSimulationStore((s) => personZoneId(s.sim, person.id)) ?? OUTSIDE;
  const home = zones.find((z) => z.kind === 'home');
  const [name, setName] = useState(person.name);
  useEffect(() => setName(person.name), [person.name]);
  const commit = () => {
    const v = name.trim();
    if (v && v !== person.name) updatePerson(person.id, { name: v });
    else setName(person.name);
  };
  const atHome = home !== undefined && zoneId === home.id;
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5">
      <input
        type="color"
        aria-label={`Color de ${person.name}`}
        value={person.color ?? '#0ea5e9'}
        onChange={(e) => updatePerson(person.id, { color: e.target.value })}
        className="h-6 w-6 cursor-pointer rounded border border-slate-300"
      />
      <input
        aria-label="Nombre de la persona"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setName(person.name);
        }}
        className={`${inputClass} w-36`}
      />
      <label className="flex items-center gap-1 text-xs text-slate-600">
        Zona
        <select
          aria-label={`Zona de ${person.name}`}
          className={`${inputClass} w-36`}
          value={zoneId}
          onChange={(e) => movePersonTo(person.id, e.target.value)}
        >
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
          <option value={OUTSIDE}>Fuera (sin zona)</option>
        </select>
      </label>
      <span className={atHome ? 'text-xs font-semibold text-emerald-700' : 'text-xs text-slate-500'} aria-live="polite">
        {atHome ? '🏠 En casa' : zoneId === OUTSIDE ? '🚶 Fuera' : `📍 ${zones.find((z) => z.id === zoneId)?.name ?? zoneId}`}
      </span>
      <div className="ml-auto flex gap-1">
        <Button
          size="sm"
          variant="primary"
          aria-label={`Llegar a casa (${person.name})`}
          disabled={!home || atHome}
          onClick={() => home && movePersonTo(person.id, home.id)}
        >
          Llegar a casa
        </Button>
        <Button size="sm" aria-label={`Salir (${person.name})`} disabled={zoneId === OUTSIDE} onClick={() => movePersonTo(person.id, OUTSIDE)}>
          Salir
        </Button>
        <Button
          size="sm"
          variant="danger"
          aria-label={`Borrar a ${person.name}`}
          onClick={async () => {
            if (await confirmDialog({ title: `¿Borrar a «${person.name}»?`, confirmLabel: 'Borrar', danger: true })) removePerson(person.id);
          }}
        >
          ✕
        </Button>
      </div>
    </li>
  );
}

/** Sección «Personas»: alta y baja de personas, su zona y llegadas/salidas rápidas (B9). */
export function PeopleSection() {
  const people = usePeople();
  const [draft, setDraft] = useState('');
  const create = () => {
    const v = draft.trim();
    if (!v) return;
    addPerson(v);
    setDraft('');
  };
  return (
    <section aria-labelledby="people-title" className="flex flex-col gap-2">
      <h3 id="people-title" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Personas
      </h3>
      {people.length === 0 ? (
        <p className="text-xs text-slate-500">Sin personas. Añade a quien vive en la casa para usar disparadores de zona.</p>
      ) : (
        <ul className="flex flex-col gap-1" aria-label="Personas">
          {people.map((p) => (
            <PersonRow key={p.id} person={p} />
          ))}
        </ul>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <TextField label="Nueva persona" value={draft} placeholder="Ana" onChange={(e) => setDraft(e.target.value)} fieldClassName="w-48" />
        <Button type="submit" size="sm" disabled={!draft.trim()}>
          + Añadir persona
        </Button>
      </form>
      <ZonesSection />
    </section>
  );
}
