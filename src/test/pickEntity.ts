import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** Elige una entidad en el combobox `label` (lo abre, busca y pulsa la opción con ese entity_id). */
export async function pickEntity(label: string, entityId: string, index = 0): Promise<void> {
  const input = screen.getAllByRole('combobox', { name: label })[index];
  if (!input) throw new Error(`No hay combobox «${label}»`);
  await userEvent.click(input);
  const listbox = screen.getByRole('listbox', { name: `Opciones: ${label}` });
  const option = within(listbox)
    .getAllByRole('option')
    .find((o) => o.getAttribute('title') === entityId);
  if (!option) throw new Error(`No hay opción ${entityId} en «${label}»`);
  await userEvent.click(option);
}
