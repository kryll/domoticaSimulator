import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSimulationStore } from '../store/simulationStore';
import { useProjectStore, projectSettings } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { HOUR_MS, formatSimDate, formatSimTime, startOfDay, sunTimes } from './clock';
import { nextSunEvent, nextTimeOfDay } from '../ui/sunJump';
import { Button } from '../ui/Button';
import { inputClass } from '../ui/Field';
import { isBridgeLive, useBridgeLive } from '../bridge/useBridge';

/** Amanecer y atardecer del día simulado que contiene `dayStart`, según los ajustes del proyecto. */
function useSunToday(dayStart: number): { sunrise: number; sunset: number } {
  const settings = useProjectStore((s) => s.project.settings);
  return useMemo(() => {
    const st = projectSettings({ settings });
    return sunTimes(dayStart, st.latitude, st.longitude, st.timeZone);
  }, [dayStart, settings]);
}

function JumpPopover({ onClose, onEscape, sun, today }: { onClose: () => void; onEscape: () => void; sun: { sunrise: number; sunset: number }; today: number }) {
  const [time, setTime] = useState('');
  const settings = useProjectStore((s) => s.project.settings);
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input')?.focus();
    const onDown = (e: MouseEvent) => {
      const root = ref.current?.parentElement ?? ref.current;
      if (root && !root.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, onEscape]);

  // E1: en modo en vivo con el laboratorio el reloj es el real: no se puede saltar.
  const live = useBridgeLive();
  const go = (target: number, label: string) => {
    if (isBridgeLive()) return;
    useSimulationStore.getState().jumpTo(target);
    useUiStore.getState().notify(`Reloj adelantado ${label} (${formatSimTime(target)} del ${formatSimDate(target)})`, 'success');
    onClose();
  };
  const now = () => useSimulationStore.getState().sim.now;
  const sunAt = (day: number) => {
    const st = projectSettings({ settings });
    return sunTimes(day, st.latitude, st.longitude, st.timeZone);
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-labelledby={titleId}
      className="absolute right-0 top-full z-50 mt-1 flex w-64 flex-col gap-2 rounded-md border border-slate-200 bg-white p-3 text-slate-800 shadow-lg"
    >
      <div className="flex items-baseline justify-between gap-2 border-b border-slate-100 pb-2">
        <span className="text-xs text-slate-600">{formatSimDate(today)}</span>
        <span className="flex gap-2 text-[11px] text-slate-600" aria-label="Sol de hoy">
          <span title="Amanecer">🌅 {formatSimTime(sun.sunrise)}</span>
          <span title="Atardecer">🌇 {formatSimTime(sun.sunset)}</span>
        </span>
      </div>
      <h2 id={titleId} className="text-sm font-semibold">
        Ir a…
      </h2>
      <p className="text-xs text-slate-500">La simulación avanza hasta esa hora y ejecuta lo que ocurra entre medias.</p>
      {live && <p className="text-xs font-medium text-amber-800">Laboratorio en vivo: el reloj sigue la hora real y «Ir a…» está desactivado.</p>}
      <fieldset disabled={live} className="contents">
      <form
        className="flex items-end gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (!time) return;
          go(nextTimeOfDay(now(), time), `a las ${time}`);
        }}
      >
        <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-slate-600">
          Hora
          <input type="time" className={inputClass} value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <Button type="submit" size="sm" variant="primary" disabled={!time}>
          Ir
        </Button>
      </form>
      <div className="grid grid-cols-2 gap-1">
        <Button size="sm" onClick={() => go(now() + HOUR_MS, '1 hora')}>
          +1 h
        </Button>
        <Button size="sm" onClick={() => go(now() + 6 * HOUR_MS, '6 horas')}>
          +6 h
        </Button>
        <Button size="sm" onClick={() => go(nextSunEvent(now(), 'sunrise', sunAt), 'al próximo amanecer')}>
          🌅 Próximo amanecer
        </Button>
        <Button size="sm" onClick={() => go(nextSunEvent(now(), 'sunset', sunAt), 'al próximo atardecer')}>
          🌇 Próximo atardecer
        </Button>
      </div>
      </fieldset>
    </div>
  );
}

/** Reloj simulado con el amanecer y el atardecer de hoy y el control «Ir a…». */
export function SimClock() {
  const now = useSimulationStore((s) => s.sim.now);
  const day = startOfDay(now);
  const sun = useSunToday(day);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const escape = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);
  return (
    <div className="relative ml-1">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Hora simulada ${formatSimTime(now, { seconds: true })} del ${formatSimDate(now)}. Ir a…`}
        title="Fecha, sol de hoy y saltar a una hora"
        className="flex items-center gap-1 whitespace-nowrap rounded-md bg-slate-800 px-2 py-1 font-mono text-sm leading-none text-white hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
      >
        {formatSimTime(now, { seconds: true })}
        <span aria-hidden="true" className="text-[10px] text-slate-300">
          ▾
        </span>
      </button>
      {open && <JumpPopover onClose={close} onEscape={escape} sun={sun} today={now} />}
    </div>
  );
}
