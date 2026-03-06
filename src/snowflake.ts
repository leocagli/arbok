/**
 * ASide SnowflakeGenerator
 *
 * Generates 128-bit snowflake IDs with embedded permission bitmasks.
 *
 * Structure (bits, left to right):
 *   [48 timestamp ms] [14 worker] [14 sequence] [52 permissions]
 *
 * Encoded as a 32-character lowercase hex string.
 *
 * Usage:
 * ```ts
 * const sf = new SnowflakeGenerator({ workerId: 1n })
 *
 * // Register custom permissions
 * sf.definePermission({ name: 'READ_PROFILE', bit: 0 })
 * sf.definePermission({ name: 'WRITE_PROFILE', bit: 1 })
 * sf.definePermission({ name: 'MANAGE_TOKENS', bit: 2 })
 *
 * // Generate a snowflake granting READ_PROFILE + MANAGE_TOKENS
 * const flake = sf.generate({ permissions: ['READ_PROFILE', 'MANAGE_TOKENS'] })
 *
 * // Decode
 * const { timestamp, permissions } = sf.decode(flake)
 * ```
 */

import {
  MAX_PERMISSIONS,
  MAX_SEQUENCE,
  MAX_WORKER_ID,
  SNOWFLAKE_EPOCH,
  SNOWFLAKE_PERMISSION_BITS,
  SNOWFLAKE_SEQUENCE_BITS,
  SNOWFLAKE_WORKER_BITS,
} from './constants.js'
import type { PermissionDefinition, PermissionSnowflake } from './types.js'

export interface SnowflakeGeneratorOptions {
  /** Worker / datacenter ID (0 – 16383). Default: 0. */
  workerId?: bigint | number
}

export interface GenerateSnowflakeOptions {
  /**
   * Named permissions to embed.
   * Pass an array of registered permission names (e.g. `['READ_PROFILE', 'WRITE_PROFILE']`).
   * OR pass a raw `bigint` bitmask directly.
   */
  permissions?: string[] | bigint
}

export interface DecodedSnowflake {
  /** Raw 128-bit bigint. */
  raw: bigint
  /** Original hex string. */
  hex: PermissionSnowflake
  /** UTC timestamp embedded in the snowflake. */
  timestamp: Date
  /** Worker ID. */
  workerId: bigint
  /** Sequence counter. */
  sequence: bigint
  /** Raw permission bitmask. */
  permissionBits: bigint
  /** Resolved permission names (only names registered on this generator instance). */
  permissions: string[]
}

export class SnowflakeGenerator {
  private readonly workerId: bigint
  private sequence = 0n
  private lastMs = -1n
  private readonly permissions = new Map<string, PermissionDefinition>()

  constructor(options: SnowflakeGeneratorOptions = {}) {
    const wid = BigInt(options.workerId ?? 0)
    if (wid < 0n || wid > MAX_WORKER_ID) {
      throw new RangeError(`ASide: workerId must be 0–${MAX_WORKER_ID}, got ${wid}`)
    }
    this.workerId = wid
  }

  // ─── Permission registry ──────────────────────────────────────────────────

  /**
   * Registers a new permission definition.
   * Bit positions 0–51 are available (52 bits total).
   */
  definePermission(def: PermissionDefinition): this {
    if (def.bit < 0 || def.bit > 51) {
      throw new RangeError(`ASide: permission bit must be 0–51, got ${def.bit}`)
    }
    this.permissions.set(def.name, def)
    return this
  }

  /** Returns all registered permissions. */
  getPermissions(): PermissionDefinition[] {
    return Array.from(this.permissions.values())
  }

  /** Resolves an array of permission names into a bitmask. */
  resolveBitmask(names: string[]): bigint {
    let mask = 0n
    for (const name of names) {
      const def = this.permissions.get(name)
      if (!def) throw new Error(`ASide: unknown permission "${name}"`)
      mask |= 1n << BigInt(def.bit)
    }
    return mask
  }

  /** Resolves a bitmask into permission names (only registered ones). */
  resolveNames(mask: bigint): string[] {
    const result: string[] = []
    for (const def of this.permissions.values()) {
      if ((mask >> BigInt(def.bit)) & 1n) result.push(def.name)
    }
    return result
  }

  // ─── Generation ───────────────────────────────────────────────────────────

  /**
   * Generates a new 128-bit snowflake.
   * Thread-safe within a single JS event loop (monotonic sequence counter).
   */
  generate(options: GenerateSnowflakeOptions = {}): PermissionSnowflake {
    let ms = BigInt(Date.now()) - SNOWFLAKE_EPOCH

    if (ms < this.lastMs) {
      // Clock moved backwards — wait for it to catch up
      ms = this.lastMs
    }

    if (ms === this.lastMs) {
      this.sequence = (this.sequence + 1n) & MAX_SEQUENCE
      if (this.sequence === 0n) {
        // Sequence exhausted in this ms — spin to next ms
        ms = ms + 1n
        this.lastMs = ms
      }
    }
    else {
      this.sequence = 0n
      this.lastMs = ms
    }

    let permBits: bigint
    if (options.permissions === undefined) {
      permBits = 0n
    }
    else if (typeof options.permissions === 'bigint') {
      permBits = options.permissions & MAX_PERMISSIONS
    }
    else {
      permBits = this.resolveBitmask(options.permissions) & MAX_PERMISSIONS
    }

    const flake =
      (ms << (SNOWFLAKE_WORKER_BITS + SNOWFLAKE_SEQUENCE_BITS + SNOWFLAKE_PERMISSION_BITS))
      | (this.workerId << (SNOWFLAKE_SEQUENCE_BITS + SNOWFLAKE_PERMISSION_BITS))
      | (this.sequence << SNOWFLAKE_PERMISSION_BITS)
      | permBits

    return flake.toString(16).padStart(32, '0')
  }

  // ─── Decoding ─────────────────────────────────────────────────────────────

  /** Decodes a snowflake hex string back into its components. */
  decode(snowflake: PermissionSnowflake): DecodedSnowflake {
    const raw = BigInt(`0x${snowflake}`)

    const permBits = raw & MAX_PERMISSIONS
    const sequence = (raw >> SNOWFLAKE_PERMISSION_BITS) & MAX_SEQUENCE
    const workerId = (raw >> (SNOWFLAKE_PERMISSION_BITS + SNOWFLAKE_SEQUENCE_BITS)) & MAX_WORKER_ID
    const tsOffset = raw >> (SNOWFLAKE_PERMISSION_BITS + SNOWFLAKE_SEQUENCE_BITS + SNOWFLAKE_WORKER_BITS)
    const timestamp = new Date(Number(tsOffset + SNOWFLAKE_EPOCH))

    return {
      raw,
      hex: snowflake,
      timestamp,
      workerId,
      sequence,
      permissionBits: permBits,
      permissions: this.resolveNames(permBits),
    }
  }

  /**
   * Extracts just the permission bitmask from a snowflake without full decoding.
   * Useful for quick permission checks.
   */
  static extractPermissions(snowflake: PermissionSnowflake): bigint {
    return BigInt(`0x${snowflake}`) & MAX_PERMISSIONS
  }

  /**
   * Checks if a snowflake has a specific permission bit set.
   *
   * @example
   * ```ts
   * if (SnowflakeGenerator.hasPermission(token.claims.permissions, 1n)) { ... }
   * ```
   */
  static hasPermission(snowflake: PermissionSnowflake, bit: bigint | number): boolean {
    const mask = 1n << BigInt(bit)
    return (SnowflakeGenerator.extractPermissions(snowflake) & mask) === mask
  }
}
