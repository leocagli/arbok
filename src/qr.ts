/**
 * QR code data utilities for Arbok.
 *
 * This module does **not** render QR images — it produces and parses the
 * structured data strings that you pass to any QR library (qrcode, qr-image,
 * react-native-qrcode-svg, etc.).
 *
 * ## URI scheme
 *
 * `arbok://v1/{type}?{base64url_encoded_json}`
 *
 * The payload is always base64url-encoded JSON, which keeps the URI ASCII-safe
 * and lets any QR scanner hand the URI back to the app unchanged.
 *
 * ## Usage
 *
 * ```ts
 * import { encodeProfileLink, decodeProfileLink, encodeFriendRequest, decodeFriendRequest } from 'arbok'
 *
 * // Profile QR
 * const uri = encodeProfileLink({ uuid: 'u1', wallet: '0xABCD' })
 * // → "arbok://v1/profile?eyJ2..."
 * const data = decodeProfileLink(uri)  // ProfileQRData
 *
 * // Friend request QR (time-limited, 15 minutes)
 * const reqUri = encodeFriendRequest({ fromUuid: 'u1', fromWallet: '0xABCD' })
 * const reqData = decodeFriendRequest(reqUri)  // FriendRequestQRData | null (null = expired)
 * ```
 */

import type {
  FriendRequestQRData,
  ProfileQRData,
  QREncodeOptions,
} from './types.js'

const PRIMARY_SCHEME = 'arbok://v1'
const LEGACY_SCHEME = 'aside://v1'
const DEFAULT_FRIEND_QR_TTL_MS = 15 * 60 * 1000 // 15 minutes

// ─── Encoding helpers ─────────────────────────────────────────────────────────

function toBase64url(json: unknown): string {
  const str = JSON.stringify(json)
  const bytes = new TextEncoder().encode(str)
  const binary = Array.from(bytes, b => String.fromCharCode(b)).join('')
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function fromBase64url(b64: string): unknown {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/').padEnd(
    b64.length + (4 - (b64.length % 4)) % 4,
    '=',
  )
  try {
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return JSON.parse(new TextDecoder().decode(bytes))
  }
  catch {
    return null
  }
}

function randomNonce(): string {
  return Array.from(
    globalThis.crypto.getRandomValues(new Uint8Array(12)),
    b => b.toString(16).padStart(2, '0'),
  ).join('')
}

// ─── Profile QR ───────────────────────────────────────────────────────────────

/**
 * Encodes a profile link as a scannable `arbok://v1/profile?{payload}` URI.
 *
 * Profile QR codes are **public** — they contain no sensitive data.
 *
 * @example
 * ```ts
 * const uri = encodeProfileLink({ uuid, wallet, displayName: 'Alice', photo })
 * // Pass `uri` to your QR library to render
 * ```
 */
export function encodeProfileLink(
  data: Omit<ProfileQRData, 'version' | 'type'>,
): string {
  const payload: ProfileQRData = {
    version: 1,
    type: 'profile',
    uuid: data.uuid,
    wallet: data.wallet,
    ...(data.displayName !== undefined ? { displayName: data.displayName } : {}),
    ...(data.photo !== undefined ? { photo: data.photo } : {}),
  }
  return `${PRIMARY_SCHEME}/profile?${toBase64url(payload)}`
}

/**
 * Decodes a profile QR URI produced by {@link encodeProfileLink}.
 *
 * Returns `null` if the URI is malformed or not a valid Arbok profile link.
 */
export function decodeProfileLink(uri: string): ProfileQRData | null {
  const data = parseUri(uri, 'profile')
  if (!data) return null
  if (
    typeof data !== 'object'
    || data === null
    || !hasStringProp(data, 'uuid')
    || !hasStringProp(data, 'wallet')
  ) return null
  return data as unknown as ProfileQRData
}

// ─── Friend request QR ────────────────────────────────────────────────────────

/**
 * Encodes a time-limited friend request as a scannable `arbok://v1/friend_request?{payload}` URI.
 *
 * The QR code expires after `options.expiresInMs` (default: 15 minutes).
 * A random nonce is embedded so the recipient can detect duplicate scans the same QR.
 *
 * @example
 * ```ts
 * const uri = encodeFriendRequest({
 *   fromUuid: client.uuid,
 *   fromWallet: client.wallet,
 *   displayName: 'Alice',
 *   message: 'Hey, add me!',
 * })
 * ```
 */
