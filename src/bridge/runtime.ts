// Puente de la app con el laboratorio, fuera de React: se suscribe a los stores del proyecto y
// de la simulación (sin repintar el lienzo), manda el proyecto y los cambios de estado al
// orquestador y aplica con callService los comandos que llegan de HA.
import type { Id, Project, SimulationState } from '../types';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { useUiStore } from '../store/uiStore';
import { catalog, getDefinition } from '../devices/catalog';
import { simNowForProject } from '../simulation/clock';
import { BridgeClient, type ClientStatus, type SocketFactory } from './bridgeClient';
import { useBridgeStore } from './bridgeStore';
import { bridgeSettings } from './mqtt/model';
import { availabilityFromSim } from './mqtt/availability';
import { definitionsFor, diffEntities, projectForLab, projectPatch } from './sync';
import type { LabAction, ServerMessage } from './protocol';

/** Retardo para agrupar cambios de estado antes de mandarlos. */
const STATE_THROTTLE_MS = 100;

let client: BridgeClient | undefined;
let socketFactory: SocketFactory | undefined;
let sentEntities: SimulationState['entities'] = {};
let sentAvailabilityKey = '';
let lastProject: Project | undefined;
let stateTimer: ReturnType<typeof setTimeout> | undefined;
/** Operaciones internas que pausan la simulación sin desacoplar (reset del lab). */
let internalChange = false;
let requestSeq = 0;
let trafficSubscribed = false;

function defs(project: Project) {
  return definitionsFor(project, (id) => getDefinition(id, catalog));
}

function settingsOf(project: Project) {
  return bridgeSettings(project);
}

function notify(text: string, kind: 'info' | 'success' | 'error' = 'info'): void {
  useUiStore.getState().notify(text, kind);
}

// ---------- Envío ----------

function sendFullProject(project: Project): void {
  client?.send({ type: 'project', mode: 'full', project: projectForLab(project), definitions: defs(project), settings: settingsOf(project) });
  lastProject = project;
}

function sendProjectChange(project: Project): void {
  const prev = lastProject;
  if (!prev) return sendFullProject(project);
  const patch = projectPatch(prev, project);
  if (!patch || patch.removedKeys.length > 0 || 'floors' in patch.changes || 'variants' in patch.changes) return sendFullProject(project);
  if (Object.keys(patch.changes).length === 0) return;
  const devicesChanged = 'devices' in patch.changes;
  client?.send({
    type: 'project',
    mode: 'patch',
    changes: patch.changes,
    ...(devicesChanged ? { definitions: defs(project) } : {}),
    ...('haBridge' in patch.changes ? { settings: settingsOf(project) } : {}),
  });
  lastProject = project;
}

function availabilityKey(sim: SimulationState, live: boolean): string {
  return JSON.stringify([live, Object.keys(sim.offline ?? {}).sort(), sim.failureOffline ?? [], sim.batteries ?? {}]);
}

function flushState(full = false): void {
  stateTimer = undefined;
  if (!client?.connected()) return;
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

/** ¿Deben ejecutarse las automatizaciones fuera (en el HA del lab)? */
function automationsOutside(): boolean {
  const project = useProjectStore.getState().project;
  const s = settingsOf(project);
  return s.enabled && s.automationsRunIn === 'home_assistant' && useBridgeStore.getState().connection === 'connected';
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
  syncAutomationsFlag();
  flushState();
}

function decouple(reason: string): void {
  if (!useBridgeStore.getState().live) return;
  useBridgeStore.setState({ live: false, decoupledReason: reason });
  notify(`Laboratorio desacoplado: ${reason}. HA verá los dispositivos como no disponibles hasta que vuelvas a acoplar.`, 'error');
  flushState();
}

// ---------- Mensajes del orquestador ----------

function onServerMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'hello':
      return;
    case 'status':
      useBridgeStore.setState({ status: msg, snapshots: msg.snapshots ?? useBridgeStore.getState().snapshots, ...(msg.lastError ? { lastError: msg.lastError } : {}) });
      return;
    case 'command': {
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
    case 'lab_result': {
      const busy = { ...useBridgeStore.getState().busy };
      delete busy[msg.action];
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
        useProjectStore.getState().replaceProject(msg.project);
      }
      return;
    }
    case 'error':
      useBridgeStore.setState({ lastError: msg.message });
      return;
    default:
      return;
  }
}

