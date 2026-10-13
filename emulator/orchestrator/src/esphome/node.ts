// Un nodo ESPHome emulado: servidor TCP que habla la API nativa (texto plano o Noise), como el
// firmware real. HA lo añade con la integración `esphome` (host 127.0.0.1 y su puerto). Arrancar o
// parar el nodo es abrir o cerrar el servidor: al pararlo, HA lo ve no disponible.
import { createServer, type Server, type Socket } from 'node:net';
import type { EspCommand, EspNodePlan, EspState } from '../../../../src/bridge/esphome/plan';
import { describeEspState } from '../../../../src/bridge/esphome/plan';
import { MSG, deviceInfoResponse, helloResponse, listEntityPacket, messageName, parseCommand, stateResponse, type Packet } from './messages';
import { decodeVarint, encodeVarint, readProto } from './proto';
import { respondHandshake, type CipherState } from './noise';

export interface EspNodeOptions {
  plan: EspNodePlan;
  port: number;
  host?: string;
  /** Clave Noise de 32 bytes; sin ella, texto plano. */
  psk?: Buffer;
  states: () => Map<number, EspState>;
  onCommand: (command: EspCommand) => void;
  /** Resumen de lo que pasa por la API para el inspector de tráfico. */
  onTraffic?: (dir: 'in' | 'out', summary: string) => void;
  onClients?: (count: number) => void;
  log?: (msg: string) => void;
}

const HANDSHAKE_REJECT = 'Handshake MAC failure';

class Connection {
  private buffer = Buffer.alloc(0);
  private mode: 'unknown' | 'plain' | 'noise' = 'unknown';
  private noiseStep: 'hello' | 'handshake' | 'ready' = 'hello';
  private encrypt: CipherState | undefined;
  private decrypt: CipherState | undefined;
  subscribed = false;
  private closed = false;

  constructor(
    readonly socket: Socket,
    private readonly node: EspNodeServer,
  ) {
    socket.setNoDelay(true);
    socket.on('data', (chunk: Buffer) => this.onData(chunk));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.socket.end();
    this.socket.destroy();
  }

  private onData(chunk: Buffer): void {
    if (this.closed) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    try {
      while (!this.closed && this.buffer.length > 0) {
        if (this.mode === 'unknown') this.pickMode();
        if (this.closed) return;
        const consumed = this.mode === 'plain' ? this.readPlain() : this.readNoise();
        if (!consumed) return;
      }
    } catch (err) {
      this.node.log(`conexión cerrada por un error de protocolo: ${err instanceof Error ? err.message : String(err)}`);
      this.close();
    }
  }

  private pickMode(): void {
    const first = this.buffer[0];
    const wantsNoise = this.node.psk !== undefined;
    if (first === 0x00 && !wantsNoise) this.mode = 'plain';
    else if (first === 0x01 && wantsNoise) this.mode = 'noise';
    else if (first === 0x00) {
      // Cliente sin cifrado contra un nodo cifrado: el indicador 0x01 hace que pida la clave.
      this.writeNoiseFrame(Buffer.concat([Buffer.from([0x01]), Buffer.from('Bad indicator byte')]));
      this.close();
    } else {
      // Cliente cifrado contra un nodo sin cifrado: responde en texto plano y cierra.
      this.socket.write(Buffer.from([0x00]));
      this.close();
    }
  }

  // ---------- Texto plano: 0x00, varint(tamaño), varint(tipo), datos ----------

  private readPlain(): boolean {
    const size = decodeVarint(this.buffer, 1);
    if (!size) return false;
    const type = decodeVarint(this.buffer, size.next);
    if (!type) return false;
    const end = type.next + size.value;
    if (this.buffer.length < end) return false;
    const data = this.buffer.subarray(type.next, end);
    this.buffer = this.buffer.subarray(end);
    this.handle(type.value, Buffer.from(data));
    return true;
  }

  // ---------- Noise: 0x01, tamaño (2 bytes), trama ----------

