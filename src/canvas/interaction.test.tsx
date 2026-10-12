import './../test/flowMocks';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { useProjectStore } from '../store/projectStore';
import { stopSimulationLoop, useSimulationStore } from '../store/simulationStore';
import { useUiStore } from '../store/uiStore';
import { makeDevice, makeProject } from '../test/fixtures';
import { setHoveredDevice } from './useCanvasKeyboard';

const LIGHT = 'light.luz_salon';
const node = (id: string) => screen.getByTestId(`device-node-${id}`);
const state = (id: string) => useSimulationStore.getState().sim.entities[id];

async function setup() {
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
  setHoveredDevice(null);
  render(<App autoLoad={false} />);
  // Espera al arranque de la app (fija la planta activa) dentro de act.
  await act(async () => {});
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
    await act(() => new Promise((r) => setTimeout(r, 300)));
    expect(state(LIGHT)?.state).toBe('on');
  });

  it('en Edición el clic selecciona y el botón ⏻ ejecuta la acción principal', async () => {
    fireEvent.click(node('luz'));
    expect(useUiStore.getState().selection).toEqual({ kind: 'device', id: 'luz' });
    expect(state(LIGHT)?.state).toBe('off');
    await userEvent.click(within(node('luz')).getByLabelText('Encender Luz salón'));
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

  it('la tecla ? abre la ayuda de atajos', async () => {
    fireEvent.keyDown(document.body, { key: '?' });
    expect(await screen.findByRole('dialog', { name: 'Atajos de teclado y ratón' })).toBeInTheDocument();
  });

  it('el pulso de movimiento muestra la cuenta atrás', () => {
    act(() => useSimulationStore.getState().quickAction('mov'));
    expect(within(node('mov')).getByTestId('node-summary')).toHaveTextContent('movimiento');
    expect(within(node('mov')).getByText(/⏱/)).toBeInTheDocument();
  });

  it('Intro sobre el nodo enfocado ejecuta su acción principal y el nodo tiene nombre accesible', () => {
    const wrapper = screen.getByTestId('rf__node-luz');
    expect(wrapper.getAttribute('aria-label')).toMatch(/^Luz salón: /);
    act(() => wrapper.focus());
    fireEvent.keyDown(wrapper, { key: 'Enter' });
    expect(state(LIGHT)?.state).toBe('on');
    // el nodo enfocado tiene prioridad sobre el seleccionado
    fireEvent.click(node('per'));
    act(() => wrapper.focus());
    fireEvent.keyDown(wrapper, { key: ' ' });
    expect(state(LIGHT)?.state).toBe('off');
  });

  it('ignora los atajos con el foco dentro del menú contextual, salvo Escape', () => {
    fireEvent.contextMenu(node('luz'), { clientX: 50, clientY: 50 });
    const item = screen.getAllByRole('menuitem')[0];
    if (!item) throw new Error('sin elementos');
    act(() => item.focus());
    fireEvent.keyDown(item, { key: 'u' });
    fireEvent.keyDown(item, { key: '5' });
    expect(useUiStore.getState().canvasMode).toBe('select');
    expect(state(LIGHT)?.state).toBe('off');
    fireEvent.keyDown(item, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('avisa si el dispositivo no admite nivel (teclas 1-9)', () => {
    fireEvent.click(node('mov'));
    fireEvent.keyDown(document.body, { key: '5' });
    expect(useUiStore.getState().notice?.text).toBe('Este dispositivo no admite nivel');
  });

  it('el popover de un dispositivo sin conexión muestra «No disponible» y permite reconectar', async () => {
    act(() => useSimulationStore.getState().setDeviceOffline('luz', true));
    fireEvent.doubleClick(node('luz'));
    const dialog = await screen.findByRole('dialog', { name: 'Control de Luz salón' });
    expect(within(dialog).getByText('No disponible')).toBeInTheDocument();
    expect(within(dialog).queryByRole('slider')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reconectar' }));
    expect(await within(dialog).findByRole('switch', { name: 'Encender o apagar' })).toBeInTheDocument();
  });

  it('«Añadir a escena» está deshabilitado sin conexión', () => {
    act(() => useSimulationStore.getState().setDeviceOffline('luz', true));
    fireEvent.contextMenu(node('luz'), { clientX: 50, clientY: 50 });
    expect(screen.getByRole('menuitem', { name: /Añadir a escena/ })).toHaveAttribute('aria-disabled', 'true');
  });

  it('la rueda sobre un sensor sin nivel no se intercepta (deja el zoom)', async () => {
    fireEvent.keyDown(document.body, { key: 'u' });
    const step = vi.spyOn(useSimulationStore.getState(), 'step');
    const ev = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
    // La rueda que no se intercepta hace zoom: React Flow actualiza el encuadre de forma asíncrona.
    await act(async () => {
      node('mov').dispatchEvent(ev);
    });
    expect(step).not.toHaveBeenCalled();
    await act(async () => {
      node('luz').dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
    });
    expect(step).toHaveBeenCalledWith('luz', -1);
    expect(node('mov')).not.toHaveClass('nowheel');
    expect(node('luz')).toHaveClass('nowheel');
  });

  it('los ticks del reloj no vuelven a pintar los nodos', () => {
    const before = node('luz');
    const html = before.outerHTML;
    act(() => useSimulationStore.getState().advance(5000));
    expect(node('luz')).toBe(before);
    expect(node('luz').outerHTML).toBe(html);
  });
});
