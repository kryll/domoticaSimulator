import { VACUUM_LABELS } from './labels';
import { CtlButton } from './primitives';
import type { ControlProps } from './types';


/** Aspiradora: limpiar, pausar, parar y volver a la base. */
export function VacuumControl({ state, onService }: ControlProps) {
  const st = state?.state;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-slate-600">
        Estado: <strong>{typeof st === 'string' ? (VACUUM_LABELS[st] ?? st) : '—'}</strong>
      </p>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Aspiradora">
        <CtlButton onClick={() => onService('start')} pressed={st === 'cleaning'}>
          ▶ Limpiar
        </CtlButton>
        <CtlButton onClick={() => onService('pause')} pressed={st === 'paused'}>
          ⏸ Pausar
        </CtlButton>
        <CtlButton onClick={() => onService('return_to_base')} pressed={st === 'docked' || st === 'returning'}>
          ⌂ A la base
        </CtlButton>
      </div>
    </div>
  );
}