  private readNoise(): boolean {
    if (this.buffer.length < 3) return false;
    if (this.buffer[0] !== 0x01) throw new Error('indicador de trama Noise no válido');
    const len = ((this.buffer[1] ?? 0) << 8) | (this.buffer[2] ?? 0);
    if (this.buffer.length < 3 + len) return false;
    const frame = Buffer.from(this.buffer.subarray(3, 3 + len));
    this.buffer = this.buffer.subarray(3 + len);
    if (this.noiseStep === 'hello') {
      // ServerHello: protocolo elegido (1), nombre y MAC terminados en \0.
      this.writeNoiseFrame(Buffer.concat([Buffer.from([0x01]), Buffer.from(`${this.node.plan.name}\0${this.node.plan.mac}\0`, 'utf8')]));
      this.noiseStep = 'handshake';
      return true;
    }
    if (this.noiseStep === 'handshake') {
      const psk = this.node.psk;
      if (!psk || frame[0] !== 0x00) throw new Error('handshake Noise no válido');
      try {
        const session = respondHandshake(psk, frame.subarray(1));
        this.encrypt = session.encrypt;
        this.decrypt = session.decrypt;
        this.writeNoiseFrame(Buffer.concat([Buffer.from([0x00]), session.reply]));
        this.noiseStep = 'ready';
      } catch {
        this.writeNoiseFrame(Buffer.concat([Buffer.from([0x01]), Buffer.from(HANDSHAKE_REJECT)]));
        this.node.traffic('in', 'Handshake rechazado: la clave de cifrado no es la del nodo');
        this.close();
      }
      return true;
    }
    if (!this.decrypt) throw new Error('Noise sin claves');
    const msg = this.decrypt.decrypt(frame);
    if (msg.length < 4) throw new Error('mensaje Noise demasiado corto');
    const type = ((msg[0] ?? 0) << 8) | (msg[1] ?? 0);
    const size = ((msg[2] ?? 0) << 8) | (msg[3] ?? 0);
    this.handle(type, Buffer.from(msg.subarray(4, 4 + size)));
    return true;
  }

  private writeNoiseFrame(payload: Buffer): void {
    this.socket.write(Buffer.concat([Buffer.from([0x01, (payload.length >> 8) & 0xff, payload.length & 0xff]), payload]));
  }

  send(packets: Packet[]): void {
    if (this.closed || packets.length === 0) return;
    const out: Buffer[] = [];
    for (const p of packets) {
      if (this.mode === 'noise') {
        if (!this.encrypt) return;
        const header = Buffer.from([(p.type >> 8) & 0xff, p.type & 0xff, (p.data.length >> 8) & 0xff, p.data.length & 0xff]);
        const frame = this.encrypt.encrypt(Buffer.concat([header, p.data]));
        out.push(Buffer.from([0x01, (frame.length >> 8) & 0xff, frame.length & 0xff]), frame);
      } else {
        out.push(Buffer.from([0x00]), encodeVarint(p.data.length), encodeVarint(p.type), p.data);
      }
    }
    this.socket.write(Buffer.concat(out));
  }

  private handle(type: number, data: Buffer): void {
    const node = this.node;
    switch (type) {
      case MSG.HelloRequest: {
        const client = readProto(data).string(1);
        node.traffic('in', `Hello de «${client || 'cliente'}»`);
        this.send([helloResponse(node.plan)]);
        return;
      }
      case MSG.DeviceInfoRequest:
        this.send([deviceInfoResponse(node.plan)]);
        return;
      case MSG.ListEntitiesRequest:
        this.send([...node.plan.entities.map(listEntityPacket), { type: MSG.ListEntitiesDoneResponse, data: Buffer.alloc(0) }]);
        node.traffic('out', `ListEntities: ${node.plan.entities.length} entidades`);
        return;
      case MSG.SubscribeStatesRequest:
        this.subscribed = true;
        this.send(node.statePackets(node.options.states()));
        return;
      case MSG.PingRequest:
        this.send([{ type: MSG.PingResponse, data: Buffer.alloc(0) }]);
        return;
      case MSG.DisconnectRequest:
        this.send([{ type: MSG.DisconnectResponse, data: Buffer.alloc(0) }]);
        this.close();
        return;
      case MSG.PingResponse:
      case MSG.DisconnectResponse:
      case MSG.SubscribeLogsRequest:
      case MSG.SubscribeHomeassistantServicesRequest:
      case MSG.SubscribeHomeAssistantStatesRequest:
      case MSG.GetTimeResponse:
      case MSG.HomeAssistantStateResponse:
      case MSG.AuthenticationRequest:
        return;
      default: {
        const command = parseCommand(type, data);
        if (!command) return; // Como el firmware: los mensajes desconocidos se ignoran.
        const entity = node.plan.entities.find((e) => e.key === command.key);
        node.traffic('in', `${messageName(type)} · ${entity?.objectId ?? command.key} · ${describeCommand(command)}`);
        node.options.onCommand(command);
      }
    }
  }
}