export function encodeFriendRequest(
  data: Omit<FriendRequestQRData, 'version' | 'type' | 'expiresAt' | 'nonce'>,
  options: QREncodeOptions = {},
): string {
  const ttl = options.expiresInMs ?? DEFAULT_FRIEND_QR_TTL_MS
  const payload: FriendRequestQRData = {
    version: 1,
    type: 'friend_request',
    fromUuid: data.fromUuid,
    fromWallet: data.fromWallet,
    expiresAt: Date.now() + ttl,
    nonce: randomNonce(),
    ...(data.displayName !== undefined ? { displayName: data.displayName } : {}),
    ...(options.message !== undefined ? { message: options.message } : {}),
    ...(data.message !== undefined ? { message: data.message } : {}),
  }
  return `${PRIMARY_SCHEME}/friend_request?${toBase64url(payload)}`
}

/**
 * Decodes a friend-request QR URI produced by {@link encodeFriendRequest}.
 *
 * Returns `null` if the URI is malformed, not a valid Arbok friend request, or
 * has already **expired**. Always check the return value before proceeding.
 *
 * @example
 * ```ts
 * const reqData = decodeFriendRequest(scannedUri)
 * if (!reqData) { alert('QR code expired or invalid'); return }
 * await social.sendFriendRequest(reqData.fromUuid)
 * ```
 */
export function decodeFriendRequest(uri: string): FriendRequestQRData | null {
  const data = parseUri(uri, 'friend_request')
  if (!data) return null
  if (
    typeof data !== 'object'
    || data === null
    || !hasStringProp(data, 'fromUuid')
    || !hasStringProp(data, 'fromWallet')
    || !hasNumberProp(data, 'expiresAt')
    || !hasStringProp(data, 'nonce')
  ) return null

  const req = data as unknown as FriendRequestQRData
  // Reject expired QR codes
  if (Date.now() > req.expiresAt) return null
  return req
}

/**
 * Returns `true` if `uri` is a valid (and not expired) Arbok friend request QR.
 * Convenience wrapper around {@link decodeFriendRequest}.
 */
export function isFriendRequestQRValid(uri: string): boolean {
  return decodeFriendRequest(uri) !== null
}

/**
 * Returns the number of milliseconds remaining before a friend request QR expires.
 * Returns `0` if already expired or the URI is invalid.
 */
export function friendRequestQRExpiresIn(uri: string): number {
  const data = parseUri(uri, 'friend_request')
  if (!data || typeof data !== 'object' || data === null || !hasNumberProp(data, 'expiresAt')) {
    return -Infinity
  }
  return (data as { expiresAt: number }).expiresAt - Date.now()
}

// ─── Generic parser ───────────────────────────────────────────────────────────

/**
 * Parses any `arbok://v1/{type}?{payload}` URI.
 * Returns the decoded JSON payload or `null` on error.
 */
export function parseArbokUri(uri: string): { type: string; payload: unknown } | null {
  const scheme = uri.startsWith(`${PRIMARY_SCHEME}/`)
    ? PRIMARY_SCHEME
    : uri.startsWith(`${LEGACY_SCHEME}/`)
      ? LEGACY_SCHEME
      : null

  if (!scheme) return null

  const withoutScheme = uri.slice(`${scheme}/`.length)
  const qIdx = withoutScheme.indexOf('?')
  if (qIdx === -1) return null
  const type = withoutScheme.slice(0, qIdx)
  const b64 = withoutScheme.slice(qIdx + 1)
  const payload = fromBase64url(b64)
  if (payload === null) return null
  return { type, payload }
}

/** @deprecated Use {@link parseArbokUri}. */
export function parseAsideUri(uri: string): { type: string; payload: unknown } | null {
  return parseArbokUri(uri)
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function parseUri(uri: string, expectedType: string): unknown | null {
  const parsed = parseArbokUri(uri)
  if (!parsed || parsed.type !== expectedType) return null
  return parsed.payload
}

function hasStringProp(obj: object, key: string): obj is Record<string, string> {
  return key in obj && typeof (obj as Record<string, unknown>)[key] === 'string'
}

function hasNumberProp(obj: object, key: string): obj is Record<string, number> {
  return key in obj && typeof (obj as Record<string, unknown>)[key] === 'number'
}
