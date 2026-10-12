// Lista de materiales y presupuesto (B8): agrupa los dispositivos por modelo con su precio
// (los del proyecto tienen prioridad sobre los del catálogo) y detecta la infraestructura que falta.
import type { Brand, Device, DeviceCategory, DeviceDefinition, Id, Project, Protocol } from '../types';
import { CATEGORY_LABELS, PROTOCOL_LABELS } from '../devices/labels';
import {
  isBleProxy,
  isInfra,
  isRfBridge,
  isThreadBorderRouter,
  isZigbeeCoordinator,
  isZwaveController,
  requiredHubBrand,
  zigbeeNetworkOf,
} from '../devices/roles';
import { CSV_BOM, CSV_SEPARATOR, csvField } from './csv';

export interface BomLine {
  definitionId: Id;
  brand: Brand;
  model: string;
  name: string;
  category: DeviceCategory;
  quantity: number;
  /** Precio unitario en euros (0 si no hay precio). */
  unitPrice: number;
  total: number;
  /** De dónde sale el precio: ajustes del proyecto, catálogo o ninguno. */
  priceSource: 'project' | 'catalog' | 'none';
  /** Protocolos con los que se usan estos dispositivos en el proyecto. */
  protocols: Protocol[];
  /** Salas donde están (sin repetir, por orden de aparición). */
  rooms: string[];
}

export interface BomGroup {
  key: string;
  label: string;
  quantity: number;
  total: number;
}

export interface BomInfrastructure {
  definitionId: Id;
  name: string;
  reason: string;
  unitPrice: number;
}

export interface BomReport {
  lines: BomLine[];
  byRoom: BomGroup[];
  byProtocol: BomGroup[];
  byCategory: BomGroup[];
  /** Total de lo que hay en el proyecto. */
  total: number;
  /** Infraestructura que falta para que el diseño funcione (no incluida en el total). */
  requiredInfrastructure: BomInfrastructure[];
  /** Total con la infraestructura que falta. */
  totalWithInfrastructure: number;
  /** definitionId sin precio (ni en el catálogo ni en el proyecto). */
  unpriced: Id[];
  currency: 'EUR';
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

function priceOf(def: DeviceDefinition, project: Project): { price: number; source: BomLine['priceSource'] } {
  const custom = project.settings?.prices?.[def.id];
  if (custom !== undefined) return { price: custom, source: 'project' };
  if (def.priceEur !== undefined) return { price: def.priceEur, source: 'catalog' };
  return { price: 0, source: 'none' };
}

function addTo(groups: Map<string, BomGroup>, key: string, label: string, quantity: number, total: number): void {
  const g = groups.get(key) ?? { key, label, quantity: 0, total: 0 };
  groups.set(key, { ...g, quantity: g.quantity + quantity, total: round2(g.total + total) });
}

const sorted = (groups: Map<string, BomGroup>): BomGroup[] => [...groups.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));

interface Placed {
  device: Device;
  def: DeviceDefinition;
}

/** Equipo propuesto para cada hub propietario. */
const HUB_FOR_BRAND: Partial<Record<Brand, Id>> = { Aqara: 'aqara-hub-m2', IKEA: 'ikea-dirigera', 'Philips Hue': 'hue-bridge-v2' };

function missingInfrastructure(placed: Placed[], project: Project, defs: DeviceDefinition[]): BomInfrastructure[] {
  const has = (pred: (d: DeviceDefinition) => boolean): boolean => placed.some((p) => pred(p.def));
  const endpoints = placed.filter((p) => !isInfra(p.def));
  const uses = (pred: (p: Placed) => boolean): boolean => endpoints.some(pred);
  const out: BomInfrastructure[] = [];
  const add = (definitionId: Id, reason: string): void => {
    const def = defs.find((d) => d.id === definitionId);
    if (!def || out.some((x) => x.definitionId === definitionId)) return;
    out.push({ definitionId, name: def.name, reason, unitPrice: priceOf(def, project).price });
  };
  if (placed.length > 0 && !has((d) => d.role === 'ha_server')) add('ha-green', 'No hay servidor de Home Assistant');
  if (uses((p) => p.device.protocol === 'zigbee' && zigbeeNetworkOf(p.device, p.def) === 'coordinator') && !has(isZigbeeCoordinator)) {
    add('sonoff-zbdongle-p', 'Hay dispositivos Zigbee con ZHA/Zigbee2MQTT y ningún coordinador');
  }
  const brands = new Set<Brand>();
  for (const p of endpoints) {
    const brand = requiredHubBrand(p.device, p.def);
    if (brand && !has((d) => d.role === 'hub' && d.brand === brand)) brands.add(brand);
  }
  for (const brand of brands) {
    const hub = HUB_FOR_BRAND[brand];
    if (hub) add(hub, `Los dispositivos de ${brand} con su integración necesitan su hub`);
  }
  if (uses((p) => p.device.protocol === 'thread') && !has(isThreadBorderRouter)) add('google-nest-hub-2', 'Hay dispositivos Thread y ningún border router');
  if (uses((p) => p.device.protocol === 'zwave') && !has(isZwaveController)) add('ha-connect-zwa-2', 'Hay dispositivos Z-Wave y ningún controlador');
  if (uses((p) => p.device.protocol === 'wifi' || p.device.protocol === 'matter') && !has((d) => d.role === 'access_point')) {
    add('tplink-deco-x50', 'Hay dispositivos Wi-Fi y ningún router o punto de acceso');
  }
  if (uses((p) => p.device.protocol === 'ble') && !has(isBleProxy)) add('shelly-1pm-gen3', 'Hay dispositivos Bluetooth y ningún proxy Bluetooth (un Shelly Gen3 sirve)');
  if (uses((p) => p.device.protocol === 'rf433') && !has(isRfBridge)) add('sonoff-rf-bridge-r2', 'Hay sensores RF 433 MHz y ningún puente RF');
  return out;
}

