// Propuesta para el cliente (Tanda 2): HTML autocontenido e imprimible (A4) con portada,
// resumen, plano, dispositivos por sala, presupuesto por partidas, impacto de fallos,
// automatizaciones en lenguaje natural y guía de emparejamiento. La interfaz lo abre y lo
// imprime con window.print (sin librerías de PDF). Todo el texto del usuario se escapa.
import type { Device, DeviceDefinition, Integration, Project } from '../types';
import { entitiesForDevice } from '../devices/entities';
import { INTEGRATION_LABELS, PROTOCOL_LABELS, ROLE_LABELS } from '../devices/labels';
import { isInfra } from '../devices/roles';
import { deviceTechSummary } from '../devices/techSummary';
import { modelLabel, PAIRING_STEPS, ROLE_STEPS } from '../export/packages';
import { scenarioImpact, findScenario, type FailureScenarioId } from '../simulation/scenarios';
import { formatMoney } from '../ui/money';
import { countLabel, plural } from '../ui/plural';
import { describeAutomation } from './describe';
import { escapeHtml as esc, sanitizeSvg } from './html';
import { pricesHidden } from './presentation';
import { buildQuote, quoteSettings, type Quote, type QuoteLine } from './quote';

export { buildQuote, quoteSettings, QUOTE_DEFAULTS, INSTALL_MINUTES, CONFIG_MINUTES, type Quote, type QuoteLine, type QuoteTotalsCents } from './quote';
export { describeAutomation, durationText, joinList } from './describe';
export { presentationSnapshot, pricesHidden } from './presentation';
export { escapeHtml, sanitizeSvg } from './html';

export interface ProposalOptions {
  /** SVG del plano (lo genera la interfaz); se limpia antes de incrustarlo. */
  planSvg?: string;
  /** Fecha de generación (ms o Date). */
  generatedAt: number | Date;
}

interface Placed {
  device: Device;
  def: DeviceDefinition;
}

const money = (eur: number): string => esc(formatMoney(eur));

function dateText(d: Date): string {
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' }).format(d);
}

const STYLE = `
@page { size: A4; margin: 16mm 14mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #ffffff; color: #1e293b; }
body { font: 10.5pt/1.45 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
main { max-width: 182mm; margin: 0 auto; padding: 8mm 0; }
h1 { font-size: 24pt; margin: 0 0 4mm; color: #0f172a; }
h2 { font-size: 15pt; margin: 0 0 4mm; padding-bottom: 2mm; border-bottom: 2px solid #0ea5e9; color: #0f172a; }
h3 { font-size: 11.5pt; margin: 5mm 0 2mm; color: #0f172a; }
p { margin: 0 0 2.5mm; }
section { margin-bottom: 8mm; }
.page { break-before: page; page-break-before: always; }
.cover { min-height: 240mm; display: flex; flex-direction: column; justify-content: center; }
.cover .kicker { text-transform: uppercase; letter-spacing: .12em; color: #0369a1; font-weight: 600; font-size: 10pt; }
.cover dl { display: grid; grid-template-columns: 38mm 1fr; gap: 2mm 4mm; margin-top: 10mm; }
.cover dt { color: #64748b; }
.cover dd { margin: 0; font-weight: 600; }
.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; margin: 3mm 0 5mm; }
.stat { border: 1px solid #cbd5e1; border-radius: 2mm; padding: 3mm; }
.stat b { display: block; font-size: 16pt; color: #0f172a; }
.stat span { color: #475569; font-size: 9pt; }
table { width: 100%; border-collapse: collapse; margin: 2mm 0 4mm; font-size: 9.5pt; }
th, td { text-align: left; padding: 1.6mm 2mm; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
th { background: #f1f5f9; color: #334155; font-weight: 600; }
td.num, th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
tr { break-inside: avoid; page-break-inside: avoid; }
tfoot td { font-weight: 600; border-top: 1.5px solid #94a3b8; }
tr.total td { font-size: 11.5pt; background: #e0f2fe; }
.muted { color: #64748b; }
.small { font-size: 8.5pt; }
.badge { display: inline-block; padding: 0 1.6mm; border-radius: 1.2mm; font-size: 8pt; font-weight: 600; }
.badge.ok { background: #dcfce7; color: #166534; }
.badge.degraded { background: #fef3c7; color: #92400e; }
.badge.broken { background: #fee2e2; color: #991b1b; }
.badge.cloud { background: #ede9fe; color: #5b21b6; }
.badge.local { background: #dcfce7; color: #166534; }
.plan { border: 1px solid #cbd5e1; border-radius: 2mm; padding: 2mm; text-align: center; }
.plan svg { max-width: 100%; height: auto; max-height: 230mm; }
ol, ul { margin: 0 0 3mm; padding-left: 6mm; }
li { margin-bottom: 1mm; }
.automation { break-inside: avoid; page-break-inside: avoid; margin-bottom: 3mm; }
.automation b { display: block; }
.notes { white-space: pre-wrap; border-left: 3px solid #0ea5e9; padding: 2mm 4mm; background: #f8fafc; }
footer { margin-top: 10mm; color: #64748b; font-size: 8.5pt; }
@media screen { body { background: #e2e8f0; } main { background: #ffffff; padding: 14mm; margin: 8mm auto; box-shadow: 0 1px 4px rgba(15,23,42,.15); } }
`;

