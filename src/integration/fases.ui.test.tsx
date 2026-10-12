// Tests de interfaz de la fusión de la Fase 2 y la Fase 3.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectSettingsDialog } from '../settings/ProjectSettingsDialog';
import { SimulationSettingsButton } from '../environment/SimulationSettingsButton';
import { VariantsSection } from '../variants/VariantsSection';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { useUiStore } from '../store/uiStore';
import { createDemoProject } from '../store/demoProject';
import { createVariant } from '../variants/variants';
import { makeProject } from '../test/fixtures';

function Settings() {
  const open = useUiStore((s) => s.settingsOpen);
  return (
    <>
      <SimulationSettingsButton />
      {open && <ProjectSettingsDialog />}
    </>
  );
}

describe('ajustes unificados: proyecto (F2) y simulación (F3)', () => {
  beforeEach(() => {
    const p = makeProject();
    useProjectStore.getState().loadProject(p);
    useSimulationStore.getState().reset(p);
    useUiStore.getState().reset();
  });

  it('⚙ abre «Ajustes del proyecto» en la pestaña Simulación y guarda clima y latencia', async () => {
    render(<Settings />);
    await userEvent.click(screen.getByRole('button', { name: 'Ajustes de simulación' }));
    const dialog = screen.getByRole('dialog', { name: 'Ajustes del proyecto' });
    expect(within(dialog).getByRole('tab', { name: 'Simulación' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(within(dialog).getByLabelText('Modelo térmico por sala'));
    const mean = within(dialog).getByLabelText('Temperatura exterior media (°C)');
    await userEvent.clear(mean);
    await userEvent.type(mean, '8,5');
    await userEvent.click(within(dialog).getByLabelText('Latencia según protocolo e integración'));
    // La pestaña Proyecto sigue en el mismo diálogo.
    await userEvent.click(within(dialog).getByRole('tab', { name: 'Proyecto' }));
    expect(within(dialog).getByLabelText('Latitud')).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    const p = useProjectStore.getState().project;
    expect(p.environment).toMatchObject({ enabled: true, outdoorMean: 8.5 });
    expect(p.reliability).toMatchObject({ latency: true });
    expect(p.settings).toMatchObject({ latitude: 40.4168 });
    expect(useUiStore.getState().settingsOpen).toBe(false);
    // Un solo paso de deshacer.
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.environment).toBeUndefined();
  });

  it('desde la barra superior se abre en la pestaña Proyecto', () => {
    useUiStore.getState().setSettingsOpen(true);
    render(<Settings />);
    expect(screen.getByRole('tab', { name: 'Proyecto' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('comparar variantes con el coste del presupuesto', () => {
  it('la tabla muestra el coste de cada variante y la diferencia', async () => {
    const demo = createDemoProject();
    const withVariant = createVariant({ ...demo, devices: demo.devices.filter((d) => d.id !== 'demo-cafetera') }, 'Sin cafetera');
    useProjectStore.getState().loadProject({ ...withVariant, devices: demo.devices });
    render(<VariantsSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Comparar Sin cafetera con el proyecto actual' }));
    const row = screen.getByRole('row', { name: /Coste \(presupuesto\)/ });
    const cells = within(row).getAllByRole('cell');
    expect(cells).toHaveLength(3);
    expect(cells[0]).toHaveTextContent('€');
    expect(cells[2]?.textContent).toMatch(/^−\d/);
  });
});
