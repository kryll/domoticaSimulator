// Presupuesto por partidas (Tanda 2): materiales, infraestructura, mano de obra, margen,
// descuento e IVA. El margen, salvo que se pida mostrarlo (quote.showMargin), va repartido en
// los precios unitarios. La mano de obra se factura por cuartos de hora: horas × tarifa = importe. Todos los importes se calculan en céntimos enteros para no arrastrar
// errores de redondeo; los campos en euros salen de dividir esos céntimos entre 100.
import type { DeviceCategory, DeviceDefinition, Id, Integration, Project, QuoteSettings } from '../types';
import { billOfMaterials } from '../export/bom';
import { CATEGORY_LABELS, INTEGRATION_LABELS } from '../devices/labels';
import { isInfra } from '../devices/roles';
import { countLabel } from '../ui/plural';

export const QUOTE_DEFAULTS = {
  laborRateEurH: 45,
  vatPct: 21,
  marginPct: 0,
  discountPct: 0,
  validityDays: 30,
} as const;

/** Minutos de instalación estimados por dispositivo según su categoría. */
export const INSTALL_MINUTES: Record<DeviceCategory, number> = {
  light: 15,
  plug: 5,
  switch: 45,
  sensor: 15,
  climate: 45,
  cover: 60,
  lock: 90,
  camera: 60,
  speaker: 15,
  display: 30,
  vacuum: 20,
  hub: 20,
  network: 45,
  server: 60,
};

/** Minutos de configuración en Home Assistant. */
export const CONFIG_MINUTES = {
  /** Puesta en marcha del servidor (asistente, copias, usuarios). */
  server: 60,
  /** Alta de cada integración distinta. */
  perIntegration: 15,
  perAutomation: 20,
  perScene: 10,
  perScript: 15,
  /** Pruebas finales y entrega al cliente. */
  handover: 30,
} as const;

export interface QuoteLine {
  key: string;
  description: string;
  detail?: string;
  quantity: number;
  /** «ud» para materiales, «h» para mano de obra. */
  unit: 'ud' | 'h';
  unitPrice: number;
  total: number;
  unitPriceCents: number;
  totalCents: number;
  definitionId?: Id;
  /** Infraestructura que falta en el plano pero que el diseño necesita. */
  missing?: boolean;
  /** Sin precio en el catálogo ni en el proyecto. */
  unpriced?: boolean;
}

export interface QuoteTotalsCents {
  subtotalMaterials: number;
  subtotalLabor: number;
  margin: number;
  discount: number;
  taxableBase: number;
  vat: number;
  total: number;
}

export interface Quote {
  materialLines: QuoteLine[];
  infrastructureLines: QuoteLine[];
  laborLines: QuoteLine[];
  /** Materiales + infraestructura. */
  subtotalMaterials: number;
  subtotalLabor: number;
  margin: number;
  discount: number;
  taxableBase: number;
  vat: number;
  total: number;
  currency: 'EUR';
  cents: QuoteTotalsCents;
  laborHours: number;
  /** Tarifa por hora aplicada (con el margen incluido si no se muestra aparte). */
  laborRateEurH: number;
  /** El margen sale como línea propia; si no, va repartido en los precios y `margin` es 0. */
  showMargin: boolean;
  marginPct: number;
  discountPct: number;
  vatPct: number;
  validityDays: number;
  /** Descripciones de los materiales sin precio. */
  unpriced: string[];
}

const lowerFirst = (s: string): string => (s[0]?.toLowerCase() ?? '') + s.slice(1);
const toCents = (eur: number): number => Math.round(eur * 100);
const toEur = (cents: number): number => cents / 100;
const pct = (cents: number, percent: number): number => Math.round((cents * percent) / 100);
const clamp = (n: number | undefined, min: number, max: number, fallback: number): number =>
  n === undefined || !Number.isFinite(n) ? fallback : Math.min(max, Math.max(min, n));

