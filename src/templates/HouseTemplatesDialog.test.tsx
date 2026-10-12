import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HouseTemplatesDialog } from './HouseTemplatesDialog';
import { useProjectStore } from '../store/projectStore';
import { makeProject } from '../test/fixtures';
import { HOUSE_TEMPLATES } from '../store/houseTemplates';

describe('HouseTemplatesDialog', () => {
  it('muestra la galería y crea un proyecto nuevo desde una plantilla', async () => {
    useProjectStore.getState().loadProject(makeProject({ id: 'actual' }));
    const onClose = vi.fn();
    render(<HouseTemplatesDialog onClose={onClose} />);
    const list = screen.getByRole('list', { name: 'Plantillas de casa' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(HOUSE_TEMPLATES.length);
    const first = HOUSE_TEMPLATES[0];
    if (!first) throw new Error('sin plantillas');
    await userEvent.click(screen.getByRole('button', { name: `Crear desde ${first.name}` }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useProjectStore.getState().project.id).not.toBe('actual');
    expect(useProjectStore.getState().project.devices.length).toBeGreaterThan(0);
  });
});