/** Lista de materiales y presupuesto del proyecto. */
export function billOfMaterials(project: Project, defs: DeviceDefinition[]): BomReport {
  const placed: Placed[] = [];
  for (const device of project.devices) {
    const def = defs.find((d) => d.id === device.definitionId);
    if (def) placed.push({ device, def });
  }
  const lines = new Map<Id, BomLine>();
  const byRoom = new Map<string, BomGroup>();
  const byProtocol = new Map<string, BomGroup>();
  const byCategory = new Map<string, BomGroup>();
  for (const { device, def } of placed) {
    const { price, source } = priceOf(def, project);
    const room = project.rooms.find((r) => r.id === device.roomId);
    const roomName = room?.name ?? 'Sin sala';
    const line = lines.get(def.id) ?? {
      definitionId: def.id,
      brand: def.brand,
      model: def.model,
      name: def.name,
      category: def.category,
      quantity: 0,
      unitPrice: price,
      total: 0,
      priceSource: source,
      protocols: [],
      rooms: [],
    };
    lines.set(def.id, {
      ...line,
      quantity: line.quantity + 1,
      total: round2((line.quantity + 1) * price),
      protocols: line.protocols.includes(device.protocol) ? line.protocols : [...line.protocols, device.protocol],
      rooms: line.rooms.includes(roomName) ? line.rooms : [...line.rooms, roomName],
    });
    addTo(byRoom, room?.id ?? '', roomName, 1, price);
    addTo(byProtocol, device.protocol, PROTOCOL_LABELS[device.protocol], 1, price);
    addTo(byCategory, def.category, CATEGORY_LABELS[def.category], 1, price);
  }
  const list = [...lines.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const total = round2(list.reduce((s, l) => s + l.total, 0));
  const requiredInfrastructure = missingInfrastructure(placed, project, defs);
  return {
    lines: list,
    byRoom: sorted(byRoom),
    byProtocol: sorted(byProtocol),
    byCategory: sorted(byCategory),
    total,
    requiredInfrastructure,
    totalWithInfrastructure: round2(total + requiredInfrastructure.reduce((s, x) => s + x.unitPrice, 0)),
    unpriced: list.filter((l) => l.priceSource === 'none').map((l) => l.definitionId),
    currency: 'EUR',
  };
}

/** Importe con coma decimal y dos decimales («12,50»), como espera Excel en español. */
export function formatEuros(n: number): string {
  return n.toFixed(2).replace('.', ',');
}

export const BOM_CSV_HEADERS = ['Marca', 'Modelo', 'Nombre', 'Cantidad', 'Precio unitario (€)', 'Total (€)', 'Protocolos', 'Salas'] as const;

/** Presupuesto en CSV (separador «;», BOM UTF-8, coma decimal). */
export function bomToCsv(report: BomReport): string {
  const rows: string[][] = [[...BOM_CSV_HEADERS]];
  for (const l of report.lines) {
    rows.push([
      l.brand,
      l.model,
      l.name,
      String(l.quantity),
      formatEuros(l.unitPrice),
      formatEuros(l.total),
      l.protocols.map((p) => PROTOCOL_LABELS[p]).join(', '),
      l.rooms.join(', '),
    ]);
  }
  rows.push(['', '', 'Total', String(report.lines.reduce((s, l) => s + l.quantity, 0)), '', formatEuros(report.total), '', '']);
  if (report.requiredInfrastructure.length > 0) {
    rows.push([]);
    rows.push(['Infraestructura necesaria (no incluida)', '', 'Nombre', 'Cantidad', 'Precio unitario (€)', 'Total (€)', 'Motivo', '']);
    for (const x of report.requiredInfrastructure) {
      rows.push(['', '', x.name, '1', formatEuros(x.unitPrice), formatEuros(x.unitPrice), x.reason, '']);
    }
    rows.push(['', '', 'Total con infraestructura', '', '', formatEuros(report.totalWithInfrastructure), '', '']);
  }
  return `${CSV_BOM}${rows.map((r) => r.map(csvField).join(CSV_SEPARATOR)).join('\r\n')}\r\n`;
}
