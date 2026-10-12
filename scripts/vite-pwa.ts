// Plugin de Vite que genera el service worker de la PWA (sw.js) al construir: precachea todos
// los ficheros de la build (y los de public/) con rutas relativas al ámbito del service worker,
// de modo que funciona igual con base «/» que con «/domoticaSimulator/» (GitHub Pages).
import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

function listFiles(dir: string, root = dir): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path, root) : [relative(root, path).split(sep).join('/')];
  });
}

/** Código del service worker. `files` va relativo al ámbito (la carpeta base de la app). */
export function serviceWorkerSource(version: string, files: string[]): string {
  return `// Service worker de HA Simulator (generado al construir; no editar).
const VERSION = ${JSON.stringify(version)};
const CACHE = 'ha-simulator-' + VERSION;
const FILES = ${JSON.stringify(files)};
const scoped = (path) => new URL(path, self.registration.scope).href;
const INDEX = scoped('index.html');

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['./', ...FILES].map(scoped))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ha-simulator-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith(self.registration.scope)) return;
  if (request.mode === 'navigate') {
    // Red primero (para ver la versión publicada) y, sin conexión, la app precacheada.
    event.respondWith(
      fetch(request).catch(() =>
        caches.open(CACHE).then((cache) => cache.match(INDEX).then((hit) => hit || cache.match(scoped('./')))),
      ),
    );
    return;
  }
  event.respondWith(
    caches.open(CACHE).then((cache) => cache.match(request, { ignoreSearch: true }).then((hit) => hit || fetch(request))),
  );
});
`;
}

export function pwaServiceWorker(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'ha-simulator-service-worker',
    apply: 'build',
    enforce: 'post',
    configResolved(resolved) {
      config = resolved;
    },
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'sw.js');
      const fromPublic = config.publicDir ? listFiles(config.publicDir) : [];
      const files = [...new Set([...built, ...fromPublic])].sort();
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorkerSource(version, files) });
    },
  };
}
