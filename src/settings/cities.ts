// Ubicaciones predefinidas (ciudades españolas) para los ajustes del proyecto.

export interface CityPreset {
  name: string;
  latitude: number;
  longitude: number;
  timeZone: string;
}

export const SPANISH_CITIES: CityPreset[] = [
  { name: 'Madrid', latitude: 40.4168, longitude: -3.7038, timeZone: 'Europe/Madrid' },
  { name: 'Barcelona', latitude: 41.3874, longitude: 2.1686, timeZone: 'Europe/Madrid' },
  { name: 'Valencia', latitude: 39.4699, longitude: -0.3763, timeZone: 'Europe/Madrid' },
  { name: 'Sevilla', latitude: 37.3891, longitude: -5.9845, timeZone: 'Europe/Madrid' },
  { name: 'Málaga', latitude: 36.7213, longitude: -4.4214, timeZone: 'Europe/Madrid' },
  { name: 'Zaragoza', latitude: 41.6488, longitude: -0.8891, timeZone: 'Europe/Madrid' },
  { name: 'Bilbao', latitude: 43.263, longitude: -2.935, timeZone: 'Europe/Madrid' },
  { name: 'A Coruña', latitude: 43.3623, longitude: -8.4115, timeZone: 'Europe/Madrid' },
  { name: 'Palma', latitude: 39.5696, longitude: 2.6502, timeZone: 'Europe/Madrid' },
  { name: 'Las Palmas de Gran Canaria', latitude: 28.1235, longitude: -15.4363, timeZone: 'Atlantic/Canary' },
  { name: 'Santa Cruz de Tenerife', latitude: 28.4636, longitude: -16.2518, timeZone: 'Atlantic/Canary' },
];

export const TIME_ZONES = ['Europe/Madrid', 'Atlantic/Canary', 'Europe/Lisbon', 'Europe/London', 'Europe/Paris', 'UTC'];
