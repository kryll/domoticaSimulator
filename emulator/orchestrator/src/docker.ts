// Control mínimo de contenedores por el socket de Docker (opcional): parar y arrancar el HA del
// lab al restaurar un snapshot. Sin socket, el orquestador pide el reinicio a HA por su API.
import { request } from 'node:http';
import { access } from 'node:fs/promises';

export interface ContainerControl {
  available(): Promise<boolean>;
  stop(name: string): Promise<void>;
  start(name: string): Promise<void>;
}

export function dockerSocketControl(socketPath = '/var/run/docker.sock'): ContainerControl {
  const call = (method: string, path: string): Promise<number> =>
    new Promise((resolve, reject) => {
      const req = request({ socketPath, path, method, timeout: 60_000 }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('Docker no responde')));
      req.end();
    });
  const ok = async (method: string, path: string): Promise<void> => {
    const code = await call(method, path);
    // 204: hecho; 304: ya estaba en ese estado.
    if (code !== 204 && code !== 304) throw new Error(`Docker respondió ${code} a ${path}`);
  };
  return {
    available: async () => {
      try {
        await access(socketPath);
        return (await call('GET', '/_ping')) === 200;
      } catch {
        return false;
      }
    },
    stop: (name) => ok('POST', `/containers/${encodeURIComponent(name)}/stop?t=30`),
    start: (name) => ok('POST', `/containers/${encodeURIComponent(name)}/start`),
  };
}