function line(key: string, description: string, quantity: number, unit: 'ud' | 'h', unitPriceCents: number, totalCents: number, extra: Partial<QuoteLine> = {}): QuoteLine {
  return {
    key,
    description,
    quantity,
    unit,
    unitPriceCents,
    totalCents,
    unitPrice: toEur(unitPriceCents),
    total: toEur(totalCents),
    ...extra,
  };
}

/** Ajustes del presupuesto con valores por defecto y rangos válidos. */
export function quoteSettings(project: Pick<Project, 'settings'>): Required<Pick<QuoteSettings, 'laborRateEurH' | 'vatPct' | 'marginPct' | 'discountPct' | 'validityDays'>> & QuoteSettings {
  const q = project.settings?.quote ?? {};
  return {
    ...q,
    laborRateEurH: clamp(q.laborRateEurH, 0, 1000, QUOTE_DEFAULTS.laborRateEurH),
    vatPct: clamp(q.vatPct, 0, 100, QUOTE_DEFAULTS.vatPct),
    marginPct: clamp(q.marginPct, 0, 100, QUOTE_DEFAULTS.marginPct),
    discountPct: clamp(q.discountPct, 0, 100, QUOTE_DEFAULTS.discountPct),
    validityDays: clamp(q.validityDays, 1, 365, QUOTE_DEFAULTS.validityDays),
  };
}

/** Horas facturables: los minutos se redondean al cuarto de hora más cercano (0,25 h). */
export function billableHours(minutes: number): number {
  return Math.round((minutes / 60) * 4) / 4;
}

/** Línea de mano de obra: el importe es exactamente horas (redondeadas a 0,25 h) × tarifa. */
function laborLine(key: string, description: string, minutes: number, rateCents: number, detail?: string): QuoteLine {
  const hours = billableHours(minutes);
  return line(key, description, hours, 'h', rateCents, Math.round(hours * rateCents), detail ? { detail } : {});
}

/** Precio unitario con el margen repartido (en céntimos enteros). */
const withMargin = (cents: number, marginPct: number): number => Math.round((cents * (100 + marginPct)) / 100);

