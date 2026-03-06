import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BaseClient } from '../src/base-client.js'
import { ProfileWatcher } from '../src/watcher.js'
import type { BaseClientOptions, ChainCDN } from '../src/types.js'

// ─── Mock CDN factory (reuse pattern from client.test.ts) ─────────────────────

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
      create: vi.fn(async () => {
        const key = `0x${Math.random().toString(16).slice(2)}`
        return { entityKey: key, txHash: '0xdeadbeef' }
      }),
      update: vi.fn(async () => ({ txHash: '0xdeadbeef' })),
    },
  } as unknown as BaseClientOptions['cdn']

  return { cdn, entities, queryBuilder }
}

function makeProfileData(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    uuid: 'watcher-uuid',
    wallet: '0xwallet',
    photo: 'https://photo.com',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('ProfileWatcher', () => {
  let client: BaseClient

  beforeEach(() => {
    const { cdn } = makeMockCdn()
    client = new BaseClient({
      uuid: 'watcher-uuid',
      wallet: '0xwallet',
      photo: 'https://photo.com',
      cdn,
    })
  })

  describe('start() / stop()', () => {
    it('starts and stops cleanly', () => {
      const watcher = new ProfileWatcher(client, {
        chains: [],
        intervalMs: 999999,
      })
      expect(watcher.running).toBe(false)
      watcher.start()
      expect(watcher.running).toBe(true)
      watcher.stop()
      expect(watcher.running).toBe(false)
    })

    it('is idempotent: calling start() twice is safe', () => {
      const watcher = new ProfileWatcher(client, { chains: [] })
      watcher.start()
      watcher.start()
      expect(watcher.running).toBe(true)
      watcher.stop()
    })
  })

  describe('poll()', () => {
    it('returns results for each chain', async () => {
      const { cdn: chain1 } = makeMockCdn([makeEntity('0xabc', makeProfileData())])
      const { cdn: chain2 } = makeMockCdn([])

      const chains: ChainCDN[] = [
        { name: 'kaolin', cdn: chain1! },
        { name: 'mendoza', cdn: chain2! },
      ]

      const watcher = new ProfileWatcher(client, { chains })
      const results = await watcher.poll()

      expect(results).toHaveLength(2)
      expect(results.find(r => r.chain === 'kaolin')?.exists).toBe(true)
      expect(results.find(r => r.chain === 'mendoza')?.exists).toBe(false)
    })

    it('calls onPoll with results', async () => {
      const onPoll = vi.fn()
      const watcher = new ProfileWatcher(client, { chains: [], onPoll })
      await watcher.poll()
      expect(onPoll).toHaveBeenCalledOnce()
    })

    it('calls onFound when profile appears for the first time', async () => {
      const { cdn: chainCdn } = makeMockCdn([makeEntity('0xabc', makeProfileData())])
      const onFound = vi.fn()

      const watcher = new ProfileWatcher(client, {
        chains: [{ name: 'kaolin', cdn: chainCdn! }],
        onFound,
      })

      // First poll — profile found, transition null->true fires onFound
      await watcher.poll()
      expect(onFound).toHaveBeenCalledOnce()
      expect(onFound.mock.calls[0]?.[0]).toBe('kaolin')
    })

    it('does NOT call onFound on the second poll if profile was already there', async () => {
      const { cdn: chainCdn } = makeMockCdn([makeEntity('0xabc', makeProfileData())])
      const onFound = vi.fn()

      const watcher = new ProfileWatcher(client, {
        chains: [{ name: 'kaolin', cdn: chainCdn! }],
        onFound,
      })

      await watcher.poll()
      await watcher.poll()
      expect(onFound).toHaveBeenCalledOnce() // only once — not again
    })

    it('calls onLost when profile disappears', async () => {
      // First poll: profile present
      const { cdn: chainCdn, entities: innerEntities } = makeMockCdn([makeEntity('0xabc', makeProfileData())])
      const onLost = vi.fn()

      const watcher = new ProfileWatcher(client, {
        chains: [{ name: 'kaolin', cdn: chainCdn! }],
        onLost,
      })

      await watcher.poll()       // seen (exists = true)
      innerEntities.length = 0   // remove profile from the mock's internal array
      await watcher.poll()       // now gone (exists = false) -> onLost
      expect(onLost).toHaveBeenCalledOnce()
      expect(onLost.mock.calls[0]?.[0]).toBe('kaolin')
    })
  })
})
