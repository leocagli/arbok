# Arbok

## ES

**Arbok** es una librería TypeScript para construir identidad y funciones sociales sobre blockchain (Arkiv).

En la práctica, te da un **backend social descentralizado** listo para usar:

- Perfiles de usuario on-chain (`uuid`, `wallet`, `photo`, `displayName`, `bio`).
- Grafo social compartido entre apps (seguir, amistad, bloqueo).
- Feed de contenido (posts, reacciones, comentarios).
- Invitaciones por QR / deep links (`arbok://v1/...`).
- Tokens de acceso seguros con **ECDH + AES-GCM** para integrar apps de terceros.
- Sincronización entre cadenas y extensiones por app (namespaces).

Idea clave: **una sola identidad social reusable entre múltiples aplicaciones, sin servidor central obligatorio**.

## EN

**Arbok** is a TypeScript library for building identity and social features on top of Arkiv blockchain.

In practice, it gives you a **ready-to-use decentralized social backend**:

- On-chain user profiles (`uuid`, `wallet`, `photo`, `displayName`, `bio`).
- Shared social graph across apps (follow, friendship, block).
- Content feed (posts, reactions, comments).
- QR/deep-link invitations (`arbok://v1/...`).
- Secure access tokens using **ECDH + AES-GCM** for third-party app integrations.
- Multi-chain sync and per-app extension namespaces.

Core idea: **one reusable social identity across multiple apps, without requiring a central server**.

---

## Índice / Table of contents

