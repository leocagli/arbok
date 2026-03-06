/**
 * BaseClient — the core ASide identity class.
 *
 * Manages a single profile (uuid + wallet + photo) across all chains and apps.
 * Designed to be extended (Discord.js style):
 *
 * ```ts
 * class MyClient extends BaseClient {
 *   async fetchReputation() { ... }
 * }
 * ```
 *
 * CDN is optional at construction — pass it immediately or set it later via `setCdn()`:
 *
 * ```ts
 * const client = new BaseClient({ uuid, wallet, photo })
 * client.setCdn(myCdn)
 * await client.getOrCreate()
 * ```
 *
 * Or with CDN at construction:
 *
 * ```ts
 * const client = new BaseClient({ uuid, wallet, photo, cdn: kaolinCdn })
 * ```
 */

import { eq, jsonToPayload, ExpirationTime } from './arbok/index.js'
import type { Arbok, Hex } from './arbok/index.js'
import {
  ATTR_TYPE,
  ATTR_UUID,
  ATTR_WALLET,
  DEFAULT_EXPIRY_SECONDS,
  LEGACY_ARBOK_ATTR_TYPE,
  LEGACY_ARBOK_ATTR_UUID,
  LEGACY_ARBOK_ATTR_WALLET,
  LEGACY_ATTR_TYPE,
  LEGACY_ATTR_UUID,
  LEGACY_ATTR_WALLET,
  PROFILE_TYPE,
} from './constants.js'
import { ExtensionClient } from './extension.js'
import { AccessTokenManager } from './access-token.js'
import { ProfileWatcher } from './watcher.js'
import { SocialClient } from './social.js'
import { FeedClient } from './feed.js'
import type {
  BaseClientOptions,
  BaseProfileData,
  BaseProfileResult,
  CreateAccessTokenOptions,
  CreateAccessTokenResult,
  WatcherOptions,
} from './types.js'

export class BaseClient {
  readonly uuid: string
  readonly wallet: string
  readonly photo: string
  readonly displayName: string | undefined
  readonly bio: string | undefined

  protected _cdn: Arbok | undefined

  constructor(options: BaseClientOptions) {
    this.uuid = options.uuid
    this.wallet = options.wallet
    this.photo = options.photo
    this.displayName = options.displayName
    this.bio = options.bio
    this._cdn = options.cdn
  }

  // ─── CDN management ───────────────────────────────────────────────────────

  /**
   * Sets (or replaces) the ArkaCDN instance used by this client.
   * Useful when the CDN is created after the client.
   */
  setCdn(cdn: Arbok): this {
    this._cdn = cdn
    return this
  }

