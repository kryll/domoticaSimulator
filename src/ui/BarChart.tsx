import { useId } from 'react';

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  /** Texto del valor (con unidades). */
  display: string;
}

export interface BarChartProps {
  title: string;
  data: BarDatum[];
  /** Ancho reservado para las etiquetas, en px. */
  labelWidth?: number;
  barHeight?: number;
  color?: string;
}

/** Gráfico de barras horizontal en SVG propio (sin librerías), accesible como figura con tabla. */
export function BarChart({ title, data, labelWidth = 140, barHeight = 18, color = '#0284c7' }: BarChartProps) {
  const titleId = useId();
  const max = data.reduce((m, d) => Math.max(m, d.value), 0) || 1;
  const gap = 6;
  const width = 480;
  const valueWidth = 80;
  const barArea = width - labelWidth - valueWidth;
  const height = data.length * (barHeight + gap) + gap;
  return (
    <figure className="m-0" aria-labelledby={titleId}>
      <figcaption id={titleId} className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </figcaption>
      {data.length === 0 ? (
        <p className="text-xs text-slate-500">Sin datos.</p>
      ) : (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          role="img"
          aria-label={`${title}: ${data.map((d) => `${d.label} ${d.display}`).join('; ')}`}
          className="max-w-xl"
        >
          {data.map((d, i) => {
            const y = gap + i * (barHeight + gap);
            const w = Math.max(d.value > 0 ? 2 : 0, (d.value / max) * barArea);
            return (
              <g key={d.key}>
                <text x={labelWidth - 6} y={y + barHeight / 2} textAnchor="end" dominantBaseline="central" fontSize="11" fill="#334155">
                  {d.label.length > 22 ? `${d.label.slice(0, 21)}…` : d.label}
                </text>
                <rect x={labelWidth} y={y} width={barArea} height={barHeight} rx="3" fill="#f1f5f9" />
                <rect x={labelWidth} y={y} width={w} height={barHeight} rx="3" fill={color} />
                <text x={labelWidth + barArea + 6} y={y + barHeight / 2} dominantBaseline="central" fontSize="11" fill="#0f172a">
                  {d.display}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </figure>
  );
}
