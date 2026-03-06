/**
 * ProfileWatcher
 *
 * Polls multiple chains at a configurable interval to detect when a profile
 * appears on or disappears from each chain.
 *
 * ```ts
 * const watcher = new ProfileWatcher(client, {
 *   chains: [
 *     { name: 'kaolin', cdn: kaolinCdn },
 *     { name: 'mendoza', cdn: mendozaCdn },
 *   ],
 *   intervalMs: 15_000,
 *   onFound: (chain, result) => console.log(`Profile found on ${chain}!`, result),
 *   onLost: (chain) => console.log(`Profile lost on ${chain}`),
 * })
 *
 * watcher.start()
 * // later...
 * watcher.stop()
 * ```
 */

import type { WatcherChainResult, WatcherOptions } from './types.js'
import type { BaseClient } from './client.js'

export class ProfileWatcher {
  private readonly opts: Required<Omit<WatcherOptions, 'onPoll' | 'onFound' | 'onLost'>> & WatcherOptions
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly lastSeen = new Map<string, boolean>()

  constructor(
    private readonly client: BaseClient,
    opts: WatcherOptions,
  ) {
    this.opts = {
      intervalMs: 10_000,
      ...opts,
    }
  }

  get running(): boolean {
    return this.timer !== null
  }

  /** Starts polling. */
  start(): this {
    if (this.timer !== null) return this
    this.timer = setInterval(() => {
      void this.poll()
    }, this.opts.intervalMs)
    // Run immediately
    void this.poll()
    return this
  }

  /** Stops polling. */
  stop(): this {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    return this
  }

  /**
   * Runs one poll cycle manually.
   * Called automatically when `start()` is active.
   */
  async poll(): Promise<WatcherChainResult[]> {
    const results: WatcherChainResult[] = await Promise.all(
      this.opts.chains.map(async (chain) => {
        const profile = await this.client.getOnChain(chain.cdn)
        return { chain: chain.name, exists: profile !== null, profile }
      }),
    )

    for (const result of results) {
      const wasPresent = this.lastSeen.get(result.chain) ?? null

      if (result.exists && wasPresent !== true) {
        // Appeared or first seen
        this.opts.onFound?.(result.chain, result.profile!)
      }
      else if (!result.exists && wasPresent === true) {
        // Just disappeared
        this.opts.onLost?.(result.chain)
      }

      this.lastSeen.set(result.chain, result.exists)
    }

    this.opts.onPoll?.(results)
    return results
  }
}