function onClientStatus(status: ClientStatus): void {
  const enabled = settingsOf(useProjectStore.getState().project).enabled;
  useBridgeStore.setState({ connection: enabled ? status : 'off' });
  if (status === 'connected') {
    trafficSubscribed = false;
    client?.send({ type: 'hello', role: 'app', client: 'ha-simulator' });
    sendFullProject(useProjectStore.getState().project);
    couple();
    flushState(true);
    updateTrafficSubscription();
  } else {
    useBridgeStore.setState({ live: false });
  }
  syncAutomationsFlag();
}

// ---------- Ajustes ----------

function applySettings(project: Project): void {
  const s = settingsOf(project);
  if (!s.enabled) {
    if (client) {
      client.stop();
      client = undefined;
    }
    useBridgeStore.setState({ connection: 'off', live: false, status: undefined });
    syncAutomationsFlag();
    return;
  }
  if (client && client.url === s.orchestratorUrl) return;
  client?.stop();
  client = new BridgeClient({ url: s.orchestratorUrl, onMessage: onServerMessage, onStatus: onClientStatus, ...(socketFactory ? { factory: socketFactory } : {}) });
  client.start();
}

function updateTrafficSubscription(): void {
  const { panelOpen, panelTab } = useBridgeStore.getState();
  const want = panelOpen && panelTab === 'traffic';
  if (want === trafficSubscribed || !client?.connected()) return;
  if (client.send({ type: 'traffic', subscribe: want })) trafficSubscribed = want;
}

// ---------- Acciones públicas ----------

export function nodeAction(action: 'start' | 'stop', deviceIds: Id[] | 'all'): void {
  client?.send({ type: 'node', action, deviceIds });
}

export function labAction(action: LabAction, extra: { name?: string; id?: string } = {}): boolean {
  if (!client?.connected()) {
    notify('El laboratorio no está conectado', 'error');
    return false;
  }
  const requestId = `r${++requestSeq}`;
  useBridgeStore.setState((s) => ({ busy: { ...s.busy, [action]: requestId } }));
  return client.send({ type: 'lab', action, requestId, ...extra });
}

/** Arranca el puente. Devuelve la función para pararlo. `factory` solo para tests. */
export function startBridgeRuntime(factory?: SocketFactory): () => void {
  socketFactory = factory;
  const unsubProject = useProjectStore.subscribe((state, prev) => {
    if (state.project === prev.project) return;
    const before = settingsOf(prev.project);
    const after = settingsOf(state.project);
    if (before.enabled !== after.enabled || before.orchestratorUrl !== after.orchestratorUrl || state.project.id !== prev.project.id) {
      applySettings(state.project);
    }
    if (client?.connected()) {
      if (state.project.id !== prev.project.id) sendFullProject(state.project);
      else sendProjectChange(state.project);
    }
    syncAutomationsFlag();
  });
  const unsubSim = useSimulationStore.subscribe((state, prev) => {
    if (!client?.connected()) return;
    if (!internalChange && useBridgeStore.getState().live) {
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
  });
  applySettings(useProjectStore.getState().project);
  return () => {
    unsubProject();
    unsubSim();
    unsubBridge();
    if (stateTimer) clearTimeout(stateTimer);
    stateTimer = undefined;
    client?.stop();
    client = undefined;
    lastProject = undefined;
    sentEntities = {};
    sentAvailabilityKey = '';
    useBridgeStore.setState({ connection: 'off', live: false });
    syncAutomationsFlag();
  };
}
