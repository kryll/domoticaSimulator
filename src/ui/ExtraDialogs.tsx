import { Suspense, lazy } from 'react';
import { useExtrasStore } from '../store/extrasStore';
import { hasSharedPresentation } from '../presentation/sharedPresentation';

// Diálogos de la Fase 3, cargados bajo demanda.
const HouseTemplatesDialog = lazy(() => import('../templates/HouseTemplatesDialog').then((m) => ({ default: m.HouseTemplatesDialog })));
const PackagesDialog = lazy(() => import('../packages/PackagesDialog').then((m) => ({ default: m.PackagesDialog })));
const ShareDialog = lazy(() => import('../share/ShareDialog').then((m) => ({ default: m.ShareDialog })));
const SharedLinkPrompt = lazy(() => import('../share/SharedLinkPrompt').then((m) => ({ default: m.SharedLinkPrompt })));

/** Ofrece abrir el proyecto del enlace (#p=...) solo si la URL lo trae. */
export function hasSharedHash(): boolean {
  // Con «modo=presentacion» el enlace se abre directamente en el visor (ver App).
  return typeof window !== 'undefined' && window.location.hash.startsWith('#p=') && !hasSharedPresentation();
}

export function ExtraDialogs() {
  const dialog = useExtrasStore((s) => s.dialog);
  const close = useExtrasStore((s) => s.openDialog);
  const onClose = () => close(null);
  return (
    <Suspense fallback={null}>
      {dialog === 'houseTemplates' && <HouseTemplatesDialog onClose={onClose} />}
      {dialog === 'packages' && <PackagesDialog onClose={onClose} />}
      {dialog === 'share' && <ShareDialog onClose={onClose} />}
      {hasSharedHash() && <SharedLinkPrompt />}
    </Suspense>
  );
}
