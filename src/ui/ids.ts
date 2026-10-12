/** Genera un identificador único para entidades de la interfaz. */
export function newId(prefix = 'id'): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

/** id del panel asociado a una pestaña (aria-controls). */
export function tabPanelId(prefix: string, key: string): string {
  return `${prefix}-panel-${key}`;
}
