/**
 * ASide AccessTokenManager
 *
 * Issues and validates short-lived access tokens that authorize third-party apps
 * to act on behalf of an ASide profile holder.
 *
 * ## Token flow (ECDH-based — no shared secret transmitted)
 *
 * 1. **App server** calls `generateAppKeyPair()` once.
 *    - Stores the private key securely.
 *    - Publishes the **public key** (e.g. on-chain or via an API endpoint).
 *
 * 2. **Client** calls `manager.create({ appPublicKey, phrase, ... })`.
 *    - Generates an ephemeral ECDH P-256 key pair locally.
 *    - ECDH(ephemeralPrivate, appPublicKey) → shared secret.
 *    - HKDF(sharedSecret, "aside-token-enc")     → encKey.
 *    - HKDF(sharedSecret, "aside-token-session") → sessionKey.
 *    - All claims (including phrase) are AES-256-GCM encrypted with encKey.
 *    - Returns `{ token, sessionKey }`. The raw encKey is discarded.
 *
 * 3. **App server** calls `manager.validate({ token, appPrivateKey })`.
 *    - ECDH(appPrivate, token.ephemeralPublicKey) → same shared secret.
 *    - Re-derives encKey and decrypts claims.
 *    - Returns `{ valid, claims, phrase, sessionKey }`.
 *
 * 4. **Client** calls `manager.createSessionRequest(token, sessionKey)`.
 *    - Signs `"${nonce}:${requestedAt}:${tokenId}"` with HMAC-SHA256 using sessionKey.
 *    - Nonce is auto-generated if not supplied.
 *
 * 5. **App server** calls `manager.validateSession(request, appPrivateKey)`.
 *    - Re-derives the same sessionKey via ECDH.
 *    - Verifies the HMAC signature.
 *
 * ## Security properties
 *
 * - **No shared secret transmission**: the app public key is safe to publish.
 *   Attackers observing the public key cannot derive the encKey.
 * - **Per-token forward secrecy**: each token uses a unique ephemeral key pair.
 * - **AES-256-GCM authentication tag**: any ciphertext tampering is detected.
 * - **Replay protection**: nonce is required in session requests; servers SHOULD
 *   store seen nonces for the duration of the token's validity window.
 * - **Domain + App ID binding**: prevents token reuse across different apps.
 */

import {
  DEFAULT_TOKEN_TTL_MS,
  MAX_REQUEST_AGE_MS,
} from './constants.js'
import {
  aesDecrypt,
  aesEncrypt,
  ecdhDeriveKeys,
  generateAppKeyPair,
  hmacSign,
  hmacVerify,
} from './crypto.js'
import { SnowflakeGenerator } from './snowflake.js'
import type {
  AccessTokenClaims,
  CreateAccessTokenOptions,
  CreateAccessTokenResult,
  InvalidTokenResult,
  SealedAccessToken,
  SessionRequest,
  ValidateTokenOptions,
  ValidateTokenResult,
} from './types.js'

/** Full encrypted payload (super-set of AccessTokenClaims). */
interface FullClaims extends AccessTokenClaims {
  /** Raw phrase — AES-GCM encrypted, never transmitted in plaintext. */
  phrase: string
}

export class AccessTokenManager {
  private readonly sf: SnowflakeGenerator

  constructor(private readonly workerId: bigint | number = 0) {
    this.sf = new SnowflakeGenerator({ workerId })
  }

  /**
   * Creates a sealed access token using ECDH P-256 key exchange.
   *
   * Returns both the `token` (hand to the app server) and a `sessionKey`
   * (retain client-side for signing session requests).
   */
  async create(options: CreateAccessTokenOptions): Promise<CreateAccessTokenResult> {
    const {
      appId,
      domain,
      permissions,
      ttlMs = DEFAULT_TOKEN_TTL_MS,
      appPublicKey,
      phrase,
      issuerUuid = '',
      issuerWallet = '',
    } = options

    // Ephemeral ECDH key pair — unique per token, guarantees per-token forward secrecy
    const ephemeralPair = await generateAppKeyPair(ttlMs + 60_000)
    const { encKey, sessionKey } = await ecdhDeriveKeys(ephemeralPair.privateKey, appPublicKey)

    const now = Date.now()
    const expiresAt = now + ttlMs

    const permSnowflake = typeof permissions === 'bigint'
      ? this.sf.generate({ permissions })
      : permissions

    const tokenId = this.sf.generate()

    const fullClaims: FullClaims = {
      appId,
      domain,
      permissions: permSnowflake,
      issuedAt: now,
      expiresAt,
      issuerUuid,
      issuerWallet,
      tokenId,
      phrase,
    }

    const { ciphertext, iv } = await aesEncrypt(JSON.stringify(fullClaims), encKey)

    const token: SealedAccessToken = {
      ciphertext,
      iv,
      appId,
      tokenId,
      expiresAt,
      ephemeralPublicKey: ephemeralPair.publicKey,
    }

    return { token, sessionKey }
  }

