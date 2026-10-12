// Etiquetas, unidades y escala de las series de atributos del historial (solo interfaz).
import type { HistorySample } from '../types';
import { isGap } from '../simulation/history';

export interface SeriesMeta {
  label: string;
  unit?: string;
  /** Multiplicador para mostrar (brillo 0-255 → %, volumen 0-1 → %). */
  scale?: number;
  /** Serie de texto que se dibuja como franjas activas (valores que cuentan como activos). */
  activeValues?: readonly string[];
}

export const ATTRIBUTE_META: Record<string, SeriesMeta> = {
  brightness: { label: 'Brillo', unit: '%', scale: 100 / 255 },
  color_temp_kelvin: { label: 'Temperatura de color', unit: 'K' },
  current_position: { label: 'Posición', unit: '%' },
  current_temperature: { label: 'Temperatura actual', unit: '°C' },
  temperature: { label: 'Consigna', unit: '°C' },
  hvac_action: { label: 'Climatizando', activeValues: ['heating', 'cooling', 'drying', 'fan'] },
  volume_level: { label: 'Volumen', unit: '%', scale: 100 },
  battery_level: { label: 'Batería', unit: '%' },
};

/** Etiqueta en español de un atributo (o el nombre tal cual si no se conoce). */
export function attributeMeta(attribute: string): SeriesMeta {
  return ATTRIBUTE_META[attribute] ?? { label: attribute.replace(/_/g, ' ') };
}

/** Aplica la escala y, en series de texto con valores activos, las convierte a on/off. */
export function displaySamples(samples: HistorySample[], meta: SeriesMeta): HistorySample[] {
  const { scale, activeValues } = meta;
  if (!scale && !activeValues) return samples;
  return samples.map((s) => {
    if (isGap(s.v)) return s;
    if (activeValues) return { t: s.t, v: activeValues.includes(String(s.v)) ? 'on' : 'off' };
    return typeof s.v === 'number' && scale ? { t: s.t, v: Math.round(s.v * scale * 10) / 10 } : s;
  });
}
