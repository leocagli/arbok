/**
 * ArkaCDN – high-level client for storing and retrieving files on Arkiv.
 *
 * The API is split into two namespaces:
 *
 *  - **`cdn.entity`** – low-level Arkiv entity operations (CRUD, query, watch).
 *  - **`cdn.file`** – high-level CDN operations (chunked upload / download,
 *    encryption, multi-wallet parallel throughput).
 *
 * ### Quick start – Browser / MetaMask
 * ```ts
 * import { ArkaCDN, PublicClient, WalletClient, custom } from 'arka-cdn'
 *
 * await window.ethereum.request({ method: 'eth_requestAccounts' })
 *
 * const cdn = ArkaCDN.create({
 *   publicClient: new PublicClient(),                                   // defaults: kaolin + http
 *   wallets: new WalletClient({ transport: custom(window.ethereum) }),
 * })
 *
 * const { manifestKey } = await cdn.file.upload(file)
 * const { data } = await cdn.file.download(manifestKey)
 * ```
 *
 * ### Quick start – Node.js
 * ```ts
 * import { ArkaCDN, PublicClient, WalletClient, privateKeyToAccount } from 'arka-cdn'
 *
 * const cdn = ArkaCDN.create({
 *   publicClient: new PublicClient(),
 *   wallets: new WalletClient({ account: privateKeyToAccount(process.env.PRIVATE_KEY!) }),
 * })
 * ```
 *
 * ### Multi-wallet (parallel upload throughput)
 * ```ts
 * import { ArkaCDN, PublicClient, WalletClient, privateKeyToAccount } from 'arka-cdn'
 *
 * const cdn = ArkaCDN.create({
 *   publicClient: new PublicClient(),
 *   wallets: new Map([
 *     ['primary',   new WalletClient({ account: privateKeyToAccount(process.env.KEY1!) })],
 *     ['secondary', new WalletClient({ account: privateKeyToAccount(process.env.KEY2!) })],
 *   ]),
 * })
 * ```
 */

import type { ArbokConfig } from './types.js'
import type {
  Attribute,
  Entity,
  PublicArkivClient,
  WalletArkivClient,
} from '@arkiv-network/sdk'
import { EntityService } from './entity/entity-service.js'
import { FileService } from './file/file-service.js'
import { DEFAULT_CHUNK_SIZE } from './upload/chunker.js'
import { Downloader } from './download/downloader.js'
import { Uploader } from './upload/uploader.js'
import { WalletPool } from './upload/wallet-pool.js'

// ── Re-exports ────────────────────────────────────────────────────────────────────────────
export type { Attribute, Entity, PublicArkivClient, WalletArkivClient }
export type { PublicArkivClient as ArkivPublicClient }

// ── ArkaCDN ───────────────────────────────────────────────────────────────────────────────

export class Arbok {
  /**
   * Low-level entity operations.
   * - `cdn.entity.create(params)`
   * - `cdn.entity.update(params)`
   * - `cdn.entity.delete(params)`
   * - `cdn.entity.extend(params)` – `additionalTime` in seconds
   * - `cdn.entity.batch(params)` – mutate multiple entities in one TX
   * - `cdn.entity.get(key)`
   * - `cdn.entity.query()` – returns a `QueryBuilder`
   * - `cdn.entity.watch(options)` – subscribe to on-chain events
   */
  readonly entity: EntityService

  /**
   * High-level CDN file operations.
   * - `cdn.file.upload(input, options?)`
   * - `cdn.file.download(manifestKey, options?)`
   * - `cdn.file.manifest(manifestKey)`
   */
  readonly file: FileService

  /** The underlying wallet pool (exposed for advanced orchestration). */
  readonly pool: WalletPool

  /** The Arkiv public client passed at construction. */
  readonly publicClient: PublicArkivClient

  private constructor(
    pool: WalletPool,
    publicClient: PublicArkivClient,
    entityService: EntityService,
    fileService: FileService,
  ) {
    this.pool = pool
    this.publicClient = publicClient
    this.entity = entityService
    this.file = fileService
  }

  /**
  * Creates an {@link Arbok} instance from pre-built Arkiv clients.
   *
   * Supports MetaMask, private-key wallets, and multi-wallet setups.
   */
  static create(config: ArbokConfig): Arbok {
    const pool = WalletPool.fromClients(config.wallets)
    const maxChunkSize = config.maxChunkSize ?? DEFAULT_CHUNK_SIZE
    const defaultExpiresIn = config.defaultExpiresIn

    const uploader = new Uploader(pool, maxChunkSize, defaultExpiresIn)
    const downloader = new Downloader(config.publicClient)
    const entityService = new EntityService(pool, config.publicClient)
    const fileService = new FileService(uploader, downloader)

    return new Arbok(pool, config.publicClient, entityService, fileService)
  }
}

// ── Aliases & convenience exports ────────────────────────────────────────────────────────

/** Backward-compatible alias for {@link Arbok}. */
export { Arbok as ArkaCDN, Arbok as ArkivCDN }

/** Convenience factory – equivalent to `Arbok.create(config)`. */
export function createArbok(config: ArbokConfig): Arbok {
  return Arbok.create(config)
}

/** @deprecated Use {@link createArbok}. */
export function createArkaCDN(config: ArbokConfig): Arbok {
  return createArbok(config)
}
