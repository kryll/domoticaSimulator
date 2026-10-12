// Modo presentación (Tanda 2): copia de solo lectura del proyecto para enseñarla al cliente.
import type { Project } from '../types';

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

/** ¿Oculta el proyecto los precios en el modo presentación? */
export function pricesHidden(project: Pick<Project, 'settings'>): boolean {
  return project.settings?.quote?.hidePrices === true;
}

/**
 * Copia profunda e inmutable (congelada) del proyecto para el modo presentación. Sin variantes
 * ni líneas de tiempo de pruebas. Si `settings.quote.hidePrices`, quita los precios propios y
 * las tarifas y márgenes del presupuesto (se conservan los datos del cliente y del instalador).
 */
export function presentationSnapshot(project: Project): Project {
  const copy = JSON.parse(JSON.stringify(project)) as Project;
  delete copy.variants;
  delete copy.timelines;
  if (pricesHidden(project) && copy.settings) {
    delete copy.settings.prices;
    const q = copy.settings.quote;
    if (q) {
      copy.settings.quote = { hidePrices: true };
      if (q.clientName !== undefined) copy.settings.quote.clientName = q.clientName;
      if (q.clientAddress !== undefined) copy.settings.quote.clientAddress = q.clientAddress;
      if (q.installerName !== undefined) copy.settings.quote.installerName = q.installerName;
      if (q.notes !== undefined) copy.settings.quote.notes = q.notes;
    }
  }
  return deepFreeze(copy);
}