function placedDevices(project: Project, defs: DeviceDefinition[]): Placed[] {
  const out: Placed[] = [];
  for (const device of project.devices) {
    const def = defs.find((d) => d.id === device.definitionId);
    if (def) out.push({ device, def });
  }
  return out;
}

// ---------- Secciones ----------

function coverSection(project: Project, generatedAt: Date, quote: Quote): string {
  const q = project.settings?.quote ?? {};
  const validUntil = new Date(generatedAt.getTime() + quote.validityDays * 86_400_000);
  const rows: [string, string | undefined][] = [
    ['Cliente', q.clientName],
    ['Dirección', q.clientAddress],
    ['Instalador', q.installerName],
    ['Fecha', dateText(generatedAt)],
    ['Validez', `${countLabel(quote.validityDays, 'día', 'días')} (hasta el ${dateText(validUntil)})`],
  ];
  return `<section class="cover">
  <div class="kicker">Propuesta de instalación domótica</div>
  <h1>${esc(project.name)}</h1>
  <p class="muted">Diseño basado en Home Assistant, simulado y validado antes de la instalación.</p>
  <dl>${rows.filter(([, v]) => v !== undefined && v.trim() !== '').map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
</section>`;
}

function summarySection(project: Project, placed: Placed[], quote: Quote, hide: boolean): string {
  const endpoints = placed.filter((p) => !isInfra(p.def));
  const cloud = placed.filter((p) => deviceTechSummary(p.device, p.def, project).cloud);
  const protocols = [...new Set(placed.map((p) => p.device.protocol))].map((p) => PROTOCOL_LABELS[p]);
  const stats: [string, string][] = [
    [String(endpoints.length), plural(endpoints.length, 'dispositivo', 'dispositivos')],
    [String(placed.length - endpoints.length), plural(placed.length - endpoints.length, 'equipo de red y control', 'equipos de red y control')],
    [String(project.rooms.length), plural(project.rooms.length, 'sala', 'salas')],
    [String(project.automations.length), plural(project.automations.length, 'automatización', 'automatizaciones')],
    [String(project.scenes.length + project.scripts.length), 'escenas y scripts'],
    hide ? [String(cloud.length), 'dependen de la nube'] : [esc(formatMoney(quote.total)), 'total con IVA'],
  ];
  const cloudText =
    cloud.length === 0
      ? 'Todo funciona en local: la casa sigue respondiendo aunque se caiga Internet.'
      : `${countLabel(cloud.length, 'equipo depende', 'equipos dependen')} de la nube (${esc(cloud.map((p) => p.device.name).join(', '))}); el resto funciona en local.`;
  return `<section class="page">
  <h2>Resumen</h2>
  <div class="stats">${stats.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${esc(l)}</span></div>`).join('')}</div>
  <p>Protocolos: ${esc(protocols.join(', ') || '—')}. ${project.floors.length > 1 ? `${esc(countLabel(project.floors.length, 'planta', 'plantas'))}.` : ''}</p>
  <p>${cloudText}</p>
