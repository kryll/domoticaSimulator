import type { Device, Integration } from '../types';
import { countLabel } from '../ui/plural';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { CATEGORY_LABELS, INTEGRATION_LABELS } from '../devices/catalog';
import { SelectField } from '../ui/Field';
import { Button } from '../ui/Button';
import { definitionOf } from './analysis';
import type { AlignMode } from './arrange';
import {
  alignDevices,
  assignRoomToDevices,
  deleteDevices,
  distributeDevices,
  duplicateSelection,
  setIntegrationForDevices,
} from './selectionActions';

const ALIGN: Array<{ mode: AlignMode; label: string; icon: string }> = [
  { mode: 'left', label: 'Alinear a la izquierda', icon: '⇤' },
  { mode: 'centerX', label: 'Centrar en horizontal', icon: '↔' },
  { mode: 'right', label: 'Alinear a la derecha', icon: '⇥' },
  { mode: 'top', label: 'Alinear arriba', icon: '⤒' },
  { mode: 'centerY', label: 'Centrar en vertical', icon: '↕' },
  { mode: 'bottom', label: 'Alinear abajo', icon: '⤓' },
];

const NO_ROOM = '__none__';

/** Resumen y acciones en lote para varios dispositivos seleccionados. */
export function MultiDeviceProperties({ devices }: { devices: Device[] }) {
  const rooms = useProjectStore((s) => s.project.rooms);
  const floors = useProjectStore((s) => s.project.floors);
  const select = useUiStore((s) => s.select);
  const ids = devices.map((d) => d.id);
  const floorIds = [...new Set(devices.map((d) => d.floorId))];
  const sameFloor = floorIds.length === 1;
  const floorRooms = sameFloor ? rooms.filter((r) => r.floorId === floorIds[0]) : [];
  const roomIds = [...new Set(devices.map((d) => d.roomId ?? ''))];
  const commonRoom = roomIds.length === 1 ? roomIds[0] || NO_ROOM : '';

  const definitionIds = [...new Set(devices.map((d) => d.definitionId))];
  const sharedDef = definitionIds.length === 1 ? definitionOf(devices[0] as Device) : undefined;
  const integrations = [...new Set(devices.map((d) => d.integration))];

  const byCategory = new Map<string, number>();
  for (const d of devices) {
    const def = definitionOf(d);
    const label = def ? CATEGORY_LABELS[def.category] : 'Desconocido';
    byCategory.set(label, (byCategory.get(label) ?? 0) + 1);
  }
  const floorName = new Map(floors.map((f) => [f.id, f.name]));

  return (
    <div className="flex flex-col gap-4 p-3">
      <section aria-label="Resumen de la selección" className="flex flex-col gap-1 text-xs text-slate-700">
        <p className="text-sm font-medium text-slate-800">{countLabel(devices.length, 'dispositivo seleccionado', 'dispositivos seleccionados')}</p>
        <p>{[...byCategory].map(([label, n]) => `${n} × ${label}`).join(' · ')}</p>
        {!sameFloor && <p>En {floorIds.length} plantas: {floorIds.map((id) => floorName.get(id) ?? '?').join(', ')}</p>}
      </section>

      <section aria-label="Acciones en lote" className="flex flex-col gap-2">
        <SelectField
          label="Asignar sala"
          value={commonRoom}
          placeholder={sameFloor ? (commonRoom === '' ? '— Varias salas —' : undefined) : '— Están en varias plantas —'}
          disabled={!sameFloor}
          options={[{ value: NO_ROOM, label: 'Sin sala' }, ...floorRooms.map((r) => ({ value: r.id, label: r.name }))]}
          onChange={(e) => {
            if (!e.target.value) return;
            assignRoomToDevices(ids, e.target.value === NO_ROOM ? undefined : e.target.value);
          }}
        />
        {sharedDef ? (
          <SelectField
            label="Integración"
            value={integrations.length === 1 ? (integrations[0] ?? '') : ''}
            placeholder={integrations.length === 1 ? undefined : '— Varias integraciones —'}
            options={sharedDef.integrations.map((i) => ({ value: i, label: INTEGRATION_LABELS[i] }))}
            onChange={(e) => {
              if (e.target.value) setIntegrationForDevices(ids, e.target.value as Integration);
            }}
          />
        ) : (
          <p className="text-xs text-slate-500">La integración se puede cambiar en lote si todos son del mismo modelo.</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => duplicateSelection(ids)} title="Ctrl+D">
            Duplicar
          </Button>
          <Button size="sm" variant="danger" onClick={() => void deleteDevices(ids)} title="Supr">
            Eliminar {devices.length}
          </Button>
        </div>
      </section>

      <section aria-label="Alinear y distribuir">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Alinear y distribuir</h3>
        {sameFloor ? (
          <div className="flex flex-wrap gap-1">
            {ALIGN.map((a) => (
              <Button key={a.mode} size="sm" aria-label={a.label} title={a.label} onClick={() => alignDevices(ids, a.mode)}>
                <span aria-hidden="true">{a.icon}</span>
              </Button>
            ))}
            <Button size="sm" disabled={devices.length < 3} onClick={() => distributeDevices(ids, 'horizontal')} title="Necesita al menos 3">
              Distribuir en horizontal
            </Button>
            <Button size="sm" disabled={devices.length < 3} onClick={() => distributeDevices(ids, 'vertical')} title="Necesita al menos 3">
              Distribuir en vertical
            </Button>
          </div>
        ) : (
          <p className="text-xs text-slate-500">Solo con dispositivos de la misma planta.</p>
        )}
      </section>

      <section aria-label="Dispositivos seleccionados">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Dispositivos</h3>
        <ul className="flex flex-col gap-0.5 text-sm">
          {devices.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                className="text-sky-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                onClick={() => select({ kind: 'device', id: d.id })}
              >
                {d.name}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
