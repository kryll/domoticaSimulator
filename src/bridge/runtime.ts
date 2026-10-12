// Puente de la app con el laboratorio, fuera de React: se suscribe a los stores del proyecto y
// de la simulación (sin repintar el lienzo), manda el proyecto y los cambios de estado al
// orquestador y aplica con callService los comandos que llegan de HA.
//
// Conexión: al abrir el WebSocket la app se presenta con `hello` y el token del laboratorio
// (ajuste local, src/bridge/localLab.ts). Solo cuando el orquestador responde con su `hello`
// (readOnly: false) esta app controla el lab y manda el proyecto y el estado. Con readOnly: true
// otra app lo controla: esta solo ve el estado y el tráfico.
import type { Id, Project, SimulationState } from '../types';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { useUiStore } from '../store/uiStore';
import { allDefinitions, catalog } from '../devices/catalog';
import { simNowForProject } from '../simulation/clock';
import { parseProject } from '../store/projectSchema';
import { BridgeClient, type ClientStatus, type SocketFactory } from './bridgeClient';
import { useBridgeStore } from './bridgeStore';
import { bridgeSettings } from './schema';
import { localLab, useLocalLab } from './localLab';
import { availabilityFromSim } from './mqtt/availability';
import { definitionsFor, diffEntities, projectForLab, projectPatch, mergeRestoredProject } from './sync';
import type { LabAction, ServerMessage } from './protocol';

/** Retardo para agrupar cambios de estado antes de mandarlos. */
const STATE_THROTTLE_MS = 100;

let client: BridgeClient | undefined;
let socketFactory: SocketFactory | undefined;
let sentEntities: SimulationState['entities'] = {};
let sentAvailabilityKey = '';
let lastProject: Project | undefined;
let stateTimer: ReturnType<typeof setTimeout> | undefined;
/** Operaciones internas que pausan o cambian la simulación sin desacoplar (reset, restore). */
let internalChange = false;
let requestSeq = 0;
let trafficSubscribed = false;
/** Esta app controla el lab (el orquestador aceptó el token y no hay otra app al mando). */
let controller = false;
/** Peticiones `lab` en curso: solo se aceptan los lab_result de estas. */
const pending = new Set<string>();
/** Se pararon todos los nodos al pausar en vivo: al volver a acoplar se arrancan. */
let nodesStoppedByPause = false;

function defs(project: Project) {
  // Catálogo + personalizados del proyecto: los dispositivos personalizados también llegan al lab.
  const all = allDefinitions(project, catalog);
  return definitionsFor(project, (id) => all.find((d) => d.id === id));
}

function notify(text: string, kind: 'info' | 'success' | 'error' = 'info'): void {
  useUiStore.getState().notify(text, kind);
}

/** ¿Se puede mandar al orquestador como app que controla el lab? */
function canSend(): boolean {
  return controller && client?.connected() === true;
}

// ---------- Envío ----------

function sendFullProject(project: Project): void {
  if (!canSend()) return;
  client?.send({ type: 'project', mode: 'full', project: projectForLab(project), definitions: defs(project), settings: bridgeSettings(project) });
  lastProject = project;
}

function sendProjectChange(project: Project): void {
  const prev = lastProject;
  if (!prev) return sendFullProject(project);
  const patch = projectPatch(prev, project);
  if (!patch || patch.removedKeys.length > 0 || 'floors' in patch.changes || 'variants' in patch.changes) return sendFullProject(project);
  if (Object.keys(patch.changes).length === 0) return;
  const definitionsChanged = 'devices' in patch.changes || 'customDefinitions' in patch.changes;
  const changes = { ...patch.changes };
  if (changes.haBridge) changes.haBridge = bridgeSettings(project);
  client?.send({
    type: 'project',
    mode: 'patch',
    changes,
    ...(definitionsChanged ? { definitions: defs(project) } : {}),
    ...('haBridge' in patch.changes ? { settings: bridgeSettings(project) } : {}),
  });
  lastProject = project;
}

function availabilityKey(sim: SimulationState, live: boolean): string {
  return JSON.stringify([live, Object.keys(sim.offline ?? {}).sort(), sim.failureOffline ?? [], sim.batteries ?? {}]);
}

