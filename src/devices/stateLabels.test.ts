import { stateLabel, stateOptions } from './stateLabels';
import { HVAC_ACTION_LABELS, PRESET_LABELS } from './labels';

const labels = (domain: string, dc?: string) => stateOptions(domain, dc).map((o) => o.label);

describe('estados traducidos (tabla única)', () => {
  it('binary_sensor según device_class', () => {
    expect(labels('binary_sensor', 'motion')).toEqual(['Detectado', 'Despejado']);
    expect(labels('binary_sensor', 'door')).toEqual(['Abierta', 'Cerrada']);
    expect(labels('binary_sensor', 'moisture')).toEqual(['Húmedo', 'Seco']);
    expect(labels('binary_sensor')).toEqual(['Activado', 'Desactivado']);
    expect(stateOptions('binary_sensor', 'motion').map((o) => o.value)).toEqual(['on', 'off']);
  });

  it('dominios con varios estados', () => {
    expect(labels('lock')).toEqual(expect.arrayContaining(['Bloqueada', 'Desbloqueada', 'Atascada']));
    expect(labels('cover')).toEqual(['Abierta', 'Cerrada', 'Abriendo', 'Cerrando']);
    expect(labels('climate')).toEqual(expect.arrayContaining(['Calefacción', 'Refrigeración', 'Auto', 'Apagado']));
    expect(stateOptions('climate', undefined, { hvacModes: ['off', 'heat'] })).toEqual([
      { value: 'off', label: 'Apagado' },
      { value: 'heat', label: 'Calefacción' },
    ]);
    expect(labels('media_player')).toEqual(expect.arrayContaining(['Reproduciendo', 'En pausa', 'Inactivo', 'Apagado']));
    expect(labels('person')).toEqual(['En casa', 'Fuera']);
    expect(labels('light')).toEqual(['Encendida', 'Apagada']);
    expect(stateOptions('sensor', 'temperature')).toEqual([]);
    expect(stateOptions('sensor', undefined, { buttonActions: ['single', 'double'] }).map((o) => o.label)).toEqual(['Pulsación', 'Doble']);
  });

  it('stateLabel acepta entity_id o dominio y usa la misma tabla', () => {
    expect(stateLabel('binary_sensor.pasillo_motion', 'on', 'motion')).toBe('Detectado');
    expect(stateLabel('binary_sensor', false, 'door')).toBe('Cerrada');
    expect(stateLabel('lock', 'locked')).toBe('Bloqueada');
    expect(stateLabel('person.ana', 'not_home')).toBe('Fuera');
    expect(stateLabel('cover.x', 'opening')).toBe('Abriendo');
    expect(stateLabel('light', 'unavailable')).toBe('No disponible');
    expect(stateLabel('vacuum', 'raro')).toBe('raro');
    for (const o of stateOptions('lock')) expect(stateLabel('lock', o.value)).toBe(o.label);
  });

  it('presets y acciones HVAC en español', () => {
    expect(PRESET_LABELS.frost_guard).toBe('Antihielo');
    expect(PRESET_LABELS.away).toBe('Ausente');
    expect(PRESET_LABELS.eco).toBe('Eco');
    expect(HVAC_ACTION_LABELS.heating).toBe('Calentando');
    expect(HVAC_ACTION_LABELS.idle).toBe('Inactivo');
  });
});
