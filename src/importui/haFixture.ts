// Ficheros de ejemplo de un Home Assistant real (para los tests y las pruebas del asistente).

export const AREA_REGISTRY = JSON.stringify({
  version: 1,
  key: 'core.area_registry',
  data: {
    areas: [
      { id: 'salon', name: 'Salón', floor_id: null },
      { id: 'cocina', name: 'Cocina', floor_id: null },
    ],
  },
});

export const DEVICE_REGISTRY = JSON.stringify({
  version: 1,
  key: 'core.device_registry',
  data: {
    devices: [
      { id: 'dev-motion', name: 'Movimiento salón', manufacturer: 'LUMI', model: 'lumi.motion.ac02', area_id: 'salon', identifiers: [['zha', '00:15:8d:00:01']] },
      { id: 'dev-bulb', name: 'Bombilla salón', manufacturer: 'IKEA of Sweden', model: 'TRADFRI bulb E27 WS opal 980lm', area_id: 'salon', identifiers: [['zha', '00:15:8d:00:02']] },
      { id: 'dev-widget', name: 'Medidor cocina', manufacturer: 'Acme', model: 'Widget 3000', area_id: 'cocina', identifiers: [['mqtt', 'acme-1']] },
    ],
  },
});

export const ENTITY_REGISTRY = JSON.stringify({
  version: 1,
  key: 'core.entity_registry',
  data: {
    entities: [
      { entity_id: 'binary_sensor.movimiento_salon_occupancy', device_id: 'dev-motion', platform: 'zha', original_device_class: 'motion', disabled_by: null },
      { entity_id: 'sensor.movimiento_salon_illuminance', device_id: 'dev-motion', platform: 'zha', original_device_class: 'illuminance', unit_of_measurement: 'lx', disabled_by: null },
      { entity_id: 'light.bombilla_salon', device_id: 'dev-bulb', platform: 'zha', disabled_by: null },
      { entity_id: 'sensor.medidor_cocina_power', device_id: 'dev-widget', platform: 'mqtt', original_device_class: 'power', unit_of_measurement: 'W', disabled_by: null },
    ],
  },
});

export const AUTOMATIONS_YAML = `- id: '1700000000001'
  alias: Luz del salón con movimiento
  mode: restart
  triggers:
    - trigger: state
      entity_id: binary_sensor.movimiento_salon_occupancy
      to: 'on'
  conditions:
    - condition: time
      after: '18:00:00'
      weekday: [mon, tue, wed, thu, fri]
  actions:
    - action: light.turn_on
      target:
        entity_id: light.bombilla_salon
    - delay: '00:02:00'
    - action: light.turn_off
      target:
        entity_id: light.bombilla_salon
- id: '1700000000002'
  alias: Aviso consumo alto
  triggers:
    - trigger: numeric_state
      entity_id: sensor.medidor_cocina_power
      above: 2000
      for: '00:01:00'
  actions:
    - action: notify.notify
      data:
        message: Consumo alto en la cocina
`;

export const SCENES_YAML = `- id: '1700000000100'
  name: Cine
  entities:
    light.bombilla_salon:
      state: 'on'
      brightness: 60
`;
