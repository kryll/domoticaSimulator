import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectSettingsDialog } from './ProjectSettingsDialog';
import { SimClock } from '../simulation/SimClock';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { useUiStore } from '../store/uiStore';
import { makeProject } from '../test/fixtures';
import { formatSimTime, sunTimes } from '../simulation/clock';

describe('Ajustes del proyecto y «Ir a…»', () => {
  beforeEach(() => {
    const p = makeProject();
    useProjectStore.getState().loadProject(p);
    useSimulationStore.getState().reset(p);
    // 12/10/2026 a las 10:00 (hora simulada de pared)
    useSimulationStore.setState((s) => ({ sim: { ...s.sim, now: Date.UTC(2026, 9, 12, 10, 0, 0) } }));
    useUiStore.getState().reset();
    useUiStore.getState().setSettingsOpen(true);
  });

  it('guarda la ubicación elegida y salta al próximo atardecer de esa ciudad', async () => {
    render(
      <>
        <SimClock />
        <ProjectSettingsDialog />
      </>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Ajustes del proyecto' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Ciudad'), 'Sevilla');
    expect(within(dialog).getByLabelText('Latitud')).toHaveValue('37.3891');
    const price = within(dialog).getByLabelText('Precio de la electricidad (€/kWh)');
    await userEvent.clear(price);
    await userEvent.type(price, '0,2');
    expect(price).toHaveValue('0,2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    const settings = useProjectStore.getState().project.settings;
    expect(settings).toMatchObject({ latitude: 37.3891, longitude: -5.9845, timeZone: 'Europe/Madrid', electricityPriceEurKwh: 0.2 });
    expect(useUiStore.getState().settingsOpen).toBe(false);
    // se puede deshacer
    act(() => useProjectStore.getState().undo());
    expect(useProjectStore.getState().project.settings).toBeUndefined();
    act(() => useProjectStore.getState().redo());

    const expected = sunTimes(Date.UTC(2026, 9, 12), 37.3891, -5.9845, 'Europe/Madrid');
    // El reloj compacto muestra la fecha, el sol de hoy e «Ir a…» en su desplegable.
    await userEvent.click(screen.getByRole('button', { name: /Ir a…/ }));
    expect(screen.getByLabelText('Sol de hoy')).toHaveTextContent(formatSimTime(expected.sunset));
    await userEvent.click(screen.getByRole('button', { name: /Próximo atardecer/ }));
    expect(useSimulationStore.getState().sim.now).toBe(expected.sunset);
  });
});

describe('«Ir a…» y el teclado', () => {
  it('Escape cierra el diálogo y devuelve el foco al botón', async () => {
    render(<SimClock />);
    const button = screen.getByRole('button', { name: /Ir a…/ });
    await userEvent.click(button);
    expect(screen.getByRole('dialog', { name: 'Ir a…' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Ir a…' })).toBeNull();
    expect(button).toHaveFocus();
  });
});

describe('Ajustes: errores por pestaña y avanzado', () => {
  beforeEach(() => {
    const p = makeProject();
    useProjectStore.getState().loadProject(p);
    useUiStore.getState().reset();
    useUiStore.getState().setSettingsOpen(true, 'simulation');
  });

  it('marca la pestaña con errores y salta a ella al guardar', async () => {
    render(<ProjectSettingsDialog />);
    const dialog = screen.getByRole('dialog', { name: 'Ajustes del proyecto' });
    await userEvent.click(within(dialog).getByRole('tab', { name: 'Proyecto' }));
    await userEvent.clear(within(dialog).getByLabelText('Latitud'));
    await userEvent.type(within(dialog).getByLabelText('Latitud'), '200');
    await userEvent.click(within(dialog).getByRole('tab', { name: 'Simulación' }));
    expect(within(dialog).getByRole('tab', { name: /Proyecto.*con errores/ })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(within(dialog).getByRole('tab', { name: /Proyecto/ })).toHaveAttribute('aria-selected', 'true');
    expect(useUiStore.getState().settingsOpen).toBe(true);
    expect(useProjectStore.getState().project.settings).toBeUndefined();
  });

  it('guarda los ajustes avanzados de simulación dentro de los rangos del esquema', async () => {
    render(<ProjectSettingsDialog />);
    const dialog = screen.getByRole('dialog', { name: 'Ajustes del proyecto' });
    await userEvent.click(within(dialog).getByRole('button', { name: /Avanzado/ }));
    await userEvent.click(within(dialog).getByLabelText('Modelo térmico por sala'));
    const rate = within(dialog).getByLabelText('Probabilidad de fallo en la nube (0 a 1)');
    await userEvent.clear(rate);
    await userEvent.type(rate, '1,5');
    expect(within(dialog).getByRole('tab', { name: /Simulación.*con errores/ })).toBeInTheDocument();
    await userEvent.clear(rate);
    await userEvent.type(rate, '0,2');
    await userEvent.type(within(dialog).getByLabelText('Semilla aleatoria'), '42');
    const tau = within(dialog).getByLabelText('Inercia térmica (horas)');
    await userEvent.clear(tau);
    await userEvent.type(tau, '12');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    const p = useProjectStore.getState().project;
    expect(p.reliability).toMatchObject({ failureRate: 0.2, seed: 42 });
    expect(p.environment).toMatchObject({ enabled: true, tauHours: 12 });
  });
});
