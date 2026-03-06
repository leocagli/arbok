import type { Arbok } from './arbok/index.js'

// ─── Core profile data ────────────────────────────────────────────────────────

/**
 * Base profile data stored on-chain. Identical across all apps and chains.
 * Only wallet + uuid are immutable; the rest can be updated via `client.update()`.
 */
export interface BaseProfileData {
  /** Stable cross-chain identifier. Never changes once set. */
  uuid: string
  /** Blockchain wallet address that owns this profile. */
  wallet: string
  /** Profile photo URL or ArkaCDN entity key. */
  photo: string
  /** Optional display name. */
  displayName?: string
  /** Optional short bio. */
  bio?: string
  /** Unix timestamp (ms) of initial profile creation. */
  createdAt: number
  /** Unix timestamp (ms) of last profile update. */
  updatedAt: number
  /**
   * Entity key of the source profile when this was replicated from another chain.
   * Undefined for profiles created natively on this chain.
   */
  syncedFrom?: string
}

// ─── Extension data ────────────────────────────────────────────────────────────

/**
 * App-specific extension data stored as a separate entity linked to a base profile.
 * Independent from the base client — each app manages its own namespace.
 *
 * @template T Shape of the app-specific data object.
 */
export interface ExtensionData<T extends Record<string, unknown> = Record<string, unknown>> {
  /** Identifies which app this extension belongs to (e.g. "my-game", "my-dapp"). */
  namespace: string
  /** UUID of the base profile this extension is linked to. */
  uuid: string
  /** Wallet address of the profile owner. */
  wallet: string
  /** The app-specific data blob. */
  data: T
  /** Unix timestamp (ms) when this extension was first created. */
  createdAt: number
  /** Unix timestamp (ms) of the last extension update. */
  updatedAt: number
}

// ─── Options ───────────────────────────────────────────────────────────────────

/**
 * Options for constructing a {@link BaseClient}.
 *
 * `cdn` is **optional** — you can provide it later via `client.setCdn(cdn)`
 * or pass it at construction time for immediate use.
 */
export interface BaseClientOptions {
  /** Stable cross-chain identifier. Generate once with `generateUUID()` from arka-cdn. */
  uuid: string
  /** Blockchain wallet address. */
  wallet: string
  /** Profile photo URL or ArkaCDN entity key. */
  photo: string
  /** Optional display name. */
  displayName?: string
  /** Optional short bio. */
  bio?: string
  /**
   * ArkaCDN instance for the current chain.
   * Optional at construction — can be provided later with `setCdn()`.
   */
  cdn?: Arbok
}

// ─── Result shapes ─────────────────────────────────────────────────────────────

/** Returned by base profile operations (get, getOrCreate, update, sync). */
export interface BaseProfileResult {
  /** On-chain entity key of the profile entity. */
  entityKey: string
  /** The resolved profile data. */
  profile: BaseProfileData
}

/**
 * Returned by extension operations (get, getOrCreate, update).
 * @template T Shape of the app-specific data.
 */
export interface ExtensionResult<T extends Record<string, unknown>> {
  /** On-chain entity key of the extension entity. */
  entityKey: string
  /** The resolved extension data including app-specific payload. */
  extension: ExtensionData<T>
}

// ─── Client interfaces ─────────────────────────────────────────────────────────

/**
 * The main base client instance.
 * Manages a profile (uuid + wallet + photo + optional info) on the current chain.
 * The same profile is interoperable across all chains and apps.
 */
export interface BaseClientInstance {
  /** The profile's stable identifier. */
  readonly uuid: string
  /** The wallet address that owns this profile. */
  readonly wallet: string

  /**
   * Fetches the profile from the current chain.
   * Returns `null` if no profile exists yet.
   */
  get(): Promise<BaseProfileResult | null>

  /**
   * Fetches the profile from the current chain.
   * If no profile exists, creates one with the options passed to `createBaseClient`.
   */
  getOrCreate(): Promise<BaseProfileResult>

  /**
   * Updates mutable fields of an existing profile on the current chain.
   * Throws if the profile has not been created yet.
   */
  update(data: Partial<Pick<BaseProfileData, 'photo' | 'displayName' | 'bio'>>): Promise<BaseProfileResult>

