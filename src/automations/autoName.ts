// Nombre automático de una automatización a partir de su descripción en lenguaje natural.

/** Longitud máxima del nombre propuesto. */
export const AUTO_NAME_MAX = 70;

/** ¿Es un nombre provisional («Automatización 3», «Cuando Sensor…» o vacío)? */
export function isPlaceholderName(name: string): boolean {
  const n = name.trim();
  return n === '' || /^Automatización \d+$/.test(n) || /^Cuando .+…$/.test(n) || n === 'Nueva automatización';
}

/**
 * «Cuando el sensor detecta movimiento y es de noche, enciende la luz» →
 * «Sensor detecta movimiento → enciende la luz» (recortado a AUTO_NAME_MAX con «…»).
 */
export function suggestAutomationName(description: string, max = AUTO_NAME_MAX): string {
  let text = description.trim().replace(/\.$/, '');
  const comma = text.indexOf(', ');
  if (comma > 0) {
    const when = text.slice(0, comma).replace(/^Cuando /, '').replace(/ y .*$/, '');
    text = `${when} → ${text.slice(comma + 2)}`;
  }
  text = text.charAt(0).toUpperCase() + text.slice(1);
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:→]+$/, '')}…`;
}
