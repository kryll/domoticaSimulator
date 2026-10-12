// Candado entre pestañas: solo una pestaña del navegador controla el laboratorio. Usa Web Locks
// (el candado se libera solo si la pestaña se cierra o se cuelga) y, si no existen, un protocolo
// mínimo con BroadcastChannel. Sin ninguno de los dos, la pestaña controla directamente.

export type TabLockState = 'held' | 'waiting';

/** Subconjunto de LockManager que se usa (inyectable en tests). */
export interface LockManagerLike {
  request(name: string, options: { ifAvailable?: boolean; signal?: AbortSignal }, callback: (lock: unknown) => Promise<void> | void): Promise<unknown>;
}

/** Subconjunto de BroadcastChannel que se usa (inyectable en tests). */
export interface ChannelLike {
  postMessage(msg: unknown): void;
  close(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export interface TabLockDeps {
  locks?: LockManagerLike | null;
  channel?: ((name: string) => ChannelLike) | null;
  /** Espera a respuestas del fallback con BroadcastChannel (ms). */
  probeMs?: number;
}

export const LAB_LOCK_NAME = 'hasim-lab-controller';

function defaultDeps(): Required<Omit<TabLockDeps, 'probeMs'>> {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManagerLike }) : undefined;
  return {
    locks: nav?.locks ?? null,
    channel: typeof BroadcastChannel === 'function' ? (name: string) => new BroadcastChannel(name) as unknown as ChannelLike : null,
  };
}

/**
 * Pide el candado. `onState` recibe 'held' cuando esta pestaña controla el lab y 'waiting'
 * mientras otra lo tiene (y lo obtendrá sola en cuanto la otra lo suelte). Devuelve la función
 * que lo libera.
 */
export function acquireTabLock(name: string, onState: (s: TabLockState) => void, deps: TabLockDeps = {}): () => void {
  const d = { ...defaultDeps(), ...deps };
  let released = false;
  const emit = (s: TabLockState): void => {
    if (!released) onState(s);
  };

  if (d.locks) {
    const locks = d.locks;
    const abort = new AbortController();
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => (release = r));
    const hold = async (): Promise<void> => {
      emit('held');
      await held;
    };
    locks
      .request(name, { ifAvailable: true }, (lock) => {
        if (lock) return hold();
        emit('waiting');
        // En cola: se concede al soltarlo la otra pestaña.
        locks.request(name, { signal: abort.signal }, hold).catch(() => undefined);
        return undefined;
      })
      .catch(() => undefined);
    return () => {
      released = true;
      abort.abort();
      release();
    };
  }

  if (d.channel) {
    const ch = d.channel(name);
    let mine = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const probe = (): void => {
      let busy = false;
      ch.postMessage('who');
      const prev = ch.onmessage;
      ch.onmessage = (ev) => {
        if (ev.data === 'held') busy = true;
        prev?.(ev);
      };
      timer = setTimeout(() => {
        ch.onmessage = prev;
        if (released) return;
        if (busy) emit('waiting');
        else {
          mine = true;
          ch.postMessage('held');
          emit('held');
        }
      }, d.probeMs ?? 250);
    };
    ch.onmessage = (ev) => {
      if (ev.data === 'who' && mine) ch.postMessage('held');
      else if (ev.data === 'released' && !mine && !released) probe();
    };
    probe();
    return () => {
      released = true;
      if (timer) clearTimeout(timer);
      if (mine) ch.postMessage('released');
      mine = false;
      ch.close();
    };
  }

  emit('held');
  return () => {
    released = true;
  };
}
