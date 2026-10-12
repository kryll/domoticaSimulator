// Escala de color de la capa «Clima» (solo interfaz).

const STOPS: Array<[number, [number, number, number]]> = [
  [12, [37, 99, 235]], // azul
  [18, [14, 165, 233]], // celeste
  [21, [34, 197, 94]], // verde (confort)
  [24, [234, 179, 8]], // amarillo
  [27, [249, 115, 22]], // naranja
  [30, [220, 38, 38]], // rojo
];

/** Color RGB para una temperatura en °C, interpolando entre los tramos. */
export function temperatureRgb(t: number): [number, number, number] {
  const first = STOPS[0]![1];
  const last = STOPS[STOPS.length - 1]![1];
  if (!Number.isFinite(t) || t <= STOPS[0]![0]) return first;
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i]!;
    const [t0, c0] = STOPS[i - 1]!;
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0);
      return [0, 1, 2].map((j) => Math.round(c0[j]! + (c1[j]! - c0[j]!) * k)) as [number, number, number];
    }
  }
  return last;
}

export function temperatureColor(t: number, alpha = 1): string {
  const [r, g, b] = temperatureRgb(t);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function formatTemperature(t: number): string {
  return `${t.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C`;
}