</section>`;
}

function planSection(planSvg: string | undefined): string {
  const svg = planSvg ? sanitizeSvg(planSvg) : '';
  if (!svg) return '';
  return `<section class="page">
  <h2>Plano</h2>
  <div class="plan">${svg}</div>
</section>`;
}

function devicesSection(project: Project, placed: Placed[]): string {
  const floors = [...project.floors].sort((a, b) => a.level - b.level);
  const parts: string[] = [];
  for (const floor of floors) {
    const onFloor = placed.filter((p) => p.device.floorId === floor.id);
    if (onFloor.length === 0) continue;
    if (floors.length > 1) parts.push(`<h3>${esc(floor.name)}</h3>`);
    const rooms = [...project.rooms.filter((r) => r.floorId === floor.id).map((r) => ({ id: r.id as string | undefined, name: r.name })), { id: undefined, name: 'Sin sala' }];
    for (const room of rooms) {
      const items = onFloor.filter((p) => (room.id === undefined ? !project.rooms.some((r) => r.id === p.device.roomId) : p.device.roomId === room.id));
      if (items.length === 0) continue;
      parts.push(`<table>
  <thead><tr><th colspan="4">${esc(room.name)} <span class="muted small">· ${esc(countLabel(items.length, 'equipo', 'equipos'))}</span></th></tr>
  <tr><th>Nombre</th><th>Modelo</th><th>Integración</th><th>Conectividad</th></tr></thead>
  <tbody>${items
    .map((p) => {
      const t = deviceTechSummary(p.device, p.def, project);
      return `<tr><td>${esc(p.device.name)}${isInfra(p.def) ? ` <span class="muted small">(${esc(ROLE_LABELS[p.def.role].toLowerCase())})</span>` : ''}</td><td>${esc(modelLabel(p.def))}</td><td>${esc(t.integration)} · ${esc(t.protocol)}</td><td><span class="badge ${t.cloud ? 'cloud' : 'local'}">${esc(t.locality)}</span>${p.device.ups ? ' <span class="small muted">con SAI</span>' : ''}</td></tr>`;
    })
    .join('')}</tbody>
</table>`);
    }
  }
  return `<section class="page">
  <h2>Dispositivos por sala</h2>
  ${parts.join('\n') || '<p class="muted">El proyecto no tiene dispositivos.</p>'}
