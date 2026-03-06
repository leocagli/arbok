/**
 * FeedClient — posts, likes, comments, and timeline feed.
 *
 * Obtain via `client.feed()`:
 *
 * ```ts
 * const feed = client.feed()
 * const { post } = await feed.createPost({ content: 'Hello world!' })
 * await feed.like(post.entityKey)
 * const timeline = await feed.getFeed()
 * ```
 *
 * All feed data is stored as entities on ArkaCDN.
 */

import { eq, jsonToPayload, ExpirationTime } from './arbok/index.js'
import type { Arbok, Hex } from './arbok/index.js'
import {
  ATTR_TARGET_KEY,
  ATTR_TYPE,
  ATTR_UUID,
  ATTR_WALLET,
  DEFAULT_EXPIRY_SECONDS,
  LEGACY_ARBOK_ATTR_TARGET_KEY,
  LEGACY_ARBOK_ATTR_TYPE,
  LEGACY_ARBOK_ATTR_UUID,
  LEGACY_ARBOK_ATTR_WALLET,
  LEGACY_ATTR_TARGET_KEY,
  LEGACY_ATTR_TYPE,
  LEGACY_ATTR_UUID,
  LEGACY_ATTR_WALLET,
  LEGACY_SOCIAL_COMMENT_TYPE,
  LEGACY_SOCIAL_POST_TYPE,
  LEGACY_SOCIAL_REACTION_TYPE,
  SOCIAL_COMMENT_TYPE,
  SOCIAL_POST_TYPE,
  SOCIAL_REACTION_TYPE,
} from './constants.js'
import type {
  CreatePostOptions,
  PaginationOptions,
  ReactionType,
  SocialComment,
  SocialPost,
  SocialReaction,
} from './types.js'

export class FeedClient {
  constructor(
    private readonly cdn: Arbok,
    private readonly uuid: string,
    private readonly wallet: string,
  ) { }

  // ─── Posts ────────────────────────────────────────────────────────────────

