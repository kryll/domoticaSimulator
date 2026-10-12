import type { ServiceField } from '../simulation/serviceCatalog';
import { defaultFieldValue, includeField, missingRequired, withRequiredDefaults } from './serviceFields';

const fields: ServiceField[] = [
  { key: 'brightness_pct', label: 'Brillo', type: 'percent', exclusiveGroup: 'brightness' },
  { key: 'brightness_step_pct', label: 'Variar brillo', type: 'number', exclusiveGroup: 'brightness' },
  { key: 'hvac_mode', label: 'Modo', type: 'select', options: [{ value: 'heat', label: 'Calor' }], required: true },
];

describe('serviceFields', () => {
  it('valores por defecto según el tipo', () => {
    expect(defaultFieldValue(fields[0] as ServiceField)).toBe(100);
    expect(defaultFieldValue(fields[2] as ServiceField)).toBe('heat');
    expect(defaultFieldValue({ key: 'k', label: 'K', type: 'kelvin', min: 2000, max: 6500 })).toBe(4300);
  });

  it('incluir un campo de un grupo exclusivo quita el otro', () => {
    const data = includeField(fields, { brightness_pct: 50, hvac_mode: 'heat' }, fields[1] as ServiceField, 10);
    expect(data).toEqual({ brightness_step_pct: 10, hvac_mode: 'heat' });
  });

  it('obligatorios: detecta los que faltan y los rellena', () => {
    expect(missingRequired(fields, undefined).map((f) => f.key)).toEqual(['hvac_mode']);
    expect(withRequiredDefaults(fields, { brightness_pct: 5 })).toEqual({ brightness_pct: 5, hvac_mode: 'heat' });
    const full = { hvac_mode: 'heat' };
    expect(withRequiredDefaults(fields, full)).toBe(full);
  });
});
