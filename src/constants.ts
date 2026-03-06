/** Shared attribute keys used for all Arbok entities. */
export const ATTR_TYPE = 'arbok_type'
export const ATTR_UUID = 'arbok_uuid'
export const ATTR_WALLET = 'arbok_wallet'
export const ATTR_NAMESPACE = 'arbok_namespace'

/** Attribute keys for social graph entities. */
export const ATTR_TARGET_UUID = 'arbok_social_target'      // followee / blocked / friend
export const ATTR_TARGET_KEY = 'arbok_social_target_key'  // post/comment entity key

/** Legacy dotted Arbok attribute keys for backward compatibility. */
export const LEGACY_ARBOK_ATTR_TYPE = 'arbok.type'
export const LEGACY_ARBOK_ATTR_UUID = 'arbok.uuid'
export const LEGACY_ARBOK_ATTR_WALLET = 'arbok.wallet'
export const LEGACY_ARBOK_ATTR_NAMESPACE = 'arbok.namespace'
export const LEGACY_ARBOK_ATTR_TARGET_UUID = 'arbok.social.target'
export const LEGACY_ARBOK_ATTR_TARGET_KEY = 'arbok.social.target_key'

/** Entity type discriminators stored in `arbok.type`. */
export const PROFILE_TYPE = 'profile'
export const EXTENSION_TYPE = 'extension'

/** Social entity type discriminators. */
export const SOCIAL_FOLLOW_TYPE = 'arbok.social.follow'
export const SOCIAL_FRIEND_REQUEST_TYPE = 'arbok.social.friend_request'
export const SOCIAL_POST_TYPE = 'arbok.social.post'
export const SOCIAL_REACTION_TYPE = 'arbok.social.reaction'
export const SOCIAL_COMMENT_TYPE = 'arbok.social.comment'
export const SOCIAL_BLOCK_TYPE = 'arbok.social.block'

/** Legacy ASide attribute keys for backward compatibility. */
export const LEGACY_ATTR_TYPE = 'aside.type'
export const LEGACY_ATTR_UUID = 'aside.uuid'
export const LEGACY_ATTR_WALLET = 'aside.wallet'
export const LEGACY_ATTR_NAMESPACE = 'aside.namespace'

/** Legacy ASide social attribute keys for backward compatibility. */
export const LEGACY_ATTR_TARGET_UUID = 'aside.social.target'
export const LEGACY_ATTR_TARGET_KEY = 'aside.social.target_key'

/** Legacy ASide social type discriminators for backward compatibility. */
export const LEGACY_SOCIAL_FOLLOW_TYPE = 'aside.social.follow'
export const LEGACY_SOCIAL_FRIEND_REQUEST_TYPE = 'aside.social.friend_request'
export const LEGACY_SOCIAL_POST_TYPE = 'aside.social.post'
export const LEGACY_SOCIAL_REACTION_TYPE = 'aside.social.reaction'
export const LEGACY_SOCIAL_COMMENT_TYPE = 'aside.social.comment'
export const LEGACY_SOCIAL_BLOCK_TYPE = 'aside.social.block'

/**
 * Default entity TTL: 365 days in seconds.
 * Profiles and extensions expire after one year unless renewed.
 */
export const DEFAULT_EXPIRY_SECONDS = 365 * 24 * 60 * 60

// ─── Snowflake constants ───────────────────────────────────────────────────────

/** Custom epoch for Arbok snowflakes: 2025-01-01T00:00:00.000Z */
export const SNOWFLAKE_EPOCH = 1735689600000n

/** Bit widths inside the 128-bit Arbok snowflake (as bigint). */
export const SNOWFLAKE_TIMESTAMP_BITS = 48n
export const SNOWFLAKE_WORKER_BITS = 14n
export const SNOWFLAKE_SEQUENCE_BITS = 14n
export const SNOWFLAKE_PERMISSION_BITS = 52n

/** Max values derived from bit widths. */
export const MAX_WORKER_ID = (1n << SNOWFLAKE_WORKER_BITS) - 1n
export const MAX_SEQUENCE = (1n << SNOWFLAKE_SEQUENCE_BITS) - 1n
export const MAX_PERMISSIONS = (1n << SNOWFLAKE_PERMISSION_BITS) - 1n

// ─── Crypto constants ─────────────────────────────────────────────────────────

/** AES-256-GCM IV length in bytes. */
export const AES_IV_BYTES = 12

/** AES-256-GCM key length in bytes. */
export const AES_KEY_BYTES = 32

/** PBKDF2 hash output length in bytes. */
export const PBKDF2_KEY_BYTES = 32

/** PBKDF2 iteration count (OWASP minimum for SHA-256 is 600 000; 100 000 is a practical default). */
export const PBKDF2_ITERATIONS = 100_000

/** Default app ECDH key pair TTL: 30 days. */
export const DEFAULT_APP_KEY_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** Default access token TTL: 1 hour. */
export const DEFAULT_TOKEN_TTL_MS = 60 * 60 * 1000

/** Request signature max age in ms (5 minutes clock skew). */
export const MAX_REQUEST_AGE_MS = 5 * 60 * 1000
