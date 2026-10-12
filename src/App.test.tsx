import './test/flowMocks';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { useProjectStore } from './store/projectStore';
import { useUiStore } from './store/uiStore';
import { makeProject } from './test/fixtures';

describe('App', () => {
  beforeEach(() => {
    useUiStore.getState().reset();
    useProjectStore.getState().loadProject(makeProject());
  });

  it('muestra el título', () => {
    render(<App autoLoad={false} />);
    expect(screen.getByRole('heading', { name: 'HA Simulator' })).toBeInTheDocument();
  });

  it('muestra las zonas principales', () => {
    render(<App autoLoad={false} />);
    expect(screen.getByRole('complementary', { name: 'Catálogo de dispositivos' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Propiedades' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Validación/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Automatizaciones/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Escenas y scripts/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Registro/ })).toBeInTheDocument();
  });

  it('añade un dispositivo desde el catálogo y muestra sus propiedades', async () => {
    render(<App autoLoad={false} />);
    await userEvent.type(screen.getByLabelText('Buscar dispositivo'), 'SNZB-03P');
    const results = screen.getByRole('list', { name: 'Resultados del catálogo' });
    const add = within(results).getAllByRole('button', { name: /^Añadir .* al lienzo$/ })[0];
    if (!add) throw new Error('sin resultados');
    await userEvent.click(add);
    const { devices } = useProjectStore.getState().project;
    expect(devices).toHaveLength(1);
    const props = screen.getByRole('complementary', { name: 'Propiedades' });
    expect(within(props).getByLabelText('Nombre')).toHaveValue(devices[0]?.name);
    // simular movimiento desde el panel de propiedades
    await userEvent.click(within(props).getByRole('button', { name: 'Movimiento' }));
    expect(within(props).getAllByText(/^on$/).length).toBeGreaterThan(0);
  });

  it('renombra el proyecto', async () => {
    render(<App autoLoad={false} />);
    const input = screen.getByLabelText('Nombre del proyecto');
    await userEvent.clear(input);
    await userEvent.type(input, 'Mi casa{Enter}');
    expect(useProjectStore.getState().project.name).toBe('Mi casa');
  });
});
