/* ============================================================
   AniLector — sesión con Google + sincronización en Drive
   ------------------------------------------------------------
   - Google Identity Services (OAuth 2.0 en el navegador, sin servidor).
   - La información personal (nombre, correo, foto) se muestra en la app.
   - La biblioteca, el progreso de lectura y los recientes se respaldan
     en la carpeta privada de la app dentro del Drive DEL USUARIO
     (appDataFolder): nadie más tiene acceso, ni siquiera otras apps.
   ============================================================ */
import { t } from "./i18n.js";
import { GOOGLE_CLIENT_ID } from "./config.js";

const SCOPES =
  "openid email profile https://www.googleapis.com/auth/drive.appdata";
const FILE_NAME = "anilector-datos.json";
const KEYS = ["anilector.library", "anilector.progress", "anilector.recent", "anilector.seen", "anilector.sites", "anilector.tvfavs", "anilector.brand"];

let tokenClient = null;
let accessToken = null;
let tokenExp = 0;
let user = null;
let fileId = null;
let uploadTimer = null;
let onDataRefresh = null;

const area = () => document.getElementById("authArea");

/* ---------- Google Identity Services ---------- */
function gisReady() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("No se pudo cargar Google Identity"));
    document.head.appendChild(s);
  });
}

function getToken(silent) {
  return gisReady().then(
    () =>
      new Promise((resolve, reject) => {
        if (accessToken && Date.now() < tokenExp - 60000) return resolve(accessToken);
        if (!tokenClient) {
          tokenClient = window.google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: SCOPES,
            callback: () => {},
          });
        }
        tokenClient.callback = (resp) => {
          if (resp.error) return reject(new Error(resp.error));
          accessToken = resp.access_token;
          tokenExp = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
          resolve(accessToken);
        };
        tokenClient.error_callback = (e) => reject(new Error(e?.type || "popup"));
        tokenClient.requestAccessToken(silent ? { prompt: "" } : {});
      })
  );
}

/* ---------- llamadas a Google ---------- */
async function gapi(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Google ${res.status}`);
  return res;
}

async function fetchProfile() {
  user = await (await gapi("https://www.googleapis.com/oauth2/v3/userinfo")).json();
  try { localStorage.setItem("anilector.guser", JSON.stringify(user)); } catch (_) {}
}

/* ---------- Drive (appDataFolder) ---------- */
async function findFile() {
  const q = encodeURIComponent(`name='${FILE_NAME}'`);
  const d = await (
    await gapi(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name)&q=${q}`)
  ).json();
  fileId = d.files?.[0]?.id || null;
  return fileId;
}

