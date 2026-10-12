import { useEffect, useState, type ReactNode } from 'react';
import type { Connection, Device, Protocol, Room } from '../types';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { useUiStore } from '../store/uiStore';
import {
  CATEGORY_LABELS,
  INTEGRATION_LABELS,
  POWER_LABELS,
  PROTOCOL_LABELS,
  IOT_CLASS_LABELS,
  isCloud,
} from '../devices/catalog';
import { Panel, EmptyState } from '../ui/Panel';
import { SelectField, TextField } from '../ui/Field';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { EntityControls } from '../simulation/EntityControls';
import { OfflineNotice } from '../simulation/OfflineNotice';
import { useDeviceOffline } from '../simulation/useDeviceOffline';
import { effectiveIotClass } from '../devices/roles';
import { analyzeProject, definitionOf, entitiesOfDevice } from './analysis';
import { PROTOCOL_COLORS, formatState } from './style';
import { DeviceDisplayOptions, EntityHistory } from './extras/DevicePropertiesExtras';

/** Input de texto que confirma el cambio al perder el foco o pulsar Intro. */
function CommitTextField({
  label,
  value,
  onCommit,
  allowEmpty = false,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  allowEmpty?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const v = draft.trim();
    if ((v || allowEmpty) && v !== value) onCommit(v);
    else setDraft(value);
  };
  return (
    <TextField
      label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setDraft(value);
      }}
    />
  );
}

