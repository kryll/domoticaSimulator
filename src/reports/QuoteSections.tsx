import { useEffect, useId, useMemo, useState } from 'react';
import { knownDefinitions } from '../canvas/analysis';
import type { QuoteSettings } from '../types';
import { useProjectStore } from '../store/projectStore';
import { useViewStore } from '../store/viewStore';
import { QUOTE_DEFAULTS, buildQuote, type QuoteLine } from '../report/quote';
import { formatDecimal, formatMoney, parseMoneyInput } from '../ui/money';
import { inputClass } from '../ui/Field';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';

type TextKey = 'clientName' | 'clientAddress' | 'installerName' | 'notes';
type NumberKey = 'laborRateEurH' | 'laborHours' | 'perDeviceInstallMinutes' | 'marginPct' | 'discountPct' | 'vatPct' | 'validityDays';

const NUMBER_FIELDS: Array<{ key: NumberKey; label: string; placeholder: string; max: number; min?: number }> = [
  { key: 'laborRateEurH', label: 'Precio de la hora (€/h)', placeholder: String(QUOTE_DEFAULTS.laborRateEurH), max: 1000 },
  { key: 'laborHours', label: 'Horas adicionales', placeholder: '0', max: 1000 },
  { key: 'perDeviceInstallMinutes', label: 'Minutos por dispositivo', placeholder: 'según el tipo', max: 600 },
  { key: 'marginPct', label: 'Margen (%)', placeholder: String(QUOTE_DEFAULTS.marginPct), max: 100 },
  { key: 'discountPct', label: 'Descuento (%)', placeholder: String(QUOTE_DEFAULTS.discountPct), max: 100 },
  { key: 'vatPct', label: 'IVA (%)', placeholder: String(QUOTE_DEFAULTS.vatPct), max: 100 },
  { key: 'validityDays', label: 'Validez (días)', placeholder: String(QUOTE_DEFAULTS.validityDays), max: 365, min: 1 },
];

/** Guarda un cambio de settings.quote (con deshacer). */
function setQuote(patch: Partial<QuoteSettings>) {
  const store = useProjectStore.getState();
  const current = store.project.settings?.quote ?? {};
  const next: QuoteSettings = { ...current, ...patch };
  for (const k of Object.keys(next) as Array<keyof QuoteSettings>) {
    if (next[k] === undefined || next[k] === '') delete next[k];
  }
  store.updateSettings({ quote: next });
}

function QuoteTextField({ name, label, multiline = false }: { name: TextKey; label: string; multiline?: boolean }) {
  const value = useProjectStore((s) => s.project.settings?.quote?.[name] ?? '');
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const id = useId();
  const commit = () => {
    const v = draft.trim();
    if (v !== value) setQuote({ [name]: v === '' ? undefined : v });
  };
  return (
    <div className={cx('flex flex-col gap-1', multiline && 'sm:col-span-2 lg:col-span-3')}>
      <label htmlFor={id} className="text-xs font-medium text-slate-600">
        {label}
      </label>
      {multiline ? (
        <textarea id={id} rows={2} className={inputClass} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
      ) : (
        <input
          id={id}
          className={inputClass}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
      )}
    </div>
  );
}

function QuoteNumberField({ name, label, placeholder, max, min = 0 }: { name: NumberKey; label: string; placeholder: string; max: number; min?: number }) {
  const value = useProjectStore((s) => s.project.settings?.quote?.[name]);
  const shown = value === undefined ? '' : formatDecimal(value, 2);
  const [draft, setDraft] = useState<string | null>(null);
  const id = useId();
  const errorId = useId();
  const text = draft ?? shown;
  const parsed = text.trim() === '' ? undefined : parseMoneyInput(text);
  const invalid = text.trim() !== '' && (parsed === undefined || parsed < min || parsed > max);
  const commit = () => {
    if (draft === null || invalid) return;
    setDraft(null);
    if (parsed !== value) setQuote({ [name]: parsed });
  };
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-slate-600">
        {label}
      </label>
      <input
        id={id}
        inputMode="decimal"
        className={cx(inputClass, 'text-right tabular-nums', invalid && 'border-red-500')}
        value={text}
        placeholder={placeholder}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') setDraft(null);
        }}
      />
      {invalid && (
        <span id={errorId} role="alert" className="text-[11px] text-red-700">
          Entre {min} y {max}
        </span>
      )}
    </div>
  );
}

