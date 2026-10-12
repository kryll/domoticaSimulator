import { describe, expect, it } from 'vitest';
import { catalog } from './catalog';
import {
  DEFAULT_MOTION_TIMEOUT_SECONDS,
  DEFAULT_TRAVEL_SECONDS,
  entityCapabilities,
  findEntityOwner,
  isDimmable,
  withDefaults,
} from './capabilities';
import { hvacAction } from './climate';
import { formatRgb, kelvinToRgb, parseRgb, rgbToCss } from './color';
import { dev, project } from './testUtils';

describe('color', () => {
  it('parseRgb admite lista, texto con o sin corchetes y hexadecimal', () => {
    expect(parseRgb([255, 0, 0])).toEqual([255, 0, 0]);
    expect(parseRgb('[0, 128, 255]')).toEqual([0, 128, 255]);
    expect(parseRgb('10,20,30')).toEqual([10, 20, 30]);
    expect(parseRgb('#ff8000')).toEqual([255, 128, 0]);
    expect(parseRgb([300, -5, 12.6])).toEqual([255, 0, 13]);
  });

  it('parseRgb rechaza lo que no es un color', () => {
    for (const v of [undefined, 3, true, 'rojo', '[1, 2]', [1, 2], '[1, x, 3]', [1, Number.NaN, 3]]) expect(parseRgb(v)).toBeUndefined();
  });

  it('formatRgb y rgbToCss', () => {
    expect(formatRgb([1, 2, 3])).toBe('[1, 2, 3]');
    expect(parseRgb(formatRgb([4, 5, 6]))).toEqual([4, 5, 6]);
    expect(rgbToCss([1, 2, 3])).toBe('rgb(1, 2, 3)');
  });

  it('kelvinToRgb: cálido tira a naranja, frío a azul, 6600 K casi blanco', () => {
    const [r1, , b1] = kelvinToRgb(2200);
    expect(r1).toBe(255);
    expect(b1).toBeLessThan(120);
    const [r2, , b2] = kelvinToRgb(10000);
    expect(b2).toBe(255);
    expect(r2).toBeLessThan(255);
    expect(kelvinToRgb(6600)).toEqual([255, 255, 255]);
    expect(kelvinToRgb(500)).toEqual(kelvinToRgb(1000));
  });
});

describe('climate', () => {
  it.each([
    ['off', 18, 21, 'off'],
    ['heat', 18, 21, 'heating'],
    ['heat', 21.1, 21, 'idle'],
    ['heat', 23, 21, 'idle'],
    ['cool', 25, 21, 'cooling'],
    ['cool', 18, 21, 'idle'],
    ['heat_cool', 25, 21, 'cooling'],
    ['auto', 19, 21, 'heating'],
    ['heat', undefined, 21, 'idle'],
    ['unavailable', 18, 21, 'off'],
  ] as const)('hvacAction(%s, %s, %s) = %s', (mode, current, target, expected) => {
    expect(hvacAction(mode, current, target)).toBe(expected);
  });
});

describe('capabilities', () => {
  it('withDefaults rellena por dominio sin pisar el catálogo', () => {
    expect(withDefaults('light')).toMatchObject({ colorModes: ['brightness'], minKelvin: 2000, maxKelvin: 6500 });
    expect(withDefaults('light', { colorModes: ['onoff'] }).colorModes).toEqual(['onoff']);
    expect(withDefaults('cover').travelSeconds).toBe(DEFAULT_TRAVEL_SECONDS);
    expect(withDefaults('binary_sensor').motionTimeoutSeconds).toBe(DEFAULT_MOTION_TIMEOUT_SECONDS);
    expect(withDefaults('climate', { minTemp: 5 })).toMatchObject({ minTemp: 5, maxTemp: 35, tempStep: 0.5, hvacModes: ['off', 'heat'] });
    expect(withDefaults('switch', { powerWatts: 10 })).toEqual({ powerWatts: 10 });
  });

  it('isDimmable', () => {
    expect(isDimmable({ colorModes: ['onoff'] })).toBe(false);
    expect(isDimmable({ colorModes: ['color_temp'] })).toBe(true);
    expect(isDimmable({})).toBe(false);
  });

  it('findEntityOwner y entityCapabilities buscan por entity_id del proyecto', () => {
    const p = project([dev('m', 'ikea-vallhorn', undefined, { name: 'Pasillo' }), dev('c', 'ikea-fyrtur', undefined, { name: 'Estor' })]);
    expect(findEntityOwner(p, 'binary_sensor.pasillo_motion', catalog)?.device.id).toBe('m');
    expect(findEntityOwner(p, 'light.nada', catalog)).toBeUndefined();
    expect(entityCapabilities(p, 'binary_sensor.pasillo_motion').motionTimeoutSeconds).toBe(180);
    expect(entityCapabilities(p, 'cover.estor_cover').travelSeconds).toBe(35);
    expect(entityCapabilities(p, 'cover.otra').travelSeconds).toBe(DEFAULT_TRAVEL_SECONDS);
  });
});
