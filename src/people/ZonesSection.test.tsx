import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ZonesSection } from './ZonesSection';
import { useProjectStore } from '../store/projectStore';
import { makeProject } from '../test/fixtures';

const zone = (id: string) => useProjectStore.getState().project.zones?.find((z) => z.id === id);

describe('ZonesSection', () => {
  beforeEach(() => {
    useProjectStore.getState().loadProject(makeProject({ zones: [{ id: 'trabajo', name: 'Trabajo', kind: 'work' }] }));
  });

  it('coordenadas desde casa, aviso de solapamiento, desplazamiento rápido y minimapa', async () => {
    render(<ZonesSection />);
    const work = screen.getByRole('listitem', { name: 'Zona Trabajo' });
    expect(within(work).getByRole('note')).toHaveTextContent('no tiene coordenadas');

    await userEvent.click(within(work).getByRole('button', { name: 'Usar la ubicación de casa' }));
    expect(zone('trabajo')).toMatchObject({ latitude: 40.4168, longitude: -3.7038 });
    expect(within(screen.getByRole('listitem', { name: 'Zona Trabajo' })).getByRole('note')).toHaveTextContent('se solapan');

    await userEvent.selectOptions(screen.getByLabelText('Desplazar la zona Trabajo'), '5N');
    expect(zone('trabajo')?.latitude).toBeCloseTo(40.4617, 3);
    expect(screen.queryByRole('note')).toBeNull();

    const radius = within(screen.getByRole('listitem', { name: 'Zona Trabajo' })).getByLabelText('Radio (m)');
    await userEvent.clear(radius);
    await userEvent.type(radius, '300{Enter}');
    expect(zone('trabajo')?.radius).toBe(300);

    const map = screen.getByTestId('zone-minimap');
    expect(map.querySelectorAll('circle[fill-opacity]')).toHaveLength(2);
    expect(map).toHaveTextContent('Casa');
    expect(map).toHaveTextContent('Trabajo');
    expect(map).toHaveAccessibleName(/Trabajo \(radio 300 m\)/);
  });

  it('valida el radio dentro de los límites', async () => {
    render(<ZonesSection />);
    const radius = within(screen.getByRole('listitem', { name: 'Zona Casa' })).getByLabelText('Radio (m)');
    await userEvent.clear(radius);
    await userEvent.type(radius, '5{Enter}');
    expect(radius).toHaveAttribute('aria-invalid', 'true');
    expect(useProjectStore.getState().project.zones?.find((z) => z.kind === 'home')).toBeUndefined();
  });
});
