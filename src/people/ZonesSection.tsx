import { useEffect, useMemo, useState } from 'react';
import { countLabel } from '../ui/plural';
import type { Zone } from '../types';
import { useProjectStore } from '../store/projectStore';
import { DEFAULT_ZONE_RADIUS, MAX_ZONE_RADIUS, MIN_ZONE_RADIUS, zoneConflicts, zoneGeo, type ZoneConflict } from '../simulation/zones';
import { Button } from '../ui/Button';
import { TextField } from '../ui/Field';
import { parseNumberInput } from '../ui/formValues';
import { useZones } from './zones';
import { addZone, removeZone, updateZone } from './personActions';
import { formatMeters, offsetKm, projectCircles } from './zoneMap';

const ICONS: Record<Zone['kind'], string> = { home: '🏠', work: '💼', other: '📍' };
const MAP_PX = 220;
const COLORS = ['#0284c7', '#f97316', '#16a34a', '#a855f7', '#dc2626', '#ca8a04'];

const OFFSETS: Array<{ value: string; label: string; km: number; bearing: 'N' | 'S' | 'E' | 'O' }> = [
  { value: '1N', label: 'a 1 km al norte', km: 1, bearing: 'N' },
  { value: '5N', label: 'a 5 km al norte', km: 5, bearing: 'N' },
  { value: '5S', label: 'a 5 km al sur', km: 5, bearing: 'S' },
  { value: '5E', label: 'a 5 km al este', km: 5, bearing: 'E' },
  { value: '5O', label: 'a 5 km al oeste', km: 5, bearing: 'O' },
  { value: '20N', label: 'a 20 km al norte', km: 20, bearing: 'N' },
];

