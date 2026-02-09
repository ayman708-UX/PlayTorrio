// preload.js
const { contextBridge, ipcRenderer } = require("electron");

let wcRendererMod = null;
let wcPrebuilt = null;
try { wcRendererMod = require("wcjs-renderer"); } catch (_) {}
try { wcPrebuilt = require("wcjs-prebuilt"); } catch (_) {}

contextBridge.exposeInMainWorld("electronAPI", {
  // AIOSTREAMS Manifest Storage
  manifestWrite: (url) => ipcRenderer.invoke("manifestWrite", url),
  manifestRead: () => ipcRenderer.invoke("manifestRead"),

  // Stremio Addons
  addonInstall: (url) => ipcRenderer.invoke("addonInstall", url),
  addonList: () => ipcRenderer.invoke("addonList"),
  addonRemove: (id) => ipcRenderer.invoke("addonRemove", id),

  // Platform
  platform: process.platform,

  // Window Controls
  minimizeWindow: () => ipcRenderer.invoke("window-minimize"),
  maximizeWindow: () => ipcRenderer.invoke("window-maximize-toggle"),
  closeWindow: () => ipcRenderer.invoke("window-close"),
  toggleDevTools: () => ipcRenderer.invoke("toggle-devtools"),
  onMaximizeChanged: (cb) => ipcRenderer.on("window-maximize-changed", (_e, payload) => cb && cb(payload)),

  // Player Launchers
  spawnMpvjsPlayer: (payload) => ipcRenderer.invoke("spawn-mpvjs-player", payload),
  openInMPV: (data) => ipcRenderer.invoke("open-in-mpv", data),
  openMPVDirect: (url) => ipcRenderer.invoke("open-mpv-direct", url),
  openMpvWithHeaders: (options) => ipcRenderer.invoke("open-mpv-headers", options),

  openInVLC: (data) => ipcRenderer.invoke("open-in-vlc", data),
  openVLCDirect: (url) => ipcRenderer.invoke("open-vlc-direct", url),
  openInIINA: (data) => ipcRenderer.invoke("open-in-iina", data),

  playXDMovies: (data) => ipcRenderer.invoke("play-xdmovies", data),
  castToChromecast: (data) => ipcRenderer.invoke("cast-to-chromecast", data),
  discoverChromecastDevices: () => ipcRenderer.invoke("discover-chromecast-devices"),
  onStreamClosed: (callback) => ipcRenderer.on("stream-closed", callback),

  // Cache + Files
  clearWebtorrentTemp: () => ipcRenderer.invoke("clear-webtorrent-temp"),
  clearCache: () => ipcRenderer.invoke("clear-cache"),
  selectCacheFolder: () => ipcRenderer.invoke("select-cache-folder"),
  pickFile: (options) => ipcRenderer.invoke("pick-file", options),
  restartApp: () => ipcRenderer.invoke("restart-app"),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  copyToClipboard: (text) => ipcRenderer.invoke("copy-to-clipboard", text),
  showFolderInExplorer: (folderPath) => ipcRenderer.invoke("show-folder-in-explorer", folderPath),
  setSkipTorrentCleanup: (skip) => ipcRenderer.invoke("set-skip-torrent-cleanup", skip),

  // Books
  booksGetUrl: () => ipcRenderer.invoke("books-get-url"),
  onBooksUrl: (cb) => ipcRenderer.on("books-url", (_e, payload) => cb && cb(payload)),

  // Updates
  onUpdateChecking: (cb) => ipcRenderer.on("update-checking", (_e, info) => cb && cb(info)),
  onUpdateAvailable: (cb) => ipcRenderer.on("update-available", (_e, info) => cb && cb(info)),
  onUpdateNotAvailable: (cb) => ipcRenderer.on("update-not-available", (_e, info) => cb && cb(info)),
  onUpdateProgress: (cb) => ipcRenderer.on("update-download-progress", (_e, p) => cb && cb(p)),
  onUpdateDownloaded: (cb) => ipcRenderer.on("update-downloaded", (_e, info) => cb && cb(info)),
  installUpdateNow: () => ipcRenderer.invoke("updater-install"),

  // My List
  myListRead: () => ipcRenderer.invoke("my-list-read"),
  myListWrite: (data) => ipcRenderer.invoke("my-list-write", data),

  // Done Watching
  doneWatchingRead: () => ipcRenderer.invoke("done-watching-read"),
  doneWatchingWrite: (data) => ipcRenderer.invoke("done-watching-write", data),

  // Fullscreen
  setFullscreen: (isFullscreen) => ipcRenderer.invoke("set-fullscreen", isFullscreen),
  getFullscreen: () => ipcRenderer.invoke("get-fullscreen"),
  setPreferredMode: (mode) => ipcRenderer.invoke("set-preferred-mode", mode),

  // Discord Rich Presence
  updateDiscordPresence: (data) => ipcRenderer.invoke("update-discord-presence", data),
  clearDiscordPresence: () => ipcRenderer.invoke("clear-discord-presence"),

  // EPUB
  getEpubFolder: () => ipcRenderer.invoke("get-epub-folder"),
  downloadEpub: (arg1, arg2) => {
    let payload;
    if (arg1 && typeof arg1 === "object" && "url" in arg1) payload = arg1;
    else payload = { url: arg1, bookData: arg2 };
    return ipcRenderer.invoke("download-epub", payload);
  },
  getEpubLibrary: () => ipcRenderer.invoke("get-epub-library"),
  readEpubFile: (filePath) => ipcRenderer.invoke("read-epub-file", filePath),

  // Music offline
  musicDownloadTrack: (track) => ipcRenderer.invoke("music-download-track", track),
  musicGetOfflineLibrary: () => ipcRenderer.invoke("music-offline-library"),
  musicDeleteOfflineTrack: (entryId) => ipcRenderer.invoke("music-offline-delete", entryId),

  // WebChimera Renderer
  wcjs: {
    available: Boolean(wcRendererMod),
    init(canvasSelector, vlcArgs = []) {
      if (!wcRendererMod) return null;
      try {
        const canvas = document.querySelector(canvasSelector);
        if (!canvas) return null;
        if (typeof wcRendererMod.bind === "function" && wcPrebuilt) {
          const player = (wcPrebuilt.createPlayer ? wcPrebuilt.createPlayer(vlcArgs) : new wcPrebuilt.VlcPlayer(vlcArgs));
          wcRendererMod.bind(canvas, player, {});
          return { player };
        }
        if (typeof wcRendererMod.init === "function") {
          const player = wcRendererMod.init(canvas, vlcArgs, false);
          return { player };
        }
        return null;
      } catch {
        return null;
      }
    }
  },

  // Stream Extraction
  extractStream: (url) => ipcRenderer.invoke('extract-stream', url),
  closeStreamExtraction: () => ipcRenderer.invoke('close-stream-extraction'),
  onStreamDetected: (callback) => ipcRenderer.on('stream-detected', (_event, data) => callback(data)),
  removeStreamListener: (handler) => ipcRenderer.removeListener('stream-detected', handler)
});
