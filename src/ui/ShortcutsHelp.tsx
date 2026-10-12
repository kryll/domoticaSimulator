import { useUiStore } from '../store/uiStore';
import { Modal } from './Modal';

const GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: 'Modos del lienzo',
    items: [
      ['V', 'Edición: seleccionar y mover'],
      ['U', 'Uso: clic = acción principal'],
      ['C', 'Conectar dispositivos'],
      ['R', 'Dibujar sala (menú «Dibujar ▾», que también dibuja paredes)'],
      ['P', 'Simular / pausar'],
      ['?', 'Mostrar esta ayuda'],
      ['Esc', 'Cerrar menú, popover o modo'],
    ],
  },
  {
    title: 'Sobre un dispositivo',
    items: [
      ['Clic', 'En Uso: acción principal (Mayús+clic selecciona)'],
      ['Alt+clic o ⏻', 'En Edición: acción principal'],
      ['Doble clic', 'Control completo'],
      ['Clic derecho', 'Menú contextual'],
      ['Rueda', 'Brillo, posición, volumen o consigna (en Edición, con Mayús)'],
    ],
  },
  {
    title: 'Barra del lienzo y vistas',
    items: [
      ['Capas ▾', 'Cobertura, Clima y Señal (las leyendas se pliegan)'],
      ['Herramientas ▾', 'Autoconectar y Sugerir router'],
      ['Plano | Dashboard', 'Cambiar la vista del área central'],
      ['Diseño · Lógica · Uso', 'Grupos de pestañas del panel inferior («Más ▾» si no caben)'],
      ['Reloj', 'Fecha, sol de hoy e «Ir a…» una hora'],
    ],
  },
  {
    title: 'Automatizaciones',
    items: [
      ['{{ nombre }}', 'Variables en notificaciones y datos: «+ Insertar variable…» muestra las disponibles (repeat.index, trigger.*)'],
      ['Esperar a un disparador', 'Hora, sol con desfase o estado con «Durante»; la traza indica «Esperando hasta las …»'],
    ],
  },
  {
    title: 'Teclado (dispositivo seleccionado o bajo el ratón)',
    items: [
      ['Espacio / Intro', 'Acción principal'],
      ['↑ / ↓', '±10 % o ±0,5 °C'],
      ['1 … 9', '10 % … 90 % (solo dispositivos con nivel)'],
      ['0', 'Apagar'],
      ['Supr', 'Eliminar (solo en Edición)'],
      ['Ctrl+Z / Ctrl+Y', 'Deshacer / rehacer'],
    ],
  },
];

/** Diálogo con los atajos del lienzo (tecla ?). */
export function ShortcutsHelp() {
  const open = useUiStore((s) => s.shortcutsOpen);
  const setOpen = useUiStore((s) => s.setShortcutsOpen);
  return (
    <Modal open={open} title="Atajos de teclado y ratón" onClose={() => setOpen(false)}>
      <div className="flex flex-col gap-4">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.title}</h3>
            <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
              {g.items.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt>
                    <kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-xs text-slate-700">{k}</kbd>
                  </dt>
                  <dd className="text-slate-700">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