async function download() {
  if (!fileId) return null;
  try {
    return await (
      await gapi(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`)
    ).json();
  } catch (_) { return null; }
}

async function upload(data) {
  const body = JSON.stringify(data);
  if (!fileId) {
    const boundary = "anilector_multipart";
    const meta = JSON.stringify({ name: FILE_NAME, parents: ["appDataFolder"] });
    const multipart =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
    const d = await (
      await gapi("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body: multipart,
      })
    ).json();
    fileId = d.id || fileId;
  } else {
    await gapi(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
    });
  }
}

/* ---------- datos locales y fusión ---------- */
function readKey(k) {
  try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; }
}
function collectLocal() {
  return {
    library: readKey(KEYS[0]) || [],
    progress: readKey(KEYS[1]) || {},
    recent: readKey(KEYS[2]) || [],
    seen: readKey(KEYS[3]) || {},
    sites: readKey(KEYS[4]) || [],
    tvfavs: readKey(KEYS[5]) || [],
    brand: readKey(KEYS[6]) || null,
    updatedAt: Date.now(),
  };
}
function applyMerged(m) {
  try {
    localStorage.setItem(KEYS[0], JSON.stringify(m.library || []));
    localStorage.setItem(KEYS[1], JSON.stringify(m.progress || {}));
    localStorage.setItem(KEYS[2], JSON.stringify(m.recent || []));
    localStorage.setItem(KEYS[3], JSON.stringify(m.seen || {}));
    localStorage.setItem(KEYS[4], JSON.stringify(m.sites || []));
    localStorage.setItem(KEYS[5], JSON.stringify(m.tvfavs || []));
    if (m.brand) localStorage.setItem(KEYS[6], JSON.stringify(m.brand));
  } catch (_) {}
}
// Une los sitios favoritos de ambos equipos sin duplicar (clave: la URL).
function mergeSites(remote, local) {
  const key = (s) => String(s.url || "").trim().replace(/\/$/, "").toLowerCase();
  const byUrl = new Map();
  for (const s of remote || []) if (s?.url) byUrl.set(key(s), s);
  for (const s of local || []) if (s?.url) byUrl.set(key(s), s); // lo local gana (renombres recientes)
  return [...byUrl.values()];
}
// Fusiona vistos/leídos por título, uniendo episodios y capítulos de ambos lados.
function mergeSeen(remote, local) {
  const out = {};
  for (const id of new Set([...Object.keys(remote), ...Object.keys(local)])) {
    const r = remote[id] || {}, l = local[id] || {};
    const eps = { ...(r.eps || {}), ...(l.eps || {}) };
    const chs = { ...(r.chs || {}), ...(l.chs || {}) };
    const newer = (l.ts || 0) >= (r.ts || 0) ? l : r; // el más reciente define "último"
    out[id] = {
      title: newer.title || r.title || l.title,
      cover: newer.cover || r.cover || l.cover,
      cat: newer.cat || r.cat || l.cat,
      base: newer.base || r.base || l.base,
      eps, chs,
      last: newer.last, lastKind: newer.lastKind,
      ts: Math.max(l.ts || 0, r.ts || 0),
    };
  }
  return out;
}
function merge(remote, local) {
  if (!remote) return local;
  const byId = new Map();
  for (const it of remote.library || []) byId.set(it.id, it);
  for (const it of local.library || []) byId.set(it.id, it); // lo local (más reciente en este equipo) gana
  return {
    library: [...byId.values()],
    progress: { ...(remote.progress || {}), ...(local.progress || {}) },
    recent: [...new Set([...(local.recent || []), ...(remote.recent || [])])].slice(0, 5),
    seen: mergeSeen(remote.seen || {}, local.seen || {}),
    sites: mergeSites(remote.sites, local.sites),
    // Los canales favoritos se unen igual que los sitios: la clave es la URL.
    tvfavs: mergeSites(remote.tvfavs, local.tvfavs),
    // La marca es un ajuste único: gana la de este equipo si la hay.
    brand: local.brand || remote.brand || null,
    updatedAt: Date.now(),
  };
}

/* ---------- sincronización ---------- */
async function syncNow({ toastOk = false } = {}) {
  if (!user) return;
  await getToken(true).catch(() => getToken(false));
  // Con token válido ya se puede confirmar quién es (al arrancar solo
  // teníamos el perfil en caché).
  if (!user.email) await fetchProfile().catch(() => {});
  await findFile();
  const merged = merge(await download(), collectLocal());
  applyMerged(merged);
  await upload(merged);
  onDataRefresh?.();
  if (toastOk) showToast(t("auth.synced"));
}

/* Subida automática en segundo plano. Solo se hace si YA hay un token
   válido de esta sesión: pedir uno aquí abriría una ventana emergente sin
   gesto del usuario y el navegador la bloquearía. Si no lo hay, se marca
   como pendiente y el avatar avisa para que el usuario toque «Sincronizar». */
let pending = false;
function scheduleUpload() {
  if (!user) return;
  if (!hasToken()) { pending = true; render(); return; }
  clearTimeout(uploadTimer);
  uploadTimer = setTimeout(async () => {
    try {
      await getToken(true);
      if (!fileId) await findFile();
      await upload(collectLocal());
      pending = false;
      render();
    } catch (e) {
      pending = true;
      render();
      console.warn("Sync:", e.message);
    }
  }, 2500);
}
function hasToken() { return !!accessToken && Date.now() < tokenExp - 60000; }

function showToast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add("hidden"), 2600);
}

/* ---------- interfaz ---------- */
function render() {
  const el = area();
  if (!el) return;
  if (!user) {
    el.innerHTML = `
      <button id="gSignIn" class="btn btn-ghost auth-btn" title="${t("auth.signIn")}">
        <svg width="16" height="16" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.4 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.9 7.2l7.6 5.9c4.4-4.1 7.1-10.2 7.1-17.6z"/><path fill="#FBBC05" d="M10.4 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.6l-7.6-5.9c-2.1 1.4-4.7 2.2-7.6 2.2-6.3 0-11.7-3.9-13.6-9.4l-7.8 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
        <span class="auth-btn-text">${t("auth.signIn")}</span>
      </button>`;
    document.getElementById("gSignIn").addEventListener("click", signIn);
  } else {
    const pic = user.picture
      ? `<img class="auth-avatar" src="${user.picture}" alt="" referrerpolicy="no-referrer" />`
      : `<span class="auth-avatar auth-avatar-fallback">${(user.name || "?").charAt(0)}</span>`;
    el.innerHTML = `
      <button id="gChip" class="auth-chip${pending ? " has-pending" : ""}" title="${pending ? t("auth.pending") : (user.email || "")}">${pic}</button>
      <div id="gMenu" class="auth-menu hidden">
        <div class="auth-menu-user"><b>${user.name || ""}</b><small>${user.email || ""}</small></div>
        ${pending ? `<div class="auth-pending">☁️ ${t("auth.pending")}</div>` : ""}
        <button id="gSync" class="btn btn-ghost">☁️ ${t("auth.sync")}</button>
        <button id="gOut" class="btn btn-ghost">🚪 ${t("auth.signOut")}</button>
      </div>`;
    document.getElementById("gChip").addEventListener("click", (e) => {
      e.stopPropagation();
      document.getElementById("gMenu").classList.toggle("hidden");
    });
    document.getElementById("gSync").addEventListener("click", () => {
      document.getElementById("gMenu").classList.add("hidden");
      // Este SÍ es un gesto del usuario: aquí la ventana de Google
      // se puede abrir sin que el navegador la bloquee.
      syncNow({ toastOk: true })
        .then(() => { pending = false; render(); })
        .catch(() => showToast(t("auth.syncError")));
    });
    document.getElementById("gOut").addEventListener("click", signOut);
    document.addEventListener("click", () =>
      document.getElementById("gMenu")?.classList.add("hidden"), { once: true });
  }
}

async function signIn() {
  try {
    await getToken(false);
    await fetchProfile();
    localStorage.setItem("anilector.gsignin", "1");
    render();
    showToast(`${t("auth.hello")}, ${user.given_name || user.name || ""} 👋`);
    await syncNow({ toastOk: true });
  } catch (e) {
    console.warn("Google sign-in:", e.message);
    showToast(t("auth.syncError"));
  }
}

function signOut() {
  try { if (accessToken) window.google?.accounts?.oauth2?.revoke(accessToken, () => {}); } catch (_) {}
  accessToken = null; tokenExp = 0; user = null; fileId = null;
  localStorage.removeItem("anilector.gsignin");
  localStorage.removeItem("anilector.guser");
  render();
  showToast(t("auth.bye"));
}

/* ---------- arranque ----------
   OJO: NO se pide el token aquí. `requestAccessToken` SIEMPRE abre una
   ventana emergente, y una que no nace de un gesto del usuario la bloquea
   el navegador; además la librería de Google consulta `window.closed` de
   esa ventana, que es justo lo que provocaba los avisos de
   Cross-Origin-Opener-Policy en la consola al cargar la página.
   Se restaura la sesión desde la caché (avatar y nombre) y el token se
   pide solo cuando el usuario toca algo: sincronizar o iniciar sesión. */
export function initAuth(refreshCb) {
  onDataRefresh = refreshCb;
  if (!GOOGLE_CLIENT_ID) { const el = area(); if (el) el.innerHTML = ""; return; }
  if (localStorage.getItem("anilector.gsignin") === "1") {
    const cached = readKey("anilector.guser");
    if (cached) user = cached;
  }
  render();
  window.addEventListener("anilector:datachanged", scheduleUpload);
}
