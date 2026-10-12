import { useEffect, useMemo, useState } from 'react';
import { useBridgeStore, type BridgeStoreState } from './bridgeStore';
import { couple, labAction, nodeAction } from './runtime';
import { useBridgeSettings } from './useBridge';
import { useLocalLab } from './localLab';
import { useProjectStore } from '../store/projectStore';
import { allDefinitions, catalog } from '../devices/catalog';
import { viaInfo, RADIO_LABEL } from './via';
import { CONNECTION_LABELS, HA_LABELS, NODE_STATE_LABELS, OTHER_TAB_MESSAGE, SERVICE_LABELS, formatBytes } from './labels';
import { TrafficView } from './TrafficView';
import { Button } from '../ui/Button';
import { Badge, type BadgeTone } from '../ui/Badge';
import { inputClass } from '../ui/Field';
import { confirmDialog } from '../ui/confirm';
import { useUiStore } from '../store/uiStore';
import type { NodeState } from './protocol';

/** Referencia estable: un {} nuevo en el selector haría que zustand repinte sin fin. */
const NO_NODES: Record<string, NodeState> = {};

const NODE_TONE: Record<NodeState, BadgeTone> = { stopped: 'slate', starting: 'amber', running: 'green', error: 'red' };

type Tab = BridgeStoreState['panelTab'];
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'nodes', label: 'Nodos' },
  { key: 'traffic', label: 'Tráfico' },
  { key: 'snapshots', label: 'Snapshots' },
];

function StatusLine() {
  const connection = useBridgeStore((s) => s.connection);
  const live = useBridgeStore((s) => s.live);
  const reason = useBridgeStore((s) => s.decoupledReason);
  const status = useBridgeStore((s) => s.status);
  const settings = useBridgeSettings();
  const enabled = useLocalLab((s) => s.enabled);
  const openSettings = () => useUiStore.getState().setSettingsOpen(true, 'lab');
  if (!enabled) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
        <span>El laboratorio está desactivado en esta máquina.</span>
        <Button size="sm" variant="primary" onClick={openSettings}>
          Configurar el laboratorio…
        </Button>
      </div>
    );
  }
  if (connection === 'other_tab') {
    return (
      <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs font-medium text-amber-900">
        {OTHER_TAB_MESSAGE}. Ciérrala o desactiva allí el laboratorio para controlarlo desde aquí.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>
          Orquestador: <strong>{CONNECTION_LABELS[connection]}</strong>
        </span>
        {status && (
          <>
            <span>
              Mosquitto: <strong>{SERVICE_LABELS[status.mqtt]}</strong>
            </span>
            <span>
              Home Assistant: <strong>{HA_LABELS[status.ha]}</strong>
            </span>
          </>
        )}
      </div>
      {connection === 'unauthorized' && (
        <div className="flex flex-wrap items-center gap-2 text-red-800">
          <span>El orquestador exige el token del laboratorio (LAB_TOKEN de emulator/.env).</span>
          <Button size="sm" onClick={openSettings}>
            Poner el token…
          </Button>
        </div>
      )}
      {connection === 'readonly' && <p className="text-amber-900">Solo lectura: otra app (otro navegador u otro PC) controla el laboratorio.</p>}
      {connection === 'connected' && (
        <div className="flex flex-wrap items-center gap-2">
          {live ? (
            <Badge tone="green">En vivo · 1x</Badge>
          ) : (
            <>
              <Badge tone="amber">Desacoplado</Badge>
              <span>{reason ? `(${reason}) ` : ''}HA ve los dispositivos como no disponibles.</span>
              <Button size="sm" variant="primary" onClick={() => couple()}>
                Volver a acoplar
              </Button>
            </>
          )}
          <span>
            Automatizaciones: <strong>{settings.automationsRunIn === 'home_assistant' ? 'en el HA del lab (desactivadas en el simulador)' : 'en el simulador'}</strong>
          </span>
        </div>
      )}
    </div>
  );
}

