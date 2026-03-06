import { describe, it, expect, vi } from 'vitest'
import { BaseClient } from '../src/base-client.js'
import type { BaseClientOptions } from '../src/types.js'

// ─── Mock CDN factory ─────────────────────────────────────────────────────────

function makeEntity(key: string, data: unknown) {
  return {
    key,
    attributes: [] as unknown[],
    payload: new TextEncoder().encode(JSON.stringify(data)),
    toJson: () => data,
    toText: () => JSON.stringify(data),
    contentType: 'application/json' as const,
    owner: undefined,
    expiresAtBlock: undefined,
    createdAtBlock: undefined,
    lastModifiedAtBlock: undefined,
    transactionIndexInBlock: undefined,
    operationIndexInTransaction: undefined,
  }
}

function makeMockCdn(existingEntities: ReturnType<typeof makeEntity>[] = []) {
  const entities = [...existingEntities]
  const queryBuilder = {
    _predicates: [] as unknown[],
    where: vi.fn().mockReturnThis(),
    withPayload: vi.fn().mockReturnThis(),
    withAttributes: vi.fn().mockReturnThis(),
    fetch: vi.fn(async () => ({ entities, cursor: undefined, blockNumber: undefined })),
    limit: vi.fn().mockReturnThis(),
    ownedBy: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    withMetadata: vi.fn().mockReturnThis(),
    validAtBlock: vi.fn().mockReturnThis(),
    cursor: vi.fn().mockReturnThis(),
    count: vi.fn(async () => entities.length),
  }
  const cdn = {
    entity: {
      query: vi.fn(() => ({ ...queryBuilder })),
      create: vi.fn(async (params: { payload: Uint8Array }) => {
        const key = `0x${Math.random().toString(16).slice(2)}`
        const data = JSON.parse(new TextDecoder().decode(params.payload))
        entities.push(makeEntity(key, data))
        return { entityKey: key, txHash: '0xdeadbeef' }
      }),
      update: vi.fn(async () => ({ txHash: '0xdeadbeef' })),
    },
  } as unknown as BaseClientOptions['cdn']
  return { cdn, entities, queryBuilder }
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('BaseClient (class API)', () => {
  describe('constructor', () => {
    it('accepts options without cdn', () => {
      const client = new BaseClient({ uuid: 'u', wallet: '0x1', photo: 'p' })
      expect(client.uuid).toBe('u')
    })

    it('throws on cdn access when not configured', () => {
      const client = new BaseClient({ uuid: 'u', wallet: '0x1', photo: 'p' })
      expect(() => client.cdn).toThrow('no CDN configured')
    })
  })

  describe('setCdn()', () => {
    it('sets the cdn and returns this for chaining', () => {
      const { cdn } = makeMockCdn()
      const client = new BaseClient({ uuid: 'u', wallet: '0x1', photo: 'p' })
      const result = client.setCdn(cdn!)
      expect(result).toBe(client)
      expect(client.cdn).toBe(cdn)
    })
  })

  describe('extensibility', () => {
    it('can be subclassed', async () => {
      class CustomClient extends BaseClient {
        customMethod(): string {
          return `custom:${this.uuid}`
        }
      }
      const { cdn } = makeMockCdn()
      const c = new CustomClient({ uuid: 'custom-uuid', wallet: '0x1', photo: 'p', cdn })
      expect(c.customMethod()).toBe('custom:custom-uuid')
      expect(c).toBeInstanceOf(BaseClient)
    })
  })

  describe('getOnChain()', () => {
    it('fetches profile on a specific CDN', async () => {
      const profileData = { uuid: 'u1', wallet: '0x1', photo: 'p', createdAt: 100, updatedAt: 100 }
      const { cdn: localCdn } = makeMockCdn([])
      const { cdn: remoteCdn } = makeMockCdn([makeEntity('0xremote', profileData)])
      const client = new BaseClient({ uuid: 'u1', wallet: '0x1', photo: 'p', cdn: localCdn! })
      const result = await client.getOnChain(remoteCdn!)
      expect(result?.profile.uuid).toBe('u1')
    })
  })

  describe('watch()', () => {
    it('returns a ProfileWatcher', () => {
      const { cdn } = makeMockCdn()
      const client = new BaseClient({ uuid: 'u', wallet: '0x1', photo: 'p', cdn })
      const watcher = client.watch({ chains: [] })
      expect(typeof watcher.start).toBe('function')
      expect(typeof watcher.stop).toBe('function')
      expect(typeof watcher.poll).toBe('function')
    })
  })

  describe('createAccessToken()', () => {
    it('creates a sealed token with issuer info in the claims', async () => {
      const { cdn } = makeMockCdn()
      const client = new BaseClient({ uuid: 'issuer-uuid', wallet: '0xissuer', photo: 'p', cdn })
      const { generateAppKeyPair, ecdhDeriveKeys } = await import('../src/crypto.js')
      const { aesDecrypt } = await import('../src/crypto.js')
      const appKeyPair = await generateAppKeyPair()

      const { token } = await client.createAccessToken({
        appId: 'my-app',
        domain: 'my-app.com',
        permissions: 1n,
        appPublicKey: appKeyPair.publicKey,
        phrase: 'secret',
      })

      expect(token.appId).toBe('my-app')

      // Decode claims via ECDH (server side)
      const { encKey } = await ecdhDeriveKeys(appKeyPair.privateKey, token.ephemeralPublicKey)
      const plaintext = await aesDecrypt(token.ciphertext, token.iv, encKey)
      const claims = JSON.parse(plaintext)
      expect(claims.issuerUuid).toBe('issuer-uuid')
      expect(claims.issuerWallet).toBe('0xissuer')
      expect(claims.phrase).toBe('secret')
    })
  })
})
