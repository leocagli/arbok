/**
 * SocialClient — follow graph, friend requests, and user blocking.
 *
 * Obtain via `client.social()`:
 *
 * ```ts
 * const social = client.social()
 * await social.follow('target-uuid')
 * const followers = await social.getFollowers()
 * ```
 *
 * All social data is stored as entities on ArkaCDN.  "Soft deletes" (unfollow,
 * unblock, cancel) update the entity's `status` field because ArkaCDN does not
 * expose a delete operation.
 */

import { eq, jsonToPayload, ExpirationTime } from './arbok/index.js'
import type { Arbok, Hex } from './arbok/index.js'
import {
  ATTR_TARGET_UUID,
  ATTR_TYPE,
  ATTR_UUID,
  ATTR_WALLET,
  DEFAULT_EXPIRY_SECONDS,
  LEGACY_ATTR_TARGET_UUID,
  LEGACY_ATTR_TYPE,
  LEGACY_ATTR_UUID,
  LEGACY_SOCIAL_BLOCK_TYPE,
  LEGACY_SOCIAL_FOLLOW_TYPE,
  LEGACY_SOCIAL_FRIEND_REQUEST_TYPE,
  SOCIAL_BLOCK_TYPE,
  SOCIAL_FOLLOW_TYPE,
  SOCIAL_FRIEND_REQUEST_TYPE,
} from './constants.js'
import type {
  FriendRequest,
  FriendRequestStatus,
  PaginationOptions,
  SocialBlock,
  SocialFollow,
} from './types.js'

export class SocialClient {
  constructor(
    private readonly cdn: Arbok,
    private readonly uuid: string,
    private readonly wallet: string,
  ) { }

  // ─── Follow / Unfollow ────────────────────────────────────────────────────

