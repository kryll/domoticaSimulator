/** Lleva el foco al buscador del catálogo (paso «Añade dispositivos»). */
export function focusCatalogSearch(): boolean {
  const input = document.querySelector<HTMLInputElement>('[data-catalog-search]');
  if (!input) return false;
  input.focus();
  // En pantallas estrechas el catálogo está oculto y no puede recibir el foco.
  return document.activeElement === input;
}
