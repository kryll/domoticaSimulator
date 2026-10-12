import '../test/flowMocks';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { BudgetPanel } from '../reports/BudgetPanel';
import { ProposalDialog } from '../proposal/ProposalDialog';
import { ShareDialog } from '../share/ShareDialog';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { useViewStore } from '../store/viewStore';
import { stopSimulationLoop, useSimulationStore } from '../store/simulationStore';
import { makeDevice, makeProject } from '../test/fixtures';
import { buildPlanSvg } from '../proposal/planSvg';
import { catalog } from '../devices/catalog';
import { PRESENT_FLAG, enterPresentation, exitPresentation, wantsPresentation, withPresentationFlag } from './presentationMode';
import { hasSharedPresentation } from './sharedPresentation';

const project = () =>
  makeProject({
    name: 'Casa García',
    rooms: [{ id: 'r1', floorId: 'f1', name: 'Salón & cocina', polygon: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 300 }, { x: 0, y: 300 }] }],
    devices: [makeDevice('ha-green', 'ha', 100, 100, 'Servidor'), makeDevice('hue-white-e27', 'l1', 300, 150, 'Luz <salón>')],
  });

describe('entrega al cliente', () => {
  beforeEach(() => {
    useUiStore.getState().reset();
    useViewStore.getState().reset();
    const p = project();
    useProjectStore.getState().loadProject(p);
    useSimulationStore.getState().reset(p);
  });
  afterEach(() => {
    exitPresentation();
    stopSimulationLoop();
  });

  it('el presupuesto edita los datos de la propuesta y muestra las partidas', async () => {
    render(<BudgetPanel />);
    const data = screen.getByRole('region', { name: 'Datos de la propuesta' });
    const client = within(data).getByLabelText('Cliente');
    await userEvent.type(client, 'Familia García');
    fireEvent.blur(client);
    expect(useProjectStore.getState().project.settings?.quote?.clientName).toBe('Familia García');
    const vat = within(data).getByLabelText('IVA (%)');
    await userEvent.type(vat, '10');
    fireEvent.blur(vat);
    expect(useProjectStore.getState().project.settings?.quote?.vatPct).toBe(10);
    // Fuera de rango: no se guarda y avisa.
    await userEvent.clear(within(data).getByLabelText('Margen (%)'));
    await userEvent.type(within(data).getByLabelText('Margen (%)'), '250');
    fireEvent.blur(within(data).getByLabelText('Margen (%)'));
    expect(within(data).getByRole('alert')).toHaveTextContent('Entre 0 y 100');
    expect(useProjectStore.getState().project.settings?.quote?.marginPct).toBeUndefined();

    const quote = screen.getByRole('region', { name: 'Presupuesto por partidas' });
    expect(within(quote).getByText('Materiales')).toBeInTheDocument();
    expect(within(quote).getByText(/^Mano de obra/)).toBeInTheDocument();
    expect(within(quote).getByText('IVA (10 %)')).toBeInTheDocument();
    expect(within(quote).getByText('Base imponible')).toBeInTheDocument();
    expect(within(quote).getByTestId('quote-total').textContent).toMatch(/€$/);
    // Deshacer el IVA
    act(() => useProjectStore.getState().undo());
    expect(useProjectStore.getState().project.settings?.quote?.vatPct).toBeUndefined();
  });

  it('la propuesta genera el HTML, lo muestra en un iframe aislado y permite imprimir y descargar', async () => {
    const createUrl = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() });
    render(<ProposalDialog />);
    const dialog = screen.getByRole('dialog', { name: 'Propuesta para el cliente' });
    const frame = within(dialog).getByTitle('Vista previa de la propuesta') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin allow-modals');
    const html = frame.getAttribute('srcdoc') ?? '';
    expect(html).toContain('Casa García');
    expect(html).toContain('<svg');
    expect(html).not.toContain('<script');
    const print = vi.fn();
    Object.defineProperty(frame, 'contentWindow', { configurable: true, value: { print, focus: vi.fn() } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Imprimir / Guardar como PDF' }));
    expect(print).toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Descargar .html' }));
    expect(createUrl).toHaveBeenCalled();
  });

  it('buildPlanSvg serializa salas y dispositivos escapando el texto', () => {
    const svg = buildPlanSvg(project(), catalog) ?? '';
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('Salón &amp; cocina');
    expect(svg).toContain('Luz &lt;salón&gt;');
    expect(svg).toContain('<polygon');
    expect(buildPlanSvg(makeProject(), catalog)).toBeUndefined();
  });

  it('modo presentación: solo lectura con Plano, Dashboard y Escenarios; se puede simular; Esc sale', async () => {
    render(<App autoLoad={false} />);
    await act(async () => {});
    act(() => enterPresentation({ fullscreen: false }));
    const view = screen.getByTestId('presentation');
    expect(screen.queryByRole('complementary', { name: 'Catálogo de dispositivos' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Propiedades' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edición' })).toBeNull();
    const tabs = within(view).getByRole('tablist', { name: 'Vista de la presentación' });
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Plano', 'Dashboard', 'Escenarios']);
    expect(useUiStore.getState().canvasMode).toBe('interact');
    // Simular (el modo Uso la pone en marcha sola; se pausa y se vuelve a iniciar)
    await userEvent.click(within(view).getByRole('button', { name: 'Pausar simulación' }));
    expect(useSimulationStore.getState().running).toBe(false);
    await userEvent.click(within(view).getByRole('button', { name: 'Iniciar simulación' }));
    expect(useSimulationStore.getState().running).toBe(true);
    // Las teclas de edición no hacen nada (Supr no borra).
    act(() => useUiStore.getState().select({ kind: 'device', id: 'l1' }));
    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(useProjectStore.getState().project.devices).toHaveLength(2);
    // Dashboard utilizable
    await userEvent.click(within(tabs).getByRole('tab', { name: 'Dashboard' }));
    expect(await screen.findByRole('button', { name: /Encender Luz/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Exportar YAML Lovelace' })).toBeNull();
    // Escenarios: botones y el impacto
    await userEvent.click(within(tabs).getByRole('tab', { name: 'Escenarios' }));
    await userEvent.click(screen.getByRole('button', { name: /Se cae Internet/ }));
    expect(useSimulationStore.getState().sim.failures?.internet).toBe(true);
    expect(await screen.findByRole('region', { name: 'Impacto' })).toBeInTheDocument();
    // Esc sale
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useViewStore.getState().presentation).toBe(false);
    expect(screen.getByRole('complementary', { name: 'Catálogo de dispositivos' })).toBeInTheDocument();
    useSimulationStore.getState().pause();
  });

  it('el botón «Salir» vuelve al editor', async () => {
    render(<App autoLoad={false} />);
    await act(async () => {});
    act(() => enterPresentation({ fullscreen: false }));
    await userEvent.click(screen.getByRole('button', { name: /^Salir/ }));
    expect(useViewStore.getState().presentation).toBe(false);
    expect(useUiStore.getState().canvasMode).toBe('select');
  });

  it('«Compartir enlace» puede abrir en modo presentación (bandera en el hash)', async () => {
    render(<ShareDialog onClose={() => undefined} />);
    const input = screen.getByRole('textbox', { name: 'Enlace' });
    await waitFor(() => expect((input as HTMLInputElement).value).toContain('#p='));
    expect((input as HTMLInputElement).value).not.toContain(PRESENT_FLAG);
    await userEvent.click(screen.getByRole('checkbox', { name: /Abrir en modo presentación/ }));
    const url = (input as HTMLInputElement).value;
    expect(url).toContain(`&${PRESENT_FLAG}`);
    const hash = `#${url.split('#')[1]}`;
    expect(wantsPresentation(hash)).toBe(true);
    expect(hasSharedPresentation(hash)).toBe(true);
    expect(hasSharedPresentation('#p=v0.abc')).toBe(false);
    expect(withPresentationFlag(url, false)).not.toContain(PRESENT_FLAG);
  });
});
