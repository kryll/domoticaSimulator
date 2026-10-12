import { useProjectStore } from '../store/projectStore';
import { useThrottledEnergy } from './useThrottledEnergy';
import { formatSimDate, formatSimTime } from '../simulation/clock';
import { BarChart } from '../ui/BarChart';
import { formatKwh, formatMoney, formatWatts, formatDecimal } from '../ui/money';
import { EmptyState } from '../ui/Panel';
import { cx } from '../ui/cx';

function Stat({ label, value, tone = 'slate' }: { label: string; value: string; tone?: 'slate' | 'amber' | 'sky' }) {
  return (
    <div
      className={cx(
        'rounded-md border px-3 py-2',
        tone === 'amber' ? 'border-amber-200 bg-amber-50' : tone === 'sky' ? 'border-sky-200 bg-sky-50' : 'border-slate-200 bg-slate-50',
      )}
    >
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}

/** Pestaña «Energía»: potencia instantánea, kWh y coste por dispositivo y sala, y baterías bajas. */
export function EnergyPanel() {
  const summary = useThrottledEnergy();
  const project = useProjectStore((s) => s.project);
  const name = (id: string) => project.devices.find((d) => d.id === id)?.name ?? id;
  const consuming = summary.byDevice.filter((d) => d.watts > 0 || d.kwh > 0);

  if (project.devices.length === 0) return <EmptyState>Añade dispositivos para ver su consumo.</EmptyState>;

  return (
    <div className="flex flex-col gap-4 p-3">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Totales de energía">
        <Stat label="Potencia ahora" value={formatWatts(summary.totalW)} tone="amber" />
        <Stat label="Energía" value={formatKwh(summary.totalKwh)} tone="sky" />
        <Stat label="Coste" value={formatMoney(summary.totalCost)} />
        <Stat label="Precio" value={`${formatDecimal(summary.pricePerKwh, 3)} €/kWh`} />
      </dl>
      <p className="text-xs text-slate-500">
        Acumulado desde las {formatSimTime(summary.since)} del {formatSimDate(summary.since)} (hora simulada). Cambia el precio en
        «Ajustes del proyecto».
      </p>
      {summary.lowBatteries.length > 0 && (
        <section className="rounded-md border border-red-200 bg-red-50 p-2" aria-label="Baterías bajas">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-red-800">🪫 Baterías bajas</h3>
          <ul className="mt-1 text-sm text-red-900">
            {summary.lowBatteries.map((b) => (
              <li key={b.deviceId}>
                {name(b.deviceId)}: {formatDecimal(b.level, 0)} %
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <BarChart
          title="Potencia por dispositivo (W)"
          color="#d97706"
          data={summary.byDevice
            .filter((d) => d.watts > 0)
            .slice(0, 12)
            .map((d) => ({ key: d.deviceId, label: d.name, value: d.watts, display: formatWatts(d.watts) }))}
        />
        <BarChart
          title="Energía por sala (kWh)"
          data={summary.byRoom
            .filter((r) => r.kwh > 0 || r.watts > 0)
            .map((r) => ({ key: r.roomId ?? 'none', label: r.name, value: r.kwh, display: formatKwh(r.kwh) }))}
        />
      </div>
      <section aria-label="Consumo por dispositivo">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Por dispositivo</h3>
        {consuming.length === 0 ? (
          <p className="text-xs text-slate-500">Ningún dispositivo consume ahora. Enciende algo o avanza el reloj.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th scope="col" className="py-1 pr-2 font-medium">Dispositivo</th>
                <th scope="col" className="py-1 pr-2 text-right font-medium">Potencia</th>
                <th scope="col" className="py-1 pr-2 text-right font-medium">Energía</th>
                <th scope="col" className="py-1 text-right font-medium">Coste</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {consuming.map((d) => (
                <tr key={d.deviceId} className="border-t border-slate-100">
                  <td className="py-1 pr-2">{d.name}</td>
                  <td className="py-1 pr-2 text-right">{formatWatts(d.watts)}</td>
                  <td className="py-1 pr-2 text-right">{formatKwh(d.kwh)}</td>
                  <td className="py-1 text-right">{formatMoney(d.cost)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-300 font-semibold">
                <th scope="row" className="py-1 pr-2">Total</th>
                <td className="py-1 pr-2 text-right">{formatWatts(summary.totalW)}</td>
                <td className="py-1 pr-2 text-right">{formatKwh(summary.totalKwh)}</td>
                <td className="py-1 text-right">{formatMoney(summary.totalCost)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </section>
      <section aria-label="Consumo por sala">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Por sala</h3>
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-slate-500">
            <tr>
              <th scope="col" className="py-1 pr-2 font-medium">Sala</th>
              <th scope="col" className="py-1 pr-2 text-right font-medium">Potencia</th>
              <th scope="col" className="py-1 pr-2 text-right font-medium">Energía</th>
              <th scope="col" className="py-1 text-right font-medium">Coste</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {summary.byRoom.map((r) => (
              <tr key={r.roomId ?? 'none'} className="border-t border-slate-100">
                <td className="py-1 pr-2">{r.name}</td>
                <td className="py-1 pr-2 text-right">{formatWatts(r.watts)}</td>
                <td className="py-1 pr-2 text-right">{formatKwh(r.kwh)}</td>
                <td className="py-1 text-right">{formatMoney(r.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
