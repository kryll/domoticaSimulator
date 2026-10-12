import './../test/flowMocks';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { useProjectStore } from '../store/projectStore';
import { stopSimulationLoop, useSimulationStore } from '../store/simulationStore';
import { useUiStore } from '../store/uiStore';
import { makeDevice, makeProject } from '../test/fixtures';

const LIGHT = 'light.luz_salon';
const node = (id: string) => screen.getByTestId(`device-node-${id}`);
const state = (id: string) => useSimulationStore.getState().sim.entities[id];

function setup() {
  const project = makeProject({
    devices: [
      makeDevice('hue-white-color-e27', 'luz', 100, 100, 'Luz salón'),
      makeDevice('aqara-motion-p1', 'mov', 400, 100, 'Movimiento'),
      makeDevice('shelly-2pm-gen3-cover', 'per', 100, 300, 'Persiana'),
    ],
  });
  useUiStore.getState().reset();
  useProjectStore.getState().loadProject(project);
  useSimulationStore.getState().reset(project);
  useUiStore.getState().setActiveFloor('f1');
  render(<App autoLoad={false} />);
}

describe('interacción directa en el lienzo', () => {
  beforeEach(setup);
  afterEach(() => stopSimulationLoop());

  it('en modo Uso un clic ejecuta la acción principal y Mayús+clic selecciona', async () => {
    fireEvent.keyDown(document.body, { key: 'u' });
    expect(useUiStore.getState().canvasMode).toBe('interact');
    expect(screen.getByRole('button', { name: 'Uso' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(node('luz'));
    await waitFor(() => expect(state(LIGHT)?.state).toBe('on'));
    expect(useUiStore.getState().selection).toBeNull();

    fireEvent.click(node('luz'), { shiftKey: true });
    expect(useUiStore.getState().selection).toEqual({ kind: 'device', id: 'luz' });
    // Mayús+clic no cambia el estado
    await new Promise((r) => setTimeout(r, 300));
    expect(state(LIGHT)?.state).toBe('on');
  });

  it('en Edición el clic selecciona y el botón ⏻ ejecuta la acción principal', async () => {
    fireEvent.click(node('luz'));
    expect(useUiStore.getState().selection).toEqual({ kind: 'device', id: 'luz' });
    expect(state(LIGHT)?.state).toBe('off');
    await userEvent.click(within(node('luz')).getByRole('button', { name: /Encender Luz salón/ }));
    expect(state(LIGHT)?.state).toBe('on');
    fireEvent.click(node('luz'), { altKey: true });
    expect(state(LIGHT)?.state).toBe('off');
  });

  it('el doble clic abre el popover y su deslizador cambia el brillo', async () => {
    act(() => useSimulationStore.getState().callService(LIGHT, 'turn_on', { brightness_pct: 100 }));
    fireEvent.doubleClick(node('luz'));
    const dialog = await screen.findByRole('dialog', { name: 'Control de Luz salón' });
    const slider = within(dialog).getByRole('slider', { name: 'Brillo' });
    expect(slider).toHaveValue('100');
    expect(within(dialog).getByText('100 %')).toBeInTheDocument();
    fireEvent.change(slider, { target: { value: '40' } });
    expect(state(LIGHT)?.attributes?.brightness).toBe(102);
    expect(within(node('luz')).getByTestId('node-summary')).toHaveTextContent('40 %');
    fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Cerrar control' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Control de Luz salón' })).not.toBeInTheDocument();
  });

  it('el menú contextual ofrece acciones y crea una automatización con el dispositivo', async () => {
    fireEvent.contextMenu(node('mov'), { clientX: 50, clientY: 50 });
    const menu = screen.getByRole('menu', { name: 'Acciones de Movimiento' });
    const items = within(menu)
      .getAllByRole('menuitem')
      .map((i) => i.textContent);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Simular movimiento'),
        'Crear automatización con este dispositivo',
        'Simular sin conexión',
        'Duplicar',
        'Conectar desde aquí',
        expect.stringContaining('Eliminar'),
      ]),
    );
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Crear automatización con este dispositivo' }));
    const [auto] = useProjectStore.getState().project.automations;
    expect(auto?.triggers[0]).toMatchObject({ type: 'state', entityId: 'binary_sensor.movimiento_motion', to: 'on' });
    expect(useUiStore.getState().bottomTab).toBe('automations');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('«Simular sin conexión» deja el nodo como no disponible', async () => {
    fireEvent.contextMenu(node('luz'), { clientX: 50, clientY: 50 });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Simular sin conexión' }));
    expect(within(node('luz')).getByText('no disponible')).toBeInTheDocument();
    fireEvent.contextMenu(node('luz'), { clientX: 50, clientY: 50 });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Reconectar' }));
    expect(within(node('luz')).queryByText('no disponible')).not.toBeInTheDocument();
  });

  it('la rueda ajusta el brillo: en Uso sin modificador, en Edición solo con Mayús', () => {
    act(() => useSimulationStore.getState().callService(LIGHT, 'turn_on', { brightness_pct: 50 }));
    fireEvent.wheel(node('luz'), { deltaY: 100 });
    expect(state(LIGHT)?.attributes?.brightness).toBe(128);
    fireEvent.wheel(node('luz'), { deltaY: -100, shiftKey: true });
    expect(state(LIGHT)?.attributes?.brightness).toBe(153);
  });

  it('el teclado actúa sobre el dispositivo seleccionado', () => {
    fireEvent.click(node('luz'));
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(state(LIGHT)?.state).toBe('on');
    fireEvent.keyDown(document.body, { key: '5' });
    expect(state(LIGHT)?.attributes?.brightness).toBe(128);
    fireEvent.keyDown(document.body, { key: 'ArrowUp' });
    expect(state(LIGHT)?.attributes?.brightness).toBe(153);
    fireEvent.keyDown(document.body, { key: '0' });
    expect(state(LIGHT)?.state).toBe('off');
  });

  it('ignora los atajos con el foco en un campo de texto', async () => {
    const search = screen.getByLabelText('Buscar dispositivo');
    await userEvent.type(search, 'u');
    expect(useUiStore.getState().canvasMode).toBe('select');
  });

  it('la tecla ? abre la ayuda de atajos', () => {
    fireEvent.keyDown(document.body, { key: '?' });
    expect(screen.getByRole('dialog', { name: 'Atajos de teclado y ratón' })).toBeInTheDocument();
  });

  it('el pulso de movimiento muestra la cuenta atrás', () => {
    act(() => useSimulationStore.getState().quickAction('mov'));
    expect(within(node('mov')).getByTestId('node-summary')).toHaveTextContent('movimiento');
    expect(within(node('mov')).getByText(/⏱/)).toBeInTheDocument();
  });
});
