import { eq, jsonToPayload, ExpirationTime } from './arbok/index.js'
import type { Arbok, Hex } from './arbok/index.js'
import {
  ATTR_NAMESPACE,
  ATTR_TYPE,
  ATTR_UUID,
  ATTR_WALLET,
  DEFAULT_EXPIRY_SECONDS,
  EXTENSION_TYPE,
  LEGACY_ATTR_NAMESPACE,
  LEGACY_ATTR_TYPE,
  LEGACY_ATTR_UUID,
  LEGACY_ATTR_WALLET,
} from './constants.js'
import type {
  ExtensionClientInstance,
  ExtensionData,
  ExtensionResult,
} from './types.js'

/**
 * Internal implementation of {@link ExtensionClientInstance}.
 * Manages a single app-specific extension entity on-chain,
 * linked to a base profile via `uuid` + `wallet` + `namespace`.
 */
export class ExtensionClient<T extends Record<string, unknown>>
  implements ExtensionClientInstance<T> {
  constructor(
    private readonly namespace: string,
    private readonly cdn: Arbok,
    private readonly uuid: string,
    private readonly wallet: string,
  ) { }

  private async findExtension(): Promise<ExtensionResult<T> | null> {
    const result = await this.cdn.entity
      .query()
      .where([
        eq(ATTR_TYPE, EXTENSION_TYPE),
        eq(ATTR_UUID, this.uuid),
        eq(ATTR_WALLET, this.wallet),
        eq(ATTR_NAMESPACE, this.namespace),
      ])
      .withPayload(true)
      .withAttributes(true)
      .fetch()

    const legacyResult = result.entities.length > 0
      ? result
      : await this.cdn.entity
          .query()
          .where([
            eq(LEGACY_ATTR_TYPE, EXTENSION_TYPE),
            eq(LEGACY_ATTR_UUID, this.uuid),
            eq(LEGACY_ATTR_WALLET, this.wallet),
            eq(LEGACY_ATTR_NAMESPACE, this.namespace),
          ])
          .withPayload(true)
          .withAttributes(true)
          .fetch()

    const entity = legacyResult.entities[0]
    if (!entity) return null

    const extension = entity.toJson() as ExtensionData<T>
    return { entityKey: entity.key, extension }
  }

  async get(): Promise<ExtensionResult<T> | null> {
    return this.findExtension()
  }

  async getOrCreate(initialData: T): Promise<ExtensionResult<T>> {
    const existing = await this.findExtension()
    if (existing) return existing

    const now = Date.now()
    const extensionData: ExtensionData<T> = {
      namespace: this.namespace,
      uuid: this.uuid,
      wallet: this.wallet,
      data: initialData,
      createdAt: now,
      updatedAt: now,
    }

    const { entityKey } = await this.cdn.entity.create({
      payload: jsonToPayload(extensionData),
      contentType: 'application/json',
      attributes: buildExtensionAttributes(this.uuid, this.wallet, this.namespace),
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })

    return { entityKey, extension: extensionData }
  }

  async update(data: Partial<T>): Promise<ExtensionResult<T>> {
    const existing = await this.findExtension()
    if (!existing) {
      throw new Error(
        `ASide: extension "${this.namespace}" not found for uuid="${this.uuid}". Call getOrCreate() first.`,
      )
    }

    const now = Date.now()
    const updated: ExtensionData<T> = {
      ...existing.extension,
      data: { ...existing.extension.data, ...data },
      updatedAt: now,
    }

    await this.cdn.entity.update({
      entityKey: existing.entityKey as Hex,
      payload: jsonToPayload(updated),
      contentType: 'application/json',
      attributes: buildExtensionAttributes(this.uuid, this.wallet, this.namespace),
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })

    return { entityKey: existing.entityKey, extension: updated }
  }
}

function buildExtensionAttributes(
  uuid: string,
  wallet: string,
  namespace: string,
): Array<{ key: string; value: string }> {
  return [
    { key: ATTR_TYPE, value: EXTENSION_TYPE },
    { key: ATTR_UUID, value: uuid },
    { key: ATTR_WALLET, value: wallet },
    { key: ATTR_NAMESPACE, value: namespace },
    { key: LEGACY_ATTR_TYPE, value: EXTENSION_TYPE },
    { key: LEGACY_ATTR_UUID, value: uuid },
    { key: LEGACY_ATTR_WALLET, value: wallet },
    { key: LEGACY_ATTR_NAMESPACE, value: namespace },
  ]
}
