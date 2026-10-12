import { withDefaults } from '../../devices/capabilities';
import { attr, num } from './attrs';
import { CtlButton, Slider } from './primitives';
import type { ControlProps } from './types';
import { inputClass } from '../../ui/Field';
import { useId } from 'react';

/** Reproductor: encendido, reproducir/pausa, volumen, silencio y fuente. */
export function MediaControl({ definition, state, onService }: ControlProps) {
  const caps = withDefaults('media_player', definition.capabilities);
  const sourceId = useId();
  const st = state?.state;
  const off = st === 'off' || st === 'standby' || st === undefined;
  const volume = Math.round(num(attr(state, 'volume_level'), 0.3) * 100);
  const muted = attr(state, 'is_volume_muted') === true;
  const source = attr(state, 'source');
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Reproducción">
        <CtlButton onClick={() => onService(off ? 'turn_on' : 'turn_off')} pressed={!off} label={off ? 'Encender' : 'Apagar'}>
          ⏻ {off ? 'Encender' : 'Apagar'}
        </CtlButton>
        <CtlButton
          onClick={() => onService(st === 'playing' ? 'media_pause' : 'media_play')}
          pressed={st === 'playing'}
          label={st === 'playing' ? 'Pausar' : 'Reproducir'}
        >
          {st === 'playing' ? '⏸ Pausar' : '▶ Reproducir'}
        </CtlButton>
        <CtlButton
          onClick={() => onService('volume_mute', { is_volume_muted: !muted })}
          pressed={muted}
          label={muted ? 'Quitar silencio' : 'Silenciar'}
        >
          {muted ? '🔇' : '🔈'} Silencio
        </CtlButton>
      </div>
      <Slider
        label="Volumen"
        value={volume}
        min={0}
        max={100}
        format={(v) => `${v} %`}
        onCommit={(v) => onService('volume_set', { volume_level: v / 100 })}
      />
      {caps.sources && caps.sources.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <label htmlFor={sourceId} className="text-xs font-medium text-slate-600">
            Fuente
          </label>
          <select
            id={sourceId}
            className={inputClass}
            value={typeof source === 'string' ? source : ''}
            onChange={(e) => onService('select_source', { source: e.target.value })}
          >
            <option value="" disabled>
              — Elige una fuente —
            </option>
            {caps.sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
