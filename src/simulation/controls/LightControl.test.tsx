import { fireEvent, render, screen } from '@testing-library/react';
import { LightControl } from './LightControl';

describe('LightControl', () => {
  it('el color se aplica en el change nativo, no en cada movimiento', () => {
    const onService = vi.fn();
    render(
      <LightControl
        entityId="light.x"
        definition={{ key: 'light', domain: 'light', name: 'Luz', initialState: 'on', capabilities: { colorModes: ['brightness', 'rgb'] } }}
        state={{ state: 'on', attributes: { brightness: 255 } }}
        onService={onService}
      />,
    );
    const input = screen.getByLabelText('Color');
    fireEvent.input(input, { target: { value: '#ff0000' } });
    expect(onService).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '#ff0000' } });
    expect(onService).toHaveBeenCalledWith('turn_on', { rgb_color: '[255, 0, 0]' });
  });
});
