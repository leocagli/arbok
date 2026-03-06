/**
 * Backward-compatible factory that wraps the new BaseClient class.
 * Prefer using 
ew BaseClient(options) directly in new code.
 *
 * @deprecated Use 
ew BaseClient(options) instead.
 */
import { BaseClient } from './base-client.js'
export { BaseClient }
export type { BaseClientOptions } from './types.js'

export function createBaseClient(options: ConstructorParameters<typeof BaseClient>[0]): BaseClient {
  return new BaseClient(options)
}
