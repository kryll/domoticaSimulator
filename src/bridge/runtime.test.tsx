import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore, stopSimulationLoop } from '../store/simulationStore';
import { createDemoProject } from '../store/demoProject';
import { defaultHaBridgeSettings, type DeviceDefinition } from '../types';
import { couple, labAction, startBridgeRuntime } from './runtime';
import { useLocalLab } from './localLab';
import { pauseSimulation } from './liveControls';
import { useConfirmStore } from '../ui/confirm';
import { useBridgeStore } from './bridgeStore';
import type { SocketLike } from './bridgeClient';
import { DeviceBridgeLine } from './DeviceBridgeLine';
import { catalog } from '../devices/catalog';

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(public url: string) {}
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(msg: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify({ v: 1, ...msg }) });
  }
  ofType(type: string): Array<Record<string, unknown>> {
    return this.sent.filter((m) => m.type === type);
  }
}

let sockets: FakeSocket[] = [];
let stop: () => void;

const TOKEN = 'token-de-prueba-0123456789abcdef';

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
  localStorage.clear();
  useLocalLab.getState().update({ enabled: false, token: '', orchestratorUrl: 'ws://localhost:8080/orchestrator' });
  useBridgeStore.setState({ connection: 'off', live: false, status: undefined, busy: {}, snapshots: [] });
  const project = createDemoProject();
  useProjectStore.getState().loadProject(project);
  useSimulationStore.getState().reset(project);
  stop = startBridgeRuntime((url) => {
    const s = new FakeSocket(url);
    sockets.push(s);
    return s;
  });
});

afterEach(() => {
  stop();
  stopSimulationLoop();
  vi.useRealTimers();
});

/** Activa el lab en esta máquina, abre el socket y el orquestador acepta el token. */
function connect(readOnly = false): FakeSocket {
  act(() => useLocalLab.getState().update({ enabled: true, token: TOKEN }));
  const s = sockets.at(-1)!;
  act(() => s.open());
  act(() => s.receive({ type: 'hello', server: 'hasim-orchestrator', version: '0.2.0', protocol: 1, readOnly }));
  return s;
}

