// Geometría del minimapa de zonas y desplazamientos rápidos (solo interfaz, sin teselas).

const M_PER_DEG_LAT = 111_320;

export interface GeoCircle {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** Radio en metros. */
  radius: number;
}

/** Punto desplazado `km` hacia el rumbo indicado (aproximación local, suficiente para zonas). */
export function offsetKm(lat: number, lon: number, km: number, bearing: 'N' | 'S' | 'E' | 'O'): { latitude: number; longitude: number } {
  const m = km * 1000;
  const dLat = bearing === 'N' ? m / M_PER_DEG_LAT : bearing === 'S' ? -m / M_PER_DEG_LAT : 0;
  const cos = Math.cos((lat * Math.PI) / 180) || 1e-6;
  const dLon = bearing === 'E' ? m / (M_PER_DEG_LAT * cos) : bearing === 'O' ? -m / (M_PER_DEG_LAT * cos) : 0;
  return { latitude: round6(lat + dLat), longitude: round6(lon + dLon) };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export interface MapCircle extends GeoCircle {
  cx: number;
  cy: number;
  r: number;
}

/**
 * Proyecta los círculos a un lienzo de `size` px (equirectangular local centrada en la caja de
 * todas las zonas). Devuelve los círculos en px y los metros que representa la barra de escala.
 */
export function projectCircles(circles: GeoCircle[], size: number, pad = 16): { circles: MapCircle[]; metersPerPx: number; scaleMeters: number } {
  if (circles.length === 0) return { circles: [], metersPerPx: 1, scaleMeters: 0 };
  const lat0 = circles.reduce((a, c) => a + c.latitude, 0) / circles.length;
  const cos = Math.cos((lat0 * Math.PI) / 180);
  const pts = circles.map((c) => ({ ...c, x: c.longitude * M_PER_DEG_LAT * cos, y: -c.latitude * M_PER_DEG_LAT }));
  const minX = Math.min(...pts.map((p) => p.x - p.radius));
  const maxX = Math.max(...pts.map((p) => p.x + p.radius));
  const minY = Math.min(...pts.map((p) => p.y - p.radius));
  const maxY = Math.max(...pts.map((p) => p.y + p.radius));
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const metersPerPx = span / (size - pad * 2);
  const ox = (minX + maxX) / 2;
  const oy = (minY + maxY) / 2;
  const out = pts.map(({ x, y, ...c }) => ({ ...c, cx: size / 2 + (x - ox) / metersPerPx, cy: size / 2 + (y - oy) / metersPerPx, r: Math.max(2, c.radius / metersPerPx) }));
  return { circles: out, metersPerPx, scaleMeters: niceScale(metersPerPx * size * 0.25) };
}

/** Longitud «redonda» (1, 2, 5 × 10^n m) para la barra de escala. */
export function niceScale(meters: number): number {
  if (meters <= 0) return 0;
  const exp = Math.pow(10, Math.floor(Math.log10(meters)));
  const f = meters / exp;
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * exp;
}

export function formatMeters(m: number): string {
  return m >= 1000 ? `${(m / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} km` : `${Math.round(m)} m`;
}
