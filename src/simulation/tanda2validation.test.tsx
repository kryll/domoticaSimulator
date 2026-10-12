import '../test/flowMocks';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlowProvider } from '@xyflow/react';
import { ValidationPanel } from './ValidationPanel';
import { CatalogPanel } from '../catalog/CatalogPanel';
import { useProjectStore } from '../store/projectStore';
import { primarySelection, useUiStore } from '../store/uiStore';
import { makeDevice, makeProject } from '../test/fixtures';
import { pointInPolygon } from '../canvas/geometry';
import type { Room } from '../types';

const room = (id: string, name: string, x: number, y: number, w = 600, h = 400): Room => ({
  id,
  floorId: 'f1',
  name,
  polygon: [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ],
});

describe('validación con arreglos rápidos', () => {
  beforeEach(() => {
    useUiStore.getState().reset();
    useProjectStore.getState().loadProject(
      makeProject({
        rooms: [room('r1', 'Salón', 0, 0), room('r2', 'Cocina', 800, 0)],
        devices: [makeDevice('shelly-1pm-gen3', 'd1', 100, 100, 'Enchufe')],
      }),
    );
  });

  it('cada incidencia muestra su título legible (el código solo en el tooltip)', () => {
    render(<ValidationPanel />);
    const item = document.querySelector('[data-code="sin-servidor-ha"]') as HTMLElement;
    expect(within(item).getByText('Falta el servidor de Home Assistant')).toBeInTheDocument();
    expect(within(item).queryByText('sin-servidor-ha')).toBeNull();
    expect(within(item).getByRole('button', { name: /Falta el servidor/ })).toHaveAttribute('title', 'Código: sin-servidor-ha');
  });

  it('aplicar un arreglo añade el equipo en la última sala dibujada, lo selecciona y se puede deshacer', async () => {
    render(<ValidationPanel />);
    const item = document.querySelector('[data-code="sin-servidor-ha"]') as HTMLElement;
    const group = within(item).getByRole('group', { name: /Arreglos rápidos/ });
    await userEvent.click(within(group).getByRole('button', { name: /Añadir Home Assistant Green/ }));
    const { devices, rooms } = useProjectStore.getState().project;
    const server = devices.find((d) => d.definitionId === 'ha-green');
    expect(server).toBeDefined();
    // Sin sala seleccionada: la última dibujada (Cocina), dentro de su polígono.
    expect(server?.roomId).toBe('r2');
    expect(pointInPolygon(server!.position, rooms[1]!.polygon)).toBe(true);
    expect(primarySelection(useUiStore.getState())).toEqual({ kind: 'device', id: server?.id });
    expect(useUiStore.getState().notice?.text).toMatch(/Arreglo aplicado/);
    act(() => useProjectStore.getState().undo());
    expect(useProjectStore.getState().project.devices.some((d) => d.definitionId === 'ha-green')).toBe(false);
  });

  it('con una sala seleccionada, el arreglo coloca el equipo dentro de ella', async () => {
    act(() => useUiStore.getState().select({ kind: 'room', id: 'r1' }));
    render(<ValidationPanel />);
    const item = document.querySelector('[data-code="sin-servidor-ha"]') as HTMLElement;
    await userEvent.click(within(item).getByRole('button', { name: /Añadir Home Assistant Green/ }));
    const server = useProjectStore.getState().project.devices.find((d) => d.definitionId === 'ha-green');
    expect(server?.roomId).toBe('r1');
  });
});

describe('colocación al añadir desde el catálogo', () => {
  beforeEach(() => {
    useUiStore.getState().reset();
    useProjectStore.getState().loadProject(makeProject({ rooms: [room('r1', 'Salón', 0, 0), room('r2', 'Cocina', 800, 0)] }));
    useUiStore.getState().setActiveFloor('f1');
  });

  const addFirst = async (query: string) => {
    await userEvent.clear(screen.getByLabelText('Buscar dispositivo'));
    await userEvent.type(screen.getByLabelText('Buscar dispositivo'), query);
    const results = screen.getByRole('list', { name: 'Resultados del catálogo' });
    const add = within(results).getAllByRole('button', { name: /^Añadir .* al lienzo$/ })[0];
    if (!add) throw new Error('sin resultados');
    await userEvent.click(add);
  };

  it('«+» coloca en la sala seleccionada, sin solaparse, y asigna la sala', async () => {
    render(
      <ReactFlowProvider>
        <CatalogPanel />
      </ReactFlowProvider>,
    );
    act(() => useUiStore.getState().select({ kind: 'room', id: 'r1' }));
    await addFirst('SNZB-03P');
    await addFirst('SNZB-03P');
    const devices = useProjectStore.getState().project.devices;
    expect(devices).toHaveLength(2);
    expect(devices.every((d) => d.roomId === 'r1')).toBe(true);
    const [a, b] = devices;
    expect(Math.abs(a!.position.x - b!.position.x) >= 180 || Math.abs(a!.position.y - b!.position.y) >= 70).toBe(true);
  });

  it('sin selección usa la última sala dibujada', async () => {
    render(
      <ReactFlowProvider>
        <CatalogPanel />
      </ReactFlowProvider>,
    );
    await addFirst('SNZB-03P');
    expect(useProjectStore.getState().project.devices[0]?.roomId).toBe('r2');
  });
});
