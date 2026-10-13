import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { RobotNode } from './types';
import { cx } from '../ui/cx';

const STATE_TEXT: Record<string, string> = { cleaning: 'Limpiando', paused: 'En pausa', error: 'Error', returning: 'Volviendo', idle: 'Parado' };

/**
 * Robot aspirador recorriendo la sala que limpia. La animación es CSS (no depende del reloj):
 * el nodo solo se vuelve a pintar cuando cambian la sala, el estado, el progreso o la batería.
 */
function RobotNodeViewImpl({ data, width, height }: NodeProps<RobotNode>) {
  const moving = data.state === 'cleaning';
  const label = `${data.name}: ${STATE_TEXT[data.state] ?? data.state}${data.progress !== undefined ? ` ${data.progress} %` : ''}${data.battery !== undefined ? ` · 🔋 ${data.battery} %` : ''}`;
  return (
    <div className="pointer-events-none relative h-full w-full" style={{ width, height }} data-testid={`robot-${data.deviceId}`} data-state={data.state}>
      {moving && <div className="absolute inset-0 rounded-sm bg-emerald-400/10" aria-hidden="true" />}
      <div className={cx('ha-robot flex flex-col items-center', !moving && 'ha-robot-paused')} title={data.error ?? label}>
        <span
          className={cx(
            'flex h-8 w-8 items-center justify-center rounded-full border-2 bg-white text-base shadow',
            data.state === 'error' ? 'border-red-600' : moving ? 'border-emerald-600' : 'border-slate-400',
          )}
          aria-hidden="true"
        >
          🤖
        </span>
        <span className="mt-0.5 whitespace-nowrap rounded bg-white/90 px-1 text-[10px] font-semibold tabular-nums text-slate-800 shadow-sm" data-testid="robot-label">
          {data.state === 'error' ? `⚠ ${data.error ?? 'Error'}` : label}
        </span>
      </div>
    </div>
  );
}

export const RobotNodeView = memo(RobotNodeViewImpl);
