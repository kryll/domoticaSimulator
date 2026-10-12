import { attr, num } from './attrs';
import { CtlButton, Slider } from './primitives';
import type { ControlProps } from './types';

/** Persiana: abrir, parar, cerrar y posición. */
export function CoverControl({ state, onService, target }: ControlProps) {
  const pos = num(attr(state, 'current_position'), state?.state === 'open' ? 100 : 0);
  const moving = state?.state === 'opening' || state?.state === 'closing';
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1" role="group" aria-label="Movimiento de la persiana">
        <CtlButton onClick={() => onService('open_cover')} pressed={state?.state === 'opening'}>
          ▲ Abrir
        </CtlButton>
        {!target && (
          <CtlButton onClick={() => onService('stop_cover')} disabled={!moving}>
            ■ Parar
          </CtlButton>
        )}
        <CtlButton onClick={() => onService('close_cover')} pressed={state?.state === 'closing'}>
          ▼ Cerrar
        </CtlButton>
      </div>
      <Slider
        label="Posición"
        value={Math.round(pos)}
        min={0}
        max={100}
        format={(v) => `${v} % abierta`}
        onCommit={(v) => onService('set_cover_position', { position: v })}
      />
    </div>
  );
}
