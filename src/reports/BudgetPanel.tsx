import { useId, useMemo, useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { catalog } from '../devices/catalog';
import { PROTOCOL_LABELS } from '../devices/labels';
import { billOfMaterials, bomToCsv, type BomGroup, type BomLine } from '../export/bom';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/Panel';
import { downloadText, safeFilename } from '../ui/download';
import { formatMoney, parseMoneyInput } from '../ui/money';
import { cx } from '../ui/cx';
import { countLabel } from '../ui/plural';
import { ProposalDataSection, QuoteBreakdown } from './QuoteSections';

function PriceInput({ line }: { line: BomLine }) {
  const shown = line.unitPrice.toFixed(2).replace('.', ',');
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? shown;
  const parsed = parseMoneyInput(value);

  const errorId = useId();
  const commit = () => {
    if (draft === null) return;
    // Un valor inválido no se descarta: se queda en el campo con el error visible.
    if (parsed === undefined) return;
    setDraft(null);
    if (Math.abs(parsed - line.unitPrice) < 0.005) return;
    useProjectStore.getState().setPrice(line.definitionId, Math.round(parsed * 100) / 100);
    useUiStore.getState().notify(`Precio de ${line.name}: ${formatMoney(parsed)}`, 'success', {
      action: { label: 'Deshacer', run: () => useProjectStore.getState().undo() },
    });
  };

  return (
    <span className="inline-flex flex-col items-end">
    <input
      type="text"
      inputMode="decimal"
      aria-label={`Precio unitario de ${line.name}`}
      aria-invalid={parsed === undefined}
      aria-describedby={parsed === undefined ? errorId : undefined}
      value={value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          setDraft(null);
        }
      }}
      className={cx(
        'w-24 rounded border px-1.5 py-0.5 text-right tabular-nums focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200',
        parsed === undefined ? 'border-red-400' : line.priceSource === 'project' ? 'border-sky-300 bg-sky-50' : 'border-slate-300',
      )}
    />
    {parsed === undefined && (
      <span id={errorId} role="alert" className="text-[11px] text-red-700">
        Precio no válido (p. ej. 1.299 o 12,50)
      </span>
    )}
    </span>
  );
}

function GroupTable({ title, groups }: { title: string; groups: BomGroup[] }) {
  return (
    <section aria-label={`Total por ${title.toLowerCase()}`}>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Por {title.toLowerCase()}</h3>
      <table className="w-full text-sm">
        <tbody className="tabular-nums">
          {groups.map((g) => (
            <tr key={g.key} className="border-t border-slate-100">
              <th scope="row" className="py-0.5 pr-2 text-left font-normal">
                {g.label}
              </th>
              <td className="py-0.5 pr-2 text-right text-slate-500">{g.quantity} ud.</td>
              <td className="py-0.5 text-right">{formatMoney(g.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Pestaña «Presupuesto»: lista de materiales con precio editable, totales e infraestructura necesaria. */
export function BudgetPanel() {
  const project = useProjectStore((s) => s.project);
  const report = useMemo(() => billOfMaterials(project, catalog), [project]);

  if (report.lines.length === 0)
    return (
      <div className="flex flex-col gap-4 p-3">
        <ProposalDataSection />
        <EmptyState>Añade dispositivos al plano para obtener el presupuesto.</EmptyState>
      </div>
    );

  const units = report.lines.reduce((s, l) => s + l.quantity, 0);

  return (
    <div className="flex flex-col gap-4 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-slate-700" role="status" aria-label="Total del presupuesto">
          <span className="text-xs uppercase tracking-wide text-slate-500">Materiales</span>{' '}
          <strong className="text-lg tabular-nums" data-testid="budget-total">
            {formatMoney(report.total)}
          </strong>{' '}
          <span className="text-xs text-slate-600">({countLabel(units, 'dispositivo', 'dispositivos')}, solo materiales, IVA incluido)</span>
        </p>
        <Button
          size="sm"
          className="ml-auto"
          onClick={() => downloadText(bomToCsv(report), `${safeFilename(project.name)}-presupuesto.csv`, 'text/csv')}
        >
          ⬇ Exportar CSV
        </Button>
      </div>
      <ProposalDataSection />
      <QuoteBreakdown />
      <h3 className="-mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Lista de materiales (precios editables)</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <caption className="sr-only">Lista de materiales</caption>
          <thead className="text-xs text-slate-500">
            <tr>
              <th scope="col" className="py-1 pr-2 font-medium">Dispositivo</th>
              <th scope="col" className="py-1 pr-2 font-medium">Protocolos</th>
              <th scope="col" className="py-1 pr-2 font-medium">Salas</th>
              <th scope="col" className="py-1 pr-2 text-right font-medium">Cant.</th>
              <th scope="col" className="py-1 pr-2 text-right font-medium">Precio ud.</th>
              <th scope="col" className="py-1 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {report.lines.map((l) => (
              <tr key={l.definitionId} className="border-t border-slate-100 align-middle">
                <td className="py-1 pr-2">
                  <span className="block font-medium text-slate-800">{l.name}</span>
                  <span className="block text-xs text-slate-500">
                    {l.brand} · {l.model}
                    {l.priceSource === 'none' && <span className="ml-1 text-amber-700">· sin precio</span>}
                  </span>
                </td>
                <td className="py-1 pr-2 text-xs">{l.protocols.map((p) => PROTOCOL_LABELS[p]).join(', ')}</td>
                <td className="py-1 pr-2 text-xs">{l.rooms.join(', ')}</td>
                <td className="py-1 pr-2 text-right">{l.quantity}</td>
                <td className="py-1 pr-2 text-right">
                  <span className="inline-flex items-center gap-1">
                    <PriceInput key={`${l.definitionId}:${l.unitPrice}`} line={l} />
                    {l.priceSource === 'project' && (
                      <button
                        type="button"
                        className="text-xs text-slate-500 hover:text-sky-700"
                        title="Volver al precio del catálogo"
                        aria-label={`Volver al precio del catálogo de ${l.name}`}
                        onClick={() => useProjectStore.getState().setPrice(l.definitionId, undefined)}
                      >
                        ↺
                      </button>
                    )}
                  </span>
                </td>
                <td className="py-1 text-right">{formatMoney(l.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-300 font-semibold">
              <th scope="row" colSpan={3} className="py-1 pr-2 text-left">
                Total
              </th>
              <td className="py-1 pr-2 text-right">{units}</td>
              <td />
              <td className="py-1 text-right">{formatMoney(report.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {report.requiredInfrastructure.length > 0 && (
        <section className="rounded-md border border-amber-200 bg-amber-50 p-2" aria-label="Infraestructura necesaria">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-900">Infraestructura necesaria (no incluida)</h3>
          <ul className="mt-1 flex flex-col gap-0.5 text-sm text-amber-950">
            {report.requiredInfrastructure.map((i) => (
              <li key={i.definitionId}>
                <strong>{i.name}</strong> — {i.reason}
                {i.unitPrice > 0 && <span className="tabular-nums"> ({formatMoney(i.unitPrice)})</span>}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-sm font-semibold text-amber-950">Total con la infraestructura: {formatMoney(report.totalWithInfrastructure)}</p>
        </section>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <GroupTable title="Sala" groups={report.byRoom} />
        <GroupTable title="Protocolo" groups={report.byProtocol} />
        <GroupTable title="Categoría" groups={report.byCategory} />
      </div>
      <p className="text-xs text-slate-500">Precios orientativos (PVP en España). Los precios editados se guardan en el proyecto.</p>
    </div>
  );
}
