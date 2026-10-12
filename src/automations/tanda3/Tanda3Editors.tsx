import { useState } from 'react';
import type { Action, EventTrigger, HomeAssistantTrigger, ParallelAction, StopAction, TimePatternTrigger } from '../../types';
import { SelectField, TextField } from '../../ui/Field';
import { dataToInput, parseDataInput } from '../../ui/formValues';
import { ListEditor } from '../ListEditor';
import { ActionListEditor } from '../ActionEditor';
import { useProjectStore } from '../../store/projectStore';

function Header({ children }: { children: string }) {
  return <div className="mb-1 text-xs font-semibold text-slate-700">{children}</div>;
}

/** Texto legible de un patrón de hora («cada 5 minutos», «a las 7:00:00»...). */
export function describeTimePattern(t: Pick<TimePatternTrigger, 'hours' | 'minutes' | 'seconds'>): string {
  const part = (v: string | undefined, unit: [string, string]) => {
    if (v === undefined || v === '' || v === '*') return null;
    if (v.startsWith('/')) return `cada ${v.slice(1)} ${Number(v.slice(1)) === 1 ? unit[0] : unit[1]}`;
    return `${unit[0]} ${v}`;
  };
  const bits = [part(t.hours, ['hora', 'horas']), part(t.minutes, ['minuto', 'minutos']), part(t.seconds, ['segundo', 'segundos'])].filter(
    (b): b is string => b !== null,
  );
  return bits.length === 0 ? 'cada segundo' : bits.join(', ');
}

const PATTERN = /^(\*|\/?\d{1,2})?$/;

export function TimePatternTriggerEditor({ value, onChange }: { value: TimePatternTrigger; onChange: (t: TimePatternTrigger) => void }) {
  const field = (key: 'hours' | 'minutes' | 'seconds', label: string) => {
    const v = value[key] ?? '';
    return (
      <TextField
        label={label}
        value={v}
        placeholder="*"
        aria-invalid={!PATTERN.test(v)}
        hint={!PATTERN.test(v) ? 'Usa un número, «*» o «/5»' : undefined}
        onChange={(e) => {
          const next = { ...value };
          const text = e.target.value.trim();
          if (text === '') delete next[key];
          else next[key] = text;
          onChange(next);
        }}
      />
    );
  };
  return (
    <div>
      <Header>Patrón de hora</Header>
      <div className="grid grid-cols-3 gap-2">
        {field('hours', 'Horas')}
        {field('minutes', 'Minutos')}
        {field('seconds', 'Segundos')}
      </div>
      <p className="mt-1 text-xs text-slate-600">Dispara {describeTimePattern(value)}. «/5» = cada 5; «*» = cualquiera.</p>
    </div>
  );
}

export function HomeAssistantTriggerEditor({ value, onChange }: { value: HomeAssistantTrigger; onChange: (t: HomeAssistantTrigger) => void }) {
  return (
    <div>
      <Header>Home Assistant</Header>
      <SelectField
        label="Evento"
        value={value.event}
        options={[
          { value: 'start', label: 'Arranque de Home Assistant' },
          { value: 'shutdown', label: 'Parada de Home Assistant' },
        ]}
        onChange={(e) => onChange({ ...value, event: e.target.value as HomeAssistantTrigger['event'] })}
      />
    </div>
  );
}

/** Eventos habituales del bus de HA (sugerencias del campo). */
export const COMMON_EVENTS = ['timer.finished', 'timer.started', 'timer.cancelled', 'zha_event', 'call_service', 'automation_triggered', 'mobile_app_notification_action'];

export function EventTriggerEditor({ value, onChange }: { value: EventTrigger; onChange: (t: EventTrigger) => void }) {
  const helpers = useProjectStore((s) => s.project.helpers ?? []);
  const [draft, setDraft] = useState(() => dataToInput(value.eventData));
  return (
    <div>
      <Header>Evento</Header>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <TextField
          label="Tipo de evento"
          list="ha-event-types"
          placeholder="timer.finished"
          value={value.eventType}
          onChange={(e) => onChange({ ...value, eventType: e.target.value.trim() })}
        />
        <datalist id="ha-event-types">
          {COMMON_EVENTS.map((e) => (
            <option key={e} value={e} />
          ))}
        </datalist>
        <TextField
          label="Datos del evento (clave=valor)"
          placeholder={helpers.some((h) => h.type === 'timer') ? 'entity_id=timer.…' : 'entity_id=…'}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            const parsed = parseDataInput(e.target.value);
            const next = { ...value };
            if (!parsed || Object.keys(parsed).length === 0) delete next.eventData;
            else next.eventData = parsed;
            onChange(next);
          }}
        />
      </div>
    </div>
  );
}

export function StopActionEditor({ value, onChange }: { value: StopAction; onChange: (a: StopAction) => void }) {
  return (
    <div>
      <Header>Detener</Header>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr,1fr] sm:items-end">
        <TextField label="Motivo" placeholder="Nadie en casa" value={value.message} onChange={(e) => onChange({ ...value, message: e.target.value })} />
        <label className="flex min-h-[2rem] items-center gap-1.5 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={value.error === true}
            onChange={(e) => {
              const next = { ...value };
              if (e.target.checked) next.error = true;
              else delete next.error;
              onChange(next);
            }}
            className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
          />
          Terminar con error
        </label>
      </div>
    </div>
  );
}

export function ParallelActionEditor({ value, onChange }: { value: ParallelAction; onChange: (a: ParallelAction) => void }) {
  return (
    <div>
      <Header>En paralelo</Header>
      <div className="flex flex-col gap-2 border-l-2 border-violet-200 pl-2">
        <ListEditor<Action[]>
          title="Ramas"
          items={value.branches}
          onChange={(branches) => onChange({ ...value, branches })}
          renderItem={(branch, update, i) => <ActionListEditor title={`Rama ${i + 1}`} actions={branch} onChange={update} />}
          addOptions={[{ label: 'Rama', create: () => [] }]}
          emptyText="Añade al menos dos ramas: se ejecutan a la vez y la secuencia sigue cuando terminan todas."
        />
      </div>
    </div>
  );
}
