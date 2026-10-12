import { useMemo, useState } from 'react';
import { knownDefinitions } from '../canvas/analysis';
import { countLabel } from '../ui/plural';
import type { ProjectVariant } from '../types';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { SelectField, TextField } from '../ui/Field';
import { cx } from '../ui/cx';
import { formatMoney } from '../ui/money';
import {
  applyVariant,
  budgetCost,
  compareVariants,
  createVariant,
  deleteVariant,
  snapshotOf,
  updateVariant,
  type ProjectSnapshot,
  type VariantSummary,
} from './variants';
import { confirmDialog } from '../ui/confirm';

const CURRENT = '__actual__';
const EMPTY: ProjectVariant[] = [];

type NumKey = 'devices' | 'local' | 'cloud' | 'batteries' | 'automations';

const ROWS: Array<{ key: NumKey | 'hubs' | 'cloudDependencies'; label: string; lowerIsBetter: boolean }> = [
  { key: 'devices', label: 'Dispositivos', lowerIsBetter: false },
  { key: 'local', label: 'Con integración local', lowerIsBetter: false },
  { key: 'cloud', label: 'Con integración en la nube', lowerIsBetter: true },
  { key: 'hubs', label: 'Hubs, coordinadores y border routers', lowerIsBetter: true },
  { key: 'cloudDependencies', label: 'Automatizaciones que dependen de Internet', lowerIsBetter: true },
  { key: 'batteries', label: 'Dispositivos a pilas', lowerIsBetter: true },
  { key: 'automations', label: 'Automatizaciones', lowerIsBetter: false },
];

function value(s: VariantSummary, key: (typeof ROWS)[number]['key']): number {
  if (key === 'hubs') return s.hubs.length;
  if (key === 'cloudDependencies') return s.cloudDependencies.length;
  return s[key];
}

function Diff({ n, lowerIsBetter }: { n: number; lowerIsBetter: boolean }) {
  if (n === 0) return <span className="text-slate-400">=</span>;
  const good = lowerIsBetter ? n < 0 : n > 0;
  return <span className={good ? 'font-semibold text-emerald-700' : 'font-semibold text-red-700'}>{n > 0 ? `+${n}` : n}</span>;
}

