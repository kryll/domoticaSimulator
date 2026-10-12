import '../test/flowMocks';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { useProjectStore } from '../store/projectStore';
import { stopSimulationLoop, useSimulationStore } from '../store/simulationStore';
import { useUiStore } from '../store/uiStore';
import { makeDevice, makeProject } from '../test/fixtures';
import { setHoveredDevice } from './useCanvasKeyboard';
import { resetClipboardMemory } from './selectionActions';

const node = (id: string) => screen.getByTestId(`device-node-${id}`);
const project = () => useProjectStore.getState().project;
const ui = () => useUiStore.getState();

/** Panel de Propiedades (en jsdom no hay media queries: se pinta aunque esté oculto). */
const props = () => screen.getByRole('complementary', { name: 'Propiedades' });

async function setup() {
  const p = makeProject({
    floors: [
      { id: 'f1', name: 'Planta baja', level: 0, pixelsPerMeter: 40 },
      { id: 'f2', name: 'Planta alta', level: 1, pixelsPerMeter: 40 },
    ],
    rooms: [
      { id: 'r1', floorId: 'f1', name: 'Salón', polygon: [] },
      { id: 'r2', floorId: 'f1', name: 'Cocina', polygon: [] },
    ],
    devices: [
      makeDevice('hue-white-e27', 'l1', 100, 100, 'Luz 1'),
      makeDevice('hue-white-e27', 'l2', 300, 150, 'Luz 2'),
      makeDevice('hue-white-e27', 'l3', 500, 120, 'Luz 3'),
      makeDevice('aqara-motion-p1', 'm1', 400, 400, 'Movimiento'),
    ],
    automations: [
      {
        id: 'a1',
        name: 'Encender luz 1',
        enabled: true,
        triggers: [{ type: 'state', entityId: 'binary_sensor.movimiento_motion', to: 'on' }],
        conditions: [],
        actions: [{ type: 'service', service: 'light.turn_on', entityId: 'light.luz_1' }],
        mode: 'single',
      },
    ],
  });
  ui().reset();
  resetClipboardMemory();
  useProjectStore.getState().loadProject(p);
  useSimulationStore.getState().reset(p);
  ui().setActiveFloor('f1');
  setHoveredDevice(null);
  render(<App autoLoad={false} />);
  await act(async () => {});
}