  /**
   * Creates a new post. Returns the created {@link SocialPost}.
   */
  async createPost(options: CreatePostOptions): Promise<SocialPost> {
    const now = Date.now()
    const post: Omit<SocialPost, 'entityKey'> = {
      authorUuid: this.uuid,
      authorWallet: this.wallet,
      content: options.content,
      createdAt: now,
      updatedAt: now,
      status: 'active',
      ...(options.media !== undefined ? { media: options.media } : {}),
      ...(options.tags !== undefined ? { tags: options.tags } : {}),
      ...(options.mentions !== undefined ? { mentions: options.mentions } : {}),
    }
    const { entityKey } = await this.cdn.entity.create({
      payload: jsonToPayload(post),
      contentType: 'application/json',
      attributes: buildPostAttributes(this.uuid, this.wallet),
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return { entityKey, ...post }
  }

  /**
   * Fetches a single post by entity key.
   * Returns `null` if not found or deleted.
   */
  async getPost(entityKey: string): Promise<SocialPost | null> {
    const result = await queryDual(
      this.cdn,
      [eq(ATTR_TYPE, SOCIAL_POST_TYPE)],
      [eq(LEGACY_ATTR_TYPE, LEGACY_SOCIAL_POST_TYPE)],
    )
    const entity = result.entities.find(e => e.key === entityKey)
    if (!entity) return null
    const post = entity.toJson() as SocialPost
    if (post.status === 'removed') return null
    return { ...post, entityKey: entity.key }
  }

  /**
   * Updates the content of the current user's post.
   * Returns the updated post.
   */
  async updatePost(entityKey: string, content: string): Promise<SocialPost> {
    const post = await this.getPost(entityKey)
    if (!post) throw new Error(`ASide: post "${entityKey}" not found`)
    if (post.authorUuid !== this.uuid) throw new Error('ASide: cannot edit another user\'s post')
    const updated: SocialPost = { ...post, content, updatedAt: Date.now() }
    await this.cdn.entity.update({
      entityKey: entityKey as Hex,
      payload: jsonToPayload(updated),
      contentType: 'application/json',
      attributes: buildPostAttributes(post.authorUuid, post.authorWallet),
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return updated
  }

  /**
   * Soft-deletes a post (sets `status: "removed"`).
   * Only the post author can delete their post.
   */
  async deletePost(entityKey: string): Promise<void> {
    const post = await this.getPost(entityKey)
    if (!post) return
    if (post.authorUuid !== this.uuid) throw new Error('ASide: cannot delete another user\'s post')
    await this.cdn.entity.update({
      entityKey: entityKey as Hex,
      payload: jsonToPayload({ ...post, status: 'removed' }),
      contentType: 'application/json',
      attributes: buildPostAttributes(post.authorUuid, post.authorWallet),
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
  }

  /**
   * Returns all active posts by `uuid` (default: current user).
   */
  async getUserPosts(
    options: PaginationOptions & { uuid?: string } = {},
  ): Promise<SocialPost[]> {
    const { uuid = this.uuid, limit, offset = 0 } = options
    const result = await queryDual(
      this.cdn,
      [eq(ATTR_TYPE, SOCIAL_POST_TYPE), eq(ATTR_UUID, uuid)],
      [eq(LEGACY_ATTR_TYPE, LEGACY_SOCIAL_POST_TYPE), eq(LEGACY_ATTR_UUID, uuid)],
    )
    const posts = result.entities
      .map(e => ({ ...(e.toJson() as Omit<SocialPost, 'entityKey'>), entityKey: e.key }))
      .filter(p => p.status === 'active')
      .sort((a, b) => b.createdAt - a.createdAt)
    return applyPagination(posts, offset, limit)
  }

  /**
   * Returns a chronological feed of posts from a list of followed UUIDs.
   * Pass the list explicitly if you have it; otherwise every post is returned.
   *
   * @param followingUuids - UUIDs of accounts to include in the feed.
   */
  async getFeed(
    followingUuids: string[],
    options: PaginationOptions = {},
  ): Promise<SocialPost[]> {
    const { limit, offset = 0 } = options
    if (followingUuids.length === 0) return []

    // Fetch posts for all followed users in parallel
    const results = await Promise.all(
      followingUuids.map(uuid => this.getUserPosts({ uuid })),
    )
    const all = results
      .flat()
      .sort((a, b) => b.createdAt - a.createdAt)
    return applyPagination(all, offset, limit)
  }

  // ─── Reactions (likes) ────────────────────────────────────────────────────

  /**
   * Adds a reaction to an entity (post or comment).
   * If the user has already reacted with the same type, this is a no-op.
   */
  async react(
    targetEntityKey: string,
    type: ReactionType = 'like',
  ): Promise<SocialReaction> {
    const existing = await this._findReaction(targetEntityKey, this.uuid, type)
    if (existing && existing.status === 'active') return existing

    const now = Date.now()
    const reaction: Omit<SocialReaction, 'entityKey'> = {
      reactorUuid: this.uuid,
      targetEntityKey,
      type,
      createdAt: now,
      status: 'active',
    }

    if (existing) {
      const updated: SocialReaction = { ...existing, status: 'active' }
      await this.cdn.entity.update({
        entityKey: existing.entityKey as Hex,
        payload: jsonToPayload(updated),
        contentType: 'application/json',
        attributes: buildReactionAttributes(existing.reactorUuid, existing.targetEntityKey),
        expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
      })
      return updated
    }

    const { entityKey } = await this.cdn.entity.create({
      payload: jsonToPayload(reaction),
      contentType: 'application/json',
      attributes: buildReactionAttributes(this.uuid, targetEntityKey),
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return { entityKey, ...reaction }
  }

  /** Shorthand for `react(key, 'like')`. */
  like(targetEntityKey: string): Promise<SocialReaction> {
    return this.react(targetEntityKey, 'like')
  }

  /**
   * Removes the current user's reaction of `type` from an entity.
   */
  async unreact(targetEntityKey: string, type: ReactionType = 'like'): Promise<void> {
    const existing = await this._findReaction(targetEntityKey, this.uuid, type)
    if (!existing || existing.status === 'removed') return
    await this.cdn.entity.update({
      entityKey: existing.entityKey as Hex,
      payload: jsonToPayload({ ...existing, status: 'removed' }),
      contentType: 'application/json',
      attributes: buildReactionAttributes(existing.reactorUuid, existing.targetEntityKey),
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
  }

  /** Shorthand for `unreact(key, 'like')`. */
  unlike(targetEntityKey: string): Promise<void> {
    return this.unreact(targetEntityKey, 'like')
  }

  /**
   * Returns `true` if the current user has reacted to `targetEntityKey` with `type`.
   */
  async hasReacted(targetEntityKey: string, type: ReactionType = 'like'): Promise<boolean> {
    const r = await this._findReaction(targetEntityKey, this.uuid, type)
    return r?.status === 'active'
  }

  /**
   * Returns all active reactions for `targetEntityKey`.
   * Optionally filter by reaction type.
   */
  async getReactions(
    targetEntityKey: string,
    type?: ReactionType,
  ): Promise<SocialReaction[]> {
    const result = await queryDual(
      this.cdn,
      [eq(ATTR_TYPE, SOCIAL_REACTION_TYPE), eq(ATTR_TARGET_KEY, targetEntityKey)],
      [eq(LEGACY_ATTR_TYPE, LEGACY_SOCIAL_REACTION_TYPE), eq(LEGACY_ATTR_TARGET_KEY, targetEntityKey)],
    )
    return result.entities
      .map(e => ({ ...(e.toJson() as Omit<SocialReaction, 'entityKey'>), entityKey: e.key }))
      .filter(r => r.status === 'active' && (type === undefined || r.type === type))
  }

  /**
   * Returns the count of active reactions on `targetEntityKey` per type.
   */
  async getReactionCounts(
    targetEntityKey: string,
  ): Promise<Record<ReactionType, number>> {
    const reactions = await this.getReactions(targetEntityKey)
    const counts: Record<ReactionType, number> = {
      like: 0, love: 0, laugh: 0, wow: 0, sad: 0, angry: 0,
    }
    for (const r of reactions) counts[r.type]++
    return counts
  }

  // ─── Comments ─────────────────────────────────────────────────────────────

  /**
   * Adds a comment to a post or another comment.
   */
  async addComment(targetEntityKey: string, content: string): Promise<SocialComment> {
    const now = Date.now()
    const comment: Omit<SocialComment, 'entityKey'> = {
      authorUuid: this.uuid,
      authorWallet: this.wallet,
      targetEntityKey,
      content,
      createdAt: now,
      updatedAt: now,
      status: 'active',
    }
    const { entityKey } = await this.cdn.entity.create({
      payload: jsonToPayload(comment),
      contentType: 'application/json',
      attributes: buildCommentAttributes(this.uuid, targetEntityKey),
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return { entityKey, ...comment }
  }

  /**
   * Updates the content of the current user's comment.
   */
  async editComment(entityKey: string, content: string): Promise<SocialComment> {
    const comments = await this._getCommentsByKey(entityKey)
    const comment = comments[0]
    if (!comment) throw new Error(`ASide: comment "${entityKey}" not found`)
    if (comment.authorUuid !== this.uuid) throw new Error('ASide: cannot edit another user\'s comment')
    const updated: SocialComment = { ...comment, content, updatedAt: Date.now() }
    await this.cdn.entity.update({
      entityKey: entityKey as Hex,
      payload: jsonToPayload(updated),
      contentType: 'application/json',
      attributes: buildCommentAttributes(comment.authorUuid, comment.targetEntityKey),
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return updated
  }

  /**
   * Soft-deletes a comment.
   */
  async deleteComment(entityKey: string): Promise<void> {
    const comments = await this._getCommentsByKey(entityKey)
    const comment = comments[0]
    if (!comment) return
    if (comment.authorUuid !== this.uuid) throw new Error('ASide: cannot delete another user\'s comment')
    await this.cdn.entity.update({
      entityKey: entityKey as Hex,
      payload: jsonToPayload({ ...comment, status: 'removed' }),
      contentType: 'application/json',
      attributes: buildCommentAttributes(comment.authorUuid, comment.targetEntityKey),
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
  }

  /**
   * Returns all active comments on `targetEntityKey`, sorted oldest-first.
   */
  async getComments(
    targetEntityKey: string,
    options: PaginationOptions = {},
  ): Promise<SocialComment[]> {
    const { limit, offset = 0 } = options
    const result = await queryDual(
      this.cdn,
      [eq(ATTR_TYPE, SOCIAL_COMMENT_TYPE), eq(ATTR_TARGET_KEY, targetEntityKey)],
      [eq(LEGACY_ATTR_TYPE, LEGACY_SOCIAL_COMMENT_TYPE), eq(LEGACY_ATTR_TARGET_KEY, targetEntityKey)],
    )
    const comments = result.entities
      .map(e => ({ ...(e.toJson() as Omit<SocialComment, 'entityKey'>), entityKey: e.key }))
      .filter(c => c.status === 'active')
      .sort((a, b) => a.createdAt - b.createdAt)
    return applyPagination(comments, offset, limit)
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async _findReaction(
    targetEntityKey: string,
    reactorUuid: string,
    type: ReactionType,
  ): Promise<SocialReaction | null> {
    const result = await queryDual(
      this.cdn,
      [
        eq(ATTR_TYPE, SOCIAL_REACTION_TYPE),
        eq(ATTR_UUID, reactorUuid),
        eq(ATTR_TARGET_KEY, targetEntityKey),
      ],
      [
        eq(LEGACY_ATTR_TYPE, LEGACY_SOCIAL_REACTION_TYPE),
        eq(LEGACY_ATTR_UUID, reactorUuid),
        eq(LEGACY_ATTR_TARGET_KEY, targetEntityKey),
      ],
    )
    const entity = result.entities.find(e => {
      const r = e.toJson() as SocialReaction
      return r.type === type
    })
    if (!entity) return null
    return { ...(entity.toJson() as Omit<SocialReaction, 'entityKey'>), entityKey: entity.key }
  }

  private async _getCommentsByKey(entityKey: string): Promise<SocialComment[]> {
    const result = await queryDual(
      this.cdn,
      [eq(ATTR_TYPE, SOCIAL_COMMENT_TYPE)],
      [eq(LEGACY_ATTR_TYPE, LEGACY_SOCIAL_COMMENT_TYPE)],
    )
    return result.entities
      .filter(e => e.key === entityKey)
      .map(e => ({ ...(e.toJson() as Omit<SocialComment, 'entityKey'>), entityKey: e.key }))
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function applyPagination<T>(items: T[], offset: number, limit?: number): T[] {
  const sliced = items.slice(offset)
  return limit !== undefined ? sliced.slice(0, limit) : sliced
}

function buildPostAttributes(authorUuid: string, authorWallet: string): Array<{ key: string; value: string }> {
  return [
    { key: ATTR_TYPE, value: SOCIAL_POST_TYPE },
    { key: ATTR_UUID, value: authorUuid },
    { key: ATTR_WALLET, value: authorWallet },
    { key: LEGACY_ARBOK_ATTR_TYPE, value: SOCIAL_POST_TYPE },
    { key: LEGACY_ARBOK_ATTR_UUID, value: authorUuid },
    { key: LEGACY_ARBOK_ATTR_WALLET, value: authorWallet },
    { key: LEGACY_ATTR_TYPE, value: LEGACY_SOCIAL_POST_TYPE },
    { key: LEGACY_ATTR_UUID, value: authorUuid },
    { key: LEGACY_ATTR_WALLET, value: authorWallet },
  ]
}

function buildReactionAttributes(reactorUuid: string, targetEntityKey: string): Array<{ key: string; value: string }> {
  return [
    { key: ATTR_TYPE, value: SOCIAL_REACTION_TYPE },
    { key: ATTR_UUID, value: reactorUuid },
    { key: ATTR_TARGET_KEY, value: targetEntityKey },
    { key: LEGACY_ARBOK_ATTR_TYPE, value: SOCIAL_REACTION_TYPE },
    { key: LEGACY_ARBOK_ATTR_UUID, value: reactorUuid },
    { key: LEGACY_ARBOK_ATTR_TARGET_KEY, value: targetEntityKey },
    { key: LEGACY_ATTR_TYPE, value: LEGACY_SOCIAL_REACTION_TYPE },
    { key: LEGACY_ATTR_UUID, value: reactorUuid },
    { key: LEGACY_ATTR_TARGET_KEY, value: targetEntityKey },
  ]
}

function buildCommentAttributes(authorUuid: string, targetEntityKey: string): Array<{ key: string; value: string }> {
  return [
    { key: ATTR_TYPE, value: SOCIAL_COMMENT_TYPE },
    { key: ATTR_UUID, value: authorUuid },
    { key: ATTR_TARGET_KEY, value: targetEntityKey },
    { key: LEGACY_ARBOK_ATTR_TYPE, value: SOCIAL_COMMENT_TYPE },
    { key: LEGACY_ARBOK_ATTR_UUID, value: authorUuid },
    { key: LEGACY_ARBOK_ATTR_TARGET_KEY, value: targetEntityKey },
    { key: LEGACY_ATTR_TYPE, value: LEGACY_SOCIAL_COMMENT_TYPE },
    { key: LEGACY_ATTR_UUID, value: authorUuid },
    { key: LEGACY_ATTR_TARGET_KEY, value: targetEntityKey },
  ]
}

async function queryDual(
  cdn: Arbok,
  primaryWhere: unknown[],
  legacyWhere: unknown[],
): Promise<{ entities: Array<{ key: string; toJson: () => unknown }> }> {
  const primary = await cdn.entity.query().where(primaryWhere).withPayload(true).fetch()

  let legacy: { entities: Array<{ key: string; toJson: () => unknown }> } = { entities: [] }
  try {
    legacy = await cdn.entity.query().where(legacyWhere).withPayload(true).fetch()
  } catch {
    legacy = { entities: [] }
  }

  const byKey = new Map<string, { key: string; toJson: () => unknown }>()
  for (const entity of primary.entities) byKey.set(entity.key, entity)
  for (const entity of legacy.entities) byKey.set(entity.key, entity)

  return { entities: Array.from(byKey.values()) }
}
