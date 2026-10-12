import { useEffect } from 'react';
import { CatalogPanel } from '../catalog/CatalogPanel';
import { PropertiesPanel } from '../canvas/PropertiesPanel';
import { useLayoutStore } from '../store/layoutStore';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { Drawer } from './Drawer';

/**
 * Catálogo y Propiedades como cajones en pantallas estrechas (< 1024 px). Al añadir un dispositivo
 * desde el catálogo, el cajón se cierra para ver dónde ha caído.
 */
export function MobileDrawers() {
  const drawer = useLayoutStore((s) => s.drawer);
  const setDrawer = useLayoutStore((s) => s.setDrawer);

  useEffect(() => {
    if (drawer !== 'catalog') return;
    return useProjectStore.subscribe((s, prev) => {
      if (s.project.devices.length > prev.project.devices.length) useLayoutStore.getState().setDrawer(null);
    });
  }, [drawer]);

  // Al cambiar de planta o vaciar la selección no tiene sentido seguir con las propiedades abiertas.
  useEffect(
    () =>
      useUiStore.subscribe((s, prev) => {
        if (s.activeFloorId !== prev.activeFloorId && useLayoutStore.getState().drawer === 'properties') useLayoutStore.getState().setDrawer(null);
      }),
    [],
  );

  return (
    <>
      <Drawer open={drawer === 'catalog'} title="Catálogo" side="left" onClose={() => setDrawer(null)}>
        <CatalogPanel />
      </Drawer>
      <Drawer open={drawer === 'properties'} title="Propiedades" side="bottom" id="panel-propiedades" onClose={() => setDrawer(null)}>
        <PropertiesPanel />
      </Drawer>
    </>
  );
}

/** Botones «Catálogo» y «Propiedades» de la barra de plantas (solo en pantallas estrechas). */
export function DrawerButtons({ which }: { which: 'catalog' | 'properties' }) {
  const setDrawer = useLayoutStore((s) => s.setDrawer);
  const hasSelection = useUiStore((s) => s.selection.length > 0);
  if (which === 'catalog') {
    return (
      <button
        type="button"
        data-tour="catalog"
        onClick={() => setDrawer('catalog')}
        aria-label="Catálogo"
        aria-haspopup="dialog"
        className="flex min-h-[2.75rem] min-w-[2.75rem] shrink-0 justify-center items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
      >
        <span aria-hidden="true">＋</span>
        <span aria-hidden="true" className="hidden sm:inline">
          Catálogo
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      data-tour="properties"
      onClick={() => setDrawer('properties')}
      aria-label={hasSelection ? 'Propiedades (hay selección)' : 'Propiedades'}
      aria-haspopup="dialog"
      className="relative flex min-h-[2.75rem] min-w-[2.75rem] shrink-0 justify-center items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
    >
      <span aria-hidden="true">☷</span>
      <span aria-hidden="true" className="hidden sm:inline">
        Propiedades
      </span>
      {hasSelection && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-sky-600" aria-hidden="true" />}
    </button>
  );
}