/** Sección «Datos de la propuesta»: edita settings.quote. */
export function ProposalDataSection() {
  const hidePrices = useProjectStore((s) => s.project.settings?.quote?.hidePrices === true);
  const showMargin = useProjectStore((s) => s.project.settings?.quote?.showMargin === true);
  return (
    <section aria-labelledby="proposal-data-title" className="rounded-md border border-slate-200 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 id="proposal-data-title" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Datos de la propuesta
        </h3>
        <Button size="sm" variant="primary" className="ml-auto" onClick={() => useViewStore.getState().setProposalOpen(true)}>
          Propuesta (PDF)…
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <QuoteTextField name="clientName" label="Cliente" />
        <QuoteTextField name="clientAddress" label="Dirección del cliente" />
        <QuoteTextField name="installerName" label="Instalador" />
        {NUMBER_FIELDS.map((f) => (
          <QuoteNumberField key={f.key} name={f.key} label={f.label} placeholder={f.placeholder} max={f.max} min={f.min} />
        ))}
        <QuoteTextField name="notes" label="Notas para el cliente" multiline />
      </div>
      <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={hidePrices}
          onChange={(e) => setQuote({ hidePrices: e.target.checked ? true : undefined })}
          className="h-4 w-4 rounded border-slate-400 text-sky-700 focus:ring-sky-600"
        />
        Ocultar los precios en la propuesta y en el modo presentación
      </label>
      <label className="mt-1 flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={showMargin}
          onChange={(e) => setQuote({ showMargin: e.target.checked ? true : undefined })}
          className="h-4 w-4 rounded border-slate-400 text-sky-700 focus:ring-sky-600"
        />
        Mostrar el margen al cliente como línea aparte (si no, va repartido en los precios)
      </label>
    </section>
  );
}

function LinesGroup({ title, lines }: { title: string; lines: QuoteLine[] }) {
  if (lines.length === 0) return null;
  return (
    <>
      <tr>
        <th scope="rowgroup" colSpan={4} className="pb-0.5 pt-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
          {title}
        </th>
      </tr>
      {lines.map((l) => (
        <tr key={l.key} className="border-t border-slate-100 align-top">
          <td className="py-1 pr-2">
            <span className="block text-slate-800">
              {l.description}
              {l.missing && <span className="ml-1 rounded bg-amber-100 px-1 text-[11px] font-semibold text-amber-900">falta en el plano</span>}
            </span>
            {l.detail && <span className="block text-xs text-slate-600">{l.detail}</span>}
          </td>
          <td className="py-1 pr-2 text-right">
            {formatDecimal(l.quantity, 2)} {l.unit}
          </td>
          <td className="py-1 pr-2 text-right">{l.unpriced ? <span className="text-amber-800">sin precio</span> : formatMoney(l.unitPrice)}</td>
          <td className="py-1 text-right">{formatMoney(l.total)}</td>
        </tr>
      ))}
    </>
  );
}

/** Partidas de buildQuote: materiales, infraestructura, mano de obra, margen, descuento, IVA y total. */
export function QuoteBreakdown() {
  const project = useProjectStore((s) => s.project);
  const quote = useMemo(() => buildQuote(project, knownDefinitions()), [project]);
  const totals: Array<[string, number, boolean?]> = [
    ['Subtotal materiales e infraestructura', quote.subtotalMaterials],
    ['Subtotal mano de obra', quote.subtotalLabor],
    ...(quote.showMargin && quote.marginPct > 0 ? ([[`Margen (${formatDecimal(quote.marginPct)} %)`, quote.margin]] as Array<[string, number]>) : []),
    ...(quote.discountPct > 0 ? ([[`Descuento (${formatDecimal(quote.discountPct)} %)`, -quote.discount]] as Array<[string, number]>) : []),
    ['Base imponible', quote.taxableBase],
    [`IVA (${formatDecimal(quote.vatPct)} %)`, quote.vat],
    ['Total', quote.total, true],
  ];
  return (
    <section aria-labelledby="quote-title" className="rounded-md border border-slate-200 p-3">
      <h3 id="quote-title" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
        Presupuesto por partidas
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm tabular-nums">
          <caption className="sr-only">Partidas del presupuesto</caption>
          <thead className="text-xs text-slate-600">
            <tr>
              <th scope="col" className="py-1 pr-2 text-left font-medium">Concepto</th>
              <th scope="col" className="py-1 pr-2 text-right font-medium">Cantidad</th>
              <th scope="col" className="py-1 pr-2 text-right font-medium">Precio</th>
              <th scope="col" className="py-1 text-right font-medium">Importe</th>
            </tr>
          </thead>
          <tbody>
            <LinesGroup title="Materiales" lines={quote.materialLines} />
            <LinesGroup title="Infraestructura" lines={quote.infrastructureLines} />
            <LinesGroup title={`Mano de obra (${formatDecimal(quote.laborRateEurH)} €/h)`} lines={quote.laborLines} />
          </tbody>
          <tfoot>
            {totals.map(([label, value, strong]) => (
              <tr key={label} className={cx('border-t', strong ? 'border-slate-400 text-base font-bold' : 'border-slate-200')}>
                <th scope="row" colSpan={3} className="py-1 pr-2 text-right font-medium">
                  {label}
                </th>
                <td className="py-1 text-right" data-testid={strong ? 'quote-total' : undefined}>
                  {formatMoney(value)}
                </td>
              </tr>
            ))}
          </tfoot>
        </table>
      </div>
      {quote.unpriced.length > 0 && (
        <p className="mt-1 text-xs text-amber-800">Sin precio: {quote.unpriced.join(', ')}. Edítalo en la lista de materiales.</p>
      )}
      <p className="mt-1 text-xs text-slate-600">
        Validez de la oferta: {quote.validityDays} días · {formatDecimal(quote.laborHours, 2)} h de mano de obra estimadas.
      </p>
    </section>
  );
}