  /**
   * Validates and decrypts a sealed access token.
   *
   * Returns `{ valid: true, claims, phrase, sessionKey }` on success, or
   * `{ valid: false, reason }` on failure.
   */
  async validate(
    options: ValidateTokenOptions,
  ): Promise<ValidateTokenResult | InvalidTokenResult> {
    const { token, appPrivateKey, expectedDomain, expectedAppId } = options

    // Fast path: reject obviously expired tokens without decryption
    if (Date.now() > token.expiresAt) {
      return { valid: false, reason: 'Token has expired' }
    }

    // Re-derive keys using ECDH (server private key + ephemeral public key from token)
    let encKey: string
    let sessionKey: string
    try {
      ; ({ encKey, sessionKey } = await ecdhDeriveKeys(appPrivateKey, token.ephemeralPublicKey))
    }
    catch {
      return { valid: false, reason: 'ECDH key derivation failed — invalid key material' }
    }

    // Decrypt and parse claims
    let fullClaims: FullClaims
    try {
      const plaintext = await aesDecrypt(token.ciphertext, token.iv, encKey)
      fullClaims = JSON.parse(plaintext) as FullClaims
    }
    catch {
      return { valid: false, reason: 'Token decryption failed — invalid key or corrupted ciphertext' }
    }

    // Inner expiry check (double-check after decryption to prevent outer-field forgery)
    if (Date.now() > fullClaims.expiresAt) {
      return { valid: false, reason: 'Token has expired (inner claims)' }
    }

    // Domain binding
    if (expectedDomain !== undefined && fullClaims.domain !== expectedDomain) {
      return { valid: false, reason: `Domain mismatch: expected "${expectedDomain}", got "${fullClaims.domain}"` }
    }

    // App ID binding
    if (expectedAppId !== undefined && fullClaims.appId !== expectedAppId) {
      return { valid: false, reason: `App ID mismatch: expected "${expectedAppId}", got "${fullClaims.appId}"` }
    }

    // Token ID consistency (envelope vs inner claims — prevents envelope tampering)
    if (token.tokenId !== fullClaims.tokenId) {
      return { valid: false, reason: 'Token ID mismatch between envelope and claims' }
    }

    const { phrase, ...claims } = fullClaims

    return { valid: true, claims, phrase, sessionKey }
  }

  /**
   * Creates a signed {@link SessionRequest} from a validated token.
   *
   * The signature is HMAC-SHA256 over `"${nonce}:${requestedAt}:${tokenId}"`
   * using the `sessionKey` returned by `create()`.
   *
   * A random nonce is generated automatically if not provided.
   *
   * @param token      - The sealed token (from `create()`).
   * @param sessionKey - The session key returned by `create()`.
   * @param nonce      - Optional custom nonce (auto-generated when omitted).
   */
  async createSessionRequest(
    token: SealedAccessToken,
    sessionKey: string,
    nonce?: string,
  ): Promise<SessionRequest> {
    const requestedAt = Date.now()
    const resolvedNonce = nonce ?? Array.from(
      globalThis.crypto.getRandomValues(new Uint8Array(16)),
      b => b.toString(16).padStart(2, '0'),
    ).join('')
    const message = `${resolvedNonce}:${requestedAt}:${token.tokenId}`
    const signature = await hmacSign(message, sessionKey)
    return { token, requestedAt, nonce: resolvedNonce, signature }
  }

  /**
   * Validates an inbound {@link SessionRequest}.
   *
   * Checks (in order):
   * 1. Request timestamp is within the allowed clock skew (5 minutes).
   * 2. Token is not expired, domain/app binding passes, inner claims are intact.
   * 3. HMAC signature is valid (re-derived session key via ECDH).
   *
   * The server **SHOULD** track seen nonces and reject duplicates to fully prevent
   * replay attacks within the 5-minute window.
   */
  async validateSession(
    request: SessionRequest,
    appPrivateKey: string,
    options: { expectedDomain?: string; expectedAppId?: string } = {},
  ): Promise<ValidateTokenResult | InvalidTokenResult> {
    const age = Date.now() - request.requestedAt
    if (age < 0 || age > MAX_REQUEST_AGE_MS) {
      return { valid: false, reason: `Request is too old or from the future (age: ${age}ms)` }
    }

    const tokenResult = await this.validate({
      token: request.token,
      appPrivateKey,
      ...options,
    })
    if (!tokenResult.valid) return tokenResult

    // Re-derive session key from ECDH and verify the HMAC
    const message = `${request.nonce}:${request.requestedAt}:${request.token.tokenId}`
    const sigValid = await hmacVerify(message, request.signature, tokenResult.sessionKey)
    if (!sigValid) {
      return { valid: false, reason: 'Invalid request signature' }
    }

    return tokenResult
  }
}
