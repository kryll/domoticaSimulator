import { NotificationTray } from '../notifications/NotificationTray';
import { useExtrasStore } from '../store/extrasStore';
import { Button } from './Button';

/** Controles de la Fase 3 en la barra superior: compartir y bandeja de notificaciones. */
export function TopBarExtras() {
  const openDialog = useExtrasStore((s) => s.openDialog);
  return (
    <div className="flex items-center gap-1">
      <Button size="sm" onClick={() => openDialog('share')} title="Generar un enlace con el proyecto">
        <span aria-hidden="true">🔗</span> Compartir
      </Button>
      <NotificationTray />
    </div>
  );
}
