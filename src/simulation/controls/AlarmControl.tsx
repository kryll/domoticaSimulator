import { useState } from 'react';
import { ALARM_STATE_LABELS, labelOf } from '../../devices/labels';
import { CtlButton } from './primitives';
import type { ControlProps } from './types';
import { cx } from '../../ui/cx';

const ARM: Array<{ mode: string; service: string; label: string }> = [
  { mode: 'armed_home', service: 'alarm_arm_home', label: '🏠 Armar en casa' },
  { mode: 'armed_away', service: 'alarm_arm_away', label: '🚪 Armar ausente' },
  { mode: 'armed_night', service: 'alarm_arm_night', label: '🌙 Armar noche' },
];

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * Alarma (alarm_control_panel): teclado de código, armar en casa / ausente (y noche si lo admite)
 * y desarmar. El código se manda en `code`; el motor decide si es correcto.
 */
export function AlarmControl({ state, onService, definition, target }: ControlProps) {
  const [code, setCode] = useState('');
  const st = typeof state?.state === 'string' ? state.state : 'disarmed';
  const modes = definition.capabilities?.alarmModes ?? ['armed_home', 'armed_away'];
  const send = (service: string) => {
    onService(service, code ? { code } : undefined);
    setCode('');
  };
  const triggered = st === 'triggered';
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-slate-600">
        Estado:{' '}
        <strong className={cx(triggered ? 'text-red-700' : st === 'disarmed' ? 'text-slate-800' : 'text-emerald-800')}>{labelOf(ALARM_STATE_LABELS, st)}</strong>
      </p>
      {!target && (
        <div className="flex flex-col gap-1">
          <output aria-label="Código introducido" className="rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-center font-mono text-base tracking-[0.4em] text-slate-800">
            {code ? '•'.repeat(code.length) : <span className="tracking-normal text-slate-400">Código</span>}
          </output>
          <div role="group" aria-label="Teclado de la alarma" className="grid grid-cols-3 gap-1">
            {[...KEYS, 'C', '0', '⌫'].map((k) => (
              <button
                key={k}
                type="button"
                aria-label={k === 'C' ? 'Borrar código' : k === '⌫' ? 'Borrar último dígito' : `Dígito ${k}`}
                onClick={() => setCode((c) => (k === 'C' ? '' : k === '⌫' ? c.slice(0, -1) : (c + k).slice(0, 8)))}
                className="min-h-[2.25rem] rounded-md border border-slate-300 bg-white text-sm font-semibold text-slate-800 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
              >
                {k}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-1" role="group" aria-label="Alarma">
        {ARM.filter((a) => modes.includes(a.mode)).map((a) => (
          <CtlButton key={a.mode} pressed={st === a.mode} onClick={() => send(a.service)}>
            {a.label}
          </CtlButton>
        ))}
        <CtlButton variant="primary" pressed={st === 'disarmed'} onClick={() => send('alarm_disarm')}>
          🔓 Desarmar
        </CtlButton>
      </div>
    </div>
  );
}