  /**
   * Follows a user identified by `targetUuid`.
   * If a follow entity already exists (even if unfollowed), it is reactivated.
   * Returns the updated/created follow record.
   */
  async follow(targetUuid: string): Promise<SocialFollow> {
    const now = Date.now()

    // Check if a follow entity already exists (could be unfollowed)
    const existing = await this._findFollow(this.uuid, targetUuid)

    if (existing) {
      if (existing.status === 'active') return existing
      const updated: SocialFollow = { ...existing, status: 'active', followedAt: now }
      await this.cdn.entity.update({
        entityKey: existing.entityKey as Hex,
        payload: jsonToPayload(updated),
        contentType: 'application/json',
        attributes: buildSocialAttributes(
          SOCIAL_FOLLOW_TYPE,
          LEGACY_SOCIAL_FOLLOW_TYPE,
          existing.followerUuid,
          existing.followeeUuid,
        ),
        expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
      })
      return updated
    }

    const follow: Omit<SocialFollow, 'entityKey'> = {
      followerUuid: this.uuid,
      followeeUuid: targetUuid,
      followedAt: now,
      status: 'active',
    }
    const { entityKey } = await this.cdn.entity.create({
      payload: jsonToPayload(follow),
      contentType: 'application/json',
      attributes: buildSocialAttributes(
        SOCIAL_FOLLOW_TYPE,
        LEGACY_SOCIAL_FOLLOW_TYPE,
        this.uuid,
        targetUuid,
      ),
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return { entityKey, ...follow }
  }

  /**
   * Unfollows a user. No-op if not currently following.
   */
  async unfollow(targetUuid: string): Promise<void> {
    const existing = await this._findFollow(this.uuid, targetUuid)
    if (!existing || existing.status === 'removed') return
    const updated: SocialFollow = { ...existing, status: 'removed' }
    await this.cdn.entity.update({
      entityKey: existing.entityKey as Hex,
      payload: jsonToPayload(updated),
      contentType: 'application/json',
      attributes: buildSocialAttributes(
        SOCIAL_FOLLOW_TYPE,
        LEGACY_SOCIAL_FOLLOW_TYPE,
        existing.followerUuid,
        existing.followeeUuid,
      ),
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
  }

  /**
   * Returns `true` if the current user is actively following `targetUuid`.
   */
  async isFollowing(targetUuid: string): Promise<boolean> {
    const f = await this._findFollow(this.uuid, targetUuid)
    return f?.status === 'active'
  }

  /**
   * Returns the list of users that `uuid` (default: current user) is following.
   */
  async getFollowing(options: PaginationOptions & { uuid?: string } = {}): Promise<SocialFollow[]> {
    const { uuid = this.uuid, limit, offset = 0 } = options
    const result = await queryDual(
      this.cdn,
      [eq(ATTR_TYPE, SOCIAL_FOLLOW_TYPE), eq(ATTR_UUID, uuid)],
      [eq(LEGACY_ATTR_TYPE, LEGACY_SOCIAL_FOLLOW_TYPE), eq(LEGACY_ATTR_UUID, uuid)],
    )
    const follows = result.entities
      .map(e => e.toJson() as SocialFollow)
      .filter(f => f.status === 'active')
    return applyPagination(follows, offset, limit)
  }

  /**
   * Returns the list of users following `uuid` (default: current user).
   */
  async getFollowers(options: PaginationOptions & { uuid?: string } = {}): Promise<SocialFollow[]> {
    const { uuid = this.uuid, limit, offset = 0 } = options
    const result = await queryDual(
      this.cdn,
      [eq(ATTR_TYPE, SOCIAL_FOLLOW_TYPE), eq(ATTR_TARGET_UUID, uuid)],
      [eq(LEGACY_ATTR_TYPE, LEGACY_SOCIAL_FOLLOW_TYPE), eq(LEGACY_ATTR_TARGET_UUID, uuid)],
    )
    const followers = result.entities
      .map(e => e.toJson() as SocialFollow)
      .filter(f => f.status === 'active')
    return applyPagination(followers, offset, limit)
  }

  /**
   * Returns follower + following counts for `uuid` (default: current user).
   */
  async getFollowerCounts(uuid = this.uuid): Promise<{ followers: number; following: number }> {
    const [followers, following] = await Promise.all([
      this.getFollowers({ uuid }),
      this.getFollowing({ uuid }),
    ])
    return { followers: followers.length, following: following.length }
  }

  // ─── Friends ───────────────────────────────────────────────────────────────

  /**
   * Sends a friend request to `targetUuid`.
   * Returns the created {@link FriendRequest}.
   */
  async sendFriendRequest(targetUuid: string, message?: string): Promise<FriendRequest> {
    const now = Date.now()
    const request: Omit<FriendRequest, 'entityKey'> = {
      fromUuid: this.uuid,
      fromWallet: this.wallet,
      toUuid: targetUuid,
      sentAt: now,
      status: 'pending',
      ...(message !== undefined ? { message } : {}),
    }
    const { entityKey } = await this.cdn.entity.create({
      payload: jsonToPayload(request),
      contentType: 'application/json',
      attributes: buildSocialAttributes(
        SOCIAL_FRIEND_REQUEST_TYPE,
        LEGACY_SOCIAL_FRIEND_REQUEST_TYPE,
        this.uuid,
        targetUuid,
      ),
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return { entityKey, ...request }
  }

  /**
   * Updates the status of a friend request owned by the current user's peer
   * (called by the **recipient**).
   */
  private async _respondToRequest(
    entityKey: string,
    status: FriendRequestStatus,
  ): Promise<FriendRequest> {
    const result = await queryDual(
      this.cdn,
      [eq(ATTR_TYPE, SOCIAL_FRIEND_REQUEST_TYPE), eq(ATTR_TARGET_UUID, this.uuid)],
      [eq(LEGACY_ATTR_TYPE, LEGACY_SOCIAL_FRIEND_REQUEST_TYPE), eq(LEGACY_ATTR_TARGET_UUID, this.uuid)],
    )

    const entity = result.entities.find(e => e.key === entityKey)
    if (!entity) throw new Error(`ASide: friend request "${entityKey}" not found`)

    const req = entity.toJson() as FriendRequest
    const updated: FriendRequest = { ...req, status, respondedAt: Date.now() }
    await this.cdn.entity.update({
      entityKey: entityKey as Hex,
      payload: jsonToPayload(updated),
      contentType: 'application/json',
      attributes: buildSocialAttributes(
        SOCIAL_FRIEND_REQUEST_TYPE,
        LEGACY_SOCIAL_FRIEND_REQUEST_TYPE,
        req.fromUuid,
        req.toUuid,
      ),
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return updated
  }

  /**
   * Accepts a pending friend request (called by the **recipient**).
   * Automatically creates a corresponding follow in both directions.
   */
  async acceptFriendRequest(entityKey: string): Promise<FriendRequest> {
    const updated = await this._respondToRequest(entityKey, 'accepted')
    // Mutual follows on acceptance
    await Promise.all([
      this.follow(updated.fromUuid),
      // the sender's follow will be a cross-perspective call — we create it here
      // using a temporary SocialClient scoped to this CDN
      new SocialClient(this.cdn, updated.fromUuid, updated.fromWallet).follow(this.uuid),
    ])
    return updated
  }

  /**
   * Rejects a pending friend request (called by the **recipient**).
   */
  async rejectFriendRequest(entityKey: string): Promise<FriendRequest> {
    return this._respondToRequest(entityKey, 'rejected')
  }

  /**
   * Cancels an outgoing friend request (called by the **sender**).
   */
  async cancelFriendRequest(entityKey: string): Promise<FriendRequest> {
    const result = await queryDual(
      this.cdn,
      [eq(ATTR_TYPE, SOCIAL_FRIEND_REQUEST_TYPE), eq(ATTR_UUID, this.uuid)],
      [eq(LEGACY_ATTR_TYPE, LEGACY_SOCIAL_FRIEND_REQUEST_TYPE), eq(LEGACY_ATTR_UUID, this.uuid)],
    )

    const entity = result.entities.find(e => e.key === entityKey)
    if (!entity) throw new Error(`ASide: friend request "${entityKey}" not found`)

    const req = entity.toJson() as FriendRequest
    const updated: FriendRequest = { ...req, status: 'cancelled' }
    await this.cdn.entity.update({
      entityKey: entityKey as Hex,
      payload: jsonToPayload(updated),
      contentType: 'application/json',
      attributes: buildSocialAttributes(
        SOCIAL_FRIEND_REQUEST_TYPE,
        LEGACY_SOCIAL_FRIEND_REQUEST_TYPE,
        req.fromUuid,
        req.toUuid,
      ),
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return updated
  }

  /**
   * Returns pending friend requests received by the current user.
   */
  async getIncomingFriendRequests(): Promise<FriendRequest[]> {
    const result = await queryDual(
      this.cdn,
      [eq(ATTR_TYPE, SOCIAL_FRIEND_REQUEST_TYPE), eq(ATTR_TARGET_UUID, this.uuid)],
      [eq(LEGACY_ATTR_TYPE, LEGACY_SOCIAL_FRIEND_REQUEST_TYPE), eq(LEGACY_ATTR_TARGET_UUID, this.uuid)],
    )
    return result.entities
      .map(e => e.toJson() as FriendRequest)
      .filter(r => r.status === 'pending')
  }

  /**
   * Returns pending friend requests sent by the current user.
   */
  async getOutgoingFriendRequests(): Promise<FriendRequest[]> {
    const result = await queryDual(
      this.cdn,
      [eq(ATTR_TYPE, SOCIAL_FRIEND_REQUEST_TYPE), eq(ATTR_UUID, this.uuid)],
      [eq(LEGACY_ATTR_TYPE, LEGACY_SOCIAL_FRIEND_REQUEST_TYPE), eq(LEGACY_ATTR_UUID, this.uuid)],
    )
    return result.entities
      .map(e => e.toJson() as FriendRequest)
      .filter(r => r.status === 'pending')
  }

  /**
   * Returns the list of accepted friends (bidirectional follows).
   * A "friend" is a user with whom there is an accepted friend request.
   */
  async getFriends(options: PaginationOptions = {}): Promise<FriendRequest[]> {
    const { limit, offset = 0 } = options
    const result = await queryDual(
      this.cdn,
      [eq(ATTR_TYPE, SOCIAL_FRIEND_REQUEST_TYPE)],
      [eq(LEGACY_ATTR_TYPE, LEGACY_SOCIAL_FRIEND_REQUEST_TYPE)],
    )

    const friends = result.entities
      .map(e => e.toJson() as FriendRequest)
      .filter(
        r =>
          r.status === 'accepted'
          && (r.fromUuid === this.uuid || r.toUuid === this.uuid),
      )
    return applyPagination(friends, offset, limit)
  }

  // ─── Block / Unblock ──────────────────────────────────────────────────────

  /**
   * Blocks `targetUuid`. Also unfollows them silently (if following).
   */
  async block(targetUuid: string): Promise<SocialBlock> {
    await this.unfollow(targetUuid)

    const existing = await this._findBlock(this.uuid, targetUuid)
    if (existing && existing.status === 'active') return existing

    const now = Date.now()
    const blockData: Omit<SocialBlock, 'entityKey'> = {
      byUuid: this.uuid,
      blockedUuid: targetUuid,
      blockedAt: now,
      status: 'active',
    }

    if (existing) {
      const updated: SocialBlock = { ...existing, status: 'active', blockedAt: now }
      await this.cdn.entity.update({
        entityKey: existing.entityKey as Hex,
        payload: jsonToPayload(updated),
        contentType: 'application/json',
        attributes: buildSocialAttributes(
          SOCIAL_BLOCK_TYPE,
          LEGACY_SOCIAL_BLOCK_TYPE,
          existing.byUuid,
          existing.blockedUuid,
        ),
        expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
      })
      return updated
    }

    const { entityKey } = await this.cdn.entity.create({
      payload: jsonToPayload(blockData),
      contentType: 'application/json',
      attributes: buildSocialAttributes(
        SOCIAL_BLOCK_TYPE,
        LEGACY_SOCIAL_BLOCK_TYPE,
        this.uuid,
        targetUuid,
      ),
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return { entityKey, ...blockData }
  }

  /**
   * Removes a block on `targetUuid`.
   */
  async unblock(targetUuid: string): Promise<void> {
    const existing = await this._findBlock(this.uuid, targetUuid)
    if (!existing || existing.status === 'removed') return
    await this.cdn.entity.update({
      entityKey: existing.entityKey as Hex,
      payload: jsonToPayload({ ...existing, status: 'removed' }),
      contentType: 'application/json',
      attributes: buildSocialAttributes(
        SOCIAL_BLOCK_TYPE,
        LEGACY_SOCIAL_BLOCK_TYPE,
        existing.byUuid,
        existing.blockedUuid,
      ),
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
  }

  /**
   * Returns `true` if the current user has blocked `targetUuid`.
   */
  async isBlocked(targetUuid: string): Promise<boolean> {
    const b = await this._findBlock(this.uuid, targetUuid)
    return b?.status === 'active'
  }

  /**
   * Returns the list of users blocked by the current profile.
   */
  async getBlockedUsers(options: PaginationOptions = {}): Promise<SocialBlock[]> {
    const { limit, offset = 0 } = options
    const result = await queryDual(
      this.cdn,
      [eq(ATTR_TYPE, SOCIAL_BLOCK_TYPE), eq(ATTR_UUID, this.uuid)],
      [eq(LEGACY_ATTR_TYPE, LEGACY_SOCIAL_BLOCK_TYPE), eq(LEGACY_ATTR_UUID, this.uuid)],
    )
    const blocks = result.entities
      .map(e => e.toJson() as SocialBlock)
      .filter(b => b.status === 'active')
    return applyPagination(blocks, offset, limit)
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async _findFollow(
    followerUuid: string,
    followeeUuid: string,
  ): Promise<SocialFollow | null> {
    const result = await queryDual(
      this.cdn,
      [
        eq(ATTR_TYPE, SOCIAL_FOLLOW_TYPE),
        eq(ATTR_UUID, followerUuid),
        eq(ATTR_TARGET_UUID, followeeUuid),
      ],
      [
        eq(LEGACY_ATTR_TYPE, LEGACY_SOCIAL_FOLLOW_TYPE),
        eq(LEGACY_ATTR_UUID, followerUuid),
        eq(LEGACY_ATTR_TARGET_UUID, followeeUuid),
      ],
    )

    const entity = result.entities[0]
    if (!entity) return null
    return { ...(entity.toJson() as Omit<SocialFollow, 'entityKey'>), entityKey: entity.key }
  }

  private async _findBlock(
    byUuid: string,
    blockedUuid: string,
  ): Promise<SocialBlock | null> {
    const result = await queryDual(
      this.cdn,
      [
        eq(ATTR_TYPE, SOCIAL_BLOCK_TYPE),
        eq(ATTR_UUID, byUuid),
        eq(ATTR_TARGET_UUID, blockedUuid),
      ],
      [
        eq(LEGACY_ATTR_TYPE, LEGACY_SOCIAL_BLOCK_TYPE),
        eq(LEGACY_ATTR_UUID, byUuid),
        eq(LEGACY_ATTR_TARGET_UUID, blockedUuid),
      ],
    )

    const entity = result.entities[0]
    if (!entity) return null
    return { ...(entity.toJson() as Omit<SocialBlock, 'entityKey'>), entityKey: entity.key }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function applyPagination<T>(items: T[], offset: number, limit?: number): T[] {
  const sliced = items.slice(offset)
  return limit !== undefined ? sliced.slice(0, limit) : sliced
}

function buildSocialAttributes(
  type: string,
  legacyType: string,
  actorUuid: string,
  targetUuid: string,
): Array<{ key: string; value: string }> {
  return [
    { key: ATTR_TYPE, value: type },
    { key: ATTR_UUID, value: actorUuid },
    { key: ATTR_TARGET_UUID, value: targetUuid },
    { key: LEGACY_ATTR_TYPE, value: legacyType },
    { key: LEGACY_ATTR_UUID, value: actorUuid },
    { key: LEGACY_ATTR_TARGET_UUID, value: targetUuid },
  ]
}

async function queryDual(
  cdn: Arbok,
  primaryWhere: unknown[],
  legacyWhere: unknown[],
): Promise<{ entities: Array<{ key: string; toJson: () => unknown }> }> {
  const [primary, legacy] = await Promise.all([
    cdn.entity.query().where(primaryWhere).withPayload(true).fetch(),
    cdn.entity.query().where(legacyWhere).withPayload(true).fetch(),
  ])

  const byKey = new Map<string, { key: string; toJson: () => unknown }>()
  for (const entity of primary.entities) byKey.set(entity.key, entity)
  for (const entity of legacy.entities) byKey.set(entity.key, entity)

  return { entities: Array.from(byKey.values()) }
}
