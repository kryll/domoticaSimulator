import { VALVE_STATE_LABELS, labelOf } from '../../devices/labels';
import { CtlButton } from './primitives';
import type { ControlProps } from './types';

/** Válvula (valve): abrir y cerrar. */
export function ValveControl({ state, onService }: ControlProps) {
  const st = typeof state?.state === 'string' ? state.state : 'closed';
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-slate-600">
        Estado: <strong>{labelOf(VALVE_STATE_LABELS, st)}</strong>
      </p>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Válvula">
        <CtlButton pressed={st === 'open' || st === 'opening'} onClick={() => onService('open_valve')}>
          🚰 Abrir
        </CtlButton>
        <CtlButton pressed={st === 'closed' || st === 'closing'} onClick={() => onService('close_valve')}>
          ⛔ Cerrar
        </CtlButton>
      </div>
    </div>
  );
}
