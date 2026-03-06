let sdk = null;
let client = null;
let walletAddress = null;
const activeBlobUrls = [];

const DEFAULT_PHOTO = "https://via.placeholder.com/150";
const FEED_DISCONNECTED_MESSAGE = "Conecta tu wallet para ver publicaciones de las cuentas que sigues.";
const ARKIV_NETWORK_NAME = "Arkiv Mendoza";
const ARKIV_RPC_URL = "https://mendoza.hoodi.arkiv.network/rpc";
const ARKIV_CHAIN_ID = 60138453056;
const ARKIV_EXPLORER_URL = "https://explorer.mendoza.hoodi.arkiv.network/";
const ARKIV_SDK_VERSION = "0.6.2";
const PROFILE_EXPIRY_SECONDS = 24 * 60 * 60;
const POST_EXPIRY_SECONDS = 60 * 60;
const PROFILE_CREATE_GAS_LIMIT = 320000n;
const ONE_GWEI = 1_000_000_000n;

const connectWalletBtn = document.getElementById("connect-wallet");
const disconnectWalletBtn = document.getElementById("disconnect-wallet");
const walletInfo = document.getElementById("wallet-info");
const walletAddressEl = document.getElementById("wallet-address");
const walletStatusEl = document.getElementById("wallet-status");
const followersList = document.getElementById("followers-list");
const followingListEl = document.getElementById("following-list");

const profilePhotoFileEl = document.getElementById("profile-photo-file");
const profileUploadStatusEl = document.getElementById("profile-upload-status");
const profilePhotoRefEl = document.getElementById("profile-photo-ref");
const postFileEl = document.getElementById("post-file");
const postUploadStatusEl = document.getElementById("post-upload-status");

async function loadSdk() {
  if (!sdk) {
    const sdkCandidates = [
      "/dist/index.mjs",
      "../dist/index.mjs",
      "./dist/index.mjs",
    ];

    let arbok = null;
    let lastError = null;
    for (const candidate of sdkCandidates) {
      try {
        arbok = await import(candidate);
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!arbok) {
      const reason = lastError?.message || "No se pudo cargar el SDK";
      throw new Error(
        `No se pudo cargar dist/index.mjs. ` +
        `Asegurate de ejecutar 'npm run build' en la raiz y servir el proyecto desde la raiz o usando demo/server.js. ` +
        `Detalle: ${reason}`
      );
    }

    sdk = {
      createArbok: arbok.createArbok,
      BaseClient: arbok.BaseClient,
    };

    const arkiv = await import(`https://esm.sh/@arkiv-network/sdk@${ARKIV_SDK_VERSION}`);
    const chains = await import(`https://esm.sh/@arkiv-network/sdk@${ARKIV_SDK_VERSION}/chains`);
    sdk.createPublicClient = arkiv.createPublicClient;
    sdk.createWalletClient = arkiv.createWalletClient;
    sdk.custom = arkiv.custom;
    sdk.http = arkiv.http;
    sdk.kaolin = chains.kaolin;
    sdk.mendoza = chains.mendoza;
    sdk.activeChain = chains.mendoza || chains.kaolin;
  }
  return sdk;
}

function providerOrNull() {
  return window.ethereum || window.web3?.currentProvider || null;
}

function setWalletStatus(message, tone = "info") {
  if (!walletStatusEl) return;
  if (!message) {
    walletStatusEl.textContent = "";
    walletStatusEl.classList.add("hidden");
    walletStatusEl.dataset.tone = "";
    return;
  }

  walletStatusEl.textContent = message;
  walletStatusEl.dataset.tone = tone;
  walletStatusEl.classList.remove("hidden");
}

async function ensureArkivNetwork(provider) {
  const chainIdHex = `0x${ARKIV_CHAIN_ID.toString(16)}`;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
    return;
  } catch (error) {
    const code = error?.code;
    if (code !== 4902) throw error;
  }

  await provider.request({
    method: "wallet_addEthereumChain",
    params: [{
      chainId: chainIdHex,
      chainName: ARKIV_NETWORK_NAME,
      rpcUrls: [ARKIV_RPC_URL],
      nativeCurrency: {
        name: "Test ETH",
        symbol: "ETH",
        decimals: 18,
      },
      blockExplorerUrls: [ARKIV_EXPLORER_URL],
    }],
  });

  await provider.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: chainIdHex }],
  });
}

function deriveUuid(address) {
  const raw = address.toLowerCase().replace(/^0x/, "");
  return `u-${raw.slice(0, 12)}-${raw.slice(-8)}`;
}

function deriveLegacyUuid(address) {
  return `user-${address.toLowerCase().replace(/^0x/, "")}`;
}

function showSections(visible) {
  const ids = ["profile-section", "post-section", "feed-section", "social-section"];
  for (const id of ids) {
    document.getElementById(id).classList.toggle("hidden", !visible);
  }
}

function setWalletUi(connected) {
  const connectBtn = document.getElementById("wallet-section").querySelector("button");
  connectBtn.classList.toggle("hidden", connected);
  walletInfo.classList.toggle("hidden", !connected);
  showSections(connected);
}

