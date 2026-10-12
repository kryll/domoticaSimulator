import { useConfirmStore } from '../ui/confirm';

/**
 * Responde automáticamente a los diálogos de confirmación propios (tests sin ConfirmDialog montado).
 * Devuelve la función para dejar de hacerlo.
 */
export function autoConfirm(answer = true): () => void {
  return useConfirmStore.subscribe((s) => {
    if (s.queue.length > 0) queueMicrotask(() => useConfirmStore.getState().answer(answer));
  });
}