function Dl({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-slate-500">{k}</dt>
          <dd className="text-slate-800">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function DeviceProperties({ device }: { device: Device }) {
  const project = useProjectStore((s) => s.project);
  const updateDevice = useProjectStore((s) => s.updateDevice);
  const removeDevices = useProjectStore((s) => s.removeDevices);
  const entities = useSimulationStore((s) => s.sim.entities);
  const select = useUiStore((s) => s.select);
  const def = definitionOf(device);
  const iotClass = def ? effectiveIotClass(device, def) : undefined;
  const refs = entitiesOfDevice(device);
  const issues = analyzeProject(project).issuesByDevice.get(device.id) ?? [];
  const rooms = project.rooms.filter((r) => r.floorId === device.floorId);
  const offline = useDeviceOffline(device.id);

  return (
    <div className="flex flex-col gap-4 p-3">
      <section className="flex flex-col gap-2" aria-label="Configuración">
        <CommitTextField label="Nombre" value={device.name} onCommit={(name) => updateDevice(device.id, { name })} />
        <SelectField
          label="Sala"
          value={device.roomId ?? ''}
          placeholder="Sin sala"
          options={rooms.map((r) => ({ value: r.id, label: r.name }))}
          onChange={(e) => updateDevice(device.id, { roomId: e.target.value || undefined })}
        />
        <SelectField
          label="Protocolo"
          value={device.protocol}
          options={(def?.protocols ?? [device.protocol]).map((p) => ({ value: p, label: PROTOCOL_LABELS[p] }))}
          onChange={(e) => updateDevice(device.id, { protocol: e.target.value as Protocol })}
        />
        <SelectField
          label="Integración"
          value={device.integration}
          options={(def?.integrations ?? [device.integration]).map((i) => ({ value: i, label: INTEGRATION_LABELS[i] }))}
          onChange={(e) => updateDevice(device.id, { integration: e.target.value as Device['integration'] })}
        />
        {def && def.power !== 'battery' && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={device.ups === true}
              onChange={(e) => updateDevice(device.id, { ups: e.target.checked ? true : undefined })}
              className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
            />
            Conectado a SAI
          </label>
        )}
        {def && (def.category === 'plug' || def.category === 'switch') && (
          <CommitTextField
            label="Carga conectada (W)"
            value={device.loadWatts === undefined ? '' : String(device.loadWatts)}
            allowEmpty
            onCommit={(v) => {
              const n = Number(v.replace(',', '.'));
              updateDevice(device.id, { loadWatts: v === '' || !Number.isFinite(n) || n < 0 ? undefined : n });
            }}
          />
        )}
        <DeviceDisplayOptions device={device} />
      </section>

      {def && iotClass && (
        <section aria-label="Ficha del dispositivo">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Ficha</h3>
          <Dl
            items={[
              ['Marca', def.brand],
              ['Modelo', def.model],
              ['Categoría', CATEGORY_LABELS[def.category]],
              [
                'Conectividad',
                <Badge key="c" tone={isCloud(iotClass) ? 'violet' : 'green'}>
                  {isCloud(iotClass) ? 'Nube' : 'Local'} · {IOT_CLASS_LABELS[iotClass]}
                </Badge>,
              ],
              ['Alimentación', POWER_LABELS[def.power]],
              ...(def.requiresHub ? ([['Requiere hub', def.requiresHub]] as Array<[string, string]>) : []),
              ...(def.rangeMeters ? ([['Alcance', `${def.rangeMeters} m`]] as Array<[string, string]>) : []),
            ]}
          />
        </section>
      )}

      {issues.length > 0 && (
        <section aria-label="Incidencias del dispositivo">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Incidencias</h3>
          <ul className="flex flex-col gap-1">
            {issues.map((i) => (
              <li
                key={i.id}
                className={
                  i.severity === 'error'
                    ? 'rounded bg-red-50 px-2 py-1 text-xs text-red-800'
                    : i.severity === 'warning'
                      ? 'rounded bg-amber-50 px-2 py-1 text-xs text-amber-800'
                      : 'rounded bg-sky-50 px-2 py-1 text-xs text-sky-800'
                }
              >
                {i.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Entidades">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Entidades y simulación</h3>
        {offline ? (
          <OfflineNotice deviceId={device.id} />
        ) : refs.length === 0 ? (
          <p className="text-xs text-slate-500">Este dispositivo no expone entidades.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {refs.map((r) => (
              <li key={r.entityId} className="rounded-md border border-slate-200 p-2">
                <div className="flex items-baseline justify-between gap-2">
                  <code className="truncate text-[11px] text-slate-700" title={r.entityId}>
                    {r.entityId}
                  </code>
                  <span className="whitespace-nowrap text-xs font-semibold text-slate-900" aria-label={`Estado de ${r.entityId}`}>
                    {formatState(entities[r.entityId], r.definition.unit)}
                  </span>
                </div>
                <div className="mb-1 text-[11px] text-slate-500">{r.definition.name}</div>
                <EntityControls entityId={r.entityId} definition={r.definition} state={entities[r.entityId]} />
                <EntityHistory entityId={r.entityId} definition={r.definition} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <Button
        variant="danger"
        onClick={() => {
          removeDevices([device.id]);
          select(null);
        }}
      >
        Eliminar dispositivo
      </Button>
    </div>
  );
}

function RoomProperties({ room }: { room: Room }) {
  const updateRoom = useProjectStore((s) => s.updateRoom);
  const removeRoom = useProjectStore((s) => s.removeRoom);
  const devices = useProjectStore((s) => s.project.devices);
  const select = useUiStore((s) => s.select);
  const inside = devices.filter((d) => d.roomId === room.id);
  return (
    <div className="flex flex-col gap-4 p-3">
      <CommitTextField label="Nombre de la sala" value={room.name} onCommit={(name) => updateRoom(room.id, { name })} />
      <section aria-label="Dispositivos de la sala">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Dispositivos ({inside.length})</h3>
        {inside.length === 0 ? (
          <p className="text-xs text-slate-500">Arrastra dispositivos dentro de la sala para asignarlos.</p>
        ) : (
          <ul className="flex flex-col gap-0.5 text-sm">
            {inside.map((d) => (
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
        )}
      </section>
      <Button
        variant="danger"
        onClick={() => {
          removeRoom(room.id);
          select(null);
        }}
      >
        Eliminar sala
      </Button>
    </div>
  );
}

function ConnectionProperties({ connection }: { connection: Connection }) {
  const devices = useProjectStore((s) => s.project.devices);
  const removeConnections = useProjectStore((s) => s.removeConnections);
  const select = useUiStore((s) => s.select);
  const a = devices.find((d) => d.id === connection.sourceId);
  const b = devices.find((d) => d.id === connection.targetId);
  return (
    <div className="flex flex-col gap-4 p-3">
      <Dl
        items={[
          [
            'Protocolo',
            <Badge key="p" color={PROTOCOL_COLORS[connection.protocol]}>
              {PROTOCOL_LABELS[connection.protocol]}
            </Badge>,
          ],
          ['Origen', a?.name ?? '—'],
          ['Destino', b?.name ?? '—'],
        ]}
      />
      <Button
        variant="danger"
        onClick={() => {
          removeConnections([connection.id]);
          select(null);
        }}
      >
        Eliminar conexión
      </Button>
    </div>
  );
}

/** Panel derecho contextual con las propiedades de la selección. */
export function PropertiesPanel() {
  const selection = useUiStore((s) => s.selection);
  const project = useProjectStore((s) => s.project);

  let title = 'Propiedades';
  let body: ReactNode = (
    <EmptyState>Selecciona un dispositivo, una sala o una conexión en el lienzo.</EmptyState>
  );

  if (selection?.kind === 'device') {
    const device = project.devices.find((d) => d.id === selection.id);
    if (device) {
      title = 'Dispositivo';
      body = <DeviceProperties key={device.id} device={device} />;
    }
  } else if (selection?.kind === 'room') {
    const room = project.rooms.find((r) => r.id === selection.id);
    if (room) {
      title = 'Sala';
      body = <RoomProperties key={room.id} room={room} />;
    }
  } else if (selection?.kind === 'connection') {
    const connection = project.connections.find((c) => c.id === selection.id);
    if (connection) {
      title = 'Conexión';
      body = <ConnectionProperties connection={connection} />;
    }
  }

  return (
    <Panel as="aside" title={title} aria-label="Propiedades" className="h-full">
      {body}
    </Panel>
  );
}
