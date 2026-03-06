import { describe, it, expect, vi } from 'vitest'
import { SocialClient } from '../src/social.js'

// ─── Mock ArkaCDN ─────────────────────────────────────────────────────────────

type Attr = { key: string; value: string | number }

function makeEntity(key: string, data: unknown, attributes: Attr[] = []) {
  return {
    key,
    toJson: () => data,
    toText: () => JSON.stringify(data),
    attributes,
    contentType: 'application/json' as const,
  }
}

function makeMockCdn(existingEntities: ReturnType<typeof makeEntity>[] = []) {
  const entities = [...existingEntities]

  const makeQueryBuilder = () => {
    const predicates: Attr[] = []
    return {
      where(preds: Attr[]) { predicates.push(...preds); return this },
      withPayload(_v?: boolean) { return this },
      withAttributes(_v?: boolean) { return this },
      withMetadata(_v?: boolean) { return this },
      limit(_n: number) { return this },
      ownedBy(_addr: string) { return this },
      orderBy(..._args: unknown[]) { return this },
      validAtBlock(_b: bigint) { return this },
      cursor(_c: string) { return this },
      fetch: vi.fn(async () => {
        const filtered = entities.filter(e =>
          predicates.every(p => e.attributes.some(a => a.key === p.key && a.value === p.value)),
        )
        return { entities: filtered, cursor: undefined, blockNumber: undefined }
      }),
      count: vi.fn(async () => entities.length),
    }
  }

  const cdn = {
    entity: {
      query: vi.fn(() => makeQueryBuilder()),
      create: vi.fn(async (params: { payload: Uint8Array; attributes: Attr[] }) => {
        const key = `0x${Math.random().toString(16).slice(2).padStart(16, '0')}`
        const data = JSON.parse(new TextDecoder().decode(params.payload))
        entities.push(makeEntity(key, data, params.attributes))
        return { entityKey: key, txHash: '0xdeadbeef' }
      }),
      update: vi.fn(async (params: { entityKey: string; payload: Uint8Array; attributes?: Attr[] }) => {
        const idx = entities.findIndex(e => e.key === params.entityKey)
        if (idx >= 0) {
          const data = JSON.parse(new TextDecoder().decode(params.payload))
          const existingAttrs = entities[idx]?.attributes ?? []
          entities[idx] = makeEntity(params.entityKey, data, params.attributes ?? existingAttrs)
        }
        return { txHash: '0xdeadbeef' }
      }),
    },
  } as unknown

  return { cdn, entities }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeClient(existingEntities: ReturnType<typeof makeEntity>[] = []) {
  const { cdn, entities } = makeMockCdn(existingEntities)
  const client = new SocialClient(cdn as Parameters<typeof SocialClient.prototype.constructor>[0], 'user-1', '0xWallet1')
  return { client, entities, cdn: cdn as ReturnType<typeof makeMockCdn>['cdn'] }
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('SocialClient', () => {
  describe('follow() / unfollow() / isFollowing()', () => {
    it('creates a follow entity', async () => {
      const { client, entities } = makeClient()
      const follow = await client.follow('user-2')
      expect(follow.followerUuid).toBe('user-1')
      expect(follow.followeeUuid).toBe('user-2')
      expect(follow.status).toBe('active')
      expect(entities).toHaveLength(1)
    })

    it('is idempotent when already following', async () => {
      const { client, entities } = makeClient()
      await client.follow('user-2')
      await client.follow('user-2')
      expect(entities).toHaveLength(1)
    })

    it('isFollowing returns true after follow', async () => {
      const { client } = makeClient()
      await client.follow('user-2')
      expect(await client.isFollowing('user-2')).toBe(true)
    })

    it('isFollowing returns false when not following', async () => {
      const { client } = makeClient()
      expect(await client.isFollowing('user-2')).toBe(false)
    })

    it('unfollow sets status to removed', async () => {
      const { client, entities } = makeClient()
      await client.follow('user-2')
      await client.unfollow('user-2')
      expect(entities[0]!['toJson']()['status']).toBe('removed')
    })

    it('isFollowing returns false after unfollow', async () => {
      const { client } = makeClient()
      await client.follow('user-2')
      await client.unfollow('user-2')
      expect(await client.isFollowing('user-2')).toBe(false)
    })

    it('re-follow after unfollow reactivates the entity', async () => {
      const { client, entities } = makeClient()
      await client.follow('user-2')
      await client.unfollow('user-2')
      await client.follow('user-2')
      expect(entities).toHaveLength(1) // same entity reused
      expect(entities[0]!['toJson']()['status']).toBe('active')
    })
  })

  describe('getFollowing() / getFollowers() / getFollowerCounts()', () => {
    it('getFollowing returns active follows by the current user', async () => {
      const { client } = makeClient()
      await client.follow('user-2')
      await client.follow('user-3')
      const following = await client.getFollowing()
      expect(following).toHaveLength(2)
      expect(following.every(f => f.status === 'active')).toBe(true)
    })

    it('getFollowerCounts returns zeros when no followers', async () => {
      const { client } = makeClient()
      const counts = await client.getFollowerCounts()
      expect(counts.followers).toBe(0)
      expect(counts.following).toBe(0)
    })
  })

  describe('sendFriendRequest() / acceptFriendRequest() / rejectFriendRequest() / cancelFriendRequest()', () => {
    it('sends a friend request', async () => {
      const { client, entities } = makeClient()
      const req = await client.sendFriendRequest('user-2')
      expect(req.fromUuid).toBe('user-1')
      expect(req.toUuid).toBe('user-2')
      expect(req.status).toBe('pending')
      expect(entities).toHaveLength(1)
    })

    it('sends a friend request with a message', async () => {
      const { client } = makeClient()
      const req = await client.sendFriendRequest('user-2', 'Hey!')
      expect(req.message).toBe('Hey!')
    })

    it('rejects a friend request', async () => {
      const { cdn, entities } = makeMockCdn()
      // Simulate user-2 receiving the request
      const sender = new SocialClient(cdn as Parameters<typeof SocialClient.prototype.constructor>[0], 'user-1', '0xWallet1')
      const req = await sender.sendFriendRequest('user-2')

      // Create recipient client using same cdn instance
      const recipient = new SocialClient(cdn as Parameters<typeof SocialClient.prototype.constructor>[0], 'user-2', '0xWallet2')
      const updated = await recipient.rejectFriendRequest(req.entityKey)
      expect(updated.status).toBe('rejected')
    })

    it('cancels an outgoing friend request', async () => {
      const { client, entities } = makeClient()
      const req = await client.sendFriendRequest('user-2')
      const updated = await client.cancelFriendRequest(req.entityKey)
      expect(updated.status).toBe('cancelled')
    })

    it('lists pending outgoing requests', async () => {
      const { client } = makeClient()
      await client.sendFriendRequest('user-2')
      await client.sendFriendRequest('user-3')
      const outgoing = await client.getOutgoingFriendRequests()
      expect(outgoing).toHaveLength(2)
      expect(outgoing.every(r => r.status === 'pending')).toBe(true)
    })
  })

  describe('block() / unblock() / isBlocked()', () => {
    it('blocks a user', async () => {
      const { client, entities } = makeClient()
      const block = await client.block('user-2')
      expect(block.byUuid).toBe('user-1')
      expect(block.blockedUuid).toBe('user-2')
      expect(block.status).toBe('active')
    })

    it('isBlocked returns true after block', async () => {
      const { client } = makeClient()
      await client.block('user-2')
      expect(await client.isBlocked('user-2')).toBe(true)
    })

    it('isBlocked returns false when not blocked', async () => {
      const { client } = makeClient()
      expect(await client.isBlocked('user-2')).toBe(false)
    })

    it('unblock sets status to removed', async () => {
      const { client } = makeClient()
      await client.block('user-2')
      await client.unblock('user-2')
      expect(await client.isBlocked('user-2')).toBe(false)
    })

    it('re-blocking a previously unblocked user reactivates the entity', async () => {
      const { client, entities } = makeClient()
      await client.block('user-2')
      await client.unblock('user-2')
      await client.block('user-2')
      expect(entities).toHaveLength(1) // same entity reused
      expect(await client.isBlocked('user-2')).toBe(true)
    })

    it('getBlockedUsers returns only active blocks', async () => {
      const { client } = makeClient()
      await client.block('user-2')
      await client.block('user-3')
      await client.unblock('user-2')
      const blocked = await client.getBlockedUsers()
      expect(blocked).toHaveLength(1)
      expect(blocked[0]!.blockedUuid).toBe('user-3')
    })

    it('block also unfollows the target', async () => {
      const { client } = makeClient()
      await client.follow('user-2')
      await client.block('user-2')
      expect(await client.isFollowing('user-2')).toBe(false)
    })
  })

  describe('getFriends()', () => {
    it('returns accepted friend requests involving the current user', async () => {
      const { cdn } = makeMockCdn()
      const user1 = new SocialClient(cdn as Parameters<typeof SocialClient.prototype.constructor>[0], 'user-1', '0xWallet1')
      const user2 = new SocialClient(cdn as Parameters<typeof SocialClient.prototype.constructor>[0], 'user-2', '0xWallet2')

      const req = await user1.sendFriendRequest('user-2')
      await user2.acceptFriendRequest(req.entityKey)

      const friends1 = await user1.getFriends()
      expect(friends1).toHaveLength(1)
      expect(friends1[0]!.status).toBe('accepted')
    })
  })
})