describe('selección múltiple en el lienzo', () => {
  beforeEach(setup);
  afterEach(() => stopSimulationLoop());

  it('Ctrl/Cmd+clic añade y quita; el panel muestra el resumen y acciones en lote', async () => {
    fireEvent.click(node('l1'));
    fireEvent.click(node('l2'), { ctrlKey: true });
    fireEvent.click(node('l3'), { metaKey: true });
    expect(ui().selection).toEqual(['l1', 'l2', 'l3']);
    expect(within(props()).getByText('3 dispositivos seleccionados')).toBeInTheDocument();
    fireEvent.click(node('l3'), { ctrlKey: true });
    expect(ui().selection).toEqual(['l1', 'l2']);

    // asignar sala en lote = un solo paso de deshacer
    await userEvent.selectOptions(within(props()).getByLabelText('Asignar sala'), 'r2');
    expect(project().devices.filter((d) => d.roomId === 'r2').map((d) => d.id)).toEqual(['l1', 'l2']);
    act(() => useProjectStore.getState().undo());
    expect(project().devices.some((d) => d.roomId === 'r2')).toBe(false);

    // misma definición: se puede cambiar la integración en lote
    expect(within(props()).getByLabelText('Integración')).toBeInTheDocument();
  });

  it('Ctrl+A selecciona la planta; alinear y distribuir mueven en un paso', async () => {
    fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true });
    expect(ui().selection).toEqual(['l1', 'l2', 'l3', 'm1']);
    fireEvent.click(node('m1'), { ctrlKey: true });
    await userEvent.click(within(props()).getByRole('button', { name: 'Alinear arriba' }));
    expect(project().devices.filter((d) => d.id !== 'm1').map((d) => d.position.y)).toEqual([100, 100, 100]);
    await userEvent.click(within(props()).getByRole('button', { name: 'Distribuir en horizontal' }));
    expect(project().devices.find((d) => d.id === 'l2')?.position.x).toBe(300);
    act(() => useProjectStore.getState().undo());
    expect(project().devices.map((d) => d.position.y)).toEqual([100, 150, 120, 400]);
  });

  it('Supr borra exactamente la selección, avisa de las referencias y Ctrl+Z la recupera', async () => {
    fireEvent.click(node('l1'));
    fireEvent.click(node('l2'), { ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'Delete' });
    const dialog = await screen.findByRole('alertdialog', { name: '¿Eliminar 2 dispositivos?' });
    expect(dialog).toHaveTextContent('Se usan en 1 automatización:');
    expect(dialog).toHaveTextContent('Automatización «Encender luz 1» (light.luz_1)');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Eliminar' }));
    expect(project().devices.map((d) => d.id)).toEqual(['l3', 'm1']);
    expect(ui().notice?.action?.label).toBe('Deshacer');
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(project().devices.map((d) => d.id)).toEqual(['l1', 'l2', 'l3', 'm1']);
  });

  it('un dispositivo sin referencias se borra sin preguntar, con «Deshacer» en el aviso', async () => {
    fireEvent.click(node('l3'));
    fireEvent.keyDown(document.body, { key: 'Delete' });
    await waitFor(() => expect(project().devices.map((d) => d.id)).toEqual(['l1', 'l2', 'm1']));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('Deshacer', { selector: 'button' }));
    expect(project().devices).toHaveLength(4);
  });

  it('Ctrl+D duplica la selección y Ctrl+C / Ctrl+V pegan desplazado y en otra planta', async () => {
    fireEvent.click(node('l1'));
    fireEvent.click(node('l2'), { ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'd', ctrlKey: true });
    expect(project().devices).toHaveLength(6);
    const dupIds = ui().selection;
    expect(dupIds).toHaveLength(2);
    expect(project().devices.find((d) => d.id === dupIds[0])?.position).toEqual({ x: 140, y: 140 });
    act(() => useProjectStore.getState().undo());
    expect(project().devices).toHaveLength(4);

    // Copiar sin permisos de portapapeles: queda en memoria
    act(() => ui().setSelection(['l1', 'l2']));
    fireEvent.keyDown(document.body, { key: 'c', ctrlKey: true });
    await act(() => new Promise((r) => setTimeout(r, 10)));
    fireEvent.keyDown(document.body, { key: 'v', ctrlKey: true });
    await waitFor(() => expect(project().devices).toHaveLength(6));
    const pasted = project().devices.slice(4);
    expect(pasted.map((d) => d.position)).toEqual([
      { x: 140, y: 140 },
      { x: 340, y: 190 },
    ]);
    expect(pasted.every((d) => d.floorId === 'f1')).toBe(true);

    // En otra planta se pega en la misma posición
    act(() => ui().setActiveFloor('f2'));
    fireEvent.keyDown(document.body, { key: 'v', ctrlKey: true });
    await waitFor(() => expect(project().devices).toHaveLength(8));
    const upstairs = project().devices.filter((d) => d.floorId === 'f2');
    expect(upstairs.map((d) => d.position)).toEqual([
      { x: 100, y: 100 },
      { x: 300, y: 150 },
    ]);
    expect(ui().selection).toEqual(upstairs.map((d) => d.id));
    // un solo paso de deshacer por pegado
    act(() => useProjectStore.getState().undo());
    expect(project().devices).toHaveLength(6);
  });

  it('el evento paste del sistema con texto del simulador pega; Esc vacía la selección', async () => {
    fireEvent.click(node('l3'));
    const data = new Map<string, string>();
    const copy = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(copy, 'clipboardData', { value: { setData: (t: string, v: string) => data.set(t, v), getData: (t: string) => data.get(t) ?? '' } });
    document.dispatchEvent(copy);
    expect(copy.defaultPrevented).toBe(true);
    expect(JSON.parse(data.get('text/plain') ?? '{}')).toMatchObject({ type: 'ha-simulator/devices' });
    resetClipboardMemory();

    act(() => ui().setActiveFloor('f2'));
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => data.get('text/plain') ?? '' } });
    document.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    const upstairs = project().devices.filter((d) => d.floorId === 'f2');
    expect(upstairs).toHaveLength(1);
    expect(upstairs[0]?.name).toMatch(/^Luz 3 /);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(ui().selection).toEqual([]);
  });

  it('arrastrar varios los mueve juntos en un solo paso de deshacer', () => {
    act(() => useProjectStore.getState().moveDevicesTo([
      { id: 'l1', position: { x: 110, y: 110 } },
      { id: 'l2', position: { x: 310, y: 160 } },
    ]));
    expect(project().devices.slice(0, 2).map((d) => d.position)).toEqual([
      { x: 110, y: 110 },
      { x: 310, y: 160 },
    ]);
    act(() => useProjectStore.getState().undo());
    expect(project().devices.slice(0, 2).map((d) => d.position)).toEqual([
      { x: 100, y: 100 },
      { x: 300, y: 150 },
    ]);
  });

  it('la ayuda de atajos incluye la selección múltiple', async () => {
    fireEvent.keyDown(document.body, { key: '?' });
    const dialog = await screen.findByRole('dialog', { name: 'Atajos de teclado y ratón' });
    expect(within(dialog).getByText('Mayús+arrastrar')).toBeInTheDocument();
    expect(within(dialog).getByText('Ctrl+D')).toBeInTheDocument();
  });
});