  /**
   * Cross-chain sync: looks for the profile on the current chain first.
   * If not found, checks each supplied CDN (other chains) in order.
   * When a match is found it is **replicated** to the current chain automatically.
   * If the profile does not exist anywhere, it is created fresh.
   *
   * @param otherChains - ArkaCDN instances pointing to other chains to search.
   */
  sync(otherChains: Arbok[]): Promise<BaseProfileResult>

  /**
   * Returns an {@link ExtensionClientInstance} scoped to `namespace`.
   * The extension is independent of the base client and stores app-specific data.
   *
   * @param namespace - A unique app identifier (e.g. `"my-game"`, `"my-dapp"`).
   *
   * @example
   * ```ts
   * const gameExt = client.extend<{ score: number; level: number }>('my-game')
   * const { extension } = await gameExt.getOrCreate({ score: 0, level: 1 })
   * ```
   */
  extend<T extends Record<string, unknown>>(namespace: string): ExtensionClientInstance<T>
}

/**
 * An app-specific extension client linked to a base profile.
 * Fully independent from the base client — the base profile is never modified.
 *
 * @template T Shape of the app-specific data.
 */
export interface ExtensionClientInstance<T extends Record<string, unknown>> {
  /**
   * Fetches the extension from the chain.
   * Returns `null` if the extension does not exist yet.
   */
  get(): Promise<ExtensionResult<T> | null>

  /**
   * Fetches the extension. If it does not exist, creates it with `initialData`.
   */
  getOrCreate(initialData: T): Promise<ExtensionResult<T>>

  /**
   * Partially updates the extension data.
   * Throws if the extension has not been created yet.
   */
  update(data: Partial<T>): Promise<ExtensionResult<T>>
}

// ─── Snowflake & Permissions ───────────────────────────────────────────────────

/**
 * A permission definition for a custom permission bit.
 * Permissions are stored as a bigint bitmask inside the ASide snowflake.
 */
export interface PermissionDefinition {
  /** Unique name for this permission (e.g. "READ_PROFILE"). */
  name: string
  /** The bit position (0–62). Each position = 2^n in the bitmask. */
  bit: number
  /** Human-readable description. */
  description?: string
}

/**
 * A Snowflake ID with embedded permission bits.
 * Format (128-bit, encoded as hex string):
 *   [48-bit timestamp ms][14-bit worker/datacenter][14-bit sequence][52-bit permissions]
 */
export type PermissionSnowflake = string

// ─── Access tokens ────────────────────────────────────────────────────────────

/**
 * Claims embedded inside an ASide access token (the encrypted payload).
 * All fields travel inside the AES-GCM ciphertext — never in plaintext.
 */
export interface AccessTokenClaims {
  /** Application ID that requested this token. */
  appId: string
  /** Domain the app is authorized for. */
  domain: string
  /**
   * Snowflake encoding the granted permissions bitmask.
   * Decode with `SnowflakeGenerator.extractPermissions(snowflake)`.
   */
  permissions: PermissionSnowflake
  /** Issued-at timestamp (Unix ms). */
  issuedAt: number
  /** Token expiry timestamp (Unix ms). */
  expiresAt: number
  /** UUID of the profile that issued this token. */
  issuerUuid: string
  /** Wallet address of the profile owner. */
  issuerWallet: string
  /** Unique token ID (snowflake). Used for reference / revocation hints. */
  tokenId: PermissionSnowflake
}

/**
 * A sealed access token ready to be handed to a third-party app.
 *
 * The inner claims are AES-256-GCM encrypted with a key derived from ECDH:
 * - The **client** uses the app's published public key + a freshly generated
 *   ephemeral key pair. The derived key never leaves the client.
 * - The **app server** uses its private key + the token's `ephemeralPublicKey`
 *   to re-derive the identical key and decrypt.
 */
export interface SealedAccessToken {
  /** Encrypted claims payload (base64url). */
  ciphertext: string
  /** AES-GCM initialization vector (base64url, 12 bytes). */
  iv: string
  /** App ID — in plaintext so the recipient can look up its key pair. */
  appId: string
  /** Token ID so it can be referenced/revoked without decrypting. */
  tokenId: PermissionSnowflake
  /** Expiry so clients can reject obviously expired tokens before decryption. */
  expiresAt: number
  /**
   * Ephemeral ECDH P-256 public key (uncompressed, hex, 65 bytes).
   * The server uses this with its private key to derive the AES encryption key.
   * Safe to transmit publicly — math guarantees the shared secret stays secret.
   */
  ephemeralPublicKey: string
}

