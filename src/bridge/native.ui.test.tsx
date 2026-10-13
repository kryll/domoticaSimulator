import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DeviceBridgeLine } from './DeviceBridgeLine';
import { NativeStatusList } from './NativeStatus';
import { useBridgeStore } from './bridgeStore';
import { useLocalLab } from './localLab';
import { catalog } from '../devices/catalog';
import type { Device } from '../types';
import type { StatusMessage } from './protocol';

const plug: Device = { id: 'zw', definitionId: 'fibaro-wall-plug', name: 'Enchufe despacho', floorId: 'f', position: { x: 0, y: 0 }, protocol: 'zwave', integration: 'zwave_js' };
const def = catalog.find((d) => d.id === 'fibaro-wall-plug');

const status = (zwave: boolean): StatusMessage => ({
  v: 1,
  type: 'status',
  mqtt: 'connected',
  ha: 'online',
  transports: {},
  nodes: { zw: 'running' },
  capabilities: { snapshots: true, docker: false, haToken: true, zwave, esphome: false },
  ...(zwave
    ? { native: { zwave_js: { state: 'connected', detail: 'Z-Wave JS UI conectado · 1 nodos', url: 'http://localhost:8091', nodes: { zw: { state: 'running', detail: 'nodo 7 · listo' } } } } }
    : {}),
});

afterEach(() => {
  cleanup();
  useBridgeStore.setState({ status: undefined });
  useLocalLab.setState({ enabled: false });
});

describe('vías reales en la interfaz del laboratorio', () => {
  it('con el perfil zwave: «Z-Wave JS (mock)», detalle del nodo y enlace a Z-Wave JS UI', () => {
    useLocalLab.setState({ enabled: true });
    useBridgeStore.setState({ status: status(true) });
    render(
      <>
        <DeviceBridgeLine device={plug} def={def} />
        <NativeStatusList />
      </>,
    );
    expect(screen.getByText(/Z-Wave JS \(mock\)$/)).toBeTruthy();
    expect(screen.getByText(/nodo 7 · listo/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Abrir Z-Wave JS UI' }).getAttribute('href')).toBe('http://localhost:8091');
  });

  it('sin el perfil: sigue por MQTT con el aviso', () => {
    useLocalLab.setState({ enabled: true });
    useBridgeStore.setState({ status: status(false) });
    render(<DeviceBridgeLine device={plug} def={def} />);
    expect(screen.getByText(/no disponible: ahora MQTT discovery genérico/)).toBeTruthy();
    expect(screen.getByText(/setup\.sh --zwave/)).toBeTruthy();
  });
});
