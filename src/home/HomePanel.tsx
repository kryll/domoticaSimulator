import { Suspense, lazy } from 'react';
import { PeopleSection } from '../people/PeopleSection';
import { GroupsSection } from '../groups/GroupsSection';

const VariantsSection = lazy(() => import('../variants/VariantsSection').then((m) => ({ default: m.VariantsSection })));

/** Pestaña «Hogar»: personas y zonas, grupos y variantes del proyecto. */
export function HomePanel() {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,24rem),1fr))] gap-4 p-3">
      <PeopleSection />
      <GroupsSection />
      <Suspense fallback={<p className="text-sm text-slate-500">Cargando variantes…</p>}>
        <VariantsSection />
      </Suspense>
    </div>
  );
}