/** Returned by `AccessTokenManager.create()`. */
export interface CreateAccessTokenResult {
  /** The sealed token to hand to the app server. */
  token: SealedAccessToken
  /**
   * Session HMAC key (hex) derived from the ECDH shared secret.
   * Stored by the client and passed to `createSessionRequest()`.
   * The server always re-derives this value during `validateSession()`.
   */
  sessionKey: string
}

/**
 * Options for creating an access token.
 */
export interface CreateAccessTokenOptions {
  /** The application ID being authorized. */
  appId: string
  /** Domain the token is valid for (e.g. "example.com"). */
  domain: string
  /** Permission bitmask or a pre-generated snowflake. Pass a `bigint` for a raw bitmask. */
  permissions: bigint | PermissionSnowflake
  /** Token lifetime in milliseconds. Default: 1 hour (3_600_000). */
  ttlMs?: number
  /**
   * The app's ECDH P-256 public key (uncompressed, hex).
   * Obtained from the app server. Safe to transmit over any channel.
   */
  appPublicKey: string
  /**
   * The user's private phrase. AES-256-GCM encrypted inside the token —
   * never transmitted in plaintext.
   */
  phrase: string
  /** Automatically set by `BaseClient.createAccessToken()`. */
  issuerUuid?: string
  /** Automatically set by `BaseClient.createAccessToken()`. */
  issuerWallet?: string
}

/**
 * Options for validating an access token.
 */
export interface ValidateTokenOptions {
  /** The sealed token to validate. */
  token: SealedAccessToken
  /**
   * The app's ECDH P-256 private key (PKCS8 hex).
   * Only the app server should hold this. Used to re-derive the AES key.
   */
  appPrivateKey: string
  /** Expected domain. Validation fails if `claims.domain` does not match. */
  expectedDomain?: string
  /** Expected app ID. Validation fails if `claims.appId` does not match. */
  expectedAppId?: string
}

/** Result of a successful token validation. */
export interface ValidateTokenResult {
  valid: true
  /** The decrypted, verified claims. */
  claims: AccessTokenClaims
  /** The decrypted user phrase (only available after correct decryption). */
  phrase: string
  /**
   * Session HMAC key re-derived from the ECDH shared secret.
   * Pass to `validateSession()` to verify signed session requests.
   */
  sessionKey: string
}

/** Result of a failed token validation. */
export interface InvalidTokenResult {
  valid: false
  reason: string
}

// ─── Parity key exchange (ECDH) ───────────────────────────────────────────────

/**
 * An ECDH P-256 key pair used for app-server token authorization.
 *
 * The server generates this pair once (or rotates periodically).
 * - **`privateKey`** — PKCS8-encoded hex; kept on the server, never shared.
 * - **`publicKey`**  — Uncompressed P-256 raw hex (65 bytes); publish on-chain or via API.
 *
 * With this scheme, no shared secret is ever transmitted: each token carries an
 * ephemeral public key and the server re-derives the matching encryption key locally.
 */
export interface AppKeyPair {
  /** PKCS8-encoded EC private key as hex string. **Never share this.** */
  privateKey: string
  /** Uncompressed P-256 public key (65 bytes) as hex. Safe to publish. */
  publicKey: string
  /** Unique ID for tracking which key pair was used (for rotation). */
  keyId: string
  /** Unix timestamp (ms) when this key pair was created. */
  createdAt: number
  /** Unix timestamp (ms) when this key pair expires. */
  expiresAt: number
}

/**
 * @deprecated Use {@link AppKeyPair} and {@link generateAppKeyPair} instead.
 * The symmetric parity key scheme is vulnerable to interception during key exchange.
 */
export interface ParityKeyPair {
  /** @deprecated */
  key: string
  /** @deprecated */
  keyId: string
  /** @deprecated */
  expiresAt: number
}

// ─── Watcher ──────────────────────────────────────────────────────────────────

/** A named CDN instance for a specific chain/network. */
export interface ChainCDN {
  /** Human-readable chain name (e.g. "kaolin", "mendoza"). */
  name: string
  /** The ArkaCDN instance for this chain. */
  cdn: Arbok
}

/** Result from a watcher poll — one entry per chain. */
export interface WatcherChainResult {
  chain: string
  exists: boolean
  profile: BaseProfileResult | null
}

