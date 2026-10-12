/** Minúsculas y sin acentos/diacríticos, para búsquedas y slugs. */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}
