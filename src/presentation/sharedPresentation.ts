// Enlace compartido con «Abrir en modo presentación»: el cliente recibe directamente el visor.
import { decodeProjectFromHash } from '../share/share';
import { openAsNewProject } from '../store/bootstrap';
import { useUiStore } from '../store/uiStore';
import { enterPresentation, wantsPresentation } from './presentationMode';

/** ¿La URL trae un proyecto compartido para abrir en modo presentación? */
export function hasSharedPresentation(hash: string = typeof window === 'undefined' ? '' : window.location.hash): boolean {
  return hash.startsWith('#p=') && wantsPresentation(hash);
}

/**
 * ¿La URL trae un proyecto compartido (#p=...) para ofrecer abrirlo («Proyecto compartido»)?
 * Con «modo=presentacion» se abre directamente en el visor (ver App), sin ese aviso.
 */
export function hasSharedHash(hash: string = typeof window === 'undefined' ? '' : window.location.hash): boolean {
  return hash.startsWith('#p=') && !hasSharedPresentation(hash);
}

function clearHash() {
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch {
    window.location.hash = '';
  }
}

/** Abre el proyecto del enlace como proyecto nuevo y entra en el modo presentación. */
export async function openSharedPresentation(hash: string = window.location.hash): Promise<boolean> {
  try {
    const project = await decodeProjectFromHash(hash);
    await openAsNewProject({ ...project, id: crypto.randomUUID() });
    clearHash();
    enterPresentation({ fullscreen: false });
    return true;
  } catch (err) {
    clearHash();
    useUiStore.getState().notify(`No se pudo abrir el enlace compartido: ${err instanceof Error ? err.message : String(err)}`, 'error');
    return false;
  }
}