/** Options for {@link ProfileWatcher}. */
export interface WatcherOptions {
  /** Chains to watch. */
  chains: ChainCDN[]
  /** Polling interval in ms. Default: 10_000 (10 seconds). */
  intervalMs?: number
  /** Called each time a poll cycle completes. */
  onPoll?: (results: WatcherChainResult[]) => void
  /** Called the first time a profile is found on a chain it wasn't on before. */
  onFound?: (chain: string, result: BaseProfileResult) => void
  /** Called if a previously-found profile disappears from a chain. */
  onLost?: (chain: string) => void
}

// ─── Session ──────────────────────────────────────────────────────────────────

/**
 * A session request payload — sent from the client to a service to prove
 * possession of a valid token without re-transmitting it every time.
 *
 * The signature is HMAC-SHA256 over `"${nonce}:${requestedAt}:${tokenId}"`
 * using the session key derived from the ECDH exchange.
 *
 * The server MUST track used nonces within the token's validity window to
 * prevent replay attacks.
 */
export interface SessionRequest {
  /** The sealed access token that authorized this session. */
  token: SealedAccessToken
  /** Unix timestamp (ms) when this specific request was created. */
  requestedAt: number
  /**
   * Unique nonce for this request.
   * Auto-generated by `createSessionRequest()`. The server SHOULD store and
   * reject nonces it has already seen within the token's lifetime.
   */
  nonce: string
  /** HMAC-SHA256 over `${nonce}:${requestedAt}:${tokenId}` (hex). */
  signature: string
}

// ─── Social graph ─────────────────────────────────────────────────────────────

export type SocialStatus = 'active' | 'removed'
export type FriendRequestStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled'
export type ReactionType = 'like' | 'love' | 'laugh' | 'wow' | 'sad' | 'angry'
export type PostMediaType = 'image' | 'video' | 'audio'

export interface SocialFollow {
  entityKey: string
  followerUuid: string
  followeeUuid: string
  followedAt: number
  status: SocialStatus
}

export interface FriendRequest {
  entityKey: string
  fromUuid: string
  fromWallet: string
  toUuid: string
  message?: string
  sentAt: number
  respondedAt?: number
  status: FriendRequestStatus
}

export interface SocialPost {
  entityKey: string
  authorUuid: string
  authorWallet: string
  content: string
  media?: PostMedia[]
  tags?: string[]
  /** UUIDs of mentioned profiles. */
  mentions?: string[]
  createdAt: number
  updatedAt: number
  status: SocialStatus
}

export interface PostMedia {
  url: string
  type: PostMediaType
  alt?: string
}

export interface SocialReaction {
  entityKey: string
  reactorUuid: string
  /** Entity key of the post or comment being reacted to. */
  targetEntityKey: string
  type: ReactionType
  createdAt: number
  status: SocialStatus
}

export interface SocialComment {
  entityKey: string
  authorUuid: string
  authorWallet: string
  /** Entity key of the post this comment belongs to. */
  targetEntityKey: string
  content: string
  createdAt: number
  updatedAt: number
  status: SocialStatus
}

export interface SocialBlock {
  entityKey: string
  byUuid: string
  blockedUuid: string
  blockedAt: number
  status: SocialStatus
}

// ─── Social create options ─────────────────────────────────────────────────────

export interface CreatePostOptions {
  content: string
  media?: PostMedia[]
  tags?: string[]
  mentions?: string[]
}

export interface PaginationOptions {
  limit?: number
  offset?: number
}

// ─── QR code data ─────────────────────────────────────────────────────────────

/** Decoded data from a profile QR code. */
export interface ProfileQRData {
  version: 1
  type: 'profile'
  uuid: string
  wallet: string
  displayName?: string
  photo?: string
}

/** Decoded data from a friend-request QR code. */
export interface FriendRequestQRData {
  version: 1
  type: 'friend_request'
  fromUuid: string
  fromWallet: string
  displayName?: string
  message?: string
  /** Unix timestamp (ms) after which this QR code should be rejected. */
  expiresAt: number
  /** Random nonce to prevent QR re-scanning attacks. */
  nonce: string
}

export interface QREncodeOptions {
  /** Lifetime of the QR data in ms. Default: 15 minutes. */
  expiresInMs?: number
  /** Optional human-readable message embedded in the QR. */
  message?: string
}

