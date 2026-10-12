import { useMemo, useState } from 'react';
import type { EntityDefinition, EntityState, Helper } from '../types';
import { HelperControl } from '../helpers/HelperControl';
import { HELPER_ICONS } from '../helpers/helperModel';
import { helperEntityId } from '../simulation/helpers';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { useUiStore } from '../store/uiStore';
import { projectEntities, knownDefinitions } from '../canvas/analysis';
import { entityStateText } from '../ui/stateText';
import { EntityControls } from '../simulation/EntityControls';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Tabs } from '../ui/Tabs';
import { EmptyState } from '../ui/Panel';
import { downloadText } from '../ui/download';
import { cx } from '../ui/cx';
import { countLabel } from '../ui/plural';
import { countCards, dashboardToYaml, generateDashboard, type DashboardCard } from './lovelace';
import { domainIcon, tileAction, tileActive } from '../lovelace/tileAction';

interface EntityInfo {
  name: string;
  definition?: EntityDefinition;
}

type Lookup = Map<string, EntityInfo>;

function useEntity(entityId: string): EntityState | undefined {
  return useSimulationStore((s) => s.sim.entities[entityId]);
}

function displayName(entityId: string, state: EntityState | undefined, lookup: Lookup): string {
  const friendly = state?.attributes?.friendly_name;
  return lookup.get(entityId)?.name ?? (typeof friendly === 'string' ? friendly : entityId);
}


