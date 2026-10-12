import { useMediaQuery } from './useMediaQuery';

// Puntos de corte de la interfaz (iguales a los de Tailwind). Se consultan con min-width para que,
// sin matchMedia (tests), la interfaz sea la de escritorio.
export const TABLET_QUERY = '(min-width: 768px)';
export const DESKTOP_QUERY = '(min-width: 1024px)';

/** ≥ 768 px: cabecera completa y panel inferior acoplado. */
export function useIsTabletUp(): boolean {
  return useMediaQuery(TABLET_QUERY);
}

/** ≥ 1024 px: catálogo y propiedades fijos a los lados (si no, cajones). */
export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY);
}
