import '../test/flowMocks';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlowProvider } from '@xyflow/react';
import { CatalogPanel } from './CatalogPanel';
import { catalog } from '../devices/catalog';
import type { DeviceDefinition } from '../types';

function renderPanel(onAdd = vi.fn<(d: DeviceDefinition) => void>()) {
  render(
    <ReactFlowProvider>
      <CatalogPanel onAdd={onAdd} />
    </ReactFlowProvider>,
  );
  return onAdd;
}

const results = () => {
  const list = screen.queryByRole('list', { name: 'Resultados del catálogo' });
  return list ? within(list).queryAllByRole('listitem') : [];
};

describe('CatalogPanel', () => {
  it('muestra todo el catálogo inicialmente', () => {
    renderPanel();
    expect(results()).toHaveLength(catalog.length);
  });

  it('filtra por texto', async () => {
    renderPanel();
    await userEvent.type(screen.getByLabelText('Buscar dispositivo'), 'dirigera');
    const items = results();
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThan(catalog.length);
    expect(items[0]).toHaveAccessibleName(/DIRIGERA/i);
  });

  it('filtra por marca y por conectividad', async () => {
    renderPanel();
    await userEvent.selectOptions(screen.getByLabelText('Marca'), 'Shelly');
    const shelly = catalog.filter((d) => d.brand === 'Shelly').length;
    expect(results()).toHaveLength(shelly);
    await userEvent.selectOptions(screen.getByLabelText('Conectividad'), 'cloud');
    expect(results().length).toBeLessThanOrEqual(shelly);
  });

  it('muestra un mensaje si no hay resultados', async () => {
    renderPanel();
    await userEvent.type(screen.getByLabelText('Buscar dispositivo'), 'zzzzzz-no-existe');
    expect(screen.getByText('Ningún dispositivo coincide con los filtros.')).toBeInTheDocument();
  });

  it('el botón + añade el dispositivo', async () => {
    const onAdd = renderPanel();
    const first = catalog[0];
    if (!first) throw new Error('catálogo vacío');
    await userEvent.click(screen.getByRole('button', { name: `Añadir ${first.name} al lienzo` }));
    expect(onAdd).toHaveBeenCalledWith(first);
  });
});
