import { create } from 'zustand';

/** Opciones del diálogo de confirmación propio (sustituye a window.confirm). */
export interface ConfirmOptions {
  title: string;
  message?: string;
  /** Lista de detalles (p. ej. dónde se usa lo que se va a borrar). */
  details?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  /** Acción destructiva: botón rojo y foco inicial en «Cancelar». */
  danger?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  id: number;
  resolve: (ok: boolean) => void;
}

interface ConfirmState {
  queue: PendingConfirm[];
  /** Cierra el diálogo visible con la respuesta dada. */
  answer: (ok: boolean) => void;
}

let counter = 0;

export const useConfirmStore = create<ConfirmState>()((set, get) => ({
  queue: [],
  answer: (ok) => {
    const [current, ...rest] = get().queue;
    if (!current) return;
    set({ queue: rest });
    current.resolve(ok);
  },
}));

/** Pide confirmación con el diálogo propio. Resuelve true si se acepta. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    useConfirmStore.setState((s) => ({ queue: [...s.queue, { ...options, id: ++counter, resolve }] }));
  });
}