function CostDiff({ n }: { n: number }) {
  if (Math.abs(n) < 0.005) return <span className="text-slate-400">=</span>;
  return <span className={n < 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-red-700'}>{`${n > 0 ? '+' : '−'}${formatMoney(Math.abs(n))}`}</span>;
}

function CompareDialog({ initialA, initialB, onClose }: { initialA: string; initialB: string; onClose: () => void }) {
  const project = useProjectStore((s) => s.project);
  const variants = project.variants ?? EMPTY;
  const [a, setA] = useState(initialA);
  const [b, setB] = useState(initialB);
  const options = [{ value: CURRENT, label: 'Proyecto actual' }, ...variants.map((v) => ({ value: v.id, label: v.name }))];
  const label = (id: string) => options.find((o) => o.value === id)?.label ?? id;
  const comparison = useMemo(() => {
    const snap = (id: string): ProjectSnapshot | undefined => (id === CURRENT ? snapshotOf(project) : variants.find((v) => v.id === id)?.snapshot);
    const sa = snap(a);
    const sb = snap(b);
    return sa && sb ? compareVariants(sa, sb, knownDefinitions(), budgetCost(knownDefinitions())) : null;
  }, [a, b, project, variants]);

  return (
    <Modal open size="lg" title="Comparar variantes" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <SelectField label="Variante A" value={a} options={options} onChange={(e) => setA(e.target.value)} />
          <SelectField label="Variante B" value={b} options={options} onChange={(e) => setB(e.target.value)} />
        </div>
        {comparison && (
          <>
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">
                Diferencias entre {label(a)} y {label(b)}
              </caption>
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th scope="col" className="py-1 pr-2">
                    Aspecto
                  </th>
                  <th scope="col" className="px-2 py-1 text-right">
                    {label(a)}
                  </th>
                  <th scope="col" className="px-2 py-1 text-right">
                    {label(b)}
                  </th>
                  <th scope="col" className="py-1 pl-2 text-right">
                    Diferencia
                  </th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => {
                  const va = value(comparison.a, row.key);
                  const vb = value(comparison.b, row.key);
                  return (
                    <tr key={row.key} className={cx('border-b border-slate-100', va !== vb && 'bg-amber-50/60')}>
                      <th scope="row" className="py-1 pr-2 text-left font-normal text-slate-700">
                        {row.label}
                      </th>
                      <td className="px-2 py-1 text-right tabular-nums">{va}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{vb}</td>
                      <td className="py-1 pl-2 text-right tabular-nums">
                        <Diff n={vb - va} lowerIsBetter={row.lowerIsBetter} />
                      </td>
                    </tr>
                  );
                })}
                {comparison.a.cost !== undefined && comparison.b.cost !== undefined && (
                  <tr className={cx('border-b border-slate-100', comparison.a.cost !== comparison.b.cost && 'bg-amber-50/60')}>
                    <th scope="row" className="py-1 pr-2 text-left font-normal text-slate-700">
                      Coste (presupuesto)
                    </th>
                    <td className="px-2 py-1 text-right tabular-nums">{formatMoney(comparison.a.cost)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{formatMoney(comparison.b.cost)}</td>
                    <td className="py-1 pl-2 text-right tabular-nums">
                      <CostDiff n={comparison.diff.cost ?? 0} />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
              {[
                { id: a, s: comparison.a },
                { id: b, s: comparison.b },
              ].map(({ id, s }, i) => (
                <div key={`${i}-${id}`} className="rounded border border-slate-200 p-2">
                  <h3 className="mb-1 font-semibold text-slate-700">{label(id)}</h3>
                  <p className="text-slate-600">Hubs: {s.hubs.length > 0 ? s.hubs.join(', ') : 'ninguno'}</p>
                  {s.cloudDependencies.length > 0 ? (
                    <ul className="mt-1 list-disc pl-4 text-red-800">
                      {s.cloudDependencies.map((d) => (
                        <li key={d.automationId}>«{d.name}» sin Internet no funciona ({d.entityIds.join(', ')})</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-emerald-700">Todas las automatizaciones funcionan sin Internet.</p>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Sección «Variantes»: guardar, cambiar y comparar alternativas del proyecto (B17). */
export function VariantsSection() {
  const variants = useProjectStore((s) => s.project.variants ?? EMPTY);
  const update = useProjectStore((s) => s.update);
  const notify = useUiStore((s) => s.notify);
  const [name, setName] = useState('');
  const [compare, setCompare] = useState<{ a: string; b: string } | null>(null);

  const save = () => {
    const v = name.trim() || `Variante ${variants.length + 1}`;
    update((p) => createVariant(p, v));
    setName('');
    notify(`Variante «${v}» guardada`, 'success');
  };

  return (
    <section aria-labelledby="variants-title" className="flex flex-col gap-2">
      <h3 id="variants-title" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Variantes
      </h3>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <TextField label="Nombre de la variante" value={name} placeholder="Todo Zigbee" onChange={(e) => setName(e.target.value)} fieldClassName="w-48" />
        <Button type="submit" size="sm" variant="primary">
          Guardar variante
        </Button>
      </form>
      {variants.length === 0 ? (
        <p className="text-xs text-slate-500">Guarda el diseño actual como variante para probar alternativas (p. ej. Zigbee frente a Wi-Fi) y compararlas.</p>
      ) : (
        <ul className="flex flex-col gap-1" aria-label="Variantes">
          {variants.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1.5">
              <span className="flex w-full items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium text-slate-800">{v.name}</span>
                <span className="shrink-0 text-xs text-slate-500">
                  {countLabel(v.snapshot.devices.length, 'dispositivo', 'dispositivos')} · {countLabel(v.snapshot.automations.length, 'automatización', 'automatizaciones')}
                </span>
              </span>
              <Button
                size="sm"
                aria-label={`Cambiar a variante ${v.name}`}
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: `¿Cambiar a «${v.name}»?`,
                    message: 'Los cambios no guardados en una variante se pueden recuperar con Deshacer.',
                    confirmLabel: 'Cambiar',
                  });
                  if (!ok) return;
                  try {
                    update((p) => applyVariant(p, v.id));
                    notify(`Ahora trabajas en «${v.name}»`, 'success');
                  } catch (err) {
                    notify(err instanceof Error ? err.message : String(err), 'error');
                  }
                }}
              >
                Cambiar a variante
              </Button>
              <Button size="sm" variant="ghost" aria-label={`Comparar ${v.name} con el proyecto actual`} onClick={() => setCompare({ a: CURRENT, b: v.id })}>
                Comparar
              </Button>
              <Button size="sm" variant="ghost" title="Sobrescribir con el estado actual" aria-label={`Actualizar ${v.name} con el estado actual`} onClick={() => update((p) => updateVariant(p, v.id))}>
                ⟳
              </Button>
              <Button size="sm" variant="danger" aria-label={`Borrar ${v.name}`} onClick={() => update((p) => deleteVariant(p, v.id))}>
                ✕
              </Button>
            </li>
          ))}
        </ul>
      )}
      {compare && <CompareDialog initialA={compare.a} initialB={compare.b} onClose={() => setCompare(null)} />}
    </section>
  );
}