function safeMsg(error) {
  return error?.message || String(error);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(task, options = {}) {
  const {
    attempts = 3,
    delayMs = 900,
    onRetry = null,
  } = options;

  let lastError = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (i < attempts) {
        if (typeof onRetry === "function") onRetry(i, error);
        await sleep(delayMs * i);
      }
    }
  }
  throw lastError;
}

function userErrorMsg(error, fallback = "Ocurrio un error inesperado.") {
  const raw = safeMsg(error);

  if (/User rejected|rejected the request|denied/i.test(raw)) {
    return "Operacion cancelada en la wallet.";
  }
  if (/insufficient funds|intrinsic gas too low|gas required exceeds allowance|insufficient balance/i.test(raw)) {
    return `La wallet no tiene fondos para gas en ${ARKIV_NETWORK_NAME}. Carga test ETH y reintenta.`;
  }
  if (/Failed to fetch|NetworkError|fetch/i.test(raw)) {
    return "No se pudo conectar a la red. Revisa RPC/internet y vuelve a intentar.";
  }
  if (/Request body:|URL:|arkiv_query|rpc/i.test(raw)) {
    return "Fallo la consulta al RPC de Arkiv. Intenta nuevamente en unos segundos.";
  }
  if (/transaction failed|execution reverted|reverted|call exception/i.test(raw)) {
    return "La transaccion fue revertida por Arkiv. Reintenta y revisa el detalle tecnico del revert.";
  }

  if (!raw) return fallback;
  return raw.length > 220 ? `${raw.slice(0, 220)}...` : raw;
}

function isRpcLikeError(error) {
  const raw = safeMsg(error);
  return /Request body:|URL:|arkiv_query|rpc|Failed to fetch|NetworkError|fetch/i.test(raw);
}

function isInsufficientFundsError(error) {
  const raw = safeMsg(error);
  return /insufficient funds|intrinsic gas too low|gas required exceeds allowance|insufficient balance/i.test(raw);
}

function isTransactionFailedError(error) {
  const raw = safeMsg(error);
  return /transaction failed|execution reverted|reverted|call exception/i.test(raw);
}

function extractErrorDetails(error) {
  const visited = new Set();
  const queue = [error];
  const parts = [];

  while (queue.length > 0 && parts.length < 8) {
    const current = queue.shift();
    if (!current || typeof current !== "object") continue;
    if (visited.has(current)) continue;
    visited.add(current);

    const details = typeof current.details === "string" ? current.details : "";
    const shortMessage = typeof current.shortMessage === "string" ? current.shortMessage : "";
    const message = typeof current.message === "string" ? current.message : "";

    for (const text of [details, shortMessage, message]) {
      if (!text) continue;
      const normalized = text.trim();
      if (!normalized) continue;
      if (!parts.includes(normalized)) parts.push(normalized);
    }

    const data = current.data;
    if (typeof data === "string" && data.trim()) {
      const normalizedData = `data=${data.trim()}`;
      if (!parts.includes(normalizedData)) parts.push(normalizedData);
    }

    if (current.cause && typeof current.cause === "object") queue.push(current.cause);
    if (current.error && typeof current.error === "object") queue.push(current.error);
  }

  if (parts.length === 0) return "sin detalle tecnico del backend";
  return parts.join(" | ").slice(0, 1200);
}

function formatWeiToEth(wei) {
  const value = typeof wei === "bigint" ? wei : BigInt(wei || 0);
  const base = 10n ** 18n;
  const whole = value / base;
  const fraction = (value % base).toString().padStart(18, "0").slice(0, 6);
  return `${whole}.${fraction}`;
}

function formatWeiToGwei(wei) {
  const value = typeof wei === "bigint" ? wei : BigInt(wei || 0);
  const base = 10n ** 9n;
  const whole = value / base;
  const fraction = (value % base).toString().padStart(9, "0").slice(0, 3);
  return `${whole}.${fraction}`;
}

function parseHexToBigInt(hexValue) {
  if (typeof hexValue !== "string" || !hexValue.startsWith("0x")) return null;
  try {
    return BigInt(hexValue);
  } catch {
    return null;
  }
}

function createGasProbe(provider) {
  const originalRequest = provider.request.bind(provider);
  const info = {
    estimatedGas: null,
    sendGas: null,
    maxFeePerGas: null,
    maxPriorityFeePerGas: null,
    gasPrice: null,
  };

  provider.request = async (args) => {
    const method = args?.method;
    const params = args?.params;

    if (method === "eth_sendTransaction" && Array.isArray(params) && params[0]) {
      const tx = params[0];
      info.sendGas = parseHexToBigInt(tx.gas ?? null);
      info.maxFeePerGas = parseHexToBigInt(tx.maxFeePerGas ?? null);
      info.maxPriorityFeePerGas = parseHexToBigInt(tx.maxPriorityFeePerGas ?? null);
      info.gasPrice = parseHexToBigInt(tx.gasPrice ?? null);
    }

    const result = await originalRequest(args);

    if (method === "eth_estimateGas") {
      info.estimatedGas = parseHexToBigInt(result);
    }

    return result;
  };

  return {
    stop() {
      provider.request = originalRequest;
    },
    snapshot() {
      return {
        estimatedGas: info.estimatedGas,
        sendGas: info.sendGas,
        maxFeePerGas: info.maxFeePerGas,
        maxPriorityFeePerGas: info.maxPriorityFeePerGas,
        gasPrice: info.gasPrice,
      };
    },
  };
}

