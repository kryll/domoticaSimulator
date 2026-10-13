// Cifrado de la API nativa de ESPHome (lado del dispositivo): Noise_NNpsk0_25519_ChaChaPoly_SHA256
// con el prólogo «NoiseAPIInit\0\0», igual que el firmware y aioesphomeapi. Solo usa node:crypto.
//
//   -> psk, e        (el cliente, con la clave compartida de 32 bytes en base64)
//   <- e, ee         (el dispositivo)
// Después, cada sentido cifra con ChaCha20-Poly1305 (nonce = 4 bytes a 0 + contador de 64 bits LE).
import { createCipheriv, createDecipheriv, createHash, createHmac, createPublicKey, diffieHellman, generateKeyPairSync, type KeyObject } from 'node:crypto';

export const NOISE_PROTOCOL_NAME = 'Noise_NNpsk0_25519_ChaChaPoly_SHA256';
export const NOISE_PROLOGUE = Buffer.from('NoiseAPIInit\0\0', 'binary');
const TAG = 16;
const EMPTY = Buffer.alloc(0);

const sha256 = (...parts: Buffer[]): Buffer => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
};

const hmac = (key: Buffer, ...parts: Buffer[]): Buffer => {
  const h = createHmac('sha256', key);
  for (const p of parts) h.update(p);
  return h.digest();
};

/** HKDF de Noise con HMAC-SHA256: 2 o 3 salidas de 32 bytes. */
function hkdf(ck: Buffer, ikm: Buffer, n: 2 | 3): Buffer[] {
  const temp = hmac(ck, ikm);
  const o1 = hmac(temp, Buffer.from([1]));
  const o2 = hmac(temp, o1, Buffer.from([2]));
  if (n === 2) return [o1, o2];
  return [o1, o2, hmac(temp, o2, Buffer.from([3]))];
}

function nonce(n: bigint): Buffer {
  const b = Buffer.alloc(12);
  b.writeBigUInt64LE(n, 4);
  return b;
}

export function aeadEncrypt(key: Buffer, n: bigint, ad: Buffer, plaintext: Buffer): Buffer {
  const c = createCipheriv('chacha20-poly1305', key, nonce(n), { authTagLength: TAG });
  c.setAAD(ad, { plaintextLength: plaintext.length });
  return Buffer.concat([c.update(plaintext), c.final(), c.getAuthTag()]);
}

/** Lanza si la etiqueta no cuadra (clave equivocada). */
export function aeadDecrypt(key: Buffer, n: bigint, ad: Buffer, ciphertext: Buffer): Buffer {
  if (ciphertext.length < TAG) throw new Error('trama cifrada demasiado corta');
  const d = createDecipheriv('chacha20-poly1305', key, nonce(n), { authTagLength: TAG });
  d.setAAD(ad, { plaintextLength: ciphertext.length - TAG });
  d.setAuthTag(ciphertext.subarray(ciphertext.length - TAG));
  return Buffer.concat([d.update(ciphertext.subarray(0, ciphertext.length - TAG)), d.final()]);
}

/** Estado de cifrado de un sentido de la conexión. */
export class CipherState {
  private n = 0n;
  constructor(private readonly key: Buffer) {}

  encrypt(plaintext: Buffer): Buffer {
    return aeadEncrypt(this.key, this.n++, EMPTY, plaintext);
  }

  decrypt(ciphertext: Buffer): Buffer {
    const out = aeadDecrypt(this.key, this.n, EMPTY, ciphertext);
    this.n++;
    return out;
  }
}

function rawPublicKey(key: KeyObject): Buffer {
  const jwk = key.export({ format: 'jwk' });
  if (typeof jwk.x !== 'string') throw new Error('clave X25519 sin coordenada x');
  return Buffer.from(jwk.x, 'base64url');
}

function publicKeyFromRaw(raw: Buffer): KeyObject {
  return createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: raw.toString('base64url') }, format: 'jwk' });
}

/** Clave compartida (noise_psk) en base64 → 32 bytes. Lanza si no es válida. */
export function decodePsk(psk: string): Buffer {
  const raw = Buffer.from(psk.trim(), 'base64');
  if (raw.length !== 32) throw new Error('La clave de cifrado de ESPHome debe ser de 32 bytes en base64');
  return raw;
}