function flushState(full = false): void {
  stateTimer = undefined;
  if (!canSend() || !client) return;
  const { sim } = useSimulationStore.getState();
  const project = useProjectStore.getState().project;
  const live = useBridgeStore.getState().live;
  const key = availabilityKey(sim, live);
  const availability = key !== sentAvailabilityKey || full ? availabilityFromSim(project, sim, live) : undefined;
  if (full) {
    client.send({ type: 'state', full: true, entities: sim.entities, ...(availability ? { availability } : {}) });
  } else {
    const { changed, removed } = diffEntities(sentEntities, sim.entities);
    if (Object.keys(changed).length === 0 && removed.length === 0 && !availability) return;
    client.send({ type: 'state', entities: changed, ...(removed.length > 0 ? { removed } : {}), ...(availability ? { availability } : {}) });
  }
  sentEntities = sim.entities;
  sentAvailabilityKey = key;
}

function scheduleState(): void {
  if (stateTimer === undefined) stateTimer = setTimeout(() => flushState(), STATE_THROTTLE_MS);
}

// ---------- Modo en vivo ----------

/**
 * ¿Deben ejecutarse las automatizaciones fuera (en el HA del lab)? Solo con el lab conectado,
 * controlado desde esta app y en vivo: desacoplado, HA ve los dispositivos como no disponibles y
 * las automatizaciones vuelven al simulador.
 */
function automationsOutside(): boolean {
  const project = useProjectStore.getState().project;
  const b = useBridgeStore.getState();
  return localLab().enabled && bridgeSettings(project).automationsRunIn === 'home_assistant' && b.connection === 'connected' && b.live;
}

function syncAutomationsFlag(): void {
  const want = automationsOutside();
  const { sim } = useSimulationStore.getState();
  if ((sim.automationsExternal ?? false) === want) return;
  useSimulationStore.setState({ sim: { ...sim, automationsExternal: want } });
}

/** Acopla la simulación al lab: 1x, en marcha y con el reloj en la hora real. */
export function couple(): void {
  const store = useSimulationStore.getState();
  internalChange = true;
  try {
    if (store.speed !== 1) store.setSpeed(1);
    const target = simNowForProject(useProjectStore.getState().project, new Date());
    if (target > useSimulationStore.getState().sim.now + 1000) useSimulationStore.getState().jumpTo(target);
    if (!useSimulationStore.getState().running) useSimulationStore.getState().start();
  } finally {
    internalChange = false;
  }
  useBridgeStore.setState({ live: true, decoupledReason: undefined });
  if (nodesStoppedByPause && canSend()) {
    nodesStoppedByPause = false;
    client?.send({ type: 'node', action: 'start', deviceIds: 'all' });
  }
  syncAutomationsFlag();
  flushState();
}

function decouple(reason: string, quiet = false): void {
  if (!useBridgeStore.getState().live) return;
  useBridgeStore.setState({ live: false, decoupledReason: reason });
  if (!quiet) notify(`Laboratorio desacoplado: ${reason}. HA verá los dispositivos como no disponibles hasta que vuelvas a acoplar.`, 'error');
  syncAutomationsFlag();
  flushState();
}

/**
 * Pausa estando en vivo, ya confirmada por el usuario («¿Parar todos los nodos?»): para todos
 * los nodos (HA los ve no disponibles), pausa y desacopla. «Volver a acoplar» los arranca.
 */
export function pauseLive(): void {
  if (canSend()) {
    client?.send({ type: 'node', action: 'stop', deviceIds: 'all' });
    nodesStoppedByPause = true;
  }
  internalChange = true;
  try {
    useSimulationStore.getState().pause();
  } finally {
    internalChange = false;
  }
  decouple('se ha pausado la simulación y se han parado todos los nodos', true);
}

// ---------- Mensajes del orquestador ----------

function onHello(readOnly: boolean): void {
  if (readOnly) {
    controller = false;
    useBridgeStore.setState({ connection: 'readonly', live: false });
    syncAutomationsFlag();
    return;
  }
  controller = true;
  trafficSubscribed = false;
  sentEntities = {};
  sentAvailabilityKey = '';
  useBridgeStore.setState({ connection: 'connected', lastError: undefined });
  sendFullProject(useProjectStore.getState().project);
  couple();
  flushState(true);
  updateTrafficSubscription();
}

