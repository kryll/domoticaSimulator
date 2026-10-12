import type { ExtraBottomTab } from '../store/uiStore';

/** Pestañas del panel inferior añadidas en la Fase 3. */
export const EXTRA_TABS: Array<{ key: ExtraBottomTab; label: string }> = [
  { key: 'home', label: 'Hogar' },
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'tests', label: 'Pruebas' },
];
