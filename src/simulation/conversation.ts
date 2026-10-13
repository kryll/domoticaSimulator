// Frases personalizadas de Assist (disparador `conversation`): plantillas con la sintaxis de HA
// ([opcional], (a|b) alternativas y {comodín}) comparadas sin acentos ni signos. Funciones puras.
import { foldText } from '../devices/text';

/** Texto normalizado: minúsculas, sin acentos ni signos de puntuación y con espacios simples. */
export function normalizeUtterance(text: string): string {
  return foldText(text)
    .replace(/(\d)[.,](\d)/g, '$1#$2')
    .replace(/[¿?¡!.,;:"«»()]/g, ' ')
    .replace(/(\d)#(\d)/g, '$1.$2')
    .replace(/\s+/g, ' ')
    .trim();
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Convierte una plantilla de HA en una expresión regular (sin anclar). */
function templateSource(template: string): string {
  let out = '';
  let i = 0;
  const text = foldText(template).replace(/[¿?¡!.,;:"«»]/g, ' ');
  const readGroup = (close: string): string => {
    let depth = 1;
    let j = i + 1;
    for (; j < text.length; j++) {
      const c = text[j];
      if (c === '[' || c === '(') depth++;
      else if (c === ']' || c === ')') depth--;
      if (depth === 0 && c === close) break;
    }
    const inner = text.slice(i + 1, j);
    i = j + 1;
    return inner;
  };
  while (i < text.length) {
    const c = text[i] ?? '';
    if (c === '[') {
      out += `(?:${templateSource(readGroup(']'))})?`;
    } else if (c === '(') {
      const inner = readGroup(')');
      out += `(?:${splitTop(inner).map(templateSource).join('|')})`;
    } else if (c === '{') {
      const end = text.indexOf('}', i);
      i = end === -1 ? text.length : end + 1;
      out += '(.+?)';
    } else if (/\s/.test(c)) {
      out += '\\s*';
      i++;
      while (i < text.length && /\s/.test(text[i] ?? '')) i++;
    } else {
      out += escape(c);
      i++;
    }
  }
  return out;
}

/** Divide «a|b|(c|d)» por las barras de primer nivel. */
function splitTop(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') depth--;
    else if (c === '|' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** ¿La frase encaja con la plantilla (completa, sin acentos y tolerante con los signos)? */
export function matchSentence(template: string, text: string): boolean {
  const source = templateSource(template.trim());
  if (source === '') return false;
  try {
    return new RegExp(`^\\s*${source}\\s*$`).test(normalizeUtterance(text));
  } catch {
    return false;
  }
}

/** Primera plantilla de la lista que encaja con la frase, o undefined. */
export function matchCommand(commands: string[], text: string): string | undefined {
  return commands.find((c) => matchSentence(c, text));
}
