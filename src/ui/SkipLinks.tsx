/** Enlaces de salto: aparecen al recibir el foco con el teclado y llevan al lienzo o a las propiedades. */
const LINKS: Array<[string, string]> = [
  ['ha-canvas', 'Saltar al lienzo'],
  ['panel-propiedades', 'Saltar a propiedades'],
  ['panel-inferior', 'Saltar al panel inferior'],
];

export function SkipLinks() {
  return (
    <nav aria-label="Enlaces de salto">
      {LINKS.map(([target, label]) => (
        <a
          key={target}
          href={`#${target}`}
          onClick={(e) => {
            const el = document.getElementById(target);
            if (!el) return;
            e.preventDefault();
            el.focus();
          }}
          className="ha-skip-link rounded-md bg-sky-800 px-3 py-2 text-sm font-semibold text-white shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
