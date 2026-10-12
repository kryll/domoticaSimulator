import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Helper, Project } from '../types';
import { useProjectStore } from '../store/projectStore';
import { startSimulationSync, useSimulationStore } from '../store/simulationStore';
import { useUiStore } from '../store/uiStore';
import { makeProject } from '../test/fixtures';
import { autoConfirm } from '../test/confirm';
import { HelpersSection } from './HelpersSection';
import { HelperControl } from './HelperControl';
import { defaultHelper, saveHelper, timerRemaining, uniqueHelperName } from './helperModel';
import { EntityPicker } from '../automations/EntityPicker';
import { DashboardView } from '../dashboard/DashboardView';
import { PropertiesPanel } from '../canvas/PropertiesPanel';

const HELPERS: Helper[] = [
  { id: 'h1', type: 'input_boolean', name: 'Modo invitados' },
  { id: 'h2', type: 'counter', name: 'Visitas', initial: 0, step: 1 },
  { id: 'h3', type: 'timer', name: 'Lavadora', duration: 90 },
  { id: 'h4', type: 'input_select', name: 'Modo casa', options: ['Casa', 'Fuera', 'Noche'] },
  { id: 'h5', type: 'input_number', name: 'Consigna', min: 15, max: 25, step: 0.5, mode: 'box' },
];

function load(p: Project) {
  useProjectStore.getState().loadProject(p);
  useSimulationStore.getState().reset(p);
}

let stopSync: () => void = () => undefined;
beforeEach(() => {
  useUiStore.getState().reset();
  stopSync = startSimulationSync();
});
afterEach(() => stopSync());

describe('modelo de helpers', () => {
  it('evita nombres que producen el mismo entity_id', () => {
    const p = makeProject({ helpers: [HELPERS[1] as Helper] });
    expect(uniqueHelperName(p, { id: 'x', type: 'counter', name: 'visitas' })).toBe('visitas 2');
  });

  it('al renombrar actualiza las automatizaciones que lo usan', () => {
    const p = makeProject({
      helpers: [HELPERS[0] as Helper],
      automations: [{ id: 'a', name: 'A', enabled: true, mode: 'single', triggers: [{ type: 'state', entityId: 'input_boolean.modo_invitados', to: 'on' }], conditions: [], actions: [] }],
    });
    const next = saveHelper(p, { ...(HELPERS[0] as Helper), name: 'Fiesta' });
    expect(next.automations[0]?.triggers[0]).toMatchObject({ entityId: 'input_boolean.fiesta' });
  });

  it('calcula el tiempo restante de un timer en marcha con el reloj simulado', () => {
    const st = { state: 'active', attributes: { finishes_at: new Date(100_000).toISOString() } };
    expect(timerRemaining(st, 40_000, 90)).toBe(60);
    expect(timerRemaining({ state: 'idle', attributes: { duration: '0:01:30' } }, 0, 10)).toBe(90);
  });
});

