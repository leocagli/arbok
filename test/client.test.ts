import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createBaseClient } from '../src/client.js'
import type { BaseClientOptions } from '../src/types.js'
import { ATTR_NAMESPACE, ATTR_TYPE, ATTR_UUID, ATTR_WALLET, EXTENSION_TYPE, PROFILE_TYPE } from '../src/constants.js'

// ─── Mock ArkaCDN ──────────────────────────────────────────────────────────────

function makeEntity(key: string, data: unknown) {
  return {
    key,
    attributes: [] as { key: string; value: string | number }[],
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
    _predicates: [] as { key: string; value: string | number }[],
    where(pred: unknown) { return this },
    withPayload(v?: boolean) { return this },
    withAttributes(v?: boolean) { return this },
    fetch: vi.fn(async () => ({ entities, cursor: undefined, blockNumber: undefined })),
    limit(n: number) { return this },
    ownedBy(addr: string) { return this },
    orderBy(...args: unknown[]) { return this },
    withMetadata(v?: boolean) { return this },
    validAtBlock(b: bigint) { return this },
    cursor(c: string) { return this },
    count: vi.fn(async () => entities.length),
  }

  const cdn = {
    entity: {
      query: vi.fn(() => ({ ...queryBuilder })),
      create: vi.fn(async (params: { payload: Uint8Array; attributes: { key: string; value: string | number }[] }) => {
        const key = `0x${Math.random().toString(16).slice(2)}`
        const data = JSON.parse(new TextDecoder().decode(params.payload))
        entities.push(makeEntity(key, data))
        return { entityKey: key, txHash: '0xdeadbeef' }
      }),
      update: vi.fn(async (params: { entityKey: string; payload: Uint8Array }) => {
        const idx = entities.findIndex(e => e.key === params.entityKey)
        if (idx >= 0) {
          const data = JSON.parse(new TextDecoder().decode(params.payload))
          entities[idx] = makeEntity(params.entityKey, data)
        }
        return { txHash: '0xdeadbeef' }
      }),
      delete: vi.fn(async () => ({ txHash: '0xdeadbeef' })),
      extend: vi.fn(async () => ({ txHash: '0xdeadbeef' })),
      batch: vi.fn(async () => ({ txHash: '0xdeadbeef', createdEntities: [] })),
      get: vi.fn(async (key: string) => {
        const e = entities.find(x => x.key === key)
        if (!e) throw new Error('not found')
        return e
      }),
      watch: vi.fn(() => ({
        on: vi.fn().mockReturnThis(),
        off: vi.fn().mockReturnThis(),
        once: vi.fn().mockReturnThis(),
        //@ts-ignore
        start: vi.fn(async function () { return this }),
        stop: vi.fn(),
        started: false,
      })),
    },
    file: {} as unknown,
  } as unknown

  return { cdn, entities, queryBuilder }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeOptions(cdnOverride?: unknown): BaseClientOptions {
  return {
    uuid: 'test-uuid-1234',
    wallet: '0xdeadbeef1234',
    photo: 'https://example.com/photo.png',
    displayName: 'Test User',
    cdn: (cdnOverride ?? makeMockCdn().cdn) as BaseClientOptions['cdn'],
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('createBaseClient', () => {
  it('exposes uuid and wallet as read-only properties', () => {
    const { cdn } = makeMockCdn()
    const client = createBaseClient(makeOptions(cdn))
    expect(client.uuid).toBe('test-uuid-1234')
    expect(client.wallet).toBe('0xdeadbeef1234')
  })

  describe('get()', () => {
    it('returns null when no profile exists', async () => {
      const { cdn } = makeMockCdn([])
      const client = createBaseClient(makeOptions(cdn))
      const result = await client.get()
      expect(result).toBeNull()
    })

    it('returns existing profile', async () => {
      const profileData = {
        uuid: 'test-uuid-1234',
        wallet: '0xdeadbeef1234',
        photo: 'https://example.com/photo.png',
        createdAt: 1000,
        updatedAt: 1000,
      }
      const { cdn } = makeMockCdn([makeEntity('0xabc', profileData)])
      const client = createBaseClient(makeOptions(cdn))
      const result = await client.get()
      expect(result).not.toBeNull()
      expect(result?.profile.uuid).toBe('test-uuid-1234')
    })
  })

  describe('getOrCreate()', () => {
    it('creates a new profile when none exists', async () => {
      const { cdn } = makeMockCdn([])
      const client = createBaseClient(makeOptions(cdn))

      const result = await client.getOrCreate()

      expect(result.profile.uuid).toBe('test-uuid-1234')
      expect(result.profile.wallet).toBe('0xdeadbeef1234')
      expect(result.profile.photo).toBe('https://example.com/photo.png')
      expect(result.profile.displayName).toBe('Test User')
      expect(result.profile.createdAt).toBeTypeOf('number')
      expect(result.profile.updatedAt).toBeTypeOf('number')
      expect(result.entityKey).toBeTypeOf('string')

      // entity.create should have been called with correct attributes
      expect((cdn as ReturnType<typeof makeMockCdn>['cdn'] & { entity: { create: ReturnType<typeof vi.fn> } }).entity.create).toHaveBeenCalledOnce()
    })

    it('returns existing profile without creating a new one', async () => {
      const profileData = {
        uuid: 'test-uuid-1234',
        wallet: '0xdeadbeef1234',
        photo: 'https://example.com/photo.png',
        createdAt: 999,
        updatedAt: 999,
      }
      const { cdn } = makeMockCdn([makeEntity('0xabc', profileData)])
      const client = createBaseClient(makeOptions(cdn))

      const result = await client.getOrCreate()

      expect(result.profile.createdAt).toBe(999)
      expect((cdn as ReturnType<typeof makeMockCdn>['cdn'] & { entity: { create: ReturnType<typeof vi.fn> } }).entity.create).not.toHaveBeenCalled()
    })
  })

  describe('update()', () => {
    it('throws when profile does not exist', async () => {
      const { cdn } = makeMockCdn([])
      const client = createBaseClient(makeOptions(cdn))
      await expect(client.update({ photo: 'new.png' })).rejects.toThrow('ASide:')
    })

    it('updates mutable fields', async () => {
      const profileData = {
        uuid: 'test-uuid-1234',
        wallet: '0xdeadbeef1234',
        photo: 'old.png',
        createdAt: 500,
        updatedAt: 500,
      }
      const { cdn } = makeMockCdn([makeEntity('0xabc', profileData)])
      const client = createBaseClient(makeOptions(cdn))

      const result = await client.update({ photo: 'new.png', bio: 'Hello!' })

      expect(result.profile.photo).toBe('new.png')
      expect(result.profile.bio).toBe('Hello!')
      // Immutable fields stay the same
      expect(result.profile.uuid).toBe('test-uuid-1234')
      expect(result.profile.wallet).toBe('0xdeadbeef1234')
      expect(result.profile.createdAt).toBe(500)
      expect(result.profile.updatedAt).toBeGreaterThanOrEqual(500)
    })
  })

  describe('sync()', () => {
    it('returns existing profile from current chain without checking others', async () => {
      const profileData = {
        uuid: 'test-uuid-1234',
        wallet: '0xdeadbeef1234',
        photo: 'https://example.com/photo.png',
        createdAt: 100,
        updatedAt: 100,
      }
      const { cdn } = makeMockCdn([makeEntity('0xabc', profileData)])
      const { cdn: otherCdn } = makeMockCdn([])
      const client = createBaseClient(makeOptions(cdn))

      const result = await client.sync([otherCdn as BaseClientOptions['cdn']])

      expect(result.profile.createdAt).toBe(100)
      // Other chain should NOT have been queried
      expect((otherCdn as { entity: { query: ReturnType<typeof vi.fn> } }).entity.query).not.toHaveBeenCalled()
    })

    it('replicates profile from another chain when not found locally', async () => {
      const profileData = {
        uuid: 'test-uuid-1234',
        wallet: '0xdeadbeef1234',
        photo: 'https://example.com/photo.png',
        createdAt: 200,
        updatedAt: 200,
      }
      const { cdn: localCdn } = makeMockCdn([])
      const { cdn: remoteCdn } = makeMockCdn([makeEntity('0xremote', profileData)])
      const client = createBaseClient(makeOptions(localCdn))

      const result = await client.sync([remoteCdn as BaseClientOptions['cdn']])

      expect(result.profile.uuid).toBe('test-uuid-1234')
      expect(result.profile.createdAt).toBe(200)
      expect(result.profile.syncedFrom).toBe('0xremote')
      // Should have been created on local chain
      expect((localCdn as { entity: { create: ReturnType<typeof vi.fn> } }).entity.create).toHaveBeenCalledOnce()
    })

    it('creates a fresh profile when not found on any chain', async () => {
      const { cdn: localCdn } = makeMockCdn([])
      const { cdn: remoteCdn } = makeMockCdn([])
      const client = createBaseClient(makeOptions(localCdn))

      const result = await client.sync([remoteCdn as BaseClientOptions['cdn']])

      expect(result.profile.uuid).toBe('test-uuid-1234')
      expect(result.profile.syncedFrom).toBeUndefined()
      expect((localCdn as { entity: { create: ReturnType<typeof vi.fn> } }).entity.create).toHaveBeenCalledOnce()
    })
  })

  describe('extend()', () => {
    it('returns an extension client for a given namespace', () => {
      const { cdn } = makeMockCdn()
      const client = createBaseClient(makeOptions(cdn))
      const ext = client.extend<{ score: number }>('my-game')
      expect(ext).toBeDefined()
      expect(typeof ext.get).toBe('function')
      expect(typeof ext.getOrCreate).toBe('function')
      expect(typeof ext.update).toBe('function')
    })

    describe('getOrCreate()', () => {
      it('creates a new extension when none exists', async () => {
        const { cdn } = makeMockCdn()
        const client = createBaseClient(makeOptions(cdn))
        const ext = client.extend<{ score: number; level: number }>('my-game')

        const result = await ext.getOrCreate({ score: 0, level: 1 })

        expect(result.extension.namespace).toBe('my-game')
        expect(result.extension.uuid).toBe('test-uuid-1234')
        expect(result.extension.wallet).toBe('0xdeadbeef1234')
        expect(result.extension.data.score).toBe(0)
        expect(result.extension.data.level).toBe(1)
      })

      it('returns existing extension without re-creating', async () => {
        const existingExt = {
          namespace: 'my-game',
          uuid: 'test-uuid-1234',
          wallet: '0xdeadbeef1234',
          data: { score: 9999, level: 10 },
          createdAt: 300,
          updatedAt: 300,
        }
        const { cdn } = makeMockCdn([makeEntity('0xext', existingExt)])
        const client = createBaseClient(makeOptions(cdn))
        const ext = client.extend<{ score: number; level: number }>('my-game')

        const result = await ext.getOrCreate({ score: 0, level: 1 })

        expect(result.extension.data.score).toBe(9999)
        expect((cdn as { entity: { create: ReturnType<typeof vi.fn> } }).entity.create).not.toHaveBeenCalled()
      })
    })

    describe('update()', () => {
      it('throws when extension does not exist', async () => {
        const { cdn } = makeMockCdn()
        const client = createBaseClient(makeOptions(cdn))
        const ext = client.extend<{ score: number }>('my-game')
        await expect(ext.update({ score: 100 })).rejects.toThrow('ASide:')
      })

      it('merges partial update into existing data', async () => {
        const existingExt = {
          namespace: 'my-game',
          uuid: 'test-uuid-1234',
          wallet: '0xdeadbeef1234',
          data: { score: 50, level: 3 },
          createdAt: 400,
          updatedAt: 400,
        }
        const { cdn } = makeMockCdn([makeEntity('0xext', existingExt)])
        const client = createBaseClient(makeOptions(cdn))
        const ext = client.extend<{ score: number; level: number }>('my-game')

        const result = await ext.update({ score: 200 })

        expect(result.extension.data.score).toBe(200)
        expect(result.extension.data.level).toBe(3) // unchanged
        expect(result.extension.updatedAt).toBeGreaterThanOrEqual(400)
      })
    })
  })
})
