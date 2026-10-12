import { fireEvent, render, screen } from '@testing-library/react';
import { BudgetPanel } from './BudgetPanel';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { makeDevice, makeProject } from '../test/fixtures';

describe('BudgetPanel', () => {
  beforeEach(() => {
    useProjectStore.getState().loadProject(
      makeProject({
        devices: [makeDevice('hue-white-e27', 'l1', 0, 0, 'Luz 1'), makeDevice('hue-white-e27', 'l2', 0, 0, 'Luz 2')],
      }),
    );
    useUiStore.getState().reset();
  });

  it('editar el precio unitario cambia el total, se guarda en el proyecto y se puede deshacer', () => {
    render(<BudgetPanel />);
    const before = screen.getByTestId('budget-total').textContent;
    const input = screen.getAllByRole('textbox', { name: /Precio unitario de/ })[0] as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12,50' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByTestId('budget-total')).toHaveTextContent(/25,00\s€/);
    expect(screen.getByTestId('budget-total').textContent).not.toBe(before);
    expect(useProjectStore.getState().project.settings?.prices?.['hue-white-e27']).toBe(12.5);

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.settings?.prices?.['hue-white-e27']).toBeUndefined();
  });

  it('muestra los totales por sala, protocolo y categoría con formato es-ES', () => {
    render(<BudgetPanel />);
    expect(screen.getByRole('region', { name: 'Total por sala' })).toHaveTextContent('Sin sala');
    expect(screen.getByRole('region', { name: 'Total por protocolo' })).toHaveTextContent('2 ud.');
    expect(screen.getByTestId('budget-total').textContent).toMatch(/€$/);
  });
});
