import { describe, it, expect, vi } from 'vitest'
import { FeedClient } from '../src/feed.js'

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

function makeClient(existingEntities: ReturnType<typeof makeEntity>[] = []) {
  const { cdn, entities } = makeMockCdn(existingEntities)
  const client = new FeedClient(cdn as Parameters<typeof FeedClient.prototype.constructor>[0], 'user-1', '0xWallet1')
  return { client, entities }
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('FeedClient', () => {
  describe('createPost() / getPost()', () => {
    it('creates a post with correct fields', async () => {
      const { client, entities } = makeClient()
      const post = await client.createPost({ content: 'Hello world!' })
      expect(post.authorUuid).toBe('user-1')
      expect(post.content).toBe('Hello world!')
      expect(post.status).toBe('active')
      expect(post.entityKey).toBeTruthy()
      expect(entities).toHaveLength(1)
    })

    it('creates a post with media and tags', async () => {
      const { client } = makeClient()
      const post = await client.createPost({
        content: 'Check this out',
        tags: ['cool', 'test'],
        media: [{ type: 'image', url: 'https://example.com/img.png' }],
      })
      expect(post.tags).toEqual(['cool', 'test'])
      expect(post.media).toHaveLength(1)
    })

    it('getPost returns null for unknown key', async () => {
      const { client } = makeClient()
      expect(await client.getPost('0xunknown')).toBeNull()
    })

    it('getPost returns null for deleted post', async () => {
      const { client } = makeClient()
      const post = await client.createPost({ content: 'Will be deleted' })
      await client.deletePost(post.entityKey)
      expect(await client.getPost(post.entityKey)).toBeNull()
    })
  })

  describe('updatePost()', () => {
    it('updates content and bumps updatedAt', async () => {
      const { client } = makeClient()
      const post = await client.createPost({ content: 'Original' })
      const updated = await client.updatePost(post.entityKey, 'Edited')
      expect(updated.content).toBe('Edited')
      expect(updated.updatedAt).toBeGreaterThanOrEqual(post.updatedAt)
    })

    it('throws when post not found', async () => {
      const { client } = makeClient()
      await expect(client.updatePost('0xmissing', 'x')).rejects.toThrow('ASide:')
    })
  })

  describe('deletePost()', () => {
    it('soft-deletes by setting status to removed', async () => {
      const { client, entities } = makeClient()
      const post = await client.createPost({ content: 'bye' })
      await client.deletePost(post.entityKey)
      expect((entities[0]!['toJson']() as { status: string }).status).toBe('removed')
    })

    it('no-op when post already gone', async () => {
      const { client } = makeClient()
      await expect(client.deletePost('0xgone')).resolves.toBeUndefined()
    })
  })

  describe('getUserPosts()', () => {
    it('returns all active posts for the current user', async () => {
      const { client } = makeClient()
      await client.createPost({ content: 'Post 1' })
      await client.createPost({ content: 'Post 2' })
      const posts = await client.getUserPosts()
      expect(posts).toHaveLength(2)
      expect(posts.every(p => p.status === 'active')).toBe(true)
    })

    it('excludes deleted posts', async () => {
      const { client } = makeClient()
      const p1 = await client.createPost({ content: 'Keep' })
      const p2 = await client.createPost({ content: 'Delete me' })
      await client.deletePost(p2.entityKey)
      const posts = await client.getUserPosts()
      expect(posts).toHaveLength(1)
      expect(posts[0]!.content).toBe('Keep')
    })
  })

  describe('getFeed()', () => {
    it('returns empty array for empty following list', async () => {
      const { client } = makeClient()
      expect(await client.getFeed([])).toEqual([])
    })

    it('returns posts from followed users', async () => {
      const { cdn, entities } = makeMockCdn()
      const author = new FeedClient(cdn as Parameters<typeof FeedClient.prototype.constructor>[0], 'author-uuid', '0xAuthorWallet')
      await author.createPost({ content: 'From author' })

      const viewer = new FeedClient(cdn as Parameters<typeof FeedClient.prototype.constructor>[0], 'viewer-uuid', '0xViewerWallet')
      const feed = await viewer.getFeed(['author-uuid'])
      expect(feed.length).toBeGreaterThan(0)
    })
  })

  describe('react() / like() / unreact() / unlike() / hasReacted()', () => {
    it('like creates a reaction', async () => {
      const { client, entities } = makeClient()
      const post = await client.createPost({ content: 'Like me' })
      const reaction = await client.like(post.entityKey)
      expect(reaction.type).toBe('like')
      expect(reaction.status).toBe('active')
      expect(entities).toHaveLength(2) // post + reaction
    })

    it('hasReacted returns true after like', async () => {
      const { client } = makeClient()
      const post = await client.createPost({ content: 'test' })
      await client.like(post.entityKey)
      expect(await client.hasReacted(post.entityKey)).toBe(true)
    })

    it('hasReacted returns false before like', async () => {
      const { client } = makeClient()
      const post = await client.createPost({ content: 'test' })
      expect(await client.hasReacted(post.entityKey)).toBe(false)
    })

    it('unlike removes the reaction', async () => {
      const { client } = makeClient()
      const post = await client.createPost({ content: 'test' })
      await client.like(post.entityKey)
      await client.unlike(post.entityKey)
      expect(await client.hasReacted(post.entityKey)).toBe(false)
    })

    it('like is idempotent', async () => {
      const { client, entities } = makeClient()
      const post = await client.createPost({ content: 'test' })
      await client.like(post.entityKey)
      await client.like(post.entityKey)
      // Should still be only 1 reaction entity (post + 1 reaction)
      expect(entities).toHaveLength(2)
    })

    it('react supports multiple reaction types', async () => {
      const { client } = makeClient()
      const post = await client.createPost({ content: 'wow' })
      const r = await client.react(post.entityKey, 'love')
      expect(r.type).toBe('love')
    })
  })

  describe('getReactions() / getReactionCounts()', () => {
    it('returns active reactions', async () => {
      const { client } = makeClient()
      const post = await client.createPost({ content: 'test' })
      await client.like(post.entityKey)
      const reactions = await client.getReactions(post.entityKey)
      expect(reactions).toHaveLength(1)
      expect(reactions[0]!.type).toBe('like')
    })

    it('getReactionCounts returns per-type counts', async () => {
      const { client } = makeClient()
      const post = await client.createPost({ content: 'test' })
      await client.react(post.entityKey, 'like')
      await client.react(post.entityKey, 'love')
      const counts = await client.getReactionCounts(post.entityKey)
      expect(counts.like).toBe(1)
      expect(counts.love).toBe(1)
      expect(counts.wow).toBe(0)
    })
  })

  describe('addComment() / editComment() / deleteComment() / getComments()', () => {
    it('adds a comment to a post', async () => {
      const { client } = makeClient()
      const post = await client.createPost({ content: 'Post' })
      const comment = await client.addComment(post.entityKey, 'Great post!')
      expect(comment.content).toBe('Great post!')
      expect(comment.authorUuid).toBe('user-1')
      expect(comment.targetEntityKey).toBe(post.entityKey)
      expect(comment.status).toBe('active')
    })

    it('editComment updates content', async () => {
      const { client } = makeClient()
      const post = await client.createPost({ content: 'Post' })
      const comment = await client.addComment(post.entityKey, 'original')
      const edited = await client.editComment(comment.entityKey, 'edited')
      expect(edited.content).toBe('edited')
    })

    it('deleteComment soft-deletes', async () => {
      const { client } = makeClient()
      const post = await client.createPost({ content: 'Post' })
      const comment = await client.addComment(post.entityKey, 'bye')
      await client.deleteComment(comment.entityKey)
      const comments = await client.getComments(post.entityKey)
      expect(comments).toHaveLength(0)
    })

    it('getComments returns active comments', async () => {
      const { client } = makeClient()
      const post = await client.createPost({ content: 'Post' })
      await client.addComment(post.entityKey, 'comment 1')
      await client.addComment(post.entityKey, 'comment 2')
      const comments = await client.getComments(post.entityKey)
      expect(comments).toHaveLength(2)
    })
  })
})
