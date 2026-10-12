import type { BottomTab, ExtraBottomTab } from '../store/uiStore';

/** Pestañas del panel inferior añadidas en la Fase 3 (el Dashboard es una vista del área central). */
export const EXTRA_TABS: Array<{ key: ExtraBottomTab; label: string }> = [
  { key: 'home', label: 'Hogar' },
  { key: 'tests', label: 'Pruebas' },
];

export type TabGroup = 'design' | 'logic' | 'use';

/** Grupos de pestañas del panel inferior. */
export const TAB_GROUPS: Array<{ key: TabGroup; label: string; tabs: BottomTab[] }> = [
  { key: 'design', label: 'Diseño', tabs: ['validation', 'impact', 'budget', 'energy'] },
  { key: 'logic', label: 'Lógica', tabs: ['automations', 'scenes', 'tests'] },
  { key: 'use', label: 'Uso', tabs: ['logbook', 'home'] },
];

export function groupOfTab(tab: BottomTab): TabGroup {
  return TAB_GROUPS.find((g) => g.tabs.includes(tab))?.key ?? 'design';
}
