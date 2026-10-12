// Formato de moneda y energía para la interfaz (es-ES).

const formatters = new Map<string, Intl.NumberFormat>();

/** 1234.5 -> «1234,50 €» (es-ES). */
export function formatMoney(value: number, currency = 'EUR'): string {
  let f = formatters.get(currency);
  if (!f) {
    try {
      f = new Intl.NumberFormat('es-ES', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch {
      f = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    formatters.set(currency, f);
  }
  return f.format(Number.isFinite(value) ? value : 0);
}

const decimals = new Map<number, Intl.NumberFormat>();
/** Número con coma decimal y separador de miles (es-ES). */
export function formatDecimal(value: number, maxDigits = 2): string {
  let f = decimals.get(maxDigits);
  if (!f) {
    f = new Intl.NumberFormat('es-ES', { maximumFractionDigits: maxDigits });
    decimals.set(maxDigits, f);
  }
  return f.format(Number.isFinite(value) ? value : 0);
}

/** «60 W», «1,2 kW». */
export function formatWatts(w: number): string {
  return Math.abs(w) >= 1000 ? `${formatDecimal(w / 1000, 2)} kW` : `${formatDecimal(w, 0)} W`;
}

/** «0,35 kWh», «12 Wh» para cantidades pequeñas. */
export function formatKwh(kwh: number): string {
  return Math.abs(kwh) < 0.1 ? `${formatDecimal(kwh * 1000, 0)} Wh` : `${formatDecimal(kwh, 2)} kWh`;
}

/** Interpreta «12,50» o «12.50» como número. */
export function parseMoneyInput(text: string): number | undefined {
  const t = text.trim().replace(/\s|€/g, '').replace(',', '.');
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