function onLabResult(msg: Extract<ServerMessage, { type: 'lab_result' }>): void {
  // Solo se aceptan respuestas a peticiones de esta app que sigan pendientes.
  if (!pending.delete(msg.requestId)) return;
  const busy = { ...useBridgeStore.getState().busy };
  if (busy[msg.action] === msg.requestId) delete busy[msg.action];
  useBridgeStore.setState({ busy, lastResult: { action: msg.action, ok: msg.ok, message: msg.message, at: Date.now() }, ...(msg.snapshots ? { snapshots: msg.snapshots } : {}) });
  if (msg.action === 'list_snapshots') return;
  notify(msg.message, msg.ok ? 'success' : 'error');
  if (!msg.ok) return;
  if (msg.action === 'reset') {
    // Estados iniciales del proyecto en el simulador y de nuevo en vivo.
    internalChange = true;
    try {
      useSimulationStore.getState().reset();
    } finally {
      internalChange = false;
    }
    couple();
    flushState(true);
  } else if (msg.action === 'restore' && msg.project) {
    applyRestoredProject(msg.project);
  }
}

/**
 * Proyecto de un snapshot: se valida con parseProject, se fusiona con el actual (conserva el id,
 * las variantes y las imágenes del plano) y se aplica sin reiniciar la simulación ni desacoplar.
 */
function applyRestoredProject(raw: unknown): void {
  let restored: Project;
  try {
    restored = parseProject(raw);
  } catch (err) {
    notify(`El proyecto del snapshot no es válido y no se ha aplicado: ${err instanceof Error ? err.message : String(err)}`, 'error');
    return;
  }
  const merged = mergeRestoredProject(useProjectStore.getState().project, restored);
  internalChange = true;
  try {
    useProjectStore.getState().replaceProject(merged);
  } finally {
    internalChange = false;
  }
  couple();
  flushState(true);
}

function onServerMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'hello':
      onHello(msg.readOnly);
      return;
    case 'status':
      useBridgeStore.setState({ status: msg, snapshots: msg.snapshots ?? useBridgeStore.getState().snapshots, ...(msg.lastError ? { lastError: msg.lastError } : {}) });
      return;
    case 'command': {
      if (!canSend()) return;
      // Desacoplado: HA ve los dispositivos como no disponibles y sus comandos se ignoran.
      if (!useBridgeStore.getState().live) {
        client?.send({ type: 'command_result', id: msg.id, ok: false, error: 'Laboratorio desacoplado: comando ignorado' });
        return;
      }
      try {
        useSimulationStore.getState().callService(msg.entityId, msg.service, msg.data);
        client?.send({ type: 'command_result', id: msg.id, ok: true });
      } catch (err) {
        client?.send({ type: 'command_result', id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
      scheduleState();
      return;
    }
    case 'traffic':
      useBridgeStore.getState().addTraffic(msg.entries);
      return;
    case 'lab_result':
      onLabResult(msg);
      return;
    case 'error':
      useBridgeStore.setState({ lastError: msg.message });
      if (msg.code === 'auth') {
        // Token ausente o incorrecto: no se reintenta hasta que se cambie en Ajustes → Laboratorio.
        client?.stop();
        client = undefined;
        controller = false;
        useBridgeStore.setState({ connection: 'unauthorized', live: false, status: undefined });
        syncAutomationsFlag();
      }
      return;
    default:
      return;
  }
}

function onClientStatus(status: ClientStatus): void {
  if (status === 'connected') {
    // El orquestador exige el token en el primer mensaje.
    useBridgeStore.setState({ connection: 'connecting' });
    client?.send({ type: 'hello', role: 'app', client: 'ha-simulator', token: localLab().token });
    return;
  }
  controller = false;
  if (useBridgeStore.getState().connection !== 'unauthorized') useBridgeStore.setState({ connection: localLab().enabled ? status : 'off' });
  useBridgeStore.setState({ live: false });
  syncAutomationsFlag();
}

// ---------- Ajustes ----------

let appliedKey = '';

function applySettings(): void {
  const s = localLab();
  if (!s.enabled) {
    // Lab desactivado por el usuario: el orquestador retira las automatizaciones que exportó.
    if (canSend()) client?.send({ type: 'goodbye' });
    stopClient();
    appliedKey = '';
    useBridgeStore.setState({ connection: 'off', live: false, status: undefined });
    syncAutomationsFlag();
    return;
  }
  const key = `${s.orchestratorUrl}\n${s.token}`;
  if (client && key === appliedKey) return;
  stopClient();
  appliedKey = key;
  if (s.token === '') {
    useBridgeStore.setState({ connection: 'unauthorized', live: false, lastError: 'Falta el token del laboratorio (Ajustes → Laboratorio)' });
    syncAutomationsFlag();
    return;
  }
  client = new BridgeClient({ url: s.orchestratorUrl, onMessage: onServerMessage, onStatus: onClientStatus, ...(socketFactory ? { factory: socketFactory } : {}) });
  client.start();
}

function stopClient(): void {
  const c = client;
  client = undefined;
  controller = false;
  lastProject = undefined;
  sentEntities = {};
  sentAvailabilityKey = '';
  c?.stop();
}

function updateTrafficSubscription(): void {
  const { panelOpen, panelTab } = useBridgeStore.getState();
  const want = panelOpen && panelTab === 'traffic';
  if (want === trafficSubscribed || !client?.connected()) return;
  if (client.send({ type: 'traffic', subscribe: want })) trafficSubscribed = want;
}

// ---------- Acciones públicas ----------

export function nodeAction(action: 'start' | 'stop', deviceIds: Id[] | 'all'): void {
  if (!canSend()) return;
  if (action === 'start' && deviceIds === 'all') nodesStoppedByPause = false;
  client?.send({ type: 'node', action, deviceIds });
}

export function labAction(action: LabAction, extra: { name?: string; id?: string; excludeCredentials?: boolean } = {}): boolean {
  if (!canSend() || !client) {
    notify(useBridgeStore.getState().connection === 'readonly' ? 'Solo lectura: otra app controla el laboratorio' : 'El laboratorio no está conectado', 'error');
    return false;
  }
  const requestId = `r${++requestSeq}`;
  pending.add(requestId);
  useBridgeStore.setState((s) => ({ busy: { ...s.busy, [action]: requestId } }));
  const ok = client.send({ type: 'lab', action, requestId, ...extra });
  if (!ok) pending.delete(requestId);
  return ok;
}

/** Arranca el puente. Devuelve la función para pararlo. `factory` solo para tests. */
export function startBridgeRuntime(factory?: SocketFactory): () => void {
  socketFactory = factory;
  const unsubProject = useProjectStore.subscribe((state, prev) => {
    if (state.project === prev.project) return;
    if (canSend()) {
      if (state.project.id !== prev.project.id) sendFullProject(state.project);
      else sendProjectChange(state.project);
    }
    syncAutomationsFlag();
  });
  const unsubSim = useSimulationStore.subscribe((state, prev) => {
    if (!canSend()) return;
    if (!internalChange && useBridgeStore.getState().live) {
      // Red de seguridad: la interfaz pregunta antes de pausar y no deja acelerar en vivo.
      if (state.speed !== 1 && prev.speed === 1) decouple('se ha cambiado la velocidad');
      else if (!state.running && prev.running) decouple('se ha pausado la simulación');
    }
    if (state.sim !== prev.sim) {
      if (state.sim.automationsExternal === undefined && automationsOutside()) syncAutomationsFlag();
      scheduleState();
    }
  });
  const unsubBridge = useBridgeStore.subscribe((state, prev) => {
    if (state.panelOpen !== prev.panelOpen || state.panelTab !== prev.panelTab) updateTrafficSubscription();
    if (state.live !== prev.live || state.connection !== prev.connection) syncAutomationsFlag();
  });
  const unsubLocal = useLocalLab.subscribe((state, prev) => {
    if (state.enabled !== prev.enabled || state.orchestratorUrl !== prev.orchestratorUrl || state.token !== prev.token) applySettings();
  });
  applySettings();
  return () => {
    unsubProject();
    unsubSim();
    unsubBridge();
    unsubLocal();
    if (stateTimer) clearTimeout(stateTimer);
    stateTimer = undefined;
    // Lab desactivado por el usuario: el orquestador retira las automatizaciones que exportó.
    if (!localLab().enabled && canSend()) client?.send({ type: 'goodbye' });
    stopClient();
    appliedKey = '';
    pending.clear();
    nodesStoppedByPause = false;
    useBridgeStore.setState({ connection: 'off', live: false, busy: {} });
    syncAutomationsFlag();
  };
}