function describeCommand(c: EspCommand): string {
  switch (c.type) {
    case 'switch':
      return c.state ? 'on' : 'off';
    case 'button':
      return 'press';
    case 'light':
      return [c.state === undefined ? '' : c.state ? 'on' : 'off', c.brightness === undefined ? '' : `brillo=${Math.round(c.brightness * 100)} %`].filter(Boolean).join(' ') || 'cambio';
    default:
      return String(c.state);
  }
}

export class EspNodeServer {
  private server: Server | undefined;
  private readonly conns = new Set<Connection>();
  plan: EspNodePlan;

  constructor(readonly options: EspNodeOptions) {
    this.plan = options.plan;
  }

  get psk(): Buffer | undefined {
    return this.options.psk;
  }

  get running(): boolean {
    return this.server?.listening === true;
  }

  get clients(): number {
    return this.conns.size;
  }

  log(msg: string): void {
    this.options.log?.(`[esphome ${this.plan.name}] ${msg}`);
  }

  traffic(dir: 'in' | 'out', summary: string): void {
    this.options.onTraffic?.(dir, summary);
  }

  start(): Promise<void> {
    if (this.server) return Promise.resolve();
    const server = createServer((socket) => {
      const conn = new Connection(socket, this);
      this.conns.add(conn);
      this.options.onClients?.(this.conns.size);
      const drop = (): void => {
        if (this.conns.delete(conn)) this.options.onClients?.(this.conns.size);
      };
      socket.on('close', drop);
      socket.on('error', drop);
    });
    this.server = server;
    return new Promise((resolve, reject) => {
      server.once('error', (err) => {
        this.server = undefined;
        reject(err);
      });
      server.listen(this.options.port, this.options.host ?? '127.0.0.1', () => resolve());
    });
  }

  /** Para el nodo: cierra las conexiones (HA lo marca no disponible) y deja de escuchar. */
  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    for (const c of this.conns) c.close();
    this.conns.clear();
    this.options.onClients?.(0);
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /**
   * Cambia las entidades del nodo (como un firmware nuevo): si cambian, se cierran las conexiones
   * para que HA vuelva a pedir la lista.
   */
  updatePlan(plan: EspNodePlan): void {
    const before = JSON.stringify(this.plan);
    this.plan = plan;
    if (before !== JSON.stringify(plan)) for (const c of this.conns) c.close();
  }

  statePackets(states: Map<number, EspState>): Packet[] {
    const out: Packet[] = [];
    for (const e of this.plan.entities) {
      const s = states.get(e.key);
      if (!s) continue;
      const p = stateResponse(e, s);
      if (p) out.push(p);
    }
    return out;
  }

  /** Manda a HA (conexiones suscritas) los estados que han cambiado. */
  pushStates(changed: Map<number, EspState>): void {
    if (changed.size === 0) return;
    const packets = this.statePackets(changed);
    let sent = false;
    for (const c of this.conns) {
      if (!c.subscribed) continue;
      c.send(packets);
      sent = true;
    }
    if (sent) {
      for (const [key, s] of changed) {
        const e = this.plan.entities.find((x) => x.key === key);
        if (e) this.traffic('out', `Estado · ${e.objectId} = ${describeEspState(s)}`);
      }
    }
  }
}