function formatGasDiagnostics(snapshot) {
  const pieces = [];
  if (snapshot.estimatedGas != null) pieces.push(`estimate=${snapshot.estimatedGas.toString()} gas`);
  if (snapshot.sendGas != null) pieces.push(`send=${snapshot.sendGas.toString()} gas`);
  if (snapshot.maxFeePerGas != null) pieces.push(`maxFee=${formatWeiToGwei(snapshot.maxFeePerGas)} gwei`);
  if (snapshot.maxPriorityFeePerGas != null) pieces.push(`tip=${formatWeiToGwei(snapshot.maxPriorityFeePerGas)} gwei`);
  if (snapshot.gasPrice != null) pieces.push(`gasPrice=${formatWeiToGwei(snapshot.gasPrice)} gwei`);
  if (pieces.length === 0) return "sin datos de gas (wallet no expuso estimate/send)";
  return pieces.join(" | ");
}

function buildRescueUuid(wallet) {
  const raw = String(wallet || "").toLowerCase().replace(/^0x/, "");
  const left = raw.slice(0, 8) || "user";
  const suffix = Date.now().toString(36);
  return `u-${left}-${suffix}`;
}

async function createProfileCompat(baseClient, data = {}) {
  const now = Date.now();
  const normalizedWallet = (baseClient.wallet || "").toLowerCase();
  const profile = {
    uuid: data.uuid || baseClient.uuid,
    wallet: data.wallet || normalizedWallet,
    photo: data.photo || DEFAULT_PHOTO,
    ...(data.displayName != null ? { displayName: data.displayName } : {}),
    ...(data.bio != null ? { bio: data.bio } : {}),
    createdAt: now,
    updatedAt: now,
  };

  const payload = new TextEncoder().encode(JSON.stringify(profile));
  const expiryAttempts = [
    PROFILE_EXPIRY_SECONDS,
    6 * 60 * 60,
    60 * 60,
  ];

  let lastError = null;
  for (const expiresIn of expiryAttempts) {
    try {
      const { entityKey } = await baseClient.cdn.entity.create({
        payload,
        contentType: "application/json",
        attributes: [
          { key: "arbok_type", value: "profile" },
          { key: "arbok_uuid", value: baseClient.uuid },
          { key: "arbok_wallet", value: normalizedWallet },
        ],
        expiresIn,
      });

      return { entityKey, profile, expiresIn };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("Compat profile creation failed");
}

function isLikelyProfileEntity(entity, connectedWallet) {
  if (!entity) return false;

  let json = null;
  try {
    json = entity.toJson();
  } catch {
    json = null;
  }

  const walletFromJson = (json && typeof json === "object" ? String(json.wallet || "") : "").toLowerCase();
  const hasUuid = Boolean(json && typeof json === "object" && typeof json.uuid === "string" && json.uuid.length > 0);

  const attributes = Array.isArray(entity.attributes) ? entity.attributes : [];
  const attrWallet = attributes.find((attr) => attr?.key === "arbok_wallet")?.value;
  const attrType = attributes.find((attr) => attr?.key === "arbok_type")?.value;

  const walletMatch = walletFromJson === connectedWallet || String(attrWallet || "").toLowerCase() === connectedWallet;
  const typeMatch = String(attrType || "") === "profile";

  return walletMatch && (hasUuid || typeMatch);
}

async function findOwnedProfileCompat(baseClient, rawConnectedWallet) {
  const normalizedWallet = String(rawConnectedWallet || "").toLowerCase();
  if (!normalizedWallet) return null;

  const ownerCandidates = Array.from(new Set([String(rawConnectedWallet || ""), normalizedWallet].filter(Boolean)));

  for (const ownerCandidate of ownerCandidates) {
    try {
      const ownedResult = await baseClient.cdn.entity
        .query()
        .ownedBy(ownerCandidate)
        .withPayload(true)
        .withAttributes(true)
        .fetch();

      const ownedEntity = (ownedResult.entities || []).find((entity) => isLikelyProfileEntity(entity, normalizedWallet));
      if (ownedEntity) {
        return {
          entityKey: ownedEntity.key,
          profile: ownedEntity.toJson(),
        };
      }
    } catch {
    }
  }

  return null;
}

async function updateProfileCompat(baseClient, data = {}) {
  const rawConnectedWallet = String(data.connectedWallet || "");
  const connectedWallet = rawConnectedWallet.toLowerCase();

  let existing = await findOwnedProfileCompat(baseClient, rawConnectedWallet);

  if (!existing) {
    existing = await baseClient.get();
  }

  if (!existing) {
    return createProfileCompat(baseClient, data);
  }

  const now = Date.now();
  const current = existing.profile || {};
  const uuid = current.uuid || baseClient.uuid;
  const wallet = (connectedWallet || current.wallet || baseClient.wallet || "").toLowerCase();
  const updated = {
    ...current,
    ...data,
    uuid,
    wallet,
    createdAt: current.createdAt ?? now,
    updatedAt: now,
  };

  const payload = new TextEncoder().encode(JSON.stringify(updated));
  try {
    const entity = await baseClient.cdn.entity.get(existing.entityKey);
    const owner = (entity?.owner || "").toLowerCase();
    if (connectedWallet && owner && owner !== connectedWallet) {
      return createProfileCompat(baseClient, {
        ...data,
        wallet: connectedWallet,
        uuid: buildRescueUuid(connectedWallet),
      });
    }
  } catch {
  }

  await baseClient.cdn.entity.update({
    entityKey: existing.entityKey,
    payload,
    contentType: "application/json",
    attributes: [
      { key: "arbok_type", value: "profile" },
      { key: "arbok_uuid", value: uuid },
      { key: "arbok_wallet", value: wallet },
    ],
    expiresIn: PROFILE_EXPIRY_SECONDS,
  });

  return { entityKey: existing.entityKey, profile: updated };
}

async function createPostCompat(baseClient, options = {}) {
  const now = Date.now();
  const wallet = String(baseClient.wallet || "").toLowerCase();
  const post = {
    authorUuid: String(baseClient.uuid || ""),
    authorWallet: wallet,
    content: String(options.content || ""),
    createdAt: now,
    updatedAt: now,
    status: "active",
    ...(Array.isArray(options.media) ? { media: options.media } : {}),
  };

  const payload = new TextEncoder().encode(JSON.stringify(post));
  const { entityKey } = await baseClient.cdn.entity.create({
    payload,
    contentType: "application/json",
    attributes: [
      { key: "arbok_type", value: "arbok.social.post" },
      { key: "arbok_uuid", value: String(baseClient.uuid || "") },
      { key: "arbok_wallet", value: wallet },
    ],
    expiresIn: POST_EXPIRY_SECONDS,
  });

  return { entityKey, ...post };
}

function resolvePhotoSrc(photo) {
  if (typeof photo === "string" && /^https?:\/\//i.test(photo)) return photo;
  return DEFAULT_PHOTO;
}

function setUploadStatus(el, text) {
  if (!text) {
    el.textContent = "";
    el.classList.add("hidden");
    return;
  }
  el.textContent = text;
  el.classList.remove("hidden");
}

function mediaTypeFromMime(file) {
  if (!file?.type) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "image";
}

function revokeBlobUrls() {
  while (activeBlobUrls.length > 0) {
    const url = activeBlobUrls.pop();
    URL.revokeObjectURL(url);
  }
}

function createMediaNode(mediaItem = {}, index = 0) {
  const wrapper = document.createElement("div");
  wrapper.className = "post-media";

  const label = document.createElement("small");
  const mediaType = mediaItem.type || "file";
  label.append(`Media (${mediaType}): `);
  const code = document.createElement("code");
  code.textContent = String(mediaItem.url || "");
  label.appendChild(code);

  const previewBtn = document.createElement("button");
  previewBtn.className = "btn btn-secondary preview-media-btn";
  previewBtn.type = "button";
  previewBtn.textContent = "Ver archivo";
  previewBtn.dataset.key = String(mediaItem.url || "");
  previewBtn.dataset.type = mediaType;
  previewBtn.dataset.idx = String(index);

  const target = document.createElement("div");
  target.className = "media-preview-target";

  previewBtn.addEventListener("click", () => loadMediaPreview(previewBtn, target));

  wrapper.appendChild(label);
  wrapper.appendChild(previewBtn);
  wrapper.appendChild(target);

  return wrapper;
}

async function loadMediaPreview(button, target) {
  if (!client) return;
  const manifestKey = button.dataset.key;
  const mediaType = button.dataset.type || "image";
  if (!target || !manifestKey) return;

  try {
    button.disabled = true;
    button.textContent = "Cargando...";
    const { data, filename, mimeType } = await client.cdn.file.download(manifestKey);
    const blob = new Blob([data], { type: mimeType || "application/octet-stream" });
    const blobUrl = URL.createObjectURL(blob);
    activeBlobUrls.push(blobUrl);

    target.textContent = "";

    if ((mimeType || "").startsWith("image/") || mediaType === "image") {
      const img = document.createElement("img");
      img.className = "media-preview";
      img.src = blobUrl;
      img.alt = filename || manifestKey;
      target.appendChild(img);
    } else if ((mimeType || "").startsWith("video/") || mediaType === "video") {
      const video = document.createElement("video");
      video.className = "media-preview";
      video.controls = true;
      video.src = blobUrl;
      target.appendChild(video);
    } else if ((mimeType || "").startsWith("audio/") || mediaType === "audio") {
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.src = blobUrl;
      target.appendChild(audio);
    } else {
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename || manifestKey;
      link.textContent = "Descargar archivo";
      target.appendChild(link);
    }

    button.textContent = "Recargar preview";
    button.disabled = false;
  } catch (error) {
    console.error(error);
    target.textContent = "No se pudo cargar el archivo desde Arkiv.";
    button.textContent = "Reintentar";
    button.disabled = false;
  }
}

async function uploadFileToArkiv(file, statusEl) {
  if (!client) throw new Error("Cliente no inicializado");
  const bytes = new Uint8Array(await file.arrayBuffer());
  setUploadStatus(statusEl, "Subiendo 0%...");

  const result = await client.cdn.file.upload(bytes, {
    filename: file.name,
    mimeType: file.type || "application/octet-stream",
    onProgress: (progress) => {
      const pct = Math.round((progress?.ratio || 0) * 100);
      setUploadStatus(statusEl, `Subiendo ${pct}%...`);
    },
  });

  setUploadStatus(statusEl, `Subido: ${result.manifestKey}`);
  return result.manifestKey;
}

function showProfile(profile) {
  const displayName = profile.displayName || profile.uuid;
  const bio = profile.bio || "";
  const photo = profile.photo || DEFAULT_PHOTO;

  document.getElementById("display-name").value = displayName;
  document.getElementById("bio").value = bio;
  document.getElementById("photo-url").value = /^https?:\/\//i.test(photo) ? photo : "";

  document.getElementById("profile-photo").src = resolvePhotoSrc(photo);
  document.getElementById("profile-name").textContent = displayName;
  document.getElementById("profile-bio").textContent = bio;

  if (photo && !/^https?:\/\//i.test(photo)) {
    profilePhotoRefEl.textContent = `Foto en Arkiv: ${photo}`;
    profilePhotoRefEl.classList.remove("hidden");
  } else {
    profilePhotoRefEl.textContent = "";
    profilePhotoRefEl.classList.add("hidden");
  }

  document.getElementById("profile-display").classList.remove("hidden");
}

function renderPosts(posts) {
  const postsList = document.getElementById("posts-list");
  revokeBlobUrls();
  postsList.textContent = "";

  if (!Array.isArray(posts) || posts.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "Todavia no hay posts.";
    postsList.appendChild(empty);
    return;
  }

  for (const post of posts) {
    const item = document.createElement("div");
    item.className = "post-item";

    const author = document.createElement("div");
    author.className = "post-author";
    author.textContent = post.authorUuid || "usuario";
    item.appendChild(author);

    const content = document.createElement("p");
    content.textContent = post.content || "(sin texto)";
    item.appendChild(content);

    if (Array.isArray(post.media)) {
      post.media.forEach((mediaItem, index) => {
        item.appendChild(createMediaNode(mediaItem, index));
      });
    }

    const date = document.createElement("small");
    date.textContent = new Date(post.createdAt).toLocaleString();
    item.appendChild(date);

    postsList.appendChild(item);
  }
}

async function refreshFeed() {
  if (!client) return;
  const following = await client.social().getFollowing({ limit: 100 });
  const uuids = new Set([client.uuid]);
  for (const relation of following) {
    if (relation?.toUuid) uuids.add(relation.toUuid);
    if (relation?.targetUuid) uuids.add(relation.targetUuid);
  }

  const posts = await client.feed().getFeed(Array.from(uuids), { limit: 60, offset: 0 });
  renderPosts(posts);
}

function renderFollowingList(items = []) {
  if (!followingListEl) return;
  followingListEl.textContent = "";

  if (!Array.isArray(items) || items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "following-item";
    empty.textContent = "Aún no sigues a nadie.";
    followingListEl.appendChild(empty);
    return;
  }

  const unique = new Set();
  for (const relation of items) {
    const value = relation?.toUuid || relation?.targetUuid;
    if (!value || unique.has(value)) continue;
    unique.add(value);

    const row = document.createElement("div");
    row.className = "following-item";
    row.textContent = value;
    followingListEl.appendChild(row);
  }
}

function renderDisconnectedSnapshot() {
  const postsList = document.getElementById("posts-list");
  if (postsList) postsList.textContent = FEED_DISCONNECTED_MESSAGE;

  if (followersList) {
    followersList.textContent = "";

    const followingCount = document.createElement("p");
    const followingStrong = document.createElement("strong");
    followingStrong.textContent = "Siguiendo:";
    followingCount.appendChild(followingStrong);
    followingCount.append(" 0");

    const followersCount = document.createElement("p");
    const followersStrong = document.createElement("strong");
    followersStrong.textContent = "Seguidores:";
    followersCount.appendChild(followersStrong);
    followersCount.append(" 0");

    followersList.appendChild(followingCount);
    followersList.appendChild(followersCount);
  }

  renderFollowingList([]);
}

async function refreshSocialSnapshot() {
  if (!client) return;
  const [counts, following] = await Promise.all([
    client.social().getFollowerCounts(),
    client.social().getFollowing({ limit: 100 }),
  ]);

  followersList.textContent = "";

  const followingCount = document.createElement("p");
  const followingStrong = document.createElement("strong");
  followingStrong.textContent = "Siguiendo:";
  followingCount.appendChild(followingStrong);
  followingCount.append(` ${counts.following}`);

  const followersCount = document.createElement("p");
  const followersStrong = document.createElement("strong");
  followersStrong.textContent = "Seguidores:";
  followersCount.appendChild(followersStrong);
  followersCount.append(` ${counts.followers}`);

  followersList.appendChild(followingCount);
  followersList.appendChild(followersCount);
  renderFollowingList(following);
}

async function refreshFollowerCounts() {
  await refreshSocialSnapshot();
}

connectWalletBtn.addEventListener("click", async () => {
  try {
    connectWalletBtn.disabled = true;
    setWalletStatus("Conectando wallet...", "info");

    const provider = providerOrNull();
    if (!provider) {
      alert("MetaMask no detectado.");
      setWalletStatus("MetaMask no detectado.", "error");
      connectWalletBtn.disabled = false;
      return;
    }

    setWalletStatus(`Verificando red ${ARKIV_NETWORK_NAME}...`, "info");
    await ensureArkivNetwork(provider);

    const accounts = await provider.request({ method: "eth_requestAccounts" });
    walletAddress = accounts[0];
    const normalizedWallet = walletAddress.toLowerCase();
    walletAddressEl.textContent = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;

    const {
      createArbok,
      BaseClient,
      createPublicClient,
      createWalletClient,
      custom,
      http,
      activeChain,
    } = await loadSdk();

    const networkRpcClient = createPublicClient({
      transport: http(ARKIV_RPC_URL),
      chain: activeChain,
    });

    const walletClient = createWalletClient({
      transport: custom(provider),
      account: walletAddress,
      chain: activeChain,
    });

    let txMaxFeePerGas = 2n * ONE_GWEI;
    let txMaxPriorityFeePerGas = ONE_GWEI;
    try {
      const feeEstimate = await networkRpcClient.estimateFeesPerGas();
      if (typeof feeEstimate?.maxPriorityFeePerGas === "bigint") {
        txMaxPriorityFeePerGas = feeEstimate.maxPriorityFeePerGas;
      }
      if (typeof feeEstimate?.maxFeePerGas === "bigint") {
        txMaxFeePerGas = feeEstimate.maxFeePerGas;
      }
    } catch {
    }

    const profileTxParams = {
      gas: PROFILE_CREATE_GAS_LIMIT,
      maxFeePerGas: txMaxFeePerGas,
      maxPriorityFeePerGas: txMaxPriorityFeePerGas,
    };

    if (typeof walletClient.createEntity === "function") {
      const originalCreateEntity = walletClient.createEntity.bind(walletClient);
      walletClient.createEntity = (data, txParams) => originalCreateEntity(data, txParams ?? profileTxParams);
    }
    const primaryUuid = deriveUuid(walletAddress);
    const legacyUuid = deriveLegacyUuid(walletAddress);

    const makeClient = (publicTransport, uuid = primaryUuid, wallet = normalizedWallet) => new BaseClient({
      uuid,
      wallet,
      photo: DEFAULT_PHOTO,
      cdn: createArbok({
        publicClient: createPublicClient({ transport: publicTransport, chain: activeChain }),
        wallets: walletClient,
      }),
    });

    let activeTransport = http(ARKIV_RPC_URL);
    client = makeClient(activeTransport, primaryUuid, normalizedWallet);
    setWalletStatus("Cargando perfil on-chain...", "info");

    let profileResult = null;
    let profileChecked = false;
    try {
      profileResult = await withRetry(
        () => client.get(),
        {
          attempts: 4,
          delayMs: 1000,
          onRetry: (attempt) => {
            setWalletStatus(`RPC inestable, reintentando lectura (${attempt + 1}/4)...`, "warn");
          },
        },
      );
      profileChecked = true;
    } catch (firstError) {
      if (!isRpcLikeError(firstError)) throw firstError;
      setWalletStatus("RPC HTTP fallo, probando lectura via MetaMask...", "warn");
      activeTransport = custom(provider);
      client = makeClient(activeTransport, primaryUuid, normalizedWallet);
      profileResult = await withRetry(
        () => client.get(),
        {
          attempts: 3,
          delayMs: 1000,
          onRetry: (attempt) => {
            setWalletStatus(`Reintentando lectura por MetaMask (${attempt + 1}/3)...`, "warn");
          },
        },
      );
      profileChecked = true;
    }

    if (profileChecked && !profileResult) {
      const uuidCandidates = [primaryUuid, legacyUuid];
      const walletCandidates = Array.from(new Set([normalizedWallet, walletAddress]));

      for (const candidateUuid of uuidCandidates) {
        for (const candidateWallet of walletCandidates) {
          if (profileResult) break;
          try {
            const candidateClient = makeClient(activeTransport, candidateUuid, candidateWallet);
            const candidateProfile = await withRetry(
              () => candidateClient.get(),
              {
                attempts: 2,
                delayMs: 500,
              },
            );
            if (candidateProfile) {
              client = candidateClient;
              profileResult = candidateProfile;
              setWalletStatus("Perfil existente encontrado. Conectando...", "info");
              break;
            }
          } catch {
          }
        }
      }
    }

    if (profileChecked && !profileResult && legacyUuid !== primaryUuid) {
      try {
        const legacyClient = makeClient(activeTransport, legacyUuid, normalizedWallet);
        const legacyProfile = await withRetry(
          () => legacyClient.get(),
          {
            attempts: 2,
            delayMs: 700,
          },
        );
        if (legacyProfile) {
          client = legacyClient;
          profileResult = legacyProfile;
          setWalletStatus("Perfil legado encontrado. Conectando...", "info");
        }
      } catch {
      }
    }

    if (profileChecked && !profileResult) {
      const maxCostWei = PROFILE_CREATE_GAS_LIMIT * txMaxFeePerGas;
      setWalletStatus(
        `Creando perfil (gas=${PROFILE_CREATE_GAS_LIMIT.toString()}, max~${formatWeiToEth(maxCostWei)} ETH)...`,
        "info",
      );
      const gasProbe = createGasProbe(provider);
      try {
        profileResult = await withRetry(
          () => client.getOrCreate(),
          {
            attempts: 2,
            delayMs: 900,
            onRetry: (attempt) => {
              setWalletStatus(`Reintentando creacion (${attempt + 1}/2)...`, "warn");
            },
          },
        );
        const gasInfo = formatGasDiagnostics(gasProbe.snapshot());
        console.info("[Arbok][Gas] create profile:", gasInfo);
      } catch (createError) {
        const gasInfo = formatGasDiagnostics(gasProbe.snapshot());
        console.warn("[Arbok][Gas] create profile failed:", gasInfo);
        const createErrorDetails = extractErrorDetails(createError);
        console.warn("[Arbok][CreateError]", createErrorDetails);
        let compatFailure = null;

        try {
          const compatResult = await createProfileCompat(client);
          profileResult = compatResult;
          setWalletStatus(`Perfil creado en modo compatibilidad (ttl=${compatResult.expiresIn}s).`, "success");
          console.info("[Arbok] profile created with compat mode", compatResult.expiresIn);
        } catch (compatError) {
          compatFailure = compatError;
          console.warn("[Arbok] compat profile creation failed:", safeMsg(compatError));
          console.warn("[Arbok][CompatError]", extractErrorDetails(compatError));
        }

        if (profileResult) {
          const gasInfoAfterCompat = formatGasDiagnostics(gasProbe.snapshot());
          console.info("[Arbok][Gas] compat create profile:", gasInfoAfterCompat);
        }

        if (!profileResult && isInsufficientFundsError(createError)) {
          setWalletUi(true);
          setWalletStatus("Wallet conectada, pero falta gas para crear perfil.", "warn");
          alert(
            "Wallet conectada, pero no se pudo crear el perfil on-chain. "
            + `Carga test ETH en ${ARKIV_NETWORK_NAME} `
            + "y vuelve a presionar 'Conectar MetaMask'.\n\n"
            + `Gas: ${gasInfo}`
          );
          return;
        }

        if (!profileResult && isTransactionFailedError(createError)) {
          let balanceWei = null;
          try {
            balanceWei = await networkRpcClient.getBalance({ address: walletAddress });
          } catch {
            balanceWei = null;
          }

          const revertDetails = extractErrorDetails(compatFailure ?? createError);

          setWalletUi(true);
          if (balanceWei === 0n) {
            setWalletStatus(`Wallet conectada, pero sin ETH en ${ARKIV_NETWORK_NAME}.`, "warn");
            alert(
              `Tu wallet parece tener 0 ETH en ${ARKIV_NETWORK_NAME}. `
              + `Saldo ${ARKIV_NETWORK_NAME}: 0 ETH. Carga fondos de testnet `
              + "y vuelve a intentar."
            );
            return;
          }

          const networkBalanceText = balanceWei == null ? "desconocido" : `${formatWeiToEth(balanceWei)} ETH`;
          setWalletStatus("Wallet conectada, pero la transaccion fue revertida.", "warn");
          alert(
            `La transaccion de creacion de perfil fallo aunque hay saldo en ${ARKIV_NETWORK_NAME}. `
            + `Saldo detectado: ${networkBalanceText}. `
            + `Revisa MetaMask (misma cuenta y red ${ARKIV_NETWORK_NAME}) y reintenta.\n\n`
            + `Gas: ${gasInfo}\n`
            + `Revert: ${revertDetails}`
          );
          return;
        }

        throw createError;
      } finally {
        gasProbe.stop();
      }
    }

    if (!profileResult) {
      throw new Error("No se pudo obtener ni crear el perfil en Arkiv.");
    }

    if (profileResult?.profile?.uuid && profileResult.profile.uuid !== client.uuid) {
      const adoptedUuid = profileResult.profile.uuid;
      const adoptedWallet = (profileResult.profile.wallet || normalizedWallet).toLowerCase();
      setWalletStatus(`Perfil existente detectado. UUID adoptado: ${adoptedUuid}`, "info");

      client = makeClient(activeTransport, adoptedUuid, adoptedWallet);
      const adoptedProfileResult = await withRetry(
        () => client.get(),
        {
          attempts: 2,
          delayMs: 500,
        },
      );
      if (adoptedProfileResult) profileResult = adoptedProfileResult;
    }

    const { profile } = profileResult;
    showProfile(profile);

    await withRetry(
      async () => {
        await refreshSocialSnapshot();
        await refreshFeed();
      },
      {
        attempts: 3,
        delayMs: 700,
      },
    );

    setWalletUi(true);
    setWalletStatus(`Conectado a ${ARKIV_NETWORK_NAME}.`, "success");
  } catch (error) {
    console.error(error);
    const message = safeMsg(error);
    if (
      message.includes("Failed to fetch dynamically imported module")
      || message.includes("No se pudo cargar dist/index.mjs")
    ) {
      alert("No se encontro /dist/index.mjs. Ejecuta npm run build en la raiz del proyecto.");
      setWalletStatus("Falta build local: ejecuta npm run build.", "error");
      return;
    }
    const readable = userErrorMsg(error);
    alert("Error al conectar: " + readable);
    setWalletStatus(`No se pudo conectar: ${readable}`, "error");
  } finally {
    connectWalletBtn.disabled = false;
  }
});

disconnectWalletBtn.addEventListener("click", () => {
  client = null;
  walletAddress = null;
  walletAddressEl.textContent = "";
  document.getElementById("profile-display").classList.add("hidden");
  profilePhotoFileEl.value = "";
  postFileEl.value = "";
  revokeBlobUrls();
  setUploadStatus(profileUploadStatusEl, "");
  setUploadStatus(postUploadStatusEl, "");
  renderDisconnectedSnapshot();
  setWalletStatus("Desconectado.", "warn");
  setWalletUi(false);
});

document.getElementById("save-profile").addEventListener("click", async () => {
  if (!client) return;
  try {
    const displayName = document.getElementById("display-name").value.trim();
    const bio = document.getElementById("bio").value.trim();
    const photoInput = document.getElementById("photo-url").value.trim();

    let photo = photoInput || DEFAULT_PHOTO;
    const photoFile = profilePhotoFileEl.files?.[0];
    if (photoFile) {
      photo = await uploadFileToArkiv(photoFile, profileUploadStatusEl);
    }

    let updateResult;
    try {
      updateResult = await client.update({ displayName, bio, photo });
    } catch (updateError) {
      if (!isTransactionFailedError(updateError)) throw updateError;

      try {
        updateResult = await updateProfileCompat(client, {
          displayName,
          bio,
          photo,
          connectedWallet: walletAddress,
        });
        setWalletStatus("Perfil guardado con modo compatibilidad.", "warn");
      } catch (compatError) {
        const revertDetails = extractErrorDetails(compatError);
        throw new Error(
          "La transaccion fue revertida por Arkiv. "
          + `Detalle tecnico: ${revertDetails}`
        );
      }
    }

    const { profile } = updateResult;
    showProfile(profile);
    alert("Perfil guardado.");
  } catch (error) {
    console.error(error);
    alert("No se pudo guardar el perfil: " + userErrorMsg(error));
  }
});

document.getElementById("edit-profile").addEventListener("click", () => {
  document.getElementById("display-name").focus();
});

document.getElementById("create-post").addEventListener("click", async () => {
  if (!client) return;

  const contentEl = document.getElementById("post-content");
  const content = contentEl.value.trim();
  const postFile = postFileEl.files?.[0];
  if (!content && !postFile) return;

  try {
    let media;
    if (postFile) {
      const manifestKey = await uploadFileToArkiv(postFile, postUploadStatusEl);
      media = [{
        url: manifestKey,
        type: mediaTypeFromMime(postFile),
        alt: postFile.name,
      }];
    }

    try {
      await client.feed().createPost({ content, media });
    } catch (postError) {
      if (!isTransactionFailedError(postError)) throw postError;
      const revertDetails = extractErrorDetails(postError);
      console.warn("[Arbok][PostCreateError]", revertDetails);
      await createPostCompat(client, { content, media });
      setWalletStatus(`Post publicado con modo compatibilidad (ttl=${POST_EXPIRY_SECONDS}s).`, "warn");
    }

    contentEl.value = "";
    postFileEl.value = "";
    await refreshFeed();
    alert("Post publicado.");
  } catch (error) {
    console.error(error);
    const detail = extractErrorDetails(error);
    alert("No se pudo publicar: " + userErrorMsg(error) + "\n\nDetalle tecnico: " + detail);
  }
});

document.getElementById("follow-btn").addEventListener("click", async () => {
  if (!client) return;
  const uuidEl = document.getElementById("follow-uuid");
  const targetUuid = uuidEl.value.trim();
  if (!targetUuid) return;

  try {
    await client.social().follow(targetUuid);
    uuidEl.value = "";
    await refreshSocialSnapshot();
    await refreshFeed();
    alert(`Ahora sigues a ${targetUuid}.`);
  } catch (error) {
    console.error(error);
    alert("No se pudo seguir al usuario: " + userErrorMsg(error));
  }
});

const refreshFeedBtn = document.getElementById("refresh-feed");
if (refreshFeedBtn) {
  refreshFeedBtn.addEventListener("click", async () => {
    if (!client) return;
    try {
      await refreshSocialSnapshot();
      await refreshFeed();
    } catch (error) {
      console.error(error);
      alert("No se pudo actualizar el feed: " + userErrorMsg(error));
    }
  });
}

renderDisconnectedSnapshot();

window.addEventListener("load", () => {
  setTimeout(() => {
    if (providerOrNull()) {
      connectWalletBtn.textContent = "Conectar MetaMask";
    }
  }, 1000);
});