- [Instalación / Installation](#install)
- [Inicio rápido / Quick start](#quick-start)
- [Arquitectura interna / Internal architecture](#architecture)
- [Perfiles / Profiles](#profiles)
- [Grafo social / Social graph](#social-graph)
- [Feed social / Social feed](#social-feed)
- [QR y deep links / QR and deep links](#qr-links)
- [Tokens seguros / Secure access tokens](#secure-tokens)
- [Extensiones por app / Per-app extensions](#extensions)
- [Sincronización multi-chain / Multi-chain sync](#multichain)
- [Compatibilidad de migración / Migration compatibility](#migration)
- [API pública / Public API](#public-api)
- [Demo](#demo)
- [Scripts](#scripts)
- [Licencia / License](#license)

---

<a id="install"></a>

## Instalación / Installation

```bash
npm install arbok
```

- ES: Requiere Node.js >= 16 o navegador moderno con `WebCrypto`.
- EN: Requires Node.js >= 16 or a modern browser with `WebCrypto`.

---

<a id="quick-start"></a>

## Inicio rápido / Quick start

```ts
import { Arbok, BaseClient } from 'arbok'

const arbok = new Arbok({
  chain: { id: 10, name: 'Kaolin' },
  transport: { url: 'https://rpc.kaolin.arkiv.network' },
})

const client = new BaseClient({
  uuid: 'user-123',
  wallet: '0xABCD...',
  photo: 'https://example.com/avatar.png',
  cdn: arbok,
})

const profile = await client.getOrCreate()
await client.update({ displayName: 'Alice' })

await client.social().follow('user-456')
await client.feed().createPost({ content: 'Hello Arkiv 👋' })
```

---

<a id="architecture"></a>

## Arquitectura interna / Internal architecture

- `BaseClient`: ES: conexión a Arkiv y ciclo de vida del perfil. EN: Arkiv connection and profile lifecycle.
- `SocialClient`: ES: follows, friend requests y bloqueos. EN: follows, friend requests, and blocking.
- `FeedClient`: ES: posts/reacciones/comentarios. EN: posts/reactions/comments.
- `AccessTokenManager`: ES: tokens sellados + sesión firmada. EN: sealed tokens + signed session requests.
- `ExtensionClient`: ES: datos por namespace de app. EN: per-app namespace data.
- `ProfileWatcher`: ES: monitoreo multi-chain. EN: multi-chain profile watcher.
- `SnowflakeGenerator`: ES/EN: permission bitmask IDs.

---

<a id="profiles"></a>

## Perfiles / Profiles

```ts
const existing = await client.get()        // null if not found
const ensured = await client.getOrCreate() // idempotent

await client.update({
  displayName: 'Alice',
  bio: 'Builder on Arkiv',
  photo: 'https://example.com/alice.png',
})
```

---

<a id="social-graph"></a>

## Grafo social / Social graph

```ts
const social = client.social()

await social.follow('bob-uuid')
await social.unfollow('bob-uuid')

const isFollowing = await social.isFollowing('bob-uuid')
const followers = await social.getFollowers({ limit: 20, offset: 0 })

const request = await social.sendFriendRequest('bob-uuid')
await social.cancelFriendRequest(request.entityKey)

await social.block('spam-uuid')
await social.unblock('spam-uuid')
```

---

<a id="social-feed"></a>

## Feed social / Social feed

```ts
const feed = client.feed()

const post = await feed.createPost({
  content: 'New post on Arbok',
  tags: ['arkiv', 'social'],
})

await feed.like(post.entityKey)
await feed.react(post.entityKey, 'love')
await feed.addComment(post.entityKey, 'Great one 🔥')

const timeline = await feed.getFeed(['alice-uuid', 'bob-uuid'], { limit: 20 })
```

---

<a id="qr-links"></a>

## QR y deep links / QR and deep links

```ts
import {
  encodeProfileLink,
  decodeProfileLink,
  encodeFriendRequest,
  parseArbokUri,
  parseAsideUri,
} from 'arbok'

const profileUri = encodeProfileLink({
  uuid: 'alice-uuid',
  wallet: '0xAlice...',
  displayName: 'Alice',
  photo: 'https://example.com/alice.png',
})

const decoded = decodeProfileLink(profileUri)
const parsed = parseArbokUri(profileUri)

// Legacy parser compatibility (aside://)
const legacyParsed = parseAsideUri('aside://v1/profile?...')

const friendUri = encodeFriendRequest(
  { fromUuid: 'alice-uuid', fromWallet: '0xAlice...' },
  { ttlMs: 10 * 60 * 1000 },
)
```

---

<a id="secure-tokens"></a>

## Tokens seguros / Secure access tokens (ECDH + AES-GCM)

```ts
import { generateAppKeyPair } from 'arbok'

const appKey = await generateAppKeyPair()

const { token, sessionKey } = await client.createAccessToken({
  phrase: 'user-secret',
  appId: 'my-app',
  appPublicKey: appKey.publicKey,
  ttlMs: 60 * 60 * 1000,
})
```

```ts
import { AccessTokenManager } from 'arbok'

const manager = new AccessTokenManager()
const result = await manager.validate({ token, appPrivateKey: appKey.privateKey })

if (result.valid) {
  console.log(result.claims.sub)
  console.log(result.sessionKey)
}
```

---

<a id="extensions"></a>

## Extensiones por app / Per-app extensions

```ts
interface GameProfile {
  score: number
  level: number
}

const ext = client.extend<GameProfile>('my-game')
const data = await ext.getOrCreate()
await ext.update({ score: 1200, level: 8 })
```

- ES: cada namespace queda aislado.
- EN: each namespace is isolated.

---

<a id="multichain"></a>

## Sincronización multi-chain / Multi-chain sync

```ts
const chainA = new Arbok({ chain: { id: 10, name: 'Kaolin' }, transport: { url: 'https://rpc-a' } })
const chainB = new Arbok({ chain: { id: 11, name: 'Mendoza' }, transport: { url: 'https://rpc-b' } })

await client.sync([chainA, chainB])
```

---

<a id="migration"></a>

## Compatibilidad de migración / Migration compatibility (Arbok + Aside)

- ES: lectura de atributos `arbok.*` y `aside.*`, con escritura dual durante transición.
- EN: reads both `arbok.*` and `aside.*`, with dual writes during migration.
- ES/EN: use `parseArbokUri` as primary and `parseAsideUri` as legacy alias.

---

<a id="public-api"></a>

## API pública / Public API (summary)

### Clases / Classes

- `Arbok`, `BaseClient`, `ExtensionClient`, `SocialClient`, `FeedClient`
- `AccessTokenManager`, `ProfileWatcher`, `SnowflakeGenerator`

### Utilidades cripto / Crypto utilities

- `generateAppKeyPair`, `generateAesKey`, `ecdhDeriveKeys`
- `aesEncrypt`, `aesDecrypt`, `hmacSign`, `hmacVerify`
- `phraseToCommitment`, `verifyPhraseCommitment`

### Utilidades QR / QR utilities

- `encodeProfileLink`, `decodeProfileLink`
- `encodeFriendRequest`, `decodeFriendRequest`
- `isFriendRequestQRValid`, `friendRequestQRExpiresIn`
- `parseArbokUri`, `parseAsideUri` (legacy)

---

<a id="demo"></a>

## Demo

- ES: demo básica disponible en `demo/`.
- EN: a basic demo is available in `demo/`.

```bash
cd demo
python -m http.server 8000
```

Open/abre: `http://localhost:8000`

---

<a id="scripts"></a>

## Scripts

```bash
npm run build
npm run test
npm run typecheck
```

---

<a id="license"></a>

## Licencia / License

ISC
