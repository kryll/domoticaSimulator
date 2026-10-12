import { useIsDesktop } from './breakpoints';
import { useLayoutStore } from '../store/layoutStore';

/** Enlaces de salto: aparecen al recibir el foco con el teclado y llevan al lienzo o a las propiedades. */
const LINKS: Array<[string, string]> = [
  ['ha-canvas', 'Saltar al lienzo'],
  ['panel-propiedades', 'Saltar a propiedades'],
  ['panel-inferior', 'Saltar al panel inferior'],
];

const CLASS =
  'ha-skip-link rounded-md bg-sky-800 px-3 py-2 text-sm font-semibold text-white shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300';

export function SkipLinks() {
  const desktop = useIsDesktop();
  return (
    <nav aria-label="Enlaces de salto">
      {LINKS.map(([target, label]) =>
        // En pantallas estrechas las propiedades viven en una hoja inferior que solo existe abierta:
        // en vez de un enlace sin destino, un botón que la abre (la hoja recibe el foco).
        !desktop && target === 'panel-propiedades' ? (
          <button key={target} type="button" onClick={() => useLayoutStore.getState().setDrawer('properties')} className={CLASS}>
            Abrir propiedades
          </button>
        ) : (
          <a
            key={target}
            href={`#${target}`}
            onClick={(e) => {
              const el = document.getElementById(target);
              if (!el) return;
              e.preventDefault();
              el.focus();
            }}
            className={CLASS}
          >
            {label}
          </a>
        ),
      )}
    </nav>
  );
}
