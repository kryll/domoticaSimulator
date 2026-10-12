import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { useLayoutStore } from '../store/layoutStore';
import { useUiStore } from '../store/uiStore';
import { createDemoProject } from '../store/persistence';
import { DayPlanDialog } from './DayPlanDialog';
import { DayPlanIndicator } from './DayPlanIndicator';
import { pendingPlanEvents } from './dayPlanActions';
import { DAY_MS } from '../simulation/clock';

beforeEach(() => {
  const p = createDemoProject();
  useProjectStore.getState().loadProject(p);
  useSimulationStore.getState().reset(p);
  useLayoutStore.getState().reset();
  useUiStore.getState().reset();
});

describe('día típico', () => {
  it('genera una vista previa según personas, perfil y semilla', async () => {
    useLayoutStore.getState().setDayPlanOpen(true);
    render(<DayPlanDialog />);
    const dialog = screen.getByRole('dialog', { name: 'Generar día típico' });
    const heading = within(dialog).getByRole('heading', { name: /Vista previa: \d+ eventos/ });
    const before = heading.textContent;
    expect(within(dialog).getByRole('img', { name: /Eventos por hora/ })).toBeInTheDocument();
    expect(within(within(dialog).getByRole('list', { name: 'Eventos del día típico' })).getAllByRole('listitem').length).toBeGreaterThan(5);
    await userEvent.selectOptions(within(dialog).getByLabelText('Perfil'), 'oficina');
    await userEvent.clear(within(dialog).getByLabelText('Personas'));
    await userEvent.type(within(dialog).getByLabelText('Personas'), '3');
    expect(within(dialog).getByRole('heading', { name: /Vista previa/ }).textContent).not.toBe(before);
  });

  it('Aplicar programa los eventos, el indicador lo muestra, ocurren al avanzar el reloj y Quitar los borra', async () => {
    useLayoutStore.getState().setDayPlanOpen(true);
    const { unmount } = render(<DayPlanDialog />);
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    unmount();
    const sim = useSimulationStore.getState().sim;
    const scheduled = pendingPlanEvents(sim.pending);
    expect(scheduled).toBeGreaterThan(0);
    render(<DayPlanIndicator />);
    expect(screen.getByRole('button', { name: /Día típico.*pendientes/ })).toBeInTheDocument();
    const logBefore = sim.log.length;
    act(() => useSimulationStore.getState().jumpTo(sim.now + DAY_MS));
    const after = useSimulationStore.getState().sim;
    expect(pendingPlanEvents(after.pending)).toBeLessThan(scheduled);
    expect(after.log.length).toBeGreaterThan(logBefore);
    // Quitar
    useLayoutStore.getState().setDayPlanOpen(true);
    render(<DayPlanDialog />);
    await userEvent.click(screen.getByRole('button', { name: 'Quitar' }));
    expect(pendingPlanEvents(useSimulationStore.getState().sim.pending)).toBe(0);
    expect(screen.getByRole('button', { name: 'Generar día típico' })).toBeInTheDocument();
  });
});
