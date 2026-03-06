import { describe, it, expect, vi } from 'vitest'
import {
  encodeProfileLink,
  decodeProfileLink,
  encodeFriendRequest,
  decodeFriendRequest,
  isFriendRequestQRValid,
  friendRequestQRExpiresIn,
  parseArbokUri,
  parseAsideUri,
} from '../src/qr.js'

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('QR utilities', () => {
  describe('encodeProfileLink() / decodeProfileLink()', () => {
    it('encodes a profile link URI', () => {
      const uri = encodeProfileLink({
        version: 1,
        type: 'profile',
        uuid: 'user-uuid-123',
        wallet: '0xABCD',
        displayName: 'Alice',
      })
      expect(uri.startsWith('arbok://v1/profile?')).toBe(true)
    })

    it('decodes a profile link roundtrip', () => {
      const data = { version: 1, type: 'profile' as const, uuid: 'user-abc', wallet: '0xWallet' }
      const uri = encodeProfileLink(data)
      const decoded = decodeProfileLink(uri)
      expect(decoded).not.toBeNull()
      expect(decoded!.uuid).toBe('user-abc')
      expect(decoded!.wallet).toBe('0xWallet')
    })

    it('decodeProfileLink returns null for garbage input', () => {
      expect(decodeProfileLink('not-a-uri')).toBeNull()
      expect(decodeProfileLink('arbok://v1/profile?!!!')).toBeNull()
      expect(decodeProfileLink('')).toBeNull()
    })

    it('decodeProfileLink returns null for wrong type', () => {
      const uri = encodeFriendRequest({ fromUuid: 'u1', fromWallet: '0xW1' })
      expect(decodeProfileLink(uri)).toBeNull()
    })

    it('preserves optional displayName', () => {
      const uri = encodeProfileLink({
        version: 1,
        type: 'profile',
        uuid: 'u1',
        wallet: '0xW',
        displayName: 'Bob',
      })
      const decoded = decodeProfileLink(uri)
      expect(decoded!.displayName).toBe('Bob')
    })
  })

  describe('encodeFriendRequest() / decodeFriendRequest()', () => {
    it('encodes a friend-request URI', () => {
      const uri = encodeFriendRequest({ fromUuid: 'u1', fromWallet: '0xW1' })
      expect(uri.startsWith('arbok://v1/friend_request?')).toBe(true)
    })

    it('decodes a friend-request roundtrip', () => {
      const uri = encodeFriendRequest({ fromUuid: 'u1', fromWallet: '0xW1', displayName: 'Alice' })
      const data = decodeFriendRequest(uri)
      expect(data).not.toBeNull()
      expect(data!.fromUuid).toBe('u1')
      expect(data!.fromWallet).toBe('0xW1')
      expect(data!.displayName).toBe('Alice')
    })

    it('includes a nonce', () => {
      const uri = encodeFriendRequest({ fromUuid: 'u1', fromWallet: '0xW1' })
      const data = decodeFriendRequest(uri)
      expect(data!.nonce).toBeTruthy()
      expect(data!.nonce.length).toBeGreaterThan(4)
    })

    it('generates different nonces for each call', () => {
      const uri1 = encodeFriendRequest({ fromUuid: 'u1', fromWallet: '0xW1' })
      const uri2 = encodeFriendRequest({ fromUuid: 'u1', fromWallet: '0xW1' })
      const d1 = decodeFriendRequest(uri1)
      const d2 = decodeFriendRequest(uri2)
      expect(d1!.nonce).not.toBe(d2!.nonce)
    })

    it('returns null for an expired QR code', () => {
      // expired 10 seconds ago
      const uri = encodeFriendRequest({ fromUuid: 'u1', fromWallet: '0xW1' }, { expiresInMs: -10_000 })
      expect(decodeFriendRequest(uri)).toBeNull()
    })

    it('returns null for garbage input', () => {
      expect(decodeFriendRequest('garbage')).toBeNull()
      expect(decodeFriendRequest('')).toBeNull()
    })

    it('respects custom expiresInMs', () => {
      const ttl = 60_000
      const before = Date.now()
      const uri = encodeFriendRequest({ fromUuid: 'u1', fromWallet: '0xW1' }, { expiresInMs: ttl })
      const data = decodeFriendRequest(uri)
      expect(data!.expiresAt).toBeGreaterThanOrEqual(before + ttl - 100)
    })
  })

  describe('isFriendRequestQRValid()', () => {
    it('returns true for a fresh QR', () => {
      const uri = encodeFriendRequest({ fromUuid: 'u1', fromWallet: '0xW1' })
      expect(isFriendRequestQRValid(uri)).toBe(true)
    })

    it('returns false for an expired QR', () => {
      const uri = encodeFriendRequest({ fromUuid: 'u1', fromWallet: '0xW1' }, { expiresInMs: -1000 })
      expect(isFriendRequestQRValid(uri)).toBe(false)
    })

    it('returns false for garbage', () => {
      expect(isFriendRequestQRValid('not-a-qr')).toBe(false)
    })
  })

  describe('friendRequestQRExpiresIn()', () => {
    it('returns remaining ms for a fresh QR', () => {
      const ttl = 30_000
      const uri = encodeFriendRequest({ fromUuid: 'u1', fromWallet: '0xW1' }, { expiresInMs: ttl })
      const remaining = friendRequestQRExpiresIn(uri)
      expect(remaining).toBeGreaterThan(0)
      expect(remaining).toBeLessThanOrEqual(ttl)
    })

    it('returns a negative value for an expired QR', () => {
      const uri = encodeFriendRequest({ fromUuid: 'u1', fromWallet: '0xW1' }, { expiresInMs: -5000 })
      expect(friendRequestQRExpiresIn(uri)).toBeLessThan(0)
    })

    it('returns -Infinity for garbage', () => {
      expect(friendRequestQRExpiresIn('garbage')).toBe(-Infinity)
    })
  })

  describe('parseArbokUri()', () => {
    it('parses a profile URI', () => {
      const uri = encodeProfileLink({ version: 1, type: 'profile', uuid: 'u1', wallet: '0xW1' })
      const result = parseArbokUri(uri)
      expect(result).not.toBeNull()
      expect(result!.type).toBe('profile')
      expect(result!.payload).toBeDefined()
    })

    it('accepts legacy aside:// URIs for backward compatibility', () => {
      const legacy = 'aside://v1/profile?eyJ2ZXJzaW9uIjoxLCJ0eXBlIjoicHJvZmlsZSIsInV1aWQiOiJ1MSIsIndhbGxldCI6IjB4VzEifQ'
      const result = parseArbokUri(legacy)
      expect(result).not.toBeNull()
      expect(result!.type).toBe('profile')
    })

    it('returns null for non-arbok URIs', () => {
      expect(parseArbokUri('https://example.com')).toBeNull()
      expect(parseArbokUri('arbok://v2/profile?abc')).toBeNull()
      expect(parseArbokUri('')).toBeNull()
    })
  })

  describe('parseAsideUri()', () => {
    it('parses a profile URI', () => {
      const uri = encodeProfileLink({ version: 1, type: 'profile', uuid: 'u1', wallet: '0xW1' })
      const result = parseAsideUri(uri)
      expect(result).not.toBeNull()
      expect(result!.type).toBe('profile')
      expect(result!.payload).toBeDefined()
    })

    it('parses a friend_request URI', () => {
      const uri = encodeFriendRequest({ fromUuid: 'u1', fromWallet: '0xW1' })
      const result = parseAsideUri(uri)
      expect(result).not.toBeNull()
      expect(result!.type).toBe('friend_request')
    })

    it('returns null for non-aside URIs', () => {
      expect(parseAsideUri('https://example.com')).toBeNull()
      expect(parseAsideUri('aside://v2/profile?abc')).toBeNull()
      expect(parseAsideUri('')).toBeNull()
    })

    it('returns null for malformed payload', () => {
      expect(parseAsideUri('aside://v1/profile?!@#$%')).toBeNull()
    })
  })
})
