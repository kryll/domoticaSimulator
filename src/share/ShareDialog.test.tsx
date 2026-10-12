import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShareDialog } from './ShareDialog';
import { SharedLinkPrompt } from './SharedLinkPrompt';
import { useProjectStore } from '../store/projectStore';
import { makeDevice, makeProject } from '../test/fixtures';
import { encodeProjectToHash } from './share';

describe('compartir por URL', () => {
  beforeEach(() => {
    useProjectStore.getState().loadProject(makeProject({ id: 'original', name: 'Casa de Ana', devices: [makeDevice('hue-white-e27', 'd1')] }));
    window.history.replaceState(null, '', '/');
  });

  it('genera el enlace y lo copia; si no hay portapapeles selecciona el texto', async () => {
    const writeText = vi.fn(() => Promise.reject(new Error('denegado')));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<ShareDialog onClose={() => undefined} />);
    const input = screen.getByRole('textbox', { name: 'Enlace' });
    await waitFor(() => expect((input as HTMLInputElement).value).toMatch(/#p=v[01]\./));
    await userEvent.click(screen.getByRole('button', { name: 'Copiar enlace' }));
    expect(writeText).toHaveBeenCalledWith((input as HTMLInputElement).value);
    expect(await screen.findByText(/pulsa Ctrl\+C/)).toBeInTheDocument();
    expect(document.activeElement).toBe(input);
  });

  it('al abrir con #p= ofrece abrir el proyecto como nuevo, con otro id', async () => {
    const code = await encodeProjectToHash(makeProject({ id: 'original', name: 'Casa compartida' }), { compress: false });
    window.history.replaceState(null, '', `/#p=${code}`);
    render(<SharedLinkPrompt />);
    expect(await screen.findByText(/Casa compartida/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir como proyecto nuevo' }));
    await waitFor(() => expect(useProjectStore.getState().project.name).toBe('Casa compartida'));
    expect(useProjectStore.getState().project.id).not.toBe('original');
    expect(window.location.hash).toBe('');
  });

  it('avisa si el enlace no es válido', async () => {
    window.history.replaceState(null, '', '/#p=zz.nada');
    await act(async () => {
      render(<SharedLinkPrompt />);
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('no es válido');
  });
});
