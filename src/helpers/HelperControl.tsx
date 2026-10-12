import { useEffect, useState } from 'react';
import type { EntityState, Helper, ServiceData } from '../types';
import { useSimulationStore } from '../store/simulationStore';
import { formatTimerDuration, TIMER_STATE_LABELS } from '../simulation/helpers';
import { timerRemaining } from './helperModel';
import { Slider } from '../simulation/controls/primitives';
import { inputClass } from '../ui/Field';
import { cx } from '../ui/cx';
import { SwitchToggle } from '../automations/tanda3/StepFlags';

const btn =
  'min-h-[2rem] rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500';

function TimerControl({ helper, state, call }: { helper: Extract<Helper, { type: 'timer' }>; state: EntityState | undefined; call: Call }) {
  // Solo este control sigue al reloj (cada segundo simulado), no el resto del panel.
  const now = useSimulationStore((s) => (state?.state === 'active' ? Math.floor(s.sim.now / 1000) * 1000 : 0));
  const st = String(state?.state ?? 'idle');
  const remaining = timerRemaining(state, now, helper.duration);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className={cx('rounded px-1.5 text-[11px] font-semibold', st === 'active' ? 'bg-emerald-100 text-emerald-800' : st === 'paused' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700')}>
          {TIMER_STATE_LABELS[st] ?? st}
        </span>
        <span role="timer" aria-label={`Tiempo restante de ${helper.name}`} className="font-mono text-lg tabular-nums text-slate-800">
          {formatTimerDuration(remaining)}
        </span>
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label={`Temporizador ${helper.name}`}>
        <button type="button" className={btn} onClick={() => call('start')} disabled={st === 'active'}>
          {st === 'paused' ? '▶ Reanudar' : '▶ Iniciar'}
        </button>
        <button type="button" className={btn} onClick={() => call('pause')} disabled={st !== 'active'}>
          ⏸ Pausar
        </button>
        <button type="button" className={btn} onClick={() => call('cancel')} disabled={st === 'idle'}>
          ■ Cancelar
        </button>
        <button type="button" className={btn} onClick={() => call('finish')} disabled={st === 'idle'}>
          ⏭ Terminar
        </button>
      </div>
    </div>
  );
}

type Call = (service: string, data?: ServiceData) => void;

/** Texto que se edita y se confirma al salir o con Intro. */
function CommitInput({ value, label, onCommit, type = 'text', maxLength }: { value: string; label: string; onCommit: (v: string) => void; type?: string; maxLength?: number }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <input
      aria-label={label}
      type={type}
      value={draft}
      maxLength={maxLength}
      className={inputClass}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setDraft(value);
      }}
    />
  );
}

/**
 * Control de un helper para usarlo en la simulación: interruptor, deslizador, desplegable, texto,
 * fecha, temporizador con cuenta atrás o contador. Siempre pasa por los servicios del motor.
 */
export function HelperControl({ helper, entityId }: { helper: Helper; entityId: string }) {
  const state = useSimulationStore((s) => s.sim.entities[entityId]);
  const callService = useSimulationStore((s) => s.callService);
  const call: Call = (service, data) => callService(entityId, `${helper.type}.${service}`, data);
  const value = state?.state;
  switch (helper.type) {
    case 'input_boolean':
      return <SwitchToggle checked={value === 'on'} onChange={() => call('toggle')} label={value === 'on' ? 'Encendido' : 'Apagado'} srLabel={helper.name} />;
    case 'input_number': {
      const n = typeof value === 'number' ? value : Number(value ?? helper.min);
      if (helper.mode === 'box') {
        return <CommitInput type="number" label={helper.name} value={String(n)} onCommit={(v) => call('set_value', { value: Number(v) })} />;
      }
      return (
        <Slider
          label={helper.name}
          value={Number.isFinite(n) ? n : helper.min}
          min={helper.min}
          max={helper.max}
          step={helper.step}
          format={(v) => `${String(v).replace('.', ',')}${helper.unit ? ` ${helper.unit}` : ''}`}
          onCommit={(v) => call('set_value', { value: v })}
        />
      );
    }
    case 'input_select':
      return (
        <select aria-label={helper.name} className={inputClass} value={String(value ?? '')} onChange={(e) => call('select_option', { option: e.target.value })}>
          {helper.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case 'input_text':
      return <CommitInput label={helper.name} value={String(value ?? '')} maxLength={helper.max ?? 100} onCommit={(v) => call('set_value', { value: v })} />;
    case 'input_datetime': {
      const text = String(value ?? '');
      const [date = '', time = ''] = helper.has_date && helper.has_time ? text.split(' ') : helper.has_date ? [text, ''] : ['', text];
      return (
        <div className="flex flex-wrap gap-1">
          {helper.has_date && <CommitInput type="date" label={`${helper.name}: fecha`} value={date} onCommit={(v) => call('set_datetime', { date: v })} />}
          {helper.has_time && <CommitInput type="time" label={`${helper.name}: hora`} value={time.slice(0, 5)} onCommit={(v) => call('set_datetime', { time: v })} />}
        </div>
      );
    }
    case 'timer':
      return <TimerControl helper={helper} state={state} call={call} />;
    case 'counter':
      return (
        <div className="flex items-center gap-1" role="group" aria-label={`Contador ${helper.name}`}>
          <button type="button" className={btn} aria-label={`Restar ${helper.step}`} onClick={() => call('decrement')}>
            −
          </button>
          <output className="min-w-[3ch] text-center text-lg font-semibold tabular-nums text-slate-800" aria-live="polite">
            {String(value ?? helper.initial)}
          </output>
          <button type="button" className={btn} aria-label={`Sumar ${helper.step}`} onClick={() => call('increment')}>
            +
          </button>
          <button type="button" className={btn} onClick={() => call('reset')}>
            Reiniciar
          </button>
        </div>
      );
  }
}
