import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { dev, project } from '../devices/testUtils';
import { csvField, devicesToCsv } from './csv';

describe('CSV', () => {
  it('csvField escapa comillas, comas, saltos y fórmulas', () => {
    expect(csvField('simple')).toBe('simple');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('dice "hola"')).toBe('"dice ""hola"""');
    expect(csvField('línea\nnueva')).toBe('"línea\nnueva"');
    expect(csvField('=SUMA(A1)')).toBe("'=SUMA(A1)");
  });

  it('devicesToCsv exporta el inventario', () => {
    const p = project(
      [
        dev('a', 'netatmo-thermostat', undefined, { name: 'Termostato, salón', roomId: 'r1' }),
        dev('b', 'aqara-motion-p1', undefined, { name: 'Sensor "pasillo"', integration: 'zha', floorId: 'f1' }),
        { ...dev('c', 'tapo-p110'), definitionId: 'nada', name: 'Huérfano' },
      ],
      { rooms: [{ id: 'r1', floorId: 'f0', name: 'Salón', polygon: [] }] },
    );
    expect(devicesToCsv(p, catalog).split('\r\n')).toEqual([
      'Nombre,Marca,Modelo,Planta,Sala,Protocolo,Integración,Conectividad',
      '"Termostato, salón",Netatmo,NTH01,Planta baja,Salón,Wi-Fi,Netatmo,Nube',
      '"Sensor ""pasillo""",Aqara,RTCGQ14LM,Primera planta,,Zigbee,ZHA,Local',
      'Huérfano,,,Planta baja,,Wi-Fi,TP-Link Smart Home,',
      '',
    ]);
  });
});