/** Campo numérico que confirma al perder el foco o con Intro. */
function CoordField({ label, value, min, max, onCommit }: { label: string; value: number | undefined; min: number; max: number; onCommit: (v: number | undefined) => void }) {
  const text = value === undefined ? '' : String(value).replace('.', ',');
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);
  const parsed = draft.trim() === '' ? undefined : parseNumberInput(draft.replace(',', '.'));
  const invalid = draft.trim() !== '' && (parsed === undefined || parsed < min || parsed > max);
  const commit = () => {
    if (invalid) return;
    if (parsed !== value) onCommit(parsed);
  };
  return (
    <TextField
      label={label}
      inputMode="decimal"
      value={draft}
      aria-invalid={invalid}
      hint={invalid ? `Entre ${min} y ${max}` : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}

function ZoneRow({ zone, conflicts }: { zone: Zone; conflicts: ZoneConflict[] }) {
  const settings = useProjectStore((s) => s.project.settings);
  const zones = useZones();
  const home = zones.find((z) => z.kind === 'home');
  const homeGeo = home ? zoneGeo(home, { settings }) : undefined;
  const geo = zoneGeo(zone, { settings });
  const inherits = zone.kind === 'home' && zone.latitude === undefined;
  return (
    <li className="flex flex-col gap-1.5 rounded-md border border-slate-200 bg-white p-2" aria-label={`Zona ${zone.name}`}>
      <div className="flex items-center gap-2">
        <span aria-hidden="true">{ICONS[zone.kind]}</span>
        <span className="text-sm font-medium text-slate-800">{zone.name}</span>
        {inherits && <span className="text-[11px] text-slate-500">(ubicación de los ajustes del proyecto)</span>}
        {zone.kind !== 'home' && (
          <button
            type="button"
            className="ml-auto text-xs text-slate-500 hover:text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            aria-label={`Borrar la zona ${zone.name}`}
            onClick={() => removeZone(zone.id)}
          >
            ✕
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <CoordField label="Latitud" value={geo?.latitude} min={-90} max={90} onCommit={(latitude) => updateZone(zone.id, { latitude, longitude: zone.longitude ?? geo?.longitude })} />
        <CoordField label="Longitud" value={geo?.longitude} min={-180} max={180} onCommit={(longitude) => updateZone(zone.id, { longitude, latitude: zone.latitude ?? geo?.latitude })} />
        <CoordField label="Radio (m)" value={zone.radius ?? DEFAULT_ZONE_RADIUS} min={MIN_ZONE_RADIUS} max={MAX_ZONE_RADIUS} onCommit={(radius) => updateZone(zone.id, { radius })} />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {homeGeo && !inherits && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              zone.kind === 'home'
                ? updateZone(zone.id, { latitude: undefined, longitude: undefined })
                : updateZone(zone.id, { latitude: homeGeo.latitude, longitude: homeGeo.longitude })
            }
          >
            Usar la ubicación de casa
          </Button>
        )}
        {geo && (
          <select
            aria-label={`Desplazar la zona ${zone.name}`}
            value=""
            className="rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            onChange={(e) => {
              const o = OFFSETS.find((x) => x.value === e.target.value);
              if (o) updateZone(zone.id, offsetKm(geo.latitude, geo.longitude, o.km, o.bearing));
            }}
          >
            <option value="">Mover…</option>
            {OFFSETS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {conflicts.map((c) => (
        <p key={`${c.kind}-${c.zoneIds.join('-')}`} role="note" className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
          ⚠ {c.message}
        </p>
      ))}
    </li>
  );
}

/** Minimapa esquemático en SVG: círculos de las zonas a escala, con sus nombres (sin teselas). */
export function ZoneMiniMap({ zones }: { zones: Zone[] }) {
  const settings = useProjectStore((s) => s.project.settings);
  const { circles, scaleMeters, metersPerPx } = useMemo(
    () =>
      projectCircles(
        zones.flatMap((z) => {
          const g = zoneGeo(z, { settings });
          return g ? [{ id: z.id, name: z.name, ...g }] : [];
        }),
        MAP_PX,
      ),
    [zones, settings],
  );
  if (circles.length === 0) return null;
  const scalePx = scaleMeters / metersPerPx;
  return (
    <figure className="flex flex-col items-start gap-1">
      <svg
        width={MAP_PX}
        height={MAP_PX}
        viewBox={`0 0 ${MAP_PX} ${MAP_PX}`}
        className="rounded-md border border-slate-200 bg-slate-50"
        role="img"
        aria-label={`Mapa de zonas: ${circles.map((c) => `${c.name} (radio ${formatMeters(c.radius)})`).join(', ')}`}
        data-testid="zone-minimap"
      >
        {circles.map((c, i) => {
          const color = COLORS[i % COLORS.length] ?? '#0284c7';
          return (
            <g key={c.id}>
              <circle cx={c.cx} cy={c.cy} r={c.r} fill={color} fillOpacity={0.15} stroke={color} strokeWidth={1.5} />
              <circle cx={c.cx} cy={c.cy} r={2} fill={color} />
              <text x={c.cx} y={c.cy - Math.max(c.r, 4) - 3} textAnchor="middle" fontSize={10} fontWeight={600} fill="#334155" stroke="white" strokeWidth={3} paintOrder="stroke">
                {c.name}
              </text>
            </g>
          );
        })}
        <text x={MAP_PX - 12} y={16} fontSize={10} textAnchor="middle" fill="#64748b">
          N
        </text>
        <path d={`M${MAP_PX - 12},20 l-3,8 h6 z`} fill="#64748b" />
        {scaleMeters > 0 && (
          <g>
            <line x1={8} y1={MAP_PX - 10} x2={8 + scalePx} y2={MAP_PX - 10} stroke="#334155" strokeWidth={2} />
            <text x={8} y={MAP_PX - 14} fontSize={9} fill="#334155">
              {formatMeters(scaleMeters)}
            </text>
          </g>
        )}
      </svg>
      <figcaption className="text-[11px] text-slate-500">Esquema a escala (sin mapa de fondo).</figcaption>
    </figure>
  );
}

/** Zonas: coordenadas, radio, avisos de solapamiento y minimapa (B9). */
export function ZonesSection() {
  const zones = useZones();
  const project = useProjectStore((s) => s.project);
  const conflicts = useMemo(() => zoneConflicts(project), [project]);
  const [draft, setDraft] = useState('');
  return (
    <section aria-labelledby="zones-title" className="text-xs">
      <h4 id="zones-title" className="font-semibold text-slate-600">
        Zonas ({zones.length}){conflicts.length > 0 && <span className="ml-1 font-normal text-amber-800">· {countLabel(conflicts.length, 'aviso', 'avisos')}</span>}
      </h4>
      <div className="mt-1 flex flex-wrap items-start gap-3">
        <ul className="flex min-w-[16rem] flex-1 flex-col gap-1" aria-label="Zonas">
          {zones.map((z) => (
            <ZoneRow key={z.id} zone={z} conflicts={conflicts.filter((c) => c.zoneIds.includes(z.id))} />
          ))}
        </ul>
        <ZoneMiniMap zones={zones} />
      </div>
      <form
        className="mt-1 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const v = draft.trim();
          if (!v) return;
          addZone(v, 'other');
          setDraft('');
        }}
      >
        <TextField label="Nueva zona" value={draft} placeholder="Trabajo" onChange={(e) => setDraft(e.target.value)} fieldClassName="w-40" />
        <Button type="submit" size="sm" disabled={!draft.trim()}>
          + Añadir zona
        </Button>
      </form>
    </section>
  );
}
