// Ajustes del laboratorio propios de esta máquina (localStorage), nunca del proyecto: si el lab
// está activado, la URL del orquestador y el token del laboratorio (emulator/.env, LAB_TOKEN).
// Así un enlace compartido o un JSON importado no conectan con el orquestador que lleven dentro,
// y el token no viaja en exportaciones, versiones ni enlaces.
import { create } from 'zustand';

export interface LocalLabSettings {
  enabled: boolean;
  /** WebSocket del orquestador, p. ej. ws://localhost:8080/orchestrator. */
  orchestratorUrl: string;
  /** Token del laboratorio (LAB_TOKEN de emulator/.env). '' si no se ha puesto todavía. */
  token: string;
}

export const LOCAL_LAB_KEY = 'hasim.lab.local';
export const DEFAULT_ORCHESTRATOR_URL = 'ws://localhost:8080/orchestrator';

/** Formato del token que genera emulator/scripts/setup.sh (y longitud mínima razonable). */
export const LAB_TOKEN_RE = /^[A-Za-z0-9_-]{16,256}$/;
export const ORCHESTRATOR_URL_RE = /^wss?:\/\/\S+$/;

export function defaultLocalLab(): LocalLabSettings {
  return { enabled: false, orchestratorUrl: DEFAULT_ORCHESTRATOR_URL, token: '' };
}

/** Lee y valida los ajustes guardados; cualquier valor raro vuelve al valor por defecto. Pura. */
export function parseLocalLab(text: string | null): LocalLabSettings {
  const def = defaultLocalLab();
  if (!text) return def;
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return def;
    const o = raw as Record<string, unknown>;
    return {
      enabled: typeof o.enabled === 'boolean' ? o.enabled : def.enabled,
      orchestratorUrl: typeof o.orchestratorUrl === 'string' && ORCHESTRATOR_URL_RE.test(o.orchestratorUrl) ? o.orchestratorUrl : def.orchestratorUrl,
      token: typeof o.token === 'string' && LAB_TOKEN_RE.test(o.token) ? o.token : '',
    };
  } catch {
    return def;
  }
}

function storage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function readLocalLab(): LocalLabSettings {
  try {
    return parseLocalLab(storage()?.getItem(LOCAL_LAB_KEY) ?? null);
  } catch {
    return defaultLocalLab();
  }
}

function writeLocalLab(s: LocalLabSettings): void {
  try {
    storage()?.setItem(LOCAL_LAB_KEY, JSON.stringify(s));
  } catch {
    // Almacenamiento bloqueado (modo privado): el ajuste dura lo que la pestaña.
  }
}

interface LocalLabState extends LocalLabSettings {
  update: (patch: Partial<LocalLabSettings>) => void;
  /** Vuelve a leer localStorage (otra pestaña lo ha cambiado). */
  reload: () => void;
}

export const useLocalLab = create<LocalLabState>()((set, get) => ({
  ...readLocalLab(),
  update: (patch) => {
    const { enabled, orchestratorUrl, token } = { ...get(), ...patch };
    const next = { enabled, orchestratorUrl, token };
    writeLocalLab(next);
    set(next);
  },
  reload: () => set(readLocalLab()),
}));

/** Ajustes locales actuales (fuera de React). */
export function localLab(): LocalLabSettings {
  const { enabled, orchestratorUrl, token } = useLocalLab.getState();
  return { enabled, orchestratorUrl, token };
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === LOCAL_LAB_KEY) useLocalLab.getState().reload();
  });
}
