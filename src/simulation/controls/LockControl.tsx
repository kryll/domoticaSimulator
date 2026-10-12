import { LOCK_LABELS } from './labels';
import { CtlButton } from './primitives';
import type { ControlProps, SensorEvents } from './types';


/** Cerradura: bloquear, desbloquear y (en simulación) atasco. */
export function LockControl({ entityId, state, onService, target, events }: ControlProps & { events?: SensorEvents }) {
  const st = state?.state;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-slate-600">
        Estado: <strong>{typeof st === 'string' ? (LOCK_LABELS[st] ?? st) : '—'}</strong>
      </p>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Cerradura">
        <CtlButton onClick={() => onService('lock')} pressed={st === 'locked'}>
          🔒 Bloquear
        </CtlButton>
        <CtlButton onClick={() => onService('unlock')} pressed={st === 'unlocked'}>
          🔓 Desbloquear
        </CtlButton>
        {!target && events?.jam && (
          <CtlButton variant="danger" onClick={() => events.jam?.(entityId)} pressed={st === 'jammed'}>
            Simular atasco
          </CtlButton>
        )}
      </div>
    </div>
  );
}
