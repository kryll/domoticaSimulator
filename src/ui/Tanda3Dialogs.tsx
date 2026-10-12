import { Suspense, lazy } from 'react';
import { useLayoutStore } from '../store/layoutStore';

// Diálogos de la Tanda 3, cargados bajo demanda para no engordar el bundle inicial.
const CommandPalette = lazy(() => import('../search/CommandPalette').then((m) => ({ default: m.CommandPalette })));
const ImportHaWizard = lazy(() => import('../importui/ImportHaWizard').then((m) => ({ default: m.ImportHaWizard })));
const DayPlanDialog = lazy(() => import('../dayplanui/DayPlanDialog').then((m) => ({ default: m.DayPlanDialog })));
const CustomDeviceEditor = lazy(() => import('../catalog/CustomDeviceEditor').then((m) => ({ default: m.CustomDeviceEditor })));

export function Tanda3Dialogs() {
  const palette = useLayoutStore((s) => s.paletteOpen);
  const custom = useLayoutStore((s) => s.customDevice);
  const importHa = useLayoutStore((s) => s.importHaOpen);
  const dayPlan = useLayoutStore((s) => s.dayPlanOpen);
  return (
    <Suspense fallback={null}>
      {palette && <CommandPalette />}
      {custom && <CustomDeviceEditor key={JSON.stringify(custom)} />}
      {importHa && <ImportHaWizard />}
      {dayPlan && <DayPlanDialog />}
    </Suspense>
  );
}
