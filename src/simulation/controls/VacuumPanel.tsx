import { useId, useMemo, useState } from 'react';
import type { Device, DeviceDefinition, EntityState } from '../../types';
import { useProjectStore } from '../../store/projectStore';
import { useSimulationStore } from '../../store/simulationStore';
import { entitiesForDevice } from '../../devices/entities';
import { stateLabel } from '../../devices/stateLabels';
import { DOCK_STATUS_LABELS, FAN_SPEED_LABELS, SELECT_OPTION_LABELS, labelOf } from '../../devices/labels';
import { inputClass } from '../../ui/Field';
import { CONSUMABLE_LIFE_HOURS, VACUUM_ERRORS, estimateMinutes, vacuumRooms } from '../vacuum';
import { CtlButton } from './primitives';
import { num } from './attrs';

const CONSUMABLE_NAMES: Record<string, string> = { main_brush: 'Cepillo principal', side_brush: 'Cepillo lateral', filter: 'Filtro', mop_pad: 'Mopa' };

function Bar({ pct, label }: { pct: number; label: string }) {
  const tone = pct < 10 ? 'bg-red-500' : pct < 30 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div className={`h-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

/**
 * Control completo del robot aspirador (popover): limpiar, pausa, base, localizar, potencia,
 * limpieza por habitaciones, mopa, consumibles, base y simulación de errores.
 */
export function VacuumPanel({ device, def }: { device: Device; def: DeviceDefinition }) {
  const project = useProjectStore((s) => s.project);
  const entities = useSimulationStore((s) => s.sim.entities);
  const callService = useSimulationStore((s) => s.callService);
  const vacuumError = useSimulationStore((s) => s.vacuumError);
  const refs = useMemo(() => entitiesForDevice(device, def), [device, def]);
  const byKey = useMemo(() => Object.fromEntries(refs.map((r) => [r.definition.key, r])), [refs]);
  const vac = refs.find((r) => r.definition.domain === 'vacuum');
  const rooms = useMemo(() => vacuumRooms(project, device), [project, device]);
  const [picked, setPicked] = useState<string[]>([]);
  const [errorCode, setErrorCode] = useState('main_brush_jammed');
  const fanId = useId();
  const errId = useId();
  if (!vac) return null;
  const st: EntityState | undefined = entities[vac.entityId];
  const s = String(st?.state ?? '');
  const a = st?.attributes ?? {};
  const caps = vac.definition.capabilities ?? {};
  const sensor = (key: string): number | undefined => {
    const r = byKey[key];
    return r ? num(entities[r.entityId]?.state, NaN) : undefined;
  };
  const battery = sensor('battery');
  const call = (service: string, data?: Parameters<typeof callService>[2]) => callService(vac.entityId, service, data);
  const mopMode = byKey.mop_mode;
  const water = byKey.water_level;
  const dock = byKey.dock_status;
  const selected = rooms.filter((r) => picked.includes(r.id));
  const estimate = estimateMinutes(selected, caps, mopMode ? String(entities[mopMode.entityId]?.state ?? '') : undefined);

  return (
    <div className="flex flex-col gap-2 text-xs" data-testid="vacuum-panel">
      <div className="rounded-md bg-slate-50 p-2">
        <div className="flex items-baseline justify-between gap-2">
          <strong className="text-sm text-slate-800" data-testid="vacuum-state">
            {stateLabel('vacuum', s)}
          </strong>
          {battery !== undefined && Number.isFinite(battery) && <span className="tabular-nums text-slate-700">🔋 {Math.round(battery)} %</span>}
        </div>
        {typeof a.status === 'string' && s !== 'error' && <p className="text-slate-600">{a.status}</p>}
        {s === 'error' && a.error !== undefined && (
          <p className="font-semibold text-red-700" role="alert">
            ⚠ {String(a.error)}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Robot aspirador">
        <CtlButton onClick={() => call('start')} pressed={s === 'cleaning'}>
          ▶ {s === 'paused' || s === 'error' ? 'Reanudar' : 'Limpiar'}
        </CtlButton>
        <CtlButton onClick={() => call('pause')} pressed={s === 'paused'} disabled={s !== 'cleaning' && s !== 'returning'}>
          ⏸ Pausa
        </CtlButton>
        <CtlButton onClick={() => call('return_to_base')} pressed={s === 'docked' || s === 'returning'}>
          ⌂ Base
        </CtlButton>
        <CtlButton onClick={() => call('locate')}>📍 Localizar</CtlButton>
        <CtlButton onClick={() => call('stop')} disabled={s === 'docked'}>
          ⏹ Parar
        </CtlButton>
      </div>
      {(caps.fanSpeeds?.length ?? 0) > 0 && (
        <div className="flex items-center gap-2">
          <label htmlFor={fanId} className="w-24 shrink-0 font-medium text-slate-600">
            Potencia
          </label>
          <select id={fanId} className={inputClass} value={typeof a.fan_speed === 'string' ? a.fan_speed : ''} onChange={(e) => call('set_fan_speed', { fan_speed: e.target.value })}>
            <option value="" disabled>
              — Elige —
            </option>
            {(caps.fanSpeeds ?? []).map((f) => (
              <option key={f} value={f}>
                {labelOf(FAN_SPEED_LABELS, f)}
              </option>
            ))}
          </select>
        </div>
      )}
      <details className="rounded-md border border-slate-200 p-2">
        <summary className="cursor-pointer font-semibold text-slate-700">Limpiar habitaciones…</summary>
        {rooms.length === 0 ? (
          <p className="mt-1 text-slate-500">Dibuja salas en el plano (o elígelas en Propiedades) para limpiar por habitaciones.</p>
        ) : (
          <fieldset className="mt-1 flex flex-col gap-1">
            <legend className="sr-only">Habitaciones del mapa</legend>
            {rooms.map((r) => (
              <label key={r.id} className="flex items-center gap-2">
                <input type="checkbox" checked={picked.includes(r.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r.id] : p.filter((x) => x !== r.id)))} />
                <span className="flex-1">{r.name}</span>
                <span className="tabular-nums text-slate-500" title="Segmento del mapa y superficie útil">
                  #{r.segment} · {String(r.areaM2).replace('.', ',')} m²
                </span>
              </label>
            ))}
            <CtlButton variant="primary" disabled={selected.length === 0} onClick={() => call('clean_area', { cleaning_area_id: selected.map((r) => r.id).join(', ') })}>
              Limpiar {selected.length === 0 ? 'la selección' : `${selected.length} ${selected.length === 1 ? 'sala' : 'salas'} (~${estimate} min)`}
            </CtlButton>
          </fieldset>
        )}
      </details>
      {(mopMode || water) && (
        <div className="flex flex-col gap-1">
          {[mopMode, water].map((r) =>
            r ? (
              <label key={r.entityId} className="flex items-center gap-2">
                <span className="w-24 shrink-0 font-medium text-slate-600">{r.definition.name}</span>
                <select className={inputClass} value={String(entities[r.entityId]?.state ?? '')} onChange={(e) => callService(r.entityId, 'select_option', { option: e.target.value })}>
                  {(r.definition.capabilities?.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {labelOf(SELECT_OPTION_LABELS, o)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null,
          )}
        </div>
      )}
      <details className="rounded-md border border-slate-200 p-2">
        <summary className="cursor-pointer font-semibold text-slate-700">Consumibles y base</summary>
        <ul className="mt-1 flex flex-col gap-1.5">
          {Object.keys(CONSUMABLE_LIFE_HOURS)
            .filter((k) => byKey[`${k}_left`])
            .map((k) => {
              const pct = Math.round(sensor(`${k}_left`) ?? 100);
              return (
                <li key={k} className="flex flex-col gap-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span>{CONSUMABLE_NAMES[k]}</span>
                    <span className="tabular-nums">{pct} %</span>
                    <button type="button" className="rounded px-1 text-sky-700 underline" onClick={() => call('send_command', { command: 'reset_consumable', params: `${k}_work_time` })}>
                      Cambiado
                    </button>
                  </div>
                  <Bar pct={pct} label={CONSUMABLE_NAMES[k] ?? k} />
                </li>
              );
            })}
          {dock && (
            <li>
              Base: <strong>{labelOf(DOCK_STATUS_LABELS, String(entities[dock.entityId]?.state ?? 'idle'))}</strong>
              {byKey.dust_bag && <span> · bolsa al {Math.round(sensor('dust_bag') ?? 0)} %</span>}
            </li>
          )}
        </ul>
      </details>
      <details className="rounded-md border border-red-200 p-2">
        <summary className="cursor-pointer font-semibold text-red-800">Simular un fallo…</summary>
      <div className="mt-1 flex items-center gap-1">
        <label htmlFor={errId} className="sr-only">
          Error que se simula
        </label>
        <select id={errId} className={inputClass} value={errorCode} onChange={(e) => setErrorCode(e.target.value)}>
          {Object.entries(VACUUM_ERRORS).map(([code, text]) => (
            <option key={code} value={code}>
              {text}
            </option>
          ))}
        </select>
        <CtlButton variant="danger" onClick={() => vacuumError(vac.entityId, errorCode)}>
          Simular error
        </CtlButton>
      </div>
      </details>
    </div>
  );
}
