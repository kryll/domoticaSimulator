import { createDemoProject } from '../store/demoProject';
import { validateProject } from '../network/validator';
import { catalog } from '../devices/catalog';
it('probe', () => {
  const p = createDemoProject();
  console.log(validateProject(p, catalog).map((i) => `${i.severity} ${i.code} ${i.message}`).join('\n'));
});