interface SymmetricState {
  h: Buffer;
  ck: Buffer;
  k?: Buffer;
  n: bigint;
}

function mixHash(s: SymmetricState, data: Buffer): void {
  s.h = sha256(s.h, data);
}

function mixKey(s: SymmetricState, ikm: Buffer): void {
  const [ck, k] = hkdf(s.ck, ikm, 2);
  s.ck = ck ?? s.ck;
  s.k = k;
  s.n = 0n;
}

function mixKeyAndHash(s: SymmetricState, ikm: Buffer): void {
  const [ck, th, k] = hkdf(s.ck, ikm, 3);
  s.ck = ck ?? s.ck;
  mixHash(s, th ?? EMPTY);
  s.k = k;
  s.n = 0n;
}

function encryptAndHash(s: SymmetricState, plaintext: Buffer): Buffer {
  if (!s.k) throw new Error('Noise sin clave');
  const ct = aeadEncrypt(s.k, s.n++, s.h, plaintext);
  mixHash(s, ct);
  return ct;
}

function decryptAndHash(s: SymmetricState, ciphertext: Buffer): Buffer {
  if (!s.k) throw new Error('Noise sin clave');
  const pt = aeadDecrypt(s.k, s.n, s.h, ciphertext);
  s.n++;
  mixHash(s, ciphertext);
  return pt;
}

function initialState(): SymmetricState {
  const name = Buffer.from(NOISE_PROTOCOL_NAME, 'ascii');
  const h = name.length <= 32 ? Buffer.concat([name, Buffer.alloc(32 - name.length)]) : sha256(name);
  const s: SymmetricState = { h, ck: Buffer.from(h), n: 0n };
  mixHash(s, NOISE_PROLOGUE);
  return s;
}

export interface NoiseSession {
  /** Mensaje 2 del handshake (e del dispositivo + etiqueta). */
  reply: Buffer;
  /** Cliente → dispositivo. */
  decrypt: CipherState;
  /** Dispositivo → cliente. */
  encrypt: CipherState;
}

/**
 * Lado del dispositivo (responder): procesa el mensaje 1 del cliente y prepara el 2. Lanza
 * 'Handshake MAC failure' si la clave del cliente no es la del nodo.
 */
export function respondHandshake(psk: Buffer, message1: Buffer): NoiseSession {
  if (message1.length < 32 + TAG) throw new Error('Handshake demasiado corto');
  const s = initialState();
  // -> psk, e
  mixKeyAndHash(s, psk);
  const re = message1.subarray(0, 32);
  mixHash(s, re);
  mixKey(s, re);
  try {
    decryptAndHash(s, message1.subarray(32));
  } catch {
    throw new Error('Handshake MAC failure');
  }
  // <- e, ee
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  const e = rawPublicKey(publicKey);
  mixHash(s, e);
  mixKey(s, e);
  mixKey(s, diffieHellman({ privateKey, publicKey: publicKeyFromRaw(re) }));
  const tag = encryptAndHash(s, EMPTY);
  const [k1, k2] = hkdf(s.ck, EMPTY, 2);
  if (!k1 || !k2) throw new Error('Noise: split sin claves');
  return { reply: Buffer.concat([e, tag]), decrypt: new CipherState(k1), encrypt: new CipherState(k2) };
}

/**
 * Lado del cliente (initiator), solo para los tests: mensaje 1 y, con la respuesta, las claves.
 */
export function initiateHandshake(psk: Buffer): { message1: Buffer; finish: (message2: Buffer) => { encrypt: CipherState; decrypt: CipherState } } {
  const s = initialState();
  mixKeyAndHash(s, psk);
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  const e = rawPublicKey(publicKey);
  mixHash(s, e);
  mixKey(s, e);
  const message1 = Buffer.concat([e, encryptAndHash(s, EMPTY)]);
  return {
    message1,
    finish: (message2: Buffer) => {
      const re = message2.subarray(0, 32);
      mixHash(s, re);
      mixKey(s, re);
      mixKey(s, diffieHellman({ privateKey, publicKey: publicKeyFromRaw(re) }));
      decryptAndHash(s, message2.subarray(32));
      const [k1, k2] = hkdf(s.ck, EMPTY, 2);
      if (!k1 || !k2) throw new Error('Noise: split sin claves');
      return { encrypt: new CipherState(k1), decrypt: new CipherState(k2) };
    },
  };
}