function Tile({ entityId, name, lookup, onMore }: { entityId: string; name?: string; lookup: Lookup; onMore: (id: string) => void }) {
  const state = useEntity(entityId);
  const callService = useSimulationStore((s) => s.callService);
  const action = tileAction(entityId, state);
  const active = tileActive(state);
  const info = lookup.get(entityId);
  const label = name ?? displayName(entityId, state, lookup);
  const stateText = entityStateText(entityId, state, info?.definition);
  return (
    <div className={cx('flex items-center gap-2 rounded-xl border p-2 shadow-sm', active ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white')}>
      <button
        type="button"
        disabled={!action}
        onClick={() => action && callService(entityId, action.service)}
        aria-label={action ? `${action.label} ${label}` : label}
        title={action?.label}
        className={cx(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-default',
          active ? 'bg-amber-200' : 'bg-slate-100',
        )}
      >
        <span aria-hidden="true">{domainIcon(entityId)}</span>
      </button>
      <button
        type="button"
        onClick={() => onMore(entityId)}
        disabled={!info?.definition}
        className="min-w-0 flex-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-default"
        title={info?.definition ? 'Más información' : entityId}
      >
        <span className="block truncate text-sm font-medium text-slate-800">{label}</span>
        <span className="block truncate text-xs text-slate-500" data-testid={`tile-state-${entityId}`}>
          {stateText}
        </span>
      </button>
    </div>
  );
}

function EntityRow({ entityId, lookup, onMore }: { entityId: string; lookup: Lookup; onMore: (id: string) => void }) {
  const state = useEntity(entityId);
  const info = lookup.get(entityId);
  return (
    <li>
      <button
        type="button"
        onClick={() => onMore(entityId)}
        disabled={!info?.definition}
        className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left text-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true">{domainIcon(entityId)}</span>
          <span className="truncate text-slate-700">{displayName(entityId, state, lookup)}</span>
        </span>
        <span className="shrink-0 font-medium tabular-nums text-slate-900">{entityStateText(entityId, state, info?.definition)}</span>
      </button>
    </li>
  );
}

/** Tarjeta con los controles existentes (termostato, reproductor). */
function ControlCard({ entityId, lookup }: { entityId: string; lookup: Lookup }) {
  const state = useEntity(entityId);
  const info = lookup.get(entityId);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-semibold text-slate-800">
          <span aria-hidden="true">{domainIcon(entityId)} </span>
          {displayName(entityId, state, lookup)}
        </span>
        <span className="text-xs text-slate-600">{entityStateText(entityId, state, info?.definition)}</span>
      </div>
      {info?.definition ? <EntityControls entityId={entityId} definition={info.definition} state={state} /> : <p className="text-xs text-slate-500">{entityId}</p>}
    </div>
  );
}

function Card({ card, lookup, onMore }: { card: DashboardCard; lookup: Lookup; onMore: (id: string) => void }) {
  switch (card.type) {
    case 'heading':
      return <h4 className="col-span-full text-sm font-semibold text-slate-700">{card.heading}</h4>;
    case 'tile':
      return <Tile entityId={card.entity} name={card.name} lookup={lookup} onMore={onMore} />;
    case 'entities':
      return (
        <div className="col-span-full rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
          {card.title && <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{card.title}</div>}
          <ul className="flex flex-col">
            {card.entities.map((id) => (
              <EntityRow key={id} entityId={id} lookup={lookup} onMore={onMore} />
            ))}
          </ul>
        </div>
      );
    case 'thermostat':
    case 'media-control':
      return (
        <div className="col-span-full">
          <ControlCard entityId={card.entity} lookup={lookup} />
        </div>
      );
    case 'picture-glance':
      return (
        <div className="col-span-full overflow-hidden rounded-xl border border-slate-200 bg-slate-800 text-white shadow-sm">
          <div className="flex h-24 items-center justify-center text-3xl" aria-hidden="true">
            📷
          </div>
          <div className="flex items-center justify-between gap-2 bg-black/40 px-2 py-1 text-xs">
            <span className="truncate">{card.title ?? card.camera_image}</span>
            <span className="flex gap-1">
              {card.entities.map((id) => (
                <button key={id} type="button" className="rounded px-1 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400" onClick={() => onMore(id)} title={id}>
                  {domainIcon(id)}
                </button>
              ))}
            </span>
          </div>
        </div>
      );
  }
}

function MoreInfo({ entityId, lookup, onClose }: { entityId: string; lookup: Lookup; onClose: () => void }) {
  const state = useEntity(entityId);
  const info = lookup.get(entityId);
  return (
    <Modal open title={displayName(entityId, state, lookup)} onClose={onClose}>
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <code className="text-xs text-slate-500">{entityId}</code>
          <strong className="text-sm">{entityStateText(entityId, state, info?.definition)}</strong>
        </div>
        {info?.definition && <EntityControls entityId={entityId} definition={info.definition} state={state} />}
      </div>
    </Modal>
  );
}

const NO_HELPERS: Helper[] = [];

/** Tanda 3: tarjeta con los helpers del proyecto y sus controles. */
function HelpersCard({ helpers }: { helpers: Helper[] }) {
  return (
    <section aria-label="Ayudantes" className="flex flex-col gap-2 rounded-2xl bg-slate-100/70 p-2">
      <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-600">Ayudantes</h3>
      {helpers.map((h) => (
        <div key={h.id} className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
          <span className="text-sm font-medium text-slate-800">
            <span aria-hidden="true">{HELPER_ICONS[h.type]}</span> {h.name}
          </span>
          <HelperControl helper={h} entityId={helperEntityId(h)} />
        </div>
      ))}
    </section>
  );
}

/** Pestaña «Dashboard»: el dashboard Lovelace generado, interactivo, con exportación a YAML (B15). */
export function DashboardView({ readOnly = false }: { readOnly?: boolean } = {}) {
  const project = useProjectStore((s) => s.project);
  const dashboard = useMemo(() => generateDashboard(project, knownDefinitions()), [project]);
  const lookup = useMemo<Lookup>(() => {
    const map: Lookup = new Map();
    for (const ref of projectEntities(project)) map.set(ref.entityId, { name: ref.friendlyName, definition: ref.definition });
    return map;
  }, [project]);
  const helpers = project.helpers ?? NO_HELPERS;
  const [viewPath, setViewPath] = useState<string | null>(null);
  const [more, setMore] = useState<string | null>(null);
  const view = dashboard.views.find((v) => v.path === viewPath) ?? dashboard.views[0];
  const cards = countCards(dashboard);

  const exportYaml = () => {
    downloadText(dashboardToYaml(dashboard), 'ui-lovelace.yaml', 'text/yaml');
    useUiStore.getState().notify('Dashboard exportado como ui-lovelace.yaml', 'success');
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-1">
        {dashboard.views.length > 1 && view && (
          <Tabs<string>
            label="Vistas del dashboard"
            tabs={dashboard.views.map((v) => ({ key: v.path, label: v.title }))}
            active={view.path}
            onChange={setViewPath}
          />
        )}
        <span className="text-xs text-slate-600">{countLabel(cards, 'tarjeta', 'tarjetas')}</span>
        {!readOnly && (
          <Button size="sm" className="ml-auto" onClick={exportYaml}>
            Exportar YAML Lovelace
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3" role="region" aria-label={view ? `Vista ${view.title}` : 'Dashboard'}>
        {(!view || view.sections.length === 0) && helpers.length === 0 ? (
          <EmptyState>El dashboard está vacío: añade dispositivos con entidades al plano.</EmptyState>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] items-start gap-3">
            {(view?.sections ?? []).map((section, i) => (
              <section key={section.roomId ?? `s${i}`} className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100/70 p-2">
                {section.cards.map((card, j) => (
                  <Card key={j} card={card} lookup={lookup} onMore={setMore} />
                ))}
              </section>
            ))}
            {helpers.length > 0 && <HelpersCard helpers={helpers} />}
          </div>
        )}
      </div>
      {more && <MoreInfo entityId={more} lookup={lookup} onClose={() => setMore(null)} />}
    </div>
  );
}