function NodesTab() {
  const devices = useProjectStore((s) => s.project.devices);
  const custom = useProjectStore((s) => s.project.customDefinitions);
  const nodes = useBridgeStore((s) => s.status?.nodes ?? NO_NODES);
  const busy = useBridgeStore((s) => s.busy.reset);
  const connected = useBridgeStore((s) => s.connection === 'connected');
  const rows = useMemo(() => {
    // Catálogo + personalizados: los dispositivos personalizados también son nodos del lab.
    const all = allDefinitions({ customDefinitions: custom }, catalog);
    return devices
        .map((d) => ({ device: d, def: all.find((x) => x.id === d.definitionId) }))
        .filter((r) => r.def !== undefined && r.def.role !== 'ha_server');
  }, [devices, custom]);
  const reset = async () => {
    const ok = await confirmDialog({
      title: '¿Resetear el laboratorio?',
      message: 'Se borran los mensajes retenidos de discovery y de estado, se vuelve a publicar todo y el simulador vuelve a los estados iniciales del proyecto.',
      confirmLabel: 'Resetear lab',
      danger: true,
    });
    if (ok) labAction('reset');
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" disabled={!connected} onClick={() => nodeAction('start', 'all')}>
          ▶ Arrancar todo
        </Button>
        <Button size="sm" disabled={!connected} onClick={() => nodeAction('stop', 'all')}>
          ■ Parar todo
        </Button>
        <Button size="sm" variant="danger" disabled={!connected || busy !== undefined} onClick={() => void reset()}>
          {busy ? 'Reseteando…' : '⟲ Resetear lab'}
        </Button>
      </div>
      <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-auto rounded border border-slate-200" aria-label="Nodos del laboratorio">
        {rows.map(({ device, def }) => {
          const state = nodes[device.id];
          const via = def ? viaInfo(device, def) : undefined;
          return (
            <li key={device.id} className="flex items-center gap-2 px-2 py-1.5 text-xs">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-800">{device.name}</p>
                <p className="truncate text-slate-500" title={via?.note}>
                  Vía hacia HA: {via?.label} · {RADIO_LABEL}
                </p>
              </div>
              <Badge tone={state ? NODE_TONE[state] : 'slate'}>{state ? NODE_STATE_LABELS[state] : 'Sin publicar'}</Badge>
              {state === 'running' || state === 'starting' ? (
                <Button size="sm" disabled={!connected} onClick={() => nodeAction('stop', [device.id])} aria-label={`Parar ${device.name}`}>
                  Parar
                </Button>
              ) : (
                <Button size="sm" disabled={!connected || state === undefined} onClick={() => nodeAction('start', [device.id])} aria-label={`Arrancar ${device.name}`}>
                  Arrancar
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SnapshotsTab() {
  const snapshots = useBridgeStore((s) => s.snapshots);
  const busy = useBridgeStore((s) => s.busy);
  const capabilities = useBridgeStore((s) => s.status?.capabilities);
  const connected = useBridgeStore((s) => s.connection === 'connected');
  const [name, setName] = useState('');
  const [noCredentials, setNoCredentials] = useState(false);
  useEffect(() => {
    if (connected) labAction('list_snapshots');
  }, [connected]);
  const canRestore = capabilities?.docker === true;
  const restore = async (id: string, label: string) => {
    const ok = await confirmDialog({
      title: `¿Restaurar «${label}»?`,
      message:
        'Se para Home Assistant, se sustituye la configuración del lab (ha-config, sin la base de datos ni los logs) por la del snapshot y se vuelve a arrancar. El proyecto del snapshot se fusiona con el actual (se conservan el id, las variantes y las imágenes del plano) y el lab vuelve a acoplarse.',
      confirmLabel: 'Restaurar',
      danger: true,
    });
    if (ok) labAction('restore', { id });
  };
  const remove = async (id: string, label: string) => {
    const ok = await confirmDialog({ title: `¿Borrar el snapshot «${label}»?`, message: 'No se puede deshacer.', confirmLabel: 'Borrar', danger: true });
    if (ok) labAction('delete_snapshot', { id });
  };
  if (capabilities && !capabilities.snapshots) {
    return <p className="text-xs text-slate-600">Este orquestador no tiene acceso a ha-config: arranca el laboratorio con el docker-compose de emulator/ para usar los snapshots.</p>;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 text-xs">
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (labAction('snapshot', { name: name.trim() || 'Snapshot', excludeCredentials: noCredentials })) setName('');
        }}
      >
        <label className="flex flex-1 flex-col text-slate-600">
          Nombre del snapshot
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="p. ej. Antes de probar la alarma" />
        </label>
        <Button type="submit" size="sm" variant="primary" disabled={!connected || busy.snapshot !== undefined}>
          {busy.snapshot ? 'Guardando…' : '📷 Guardar snapshot'}
        </Button>
      </form>
      <label className="flex items-center gap-2 text-slate-700">
        <input type="checkbox" checked={noCredentials} onChange={(e) => setNoCredentials(e.target.checked)} />
        Excluir credenciales (.storage/auth*: usuarios, contraseñas y tokens de HA)
      </label>
      <p className="text-amber-900">
        Atención: un snapshot es una copia de ha-config e <strong>incluye secretos</strong>: usuarios y contraseñas de HA, tokens de acceso (auth*) y las credenciales de las integraciones
        (.storage/core.config_entries, p. ej. la contraseña MQTT). Se guardan en emulator/snapshots/ con permisos solo para el propietario; no los compartas. No incluye la base de datos del
        historial, los logs ni las cachés.
      </p>
      {!canRestore && capabilities && (
        <p className="text-slate-600">
          Restaurar necesita que el orquestador controle Docker (perfil opcional: <code>emulator/scripts/setup.sh --docker</code>) para parar HA antes de copiar. Sin él, la restauración está
          desactivada.
        </p>
      )}
      <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-auto rounded border border-slate-200" aria-label="Snapshots">
        {snapshots.length === 0 && <li className="p-2 text-slate-500">Todavía no hay snapshots.</li>}
        {snapshots.map((s) => (
          <li key={s.id} className="flex items-center gap-2 px-2 py-1.5">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-slate-800">{s.name}</p>
              <p className="text-slate-500">
                {new Date(s.createdAt).toLocaleString('es-ES')} · {formatBytes(s.bytes)}
                {s.projectName ? ` · ${s.projectName}` : ''}
              </p>
            </div>
            {s.credentials === false && <Badge tone="slate">sin credenciales</Badge>}
            <Button size="sm" disabled={!connected || !canRestore || busy.restore !== undefined} onClick={() => void restore(s.id, s.name)} title={canRestore ? undefined : 'Necesita el perfil con Docker'}>
              Restaurar
            </Button>
            <Button size="sm" variant="danger" disabled={!connected} onClick={() => void remove(s.id, s.name)} aria-label={`Borrar ${s.name}`}>
              Borrar
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Panel lateral del laboratorio: nodos, tráfico y snapshots. No es modal: el lienzo sigue usable.
 * Se coloca bajo la barra superior (`top`, su altura) y se puede plegar a solo la cabecera.
 */
export function LabPanel({ top = 0 }: { top?: number }) {
  const tab = useBridgeStore((s) => s.panelTab);
  const collapsed = useBridgeStore((s) => s.panelCollapsed);
  const close = () => useBridgeStore.getState().setPanel(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useBridgeStore.getState().setPanel(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <aside
      role="complementary"
      aria-label="Laboratorio"
      style={{ top }}
      className={`fixed right-0 z-40 flex w-full max-w-2xl flex-col gap-2 border-l border-slate-200 bg-white p-3 shadow-xl ${collapsed ? 'border-b' : 'bottom-0'}`}
    >
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold text-slate-800">Laboratorio</h2>
        <Button size="sm" variant="ghost" onClick={() => useUiStore.getState().setSettingsOpen(true, 'lab')}>
          ⚙ Ajustes
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={() => useBridgeStore.getState().setPanelCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Desplegar el laboratorio' : 'Plegar el laboratorio'}
          title={collapsed ? 'Desplegar' : 'Plegar'}
        >
          {collapsed ? '▾' : '▴'}
        </Button>
        <Button size="sm" variant="ghost" onClick={close} aria-label="Cerrar el laboratorio">
          ✕
        </Button>
      </div>
      {!collapsed && (
        <>
          <StatusLine />
          <div role="tablist" aria-label="Secciones del laboratorio" className="flex gap-1 border-b border-slate-200">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                type="button"
                aria-selected={tab === t.key}
                onClick={() => useBridgeStore.getState().setPanel(true, t.key)}
                className={`-mb-px border-b-2 px-3 py-1 text-sm ${tab === t.key ? 'border-sky-700 font-semibold text-sky-800' : 'border-transparent text-slate-600 hover:text-slate-800'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="flex min-h-0 flex-1 flex-col">
            {tab === 'nodes' && <NodesTab />}
            {tab === 'traffic' && <TrafficView />}
            {tab === 'snapshots' && <SnapshotsTab />}
          </div>
        </>
      )}
    </aside>
  );
}
