/**
 * Cross-environment cryptographic primitives for ASide.
 *
 * All operations use the WebCrypto API (`globalThis.crypto.subtle`), which is
 * available in Node.js >= 16 and all modern browsers — no polyfills required.
 *
 * ## Algorithms used
 * - AES-256-GCM   — symmetric encryption with authentication tag
 * - HMAC-SHA256   — message authentication (session request signatures)
 * - ECDH P-256    — asymmetric key exchange (token issuance / validation)
 * - HKDF-SHA256   — key derivation from ECDH shared secret
 * - PBKDF2-SHA256 — phrase commitment (offline-attack resistant hashing)
 */

import {
  AES_IV_BYTES,
  AES_KEY_BYTES,
  DEFAULT_APP_KEY_TTL_MS,
  PBKDF2_ITERATIONS,
  PBKDF2_KEY_BYTES,
} from './constants.js'
import type { AppKeyPair } from './types.js'

// ─── Internal helpers ─────────────────────────────────────────────────────────

function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error(
      'ASide: WebCrypto SubtleCrypto is not available in this environment. '
      + 'Node.js >= 16 required, or run in a modern browser.',
    )
  }
  return subtle
}

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n)
  globalThis.crypto.getRandomValues(buf)
  return buf
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.startsWith('0x')) hex = hex.slice(2)
  if (hex.length % 2 !== 0) throw new Error('ASide: invalid hex string length')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return out
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function toBase64url(bytes: Uint8Array): string {
  // Use btoa which is available in both browser and Node.js >= 16
  const binary = Array.from(bytes, b => String.fromCharCode(b)).join('')
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function fromBase64url(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(str.length + (4 - str.length % 4) % 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// Ensure the underlying buffer is a plain ArrayBuffer (not SharedArrayBuffer).
// TypeScript's DOM lib requires `ArrayBufferView<ArrayBuffer>` for BufferSource.
function b(u8: Uint8Array): Uint8Array<ArrayBuffer> {
  if (u8.buffer instanceof ArrayBuffer) {
    // Safe to assert — we confirmed the buffer type at runtime.
    return u8 as unknown as Uint8Array<ArrayBuffer>
  }
  const clean = new Uint8Array(u8.byteLength)
  clean.set(u8)
  return clean as unknown as Uint8Array<ArrayBuffer>
}

function normalizeKey(key: string | Uint8Array): Uint8Array {
  if (typeof key === 'string') return hexToBytes(key)
  return key
}

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return getSubtle().importKey(
    'raw',
    b(raw),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function importHmacKey(raw: Uint8Array): Promise<CryptoKey> {
  return getSubtle().importKey(
    'raw',
    b(raw),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

// ─── Public API ───────────────────────────────────────────────────────────────

const enc = new TextEncoder()
const dec = new TextDecoder()

/**
 * Encrypts `plaintext` with AES-256-GCM using `key`.
 * Returns `{ ciphertext, iv }` both as base64url strings.
 */
export async function aesEncrypt(
  plaintext: string,
  key: string | Uint8Array,
): Promise<{ ciphertext: string; iv: string }> {
  const rawKey = normalizeKey(key)
  if (rawKey.length !== AES_KEY_BYTES) {
    throw new Error(`ASide: AES key must be ${AES_KEY_BYTES} bytes, got ${rawKey.length}`)
  }

  const iv = randomBytes(AES_IV_BYTES)
  const cryptoKey = await importAesKey(rawKey)

  const encrypted = await getSubtle().encrypt(
    { name: 'AES-GCM', iv: b(iv) },
    cryptoKey,
    b(enc.encode(plaintext)),
  )

  return {
    ciphertext: toBase64url(new Uint8Array(encrypted)),
    iv: toBase64url(iv),
  }
}

/**
 * Decrypts `ciphertext` (base64url) with AES-256-GCM.
 * Returns the plaintext string.
 */
export async function aesDecrypt(
  ciphertext: string,
  iv: string,
  key: string | Uint8Array,
): Promise<string> {
  const rawKey = normalizeKey(key)
  if (rawKey.length !== AES_KEY_BYTES) {
    throw new Error(`ASide: AES key must be ${AES_KEY_BYTES} bytes, got ${rawKey.length}`)
  }

  const cryptoKey = await importAesKey(rawKey)

  let decrypted: ArrayBuffer
  try {
    decrypted = await getSubtle().decrypt(
      { name: 'AES-GCM', iv: b(fromBase64url(iv)) },
      cryptoKey,
      b(fromBase64url(ciphertext)),
    )
  }
  catch {
    throw new Error('ASide: decryption failed — invalid key, IV, or corrupted ciphertext')
  }

  return dec.decode(decrypted)
}

/**
 * Computes HMAC-SHA256 over `message` (string) with `key`.
 * Returns the signature as a hex string.
 */
export async function hmacSign(
  message: string,
  key: string | Uint8Array,
): Promise<string> {
  const rawKey = normalizeKey(key)
  const cryptoKey = await importHmacKey(rawKey)
  const sig = await getSubtle().sign('HMAC', cryptoKey, b(enc.encode(message)))
  return bytesToHex(new Uint8Array(sig))
}

/**
 * Verifies an HMAC-SHA256 signature.
 * Uses constant-time comparison internally via SubtleCrypto.verify.
 */
export async function hmacVerify(
  message: string,
  signature: string,
  key: string | Uint8Array,
): Promise<boolean> {
  const rawKey = normalizeKey(key)
  const cryptoKey = await importHmacKey(rawKey)
  const sigBytes = hexToBytes(signature)
  return getSubtle().verify('HMAC', cryptoKey, b(sigBytes), b(enc.encode(message)))
}

/**
 * Generates a cryptographically random AES-256 key.
 * Returns as hex string.
 */
export function generateAesKey(): string {
  return bytesToHex(randomBytes(AES_KEY_BYTES))
}

// ─── ECDH P-256 ───────────────────────────────────────────────────────────────

async function importEcdhPrivateKey(hex: string): Promise<CryptoKey> {
  return getSubtle().importKey(
    'pkcs8',
    b(hexToBytes(hex)),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  )
}

async function importEcdhPublicKey(hex: string): Promise<CryptoKey> {
  return getSubtle().importKey(
    'raw',
    b(hexToBytes(hex)),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
}

async function hkdf(ikm: Uint8Array, info: string, length = 32): Promise<Uint8Array> {
  const ikmKey = await getSubtle().importKey('raw', b(ikm), 'HKDF', false, ['deriveBits'])
  const bits = await getSubtle().deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      // Zero salt: IKM is already high-entropy (ECDH output) so salt is optional per RFC 5869.
      salt: b(new Uint8Array(32)),
      info: b(enc.encode(info)),
    },
    ikmKey,
    length * 8,
  )
  return new Uint8Array(bits)
}

/**
 * Generates a new ECDH P-256 key pair for app-server authorization.
 *
 * - The **private key** (PKCS8 hex) is kept on the app server and never shared.
 * - The **public key** (uncompressed P-256 raw hex, 65 bytes) can be published
 *   on-chain alongside the app's identity entity.
 *
 * With this pair the server never needs to transmit a shared secret to clients:
 * each client generates an ephemeral key pair, does ECDH with the published
 * public key, and derives a unique per-token encryption key.
 */
export async function generateAppKeyPair(ttlMs = DEFAULT_APP_KEY_TTL_MS): Promise<AppKeyPair> {
  const kp = await getSubtle().generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  )
  const [privateKeyDer, publicKeyRaw] = await Promise.all([
    getSubtle().exportKey('pkcs8', kp.privateKey),
    getSubtle().exportKey('raw', kp.publicKey),
  ])
  return {
    privateKey: bytesToHex(new Uint8Array(privateKeyDer)),
    publicKey: bytesToHex(new Uint8Array(publicKeyRaw)),
    keyId: bytesToHex(randomBytes(16)),
    createdAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
  }
}

/**
 * Derives a token encryption key and a session HMAC key from an ECDH shared secret.
 *
 * - Call this from the **client side** using the ephemeral private key + app public key.
 * - Call this from the **server side** using the app private key + ephemeral public key.
 *
 * Both sides arrive at identical `encKey` and `sessionKey` without ever transmitting
 * the shared secret.
 *
 * @internal Used by AccessTokenManager.
 */
export async function ecdhDeriveKeys(
  privateKeyHex: string,
  publicKeyHex: string,
): Promise<{ encKey: string; sessionKey: string }> {
  const [privateKey, publicKey] = await Promise.all([
    importEcdhPrivateKey(privateKeyHex),
    importEcdhPublicKey(publicKeyHex),
  ])
  const sharedBits = await getSubtle().deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256,
  )
  const shared = new Uint8Array(sharedBits)
  const [encBytes, sessionBytes] = await Promise.all([
    hkdf(shared, 'aside-token-enc', 32),
    hkdf(shared, 'aside-token-session', 32),
  ])
  return {
    encKey: bytesToHex(encBytes),
    sessionKey: bytesToHex(sessionBytes),
  }
}

// ─── PBKDF2 phrase commitment ─────────────────────────────────────────────────

/**
 * Derives a PBKDF2-SHA256 hash of `phrase` given a random `salt`.
 * Used internally by `phraseToCommitment` and `verifyPhraseCommitment`.
 */
async function pbkdf2Hash(phrase: string, salt: Uint8Array): Promise<Uint8Array> {
  const phraseKey = await getSubtle().importKey(
    'raw',
    b(enc.encode(phrase)),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await getSubtle().deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: b(salt),
      iterations: PBKDF2_ITERATIONS,
    },
    phraseKey,
    PBKDF2_KEY_BYTES * 8,
  )
  return new Uint8Array(bits)
}

/**
 * Produces a PBKDF2-SHA256 commitment from a phrase.
 *
 * Store `{ hash, salt }` instead of the raw phrase. Use `verifyPhraseCommitment`
 * to authenticate a user later without exposing the phrase.
 *
 * @example
 * ```ts
 * const { hash, salt } = await phraseToCommitment('my-secret')
 * // store hash + salt, discard the phrase
 * const ok = await verifyPhraseCommitment('my-secret', hash, salt)  // true
 * ```
 */
export async function phraseToCommitment(
  phrase: string,
): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(32)
  const hash = await pbkdf2Hash(phrase, salt)
  return { hash: bytesToHex(hash), salt: bytesToHex(salt) }
}

/**
 * Constant-time verification of a phrase against a stored PBKDF2 commitment.
 */
export async function verifyPhraseCommitment(
  phrase: string,
  hash: string,
  salt: string,
): Promise<boolean> {
  const computed = await pbkdf2Hash(phrase, hexToBytes(salt))
  const expected = hexToBytes(hash)
  if (computed.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < computed.length; i++) {
    diff |= ((computed[i] ?? 0) ^ (expected[i] ?? 0))
  }
  return diff === 0
}
