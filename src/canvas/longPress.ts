// Pulsación larga en pantallas táctiles = menú contextual (lógica sin React, con temporizador).

export interface LongPressOptions {
  /** Milisegundos que hay que mantener el dedo (por defecto 550). */
  delay?: number;
  /** Píxeles que se puede mover el dedo sin cancelar (por defecto 10). */
  tolerance?: number;
  onLongPress: (point: { x: number; y: number; target: EventTarget | null }) => void;
}

export interface PointerLike {
  pointerType: string;
  pointerId: number;
  clientX: number;
  clientY: number;
  target: EventTarget | null;
  isPrimary?: boolean;
}

export interface LongPress {
  down: (e: PointerLike) => void;
  move: (e: PointerLike) => void;
  up: () => void;
  /** true si la última pulsación terminó en pulsación larga (para descartar el clic que sigue). */
  consumeFired: () => boolean;
}

export function createLongPress({ delay = 550, tolerance = 10, onLongPress }: LongPressOptions): LongPress {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let start: { x: number; y: number; id: number } | null = null;
  let fired = false;
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    start = null;
  };
  return {
    down(e) {
      cancel();
      fired = false;
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      if (e.isPrimary === false) return; // dos dedos: es un zoom, no una pulsación larga
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      const target = e.target;
      timer = setTimeout(() => {
        const p = start;
        cancel();
        if (!p) return;
        fired = true;
        onLongPress({ x: p.x, y: p.y, target });
      }, delay);
    },
    move(e) {
      if (!start) return;
      if (e.isPrimary === false || Math.hypot(e.clientX - start.x, e.clientY - start.y) > tolerance) cancel();
    },
    up: cancel,
    consumeFired() {
      const was = fired;
      fired = false;
      return was;
    },
  };
}
