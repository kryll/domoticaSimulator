// Plurales en español para textos con cantidades (lógica pura, sin React).

/** Singular o plural según la cantidad: plural(1, 'automatización', 'automatizaciones') → «automatización». */
export function plural(n: number, singular: string, pluralForm: string): string {
  return Math.abs(n) === 1 ? singular : pluralForm;
}

/** Determinante negativo concordado con el sustantivo («Ningún dispositivo», «Ninguna automatización»). */
function none(singular: string, feminine: boolean | undefined): string {
  const fem = feminine ?? guessFeminine(singular);
  return `${fem ? 'Ninguna' : 'Ningún'} ${singular}`;
}

/** Terminaciones habituales de sustantivos femeninos (heurística para «Ninguna»). */
const FEMININE_ENDINGS = ['ción', 'sión', 'dad', 'tud', 'umbre', 'a', 'as'];
/** Excepciones frecuentes en la aplicación. */
const MASCULINE_WORDS = new Set(['problema', 'sistema', 'tema', 'día', 'mapa', 'esquema', 'programa', 'idioma', 'clima']);
const FEMININE_WORDS = new Set(['luz', 'red', 'llave', 'clase', 'tecla', 'persona', 'versión', 'imagen', 'base']);

function guessFeminine(phrase: string): boolean {
  const word = (phrase.trim().split(/\s+/)[0] ?? '').toLowerCase();
  if (MASCULINE_WORDS.has(word)) return false;
  if (FEMININE_WORDS.has(word)) return true;
  return FEMININE_ENDINGS.some((e) => word.endsWith(e));
}

export interface CountLabelOptions {
  /** Texto para 0 en lugar de «Ninguno/Ninguna …» (p. ej. «Sin dispositivos»). */
  zero?: string;
  /** Fuerza el género del «Ningún/Ninguna» cuando la heurística no acierta. */
  feminine?: boolean;
}

/**
 * «1 automatización», «2 automatizaciones», «Ninguna automatización».
 * Los miles llevan separador español (1.234).
 */
export function countLabel(n: number, singular: string, pluralForm: string, opts: CountLabelOptions = {}): string {
  if (n === 0) return opts.zero ?? none(singular, opts.feminine);
  return `${formatCount(n)} ${plural(n, singular, pluralForm)}`;
}

function formatCount(n: number): string {
  return Number.isInteger(n) ? new Intl.NumberFormat('es-ES', { useGrouping: true }).format(n) : String(n).replace('.', ',');
}
