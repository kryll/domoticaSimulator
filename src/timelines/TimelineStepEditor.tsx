import type { AssertOp, TimelineAssertStep, TimelineEventKind, TimelineEventStep, TimelineStep } from '../types';
import { useProjectStore } from '../store/projectStore';
import { EntityPicker } from '../automations/EntityPicker';
import { PersonSelect } from '../people/pickers';
import { useZones } from '../people/zones';
import { SelectField, TextField } from '../ui/Field';
import { EVENT_LABELS, OP_LABELS } from './labels';
import { dataToInput, parseDataInput, parseStateInput, stateToInput } from '../ui/formValues';

function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <TextField label="Hora" type="time" step={1} value={value} onChange={(e) => onChange(e.target.value)} fieldClassName="w-32" />;
}

function EventFields({ step, onChange }: { step: TimelineEventStep; onChange: (s: TimelineEventStep) => void }) {
  const scenes = useProjectStore((s) => s.project.scenes);
  const scripts = useProjectStore((s) => s.project.scripts);
  const zones = useZones();
  switch (step.event) {
    case 'state':
      return (
        <>
          <EntityPicker label="Entidad" value={step.entityId ?? ''} onChange={(entityId) => onChange({ ...step, entityId })} />
          <TextField label="Nuevo estado" value={stateToInput(step.value)} onChange={(e) => onChange({ ...step, value: parseStateInput(e.target.value) })} />
        </>
      );
    case 'service':
      return (
        <>
          <EntityPicker label="Entidad" value={step.entityId ?? ''} onChange={(entityId) => onChange({ ...step, entityId })} />
          <TextField label="Servicio" placeholder="turn_on" value={step.service ?? ''} onChange={(e) => onChange({ ...step, service: e.target.value })} />
          <TextField
            label="Datos (clave=valor)"
            defaultValue={dataToInput(step.data)}
            onBlur={(e) => onChange({ ...step, data: parseDataInput(e.target.value) })}
          />
        </>
      );
    case 'motion':
      return <EntityPicker label="Sensor de movimiento" domains={['binary_sensor']} value={step.entityId ?? ''} onChange={(entityId) => onChange({ ...step, entityId })} />;
    case 'button':
      return (
        <>
          <EntityPicker label="Mando" domains={['sensor']} value={step.entityId ?? ''} onChange={(entityId) => onChange({ ...step, entityId })} />
          <TextField label="Acción" placeholder="single" value={stateToInput(step.value)} onChange={(e) => onChange({ ...step, value: e.target.value })} />
        </>
      );
    case 'door':
      return (
        <>
          <EntityPicker label="Sensor de apertura" domains={['binary_sensor']} value={step.entityId ?? ''} onChange={(entityId) => onChange({ ...step, entityId })} />
          <SelectField
            label="Acción"
            value={step.value === false ? 'close' : 'open'}
            options={[
              { value: 'open', label: 'Abrir' },
              { value: 'close', label: 'Cerrar' },
            ]}
            onChange={(e) => onChange({ ...step, value: e.target.value === 'open' })}
          />
        </>
      );
    case 'person':
      return (
        <>
          <PersonSelect value={step.personId ?? ''} onChange={(personId) => onChange({ ...step, personId })} />
          <SelectField
            label="Zona"
            value={step.zoneId ?? ''}
            options={[...zones.map((z) => ({ value: z.id, label: z.name })), { value: '', label: 'Fuera (sin zona)' }]}
            onChange={(e) => onChange({ ...step, zoneId: e.target.value })}
          />
        </>
      );
    case 'scene':
      return (
        <SelectField
          label="Escena"
          value={step.sceneId ?? ''}
          placeholder="— Elige una escena —"
          options={scenes.map((s) => ({ value: s.id, label: s.name }))}
          onChange={(e) => onChange({ ...step, sceneId: e.target.value })}
        />
      );
    case 'script':
      return (
        <SelectField
          label="Script"
          value={step.scriptId ?? ''}
          placeholder="— Elige un script —"
          options={scripts.map((s) => ({ value: s.id, label: s.name }))}
          onChange={(e) => onChange({ ...step, scriptId: e.target.value })}
        />
      );
  }
}

function AssertFields({ step, onChange }: { step: TimelineAssertStep; onChange: (s: TimelineAssertStep) => void }) {
  return (
    <>
      <EntityPicker label="Entidad" value={step.entityId} onChange={(entityId) => onChange({ ...step, entityId })} />
      <TextField
        label="Atributo (opcional)"
        placeholder="brightness"
        value={step.attribute ?? ''}
        onChange={(e) => onChange({ ...step, attribute: e.target.value || undefined })}
      />
      <SelectField
        label="Comparación"
        value={step.op ?? 'eq'}
        options={(Object.keys(OP_LABELS) as AssertOp[]).map((op) => ({ value: op, label: OP_LABELS[op] }))}
        onChange={(e) => onChange({ ...step, op: e.target.value as AssertOp })}
      />
      <TextField label="Valor esperado" value={stateToInput(step.expect)} onChange={(e) => onChange({ ...step, expect: parseStateInput(e.target.value) ?? '' })} />
    </>
  );
}

/** Editor de un paso de la línea de tiempo: evento o aserción. */
export function TimelineStepEditor({ value, onChange }: { value: TimelineStep; onChange: (s: TimelineStep) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <TimeInput value={value.at} onChange={(at) => onChange({ ...value, at })} />
        <span
          className={
            value.kind === 'assert'
              ? 'rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-800'
              : 'rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800'
          }
        >
          {value.kind === 'assert' ? 'Comprobar' : 'Evento'}
        </span>
        {value.kind === 'event' && (
          <SelectField
            label="Tipo de evento"
            value={value.event}
            options={(Object.keys(EVENT_LABELS) as TimelineEventKind[]).map((k) => ({ value: k, label: EVENT_LABELS[k] }))}
            onChange={(e) => onChange({ at: value.at, kind: 'event', event: e.target.value as TimelineEventKind })}
            fieldClassName="w-48"
          />
        )}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {value.kind === 'event' ? <EventFields step={value} onChange={onChange} /> : <AssertFields step={value} onChange={onChange} />}
      </div>
    </div>
  );
}
