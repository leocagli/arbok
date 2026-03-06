import { describe, it, expect, beforeEach } from 'vitest'
import { SnowflakeGenerator } from '../src/snowflake.js'
import { SNOWFLAKE_EPOCH } from '../src/constants.js'

describe('SnowflakeGenerator', () => {
  let sf: SnowflakeGenerator

  beforeEach(() => {
    sf = new SnowflakeGenerator({ workerId: 1n })
    sf.definePermission({ name: 'READ', bit: 0 })
    sf.definePermission({ name: 'WRITE', bit: 1 })
    sf.definePermission({ name: 'ADMIN', bit: 2 })
  })

  describe('constructor', () => {
    it('accepts numeric workerId', () => {
      expect(() => new SnowflakeGenerator({ workerId: 5 })).not.toThrow()
    })

    it('throws for out-of-range workerId', () => {
      expect(() => new SnowflakeGenerator({ workerId: -1n })).toThrow('workerId')
      expect(() => new SnowflakeGenerator({ workerId: 20000n })).toThrow('workerId')
    })
  })

  describe('definePermission()', () => {
    it('registers a permission', () => {
      const perms = sf.getPermissions()
      expect(perms.find(p => p.name === 'READ')).toBeDefined()
    })

    it('throws for bit out of range', () => {
      expect(() => sf.definePermission({ name: 'BAD', bit: 52 })).toThrow('bit')
      expect(() => sf.definePermission({ name: 'BAD', bit: -1 })).toThrow('bit')
    })

    it('supports chaining', () => {
      const gen = new SnowflakeGenerator()
      const result = gen.definePermission({ name: 'X', bit: 0 })
      expect(result).toBe(gen)
    })
  })

  describe('generate()', () => {
    it('generates a 32-char hex string', () => {
      const flake = sf.generate()
      expect(flake).toHaveLength(32)
      expect(/^[0-9a-f]{32}$/.test(flake)).toBe(true)
    })

    it('generates unique IDs', () => {
      const ids = new Set(Array.from({ length: 100 }, () => sf.generate()))
      expect(ids.size).toBe(100)
    })

    it('embeds permission bits when given names', () => {
      const flake = sf.generate({ permissions: ['READ', 'ADMIN'] })
      const decoded = sf.decode(flake)
      expect(decoded.permissions).toContain('READ')
      expect(decoded.permissions).toContain('ADMIN')
      expect(decoded.permissions).not.toContain('WRITE')
    })

    it('embeds permission bits when given bigint', () => {
      const flake = sf.generate({ permissions: 0b111n }) // READ | WRITE | ADMIN
      const decoded = sf.decode(flake)
      expect(decoded.permissions).toContain('READ')
      expect(decoded.permissions).toContain('WRITE')
      expect(decoded.permissions).toContain('ADMIN')
    })

    it('throws for unknown permission name', () => {
      expect(() => sf.generate({ permissions: ['UNKNOWN'] })).toThrow('unknown permission')
    })
  })

  describe('decode()', () => {
    it('round-trips: generate then decode', () => {
      const before = Date.now()
      const flake = sf.generate({ permissions: ['READ', 'WRITE'] })
      const after = Date.now()

      const decoded = sf.decode(flake)

      expect(decoded.workerId).toBe(1n)
      expect(decoded.timestamp.getTime()).toBeGreaterThanOrEqual(before)
      expect(decoded.timestamp.getTime()).toBeLessThanOrEqual(after + 1)
      expect(decoded.permissions).toContain('READ')
      expect(decoded.permissions).toContain('WRITE')
      expect(decoded.permissions).not.toContain('ADMIN')
      expect(decoded.hex).toBe(flake)
    })

    it('timestamps are close to current time', () => {
      const flake = sf.generate()
      const decoded = sf.decode(flake)
      const diff = Math.abs(decoded.timestamp.getTime() - Date.now())
      expect(diff).toBeLessThan(1000)
    })
  })

  describe('static extractPermissions()', () => {
    it('extracts the raw permission bitmask', () => {
      const flake = sf.generate({ permissions: ['READ'] })
      const bits = SnowflakeGenerator.extractPermissions(flake)
      expect(bits & 1n).toBe(1n) // bit 0 = READ
    })
  })

  describe('static hasPermission()', () => {
    it('returns true for a set bit', () => {
      const flake = sf.generate({ permissions: ['ADMIN'] })
      expect(SnowflakeGenerator.hasPermission(flake, 2)).toBe(true)
    })

    it('returns false for an unset bit', () => {
      const flake = sf.generate({ permissions: ['READ'] })
      expect(SnowflakeGenerator.hasPermission(flake, 1)).toBe(false) // WRITE not set
    })
  })

  describe('SNOWFLAKE_EPOCH', () => {
    it('is 2025-01-01T00:00:00.000Z', () => {
      expect(Number(SNOWFLAKE_EPOCH)).toBe(new Date('2025-01-01T00:00:00.000Z').getTime())
    })
  })
})