/** Presupuesto por partidas del proyecto. */
export function buildQuote(project: Project, defs: DeviceDefinition[]): Quote {
  const settings = quoteSettings(project);
  // Por defecto el margen no se enseña al cliente: se reparte en los precios de cada línea.
  const showMargin = settings.showMargin === true;
  const lineMargin = showMargin ? 0 : settings.marginPct;
  const bom = billOfMaterials(project, defs);
  const defOf = (id: Id): DeviceDefinition | undefined => defs.find((d) => d.id === id);

  const materialLines: QuoteLine[] = [];
  const infrastructureLines: QuoteLine[] = [];
  for (const l of bom.lines) {
    const def = defOf(l.definitionId);
    const unitCents = withMargin(toCents(l.unitPrice), lineMargin);
    const extra: Partial<QuoteLine> = { definitionId: l.definitionId, detail: `${l.brand} ${l.model}`.trim() };
    if (l.priceSource === 'none') extra.unpriced = true;
    if (l.rooms.length > 0) extra.detail = `${extra.detail ?? ''} · ${l.rooms.join(', ')}`;
    const ql = line(`material:${l.definitionId}`, l.name, l.quantity, 'ud', unitCents, unitCents * l.quantity, extra);
    (def && isInfra(def) ? infrastructureLines : materialLines).push(ql);
  }
  for (const x of bom.requiredInfrastructure) {
    const unitCents = withMargin(toCents(x.unitPrice), lineMargin);
    infrastructureLines.push(line(`missing:${x.definitionId}`, x.name, 1, 'ud', unitCents, unitCents, { definitionId: x.definitionId, detail: `Necesario: ${x.reason}`, missing: true }));
  }

  // Mano de obra: instalación por categoría y configuración en Home Assistant.
  const rateCents = withMargin(toCents(settings.laborRateEurH), lineMargin);
  const laborLines: QuoteLine[] = [];
  const byCategory = new Map<DeviceCategory, number>();
  const integrations = new Set<Integration>();
  for (const device of project.devices) {
    const def = defOf(device.definitionId);
    if (!def) continue;
    byCategory.set(def.category, (byCategory.get(def.category) ?? 0) + 1);
    if (device.integration !== 'homeassistant') integrations.add(device.integration);
  }
  for (const [category, count] of byCategory) {
    const each = settings.perDeviceInstallMinutes !== undefined ? clamp(settings.perDeviceInstallMinutes, 0, 600, 0) : INSTALL_MINUTES[category];
    if (each === 0) continue;
    laborLines.push(laborLine(`install:${category}`, `Instalación: ${lowerFirst(CATEGORY_LABELS[category])}`, count * each, rateCents, `${countLabel(count, 'dispositivo', 'dispositivos')} × ${each} min`));
  }
  const hasServer = project.devices.some((d) => defOf(d.definitionId)?.role === 'ha_server');
  if (hasServer || integrations.size > 0) {
    const minutes = (hasServer ? CONFIG_MINUTES.server : 0) + integrations.size * CONFIG_MINUTES.perIntegration;
    const names = [...integrations].map((i) => INTEGRATION_LABELS[i]).join(', ');
    laborLines.push(laborLine('config:server', 'Puesta en marcha de Home Assistant e integraciones', minutes, rateCents, names ? `${countLabel(integrations.size, 'integración', 'integraciones')}: ${names}` : undefined));
  }
  const configs: [string, string, number, number, string, string][] = [
    ['config:automations', 'Configuración de automatizaciones', project.automations.length, CONFIG_MINUTES.perAutomation, 'automatización', 'automatizaciones'],
    ['config:scenes', 'Configuración de escenas', project.scenes.length, CONFIG_MINUTES.perScene, 'escena', 'escenas'],
    ['config:scripts', 'Configuración de scripts', project.scripts.length, CONFIG_MINUTES.perScript, 'script', 'scripts'],
  ];
  for (const [key, description, count, each, singular, pluralForm] of configs) {
    if (count > 0) laborLines.push(laborLine(key, description, count * each, rateCents, `${countLabel(count, singular, pluralForm)} × ${each} min`));
  }
  if (project.devices.length > 0) laborLines.push(laborLine('config:handover', 'Pruebas y entrega al cliente', CONFIG_MINUTES.handover, rateCents));
  const extraHours = clamp(settings.laborHours, 0, 1000, 0);
  if (extraHours > 0) laborLines.push(laborLine('labor:extra', 'Horas adicionales', extraHours * 60, rateCents));

  const sum = (lines: QuoteLine[]): number => lines.reduce((s, l) => s + l.totalCents, 0);
  const subtotalMaterials = sum(materialLines) + sum(infrastructureLines);
  const subtotalLabor = sum(laborLines);
  const margin = showMargin ? pct(subtotalMaterials + subtotalLabor, settings.marginPct) : 0;
  const discount = pct(subtotalMaterials + subtotalLabor + margin, settings.discountPct);
  const taxableBase = subtotalMaterials + subtotalLabor + margin - discount;
  const vat = pct(taxableBase, settings.vatPct);
  const total = taxableBase + vat;
  const cents: QuoteTotalsCents = { subtotalMaterials, subtotalLabor, margin, discount, taxableBase, vat, total };

  return {
    materialLines,
    infrastructureLines,
    laborLines,
    subtotalMaterials: toEur(subtotalMaterials),
    subtotalLabor: toEur(subtotalLabor),
    margin: toEur(margin),
    discount: toEur(discount),
    taxableBase: toEur(taxableBase),
    vat: toEur(vat),
    total: toEur(total),
    currency: 'EUR',
    cents,
    laborHours: laborLines.reduce((s, l) => s + l.quantity, 0),
    laborRateEurH: toEur(rateCents),
    showMargin,
    marginPct: settings.marginPct,
    discountPct: settings.discountPct,
    vatPct: settings.vatPct,
    validityDays: settings.validityDays,
    unpriced: [...materialLines, ...infrastructureLines].filter((l) => l.unpriced).map((l) => l.description),
  };
}
