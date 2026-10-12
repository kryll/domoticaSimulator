import { useEffect } from 'react';
import { Panel } from '@xyflow/react';
import { useSimulationStore } from '../store/simulationStore';
import { useProjectStore } from '../store/projectStore';
import { isNight } from '../simulation/engine';

/**
 * Oscurece el plano de noche: cambia una clase en el contenedor del lienzo (no repinta nodos).
 * El selector devuelve un booleano, así que solo provoca un render al amanecer y al atardecer.
 */
export function NightMode({ containerId }: { containerId: string }) {
  const project = useProjectStore((s) => s.project);
  const night = useSimulationStore((s) => isNight(s.sim, project));
  useEffect(() => {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.classList.toggle('ha-night', night);
    return () => el.classList.remove('ha-night');
  }, [night, containerId]);
  return (
    <>
      <div aria-hidden="true" className={`ha-night-veil${night ? ' is-on' : ''}`} />
      {night && (
        <Panel position="top-right">
        <p
          className="pointer-events-none rounded-full bg-indigo-950/80 px-2 py-0.5 text-[11px] font-medium text-indigo-50 shadow"
          role="status"
          data-testid="night-indicator"
        >
          🌙 Es de noche
        </p>
        </Panel>
      )}
    </>
  );
}
