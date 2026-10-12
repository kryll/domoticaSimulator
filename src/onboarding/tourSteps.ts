// Pasos del mini tour (zona resaltada y texto).

export interface TourStepInfo {
  title: string;
  text: string;
  /** Selector CSS de la zona que se resalta. */
  target: string;
}

export const TOUR: TourStepInfo[] = [
  {
    title: 'Catálogo',
    text: 'Aquí están los dispositivos reales de cada marca. Filtra por marca, protocolo o categoría y pulsa «+» para añadirlos a la sala elegida, o arrástralos al plano.',
    target: '[data-tour="catalog"]',
  },
  {
    title: 'Lienzo',
    text: 'El plano de la casa: dibuja salas, coloca dispositivos y conéctalos. Con poco zoom los nodos se ven compactos; las capas muestran cobertura, clima y conexiones.',
    target: '#ha-canvas',
  },
  {
    title: 'Propiedades',
    text: 'Al seleccionar un dispositivo, una sala o una conexión verás aquí su ficha, sus entidades y sus controles.',
    target: '[data-tour="properties"]',
  },
  {
    title: 'Panel inferior',
    text: 'Validación con arreglos rápidos, presupuesto, automatizaciones, escenas y el registro de la simulación, agrupados en Diseño, Lógica y Uso.',
    target: '[data-tour="bottom"]',
  },
  {
    title: 'Simular',
    text: 'Pon en marcha la simulación para ver cómo reaccionan las automatizaciones. En modo Uso, un clic en un dispositivo lo enciende o lo apaga.',
    target: '[data-tour="simulate"]',
  },
];
