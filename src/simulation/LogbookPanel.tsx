import { useMemo, useState } from 'react';
import { countLabel } from '../ui/plural';
import type { LogLevel } from '../types';
import { useSimulationStore } from '../store/simulationStore';
import { formatSimTime } from './clock';
import { SelectField } from '../ui/Field';
import { EmptyState } from '../ui/Panel';
import { cx } from '../ui/cx';

const LEVEL_STYLE: Record<LogLevel, string> = {
  info: 'text-slate-700',
  warning: 'text-amber-800 bg-amber-50',
  error: 'text-red-800 bg-red-50',
};

const LEVEL_LABEL: Record<LogLevel, string> = { info: 'Info', warning: 'Aviso', error: 'Error' };

/** Registro de eventos de la simulación. */
export function LogbookPanel() {
  const log = useSimulationStore((s) => s.sim.log);
  const [level, setLevel] = useState<LogLevel | ''>('');
  const entries = useMemo(() => {
    const list = level ? log.filter((e) => e.level === level) : log;
    return [...list].reverse();
  }, [log, level]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-end gap-2 border-b border-slate-200 px-3 py-2">
        <SelectField
          label="Nivel"
          value={level}
          placeholder="Todos"
          options={(Object.keys(LEVEL_LABEL) as LogLevel[]).map((l) => ({ value: l, label: LEVEL_LABEL[l] }))}
          onChange={(e) => setLevel(e.target.value as LogLevel | '')}
          fieldClassName="w-40"
        />
        <span className="pb-1 text-xs text-slate-500">{countLabel(entries.length, 'entrada', 'entradas')}</span>
      </div>
      {entries.length === 0 ? (
        <EmptyState>Aún no hay eventos. Inicia la simulación o cambia el estado de algún dispositivo.</EmptyState>
      ) : (
        <ol className="min-h-0 flex-1 overflow-auto font-mono text-xs" aria-label="Entradas del logbook">
          {entries.map((e) => (
            <li key={e.id} className={cx('flex gap-3 border-b border-slate-100 px-3 py-1', LEVEL_STYLE[e.level])}>
              <time className="shrink-0 text-slate-500">{formatSimTime(e.timestamp)}</time>
              <span className="w-12 shrink-0 font-semibold uppercase">{LEVEL_LABEL[e.level]}</span>
              {e.notification ? (
                <span className="min-w-0 flex-1 font-sans" data-testid="log-notification">
                  <span role="img" aria-label="Notificación" className="mr-1">
                    🔔
                  </span>
                  {e.notification.title && <strong className="mr-1">{e.notification.title}:</strong>}{e.notification.title && ' '}
                  <span className="whitespace-pre-wrap">{e.notification.message}</span>
                </span>
              ) : (
                <span className="min-w-0 flex-1 whitespace-pre-wrap font-sans">{e.message}</span>
              )}
              {e.entityId && <code className="shrink-0 text-slate-500">{e.entityId}</code>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
