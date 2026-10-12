import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VariantsSection } from './VariantsSection';
import { useProjectStore } from '../store/projectStore';
import { makeDevice, makeProject } from '../test/fixtures';

describe('VariantsSection', () => {
  beforeEach(() => {
    useProjectStore.getState().loadProject(makeProject({ devices: [makeDevice('hue-white-e27', 'd1', 0, 0, 'Luz')] }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('guarda, cambia y compara variantes', async () => {
    render(<VariantsSection />);
    await userEvent.type(screen.getByLabelText('Nombre de la variante'), 'Con una luz');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar variante' }));
    expect(useProjectStore.getState().project.variants?.map((v) => v.name)).toEqual(['Con una luz']);

    // se añade un dispositivo al proyecto actual y se compara con la variante
    useProjectStore.getState().addDevice(makeDevice('aqara-motion-p1', 'd2', 50, 50, 'Sensor'));
    await userEvent.click(screen.getByRole('button', { name: 'Comparar Con una luz con el proyecto actual' }));
    const dialog = screen.getByRole('dialog', { name: 'Comparar variantes' });
    const row = within(dialog).getByRole('row', { name: /Dispositivos a pilas/ });
    expect(row).toHaveTextContent('-1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cerrar' }));

    await userEvent.click(screen.getByRole('button', { name: 'Cambiar a variante Con una luz' }));
    expect(useProjectStore.getState().project.devices.map((d) => d.id)).toEqual(['d1']);
    // deshacer recupera el estado anterior
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.devices).toHaveLength(2);
  });
});
