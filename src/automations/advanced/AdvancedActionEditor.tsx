import { useRef, useState, type ReactNode } from 'react';
import type {
  Action,
  ChooseAction,
  ChooseOption,
  EntityStateValue,
  IfAction,
  NotifyAction,
  RepeatAction,
  Trigger,
  VariablesAction,
  WaitForTriggerAction,
} from '../../types';
import { ADVANCED_ACTION_LABELS } from '../../ui/advancedAutomationOptions';
import { triggerFactories } from '../../ui/automationOptions';
import { SelectField, TextAreaField, TextField } from '../../ui/Field';
import { dataToInput, parseDataInput, parseNumberInput } from '../../ui/formValues';
import { ListEditor } from '../ListEditor';
import { ActionListEditor } from '../ActionEditor';
import { TriggerEditor } from '../TriggerEditor';
import { DurationField } from '../DurationField';
import { ConditionListEditor } from './ConditionListEditor';
import { NestedScope, VariableHelp } from './VariableHelp';
import { insertAt } from './scopeVars';

type AdvancedAction = Extract<Action, { type: keyof typeof ADVANCED_ACTION_LABELS }>;

function Header({ type }: { type: AdvancedAction['type'] }) {
  return <div className="mb-1 text-xs font-semibold text-slate-700">{ADVANCED_ACTION_LABELS[type]}</div>;
}

