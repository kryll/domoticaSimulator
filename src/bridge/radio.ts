// Perfiles de radio efectivos: los valores por defecto de docs/EMULACION.md con los ajustes del
// proyecto encima. Funciones puras.
import { defaultRadioProfiles, WIFI_802154_OVERLAP, WIFI_INTERFERENCE_LOSS_PCT, type Project, type Protocol, type RadioProfile } from '../types';

export function radioProfileFor(project: Pick<Project, 'radioProfiles'>, protocol: Protocol): RadioProfile {
  const base = defaultRadioProfiles()[protocol];
  const own = project.radioProfiles?.[protocol];
  if (!own) return base;
  return { ...base, ...own, availability: { ...base.availability, ...own.availability } };
}

/** Pérdida extra (puntos %) de un canal 802.15.4 (Zigbee/Thread) por los canales Wi-Fi en uso. */
export function interferenceLossPct(channel802154: number, wifiChannels: readonly number[]): number {
  return wifiChannels.some((w) => WIFI_802154_OVERLAP[w]?.includes(channel802154)) ? WIFI_INTERFERENCE_LOSS_PCT : 0;
}
