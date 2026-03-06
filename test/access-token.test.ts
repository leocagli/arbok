import { describe, it, expect } from 'vitest'
import { AccessTokenManager } from '../src/access-token.js'
import { generateAppKeyPair } from '../src/crypto.js'
import { SnowflakeGenerator } from '../src/snowflake.js'
import type { SealedAccessToken } from '../src/types.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function makeKeyPair() {
  return generateAppKeyPair()
}

async function makeOptions(overrides: Partial<Parameters<AccessTokenManager['create']>[0]> = {}) {
  const appKeyPair = await makeKeyPair()
  return {
    appId: 'test-app',
    domain: 'test.com',
    permissions: 3n,
    appPublicKey: appKeyPair.publicKey,
    phrase: 'my-secret-phrase',
    _appPrivateKey: appKeyPair.privateKey, // kept alongside for validate calls
    ...overrides,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AccessTokenManager', () => {
  const manager = new AccessTokenManager()

  describe('create()', () => {
    it('returns a sealed token with correct structure', async () => {
      const opts = await makeOptions()
      const { token } = await manager.create(opts)
      expect(token.appId).toBe('test-app')
      expect(token.ciphertext).toBeTruthy()
      expect(token.iv).toBeTruthy()
      expect(token.ephemeralPublicKey).toBeTruthy()
      expect(token.tokenId).toHaveLength(32)
      expect(token.expiresAt).toBeGreaterThan(Date.now())
    })

    it('returns a sessionKey alongside the token', async () => {
      const opts = await makeOptions()
      const result = await manager.create(opts)
      expect(result.sessionKey).toMatch(/^[0-9a-f]{64}$/)
      expect(result.token).toBeDefined()
    })

    it('expiry defaults to 1 hour from now', async () => {
      const before = Date.now()
      const opts = await makeOptions()
      const { token } = await manager.create(opts)
      const after = Date.now()
      expect(token.expiresAt).toBeGreaterThanOrEqual(before + 3_600_000 - 10)
      expect(token.expiresAt).toBeLessThanOrEqual(after + 3_600_000 + 10)
    })

    it('respects custom ttlMs', async () => {
      const before = Date.now()
      const opts = await makeOptions({ ttlMs: 5000 })
      const { token } = await manager.create(opts)
      const after = Date.now()
      expect(token.expiresAt).toBeGreaterThanOrEqual(before + 5000 - 10)
      expect(token.expiresAt).toBeLessThanOrEqual(after + 5000 + 10)
    })

    it('embeds permission snowflake from bigint', async () => {
      const opts = await makeOptions({ permissions: 1n })
      const { token } = await manager.create(opts)
      const result = await manager.validate({ token, appPrivateKey: opts._appPrivateKey })
      expect(result.valid).toBe(true)
    })

    it('two tokens from same app keypair have different ephemeral public keys', async () => {
      const opts = await makeOptions()
      const { token: t1 } = await manager.create(opts)
      const { token: t2 } = await manager.create(opts)
      expect(t1.ephemeralPublicKey).not.toBe(t2.ephemeralPublicKey)
    })
  })

  describe('validate()', () => {
    it('validates a fresh token successfully', async () => {
      const opts = await makeOptions()
      const { token } = await manager.create(opts)
      const result = await manager.validate({ token, appPrivateKey: opts._appPrivateKey })

      expect(result.valid).toBe(true)
      if (!result.valid) return
      expect(result.claims.appId).toBe('test-app')
      expect(result.claims.domain).toBe('test.com')
      expect(result.phrase).toBe('my-secret-phrase')
    })

    it('returns a sessionKey matching the one from create()', async () => {
      const opts = await makeOptions()
      const { token, sessionKey: createdKey } = await manager.create(opts)
      const result = await manager.validate({ token, appPrivateKey: opts._appPrivateKey })
      expect(result.valid).toBe(true)
      if (!result.valid) return
      expect(result.sessionKey).toBe(createdKey)
    })

    it('fails for expired token', async () => {
      const opts = await makeOptions({ ttlMs: -1000 })
      const { token } = await manager.create(opts)
      const result = await manager.validate({ token, appPrivateKey: opts._appPrivateKey })
      expect(result.valid).toBe(false)
      if (result.valid) return
      expect(result.reason).toMatch(/expired/i)
    })

    it('fails for wrong app private key', async () => {
      const opts = await makeOptions()
      const { token } = await manager.create(opts)
      const wrongPair = await generateAppKeyPair()
      const result = await manager.validate({ token, appPrivateKey: wrongPair.privateKey })
      expect(result.valid).toBe(false)
    })

    it('fails for domain mismatch', async () => {
      const opts = await makeOptions()
      const { token } = await manager.create(opts)
      const result = await manager.validate({
        token,
        appPrivateKey: opts._appPrivateKey,
        expectedDomain: 'other.com',
      })
      expect(result.valid).toBe(false)
      if (result.valid) return
      expect(result.reason).toMatch(/domain/i)
    })

    it('fails for appId mismatch', async () => {
      const opts = await makeOptions()
      const { token } = await manager.create(opts)
      const result = await manager.validate({
        token,
        appPrivateKey: opts._appPrivateKey,
        expectedAppId: 'other-app',
      })
      expect(result.valid).toBe(false)
      if (result.valid) return
      expect(result.reason).toMatch(/app id/i)
    })

    it('fails when tokenId envelope is tampered', async () => {
      const opts = await makeOptions()
      const { token } = await manager.create(opts)
      const tampered: SealedAccessToken = { ...token, tokenId: '0'.repeat(32) }
      const result = await manager.validate({ token: tampered, appPrivateKey: opts._appPrivateKey })
      expect(result.valid).toBe(false)
    })
  })

  describe('createSessionRequest()', () => {
    it('produces a valid session request', async () => {
      const opts = await makeOptions()
      const { token, sessionKey } = await manager.create(opts)
      const req = await manager.createSessionRequest(token, sessionKey)
      expect(req.token).toBe(token)
      expect(req.signature).toBeTruthy()
      expect(req.nonce).toHaveLength(32)
      expect(req.requestedAt).toBeCloseTo(Date.now(), -3)
    })

    it('uses a custom nonce when provided', async () => {
      const opts = await makeOptions()
      const { token, sessionKey } = await manager.create(opts)
      const req = await manager.createSessionRequest(token, sessionKey, 'my-nonce')
      expect(req.nonce).toBe('my-nonce')
    })

    it('generates unique nonces for each call', async () => {
      const opts = await makeOptions()
      const { token, sessionKey } = await manager.create(opts)
      const r1 = await manager.createSessionRequest(token, sessionKey)
      const r2 = await manager.createSessionRequest(token, sessionKey)
      expect(r1.nonce).not.toBe(r2.nonce)
    })
  })

  describe('validateSession()', () => {
    it('validates a fresh session request', async () => {
      const opts = await makeOptions()
      const { token, sessionKey } = await manager.create(opts)
      const req = await manager.createSessionRequest(token, sessionKey)
      const result = await manager.validateSession(req, opts._appPrivateKey)
      expect(result.valid).toBe(true)
    })

    it('fails for a stale request (too old)', async () => {
      const opts = await makeOptions()
      const { token, sessionKey } = await manager.create(opts)
      const req = await manager.createSessionRequest(token, sessionKey)
      const stale = { ...req, requestedAt: Date.now() - 10 * 60 * 1000 }
      const result = await manager.validateSession(stale, opts._appPrivateKey)
      expect(result.valid).toBe(false)
      if (result.valid) return
      expect(result.reason).toMatch(/too old/i)
    })

    it('fails for a tampered signature', async () => {
      const opts = await makeOptions()
      const { token, sessionKey } = await manager.create(opts)
      const req = await manager.createSessionRequest(token, sessionKey)
      const tampered = { ...req, signature: 'aa'.repeat(32) }
      const result = await manager.validateSession(tampered, opts._appPrivateKey)
      expect(result.valid).toBe(false)
      if (result.valid) return
      expect(result.reason).toMatch(/signature/i)
    })

    it('fails when nonce is tampered', async () => {
      const opts = await makeOptions()
      const { token, sessionKey } = await manager.create(opts)
      const req = await manager.createSessionRequest(token, sessionKey)
      const tampered = { ...req, nonce: 'tampered-nonce' }
      const result = await manager.validateSession(tampered, opts._appPrivateKey)
      expect(result.valid).toBe(false)
    })
  })
})
