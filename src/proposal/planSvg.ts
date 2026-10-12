// SVG del plano para la propuesta: salas y dispositivos serializados desde el proyecto (no del
// DOM), así sale igual en cualquier navegador y no depende del encuadre del lienzo. Lógica pura.
import type { DeviceDefinition, Floor, Point, Project } from '../types';
import { PROTOCOL_COLORS } from '../canvas/style';
import { deviceIcon } from '../devices/presentation';

const PAD = 40;
const NODE_R = 16;
const FLOOR_GAP = 60;
const TITLE_H = 28;

export function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] ?? c);
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function boundsOf(points: Point[]): Box | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function floorContent(project: Project, floor: Floor, defs: Map<string, DeviceDefinition>, offsetY: number): { svg: string; box: Box } | null {
  const rooms = project.rooms.filter((r) => r.floorId === floor.id && r.polygon.length >= 3);
  const devices = project.devices.filter((d) => d.floorId === floor.id);
  const pts = [...rooms.flatMap((r) => r.polygon), ...devices.flatMap((d) => [
    { x: d.position.x - 70, y: d.position.y - NODE_R },
    { x: d.position.x + 70, y: d.position.y + NODE_R + 16 },
  ])];
  const b = boundsOf(pts);
  if (!b) return null;
  const dx = PAD - b.x;
  const dy = offsetY + TITLE_H - b.y;
  const parts: string[] = [];
  parts.push(`<text x="${PAD}" y="${offsetY + 18}" font-size="16" font-weight="700" fill="#0f172a">${escapeXml(floor.name)}</text>`);
  for (const room of rooms) {
    const poly = room.polygon.map((p) => `${Math.round(p.x + dx)},${Math.round(p.y + dy)}`).join(' ');
    parts.push(`<polygon points="${poly}" fill="#f0f9ff" stroke="#64748b" stroke-width="2"/>`);
    const rb = boundsOf(room.polygon);
    if (rb) {
      parts.push(
        `<text x="${Math.round(rb.x + dx + 8)}" y="${Math.round(rb.y + dy + 18)}" font-size="13" font-weight="600" fill="#334155">${escapeXml(room.name)}</text>`,
      );
    }
  }
  const byId = new Map(devices.map((d) => [d.id, d]));
  for (const c of project.connections) {
    const a = byId.get(c.sourceId);
    const z = byId.get(c.targetId);
    if (!a || !z) continue;
    parts.push(
      `<line x1="${Math.round(a.position.x + dx)}" y1="${Math.round(a.position.y + dy)}" x2="${Math.round(z.position.x + dx)}" y2="${Math.round(z.position.y + dy)}" stroke="${PROTOCOL_COLORS[c.protocol]}" stroke-width="1.5" stroke-opacity="0.55"/>`,
    );
  }
  for (const d of devices) {
    const def = defs.get(d.definitionId);
    const x = Math.round(d.position.x + dx);
    const y = Math.round(d.position.y + dy);
    parts.push(
      `<g><circle cx="${x}" cy="${y}" r="${NODE_R}" fill="#ffffff" stroke="${PROTOCOL_COLORS[d.protocol]}" stroke-width="2.5"/>` +
        `<text x="${x}" y="${y + 6}" font-size="16" text-anchor="middle">${escapeXml(def ? deviceIcon(def) : '•')}</text>` +
        `<text x="${x}" y="${y + NODE_R + 14}" font-size="11" text-anchor="middle" fill="#1e293b">${escapeXml(d.name)}</text></g>`,
    );
  }
  return { svg: parts.join(''), box: { x: 0, y: offsetY, width: b.width + PAD * 2, height: b.height + TITLE_H + PAD } };
}

/**
 * SVG del plano de todas las plantas (una debajo de otra), con salas, conexiones y dispositivos.
 * Devuelve undefined si no hay nada que dibujar.
 */
export function buildPlanSvg(project: Project, defs: DeviceDefinition[]): string | undefined {
  const defMap = new Map(defs.map((d) => [d.id, d]));
  const floors = [...project.floors].sort((a, b) => a.level - b.level);
  const blocks: string[] = [];
  let y = PAD / 2;
  let width = 0;
  for (const floor of floors) {
    const block = floorContent(project, floor, defMap, y);
    if (!block) continue;
    blocks.push(block.svg);
    width = Math.max(width, block.box.width);
    y += block.box.height + FLOOR_GAP;
  }
  if (blocks.length === 0) return undefined;
  const height = Math.round(y - FLOOR_GAP + PAD / 2);
  width = Math.round(width);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeXml(`Plano de ${project.name}`)}" font-family="system-ui, sans-serif">` +
    blocks.join('') +
    '</svg>'
  );
}
