import { Suspense, lazy } from 'react';
import { useLayoutStore } from '../store/layoutStore';

// Diálogos de la Tanda 3, cargados bajo demanda para no engordar el bundle inicial.
const CommandPalette = lazy(() => import('../search/CommandPalette').then((m) => ({ default: m.CommandPalette })));

export function Tanda3Dialogs() {
  const palette = useLayoutStore((s) => s.paletteOpen);
  return <Suspense fallback={null}>{palette && <CommandPalette />}</Suspense>;
}