</section>`;
}

function quoteRows(lines: QuoteLine[], hide: boolean): string {
  return lines
    .map((l) => {
      const qty = l.unit === 'h' ? `${String(l.quantity).replace('.', ',')} h` : `${l.quantity}`;
      const desc = `${esc(l.description)}${l.missing ? ' <span class="badge degraded">no está en el plano</span>' : ''}${l.unpriced ? ' <span class="badge degraded">sin precio</span>' : ''}${l.detail ? `<div class="muted small">${esc(l.detail)}</div>` : ''}`;
      return hide ? `<tr><td>${desc}</td><td class="num">${qty}</td></tr>` : `<tr><td>${desc}</td><td class="num">${qty}</td><td class="num">${money(l.unitPrice)}</td><td class="num">${money(l.total)}</td></tr>`;
    })
    .join('');
}

function quoteTable(title: string, lines: QuoteLine[], hide: boolean, subtotal?: number): string {
  if (lines.length === 0) return '';
  const head = hide ? '<tr><th>Concepto</th><th class="num">Cantidad</th></tr>' : '<tr><th>Concepto</th><th class="num">Cantidad</th><th class="num">Precio</th><th class="num">Importe</th></tr>';
  const foot = !hide && subtotal !== undefined ? `<tfoot><tr><td colspan="3">Subtotal</td><td class="num">${money(subtotal)}</td></tr></tfoot>` : '';
  return `<h3>${esc(title)}</h3><table><thead>${head}</thead><tbody>${quoteRows(lines, hide)}</tbody>${foot}</table>`;
}

function quoteSection(quote: Quote, hide: boolean, notes: string | undefined): string {
  const sum = (lines: QuoteLine[]): number => lines.reduce((s, l) => s + l.totalCents, 0) / 100;
  const totals: [string, number, string?][] = [
    ['Materiales e infraestructura', quote.subtotalMaterials],
    ['Mano de obra', quote.subtotalLabor],
  ];
  if (quote.margin > 0) totals.push([`Margen (${String(quote.marginPct).replace('.', ',')} %)`, quote.margin]);
  if (quote.discount > 0) totals.push([`Descuento (${String(quote.discountPct).replace('.', ',')} %)`, -quote.discount]);
  totals.push(['Base imponible', quote.taxableBase], [`IVA (${String(quote.vatPct).replace('.', ',')} %)`, quote.vat], ['Total', quote.total, 'total']);
  const summary = hide
    ? ''
    : `<h3>Totales</h3><table><tbody>${totals.map(([k, v, cls]) => `<tr${cls ? ` class="${cls}"` : ''}><td>${esc(k)}</td><td class="num">${money(v)}</td></tr>`).join('')}</tbody></table>
  <p class="small muted">Mano de obra a ${money(quote.laborRateEurH)}/h (${esc(String(quote.laborHours).replace('.', ','))} h estimadas). Oferta válida durante ${esc(countLabel(quote.validityDays, 'día', 'días'))}.${quote.unpriced.length > 0 ? ` Sin precio: ${esc(quote.unpriced.join(', '))}.` : ''}</p>`;
  return `<section class="page">
  <h2>Presupuesto</h2>
  ${quoteTable('Dispositivos', quote.materialLines, hide, sum(quote.materialLines))}
  ${quoteTable('Infraestructura de red y control', quote.infrastructureLines, hide, sum(quote.infrastructureLines))}
  ${quoteTable('Mano de obra', quote.laborLines, hide, sum(quote.laborLines))}
  ${summary}
  ${quote.optionalLines.length > 0 ? `${quoteTable('Opcional (no incluido en el total)', quote.optionalLines, hide)}<p class="small muted">Suscripción de pago a Home Assistant Cloud para el control por voz de Alexa o Google; también puede configurarse a mano (gratis) con acceso HTTPS público.</p>` : ''}
  ${notes && notes.trim() !== '' ? `<h3>Notas</h3><div class="notes">${esc(notes)}</div>` : ''}
</section>`;
}

const STATUS_LABELS = { ok: 'Funciona', degraded: 'Parcial', broken: 'No funciona' } as const;

function failureSection(project: Project, placed: Placed[], defs: DeviceDefinition[]): string {
  const ids: FailureScenarioId[] = ['internet', 'power'];
  const blocks = ids.map((id) => {
    const scenario = findScenario(id);
    const impact = scenarioImpact(project, defs, id);
    const nameOf = (deviceId: string): string => placed.find((p) => p.device.id === deviceId)?.device.name ?? 'Equipo eliminado';
    const devices = impact.unavailableDevices.map((d) => `<li>${esc(nameOf(d.deviceId))} <span class="muted small">— ${esc(d.reason)}</span></li>`);
    const autos = impact.automations
      .filter((a) => a.status !== 'ok')
      .map((a) => {
        const auto = project.automations.find((x) => x.id === a.automationId);
        return `<li><span class="badge ${a.status}">${STATUS_LABELS[a.status]}</span> ${esc(auto?.name ?? '')}</li>`;
      });
    return `<h3>${esc(scenario?.name ?? id)}</h3>
  <p class="muted">${esc(scenario?.description ?? '')}</p>
  <p><b>${esc(impact.summary)}</b></p>
  ${devices.length > 0 ? `<ul>${devices.join('')}</ul>` : '<p>Ningún equipo se queda sin servicio.</p>'}
  ${autos.length > 0 ? `<p>Automatizaciones afectadas:</p><ul>${autos.join('')}</ul>` : project.automations.length > 0 ? '<p>Todas las automatizaciones siguen funcionando.</p>' : ''}`;
  });
  return `<section class="page">
  <h2>Qué pasa si falla algo</h2>
  ${blocks.join('\n')}