  /** Returns the current ArkaCDN instance. Throws if not set. */
  get cdn(): Arbok {
    if (!this._cdn) {
      throw new Error(
        'ASide: no CDN configured. Pass `cdn` to the constructor or call `setCdn()` first.',
      )
    }
    return this._cdn
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  protected async findProfile(searchCdn: Arbok): Promise<BaseProfileResult | null> {
    const result = await searchCdn.entity
      .query()
      .where([
        eq(ATTR_TYPE, PROFILE_TYPE),
        eq(ATTR_UUID, this.uuid),
        eq(ATTR_WALLET, this.wallet),
      ])
      .withPayload(true)
      .withAttributes(true)
      .fetch()

    let entity = result.entities[0]
    if (!entity) {
      try {
        const dottedResult = await searchCdn.entity
          .query()
          .where([
            eq(LEGACY_ARBOK_ATTR_TYPE, PROFILE_TYPE),
            eq(LEGACY_ARBOK_ATTR_UUID, this.uuid),
            eq(LEGACY_ARBOK_ATTR_WALLET, this.wallet),
          ])
          .withPayload(true)
          .withAttributes(true)
          .fetch()
        entity = dottedResult.entities[0]
      } catch {
        entity = undefined
      }
    }

    if (!entity) {
      try {
        const asideResult = await searchCdn.entity
          .query()
          .where([
            eq(LEGACY_ATTR_TYPE, PROFILE_TYPE),
            eq(LEGACY_ATTR_UUID, this.uuid),
            eq(LEGACY_ATTR_WALLET, this.wallet),
          ])
          .withPayload(true)
          .withAttributes(true)
          .fetch()
        entity = asideResult.entities[0]
      } catch {
        entity = undefined
      }
    }

    if (!entity) {
      try {
        const byWalletResult = await searchCdn.entity
          .query()
          .where([
            eq(ATTR_TYPE, PROFILE_TYPE),
            eq(ATTR_WALLET, this.wallet),
          ])
          .withPayload(true)
          .withAttributes(true)
          .fetch()
        entity = byWalletResult.entities[0]
      } catch {
        entity = undefined
      }
    }

    if (!entity) {
      try {
        const legacyDottedByWallet = await searchCdn.entity
          .query()
          .where([
            eq(LEGACY_ARBOK_ATTR_TYPE, PROFILE_TYPE),
            eq(LEGACY_ARBOK_ATTR_WALLET, this.wallet),
          ])
          .withPayload(true)
          .withAttributes(true)
          .fetch()
        entity = legacyDottedByWallet.entities[0]
      } catch {
        entity = undefined
      }
    }

    if (!entity) {
      try {
        const legacyAsideByWallet = await searchCdn.entity
          .query()
          .where([
            eq(LEGACY_ATTR_TYPE, PROFILE_TYPE),
            eq(LEGACY_ATTR_WALLET, this.wallet),
          ])
          .withPayload(true)
          .withAttributes(true)
          .fetch()
        entity = legacyAsideByWallet.entities[0]
      } catch {
        entity = undefined
      }
    }

    if (!entity) return null

    const profile = entity.toJson() as BaseProfileData
    return { entityKey: entity.key, profile }
  }

  private async createProfileOn(
    targetCdn: Arbok,
    syncedFrom?: string,
  ): Promise<BaseProfileResult> {
    const now = Date.now()
    const profileData: BaseProfileData = {
      uuid: this.uuid,
      wallet: this.wallet,
      photo: this.photo,
      ...(this.displayName != null ? { displayName: this.displayName } : {}),
      ...(this.bio != null ? { bio: this.bio } : {}),
      createdAt: now,
      updatedAt: now,
      ...(syncedFrom != null ? { syncedFrom } : {}),
    }

    const { entityKey } = await targetCdn.entity.create({
      payload: jsonToPayload(profileData),
      contentType: 'application/json',
      attributes: buildProfileAttributes(this.uuid, this.wallet),
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })

    return { entityKey, profile: profileData }
  }

  // ─── Public profile API ───────────────────────────────────────────────────

  /**
   * Fetches the profile from the current chain.
   * Returns `null` if no profile exists yet.
   */
  async get(): Promise<BaseProfileResult | null> {
    return this.findProfile(this.cdn)
  }

  /**
   * Fetches the profile from a specific CDN instance (not the default one).
   * Used by the watcher and cross-chain sync.
   */
  async getOnChain(cdn: Arbok): Promise<BaseProfileResult | null> {
    return this.findProfile(cdn)
  }

  /**
   * Fetches the profile. If none exists, creates it on the current chain.
   */
  async getOrCreate(): Promise<BaseProfileResult> {
    const existing = await this.findProfile(this.cdn)
    if (existing) return existing
    return this.createProfileOn(this.cdn)
  }

  /**
   * Updates mutable profile fields on the current chain.
   * Throws if the profile has not been created yet.
   */
  async update(
    data: Partial<Pick<BaseProfileData, 'photo' | 'displayName' | 'bio'>>,
  ): Promise<BaseProfileResult> {
    const existing = await this.findProfile(this.cdn)
    if (!existing) {
      throw new Error(
        `ASide: profile not found for uuid="${this.uuid}". Call getOrCreate() first.`,
      )
    }

    const now = Date.now()
    const updated: BaseProfileData = {
      ...existing.profile,
      ...data,
      // Immutable fields — always force them back
      uuid: this.uuid,
      wallet: this.wallet,
      updatedAt: now,
    }

    await this.cdn.entity.update({
      entityKey: existing.entityKey as Hex,
      payload: jsonToPayload(updated),
      contentType: 'application/json',
      attributes: buildProfileAttributes(this.uuid, this.wallet),
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })

    return { entityKey: existing.entityKey, profile: updated }
  }

  /**
   * Cross-chain sync.
   *
   * 1. If the profile exists on the current chain → return it.
   * 2. Search each CDN in `otherChains` in order.
   *    If found → replicate to the current chain and return.
   * 3. If not found anywhere → create fresh on the current chain.
   *
   * @param otherChains ArkaCDN instances for other chains (e.g. kaolin, mendoza).
   */
  async sync(otherChains: Arbok[]): Promise<BaseProfileResult> {
    const existing = await this.findProfile(this.cdn)
    if (existing) return existing

    for (const otherCdn of otherChains) {
      const found = await this.findProfile(otherCdn)
      if (found) {
        const now = Date.now()
        const replicatedData: BaseProfileData = {
          ...found.profile,
          updatedAt: now,
          syncedFrom: found.entityKey,
        }

        const { entityKey } = await this.cdn.entity.create({
          payload: jsonToPayload(replicatedData),
          contentType: 'application/json',
          attributes: buildProfileAttributes(this.uuid, this.wallet),
          expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
        })

        return { entityKey, profile: replicatedData }
      }
    }

    return this.createProfileOn(this.cdn)
  }

  // ─── Extensions ───────────────────────────────────────────────────────────

  /**
   * Returns an {@link ExtensionClient} scoped to `namespace`.
   * Each namespace is independent — apps never touch each other's data.
   *
   * @example
   * ```ts
   * const gameExt = client.extend<{ score: number; level: number }>('my-game')
   * const { extension } = await gameExt.getOrCreate({ score: 0, level: 1 })
   * ```
   */
  extend<T extends Record<string, unknown>>(namespace: string): ExtensionClient<T> {
    return new ExtensionClient<T>(namespace, this.cdn, this.uuid, this.wallet)
  }

  // ─── Social features ──────────────────────────────────────────────────────

  /**
   * Returns a {@link SocialClient} for managing follows, friends, and blocks.
   *
   * @example
   * ```ts
   * const social = client.social()
   * await social.follow('target-uuid')
   * const followers = await social.getFollowers()
   * ```
   */
  social(): SocialClient {
    return new SocialClient(this.cdn, this.uuid, this.wallet)
  }

  /**
   * Returns a {@link FeedClient} for managing posts, reactions, and comments.
   *
   * @example
   * ```ts
   * const feed = client.feed()
   * const post = await feed.createPost({ content: 'Hello world!' })
   * await feed.like(post.entityKey)
   * ```
   */
  feed(): FeedClient {
    return new FeedClient(this.cdn, this.uuid, this.wallet)
  }

  // ─── Access tokens ────────────────────────────────────────────────────────

  /**
   * Creates a sealed access token for a third-party app using ECDH P-256.
   *
   * The token's claims include this client's `uuid` and `wallet` as issuer info.
   * The caller must supply the app server's `appPublicKey` (P-256 public key hex).
   *
   * Returns `{ token, sessionKey }`.  Keep `sessionKey` client-side for signing
   * subsequent session requests.
   *
   * @example
   * ```ts
   * const { token, sessionKey } = await client.createAccessToken({
   *   appId:        'my-dapp',
   *   domain:       'my-dapp.com',
   *   permissions:  3n,
   *   appPublicKey: keyFromServer,
   *   phrase:       mySecretPhrase,
   * })
   * ```
   */
  async createAccessToken(
    options: Omit<CreateAccessTokenOptions, 'issuerUuid' | 'issuerWallet'>,
  ): Promise<CreateAccessTokenResult> {
    const manager = new AccessTokenManager()
    return manager.create({
      ...options,
      issuerUuid: this.uuid,
      issuerWallet: this.wallet,
    })
  }

  // ─── Watcher ──────────────────────────────────────────────────────────────

  /**
   * Creates a {@link ProfileWatcher} for this client.
   *
   * @example
   * ```ts
   * const watcher = client.watch({
   *   chains: [
   *     { name: 'kaolin', cdn: kaolinCdn },
   *     { name: 'mendoza', cdn: mendozaCdn },
   *   ],
   *   onFound: (chain, result) => console.log(`Found on ${chain}`, result),
   * })
   * watcher.start()
   * ```
   */
  watch(opts: WatcherOptions): ProfileWatcher {
    return new ProfileWatcher(this, opts)
  }
}

function buildProfileAttributes(uuid: string, wallet: string): Array<{ key: string; value: string }> {
  return [
    { key: ATTR_TYPE, value: PROFILE_TYPE },
    { key: ATTR_UUID, value: uuid },
    { key: ATTR_WALLET, value: wallet },
    { key: LEGACY_ARBOK_ATTR_TYPE, value: PROFILE_TYPE },
    { key: LEGACY_ARBOK_ATTR_UUID, value: uuid },
    { key: LEGACY_ARBOK_ATTR_WALLET, value: wallet },
    { key: LEGACY_ATTR_TYPE, value: PROFILE_TYPE },
    { key: LEGACY_ATTR_UUID, value: uuid },
    { key: LEGACY_ATTR_WALLET, value: wallet },
  ]
}