/** Bloque con sangría para las secuencias anidadas. */
function Nested({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2 border-l-2 border-sky-200 pl-2">{children}</div>;
}

function ChooseEditor({ value, onChange }: { value: ChooseAction; onChange: (a: ChooseAction) => void }) {
  return (
    <div>
      <Header type="choose" />
      <Nested>
        <ListEditor<ChooseOption>
          title="Opciones"
          items={value.choices}
          onChange={(choices) => onChange({ ...value, choices })}
          renderItem={(option, update, i) => (
            <div className="flex flex-col gap-2">
              <ConditionListEditor
                title={`Opción ${i + 1}: si se cumple`}
                conditions={option.conditions}
                onChange={(conditions) => update({ ...option, conditions })}
                emptyText="Sin condiciones: esta opción se elige siempre."
              />
              <ActionListEditor
                title={`Opción ${i + 1}: entonces`}
                actions={option.sequence}
                onChange={(sequence) => update({ ...option, sequence })}
              />
            </div>
          )}
          addOptions={[{ label: 'Opción', create: () => ({ conditions: [], sequence: [] }) }]}
          emptyText="Añade al menos una opción."
        />
        <ActionListEditor
          title="Si no se cumple ninguna (por defecto)"
          actions={value.default ?? []}
          onChange={(actions) => {
            const next: ChooseAction = { ...value, default: actions };
            if (actions.length === 0) delete next.default;
            onChange(next);
          }}
        />
      </Nested>
    </div>
  );
}

function IfEditor({ value, onChange }: { value: IfAction; onChange: (a: IfAction) => void }) {
  return (
    <div>
      <Header type="if" />
      <Nested>
        <ConditionListEditor
          title="Si"
          conditions={value.conditions}
          onChange={(conditions) => onChange({ ...value, conditions })}
          emptyText="Sin condiciones: se ejecuta siempre «entonces»."
        />
        <ActionListEditor title="Entonces" actions={value.then} onChange={(then) => onChange({ ...value, then })} />
        <ActionListEditor
          title="Si no"
          actions={value.else ?? []}
          onChange={(actions) => {
            const next: IfAction = { ...value, else: actions };
            if (actions.length === 0) delete next.else;
            onChange(next);
          }}
        />
      </Nested>
    </div>
  );
}

function WaitEditor({ value, onChange }: { value: WaitForTriggerAction; onChange: (a: WaitForTriggerAction) => void }) {
  return (
    <div>
      <Header type="wait_for_trigger" />
      <Nested>
        <ListEditor<Trigger>
          title="Esperar a"
          items={value.triggers}
          onChange={(triggers) => onChange({ ...value, triggers })}
          renderItem={(t, update) => <TriggerEditor value={t} onChange={update} />}
          addOptions={triggerFactories}
          emptyText="Añade el disparador que se espera."
        />
        <p className="text-[11px] text-slate-500">
          Puedes esperar a una hora («Hora»), al amanecer o al atardecer con desfase («Sol») o a que una entidad cambie y se mantenga un
          tiempo («Cambio de estado» con «Durante»). Sigue en cuanto se cumple cualquiera.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:items-end">
          <DurationField
            label="Tiempo máximo (min:s, vacío = sin límite)"
            value={value.timeoutSeconds}
            onChange={(sec) => {
              const next = { ...value };
              if (sec === undefined) delete next.timeoutSeconds;
              else next.timeoutSeconds = sec;
              onChange(next);
            }}
          />
          <label className="flex items-center gap-2 pb-1 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={value.continueOnTimeout !== false}
              onChange={(e) => onChange({ ...value, continueOnTimeout: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
            />
            Seguir si se agota el tiempo
          </label>
        </div>
      </Nested>
    </div>
  );
}

type RepeatMode = 'count' | 'while' | 'until';

function repeatMode(value: RepeatAction): RepeatMode {
  if (value.while) return 'while';
  if (value.until) return 'until';
  return 'count';
}

function RepeatEditor({ value, onChange }: { value: RepeatAction; onChange: (a: RepeatAction) => void }) {
  const mode = repeatMode(value);
  const setMode = (m: RepeatMode) => {
    const base: RepeatAction = { type: 'repeat', sequence: value.sequence };
    if (m === 'count') onChange({ ...base, count: value.count ?? 2 });
    else if (m === 'while') onChange({ ...base, while: value.while ?? value.until ?? [] });
    else onChange({ ...base, until: value.until ?? value.while ?? [] });
  };
  return (
    <div>
      <Header type="repeat" />
      <Nested>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <SelectField
            label="Tipo de repetición"
            value={mode}
            options={[
              { value: 'count', label: 'Un número de veces' },
              { value: 'while', label: 'Mientras se cumpla' },
              { value: 'until', label: 'Hasta que se cumpla' },
            ]}
            onChange={(e) => setMode(e.target.value as RepeatMode)}
          />
          {mode === 'count' && (
            <TextField
              label="Veces"
              type="number"
              min={1}
              value={value.count ?? ''}
              onChange={(e) => onChange({ ...value, count: Math.max(1, Math.round(parseNumberInput(e.target.value) ?? 1)) })}
            />
          )}
        </div>
        {mode === 'while' && (
          <ConditionListEditor
            title="Mientras"
            conditions={value.while ?? []}
            onChange={(conditions) => onChange({ ...value, while: conditions })}
          />
        )}
        {mode === 'until' && (
          <ConditionListEditor
            title="Hasta que"
            conditions={value.until ?? []}
            onChange={(conditions) => onChange({ ...value, until: conditions })}
          />
        )}
        <ActionListEditor title="Repetir" actions={value.sequence} onChange={(sequence) => onChange({ ...value, sequence })} />
      </Nested>
    </div>
  );
}

function NotifyEditor({ value, onChange }: { value: NotifyAction; onChange: (a: NotifyAction) => void }) {
  const caret = useRef<[number | null, number | null]>([null, null]);
  return (
    <div>
      <Header type="notify" />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <TextField label="Título" value={value.title ?? ''} onChange={(e) => onChange({ ...value, title: e.target.value || undefined })} />
        <TextField
          label="Servicio (opcional)"
          value={value.service ?? ''}
          placeholder="notify.mobile_app_mi_movil"
          onChange={(e) => onChange({ ...value, service: e.target.value || undefined })}
        />
      </div>
      <TextAreaField
        label="Mensaje"
        rows={2}
        value={value.message}
        placeholder="La puerta lleva {{ minutos }} minutos abierta"
        onSelect={(e) => {
          caret.current = [e.currentTarget.selectionStart, e.currentTarget.selectionEnd];
        }}
        onChange={(e) => onChange({ ...value, message: e.target.value })}
      />
      <VariableHelp
        onInsert={(token) => {
          const r = insertAt(value.message, token, caret.current[0], caret.current[1]);
          caret.current = [r.caret, r.caret];
          onChange({ ...value, message: r.text });
        }}
      />
    </div>
  );
}

function sameVars(a: Record<string, EntityStateValue> | undefined, b: Record<string, EntityStateValue> | undefined) {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}

function VariablesEditor({ value, onChange }: { value: VariablesAction; onChange: (a: VariablesAction) => void }) {
  const [draft, setDraft] = useState(() => dataToInput(value.variables));
  const [seen, setSeen] = useState(value.variables);
  if (seen !== value.variables) {
    setSeen(value.variables);
    if (!sameVars(parseDataInput(draft), value.variables)) setDraft(dataToInput(value.variables));
  }
  return (
    <div>
      <Header type="variables" />
      <TextField
        label="Variables (nombre=valor)"
        placeholder="minutos=10, zona=salón"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          const parsed = parseDataInput(e.target.value) ?? {};
          if (!sameVars(parsed, value.variables)) onChange({ ...value, variables: parsed });
        }}
      />
    </div>
  );
}

/** Editor de las acciones de lógica de la Fase 3 (B11). Anidables. */
export function AdvancedActionEditor({ value, onChange }: { value: AdvancedAction; onChange: (a: Action) => void }) {
  switch (value.type) {
    case 'choose':
      return (
        <NestedScope>
          <ChooseEditor value={value} onChange={onChange} />
        </NestedScope>
      );
    case 'if':
      return (
        <NestedScope>
          <IfEditor value={value} onChange={onChange} />
        </NestedScope>
      );
    case 'wait_for_trigger':
      return <WaitEditor value={value} onChange={onChange} />;
    case 'repeat':
      return (
        <NestedScope repeat count={value.count !== undefined && value.while === undefined && value.until === undefined}>
          <RepeatEditor value={value} onChange={onChange} />
        </NestedScope>
      );
    case 'notify':
      return <NotifyEditor value={value} onChange={onChange} />;
    case 'variables':
      return <VariablesEditor value={value} onChange={onChange} />;
  }
}