describe('puente con el laboratorio', () => {
  it('sin activar no conecta', () => {
    expect(sockets).toHaveLength(0);
    expect(useBridgeStore.getState().connection).toBe('off');
  });

  it('sin token no conecta y lo dice', () => {
    act(() => useLocalLab.getState().update({ enabled: true }));
    expect(sockets).toHaveLength(0);
    expect(useBridgeStore.getState().connection).toBe('unauthorized');
  });

  it('se presenta con el token y no manda nada hasta que el orquestador lo acepta', () => {
    act(() => useLocalLab.getState().update({ enabled: true, token: TOKEN }));
    const s = sockets.at(-1)!;
    act(() => s.open());
    expect(s.sent).toEqual([{ v: 1, type: 'hello', role: 'app', client: 'ha-simulator', token: TOKEN }]);
    expect(useBridgeStore.getState().connection).toBe('connecting');
    act(() => s.receive({ type: 'error', code: 'auth', message: 'Token del laboratorio no válido' }));
    expect(useBridgeStore.getState().connection).toBe('unauthorized');
    expect(s.ofType('project')).toHaveLength(0);
  });

  it('con otra app al mando queda en solo lectura y no manda el proyecto', () => {
    const s = connect(true);
    expect(useBridgeStore.getState().connection).toBe('readonly');
    expect(s.ofType('project')).toHaveLength(0);
    expect(useBridgeStore.getState().live).toBe(false);
    // Si la otra se va, el orquestador la promociona.
    act(() => s.receive({ type: 'hello', server: 'hasim-orchestrator', version: '0.2.0', protocol: 1, readOnly: false }));
    expect(useBridgeStore.getState().connection).toBe('connected');
    expect(s.ofType('project')).toHaveLength(1);
  });

  it('al conectar manda hello, el proyecto completo y el estado, y entra en modo en vivo', () => {
    const s = connect();
    expect(s.url).toBe('ws://localhost:8080/orchestrator');
    expect(s.ofType('hello')).toHaveLength(1);
    const project = s.ofType('project')[0]!;
    expect(project.mode).toBe('full');
    expect((project.definitions as unknown[]).length).toBeGreaterThan(5);
    const state = s.ofType('state').find((m) => m.full)!;
    expect(Object.keys(state.entities as object)).toContain('light.luz_salon');
    expect(useBridgeStore.getState().live).toBe(true);
    expect(useSimulationStore.getState().speed).toBe(1);
    expect(useSimulationStore.getState().running).toBe(true);
    // Automatizaciones en HA: el motor no las dispara.
    expect(useSimulationStore.getState().sim.automationsExternal).toBe(true);
  });

  it('aplica los comandos con callService y manda el estado resultante', () => {
    const s = connect();
    act(() => s.receive({ type: 'command', id: 'c1', entityId: 'light.luz_salon', service: 'light.turn_on', data: { brightness: 99 } }));
    expect(useSimulationStore.getState().sim.entities['light.luz_salon']?.state).toBe('on');
    expect(s.ofType('command_result')[0]).toMatchObject({ id: 'c1', ok: true });
    act(() => vi.advanceTimersByTime(150));
    const update = s.ofType('state').filter((m) => !m.full).find((m) => 'light.luz_salon' in (m.entities as object));
    expect(update).toBeDefined();
  });

  it('pausar en vivo pregunta «¿Parar todos los nodos?»; al aceptar para los nodos y desacopla', async () => {
    const s = connect();
    let paused: Promise<boolean> | undefined;
    act(() => {
      paused = pauseSimulation();
    });
    const ask = useConfirmStore.getState().queue.at(-1)!;
    expect(ask.title).toBe('¿Parar todos los nodos?');
    expect(useSimulationStore.getState().running).toBe(true);
    await act(async () => {
      ask.resolve(true);
      useConfirmStore.setState({ queue: [] });
      await paused;
    });
    expect(useSimulationStore.getState().running).toBe(false);
    expect(useBridgeStore.getState().live).toBe(false);
    expect(s.ofType('node').at(-1)).toMatchObject({ action: 'stop', deviceIds: 'all' });
    // Desacoplado: las automatizaciones vuelven al simulador y los comandos de HA se ignoran.
    expect(useSimulationStore.getState().sim.automationsExternal).toBe(false);
    act(() => s.receive({ type: 'command', id: 'c9', entityId: 'light.luz_salon', service: 'light.turn_on', data: {} }));
    expect(useSimulationStore.getState().sim.entities['light.luz_salon']?.state).toBe('off');
    expect(s.ofType('command_result').at(-1)).toMatchObject({ id: 'c9', ok: false });
    act(() => vi.advanceTimersByTime(150));
    const last = s.ofType('state').at(-1)!;
    expect((last.availability as { live: boolean }).live).toBe(false);
    // Volver a acoplar arranca los nodos.
    act(() => couple());
    expect(useBridgeStore.getState().live).toBe(true);
    expect(s.ofType('node').at(-1)).toMatchObject({ action: 'start', deviceIds: 'all' });
    expect(useSimulationStore.getState().sim.automationsExternal).toBe(true);
  });

  it('pausar en vivo y cancelar no hace nada', async () => {
    connect();
    let paused: Promise<boolean> | undefined;
    act(() => {
      paused = pauseSimulation();
    });
    await act(async () => {
      useConfirmStore.getState().queue.at(-1)!.resolve(false);
      useConfirmStore.setState({ queue: [] });
      await paused;
    });
    expect(useSimulationStore.getState().running).toBe(true);
    expect(useBridgeStore.getState().live).toBe(true);
  });

  it('manda parches del proyecto al cambiar un dispositivo', () => {
    const s = connect();
    act(() => useProjectStore.getState().updateDevice('demo-cafetera', { name: 'Cafetera nueva' }));
    const patch = s.ofType('project').find((m) => m.mode === 'patch')!;
    expect(Object.keys(patch.changes as object)).toContain('devices');
  });

  it('reset del lab vuelve a los estados iniciales', () => {
    const s = connect();
    act(() => useSimulationStore.getState().callService('light.luz_salon', 'light.turn_on'));
    act(() => {
      labAction('reset');
    });
    const requestId = s.ofType('lab').at(-1)!.requestId as string;
    act(() => s.receive({ type: 'lab_result', requestId, action: 'reset', ok: true, message: 'ok' }));
    expect(useSimulationStore.getState().sim.entities['light.luz_salon']?.state).toBe('off');
    expect(useBridgeStore.getState().live).toBe(true);
  });

  it('guarda el estado de los nodos y el tráfico', () => {
    const s = connect();
    act(() => s.receive({ type: 'status', mqtt: 'connected', ha: 'online', transports: {}, nodes: { 'demo-cafetera': 'stopped' } }));
    expect(useBridgeStore.getState().status?.nodes['demo-cafetera']).toBe('stopped');
    act(() => useBridgeStore.getState().setPanel(true, 'traffic'));
    expect(s.ofType('traffic').at(-1)).toMatchObject({ subscribe: true });
    act(() => s.receive({ type: 'traffic', entries: [{ seq: 1, t: 0, dir: 'out', topic: 'hasim/x', payload: 'y', retain: false }] }));
    expect(useBridgeStore.getState().traffic).toHaveLength(1);
    act(() => useBridgeStore.getState().setPanel(false));
    expect(s.ofType('traffic').at(-1)).toMatchObject({ subscribe: false });
  });

  it('solo acepta lab_result de peticiones pendientes', () => {
    const s = connect();
    act(() => useSimulationStore.getState().callService('light.luz_salon', 'light.turn_on'));
    act(() => s.receive({ type: 'lab_result', requestId: 'r999', action: 'reset', ok: true, message: 'ok' }));
    expect(useSimulationStore.getState().sim.entities['light.luz_salon']?.state).toBe('on');
    const before = useProjectStore.getState().project;
    act(() => s.receive({ type: 'lab_result', requestId: 'r998', action: 'restore', ok: true, message: 'ok', project: { ...before, name: 'Inyectado' } }));
    expect(useProjectStore.getState().project.name).toBe(before.name);
  });

  it('restaurar valida el proyecto, lo fusiona y sigue en vivo sin reiniciar la simulación', () => {
    const s = connect();
    act(() => useSimulationStore.getState().callService('light.luz_salon', 'light.turn_on'));
    const current = useProjectStore.getState().project;
    act(() => {
      labAction('restore', { id: 'snap-1' });
    });
    const requestId = s.ofType('lab').at(-1)!.requestId as string;
    // Un proyecto no válido no se aplica.
    act(() => s.receive({ type: 'lab_result', requestId, action: 'restore', ok: true, message: 'ok', project: { id: 'x' } }));
    expect(useProjectStore.getState().project).toBe(current);
    act(() => {
      labAction('restore', { id: 'snap-1' });
    });
    const second = s.ofType('lab').at(-1)!.requestId as string;
    act(() => s.receive({ type: 'lab_result', requestId: second, action: 'restore', ok: true, message: 'ok', project: { ...current, id: 'otro-id', name: 'Del snapshot' } }));
    const after = useProjectStore.getState().project;
    expect(after.name).toBe('Del snapshot');
    expect(after.id).toBe(current.id);
    expect(useBridgeStore.getState().live).toBe(true);
    expect(useSimulationStore.getState().running).toBe(true);
    expect(useSimulationStore.getState().sim.entities['light.luz_salon']?.state).toBe('on');
  });

  it('manda los dispositivos personalizados con su definición', () => {
    const s = connect();
    const base = catalog.find((d) => d.id === useProjectStore.getState().project.devices.find((x) => x.id === 'demo-cafetera')!.definitionId)!;
    const custom: DeviceDefinition = { ...base, id: 'custom:enchufe-raro', name: 'Enchufe raro' };
    act(() =>
      useProjectStore.getState().update((p) => ({
        ...p,
        customDefinitions: [custom],
        devices: p.devices.map((d) => (d.id === 'demo-cafetera' ? { ...d, definitionId: custom.id } : d)),
      })),
    );
    const patch = s.ofType('project').filter((m) => m.mode === 'patch').at(-1)!;
    expect((patch.definitions as DeviceDefinition[]).map((d) => d.id)).toContain('custom:enchufe-raro');
  });

  it('pasar las automatizaciones al simulador manda los ajustes nuevos', () => {
    const s = connect();
    act(() => useProjectStore.getState().update((p) => ({ ...p, haBridge: { ...defaultHaBridgeSettings(), automationsRunIn: 'simulator' } })));
    const patch = s.ofType('project').filter((m) => m.mode === 'patch').at(-1)!;
    expect(patch.settings).toEqual({ ...defaultHaBridgeSettings(), automationsRunIn: 'simulator' });
    expect(useSimulationStore.getState().sim.automationsExternal).toBe(false);
  });

  it('desactivar el lab se despide (retira las automatizaciones), corta y devuelve las automatizaciones al simulador', () => {
    const s = connect();
    act(() => useLocalLab.getState().update({ enabled: false }));
    expect(s.ofType('goodbye')).toHaveLength(1);
    expect(useBridgeStore.getState().connection).toBe('off');
    expect(useSimulationStore.getState().sim.automationsExternal).toBe(false);
  });

  it('el proyecto no lleva nada del lab local (URL ni token)', () => {
    const s = connect();
    const sent = JSON.stringify(s.ofType('project')[0]);
    expect(sent).not.toContain(TOKEN);
    expect(JSON.stringify(useProjectStore.getState().project)).not.toContain(TOKEN);
  });

  it('las propiedades del dispositivo muestran la vía hacia HA', () => {
    act(() => useLocalLab.getState().update({ enabled: true, token: TOKEN }));
    const device = useProjectStore.getState().project.devices.find((d) => d.id === 'demo-cerradura')!;
    const def = catalog.find((d) => d.id === device.definitionId);
    render(<DeviceBridgeLine device={device} def={def} />);
    expect(screen.getByText(/Vía hacia HA/)).toBeInTheDocument();
    expect(screen.getByText('Radio: modelada, no real')).toBeInTheDocument();
  });
});

describe('panel del laboratorio', () => {
  it('se abre con el lab desactivado sin bucles y ofrece configurarlo', async () => {
    const { LabPanel } = await import('./LabPanel');
    act(() => useLocalLab.getState().update({ enabled: false }));
    render(<LabPanel top={48} />);
    expect(screen.getByRole('button', { name: 'Configurar el laboratorio…' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Laboratorio' })).toHaveStyle({ top: '48px' });
    act(() => screen.getByRole('button', { name: 'Plegar el laboratorio' }).click());
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    act(() => screen.getByRole('button', { name: 'Desplegar el laboratorio' }).click());
    act(() => screen.getByRole('tab', { name: 'Nodos' }).click());
    expect(screen.getByRole('list', { name: 'Nodos del laboratorio' })).toBeInTheDocument();
  });
});
