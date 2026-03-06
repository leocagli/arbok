import { describe, it, expect } from 'vitest'
import {
  aesEncrypt,
  aesDecrypt,
  hmacSign,
  hmacVerify,
  generateAesKey,
  generateAppKeyPair,
  ecdhDeriveKeys,
  phraseToCommitment,
  verifyPhraseCommitment,
} from '../src/crypto.js'

// WebCrypto is available in Node.js >= 19 / Vitest's jsdom/node environment

describe('crypto', () => {
  const testKey = generateAesKey() // 32-byte hex key

  describe('generateAesKey()', () => {
    it('returns a 64-char hex string (32 bytes)', () => {
      const key = generateAesKey()
      expect(key).toHaveLength(64)
      expect(/^[0-9a-f]{64}$/.test(key)).toBe(true)
    })

    it('generates unique keys', () => {
      const keys = new Set(Array.from({ length: 10 }, () => generateAesKey()))
      expect(keys.size).toBe(10)
    })
  })

  describe('generateAppKeyPair()', () => {
    it('returns PKCS8 private key and raw P-256 public key', async () => {
      const pair = await generateAppKeyPair()
      // privateKey is PKCS8 DER as hex — at least 100 bytes (200 hex chars)
      expect(pair.privateKey.length).toBeGreaterThan(100)
      expect(/^[0-9a-f]+$/.test(pair.privateKey)).toBe(true)
      // P-256 uncompressed public key = 04 || 32-byte X || 32-byte Y = 65 bytes = 130 hex chars
      expect(pair.publicKey).toHaveLength(130)
      expect(pair.publicKey.startsWith('04')).toBe(true)
    })

    it('generates unique key pairs each time', async () => {
      const [a, b] = await Promise.all([generateAppKeyPair(), generateAppKeyPair()])
      expect(a.publicKey).not.toBe(b.publicKey)
      expect(a.privateKey).not.toBe(b.privateKey)
    })

    it('sets expiresAt based on ttlMs', async () => {
      const ttl = 5000
      const before = Date.now()
      const pair = await generateAppKeyPair(ttl)
      expect(pair.expiresAt).toBeGreaterThanOrEqual(before + ttl)
      expect(pair.expiresAt).toBeLessThanOrEqual(before + ttl + 200)
    })

    it('has a non-empty keyId', async () => {
      const pair = await generateAppKeyPair()
      expect(pair.keyId).toBeTruthy()
      expect(pair.keyId.length).toBeGreaterThan(4)
    })
  })

  describe('ecdhDeriveKeys()', () => {
    it('derives matching encKey and sessionKey from both ends', async () => {
      const appPair = await generateAppKeyPair()
      const ephemeralPair = await generateAppKeyPair()

      // "Client" side: ephemeral private + app public
      const clientKeys = await ecdhDeriveKeys(ephemeralPair.privateKey, appPair.publicKey)
      // "Server" side: app private + ephemeral public
      const serverKeys = await ecdhDeriveKeys(appPair.privateKey, ephemeralPair.publicKey)

      expect(clientKeys.encKey).toBe(serverKeys.encKey)
      expect(clientKeys.sessionKey).toBe(serverKeys.sessionKey)
    })

    it('encKey and sessionKey are different', async () => {
      const appPair = await generateAppKeyPair()
      const ephPair = await generateAppKeyPair()
      const { encKey, sessionKey } = await ecdhDeriveKeys(ephPair.privateKey, appPair.publicKey)
      expect(encKey).not.toBe(sessionKey)
    })

    it('derived keys are 64-char hex strings (32 bytes)', async () => {
      const p1 = await generateAppKeyPair()
      const p2 = await generateAppKeyPair()
      const { encKey, sessionKey } = await ecdhDeriveKeys(p1.privateKey, p2.publicKey)
      expect(encKey).toHaveLength(64)
      expect(sessionKey).toHaveLength(64)
      expect(/^[0-9a-f]{64}$/.test(encKey)).toBe(true)
      expect(/^[0-9a-f]{64}$/.test(sessionKey)).toBe(true)
    })

    it('different key pairs produce different derived keys', async () => {
      const p1 = await generateAppKeyPair()
      const p2 = await generateAppKeyPair()
      const p3 = await generateAppKeyPair()
      const k1 = await ecdhDeriveKeys(p1.privateKey, p2.publicKey)
      const k2 = await ecdhDeriveKeys(p1.privateKey, p3.publicKey)
      expect(k1.encKey).not.toBe(k2.encKey)
    })
  })

  describe('phraseToCommitment() / verifyPhraseCommitment()', () => {
    it('produces hash and salt', async () => {
      const { hash, salt } = await phraseToCommitment('correct-horse-battery-staple')
      expect(hash).toBeTruthy()
      expect(salt).toBeTruthy()
      expect(/^[0-9a-f]+$/.test(hash)).toBe(true)
      expect(/^[0-9a-f]+$/.test(salt)).toBe(true)
    })

    it('generates different salts each call', async () => {
      const c1 = await phraseToCommitment('same phrase')
      const c2 = await phraseToCommitment('same phrase')
      expect(c1.salt).not.toBe(c2.salt)
      expect(c1.hash).not.toBe(c2.hash)
    })

    it('verifies correct phrase', async () => {
      const phrase = 'my-secret-phrase'
      const { hash, salt } = await phraseToCommitment(phrase)
      const ok = await verifyPhraseCommitment(phrase, hash, salt)
      expect(ok).toBe(true)
    })

    it('rejects wrong phrase', async () => {
      const { hash, salt } = await phraseToCommitment('correct-phrase')
      const ok = await verifyPhraseCommitment('wrong-phrase', hash, salt)
      expect(ok).toBe(false)
    })

    it('rejects empty phrase when committed phrase was non-empty', async () => {
      const { hash, salt } = await phraseToCommitment('some-phrase')
      const ok = await verifyPhraseCommitment('', hash, salt)
      expect(ok).toBe(false)
    })
  })

  describe('aesEncrypt / aesDecrypt', () => {
    it('encrypts and decrypts plaintext', async () => {
      const plaintext = 'Hello, ASide!'
      const { ciphertext, iv } = await aesEncrypt(plaintext, testKey)
      const decrypted = await aesDecrypt(ciphertext, iv, testKey)
      expect(decrypted).toBe(plaintext)
    })

    it('produces different ciphertexts each call (due to random IV)', async () => {
      const plaintext = 'same message'
      const a = await aesEncrypt(plaintext, testKey)
      const b = await aesEncrypt(plaintext, testKey)
      expect(a.ciphertext).not.toBe(b.ciphertext)
      expect(a.iv).not.toBe(b.iv)
    })

    it('decrypts JSON payloads correctly', async () => {
      const payload = JSON.stringify({ appId: 'test', permissions: '0'.repeat(32) })
      const { ciphertext, iv } = await aesEncrypt(payload, testKey)
      const decrypted = await aesDecrypt(ciphertext, iv, testKey)
      expect(JSON.parse(decrypted)).toEqual(JSON.parse(payload))
    })

    it('throws on wrong key', async () => {
      const { ciphertext, iv } = await aesEncrypt('secret', testKey)
      const wrongKey = generateAesKey()
      await expect(aesDecrypt(ciphertext, iv, wrongKey)).rejects.toThrow('decryption failed')
    })

    it('throws on wrong IV', async () => {
      const { ciphertext } = await aesEncrypt('secret', testKey)
      const { iv: wrongIv } = await aesEncrypt('other', testKey)
      await expect(aesDecrypt(ciphertext, wrongIv, testKey)).rejects.toThrow('decryption failed')
    })

    it('throws when key is wrong length', async () => {
      const shortKey = 'aabbccdd' // 4 bytes
      await expect(aesEncrypt('test', shortKey)).rejects.toThrow('32 bytes')
    })

    it('accepts Uint8Array key', async () => {
      const keyBytes = new Uint8Array(32).map((_, i) => i)
      const { ciphertext, iv } = await aesEncrypt('test', keyBytes)
      const decrypted = await aesDecrypt(ciphertext, iv, keyBytes)
      expect(decrypted).toBe('test')
    })
  })

  describe('hmacSign / hmacVerify', () => {
    it('signs a message and verifies it', async () => {
      const message = '1234567890:abc'
      const sig = await hmacSign(message, testKey)
      const valid = await hmacVerify(message, sig, testKey)
      expect(valid).toBe(true)
    })

    it('returns false for wrong message', async () => {
      const sig = await hmacSign('correct', testKey)
      const valid = await hmacVerify('tampered', sig, testKey)
      expect(valid).toBe(false)
    })

    it('returns false for wrong key', async () => {
      const sig = await hmacSign('message', testKey)
      const valid = await hmacVerify('message', sig, generateAesKey())
      expect(valid).toBe(false)
    })

    it('produces hex output', async () => {
      const sig = await hmacSign('test', testKey)
      expect(/^[0-9a-f]+$/.test(sig)).toBe(true)
    })
  })
})
