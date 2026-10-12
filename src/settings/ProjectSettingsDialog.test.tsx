import { render, screen, within } from '@testing-library/react';
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
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.settings).toBeUndefined();
    useProjectStore.getState().redo();

    const expected = sunTimes(Date.UTC(2026, 9, 12), 37.3891, -5.9845, 'Europe/Madrid');
    expect(screen.getByLabelText('Sol de hoy')).toHaveTextContent(formatSimTime(expected.sunset));

    await userEvent.click(screen.getByRole('button', { name: /Ir a…/ }));
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
