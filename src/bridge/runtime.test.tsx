import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore, stopSimulationLoop } from '../store/simulationStore';
import { createDemoProject } from '../store/demoProject';
import { defaultHaBridgeSettings, type Project } from '../types';
import { startBridgeRuntime } from './runtime';
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

function withBridge(p: Project): Project {
  return { ...p, haBridge: { ...defaultHaBridgeSettings(), enabled: true } };
}

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
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

function connect(): FakeSocket {
  act(() => useProjectStore.getState().update((p) => withBridge(p)));
  const s = sockets.at(-1)!;
  act(() => s.open());
  return s;
}

describe('puente con el laboratorio', () => {
  it('sin activar no conecta', () => {
    expect(sockets).toHaveLength(0);
    expect(useBridgeStore.getState().connection).toBe('off');
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

  it('pausar desacopla el puente y lo avisa; volver a acoplar', () => {
    const s = connect();
    act(() => useSimulationStore.getState().pause());
    expect(useBridgeStore.getState().live).toBe(false);
    act(() => vi.advanceTimersByTime(150));
    const last = s.ofType('state').at(-1)!;
    expect((last.availability as { live: boolean }).live).toBe(false);
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
    act(() => s.receive({ type: 'lab_result', requestId: 'r1', action: 'reset', ok: true, message: 'ok' }));
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

  it('desactivar el lab corta la conexión y devuelve las automatizaciones al simulador', () => {
    connect();
    act(() => useProjectStore.getState().update((p) => ({ ...p, haBridge: { ...defaultHaBridgeSettings(), enabled: false } })));
    expect(useBridgeStore.getState().connection).toBe('off');
    expect(useSimulationStore.getState().sim.automationsExternal).toBe(false);
  });

  it('las propiedades del dispositivo muestran la vía hacia HA', () => {
    act(() => useProjectStore.getState().update((p) => withBridge(p)));
    const device = useProjectStore.getState().project.devices.find((d) => d.id === 'demo-cerradura')!;
    const def = catalog.find((d) => d.id === device.definitionId);
    render(<DeviceBridgeLine device={device} def={def} />);
    expect(screen.getByText(/Vía hacia HA/)).toBeInTheDocument();
    expect(screen.getByText('Radio: modelada, no real')).toBeInTheDocument();
  });
});
