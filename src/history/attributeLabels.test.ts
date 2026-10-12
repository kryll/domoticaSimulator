import { attributeMeta, displaySamples } from './attributeLabels';

describe('etiquetas de series del historial', () => {
  it('traduce y escala', () => {
    expect(attributeMeta('brightness')).toMatchObject({ label: 'Brillo', unit: '%' });
    expect(attributeMeta('current_position').label).toBe('Posición');
    expect(attributeMeta('current_temperature')).toMatchObject({ label: 'Temperatura actual', unit: '°C' });
    expect(displaySamples([{ t: 0, v: 255 }, { t: 1, v: 'unknown' }], attributeMeta('brightness'))).toEqual([
      { t: 0, v: 100 },
      { t: 1, v: 'unknown' },
    ]);
    expect(displaySamples([{ t: 0, v: 'heating' }, { t: 1, v: 'idle' }], attributeMeta('hvac_action')).map((s) => s.v)).toEqual(['on', 'off']);
  });
});
