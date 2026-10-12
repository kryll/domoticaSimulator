import { useCallback, useMemo, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import type { Brand, DeviceCategory, DeviceDefinition, Protocol } from '../types';
import { CATEGORY_LABELS, PROTOCOL_LABELS, catalog, filterCatalog, type CatalogFilter } from '../devices/catalog';
import { addCatalogDevice } from '../canvas/placeDevice';
import { Panel, EmptyState } from '../ui/Panel';
import { SelectField, TextField } from '../ui/Field';
import { Button } from '../ui/Button';
import { CatalogCard } from './CatalogCard';
import { countLabel } from '../ui/plural';

type Connectivity = NonNullable<CatalogFilter['connectivity']>;

export interface CatalogPanelProps {
  definitions?: DeviceDefinition[];
  /** Sustituye la acción de añadir (útil en tests o fuera del lienzo). */
  onAdd?: (definition: DeviceDefinition) => void;
}

function uniqueSorted<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'es'));
}

export function CatalogPanel({ definitions = catalog, onAdd }: CatalogPanelProps) {
  const [query, setQuery] = useState('');
  const [brand, setBrand] = useState<Brand | ''>('');
  const [protocol, setProtocol] = useState<Protocol | ''>('');
  const [category, setCategory] = useState<DeviceCategory | ''>('');
  const [connectivity, setConnectivity] = useState<Connectivity>('all');

  const brands = useMemo(() => uniqueSorted(definitions.map((d) => d.brand)), [definitions]);
  const protocols = useMemo(() => uniqueSorted(definitions.flatMap((d) => d.protocols)), [definitions]);
  const categories = useMemo(() => uniqueSorted(definitions.map((d) => d.category)), [definitions]);

  const results = useMemo(() => {
    const filter: CatalogFilter = {
      query: query.trim() || undefined,
      brands: brand ? [brand] : undefined,
      protocols: protocol ? [protocol] : undefined,
      categories: category ? [category] : undefined,
      connectivity,
    };
    return filterCatalog(definitions, filter);
  }, [definitions, query, brand, protocol, category, connectivity]);

  const { screenToFlowPosition } = useReactFlow();
  const handleAdd = useCallback(
    (def: DeviceDefinition) => {
      if (onAdd) onAdd(def);
      else addCatalogDevice(def.id, screenToFlowPosition);
    },
    [onAdd, screenToFlowPosition],
  );

  const hasFilters = query || brand || protocol || category || connectivity !== 'all';

  return (
    <Panel as="aside" title="Catálogo" aria-label="Catálogo de dispositivos" className="h-full" bodyClassName="flex flex-col">
      <div className="flex flex-col gap-2 border-b border-slate-200 p-3">
        <TextField
          label="Buscar dispositivo"
          data-catalog-search=""
          type="search"
          placeholder="Marca, modelo o nombre…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-2">
          <SelectField
            label="Marca"
            value={brand}
            onChange={(e) => setBrand(e.target.value as Brand | '')}
            placeholder="Todas"
            options={brands.map((b) => ({ value: b, label: b }))}
          />
          <SelectField
            label="Protocolo"
            value={protocol}
            onChange={(e) => setProtocol(e.target.value as Protocol | '')}
            placeholder="Todos"
            options={protocols.map((p) => ({ value: p, label: PROTOCOL_LABELS[p] }))}
          />
          <SelectField
            label="Categoría"
            value={category}
            onChange={(e) => setCategory(e.target.value as DeviceCategory | '')}
            placeholder="Todas"
            options={categories.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
          />
          <SelectField
            label="Conectividad"
            value={connectivity}
            onChange={(e) => setConnectivity(e.target.value as Connectivity)}
            options={[
              { value: 'all', label: 'Local y nube' },
              { value: 'local', label: 'Solo local' },
              { value: 'cloud', label: 'Solo nube' },
            ]}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span aria-live="polite">{countLabel(results.length, 'dispositivo', 'dispositivos')}</span>
          {hasFilters && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setQuery('');
                setBrand('');
                setProtocol('');
                setCategory('');
                setConnectivity('all');
              }}
            >
              Limpiar filtros
            </Button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {results.length === 0 ? (
          <EmptyState>Ningún dispositivo coincide con los filtros.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-1.5" aria-label="Resultados del catálogo">
            {results.map((def) => (
              <CatalogCard key={def.id} definition={def} onAdd={handleAdd} />
            ))}
          </ul>
        )}
        <p className="mt-2 px-1 text-[11px] text-slate-600">Arrastra una tarjeta al lienzo o pulsa «+» para añadirla a la sala seleccionada (o a la última dibujada).</p>
      </div>
    </Panel>
  );
}