</section>`;
}

function automationsSection(project: Project, defs: DeviceDefinition[]): string {
  if (project.automations.length === 0) return '';
  const items = project.automations.map(
    (a) => `<div class="automation"><b>${esc(a.name)}${a.enabled ? '' : ' <span class="muted small">(desactivada)</span>'}</b>${esc(describeAutomation(a, project, defs))}.</div>`,
  );
  const scenes = project.scenes.map((s) => `<li>${esc(s.name)} <span class="muted small">— ${esc(countLabel(Object.keys(s.entities).length, 'entidad', 'entidades'))}</span></li>`);
  return `<section class="page">
  <h2>Automatizaciones</h2>
  ${items.join('\n')}
  ${scenes.length > 0 ? `<h3>Escenas</h3><ul>${scenes.join('')}</ul>` : ''}
  ${project.scripts.length > 0 ? `<h3>Scripts</h3><ul>${project.scripts.map((s) => `<li>${esc(s.name)}</li>`).join('')}</ul>` : ''}
</section>`;
}

function phaseOf(def: DeviceDefinition): number {
  switch (def.role) {
    case 'ha_server':
      return 0;
    case 'access_point':
      return 1;
    case 'coordinator':
      return 2;
    case 'hub':
    case 'border_router':
      return 3;
    default:
      return 4;
  }
}

function pairingSection(project: Project, placed: Placed[]): string {
  const titles = ['Servidor Home Assistant', 'Red', 'Coordinadores y controladores', 'Hubs, puentes y border routers', 'Dispositivos'];
  const blocks: string[] = [];
  titles.forEach((title, phase) => {
    const items = placed.filter((p) => phaseOf(p.def) === phase);
    if (items.length === 0) return;
    const steps: string[] = [];
    if (phase <= 1) steps.push(...(ROLE_STEPS[phase === 0 ? 'ha_server' : 'access_point'] ?? []).slice(0, 2));
    const integrations = [...new Set(items.map((p) => p.device.integration))].filter((i): i is Integration => i !== 'homeassistant');
    if (phase >= 2) {
      for (const i of integrations) {
        const first = PAIRING_STEPS[i][0];
        if (first) steps.push(`${INTEGRATION_LABELS[i]}: ${first}`);
      }
    }
    const order = phase === 4 ? [...items].sort((a, b) => Number(a.def.power === 'battery') - Number(b.def.power === 'battery')) : items;
    blocks.push(`<h3>${phase + 1}. ${esc(title)}</h3>
  <p>${esc(order.map((p) => p.device.name).join(', '))}</p>
  ${steps.length > 0 ? `<ol>${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}`);
  });
  const people = project.people ?? [];
  if (people.length > 0) {
    blocks.push(`<h3>${titles.length + 1}. Personas</h3><p>Instalar la app de Home Assistant en el móvil de ${esc(people.map((p) => p.name).join(', '))} para la detección de presencia.</p>`);
  }
  const entities = placed.reduce((n, p) => n + entitiesForDevice(p.device, p.def).length, 0);
  return `<section class="page">
  <h2>Guía de emparejamiento</h2>
  <p class="muted">Orden de alta recomendado: cada fase depende de la anterior. Los dispositivos alimentados se emparejan antes que los de pilas para que formen la malla. En total se crean ${esc(countLabel(entities, 'entidad', 'entidades'))} en Home Assistant.</p>
  ${blocks.join('\n')}
</section>`;
}

/**
 * Propuesta completa en HTML autocontenido (sin recursos externos) lista para imprimir en A4.
 * Respeta `settings.quote.hidePrices` (sin importes).
 */
export function buildProposalHtml(project: Project, defs: DeviceDefinition[], opts: ProposalOptions): string {
  const generatedAt = opts.generatedAt instanceof Date ? opts.generatedAt : new Date(opts.generatedAt);
  const placed = placedDevices(project, defs);
  const quote = buildQuote(project, defs);
  const hide = pricesHidden(project);
  const q = quoteSettings(project);
  const body = [
    coverSection(project, generatedAt, quote),
    summarySection(project, placed, quote, hide),
    planSection(opts.planSvg),
    devicesSection(project, placed),
    quoteSection(quote, hide, q.notes),
    failureSection(project, placed, defs),
    automationsSection(project, defs),
    pairingSection(project, placed),
  ]
    .filter((s) => s !== '')
    .join('\n');
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(`Propuesta · ${project.name}`)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${body}
<footer>Generado con HA Simulator el ${esc(dateText(generatedAt))}.${q.installerName ? ` ${esc(q.installerName)}.` : ''}</footer>
</main>
</body>
</html>
`;
}
