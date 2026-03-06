let sdk = null;
let client = null;
let walletAddress = null;

const DEFAULT_PHOTO = "https://via.placeholder.com/150";

const connectWalletBtn = document.getElementById("connect-wallet");
const disconnectWalletBtn = document.getElementById("disconnect-wallet");
const walletInfo = document.getElementById("wallet-info");
const walletAddressEl = document.getElementById("wallet-address");
const followersList = document.getElementById("followers-list");

async function loadSdk() {
  if (!sdk) {
    sdk = await import("/dist/index.mjs");
  }
  return sdk;
}

function providerOrNull() {
  return window.ethereum || window.web3?.currentProvider || null;
}

function deriveUuid(address) {
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

function showProfile(profile) {
  const displayName = profile.displayName || profile.uuid;
  const bio = profile.bio || "";
  const photo = profile.photo || DEFAULT_PHOTO;

  document.getElementById("display-name").value = displayName;
  document.getElementById("bio").value = bio;
  document.getElementById("photo-url").value = photo;

  document.getElementById("profile-photo").src = photo;
  document.getElementById("profile-name").textContent = displayName;
  document.getElementById("profile-bio").textContent = bio;
  document.getElementById("profile-display").classList.remove("hidden");
}

function renderPosts(posts) {
  const postsList = document.getElementById("posts-list");
  postsList.innerHTML = "";

  for (const post of posts) {
    const item = document.createElement("div");
    item.className = "post-item";
    item.innerHTML = `
      <p>${post.content}</p>
      <small>${new Date(post.createdAt).toLocaleString()}</small>
    `;
    postsList.appendChild(item);
  }
}

async function refreshMyPosts() {
  if (!client) return;
  const feed = client.feed();
  const posts = await feed.getUserPosts({ limit: 50 });
  renderPosts(posts);
}

async function refreshFollowerCounts() {
  if (!client) return;
  const counts = await client.social().getFollowerCounts();
  followersList.innerHTML = `
    <p><strong>Siguiendo:</strong> ${counts.following}</p>
    <p><strong>Seguidores:</strong> ${counts.followers}</p>
  `;
}

connectWalletBtn.addEventListener("click", async () => {
  try {
    const provider = providerOrNull();
    if (!provider) {
      alert("MetaMask no detectado.");
      return;
    }

    const accounts = await provider.request({ method: "eth_requestAccounts" });
    walletAddress = accounts[0];
    walletAddressEl.textContent = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;

    const { createArbok, BaseClient, PublicClient, WalletClient, custom } = await loadSdk();
    const cdn = createArbok({
      publicClient: new PublicClient(),
      wallets: new WalletClient({ transport: custom(provider) }),
    });

    client = new BaseClient({
      uuid: deriveUuid(walletAddress),
      wallet: walletAddress,
      photo: DEFAULT_PHOTO,
      cdn,
    });

    const { profile } = await client.getOrCreate();
    showProfile(profile);
    await refreshMyPosts();
    await refreshFollowerCounts();
    setWalletUi(true);
  } catch (error) {
    console.error(error);
    const message = safeMsg(error);
    if (message.includes("Failed to fetch dynamically imported module")) {
      alert("No se encontro /dist/index.mjs. Ejecuta npm run build en la raiz del proyecto.");
      return;
    }
    alert("Error al conectar: " + message);
  }
});

disconnectWalletBtn.addEventListener("click", () => {
  client = null;
  walletAddress = null;
  walletAddressEl.textContent = "";
  document.getElementById("profile-display").classList.add("hidden");
  document.getElementById("posts-list").innerHTML = "";
  followersList.innerHTML = "";
  setWalletUi(false);
});

document.getElementById("save-profile").addEventListener("click", async () => {
  if (!client) return;
  try {
    const displayName = document.getElementById("display-name").value.trim();
    const bio = document.getElementById("bio").value.trim();
    const photoInput = document.getElementById("photo-url").value.trim();
    const photo = photoInput || DEFAULT_PHOTO;

    const { profile } = await client.update({ displayName, bio, photo });
    showProfile(profile);
    alert("Perfil guardado.");
  } catch (error) {
    console.error(error);
    alert("No se pudo guardar el perfil: " + safeMsg(error));
  }
});

document.getElementById("edit-profile").addEventListener("click", () => {
  document.getElementById("display-name").focus();
});

document.getElementById("create-post").addEventListener("click", async () => {
  if (!client) return;
  const contentEl = document.getElementById("post-content");
  const content = contentEl.value.trim();
  if (!content) return;

  try {
    await client.feed().createPost({ content });
    contentEl.value = "";
    await refreshMyPosts();
    alert("Post publicado.");
  } catch (error) {
    console.error(error);
    alert("No se pudo publicar: " + safeMsg(error));
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
    await refreshFollowerCounts();
    alert(`Ahora sigues a ${targetUuid}.`);
  } catch (error) {
    console.error(error);
    alert("No se pudo seguir al usuario: " + safeMsg(error));
  }
});

window.addEventListener("load", () => {
  setTimeout(() => {
    if (providerOrNull()) {
      connectWalletBtn.textContent = "Conectar MetaMask";
    }
  }, 1000);
});