describe('sección de helpers', () => {
  it('crea un contador con su formulario, lo usa y lo elimina con Deshacer', async () => {
    load(makeProject());
    render(<HelpersSection />);
    await userEvent.selectOptions(screen.getByLabelText('Tipo'), 'counter');
    await userEvent.click(screen.getByRole('button', { name: '+ Añadir helper' }));
    const form = screen.getByRole('form', { name: 'Nuevo helper: Contador' });
    await userEvent.clear(within(form).getByLabelText('Nombre'));
    await userEvent.type(within(form).getByLabelText('Nombre'), 'Cafés');
    await userEvent.clear(within(form).getByLabelText('Paso'));
    await userEvent.type(within(form).getByLabelText('Paso'), '2');
    expect(within(form).getByText('counter.cafes')).toBeInTheDocument();
    await userEvent.click(within(form).getByRole('button', { name: 'Guardar' }));
    expect(useProjectStore.getState().project.helpers).toEqual([expect.objectContaining({ type: 'counter', name: 'Cafés', step: 2 })]);
    expect(useSimulationStore.getState().sim.entities['counter.cafes']?.state).toBe(0);
    await userEvent.click(screen.getByRole('button', { name: 'Sumar 2' }));
    expect(useSimulationStore.getState().sim.entities['counter.cafes']?.state).toBe(2);

    const stop = autoConfirm(true);
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar Cafés' }));
    stop();
    expect(await screen.findByText('Todavía no hay helpers.')).toBeInTheDocument();
    act(() => useProjectStore.getState().undo());
    expect(useProjectStore.getState().project.helpers).toHaveLength(1);
  });

  it('valida el formulario (desplegable sin opciones)', async () => {
    load(makeProject());
    render(<HelpersSection />);
    await userEvent.selectOptions(screen.getByLabelText('Tipo'), 'input_select');
    await userEvent.click(screen.getByRole('button', { name: '+ Añadir helper' }));
    await userEvent.clear(screen.getByLabelText('Opciones (una por línea)'));
    expect(screen.getByRole('alert')).toHaveTextContent('al menos una opción');
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  });

  it('el temporizador muestra la cuenta atrás e inicia, pausa y cancela', async () => {
    load(makeProject({ helpers: HELPERS }));
    render(<HelperControl helper={HELPERS[2] as Helper} entityId="timer.lavadora" />);
    expect(screen.getByRole('timer', { name: 'Tiempo restante de Lavadora' })).toHaveTextContent('0:01:30');
    await userEvent.click(screen.getByRole('button', { name: '▶ Iniciar' }));
    expect(useSimulationStore.getState().sim.entities['timer.lavadora']?.state).toBe('active');
    act(() => useSimulationStore.getState().jumpTo(useSimulationStore.getState().sim.now + 30_000));
    expect(screen.getByRole('timer')).toHaveTextContent('0:01:00');
    await userEvent.click(screen.getByRole('button', { name: '⏸ Pausar' }));
    expect(screen.getByText('En pausa')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '■ Cancelar' }));
    expect(useSimulationStore.getState().sim.entities['timer.lavadora']?.state).toBe('idle');
  });

  it('interruptor, desplegable y número cambian el estado simulado', async () => {
    load(makeProject({ helpers: HELPERS }));
    render(
      <>
        <HelperControl helper={HELPERS[0] as Helper} entityId="input_boolean.modo_invitados" />
        <HelperControl helper={HELPERS[3] as Helper} entityId="input_select.modo_casa" />
        <HelperControl helper={HELPERS[4] as Helper} entityId="input_number.consigna" />
      </>,
    );
    await userEvent.click(screen.getByRole('switch', { name: 'Modo invitados' }));
    await userEvent.selectOptions(screen.getByLabelText('Modo casa'), 'Noche');
    const box = screen.getByLabelText('Consigna');
    await userEvent.clear(box);
    await userEvent.type(box, '21.5{Enter}');
    const e = useSimulationStore.getState().sim.entities;
    expect(e['input_boolean.modo_invitados']?.state).toBe('on');
    expect(e['input_select.modo_casa']?.state).toBe('Noche');
    expect(e['input_number.consigna']?.state).toBe(21.5);
  });
});

describe('los helpers aparecen en el resto de la interfaz', () => {
  it('en el selector de entidades, en su grupo «Ayudantes»', async () => {
    load(makeProject({ helpers: HELPERS }));
    render(<EntityPicker label="Entidad" value="" onChange={() => undefined} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Entidad' }));
    const list = screen.getByRole('listbox', { name: 'Opciones: Entidad' });
    expect(within(list).getByRole('group', { name: 'Ayudantes' })).toBeInTheDocument();
    expect(within(list).getByTitle('counter.visitas')).toBeInTheDocument();
  });

  it('el selector numérico solo ofrece números y contadores', async () => {
    load(makeProject({ helpers: HELPERS }));
    render(<EntityPicker label="Entidad" value="" numericOnly onChange={() => undefined} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Entidad' }));
    const list = screen.getByRole('listbox', { name: 'Opciones: Entidad' });
    expect(within(list).queryByTitle('input_boolean.modo_invitados')).toBeNull();
    expect(within(list).getByTitle('input_number.consigna')).toBeInTheDocument();
  });

  it('en el dashboard y en Propiedades sin selección', () => {
    load(makeProject({ helpers: HELPERS }));
    const { unmount } = render(<DashboardView />);
    expect(screen.getByRole('region', { name: 'Ayudantes' })).toHaveTextContent('Lavadora');
    unmount();
    render(<PropertiesPanel />);
    expect(screen.getByRole('region', { name: 'Ayudantes' })).toHaveTextContent('Modo invitados');
  });

  it('defaultHelper crea uno válido de cada tipo', () => {
    for (const t of ['input_boolean', 'input_number', 'input_select', 'input_text', 'input_datetime', 'timer', 'counter'] as const) {
      expect(defaultHelper(t, 'x').type).toBe(t);
    }
  });
});
