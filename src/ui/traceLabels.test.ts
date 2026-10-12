import { waitStatusText } from './traceLabels';

describe('waitStatusText', () => {
  const describe_ = () => 'Puerta cambió a abierta durante 1 min';
  it('hora, sol con desfase y estado', () => {
    expect(waitStatusText([{ type: 'time', at: '22:00:00' }], describe_)).toBe('Esperando hasta las 22:00');
    expect(waitStatusText([{ type: 'sun', event: 'sunset' }], describe_)).toBe('Esperando al atardecer');
    expect(waitStatusText([{ type: 'sun', event: 'sunrise', offsetMinutes: -15 }], describe_)).toBe('Esperando a 15 min antes del amanecer');
    expect(waitStatusText([{ type: 'state', entityId: 'binary_sensor.p', to: 'on', for: 60 }], describe_)).toBe(
      'Esperando a que puerta cambió a abierta durante 1 min',
    );
  });
});
