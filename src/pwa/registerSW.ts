// Registro del service worker de la PWA y aviso de versión nueva (lógica sin React).
import { usePwaStore } from './pwaStore';

/** Lo mínimo de ServiceWorker que usamos (permite probar con objetos falsos). */
export interface WorkerLike {
  state: string;
  postMessage: (msg: unknown) => void;
  addEventListener: (type: 'statechange', fn: () => void) => void;
}

export interface RegistrationLike {
  waiting: WorkerLike | null;
  installing: WorkerLike | null;
  addEventListener: (type: 'updatefound', fn: () => void) => void;
}

/**
 * Avisa (`onReady`) cuando hay una versión nueva esperando a activarse. Solo si la página ya
 * estaba controlada por un service worker: la primera instalación no es una «versión nueva».
 */
export function watchForUpdates(reg: RegistrationLike, hasController: () => boolean, onReady: (worker: WorkerLike) => void): void {
  if (reg.waiting && hasController()) onReady(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const worker = reg.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && hasController()) onReady(worker);
    });
  });
}

/** Pide al service worker en espera que se active; al tomar el control, se recarga la página. */
export function activateWorker(worker: WorkerLike, container: Pick<ServiceWorkerContainer, 'addEventListener'>, reload: () => void): void {
  let reloaded = false;
  container.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    reload();
  });
  worker.postMessage({ type: 'SKIP_WAITING' });
}

/** Registra `sw.js` junto a la app (respeta el base de Vite). Solo en producción. */
export function registerServiceWorker(base: string = import.meta.env.BASE_URL): void {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const container = navigator.serviceWorker;
  const register = () => {
    container
      .register(`${base}sw.js`, { scope: base })
      .then((reg) => {
        watchForUpdates(reg, () => container.controller !== null, (worker) =>
          usePwaStore.getState().setUpdate(() => activateWorker(worker, container, () => window.location.reload())),
        );
        // Comprueba si hay versión nueva cada hora mientras la app sigue abierta.
        window.setInterval(() => void reg.update().catch(() => undefined), 60 * 60 * 1000);
      })
      .catch(() => undefined);
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
