import { app, BrowserWindow, ipcMain, shell, clipboard, dialog, Menu, session } from 'electron';
import { spawn, spawnSync, fork } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import http from 'http';
import os from 'os';
import got from 'got';
import { pipeline as streamPipelineCb } from 'stream';
import { promisify } from 'util';
import dns from 'dns';
import { createRequire } from 'module';
import { ElectronBlocker } from '@ghostery/adblocker-electron';
import fetch from 'node-fetch';
// app.disableHardwareAcceleration(); // Removed for HTML5 player

// electron-updater is CommonJS; use default import + destructure for ESM
import updaterPkg from 'electron-updater';
// discord-rpc is CommonJS; default import works under ESM
// Defer requiring discord-rpc to runtime so wrong-arch prebuilds don't crash startup
// We'll attempt to load it inside setupDiscordRPC() with a safe try/catch
import { startServer } from './server.mjs'; // Import the server
// Chromecast module will be dynamically imported when needed

const { autoUpdater } = updaterPkg;
const streamPipeline = promisify(streamPipelineCb);
const dnsLookup = promisify(dns.lookup);

// Create require for CommonJS modules
const require = createRequire(import.meta.url);
// import { openPlayer, registerIPC, initPlayer } from './playerHandler.js'; // Removed

// Spotify Music Integration
const SPOTIFY_CLIENT_ID = '6757e9618d9948b6b1f3312401bfcfa7';
const SPOTIFY_CLIENT_SECRET = '0b7ec13743e7454981e0ad0d6b1d5aa5';
let spotifyToken = '';
let tokenExpiration = 0;
const urlCache = new Map();
const URL_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// ===================================================
// PLATFORM-SPECIFIC INITIALIZATION
// ===================================================

// Switches for transparent visuals and GPU compatibility (Integrated Player) - Removed
// if (process.platform === 'win32' || process.platform === 'linux') {
//    app.commandLine.appendSwitch('enable-transparent-visuals');
//    app.commandLine.appendSwitch('disable-gpu-compositing');
// }
if (process.platform === 'darwin') {
    app.commandLine.appendSwitch('disable-gpu-sandbox');
}

// --------------------------------------------------
// LINUX APPIMAGE FIX (Electron < 9 compatible)
// --------------------------------------------------
if (process.platform === "linux") {
    console.log("[Linux] Applying AppImage compatibility patches");

    app.commandLine.appendSwitch("no-sandbox");
    app.commandLine.appendSwitch("disable-setuid-sandbox");
    app.commandLine.appendSwitch("disable-gpu-sandbox");
    // app.commandLine.appendSwitch("disable-gpu"); // Removed to allow MPV hardware acceleration if possible
    app.commandLine.appendSwitch("no-zygote");
    app.commandLine.appendSwitch("ignore-gpu-blacklist");

    if (process.env.APPIMAGE) {
        console.log("[Linux] Detected AppImage mode");
        // app.commandLine.appendSwitch("disable-gpu");
    }
}

// ----------------------
// Set persistent userData path to prevent data loss on updates
// CRITICAL: Must be done BEFORE app.ready to preserve localStorage/IndexedDB
// ----------------------
let persistentUserDataPath;
if (process.platform === 'win32') {
    // Windows: Use APPDATA/PlayTorrio (survives updates)
    persistentUserDataPath = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'PlayTorrio');
} else if (process.platform === 'darwin') {
    // macOS: Use ~/Library/Application Support/PlayTorrio
    persistentUserDataPath = path.join(os.homedir(), 'Library', 'Application Support', 'PlayTorrio');
} else {
    // Linux: Use ~/.config/playtorrio
    persistentUserDataPath = path.join(os.homedir(), '.config', 'playtorrio');
}

try {
    if (!fs.existsSync(persistentUserDataPath)) {
        fs.mkdirSync(persistentUserDataPath, { recursive: true, mode: 0o755 });
        console.log('[UserData] Created persistent directory:', persistentUserDataPath);
    }
    // Override Electron's default userData path to prevent deletion on updates
    app.setPath('userData', persistentUserDataPath);
    console.log('[UserData] Set to:', app.getPath('userData'));
    
    // Verify userData path is writable and create persistence marker
    try {
        const markerPath = path.join(persistentUserDataPath, '.userData_verified');
        fs.writeFileSync(markerPath, JSON.stringify({
            created: new Date().toISOString(),
            version: app.getVersion(),
            platform: process.platform
        }), 'utf8');
        console.log('✅ userDataPath is writable:', persistentUserDataPath);
    } catch (writeErr) {
        console.error('⚠️ userDataPath may not be writable:', writeErr.message);
    }
} catch (err) {
    console.error('[UserData] Failed to set persistent path:', err.message);
}

// Keep configDir for backward compatibility
const configDir = persistentUserDataPath;

let httpServer;
let mainWindow;
// Updater runtime state/timers so we can disable cleanly at runtime
let updaterActive = false;
let updaterTimers = { initial: null, retry: null };
// Flag to skip torrent cleanup during same-torrent episode transitions
let skipTorrentCleanupHash = null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----------------------
// Global crash guards (log instead of silent exit)
// ----------------------
try {
    process.on('uncaughtException', (err) => {
        try { console.error('[Global] uncaughtException:', err?.stack || err); } catch(_) {}
    });
    process.on('unhandledRejection', (reason) => {
        // Ignore Discord RPC errors - they're non-critical
        if (reason?.message?.includes('Unknown Error') && reason?.code === 1000) {
            console.warn('[Discord RPC] Non-critical error ignored:', reason?.message);
            return;
        }
        try { console.error('[Global] unhandledRejection:', reason); } catch(_) {}
    });
} catch(_) {}


// Ensure a stable AppUserModelID to prevent Windows taskbar/shortcut icon issues after updates
try { app.setAppUserModelId('com.ayman.PlayTorrio'); } catch(_) {}

// Read auto-update preference from persisted settings (server.mjs uses settings.json in userData)
function readAutoUpdateEnabled() {
    try {
        const settingsPath = path.join(app.getPath('userData'), 'settings.json');
        if (fs.existsSync(settingsPath)) {
            const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            return s.autoUpdate !== false; // default ON if missing
        }
    } catch (_) {}
    return true; // default ON
}

// ----------------------
// Discord Rich Presence
// ----------------------
const DISCORD_CLIENT_ID = '1430114242815725579';
let discordRpc = null;
let discordRpcReady = false;
let DiscordRPCPkg = null; // will hold the module after lazy load

function setupDiscordRPC() {
    try {
        if (!DISCORD_CLIENT_ID) return;
        // Avoid double init
        if (discordRpc) return;
        try {
            if (!DiscordRPCPkg) {
                // Lazy require to avoid arch mismatch crashing early
                // Using require so electron-builder can still handle CJS
                // Wrap in try so Intel build doesn't die if arm64-only binary was packed
                DiscordRPCPkg = require('discord-rpc');
            }
        } catch (e) {
            console.warn('[Discord RPC] Module load failed (will disable RPC):', e?.message || e);
            return; // disable silently
        }

        try { DiscordRPCPkg.register(DISCORD_CLIENT_ID); } catch(_) {}

        discordRpc = new DiscordRPCPkg.Client({ transport: 'ipc' });

        const setBaseActivity = () => {
            try {
                if (!discordRpc) return;
                discordRpc.setActivity({
                    details: 'Browsing PlayTorrio',
                    startTimestamp: new Date(),
                    largeImageKey: 'icon', // uploaded image name on Discord dev portal
                    largeImageText: 'PlayTorrio App',
                    buttons: [
                        { label: 'Download App', url: 'https://github.com/ayman708-UX/PlayTorrio' }
                    ]
                });
            } catch (e) {
                console.error('[Discord RPC] setActivity error:', e?.message || e);
            }
        };

        discordRpc.on('ready', () => {
            discordRpcReady = true;
            setBaseActivity();
            console.log('✅ Discord Rich Presence active!');
        });

        discordRpc.on('error', (err) => {
            console.warn('[Discord RPC] Connection error:', err?.message || err);
            discordRpcReady = false;
        });

        discordRpc.login({ clientId: DISCORD_CLIENT_ID }).catch((err) => {
            console.warn('[Discord RPC] Login failed (Discord may not be running):', err?.message || err);
            discordRpcReady = false;
        });
    } catch (e) {
        console.error('[Discord RPC] setup failed:', e?.message || e);
        discordRpcReady = false;
    }
}

// ----------------------
// Auto Update (Main-only)
// ----------------------
function setupAutoUpdater() {
    try {
        // Only enable in packaged builds
        if (!app.isPackaged) {
            console.log('[Updater] Skipping auto-update in development mode');
            return;
        }

        // Check if auto-updates are disabled in settings
        if (!readAutoUpdateEnabled()) {
            console.log('[Updater] Auto-updates disabled in settings');
            return;
        }

    // Configure updater to only check current platform
    autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'ayman708-UX',
        repo: 'PlayTorrio',
        releaseType: 'release'
    });

    // Disable auto download on all platforms; we'll start it manually after guards
    // This avoids update loops on Windows when the same version is republished or install fails
    autoUpdater.autoDownload = false;
    // We want to show the NSIS installer UI (non-silent) and exit immediately once ready
    // So do NOT auto-install on app quit; we will explicitly quitAndInstall when downloaded
    autoUpdater.autoInstallOnAppQuit = false;

    // ---------- Update loop guard (persisted) ----------
    const updaterStatePath = path.join(app.getPath('userData'), 'updater_state.json');
    const readUpdaterState = () => {
        try { return JSON.parse(fs.readFileSync(updaterStatePath, 'utf8')); } catch(_) { return {}; }
    };
    const writeUpdaterState = (obj) => {
        try { fs.writeFileSync(updaterStatePath, JSON.stringify(obj || {}, null, 2)); } catch(_) {}
    };
    const clearUpdaterState = () => { try { fs.unlinkSync(updaterStatePath); } catch(_) {} };

    const compareVersions = (a, b) => {
        // returns 1 if a>b, -1 if a<b, 0 if equal
        const pa = String(a||'').split('.').map(n=>parseInt(n,10)||0);
        const pb = String(b||'').split('.').map(n=>parseInt(n,10)||0);
        for (let i=0;i<Math.max(pa.length,pb.length);i++) {
            const da = pa[i]||0, db = pb[i]||0;
            if (da>db) return 1; if (da<db) return -1;
        }
        return 0;
    };

    const state = readUpdaterState();
    const now = Date.now();
    const deferWindowMs = 30*60*1000; // 30 minutes - prevent update loops
    const currentVersion = app.getVersion();
    const attemptedVersion = state?.targetVersion;
    const lastAttempt = state?.lastInstallAttempt || 0;
    const recentAttempt = (now - lastAttempt) < deferWindowMs;
    const installLikelySucceeded = attemptedVersion && compareVersions(currentVersion, attemptedVersion) >= 0;
    if (installLikelySucceeded) {
        // Upgrade finished; clear state
        console.log('[Data Preservation] ✅ Update completed successfully. All user data preserved in:', persistentUserDataPath);
        clearUpdaterState();
    } else if (recentAttempt) {
        console.log('[Updater] Recent install attempt detected; deferring update checks to avoid loop');
        // Defer scheduling initial checks for this session; user can retry later or manual download
        updaterActive = false;
        return;
    }

        autoUpdater.on('checking-for-update', () => {
            console.log('[Updater] Checking for updates...');
            try {
                if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
                    if (mainWindow.webContents.isLoading()) {
                        mainWindow.webContents.once('did-finish-load', () => {
                            mainWindow.webContents.send('update-checking', {});
                        });
                    } else {
                        mainWindow.webContents.send('update-checking', {});
                    }
                }
            } catch(_) {}
        });

        autoUpdater.on('update-available', (info) => {
            const version = info?.version || 'unknown';
            console.log('[Updater] Update available:', version, 'Current:', app.getVersion());

            // Determine URL based on platform/arch
            let downloadUrl = 'https://github.com/ayman708-UX/PlayTorrio/releases/latest';
            
            if (process.platform === 'win32') {
                downloadUrl = 'https://github.com/ayman708-UX/PlayTorrio/releases/latest/download/PlayTorrio-installer.exe';
            } else if (process.platform === 'linux') {
                // Default to AppImage
                 downloadUrl = 'https://github.com/ayman708-UX/PlayTorrio/releases/latest/download/PlayTorrio.AppImage';
            } else if (process.platform === 'darwin') {
                if (process.arch === 'arm64') {
                     downloadUrl = 'https://github.com/ayman708-UX/PlayTorrio/releases/latest/download/PlayTorrio-mac-arm64.dmg';
                } else {
                     downloadUrl = 'https://github.com/ayman708-UX/PlayTorrio/releases/latest/download/PlayTorrio-mac-x64.dmg';
                }
            }

            // Notify windows (Manual update flow)
            try {
                if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
                     mainWindow.webContents.send('update-available', { 
                        version, 
                        manual: true, 
                        downloadUrl 
                    });
                }
            } catch (_) {}
            
            // Show native notification on macOS
            if (process.platform === 'darwin') {
                const { Notification } = require('electron');
                if (Notification.isSupported()) {
                    const notification = new Notification({
                        title: 'PlayTorrio Update Available',
                        body: `Version ${version} is available. Click to download.`,
                        silent: false
                    });
                    notification.on('click', () => {
                        shell.openExternal(downloadUrl);
                    });
                    notification.show();
                }
            }
        });

        autoUpdater.on('update-not-available', (info) => {
            console.log('[Updater] No updates available. Current version is up-to-date:', app.getVersion(), 'Latest release (reported):', info?.version || 'unknown');
            try {
                if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
                    if (mainWindow.webContents.isLoading()) {
                        mainWindow.webContents.once('did-finish-load', () => {
                            mainWindow.webContents.send('update-not-available', info || {});
                        });
                    } else {
                        mainWindow.webContents.send('update-not-available', info || {});
                    }
                }
            } catch(_) {}
        });

        autoUpdater.on('error', (err) => {
            console.error('[Updater] Error:', err?.message || err);
            // Handle 404 errors (no releases yet) gracefully - don't crash
            if (err?.message?.includes('404') || err?.message?.includes('HttpError')) {
                console.log('[Updater] No releases found (404). This is normal for new repos.');
                return; // Don't retry, just continue running
            }
            // Retry on network errors after delay
            if (checkAttempts < maxRetries && (
                err?.message?.includes('net::') || 
                err?.message?.includes('ENOTFOUND') ||
                err?.message?.includes('timeout')
            )) {
                console.log(`[Updater] Network error detected, retrying in 30s...`);
                setTimeout(checkForUpdatesWithRetry, 30000);
            }
        });

        autoUpdater.on('download-progress', (progressObj) => {
            const pct = Math.round(progressObj?.percent || 0);
            const transferred = Math.round((progressObj?.transferred || 0) / 1024 / 1024);
            const total = Math.round((progressObj?.total || 0) / 1024 / 1024);
            console.log(`[Updater] Download progress: ${pct}% (${transferred}MB/${total}MB)`);
            
            try {
                if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
                    mainWindow.webContents.send('update-download-progress', {
                        percent: pct,
                        transferred: progressObj?.transferred,
                        total: progressObj?.total,
                        bytesPerSecond: progressObj?.bytesPerSecond
                    });
                }
            } catch(e) {
                console.error('[Updater] Failed to send progress to renderer:', e);
            }
        });

        autoUpdater.on('update-downloaded', async (info) => {
            if (process.platform === 'darwin') {
                // Should not happen because autoDownload=false on mac, but guard just in case
                const releasesUrl = 'https://github.com/ayman708-UX/PlayTorrio/releases/latest';
                console.log('[Updater] macOS: manual update required. Skipping auto-install.');
                try {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('update-available', {
                            ...(info || {}),
                            manual: true,
                            platform: 'darwin',
                            downloadUrl: releasesUrl,
                        });
                    }
                } catch(_) {}
                return;
            }
            
            // Prevent update loop: mark that we're installing (persisted)
            if (app.isQuitting || global.updateInstalling) {
                console.log('[Updater] Already installing/quitting, skipping duplicate install');
                return;
            }
            global.updateInstalling = true;
            writeUpdaterState({ lastInstallAttempt: Date.now(), targetVersion: info?.version || '' });
            
            console.log('[Updater] Update downloaded. Ready to install version:', info?.version || 'unknown', 'Current:', app.getVersion());
            try {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('update-downloaded', info || {});
                }
            } catch(_) {}
            // Start installer with UI; do not force run-after to reduce double-relaunch risk
            try {
                console.log('[Updater] Launching installer and quitting app...');
                // Small delay to allow renderer to show a toast before quitting
                setTimeout(() => {
                    // Note: Microservices no longer running - all handled by server.mjs
                    try { autoUpdater.quitAndInstall(false, false); } catch (e) {
                        console.error('[Updater] quitAndInstall failed:', e);
                        // As a fallback, force app to quit; installer will run on next start if needed
                        try { app.quit(); } catch(_) {}
                    }
                }, 1500);
            } catch (e) {
                console.error('[Updater] Failed to launch installer:', e);
            }
        });

        // Perform initial check with connectivity guard and retry logic
        let checkAttempts = 0;
        const maxRetries = 3;
        const checkForUpdatesWithRetry = () => {
            try {
                checkAttempts++;
                autoUpdater.checkForUpdates().catch((err) => {
                    console.error(`[Updater] checkForUpdates promise rejected:`, err?.message || err);
                    // 404 means no releases yet - this is OK, don't retry
                    if (err?.message?.includes('404')) {
                        console.log('[Updater] No releases available yet (404). App will continue normally.');
                        return;
                    }
                });
            } catch (e) {
                console.error(`[Updater] checkForUpdates failed (attempt ${checkAttempts}):`, e?.message || e);
                // 404 errors are expected when no releases exist - don't crash
                if (e?.message?.includes('404')) {
                    console.log('[Updater] Repository has no releases yet. This is normal.');
                    return;
                }
                if (checkAttempts < maxRetries) {
                    try { if (updaterTimers.retry) clearTimeout(updaterTimers.retry); } catch(_) {}
                    updaterTimers.retry = setTimeout(checkForUpdatesWithRetry, 10000); // Retry after 10s
                }
            }
        };

        const isOnline = async (timeoutMs = 1500) => {
            try {
                const p = dnsLookup('github.com');
                await Promise.race([
                    p,
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
                ]);
                return true;
            } catch (_) {
                return false;
            }
        };

        const scheduleInitialCheck = async () => {
            const online = await isOnline(1500);
            if (!online) {
                console.log('[Updater] Offline at startup, delaying update check...');
                try { if (updaterTimers.initial) clearTimeout(updaterTimers.initial); } catch(_) {}
                updaterTimers.initial = setTimeout(scheduleInitialCheck, 10000);
                return;
            }
            checkForUpdatesWithRetry();
        };
        try { if (updaterTimers.initial) clearTimeout(updaterTimers.initial); } catch(_) {}
        updaterTimers.initial = setTimeout(scheduleInitialCheck, 4000);
        updaterActive = true;
    } catch (e) {
        console.error('[Updater] setup failed:', e?.message || e);
    }
}

// ----------------------
// Cleanup old installers/caches after updates
// ----------------------
async function cleanupOldInstallersAndCaches() {
    try {
        const productName = app.getName ? app.getName() : 'PlayTorrio';
        const tempDir = app.getPath('temp');
        
        const pathsToRemove = [
            path.join(tempDir, productName) // any temp subdir we may have used
        ];
        
        // Platform-specific cleanup
        if (process.platform === 'win32') {
            const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
            pathsToRemove.push(path.join(localAppData, `${productName}-updater`)); // electron-updater cache dir
            
            // Clean electron-builder cache entries for this app only
            try {
                const ebCacheDir = path.join(localAppData, 'electron-builder', 'Cache');
                const entries = await fs.promises.readdir(ebCacheDir).catch(() => []);
                await Promise.all(entries.map(async (name) => {
                    const lower = name.toLowerCase();
                    const match = lower.includes(productName.toLowerCase()) && (lower.endsWith('.exe') || lower.endsWith('.yml') || lower.endsWith('.blockmap'));
                    if (match) {
                        try { await fs.promises.rm(path.join(ebCacheDir, name), { recursive: true, force: true }); } catch(_) {}
                    }
                }));
            } catch (_) {}

            // Also clear leftover cache folders commonly created by Electron under Local app data
            try {
                const productLocalDir = path.join(localAppData, productName);
                const maybeCaches = ['Cache', 'Code Cache', 'GPUCache', 'Pending', 'packages'];
                for (const sub of maybeCaches) {
                    try { await fs.promises.rm(path.join(productLocalDir, sub), { recursive: true, force: true }); } catch(_) {}
                }
            } catch (_) {}
        } else if (process.platform === 'darwin') {
            // macOS: Clean up caches in user's Library folder
            const userLibrary = path.join(os.homedir(), 'Library');
            const cacheDir = path.join(userLibrary, 'Caches', productName);
            pathsToRemove.push(cacheDir);
            pathsToRemove.push(path.join(userLibrary, 'Caches', `${productName}-updater`));
            
            // Clean electron-builder cache
            try {
                const ebCacheDir = path.join(userLibrary, 'Caches', 'electron-builder');
                const entries = await fs.promises.readdir(ebCacheDir).catch(() => []);
                await Promise.all(entries.map(async (name) => {
                    const lower = name.toLowerCase();
                    const match = lower.includes(productName.toLowerCase());
                    if (match) {
                        try { await fs.promises.rm(path.join(ebCacheDir, name), { recursive: true, force: true }); } catch(_) {}
                    }
                }));
            } catch (_) {}
        } else {
            // Linux: Clean up caches in ~/.cache
            const cacheDir = path.join(os.homedir(), '.cache', productName);
            pathsToRemove.push(cacheDir);
            pathsToRemove.push(path.join(os.homedir(), '.cache', `${productName}-updater`));
        }

        for (const p of pathsToRemove) {
            try {
                await fs.promises.rm(p, { recursive: true, force: true });
            } catch (e) {
                // ignore
            }
        }

        console.log('[Cleanup] Old installers and caches cleanup completed');
    } catch (e) {
        console.error('[Cleanup] Failed to cleanup old installers:', e?.message || e);
    }
}

// Ensure processes are terminated when updater begins quitting
app.on('before-quit-for-update', () => {
    // Note: Microservices no longer running - all handled by server.mjs on port 6987
});

// Function to clear the webtorrent temp folder
async function clearWebtorrentTemp() {
    try {
        // Get cache location from settings
        const userDataPath = app.getPath('userData');
        const settingsPath = path.join(userDataPath, 'user_settings.json');
        let cacheLocation = os.tmpdir();
        
        if (fs.existsSync(settingsPath)) {
            try {
                const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
                if (settings.cacheLocation) {
                    cacheLocation = settings.cacheLocation;
                }
            } catch (err) {
                console.error('Error reading settings:', err);
            }
        }
        
        const tempPath = path.join(cacheLocation, 'webtorrent');
        console.log(`Clearing webtorrent temp folder: ${tempPath}`);
        await fs.promises.rm(tempPath, { recursive: true, force: true });
        console.log('Webtorrent temp folder cleared successfully');
        return { success: true, message: 'Webtorrent temp folder cleared' };
    } catch (error) {
        console.error('Error clearing webtorrent temp folder:', error);
        return { success: false, message: 'Failed to clear webtorrent temp folder: ' + error.message };
    }
}

// Function to clear the downloaded subtitles temp folder (cross-user)
async function clearPlaytorrioSubtitlesTemp() {
    try {
        // Get cache location from settings
        const userDataPath = app.getPath('userData');
        const settingsPath = path.join(userDataPath, 'user_settings.json');
        let cacheLocation = os.tmpdir();
        
        if (fs.existsSync(settingsPath)) {
            try {
                const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
                if (settings.cacheLocation) {
                    cacheLocation = settings.cacheLocation;
                }
            } catch (err) {
                console.error('Error reading settings:', err);
            }
        }
        
        const subsPath = path.join(cacheLocation, 'playtorrio_subs');
        console.log(`Clearing subtitles temp folder: ${subsPath}`);
        await fs.promises.rm(subsPath, { recursive: true, force: true });
        console.log('Subtitles temp folder cleared successfully');
        return { success: true, message: 'Subtitles temp folder cleared' };
    } catch (error) {
        console.error('Error clearing subtitles temp folder:', error);
        return { success: false, message: 'Failed to clear subtitles temp folder: ' + error.message };
    }
}

// resolveMpvExe removed

function resolveSystemMpv(customPath = null) {
    // First check custom path from settings
    if (customPath && fs.existsSync(customPath)) {
        console.log('[MPV] Using custom path:', customPath);
        return customPath;
    }
    
    try {
        // Try 'mpv' in system PATH
        const checkCmd = process.platform === 'win32' ? 'where' : 'which';
        const result = spawnSync(checkCmd, ['mpv'], { encoding: 'utf8' });
        if (result.status === 0 && result.stdout.trim()) {
            return result.stdout.split('\r\n')[0].split('\n')[0].trim();
        }
        
        // Check common installation paths
        const candidates = [];
        if (process.platform === 'darwin') {
            candidates.push('/usr/local/bin/mpv', '/opt/homebrew/bin/mpv', '/Applications/mpv.app/Contents/MacOS/mpv');
        } else if (process.platform === 'win32') {
            candidates.push('C:\\Program Files\\mpv\\mpv.exe', 'C:\\Program Files (x86)\\mpv\\mpv.exe');
        } else {
            candidates.push('/usr/bin/mpv', '/usr/local/bin/mpv', '/snap/bin/mpv');
        }
        
        for (const p of candidates) {
            if (fs.existsSync(p)) return p;
        }
    } catch (e) {
        console.error('[MPV] Resolution error:', e.message);
    }
    return null;
}

async function openInStandaloneMPV(url, startSeconds = null) {
    // Read custom mpvPath from settings
    const settings = readMainSettings();
    const mpvPath = resolveSystemMpv(settings.mpvPath);
    if (!mpvPath) {
        console.warn('[MPV] System MPV not found');
        return { 
            success: false, 
            message: 'MPV player not found. Please install it globally (https://mpv.io) or set a custom path in Settings.' 
        };
    }
    
    const args = [];
    if (startSeconds && !isNaN(startSeconds) && startSeconds > 0) {
        args.push(`--start=${Math.floor(startSeconds)}`);
    }
    args.push(url);
    
    console.log('[MPV] Spawning standalone:', mpvPath, args);
    try {
        const mpvProcess = spawn(mpvPath, args, { stdio: 'ignore', detached: true });
        mpvProcess.unref();
        return { success: true };
    } catch (e) {
        return { success: false, message: 'Failed to launch MPV: ' + e.message };
    }
}


// Resolve VLC executable path (system-wide only)
function resolveVlcExe() {
    try {
        const candidates = [];
        const tried = new Set();
        const pushUnique = (p) => { if (p && !tried.has(p)) { candidates.push(p); tried.add(p); } };
        const envVlc = process.env.VLC_PATH;
        if (envVlc) {
            // User override via environment variable
            pushUnique(envVlc);
        }
        
        if (process.platform === 'darwin') {
            // macOS: System-wide fallback
            candidates.push('/Applications/VLC.app/Contents/MacOS/VLC');
        } else if (process.platform === 'win32') {
            // Windows: System installs and PortableApps
            const programFiles = process.env['ProgramFiles'] || 'C:/Program Files';
            const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)';
            const localAppData = process.env['LOCALAPPDATA'] || path.join(process.env['USERPROFILE'] || 'C:/Users/Default', 'AppData', 'Local');
            const portableAppsRoot = process.env['PORTABLEAPPS'] || path.join(process.env['USERPROFILE'] || 'C:/Users/Default', 'PortableApps');

            // Standard installer locations (VLC official)
            pushUnique(path.join(programFiles, 'VideoLAN', 'VLC', 'vlc.exe'));
            pushUnique(path.join(programFilesX86, 'VideoLAN', 'VLC', 'vlc.exe'));

            // Windows Store / sandboxed style (rare, but attempt)
            pushUnique(path.join(localAppData, 'Programs', 'VLC', 'vlc.exe'));
            pushUnique(path.join(localAppData, 'VideoLAN', 'VLC', 'vlc.exe'));

            // PortableApps structures
            pushUnique(path.join(portableAppsRoot, 'VLCPortable', 'App', 'vlc', 'vlc.exe'));
            pushUnique(path.join(portableAppsRoot, 'VLCPortable', 'VLCPortable.exe')); // Portable launcher

            // Environment variable override already added (envVlc)
            if (envVlc && envVlc.toLowerCase().endsWith('vlcportable.exe')) {
                // If user pointed to VLCPortable.exe, try deriving real vlc.exe path
                pushUnique(path.join(path.dirname(envVlc), 'App', 'vlc', 'vlc.exe'));
            }
        } else {
            // Linux: System-wide fallback
            pushUnique('/usr/bin/vlc');
            pushUnique('/usr/local/bin/vlc');
            pushUnique('/snap/bin/vlc');
            pushUnique('/flatpak/exports/bin/org.videolan.VLC');
        }

        console.log('[VLC] Searching for VLC in', candidates.length, 'unique locations...');
        for (const p of candidates) {
            try { 
                if (fs.existsSync(p)) {
                    if (p.toLowerCase().endsWith('vlcportable.exe')) {
                        // Prefer the real VLC binary bundled within PortableApps layout
                        const real = path.join(path.dirname(p), 'App', 'vlc', 'vlc.exe');
                        if (fs.existsSync(real)) {
                            console.log('[VLC] ✓ Found VLCPortable launcher; using embedded binary instead:', real);
                            return real;
                        }
                        return p;
                    }
                    console.log('[VLC] ✓ Found executable at:', p);
                    return p;
                }
            } catch {}
        }
        console.log('[VLC] ✗ Not found. First checked paths:', candidates.slice(0, 8).join(', '), '... total tried:', candidates.length);
    } catch (err) {
        console.error('[VLC] Resolver error:', err);
    }
    return null;
}

// ===================================================
// SPOTIFY/MUSIC HELPER FUNCTIONS
// ===================================================

function resolveYtdlpExe() {
    try {
        const candidates = [];
        const execDir = path.dirname(process.execPath);
        const resourcesPath = process.resourcesPath;

        if (process.platform === 'win32') {
            if (resourcesPath) {
                candidates.push(path.join(resourcesPath, 'app.asar.unpacked', 'windlp', 'yt-dlp.exe'));
                candidates.push(path.join(resourcesPath, 'windlp', 'yt-dlp.exe'));
            }
            candidates.push(path.join(execDir, 'windlp', 'yt-dlp.exe'));
            candidates.push(path.join(__dirname, 'windlp', 'yt-dlp.exe'));
        } else if (process.platform === 'darwin') {
            if (resourcesPath) {
                candidates.push(path.join(resourcesPath, 'app.asar.unpacked', 'macdlp', 'yt-dlp'));
                candidates.push(path.join(resourcesPath, 'macdlp', 'yt-dlp'));
            }
            candidates.push(path.join(execDir, 'macdlp', 'yt-dlp'));
            candidates.push(path.join(__dirname, 'macdlp', 'yt-dlp'));
        } else { // linux
            if (resourcesPath) {
                candidates.push(path.join(resourcesPath, 'app.asar.unpacked', 'linuxdlp', 'yt-dlp'));
                candidates.push(path.join(resourcesPath, 'linuxdlp', 'yt-dlp'));
            }
            candidates.push(path.join(execDir, 'linuxdlp', 'yt-dlp'));
            candidates.push(path.join(__dirname, 'linuxdlp', 'yt-dlp'));
        }

        for (const p of candidates) {
            try {
                if (fs.existsSync(p)) {
                    // On non-windows, ensure it's executable
                    if (process.platform !== 'win32') {
                        try { fs.chmodSync(p, 0o755); } catch (e) { console.error(`Failed to chmod yt-dlp at ${p}:`, e); }
                    }
                    return p;
                }
            } catch {}
        }
        console.warn('[YTDLP] yt-dlp executable not found in any of the candidates.');
    } catch (err) {
        console.error('[YTDLP] Resolver error:', err);
    }
    return null;
}


const formatDuration = (ms) => {
  if (!ms || isNaN(ms)) return '0:00';
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${min}:${sec.toString().padStart(2, '0')}`;
};

async function refreshSpotifyToken() {
  if (Date.now() < tokenExpiration - 60000 && spotifyToken) return;
  try {
    const response = await got.post(
      'https://accounts.spotify.com/api/token',
      {
        form: { grant_type: 'client_credentials' },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')
        },
        responseType: 'json'
      }
    );
    spotifyToken = response.body.access_token;
    tokenExpiration = Date.now() + response.body.expires_in * 1000;
    console.log('[Spotify] Token refreshed');
  } catch (error) {
    console.error('[Spotify] Token refresh failed:', error.message);
    // Don't throw, just log
  }
}

async function callSpotifyApi(url) {
  try {
    await refreshSpotifyToken();
    const response = await got(url, {
        headers: { Authorization: `Bearer ${spotifyToken}` },
        timeout: { request: 10000 },
        responseType: 'json'
    });
    return response.body;
  } catch (e) {
    console.error('[Spotify] API call failed:', e.message);
    return {};
  }
}

function formatTrack(track) {
  if (!track) return null;
  return {
    id: track.id,
    title: track.name,
    name: track.name,
    artists: track.artists?.map(a => a.name).join(', ') || 'Unknown Artist',
    channel: track.artists?.map(a => a.name).join(', ') || 'Unknown Artist',
    duration: formatDuration(track.duration_ms),
    albumArt: track.album?.images?.[0]?.url || '',
    thumbnail: track.album?.images?.[0]?.url || '',
    url: track.external_urls?.spotify || ''
  };
}

function formatAlbum(album) {
  if (!album) return null;
  return {
    id: album.id,
    name: album.name,
    artists: album.artists?.map(a => a.name).join(', ') || 'Unknown Artist',
    albumArt: album.images?.[0]?.url || '',
    releaseDate: album.release_date || '',
    totalTracks: album.total_tracks || 0,
    url: album.external_urls?.spotify || ''
  };
}

async function getYouTubeAudioUrl(searchQuery, trackId) {
    const cached = urlCache.get(trackId);
    if (cached && Date.now() < cached.expiry) {
        console.log('[YTMusic] Using cached URL for:', trackId);
        return cached.url;
    }

    const ytdlpPath = resolveYtdlpExe();
    if (!ytdlpPath) {
        console.error('[YTMusic] yt-dlp executable not found. Cannot search or stream.');
        return Promise.reject(new Error('yt-dlp executable not found.'));
    }

    console.log('[YTMusic] Searching:', searchQuery);

    return new Promise((resolve, reject) => {
        const args = [
            '--dump-single-json',
            '--no-check-certificates',
            '--no-warnings',
            '--prefer-free-formats',
            '--add-header', 'referer:https://music.youtube.com/',
            '--add-header', 'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            searchQuery
        ];

        execFile(ytdlpPath, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                console.error('[YTMusic] execFile error:', stderr);
                return reject(new Error(`yt-dlp failed: ${stderr}`));
            }

            try {
                const audioUrl = JSON.parse(stdout);
                let streamUrl = null;

                if (audioUrl.formats) {
                    const audioFormats = audioUrl.formats.filter(f =>
                        f.acodec && f.acodec !== 'none' &&
                        (!f.vcodec || f.vcodec === 'none') &&
                        f.url
                    );

                    if (audioFormats.length > 0) {
                        audioFormats.sort((a, b) => (b.abr || 0) - (a.abr || 0));
                        streamUrl = audioFormats[0].url;
                    } else {
                        const withAudio = audioUrl.formats.filter(f =>
                            f.acodec && f.acodec !== 'none' && f.url
                        );
                        if (withAudio.length > 0) {
                            withAudio.sort((a, b) => (b.abr || 0) - (a.abr || 0));
                            streamUrl = withAudio[0].url;
                        }
                    }
                }

                if (!streamUrl && audioUrl.url) {
                    streamUrl = audioUrl.url;
                }

                if (!streamUrl) {
                    throw new Error('Could not extract audio URL');
                }

                urlCache.set(trackId, {
                    url: streamUrl,
                    expiry: Date.now() + URL_CACHE_DURATION
                });
                resolve(streamUrl);

            } catch (parseError) {
                reject(new Error('Failed to parse yt-dlp output.'));
            }
        });
    });
}


let playerWindow = null;

function stopPlayback() {
    console.log('[Playback] Stopping playback and cleaning up...');
    
    // Reset Discord RPC
    try {
        if (discordRpc && discordRpcReady) {
            discordRpc.setActivity({
                details: 'Browsing PlayTorrio',
                startTimestamp: new Date(),
                largeImageKey: 'icon',
                largeImageText: 'PlayTorrio App',
                buttons: [
                    { label: 'Download App', url: 'https://github.com/ayman708-UX/PlayTorrio' }
                ]
            });
        }
    } catch(e) {}

    // Destroy torrent-stream engines
    if (global.activeTorrents && global.activeTorrents.size > 0) {
        try {
            console.log(`[Playback] Destroying ${global.activeTorrents.size} active torrent engines...`);
            for (const [hash, engine] of global.activeTorrents.entries()) {
                try {
                    engine.destroy();
                } catch(e) {
                    console.error('[Playback] Error destroying torrent engine:', e);
                }
            }
            global.activeTorrents.clear();
        } catch(e) {
            console.error('[Playback] Error clearing torrent engines:', e);
        }
    }
}

// Launch HTML5 Player (Overlay Window)
function openInHtml5Player(win, streamUrl, startSeconds, metadata = {}) {
    try {
        console.log('[HTML5] Opening player overlay...');
        
        if (!mainWindow || mainWindow.isDestroyed()) {
             return { success: false, message: 'Main window not available' };
        }
        
        if (playerWindow && !playerWindow.isDestroyed()) {
            playerWindow.show();
            playerWindow.focus();
            return { success: true };
        }

        const bounds = mainWindow.getBounds();

        playerWindow = new BrowserWindow({
            parent: mainWindow,
            modal: false,
            show: false,
            frame: false, // Frameless
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            backgroundColor: '#000000',
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                webSecurity: false
            }
        });

        // Sync movement/resize
        let isSyncing = false;
        const syncToPlayer = () => {
            if (isSyncing) return;
            if (playerWindow && !playerWindow.isDestroyed() && !playerWindow.isFullScreen()) {
                isSyncing = true;
                playerWindow.setBounds(mainWindow.getBounds());
                isSyncing = false;
            }
        };
        const syncToMain = () => {
            if (isSyncing) return;
            if (mainWindow && !mainWindow.isDestroyed() && !playerWindow.isFullScreen()) {
                isSyncing = true;
                mainWindow.setBounds(playerWindow.getBounds());
                isSyncing = false;
            }
        };

        mainWindow.on('move', syncToPlayer);
        mainWindow.on('resize', syncToPlayer);
        
        playerWindow.on('move', syncToMain);
        playerWindow.on('resize', syncToMain);

        playerWindow.on('closed', () => {
            mainWindow.removeListener('move', syncToPlayer);
            mainWindow.removeListener('resize', syncToPlayer);
            
            // Cleanup torrent stream ONLY if it was a local stream AND in Basic Mode
            // BUT skip cleanup if we're doing a same-torrent episode transition
            if (metadata.isBasicMode && streamUrl && (streamUrl.includes('/api/stream-file') || streamUrl.includes('/api/alt-stream-file'))) {
                try {
                    const urlObj = new URL(streamUrl);
                    const hash = urlObj.searchParams.get('hash');
                    if (hash) {
                        // Check if we should skip cleanup (same torrent transition)
                        if (skipTorrentCleanupHash === hash || skipTorrentCleanupHash === 'pending') {
                            console.log(`[Cleanup] Skipping cleanup for ${hash} (same torrent episode transition)`);
                            skipTorrentCleanupHash = null; // Reset the flag
                        } else {
                            const isAltEngine = streamUrl.includes('/api/alt-stream-file');
                            const endpoint = isAltEngine ? '/api/alt-stop-stream' : '/api/stop-stream';
                            console.log(`[Cleanup] Basic Mode player closed, stopping local stream: ${hash}${isAltEngine ? ' (alt engine)' : ''}`);
                            fetch(`http://localhost:6987${endpoint}?hash=${hash}`).catch(() => {});
                        }
                    }
                } catch (e) {
                    console.error('[Cleanup] Failed to parse streamUrl for cleanup:', e.message);
                }
            }

            playerWindow = null;
        });

        const params = new URLSearchParams();
        if (streamUrl) params.append('url', streamUrl);
        if (startSeconds) params.append('t', startSeconds);
        if (metadata.tmdbId) params.append('tmdbId', metadata.tmdbId);
        if (metadata.imdbId) params.append('imdbId', metadata.imdbId);
        if (metadata.seasonNum) params.append('season', metadata.seasonNum);
        if (metadata.episodeNum) params.append('episode', metadata.episodeNum);
        if (metadata.type) params.append('type', metadata.type);
        if (metadata.isDebrid) params.append('isDebrid', '1');
        if (metadata.isBasicMode) params.append('isBasicMode', '1');
        if (metadata.showName) params.append('showName', metadata.showName);
        if (metadata.provider) params.append('provider', metadata.provider);
        if (metadata.providerUrl) params.append('providerUrl', metadata.providerUrl);
        if (metadata.quality) params.append('quality', metadata.quality);

        const playerUrl = `http://localhost:6987/player.html?${params.toString()}`;
        console.log('[HTML5] Loading:', playerUrl);
        
        playerWindow.loadURL(playerUrl);
        
        playerWindow.once('ready-to-show', () => {
            playerWindow.show();
            playerWindow.focus();
        });
        
        // Enable DevTools with F12 or Ctrl+Shift+I
        playerWindow.webContents.on('before-input-event', (event, input) => {
            if (input.key === 'F12' || (input.control && input.shift && input.key === 'I')) {
                playerWindow.webContents.toggleDevTools();
            }
        });

        // Handle Escape to exit fullscreen/close via IPC from renderer
        // (Handled in player.html script)

        // Update Discord RPC
        try {
            if (discordRpc && discordRpcReady) {
                discordRpc.setActivity({
                    details: metadata.title || 'Watching Video',
                    state: (metadata.seasonNum && metadata.episodeNum) ? `S${metadata.seasonNum}:E${metadata.episodeNum}` : 'Playing',
                    startTimestamp: new Date(),
                    largeImageKey: 'icon',
                    largeImageText: 'PlayTorrio Player',
                });
            }
        } catch(e) {}

        return { success: true, message: 'HTML5 player launched' };
    } catch (error) {
        console.error('[HTML5] Error launching player:', error);
        return { success: false, message: error.message };
    }
}

// ===== NodeMPV Player (Windows Only) =====
let mpvProcess = null;
let mpvWindow = null;
let mpvSocket = null;
let mpvStatusInterval = null;
let mpvWindowBoundsBeforeFullscreen = null; // Store bounds before fullscreen
let mpvIsFullscreen = false; // Track fullscreen state manually

// Launch NodeMPV Player - MPV embedded in Electron window with transparent UI overlay
function openInNodeMPVPlayer(win, streamUrl, startSeconds, metadata = {}) {
    if (process.platform !== 'win32') {
        console.log('[NodeMPV] Not Windows, falling back to HTML5');
        return openInHtml5Player(win, streamUrl, startSeconds, metadata);
    }
    
    try {
        console.log('[NodeMPV] Opening embedded MPV player...');
        
        // Close existing MPV window if any
        if (mpvWindow && !mpvWindow.isDestroyed()) {
            mpvWindow.close();
        }
        if (mpvProcess) {
            try { mpvProcess.kill(); } catch(e) {}
            mpvProcess = null;
        }
        if (mpvSocket) {
            try { mpvSocket.destroy(); } catch(e) {}
            mpvSocket = null;
        }

        // Create a NEW standalone window for the player (not child of main)
        mpvWindow = new BrowserWindow({
            width: 1280,
            height: 720,
            show: false,
            frame: false,
            transparent: true,
            backgroundColor: '#00000000',
            hasShadow: true,
            titleBarStyle: 'hidden',
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                webSecurity: false
            }
        });

        // Center on screen
        mpvWindow.center();

        mpvWindow.on('closed', () => {
            console.log('[NodeMPV] Window closed, cleaning up...');
            // Kill MPV process
            if (mpvProcess) {
                try { mpvProcess.kill(); } catch(e) {}
                mpvProcess = null;
            }
            if (mpvSocket) {
                try { mpvSocket.destroy(); } catch(e) {}
                mpvSocket = null;
            }
            if (mpvStatusInterval) {
                clearInterval(mpvStatusInterval);
                mpvStatusInterval = null;
            }
            
            // Reset fullscreen bounds
            mpvWindowBoundsBeforeFullscreen = null;
            mpvIsFullscreen = false;
            
            // Cleanup torrent stream if needed (supports both Stremio and alt engines)
            if (metadata.isBasicMode && streamUrl && (streamUrl.includes('/api/stream-file') || streamUrl.includes('/api/alt-stream-file'))) {
                try {
                    const urlObj = new URL(streamUrl);
                    const hash = urlObj.searchParams.get('hash');
                    if (hash && skipTorrentCleanupHash !== hash) {
                        const isAltEngine = streamUrl.includes('/api/alt-stream-file');
                        const endpoint = isAltEngine ? '/api/alt-stop-stream' : '/api/stop-stream';
                        console.log(`[Cleanup] Stopping torrent stream: ${hash}${isAltEngine ? ' (alt engine)' : ''}`);
                        fetch(`http://localhost:6987${endpoint}?hash=${hash}`).catch(() => {});
                    }
                } catch (e) {}
            }

            mpvWindow = null;
        });

        // Build URL params for the overlay UI
        const params = new URLSearchParams();
        if (streamUrl) params.append('url', streamUrl);
        if (startSeconds) params.append('t', startSeconds);
        if (metadata.tmdbId) params.append('tmdbId', metadata.tmdbId);
        if (metadata.imdbId) params.append('imdbId', metadata.imdbId);
        if (metadata.seasonNum) params.append('season', metadata.seasonNum);
        if (metadata.episodeNum) params.append('episode', metadata.episodeNum);
        if (metadata.type) params.append('type', metadata.type);
        if (metadata.isDebrid) params.append('isDebrid', '1');
        if (metadata.isBasicMode) params.append('isBasicMode', '1');
        if (metadata.showName) params.append('showName', metadata.showName);
        if (metadata.provider) params.append('provider', metadata.provider);
        if (metadata.providerUrl) params.append('providerUrl', metadata.providerUrl);
        if (metadata.quality) params.append('quality', metadata.quality);

        const playerUrl = `http://localhost:6987/nodempv/player.html?${params.toString()}`;
        console.log('[NodeMPV] Loading overlay:', playerUrl);
        
        mpvWindow.loadURL(playerUrl);
        
        mpvWindow.once('ready-to-show', () => {
            mpvWindow.show();
            mpvWindow.focus();
        });

        // DevTools
        mpvWindow.webContents.on('before-input-event', (event, input) => {
            if (input.key === 'F12' || (input.control && input.shift && input.key === 'I')) {
                mpvWindow.webContents.toggleDevTools();
            }
        });

        return { success: true, message: 'NodeMPV player launched' };
    } catch (error) {
        console.error('[NodeMPV] Error launching player:', error);
        return { success: false, message: error.message };
    }
}

// Find MPV executable
function findMpvPath() {
    // First check custom path from settings
    const settings = readMainSettings();
    if (settings.mpvPath && fs.existsSync(settings.mpvPath)) {
        console.log('[MPV] Using custom path from settings:', settings.mpvPath);
        return settings.mpvPath;
    }
    
    const possiblePaths = [
        'C:\\Program Files\\mpv\\mpv.exe',
        'C:\\Program Files (x86)\\mpv\\mpv.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'mpv', 'mpv.exe'),
        path.join(app.getPath('userData'), 'mpv', 'mpv.exe'),
        'mpv' // Try PATH
    ];
    
    for (const p of possiblePaths) {
        try {
            if (p === 'mpv') {
                // Check if mpv is in PATH
                const result = spawnSync('where', ['mpv'], { encoding: 'utf8' });
                if (result.status === 0 && result.stdout.trim()) {
                    return result.stdout.trim().split('\n')[0].trim();
                }
            } else if (fs.existsSync(p)) {
                return p;
            }
        } catch(e) {}
    }
    return null;
}

// Start MPV process embedded in the Electron window
async function startMpvProcess(videoUrl) {
    const mpvPath = findMpvPath();
    if (!mpvPath) {
        throw new Error('MPV not found. Please install MPV or set custom path in settings.');
    }
    
    if (!mpvWindow || mpvWindow.isDestroyed()) {
        throw new Error('Player window not available');
    }
    
    // Get the native window handle to embed MPV into
    const windowHandle = mpvWindow.getNativeWindowHandle();
    // Convert buffer to hex string for --wid parameter
    const hwnd = windowHandle.readUInt32LE(0);
    
    // Generate unique pipe name for IPC
    const pipeName = `\\\\.\\pipe\\mpv-playtorrio-${Date.now()}`;
    
    const args = [
        `--wid=${hwnd}`,           // EMBED MPV into Electron window!
        '--no-border',
        '--no-osc',
        '--no-osd-bar',
        '--osd-level=0',
        '--keep-open=yes',
        '--idle=no',
        `--input-ipc-server=${pipeName}`,
        '--hwdec=auto-safe',
        '--vo=gpu',
        '--gpu-api=d3d11',
        '--sid=no',                // Start with subtitles off, user can enable
        '--cursor-autohide=no',    // We handle cursor via Electron
        videoUrl
    ];
    
    console.log('[NodeMPV] Starting embedded MPV with hwnd:', hwnd);
    console.log('[NodeMPV] Command:', mpvPath, args.join(' '));
    
    mpvProcess = spawn(mpvPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
    });
    
    // Suppress MPV stdout spam (status line updates)
    mpvProcess.stdout.on('data', () => {});
    
    // Only log actual errors from stderr, not status messages
    mpvProcess.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        // Filter out status lines and only log real errors
        if (msg && !msg.startsWith('AV:') && !msg.startsWith('A:') && !msg.startsWith('V:') && !msg.includes('Cache:')) {
            console.log('[MPV]', msg);
        }
    });
    
    mpvProcess.on('error', (err) => {
        console.error('[NodeMPV] Process error:', err);
        if (mpvWindow && !mpvWindow.isDestroyed()) {
            mpvWindow.webContents.send('mpv-error', err.message);
        }
    });
    
    mpvProcess.on('exit', (code) => {
        console.log('[NodeMPV] Process exited with code:', code);
        mpvProcess = null;
        if (mpvWindow && !mpvWindow.isDestroyed()) {
            mpvWindow.close();
        }
    });
    
    // Wait for MPV to initialize and pipe to be ready
    await new Promise(r => setTimeout(r, 800));
    
    // Connect to MPV IPC
    try {
        const net = require('net');
        mpvSocket = net.connect(pipeName);
        
        mpvSocket.on('connect', () => {
            console.log('[NodeMPV] IPC connected');
            startMpvStatusPolling();
            // Hide spinner once connected
            if (mpvWindow && !mpvWindow.isDestroyed()) {
                mpvWindow.webContents.send('mpv-status', { loading: false });
            }
        });
        
        mpvSocket.on('data', (data) => {
            const lines = data.toString().split('\n').filter(l => l.trim());
            lines.forEach(line => {
                try {
                    const msg = JSON.parse(line);
                    handleMpvMessage(msg);
                } catch(e) {}
            });
        });
        
        mpvSocket.on('error', (err) => {
            console.error('[NodeMPV] IPC error:', err.message);
        });
    } catch(e) {
        console.error('[NodeMPV] Failed to connect IPC:', e);
    }
    
    return { success: true };
}

// Send command to MPV via IPC
let mpvRequestId = 0;
const mpvPendingRequests = new Map();

function sendMpvCommand(command, callback) {
    if (!mpvSocket || mpvSocket.destroyed) return;
    const requestId = ++mpvRequestId;
    const msg = { command, request_id: requestId };
    if (callback) {
        mpvPendingRequests.set(requestId, callback);
    }
    mpvSocket.write(JSON.stringify(msg) + '\n');
}

// Handle MPV IPC messages
function handleMpvMessage(msg) {
    // Handle property responses
    if (msg.request_id !== undefined && mpvPendingRequests.has(msg.request_id)) {
        const callback = mpvPendingRequests.get(msg.request_id);
        mpvPendingRequests.delete(msg.request_id);
        if (callback) callback(msg.error ? null : msg.data);
        return;
    }
    
    // Handle events
    if (msg.event === 'end-file') {
        if (mpvWindow && !mpvWindow.isDestroyed()) {
            mpvWindow.webContents.send('mpv-ended');
        }
    } else if (msg.event === 'property-change') {
        // Handle observed property changes
        if (mpvWindow && !mpvWindow.isDestroyed()) {
            const status = {};
            if (msg.name === 'duration') status.duration = msg.data;
            else if (msg.name === 'time-pos') status.position = msg.data;
            else if (msg.name === 'pause') status.paused = msg.data;
            else if (msg.name === 'volume') status.volume = msg.data;
            else if (msg.name === 'mute') status.muted = msg.data;
            else if (msg.name === 'paused-for-cache') status.buffering = msg.data;  // True when buffering
            else if (msg.name === 'seeking') status.buffering = msg.data;  // Also show spinner when seeking
            else if (msg.name === 'track-list') {
                // Parse audio and subtitle tracks
                const tracks = msg.data || [];
                status.audioTracks = tracks.filter(t => t.type === 'audio').map(t => ({
                    id: t.id,
                    title: t.title || t.lang || `Track ${t.id}`,
                    lang: t.lang,
                    codec: t.codec
                }));
                status.subtitleTracks = tracks.filter(t => t.type === 'sub').map(t => ({
                    id: t.id,
                    title: t.title || t.lang || `Track ${t.id}`,
                    lang: t.lang,
                    codec: t.codec
                }));
            }
            else if (msg.name === 'aid') status.currentAudioTrack = msg.data;
            else if (msg.name === 'sid') status.currentSubTrack = msg.data;
            
            if (Object.keys(status).length > 0) {
                mpvWindow.webContents.send('mpv-status', status);
            }
        }
    }
}

// Poll MPV status
function startMpvStatusPolling() {
    if (mpvStatusInterval) clearInterval(mpvStatusInterval);
    
    // Observe properties for real-time updates
    sendMpvCommand(['observe_property', 1, 'duration']);
    sendMpvCommand(['observe_property', 2, 'time-pos']);
    sendMpvCommand(['observe_property', 3, 'pause']);
    sendMpvCommand(['observe_property', 4, 'volume']);
    sendMpvCommand(['observe_property', 5, 'mute']);
    sendMpvCommand(['observe_property', 6, 'paused-for-cache']);  // Buffering indicator
    sendMpvCommand(['observe_property', 7, 'track-list']);
    sendMpvCommand(['observe_property', 8, 'aid']);
    sendMpvCommand(['observe_property', 9, 'seeking']);  // Seeking indicator
    sendMpvCommand(['observe_property', 10, 'sid']);     // Current subtitle track
}

// Launch IINA on macOS (preferred for mac users)
function openInIINA(win, streamUrl, infoHash, startSeconds) {
    try {
        if (process.platform !== 'darwin') {
            return { success: false, message: 'IINA is only available on macOS' };
        }
        
        console.log('Attempting to launch IINA with URL:', streamUrl);
        
        // Check if IINA is installed
        const checkIINA = spawnSync('mdfind', ['kMDItemKind==Application&&kMDItemFSName==IINA.app']);
        if (!checkIINA.stdout || checkIINA.stdout.toString().trim() === '') {
            console.error('IINA not found on system');
            return { success: false, message: 'IINA not installed. Please download it from https://iina.io' };
        }
        
        const args = ['-a', 'IINA'];
        
        // Add start time if provided
        const start = Number(startSeconds || 0);
        if (!isNaN(start) && start > 10) {
            args.push('--args', `--mpv-start=+${Math.floor(start)}`);
        }
        
        args.push(streamUrl);
        
        const iinaProcess = spawn('open', args, { stdio: 'ignore', detached: true });

        iinaProcess.on('close', async (code) => {
            console.log(`IINA player closed with code ${code}.`);
            // Clear Discord presence when IINA closes
            try {
                if (discordRpc && discordRpcReady) {
                    await discordRpc.setActivity({
                        details: 'Browsing PlayTorrio',
                        startTimestamp: new Date(),
                        largeImageKey: 'icon',
                        largeImageText: 'PlayTorrio App',
                        buttons: [
                            { label: 'Download App', url: 'https://github.com/ayman708-UX/PlayTorrio' }
                        ]
                    });
                }
            } catch (err) {
                console.error('[Discord RPC] Failed to clear on IINA close:', err);
            }
            try { win.webContents.send('iina-closed', { infoHash, code }); } catch(_) {}
        });

        iinaProcess.on('error', (err) => {
            console.error('Failed to start IINA process:', err);
        });
        
        // Unref so it doesn't keep the parent process alive
        iinaProcess.unref();

        return { success: true, message: 'IINA launched successfully' };
    } catch (error) {
        console.error('Error launching IINA:', error);
        return { success: false, message: 'Failed to launch IINA: ' + error.message };
    }
}

// Launch VLC and set up cleanup listeners
function openInVLC(win, streamUrl, infoHash, startSeconds) {
    try {
        console.log('Attempting to launch VLC with URL:', streamUrl);
        const vlcPath = resolveVlcExe();
        if (!vlcPath) {
            const msg = 'VLC not found. Please install VLC Media Player system-wide to use this feature.';
            console.error(msg);
            return { success: false, message: msg };
        }
        const args = [];
        const start = Number(startSeconds || 0);
        if (!isNaN(start) && start > 10) {
            // VLC start time in seconds
            args.push(`--start-time=${Math.floor(start)}`);
        }
        args.push(streamUrl);
        const vlcProcess = spawn(vlcPath, args, { stdio: 'ignore' });

        vlcProcess.on('close', async (code) => {
            console.log(`VLC player closed with code ${code}.`);
            // Clear Discord presence when VLC closes
            try {
                if (discordRpc && discordRpcReady) {
                    await discordRpc.setActivity({
                        details: 'Browsing PlayTorrio',
                        startTimestamp: new Date(),
                        largeImageKey: 'icon',
                        largeImageText: 'PlayTorrio App',
                        buttons: [
                            { label: 'Download App', url: 'https://github.com/ayman708-UX/PlayTorrio' }
                        ]
                    });
                }
            } catch (err) {
                console.error('[Discord RPC] Failed to clear on VLC close:', err);
            }
            try { win.webContents.send('vlc-closed', { infoHash, code }); } catch(_) {}
        });

        vlcProcess.on('error', (err) => {
            console.error('Failed to start VLC process:', err);
        });

        return { success: true, message: 'VLC launched successfully' };
    } catch (error) {
        console.error('Error launching VLC:', error);
        return { success: false, message: 'Failed to launch VLC: ' + error.message };
    }
}

// Migrate localStorage from default partition to persist:playtorrio partition
async function migrateLocalStorageIfNeeded() {
    try {
        const { session } = require('electron');
        const migrationFlagPath = path.join(app.getPath('userData'), '.localStorage_migrated');
        
        // Check if migration already done
        if (fs.existsSync(migrationFlagPath)) {
            console.log('[Migration] localStorage already migrated, skipping');
            return;
        }
        
        // Skip migration on Linux if shared memory is unavailable (Steam Deck, etc.)
        if (process.platform === 'linux') {
            console.log('[Migration] Skipping localStorage migration on Linux due to potential shared memory issues');
            fs.writeFileSync(migrationFlagPath, Date.now().toString());
            return;
        }
        
        console.log('[Migration] Checking for localStorage data to migrate...');
        
        // Keys to migrate (playlists and downloaded music)
        const keysToMigrate = ['pt_playlists_v1', 'pt_downloaded_music_v1'];
        
        // Access default partition storage
        const defaultPartition = session.defaultSession;
        const newPartition = session.fromPartition('persist:playtorrio', { cache: true });
        
        // Read from default partition using executeJavaScript in hidden window
        const tempWin = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false } });
        await tempWin.loadURL('data:text/html,<html></html>');
        
        const oldData = await tempWin.webContents.executeJavaScript(`
            const data = {};
            ${JSON.stringify(keysToMigrate)}.forEach(key => {
                const val = localStorage.getItem(key);
                if (val) data[key] = val;
            });
            data;
        `);
        
        tempWin.close();
        
        if (Object.keys(oldData).length === 0) {
            console.log('[Migration] No old localStorage data found');
            fs.writeFileSync(migrationFlagPath, Date.now().toString());
            return;
        }
        
        console.log('[Migration] Found data, copying to new partition:', Object.keys(oldData));
        
        // Write to new partition
        const newWin = new BrowserWindow({ show: false, webPreferences: { partition: 'persist:playtorrio' } });
        await newWin.loadURL('data:text/html,<html></html>');
        
        await newWin.webContents.executeJavaScript(`
            const data = ${JSON.stringify(oldData)};
            for (const [key, val] of Object.entries(data)) {
                localStorage.setItem(key, val);
            }
        `);
        
        newWin.close();
        
        // Mark migration complete
        fs.writeFileSync(migrationFlagPath, Date.now().toString());
        console.log('[Migration] localStorage migration complete');
    } catch (err) {
        console.error('[Migration] Failed to migrate localStorage:', err);
        // Don't block app startup on migration failure
    }
}

function getStartUrl() {
    let startUrl = 'http://localhost:6987/AdvancedMode/index.html'; // Default to Advanced Mode for 2.7.8
    try {
        const userDataPath = app.getPath('userData');
        const settingsPath = path.join(userDataPath, 'settings.json');
        
        // Force everyone to Advanced Mode for version 2.7.8 update
        const FORCE_ADVANCED_VERSION = '2.7.8';
        const currentVersion = app.getVersion();
        
        if (fs.existsSync(settingsPath)) {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            
            // Check if this is the first launch of 2.7.8 (force reset to advanced mode)
            if (currentVersion === FORCE_ADVANCED_VERSION && settings.lastVersion !== FORCE_ADVANCED_VERSION) {
                console.log('[Settings] Version 2.7.8 detected - switching all users to Advanced Mode');
                settings.preferredMode = 'advanced';
                settings.lastVersion = FORCE_ADVANCED_VERSION;
                fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
                startUrl = 'http://localhost:6987/AdvancedMode/index.html';
            } else {
                // Normal behavior - respect user preference
                if (settings.preferredMode === 'advanced') {
                    startUrl = 'http://localhost:6987/AdvancedMode/index.html';
                } else {
                    startUrl = 'http://localhost:6987/basicmode/index.html';
                }
                // Update lastVersion if needed
                if (settings.lastVersion !== currentVersion) {
                    settings.lastVersion = currentVersion;
                    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
                }
            }
        } else {
            // If settings don't exist, create default with advanced mode for 2.7.8
            const defaultSettings = { 
                preferredMode: 'advanced',
                lastVersion: currentVersion
            };
            fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, 2));
            console.log('[Settings] Created default settings with Advanced Mode');
        }
    } catch (e) {
        console.error('[Settings] Error reading preferred mode:', e.message);
    }
    return startUrl;
}

function createWindow() {
    const isMac = process.platform === 'darwin';
    const win = new BrowserWindow({
        width: 1440,
        height: 900,
        // Frameless on all platforms for custom title bar
        frame: false,
        titleBarStyle: 'hidden',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false, // Disable web security to allow iframes from different origins
            allowRunningInsecureContent: true, // Allow mixed content
            experimentalFeatures: true, // Enable experimental features for better iframe support
            spellcheck: false,
            backgroundThrottling: true,
            // Use persistent partition to preserve localStorage/IndexedDB across updates
            partition: 'persist:playtorrio',
            nativeWindowOpen: false
        },
        backgroundColor: '#120a1f',
    });

    // Add keyboard shortcut for DevTools
    win.webContents.on('before-input-event', (event, input) => {
        if ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i') {
            win.webContents.toggleDevTools();
            event.preventDefault();
        }
        if (input.key === 'F12') {
            win.webContents.toggleDevTools();
            event.preventDefault();
        }
    });

    // Remove default application menu (File/Edit/View/Help)
    try { Menu.setApplicationMenu(null); } catch(_) {}

    // Enable all permissions for iframe content
    win.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
        // Allow all permissions (autoplay, media, etc.)
        callback(true);
    });

    // Helper: allow-list for external reader/login domains
    const ALLOWED_POPUP_HOSTS = new Set([
        'reader.z-lib.gd',
        'reader.z-library.sk',
        'reader.z-lib.fm',
        'adfgetlink.net' // Allowed for Phoenix streams
    ]);
    const isAllowedDomain = (url) => {
        try {
            const { hostname } = new URL(url);
            const h = hostname.toLowerCase();
            if (ALLOWED_POPUP_HOSTS.has(h)) return true;
            // Allow SingleLogin for auth redirects if reader requires it
            if (h.includes('singlelogin')) return true;
            return false;
        } catch (_) { return false; }
    };

    // Intercept new windows (target=_blank) and open allowed domains externally
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (isAllowedDomain(url)) {
            console.log('[Popup] Opening allowed URL in external browser:', url);
            try { shell.openExternal(url); } catch(_) {}
            return { action: 'deny' };
        }
        console.log('Blocked popup attempt:', url);
        return { action: 'deny' };
    });

    // Prevent navigation away from the app, but open allowed reader domains externally
    win.webContents.on('will-navigate', (event, url) => {
        if (url.startsWith('http://127.0.0.1:6987') || url.startsWith('http://localhost:6987')) {
            return; // internal app navigation
        }
        if (isAllowedDomain(url)) {
            event.preventDefault();
            console.log('[Books] Opening reader via navigation in external browser:', url);
            try { shell.openExternal(url); } catch(_) {}
            return;
        }
        console.log('Blocked navigation attempt:', url);
        event.preventDefault();
    });

    // Allow iframes to load
    win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': ['default-src * \'unsafe-inline\' \'unsafe-eval\' data: blob:;']
            }
        });
    });
    
    // Log loading events for debugging
    win.webContents.on('did-start-loading', () => {
        console.log('[Window] Started loading...');
    });
    
    win.webContents.on('did-finish-load', () => {
        console.log('[Window] Finished loading successfully');
    });
    
    win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        console.error('[Window] Failed to load:', errorCode, errorDescription, validatedURL);
        
        // Don't retry if it's an iframe that failed (like iptvplaytorrio.pages.dev)
        // Only retry if the main app URL (localhost:6987) fails
        const isMainAppUrl = validatedURL.includes('localhost:6987');
        
        // -3 is ERR_ABORTED (user navigated away)
        // -27 is ERR_BLOCKED_BY_RESPONSE (CORS/iframe block - ignore these)
        if (isMainAppUrl && errorCode !== -3 && errorCode !== -27) {
            setTimeout(() => {
                if (win && !win.isDestroyed()) {
                    console.log('[Window] Retrying load after failure...');
                    win.loadURL(getStartUrl()).catch(e => {
                        console.error('[Window] Retry failed:', e);
                    });
                }
            }, 2000);
        }
    });

    // Wait for server to be ready before loading
    const loadWhenReady = async () => {
        const maxAttempts = 30;
        const delay = 500;
        
        console.log('[Window] Waiting for server to be ready...');
        
        const startUrl = getStartUrl();
        console.log('[Window] Target Start URL:', startUrl);
        
        for (let i = 0; i < maxAttempts; i++) {
            try {
                const response = await got('http://localhost:6987', { 
                    timeout: { request: 2000 }, 
                    retry: { limit: 0 },
                    throwHttpErrors: false 
                });
                if (response.statusCode === 200) {
                    console.log('[Window] Server ready, loading UI...');
                    
                    // Ensure window is ready to load
                    if (win && !win.isDestroyed()) {
                        try {
                            await win.loadURL(startUrl);
                            console.log('[Window] UI loaded successfully');
                            return;
                        } catch (loadErr) {
                            console.error('[Window] Failed to load URL:', loadErr);
                            // Retry once
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            await win.loadURL(startUrl);
                            return;
                        }
                    } else {
                        console.error('[Window] Window destroyed before loading');
                        return;
                    }
                }
            } catch (err) {
                console.log(`[Window] Server check attempt ${i + 1}/${maxAttempts}: ${err.message}`);
                if (i < maxAttempts - 1) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        
        // Fallback: load anyway after timeout
        console.warn('[Window] Server did not respond after 15s, attempting to load anyway...');
        if (win && !win.isDestroyed()) {
            try {
                await win.loadURL(startUrl);
            } catch (err) {
                console.error('[Window] Failed to load URL in fallback:', err);
            }
        }
    };
    
    // Start loading with error handling
    loadWhenReady().catch((err) => {
        console.error('[Window] loadWhenReady failed:', err);
        // Last resort: try to load after delay
        setTimeout(() => {
            if (win && !win.isDestroyed()) {
                console.log('[Window] Final attempt to load URL...');
                win.loadURL(getStartUrl()).catch(e => {
                    console.error('[Window] Final load attempt failed:', e);
                });
            }
        }, 2000);
    });
    
// initPlayer(win, mpvPath); // Removed for HTML5 player

    // Ensure closing the window triggers app shutdown
    win.on('close', (e) => {
        if (!cleanupComplete) {
            console.log('[Window] Close requested; starting graceful shutdown...');
            e.preventDefault();
            performGracefulShutdown();
        }
    });

    win.on('closed', () => {
        try { mainWindow = null; } catch(_) {}
    });
    
    return win;
}

// Basic settings read/write for main (aligns with server.mjs using settings.json)
function readMainSettings() {
    try {
        const p = path.join(app.getPath('userData'), 'settings.json');
        if (fs.existsSync(p)) {
            return JSON.parse(fs.readFileSync(p, 'utf8')) || {};
        }
    } catch(_) {}
    return {};
}
function writeMainSettings(next) {
    try {
        const p = path.join(app.getPath('userData'), 'settings.json');
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, JSON.stringify(next || {}, null, 2));
        return true;
    } catch(_) { return false; }
}

// Launch the Torrentless scraper server
function startTorrentless() {
    try {
        // Resolve script path in both dev and packaged environments (prefer resources/Torrentless/server.js in build)
        const candidates = [];
        if (app.isPackaged && process.resourcesPath) {
            candidates.push(path.join(process.resourcesPath, 'Torrentless', 'server.js'));
            candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'Torrentless', 'server.js'));
        }
        candidates.push(path.join(__dirname, 'Torrentless', 'server.js'));
        // Back-compat extra candidates
        if (process.resourcesPath) {
            candidates.push(path.join(process.resourcesPath, 'Torrentless', 'start.js'));
            candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'Torrentless', 'start.js'));
        }
        let entry = null;
        for (const p of candidates) {
            try { if (p && fs.existsSync(p)) { entry = p; break; } } catch {}
        }
        if (!entry) {
            console.warn('Torrentless server entry not found. Ensure the Torrentless folder is packaged.');
            return;
        }
        // Compute NODE_PATH so the child can resolve dependencies from the app's node_modules
        const nodePathCandidates = [
            path.join(process.resourcesPath || '', 'app.asar', 'node_modules'),
            path.join(process.resourcesPath || '', 'node_modules'),
            path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules'),
            path.join(__dirname, 'node_modules'),
            path.join(path.dirname(entry), 'node_modules'),
        ];
        const existingNodePaths = nodePathCandidates.filter(p => { try { return fs.existsSync(p); } catch { return false; } });
        const NODE_PATH_VALUE = existingNodePaths.join(path.delimiter);
        // Spawn Electron binary in Node mode to run server.js (equivalent to: node server.js)
        const logPath = path.join(app.getPath('userData'), 'torrentless.log');
        const logStream = fs.createWriteStream(logPath, { flags: 'a' });
        const childEnv = { ...process.env, PORT: '3002', ELECTRON_RUN_AS_NODE: '1', NODE_PATH: NODE_PATH_VALUE };
        torrentlessProc = spawn(process.execPath, [entry], {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: childEnv,
            cwd: path.dirname(entry),
        });

        // Pipe logs for diagnostics in packaged builds
        try {
            torrentlessProc.stdout.on('data', (d) => { try { logStream.write(d); } catch(_) {} });
            torrentlessProc.stderr.on('data', (d) => { try { logStream.write(d); } catch(_) {} });
        } catch (_) {}

        torrentlessProc.on('exit', (code, signal) => {
            console.log(`Torrentless exited code=${code} signal=${signal}`);
            try { logStream.end(); } catch(_) {}
            // On unexpected exit during runtime, attempt a single restart
            if (!app.isQuitting) {
                setTimeout(() => { try { startTorrentless(); } catch(_) {} }, 1000);
            }
        });

        torrentlessProc.on('error', (err) => {
            console.error('Failed to start Torrentless server process:', err);
            try { logStream.write(String(err?.stack || err) + '\n'); } catch(_) {}
        });

        // Probe /api/health to confirm the service is up; fallback to system Node if needed
        try {
            let attempts = 0;
            let healthy = false;
            const maxAttempts = 25; // ~10s @ 400ms
            const timer = setInterval(() => {
                attempts++;
                try {
                    const req = http.get({ hostname: '127.0.0.1', port: 3002, path: '/api/health', timeout: 350 }, (res) => {
                        if (res.statusCode === 200) {
                            healthy = true;
                            console.log('Torrentless is up on http://127.0.0.1:3002');
                            clearInterval(timer);
                            try { res.resume(); } catch(_) {}
                        } else {
                            try { res.resume(); } catch(_) {}
                        }
                    });
                    req.on('timeout', () => { try { req.destroy(); } catch(_) {} });
                    req.on('error', () => {});
                } catch(_) {}
                if (attempts >= maxAttempts) {
                    clearInterval(timer);
                    if (!healthy && !app.isQuitting) {
                        // Attempt fallback using system Node if available (dev only)
                        if (!app.isPackaged) {
                            try {
                                console.warn('Torrentless did not respond; attempting to start with system Node (dev)...');
                                // Stop previous child if any
                                try { torrentlessProc && torrentlessProc.kill('SIGTERM'); } catch(_) {}
                                const nodeCmd = process.platform === 'win32' ? 'node.exe' : 'node';
                                torrentlessProc = spawn(nodeCmd, [entry], {
                                    stdio: ['ignore', 'pipe', 'pipe'],
                                    env: { ...process.env, PORT: '3002' },
                                    cwd: path.dirname(entry),
                                    shell: false
                                });
                                try {
                                    torrentlessProc.stdout.on('data', (d) => { try { logStream.write(d); } catch(_) {} });
                                    torrentlessProc.stderr.on('data', (d) => { try { logStream.write(d); } catch(_) {} });
                                    torrentlessProc.on('error', (err) => {
                                        console.error('System Node fallback failed (Torrentless):', err?.message || err);
                                        try { logStream.write('System Node fallback error: ' + String(err?.stack || err) + '\n'); } catch(_) {}
                                    });
                                } catch(_) {}
                            } catch (e) {
                                console.error('Fallback start with system Node failed:', e);
                                try { logStream.write('Fallback failed: ' + String(e?.stack || e) + '\n'); } catch(_) {}
                            }
                        } else {
                            console.warn('Skipping system Node fallback in packaged build (Torrentless).');
                        }
                    }
                }
            }, 400);
        } catch(_) {}
    } catch (e) {
        console.error('Failed to start Torrentless server:', e);
    }
}

function start111477() {
    try {
        const candidates = [];
        // In packaged builds, prefer resources locations first (avoid running from inside asar)
        if (app.isPackaged && process.resourcesPath) {
            candidates.push(path.join(process.resourcesPath, '111477', 'src', 'index.js'));
            candidates.push(path.join(process.resourcesPath, '111477', 'index.js'));
            candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', '111477', 'src', 'index.js'));
            candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', '111477', 'index.js'));
        }
        // Dev paths
        candidates.push(path.join(__dirname, '111477', 'src', 'index.js'));
        candidates.push(path.join(__dirname, '111477', 'index.js'));
        let entry = null;
        for (const p of candidates) {
            try { if (p && fs.existsSync(p)) { entry = p; break; } } catch {}
        }
        if (!entry) {
            console.warn('111477 server entry not found. Ensure the 111477 folder is packaged.');
            return;
        }
        console.log('[111477] Using entry:', entry);

        // Resolve NODE_PATH for child
        const nodePathCandidates = [
            path.join(process.resourcesPath || '', 'app.asar', 'node_modules'),
            path.join(process.resourcesPath || '', 'node_modules'),
            path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules'),
            path.join(__dirname, 'node_modules'),
            // node_modules next to entry dir (covers dev when src/node_modules exists)
            path.join(path.dirname(entry), 'node_modules'),
            // node_modules in parent of src (packaged extraResources: 111477/node_modules)
            path.join(path.dirname(path.dirname(entry)), 'node_modules'),
        ];
        const existingNodePaths = nodePathCandidates.filter(p => { try { return fs.existsSync(p); } catch { return false; } });
        const NODE_PATH_VALUE = existingNodePaths.join(path.delimiter);

        // Spawn electron binary as node
        const logPath = path.join(app.getPath('userData'), '111477.log');
        const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    const childEnv = { ...process.env, PORT: '3003', ELECTRON_RUN_AS_NODE: '1', NODE_PATH: NODE_PATH_VALUE, TMDB_API_KEY: 'c3515fdc674ea2bd7b514f4bc3616a4a' };
        svc111477Proc = spawn(process.execPath, [entry], {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: childEnv,
            cwd: path.dirname(entry),
        });

        try {
            svc111477Proc.stdout.on('data', (d) => { try { logStream.write(d); } catch(_) {} });
            svc111477Proc.stderr.on('data', (d) => { try { logStream.write(d); } catch(_) {} });
        } catch (_) {}

        svc111477Proc.on('exit', (code, signal) => {
            console.log(`111477 exited code=${code} signal=${signal}`);
            try { logStream.end(); } catch(_) {}
            if (!app.isQuitting) {
                setTimeout(() => { try { start111477(); } catch(_) {} }, 1000);
            }
        });

        svc111477Proc.on('error', (err) => {
            console.error('Failed to start 111477 server process:', err);
            try { logStream.write(String(err?.stack || err) + '\n'); } catch(_) {}
        });

        // Health probe
        try {
            let attempts = 0;
            let healthy = false;
            const maxAttempts = 25;
            const timer = setInterval(() => {
                attempts++;
                try {
                    const req = http.get({ hostname: '127.0.0.1', port: 3003, path: '/health', timeout: 350 }, (res) => {
                        if (res.statusCode === 200) {
                            healthy = true;
                            console.log('111477 is up on http://127.0.0.1:3003');
                            clearInterval(timer);
                            try { res.resume(); } catch(_) {}
                        } else {
                            try { res.resume(); } catch(_) {}
                        }
                    });
                    req.on('timeout', () => { try { req.destroy(); } catch(_) {} });
                    req.on('error', () => {});
                } catch(_) {}
                if (attempts >= maxAttempts) {
                    clearInterval(timer);
                    if (!healthy && !app.isQuitting) {
                        if (!app.isPackaged) {
                            try {
                                console.warn('111477 did not respond; attempting to start with system Node (dev)...');
                                try { svc111477Proc && svc111477Proc.kill('SIGTERM'); } catch(_) {}
                                const nodeCmd = process.platform === 'win32' ? 'node.exe' : 'node';
                                svc111477Proc = spawn(nodeCmd, [entry], {
                                    stdio: ['ignore', 'pipe', 'pipe'],
                                    env: { ...process.env, PORT: '3003', TMDB_API_KEY: 'c3515fdc674ea2bd7b514f4bc3616a4a' },
                                    cwd: path.dirname(entry),
                                    shell: false
                                });
                                try {
                                    svc111477Proc.stdout.on('data', (d) => { try { logStream.write(d); } catch(_) {} });
                                    svc111477Proc.stderr.on('data', (d) => { try { logStream.write(d); } catch(_) {} });
                                    svc111477Proc.on('error', (err) => {
                                        console.error('System Node fallback failed (111477):', err?.message || err);
                                        try { logStream.write('System Node fallback error: ' + String(err?.stack || err) + '\n'); } catch(_) {}
                                    });
                                } catch(_) {}
                            } catch (e) {
                                console.error('Fallback start with system Node failed (111477):', e);
                                try { logStream.write('Fallback failed: ' + String(e?.stack || e) + '\n'); } catch(_) {}
                            }
                        } else {
                            console.warn('111477 did not respond in time; restarting Electron-as-Node child (packaged)...');
                            try { svc111477Proc && svc111477Proc.kill('SIGTERM'); } catch(_) {}
                            setTimeout(() => { try { start111477(); } catch(_) {} }, 500);
                        }
                    }
                }
            }, 400);
        } catch(_) {}
    } catch (e) {
        console.error('Failed to start 111477 server:', e);
    }
}

// Launch the Books (Z-Library) search server
function startBooks() {
    try {
        // Resolve script path in both dev and packaged environments
        const candidates = [];
        if (app.isPackaged && process.resourcesPath) {
            candidates.push(path.join(process.resourcesPath, 'books', 'server.js'));
            candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'books', 'server.js'));
        }
        candidates.push(path.join(__dirname, 'books', 'server.js'));
        
        let entry = null;
        for (const p of candidates) {
            try { if (p && fs.existsSync(p)) { entry = p; break; } } catch {}
        }
        if (!entry) {
            console.warn('Books server entry not found. Ensure the books folder is packaged.');
            return;
        }
        console.log('[Books] Using entry:', entry);

        // Compute NODE_PATH so the child can resolve dependencies from the app's node_modules
        const nodePathCandidates = [
            path.join(process.resourcesPath || '', 'app.asar', 'node_modules'),
            path.join(process.resourcesPath || '', 'node_modules'),
            path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules'),
            path.join(__dirname, 'node_modules'),
            path.join(path.dirname(entry), 'node_modules'),
        ];
        const existingNodePaths = nodePathCandidates.filter(p => { try { return fs.existsSync(p); } catch { return false; } });
        const NODE_PATH_VALUE = existingNodePaths.join(path.delimiter);

        // Spawn Electron binary in Node mode to run server.js
        const logPath = path.join(app.getPath('userData'), 'books.log');
        const logStream = fs.createWriteStream(logPath, { flags: 'a' });
        const childEnv = { 
            ...process.env, 
            PORT: String(booksDesiredPort), 
            ELECTRON_RUN_AS_NODE: '1', 
            NODE_PATH: NODE_PATH_VALUE,
            // Force the Books server to use z-lib.gd as the primary/only mirror
            ZLIB_FORCE_DOMAIN: 'z-lib.gd'
        };
        booksProc = spawn(process.execPath, [entry], {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: childEnv,
            cwd: path.dirname(entry),
        });

        // Pipe logs for diagnostics
        try {
            booksProc.stdout.on('data', (d) => { try { logStream.write(d); } catch(_) {} });
            booksProc.stderr.on('data', (d) => { try { logStream.write(d); } catch(_) {} });
        } catch (_) {}

        booksProc.on('exit', (code, signal) => {
            console.log(`Books server exited code=${code} signal=${signal}`);
            try { logStream.end(); } catch(_) {}
            // On unexpected exit during runtime, attempt a single restart
            if (!app.isQuitting) {
                setTimeout(() => { try { startBooks(); } catch(_) {} }, 1000);
            }
        });

        booksProc.on('error', (err) => {
            console.error('Failed to start Books server process:', err);
            try { logStream.write(String(err?.stack || err) + '\n'); } catch(_) {}
        });

        // Probe /health to confirm the service is up
        try {
            let attempts = 0;
            let healthy = false;
            const maxAttempts = 25; // ~10s @ 400ms
            const timer = setInterval(() => {
                attempts++;
                try {
                    const req = http.get({ hostname: '127.0.0.1', port: booksDesiredPort, path: '/health', timeout: 350 }, (res) => {
                        if (res.statusCode === 200) {
                            healthy = true;
                            booksBaseUrl = `http://127.0.0.1:${booksDesiredPort}`;
                            console.log('Books server is up on ' + booksBaseUrl);
                            clearInterval(timer);
                            try { res.resume(); } catch(_) {}
                            try {
                                if (mainWindow && !mainWindow.isDestroyed()) {
                                    mainWindow.webContents.send('books-url', { url: booksBaseUrl });
                                }
                            } catch(_) {}
                        } else {
                            try { res.resume(); } catch(_) {}
                        }
                    });
                    req.on('timeout', () => { try { req.destroy(); } catch(_) {} });
                    req.on('error', () => {});
                } catch(_) {}
                if (attempts >= maxAttempts) {
                    clearInterval(timer);
                    if (!healthy && !app.isQuitting) {
                        // Try a different local port and restart the books server for reliability
                        const fallbackPorts = [43004, 53004];
                        const nextPort = fallbackPorts.find(p => p !== booksDesiredPort) || 43004;
                        console.warn(`[Books] Health check failed on port ${booksDesiredPort}. Retrying on port ${nextPort}...`);
                        try { booksProc && booksProc.kill('SIGTERM'); } catch(_) {}
                        booksDesiredPort = nextPort;
                        // Restart fresh
                        setTimeout(() => { try { startBooks(); } catch(_) {} }, 300);
                    }
                }
            }, 400);
        } catch(_) {}
    } catch (e) {
        console.error('Failed to start Books server:', e);
    }
}

// Start RandomBook server
function startRandomBook() {
    if (randomBookProc) {
        console.log('RandomBook server already running');
        return;
    }

    try {
        console.log('Starting RandomBook server...');
        
        // Resolve script path in both dev and packaged environments
        const candidates = [];
        if (app.isPackaged && process.resourcesPath) {
            candidates.push(path.join(process.resourcesPath, 'RandomBook', 'server.js'));
            candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'RandomBook', 'server.js'));
        }
        candidates.push(path.join(__dirname, 'RandomBook', 'server.js'));
        
        let entry = null;
        for (const p of candidates) {
            try { if (p && fs.existsSync(p)) { entry = p; break; } } catch {}
        }
        if (!entry) {
            console.warn('RandomBook server entry not found. Ensure the RandomBook folder is packaged.');
            return;
        }

        // Compute NODE_PATH so the child can resolve dependencies from the app's node_modules
        const nodePathCandidates = [
            path.join(process.resourcesPath || '', 'app.asar', 'node_modules'),
            path.join(process.resourcesPath || '', 'node_modules'),
            path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules'),
            path.join(__dirname, 'node_modules'),
            path.join(path.dirname(entry), 'node_modules'),
        ];
        const existingNodePaths = nodePathCandidates.filter(p => { try { return fs.existsSync(p); } catch { return false; } });
        const NODE_PATH_VALUE = existingNodePaths.join(path.delimiter);

        // Spawn Electron binary in Node mode to run server.js
        const logPath = path.join(app.getPath('userData'), 'randombook.log');
        const logStream = fs.createWriteStream(logPath, { flags: 'a' });
        const childEnv = { 
            ...process.env, 
            PORT: String(randomBookDesiredPort), 
            ELECTRON_RUN_AS_NODE: '1', 
            NODE_PATH: NODE_PATH_VALUE
        };
        randomBookProc = spawn(process.execPath, [entry], {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: childEnv,
            cwd: path.dirname(entry),
        });

        // Pipe logs for diagnostics
        try {
            randomBookProc.stdout.on('data', (d) => { try { logStream.write(d); } catch(_) {} });
            randomBookProc.stderr.on('data', (d) => { try { logStream.write(d); } catch(_) {} });
        } catch (_) {}

        randomBookProc.on('exit', (code, signal) => {
            console.log(`RandomBook server exited code=${code} signal=${signal}`);
            try { logStream.end(); } catch(_) {}
            // On unexpected exit during runtime, attempt a single restart
            if (!app.isQuitting) {
                setTimeout(() => { try { startRandomBook(); } catch(_) {} }, 1000);
            }
        });

        randomBookProc.on('error', (err) => {
            console.error('Failed to start RandomBook server process:', err);
            try { logStream.write(String(err?.stack || err) + '\n'); } catch(_) {}
        });

        // Test if the server is up by checking port response
        try {
            let attempts = 0;
            let healthy = false;
            const maxAttempts = 25; // ~10s @ 400ms
            const timer = setInterval(() => {
                attempts++;
                try {
                    const req = http.get({ hostname: '127.0.0.1', port: randomBookDesiredPort, path: '/', timeout: 350 }, (res) => {
                        if (res.statusCode === 200 || res.statusCode === 404) {
                            healthy = true;
                            randomBookBaseUrl = `http://127.0.0.1:${randomBookDesiredPort}`;
                            console.log('RandomBook server is up on ' + randomBookBaseUrl);
                            clearInterval(timer);
                            try { res.resume(); } catch(_) {}
                            try {
                                if (mainWindow && !mainWindow.isDestroyed()) {
                                    mainWindow.webContents.send('randombook-url', { url: randomBookBaseUrl });
                                }
                            } catch(_) {}
                        } else {
                            try { res.resume(); } catch(_) {}
                        }
                    });
                    req.on('timeout', () => { try { req.destroy(); } catch(_) {} });
                    req.on('error', () => {});
                } catch(_) {}
                if (attempts >= maxAttempts) {
                    clearInterval(timer);
                    if (!healthy && !app.isQuitting) {
                        console.warn(`[RandomBook] Failed to start server on port ${randomBookDesiredPort}`);
                    }
                }
            }, 400);
        } catch(_) {}
    } catch (e) {
        console.error('Failed to start RandomBook server:', e);
    }
}

// resolveMpvExe removed
// Start Anime (Nyaa) server
function startAnime() {
    if (animeProc) {
        console.log('Anime server already running');
        return;
    }

    try {
        console.log('Starting Anime server...');
        
        // Resolve script path in both dev and packaged environments
        const candidates = [];
        if (app.isPackaged && process.resourcesPath) {
            candidates.push(path.join(process.resourcesPath, 'anime', 'server.js'));
            candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'anime', 'server.js'));
        }
        candidates.push(path.join(__dirname, 'anime', 'server.js'));
        
        let entry = null;
        for (const p of candidates) {
            try { if (p && fs.existsSync(p)) { entry = p; break; } } catch {}
        }
        if (!entry) {
            console.warn('Anime server entry not found. Ensure the anime folder is packaged.');
            return;
        }

        // Compute NODE_PATH so the child can resolve dependencies from the app's node_modules
        const nodePathCandidates = [
            path.join(process.resourcesPath || '', 'app.asar', 'node_modules'),
            path.join(process.resourcesPath || '', 'node_modules'),
            path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules'),
            path.join(__dirname, 'node_modules'),
            path.join(path.dirname(entry), 'node_modules'),
        ];
        const existingNodePaths = nodePathCandidates.filter(p => { try { return fs.existsSync(p); } catch { return false; } });
        const NODE_PATH_VALUE = existingNodePaths.join(path.delimiter);

        // Spawn Electron binary in Node mode to run server.js
        const logPath = path.join(app.getPath('userData'), 'anime.log');
        const logStream = fs.createWriteStream(logPath, { flags: 'a' });
        const childEnv = { 
            ...process.env, 
            PORT: String(animeDesiredPort), 
            ELECTRON_RUN_AS_NODE: '1', 
            NODE_PATH: NODE_PATH_VALUE
        };
        animeProc = spawn(process.execPath, [entry], {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: childEnv,
            cwd: path.dirname(entry),
        });

        // Pipe logs for diagnostics
        try {
            animeProc.stdout.on('data', (d) => { try { logStream.write(d); } catch(_) {} });
            animeProc.stderr.on('data', (d) => { try { logStream.write(d); } catch(_) {} });
        } catch (_) {}

        animeProc.on('exit', (code, signal) => {
            console.log(`Anime server exited code=${code} signal=${signal}`);
            try { logStream.end(); } catch(_) {}
            // On unexpected exit during runtime, attempt a single restart
            if (!app.isQuitting) {
                setTimeout(() => { try { startAnime(); } catch(_) {} }, 1000);
            }
        });

        animeProc.on('error', (err) => {
            console.error('Failed to start Anime server process:', err);
            try { logStream.write(String(err?.stack || err) + '\n'); } catch(_) {}
        });

        // Probe /api/test to confirm the service is up
        try {
            let attempts = 0;
            let healthy = false;
            const maxAttempts = 25; // ~10s @ 400ms
            const timer = setInterval(() => {
                attempts++;
                try {
                    const req = http.get({ hostname: '127.0.0.1', port: animeDesiredPort, path: '/health', timeout: 350 }, (res) => {
                        if (res.statusCode === 200) {
                            healthy = true;
                            animeBaseUrl = `http://127.0.0.1:${animeDesiredPort}`;
                            console.log('Anime server is up on ' + animeBaseUrl);
                            clearInterval(timer);
                            try { res.resume(); } catch(_) {}
                            try {
                                if (mainWindow && !mainWindow.isDestroyed()) {
                                    mainWindow.webContents.send('anime-url', { url: animeBaseUrl });
                                }
                            } catch(_) {}
                        } else {
                            try { res.resume(); } catch(_) {}
                        }
                    });
                    req.on('timeout', () => { try { req.destroy(); } catch(_) {} });
                    req.on('error', () => {});
                } catch(_) {}
                if (attempts >= maxAttempts) {
                    clearInterval(timer);
                    if (!healthy && !app.isQuitting) {
                        console.warn(`[Anime] Failed to start server on port ${animeDesiredPort}`);
                    }
                }
            }, 400);
        } catch(_) {}
    } catch (e) {
        console.error('Failed to start Anime server:', e);
    }
}

function startTorrentio() {
    if (torrentioProc) {
        console.log('Torrentio server already running');
        return;
    }

    try {
        console.log('Starting Torrentio server...');
        
        // Resolve script path in both dev and packaged environments
        const candidates = [];
        if (app.isPackaged && process.resourcesPath) {
            candidates.push(path.join(process.resourcesPath, 'Torrentio', 'server.js'));
            candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'Torrentio', 'server.js'));
        }
        candidates.push(path.join(__dirname, 'Torrentio', 'server.js'));
        
        let entry = null;
        for (const p of candidates) {
            try { if (p && fs.existsSync(p)) { entry = p; break; } } catch {}
        }
        if (!entry) {
            console.warn('Torrentio server entry not found. Ensure the Torrentio folder is packaged.');
            return;
        }

        // Compute NODE_PATH so the child can resolve dependencies from the app's node_modules
        const nodePathCandidates = [
            path.join(process.resourcesPath || '', 'app.asar', 'node_modules'),
            path.join(process.resourcesPath || '', 'node_modules'),
            path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules'),
            path.join(__dirname, 'node_modules'),
            path.join(path.dirname(entry), 'node_modules'),
        ];
        const existingNodePaths = nodePathCandidates.filter(p => { try { return fs.existsSync(p); } catch { return false; } });
        const NODE_PATH_VALUE = existingNodePaths.join(path.delimiter);

        // Spawn Electron binary in Node mode to run server.js
        const logPath = path.join(app.getPath('userData'), 'torrentio.log');
        const logStream = fs.createWriteStream(logPath, { flags: 'a' });
        const childEnv = { 
            ...process.env, 
            PORT: String(torrentioDesiredPort), 
            ELECTRON_RUN_AS_NODE: '1', 
            NODE_PATH: NODE_PATH_VALUE
        };
        torrentioProc = spawn(process.execPath, [entry], {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: childEnv,
            cwd: path.dirname(entry),
        });

        // Pipe logs for diagnostics
        try {
            torrentioProc.stdout.on('data', (d) => { try { logStream.write(d); } catch(_) {} });
            torrentioProc.stderr.on('data', (d) => { try { logStream.write(d); } catch(_) {} });
        } catch (_) {}

        torrentioProc.on('exit', (code, signal) => {
            console.log(`Torrentio server exited code=${code} signal=${signal}`);
            try { logStream.end(); } catch(_) {}
            // On unexpected exit during runtime, attempt a single restart
            if (!app.isQuitting) {
                setTimeout(() => { try { startTorrentio(); } catch(_) {} }, 1000);
            }
        });

        torrentioProc.on('error', (err) => {
            console.error('Failed to start Torrentio server process:', err);
            try { logStream.write(String(err?.stack || err) + '\n'); } catch(_) {}
        });

        // Probe / (root endpoint) to confirm the service is up
        try {
            let attempts = 0;
            let healthy = false;
            const maxAttempts = 25; // ~10s @ 400ms
            const timer = setInterval(() => {
                attempts++;
                try {
                    const req = http.get({ hostname: '127.0.0.1', port: torrentioDesiredPort, path: '/', timeout: 350 }, (res) => {
                        if (res.statusCode === 200) {
                            healthy = true;
                            clearInterval(timer);
                            console.log(`Torrentio is up on ${torrentioBaseUrl}`);
                            try {
                                if (mainWindow && !mainWindow.isDestroyed()) {
                                    mainWindow.webContents.send('torrentio-url', { url: torrentioBaseUrl });
                                }
                            } catch(_) {}
                        } else {
                            try { res.resume(); } catch(_) {}
                        }
                    });
                    req.on('timeout', () => { try { req.destroy(); } catch(_) {} });
                    req.on('error', () => {});
                } catch(_) {}
                if (attempts >= maxAttempts) {
                    clearInterval(timer);
                    if (!healthy && !app.isQuitting) {
                        console.warn(`[Torrentio] Failed to start server on port ${torrentioDesiredPort}`);
                    }
                }
            }, 400);
        } catch(_) {}
    } catch (e) {
        console.error('Failed to start Torrentio server:', e);
    }
}

// Enforce single instance with a friendly error on second run
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    // Show a friendly error instead of port-in-use errors
    try { dialog.showErrorBox("PlayTorrio", "The app is already running."); } catch(_) {}
    app.quit();
} else {
    app.on('second-instance', () => {
        // Focus existing window if user tried to open a second instance
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    app.whenReady().then(async () => {
    // ---- Migrate localStorage from default to persist:playtorrio partition ----
    await migrateLocalStorageIfNeeded();
    
    // ---- Initialize Ad Blocker for all sessions (blocks ads in iframes too) ----
    try {
        console.log('[AdBlocker] Initializing ad blocker...');
        
        // Cache path for ad blocker engine
        const adBlockCachePath = path.join(app.getPath('userData'), 'adblocker-engine.bin');
        let blocker;
        
        // Try to load from cache first for faster startup
        if (fs.existsSync(adBlockCachePath)) {
            try {
                const cacheData = fs.readFileSync(adBlockCachePath);
                blocker = ElectronBlocker.deserialize(cacheData);
                console.log('[AdBlocker] Loaded from cache');
            } catch (cacheErr) {
                console.log('[AdBlocker] Cache invalid, fetching fresh lists...');
                blocker = null;
            }
        }
        
        // If no cache or cache failed, fetch fresh lists
        if (!blocker) {
            blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
                enableCompression: true,
            });
            
            // Save to cache for next startup
            try {
                const serialized = blocker.serialize();
                fs.writeFileSync(adBlockCachePath, serialized);
                console.log('[AdBlocker] Saved to cache');
            } catch (saveErr) {
                console.warn('[AdBlocker] Failed to save cache:', saveErr.message);
            }
        }
        
        // Enable blocking on the default session
        blocker.enableBlockingInSession(session.defaultSession);
        
        // Enable blocking on the persistent partition used by the app
        const persistSession = session.fromPartition('persist:playtorrio');
        blocker.enableBlockingInSession(persistSession);
        
        // Store blocker globally for potential future use
        global.adBlocker = blocker;
        
        // Log blocked requests count periodically (optional, for debugging)
        let blockedCount = 0;
        blocker.on('request-blocked', () => {
            blockedCount++;
        });
        
        // Log stats every 5 minutes
        setInterval(() => {
            if (blockedCount > 0) {
                console.log(`[AdBlocker] Blocked ${blockedCount} requests in the last 5 minutes`);
                blockedCount = 0;
            }
        }, 5 * 60 * 1000);
        
        console.log('[AdBlocker] ✅ Ad blocker enabled for all sessions (including iframes)');
    } catch (adBlockErr) {
        console.error('[AdBlocker] Failed to initialize:', adBlockErr.message);
    }
    
    // ---- Main process file logging (Windows crash diagnostics)
    try {
        const logsDir = path.join(app.getPath('userData'), 'logs');
        fs.mkdirSync(logsDir, { recursive: true });
        const logFile = path.join(logsDir, `main-${new Date().toISOString().replace(/[:.]/g,'-')}.log`);
        const logStream = fs.createWriteStream(logFile, { flags: 'a' });
        let logClosed = false;
        const safeWrite = (msg) => {
            try {
                if (!logClosed && logStream && !logStream.destroyed && !logStream.writableEnded && logStream.writable) {
                    logStream.write(msg);
                }
            } catch (_) {}
        };
        const origLog = console.log.bind(console);
        const origErr = console.error.bind(console);
        console.log = (...args) => { safeWrite(`[LOG] ${new Date().toISOString()} ${args.join(' ')}\n`); origLog(...args); };
        console.error = (...args) => { safeWrite(`[ERR] ${new Date().toISOString()} ${args.join(' ')}\n`); origErr(...args); };
        process.on('exit', (code) => {
            try { logClosed = true; safeWrite(`[EXIT] code=${code}\n`); } catch(_) {}
            try { if (logStream && !logStream.destroyed) logStream.end(); } catch(_) {}
        });
        console.log('Main log started at', logFile);
    } catch (_) {}
    // Initialize Discord RPC (guard on connectivity)
    try {
        const online = await (async () => {
            try { await dnsLookup('discord.com'); return true; } catch { return false; }
        })();
        if (online) {
            setupDiscordRPC();
        } else {
            console.log('[Discord RPC] Skipping init: offline');
        }
    } catch(_) {}
    // Start the unified server (port 6987) - handles all API routes including anime, books, torrents, etc.
    try {
        // Resolve bundled ffmpeg/ffprobe
        const isWin = process.platform === 'win32';
        const isMac = process.platform === 'darwin';
        const ffmpegFolder = isWin ? 'ffmpegwin' : (isMac ? 'ffmpegmac' : 'ffmpeglinux');
        const exeExt = isWin ? '.exe' : '';
        
        let ffmpegBin = null;
        let ffprobeBin = null;

        const ffmpegCandidates = [];
        if (app.isPackaged && process.resourcesPath) {
            // Production path: resources/ffmpeg/ffmpeg{platform}
            ffmpegCandidates.push(path.join(process.resourcesPath, 'ffmpeg', ffmpegFolder));
            ffmpegCandidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'ffmpeg', ffmpegFolder));
        }
        // Development path: root/ffmpeg/ffmpeg{platform}
        ffmpegCandidates.push(path.join(__dirname, 'ffmpeg', ffmpegFolder));

        for (const p of ffmpegCandidates) {
            const f = path.join(p, `ffmpeg${exeExt}`);
            const pr = path.join(p, `ffprobe${exeExt}`);
            if (fs.existsSync(f)) {
                ffmpegBin = f;
                ffprobeBin = pr;
                console.log(`[FFmpeg] Found binaries in: ${p}`);
                // Ensure executable on Unix
                if (!isWin) {
                    try { 
                        if (fs.existsSync(f)) fs.chmodSync(f, 0o755); 
                        if (fs.existsSync(pr)) fs.chmodSync(pr, 0o755);
                        console.log(`[FFmpeg] Set +x permissions for Linux/Mac`);
                    } catch(e) {
                        console.error(`[FFmpeg] Failed to set permissions: ${e.message}`);
                    }
                }
                break;
            }
        }

        if (!ffmpegBin) {
            console.warn(`[FFmpeg] Bundled binaries NOT found for ${process.platform}. Looked in: ${ffmpegCandidates.join(', ')}`);
        }

        const { server, clearCache, clearStremioCache, cleanup, activeTorrents } = startServer(app.getPath('userData'), app.getPath('exe'), ffmpegBin, ffprobeBin);
        httpServer = server;
        // Store clearCache function globally for cleanup on exit
        global.clearApiCache = clearCache;
        global.clearStremioCache = clearStremioCache;
        global.cleanup = cleanup;
        global.activeTorrents = activeTorrents;
        console.log('✅ Main API server started on port 6987');
    } catch (e) {
        console.error('[Server] Failed to start API server:', e?.stack || e);
        try { dialog.showErrorBox('PlayTorrio', 'Failed to start internal server. Some features may not work.'); } catch(_) {}
    }

    // ============================================================================
    // NOTE: All microservices below are now integrated into server.mjs via api.cjs
    // No need to start individual servers - all routes available on localhost:6987
    // ============================================================================
    // startTorrentless();  // Now: localhost:6987/torrentless/api/*
    // start111477();       // Now: localhost:6987/111477/api/*
    // startBooks();        // Now: localhost:6987/zlib/*
    // startRandomBook();   // Now: localhost:6987/otherbook/api/*
    // startAnime();        // Now: localhost:6987/anime/api/*
    // startTorrentio();    // Now: localhost:6987/torrentio/api/*

        mainWindow = createWindow();
    // Schedule cleanup of old installers/caches shortly after startup
    try { setTimeout(() => { cleanupOldInstallersAndCaches().catch(()=>{}); }, 5000); } catch(_) {}

    // One-time version notice for v1.6.3
    try {
        const ver = String(app.getVersion() || '');
        if (ver.startsWith('1.6.3')) {
            const s = readMainSettings();
            const key = 'seenVersionNotice_1_6_3';
            if (!s[key]) {
                const sendNotice = () => {
                    try { mainWindow?.webContents?.send('version-notice-1-6-3'); } catch(_) {}
                };
                if (mainWindow?.webContents?.isLoading()) {
                    mainWindow.webContents.once('did-finish-load', sendNotice);
                } else {
                    sendNotice();
                }
                s[key] = true;
                writeMainSettings(s);
            }
        }
    } catch(_) {}
global.manifestRead = (data) => ipcMain.invoke("manifestRead", data);
global.manifestWrite = (data) => ipcMain.invoke("manifestWrite", data);

    // Register embedded player IPC handlers - Removed
    // registerIPC();

    // IPC handler to open System MPV (Standalone)
    ipcMain.handle('open-in-mpv', (event, data) => {
        const { streamUrl, url, startSeconds } = data || {};
        const finalUrl = streamUrl || url;
        console.log(`[MPV] Standalone request: ${finalUrl}`);
        return openInStandaloneMPV(finalUrl, startSeconds);
    });
ipcMain.handle("manifestWrite", async (event, manifestUrl) => {
    try {
        const file = path.join(app.getPath("userData"), "manifest_url.json");
        fs.writeFileSync(file, JSON.stringify({ manifestUrl }, null, 2));
        return { success: true };
    } catch (error) {
        console.error("Error saving manifest:", error);
        return { success: false, error };
    }
});

ipcMain.handle("manifestRead", async () => {
    try {
        const file = path.join(app.getPath("userData"), "manifest_url.json");
        if (!fs.existsSync(file)) return { success: true, data: "" };
        
        const raw = fs.readFileSync(file, "utf8");
        const parsed = JSON.parse(raw);
        return { success: true, data: parsed.manifestUrl || "" };
    } catch (error) {
        console.error("Error reading manifest:", error);
        return { success: false, error };
    }
});

// Stremio Addon Management
const getAddonsFilePath = () => path.join(app.getPath("userData"), "addons.json");

    ipcMain.handle('get-installed-addons', async () => {
        try {
            const addonsPath = path.join(app.getPath('userData'), 'addons.json');
            if (fs.existsSync(addonsPath)) {
                return JSON.parse(fs.readFileSync(addonsPath, 'utf8'));
            }
            return [];
        } catch (error) {
            console.error('Failed to read addons.json:', error);
            return [];
        }
    });

    ipcMain.handle('addonInstall', async (event, manifestUrl) => {    try {
        // Fetch manifest to validate and get details
        const response = await got(manifestUrl);
        const manifest = JSON.parse(response.body);

        if (!manifest.id || !manifest.name || !manifest.version) {
            return { success: false, message: "Invalid manifest: missing id, name, or version" };
        }

        const filePath = getAddonsFilePath();
        let addons = [];
        if (fs.existsSync(filePath)) {
            addons = JSON.parse(fs.readFileSync(filePath, "utf8"));
        }

        // Check duplicates
        if (addons.some(a => a.manifest.id === manifest.id)) {
             // Update existing
             addons = addons.map(a => a.manifest.id === manifest.id ? { url: manifestUrl, manifest } : a);
        } else {
            addons.push({ url: manifestUrl, manifest });
        }

        fs.writeFileSync(filePath, JSON.stringify(addons, null, 2));
        return { success: true, manifest };
    } catch (error) {
        console.error("Error installing addon:", error);
        return { success: false, message: error.message };
    }
});

ipcMain.handle("addonList", async () => {
    try {
        const filePath = getAddonsFilePath();
        if (!fs.existsSync(filePath)) return { success: true, addons: [] };
        const addons = JSON.parse(fs.readFileSync(filePath, "utf8"));
        return { success: true, addons };
    } catch (error) {
        console.error("Error listing addons:", error);
        return { success: false, message: error.message, addons: [] };
    }
});

ipcMain.handle("addonRemove", async (event, addonId) => {
    try {
        const filePath = getAddonsFilePath();
        if (!fs.existsSync(filePath)) return { success: false, message: "No addons found" };
        
        let addons = JSON.parse(fs.readFileSync(filePath, "utf8"));
        const initialLength = addons.length;
        addons = addons.filter(a => a.manifest.id !== addonId);
        
        if (addons.length === initialLength) {
             return { success: false, message: "Addon not found" };
        }

        fs.writeFileSync(filePath, JSON.stringify(addons, null, 2));
        return { success: true };
    } catch (error) {
         console.error("Error removing addon:", error);
         return { success: false, message: error.message };
    }
});

    // Launcher for external streams (formerly Advanced MPV launcher)
    ipcMain.handle('open-mpv-headers', async (event, options) => {
        try {
            const { url, startSeconds, isDebrid } = options || {};

            if (!url) {
                return { success: false, message: 'Missing URL' };
            }

            console.log('[HTML5] Opening stream with headers (headers ignored in HTML5):', url);
            return openInHtml5Player(mainWindow, url, startSeconds, { isDebrid });
        } catch (error) {
            console.error('[HTML5] Launcher error:', error);
            return { success: false, message: error.message };
        }
    });

    // IPC handler to set skip cleanup flag
    ipcMain.handle('set-skip-torrent-cleanup', (event, skip) => {
        if (skip === true) {
            // Will be set to actual hash by the cleanup check
            skipTorrentCleanupHash = 'pending';
        } else if (typeof skip === 'string') {
            skipTorrentCleanupHash = skip;
        } else {
            skipTorrentCleanupHash = null;
        }
        console.log('[Cleanup] Skip torrent cleanup flag set to:', skipTorrentCleanupHash);
        return { success: true };
    });

    // IPC handler to spawn player (formerly mpv.js, now HTML5 or NodeMPV)
ipcMain.handle('spawn-mpvjs-player', async (event, { url, tmdbId, imdbId, seasonNum, episodeNum, subtitles, isDebrid, type, isBasicMode, showName, provider, providerUrl, quality }) => {
    let finalImdbId = imdbId;
    let finalTmdbId = tmdbId;
    
    // Check if tmdbId is actually an IMDB ID (starts with 'tt')
    if (tmdbId && typeof tmdbId === 'string' && tmdbId.startsWith('tt')) {
        finalImdbId = finalImdbId || tmdbId;
        finalTmdbId = null;
        console.log('[Main] tmdbId was actually IMDB ID:', tmdbId);
    }
    
    // Auto-fetch IMDB ID if missing and we have a real TMDB ID
    if (!finalImdbId && finalTmdbId) {
        try {
            const useType = (seasonNum || type === 'tv') ? 'tv' : 'movie';
            const apiKey = 'c3515fdc674ea2bd7b514f4bc3616a4a'; 
            const tmdbUrl = `https://api.themoviedb.org/3/${useType}/${finalTmdbId}/external_ids?api_key=${apiKey}`;
            
            const response = await fetch(tmdbUrl);
            if (response.ok) {
                const data = await response.json();
                if (data && data.imdb_id) {
                    finalImdbId = data.imdb_id;
                    console.log('[Main] Fetched IMDB ID from TMDB:', finalImdbId);
                }
            }
        } catch(e) {
            console.warn('[Main] Failed to fetch IMDB ID from TMDB:', e.message);
        }
    }

    const metadata = { tmdbId: finalTmdbId, imdbId: finalImdbId, seasonNum, episodeNum, isDebrid, type: (seasonNum || type === 'tv' ? 'tv' : 'movie'), isBasicMode, showName, provider, providerUrl, quality };
    
    // Check player settings (Windows only)
    if (process.platform === 'win32') {
        try {
            const settingsRes = await fetch('http://localhost:6987/api/settings');
            const settings = await settingsRes.json();
            
            // Determine player type (default to playtorrio)
            const playerType = settings.playerType || (settings.useNodeMPV ? 'nodempv' : 'playtorrio');
            
            if (playerType === 'nodempv') {
                console.log('[Main] Using NodeMPV player');
                return openInNodeMPVPlayer(mainWindow, url, null, metadata);
            } else if (playerType === 'playtorrio') {
                console.log('[Main] Using PlayTorrioPlayer with IPC bridge');
                try {
                    // Only stop torrent on close for basicmode, keep alive for normal mode
                    const stopOnClose = metadata.isBasicMode === true;
                    const response = await fetch('http://localhost:6987/api/playtorrioplayer', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            url, 
                            tmdbId: metadata.tmdbId,
                            imdbId: metadata.imdbId,
                            seasonNum: metadata.seasonNum,
                            episodeNum: metadata.episodeNum,
                            mediaType: metadata.type || 'movie',
                            stopOnClose 
                        })
                    });
                    const result = await response.json();
                    if (result.success) {
                        return { success: true, message: 'PlayTorrioPlayer launched with IPC bridge' };
                    } else {
                        console.warn('[Main] PlayTorrioPlayer failed:', result.error);
                        // Fall through to HTML5 player as fallback
                    }
                } catch (e) {
                    console.warn('[Main] PlayTorrioPlayer error:', e.message);
                    // Fall through to HTML5 player as fallback
                }
            }
            // playerType === 'builtin' falls through to HTML5 player
        } catch(e) {
            console.warn('[Main] Failed to check player settings:', e.message);
        }
    }
    
    return openInHtml5Player(mainWindow, url, null, metadata);
});

    // ===== NodeMPV IPC Handlers (Windows Only) =====
    ipcMain.handle('mpv-load', async (event, videoUrl) => {
        if (process.platform !== 'win32') {
            return { success: false, error: 'NodeMPV is only available on Windows' };
        }
        try {
            return await startMpvProcess(videoUrl);
        } catch(e) {
            return { success: false, error: e.message };
        }
    });
    
    ipcMain.handle('mpv-command', async (event, command, ...args) => {
        if (!mpvSocket || mpvSocket.destroyed) {
            return { success: false, error: 'MPV not connected' };
        }
        
        try {
            switch(command) {
                case 'toggle-pause':
                    sendMpvCommand(['cycle', 'pause']);
                    break;
                case 'seek':
                    sendMpvCommand(['seek', args[0], 'relative']);
                    break;
                case 'seek-to':
                    sendMpvCommand(['seek', args[0], 'absolute']);
                    break;
                case 'set-volume':
                    sendMpvCommand(['set_property', 'volume', args[0]]);
                    break;
                case 'toggle-mute':
                    sendMpvCommand(['cycle', 'mute']);
                    break;
                case 'set-audio-track':
                    sendMpvCommand(['set_property', 'aid', args[0]]);
                    break;
                case 'set-sub-track':
                    sendMpvCommand(['set_property', 'sid', args[0]]);
                    break;
                case 'load-subtitle':
                    sendMpvCommand(['sub-add', args[0]]);
                    break;
                case 'disable-subtitles':
                    sendMpvCommand(['set_property', 'sid', 'no']);
                    break;
                case 'set-sub-delay':
                    sendMpvCommand(['set_property', 'sub-delay', args[0]]);
                    break;
                case 'set-sub-scale':
                    sendMpvCommand(['set_property', 'sub-scale', args[0]]);
                    break;
                case 'set-sub-pos':
                    sendMpvCommand(['set_property', 'sub-pos', args[0]]);
                    break;
                case 'toggle-fullscreen':
                    if (mpvWindow && !mpvWindow.isDestroyed()) {
                        if (!mpvIsFullscreen) {
                            // Going fullscreen - save current bounds first
                            mpvWindowBoundsBeforeFullscreen = mpvWindow.getBounds();
                            mpvIsFullscreen = true;
                            // Use setSimpleFullScreen on Windows for proper taskbar hiding
                            if (process.platform === 'win32') {
                                mpvWindow.setSimpleFullScreen(true);
                            } else {
                                mpvWindow.setFullScreen(true);
                            }
                            sendMpvCommand(['set_property', 'fullscreen', 'yes']);
                            return { success: true, isFullscreen: true };
                        } else {
                            // Exiting fullscreen
                            const savedBounds = mpvWindowBoundsBeforeFullscreen;
                            mpvIsFullscreen = false;
                            if (process.platform === 'win32') {
                                mpvWindow.setSimpleFullScreen(false);
                            } else {
                                mpvWindow.setFullScreen(false);
                            }
                            sendMpvCommand(['set_property', 'fullscreen', 'no']);
                            // Restore original bounds
                            if (savedBounds) {
                                setTimeout(() => {
                                    if (mpvWindow && !mpvWindow.isDestroyed()) {
                                        mpvWindow.setBounds(savedBounds);
                                    }
                                }, 50);
                            }
                            return { success: true, isFullscreen: false };
                        }
                    }
                    break;
                case 'quit':
                    if (mpvProcess) {
                        try { mpvProcess.kill(); } catch(e) {}
                    }
                    break;
                default:
                    sendMpvCommand([command, ...args]);
            }
            return { success: true };
        } catch(e) {
            return { success: false, error: e.message };
        }
    });

    // Direct MPV launch for external URLs (111477, etc.)
    ipcMain.handle('open-mpv-direct', async (event, url) => {
        console.log(`[MPV] Direct standalone request: ${url}`);
        return openInStandaloneMPV(url);
    });

    // IPC handler to open IINA from renderer (macOS only)
    ipcMain.handle('open-in-iina', (event, data) => {
        const { streamUrl, url, infoHash, startSeconds } = data || {};
        const finalUrl = streamUrl || url;
        console.log(`Received IINA open request for hash: ${infoHash}`);
        return openInIINA(mainWindow, finalUrl, infoHash, startSeconds);
    });

    // IPC handler to open VLC from renderer
    ipcMain.handle('open-in-vlc', (event, data) => {
        // VLC not supported on macOS in this build
        if (process.platform === 'darwin') {
            return { 
                success: false, 
                message: 'VLC is not included in the macOS build. Please use MPV instead.' 
            };
        }
        const { streamUrl, infoHash, startSeconds } = data || {};
        console.log(`Received VLC open request for hash: ${infoHash}`);
        return openInVLC(mainWindow, streamUrl, infoHash, startSeconds);
    });

    // Direct VLC launch for external URLs
    ipcMain.handle('open-vlc-direct', async (event, url) => {
        // VLC not supported on macOS in this build
        if (process.platform === 'darwin') {
            return { 
                success: false, 
                message: 'VLC is not included in the macOS build. Please use MPV instead.' 
            };
        }
        try {
            console.log('Opening URL in VLC:', url);
            const vlcPath = resolveVlcExe();
            if (!vlcPath) {
                throw new Error('VLC not found');
            }
            const vlcProcess = spawn(vlcPath, [url], { stdio: 'ignore', detached: true });

            vlcProcess.on('close', async (code) => {
                console.log(`VLC (direct) closed with code ${code}`);
                try {
                    if (discordRpc && discordRpcReady) {
                        await discordRpc.setActivity({
                            details: 'Browsing PlayTorrio',
                            startTimestamp: new Date(),
                            largeImageKey: 'icon',
                            largeImageText: 'PlayTorrio App',
                            buttons: [
                                { label: 'Download App', url: 'https://github.com/ayman708-UX/PlayTorrio' }
                            ]
                        });
                    }
                } catch (err) {
                    console.error('[Discord RPC] Failed to clear on VLC direct close:', err);
                }
            });

            vlcProcess.unref();
            return { success: true };
        } catch (error) {
            console.error('Error opening VLC:', error);
            return { success: false, error: error.message };
        }
    });

    // ============================================================================
    // XDMOVIES PLAY HANDLERS
    // ============================================================================

    // Play XDmovies link (HTML5 Player)
    ipcMain.handle('play-xdmovies-mpv', (event, data) => {
        const { streamUrl, startSeconds } = data || {};
        console.log(`[XDmovies] Opening in HTML5: ${streamUrl}`);
        return openInHtml5Player(mainWindow, streamUrl, startSeconds);
    });

    // Play XDmovies link on Mac (opens in IINA) - Keeping IINA for Mac users if they prefer
    ipcMain.handle('play-xdmovies-iina', (event, data) => {
        const { streamUrl, movieTitle, startSeconds } = data || {};
        console.log(`[XDmovies] Opening in IINA: ${movieTitle}`);
        return openInIINA(mainWindow, streamUrl, movieTitle || 'xdmovies', startSeconds);
    });

    // Play XDmovies link on Linux (formerly standalone MPV) -> HTML5
    ipcMain.handle('play-xdmovies-linux', (event, data) => {
        const { streamUrl, startSeconds } = data || {};
        console.log(`[XDmovies] Opening in HTML5 (Linux): ${streamUrl}`);
        return openInHtml5Player(mainWindow, streamUrl, startSeconds);
    });

    // Generic XDmovies play handler
    ipcMain.handle('play-xdmovies', (event, data) => {
        const { streamUrl, movieTitle, startSeconds } = data || {};
        console.log(`[XDmovies] Playing on: ${process.platform}`);
        
        if (!streamUrl) {
            return { success: false, message: 'Stream URL is required' };
        }

        if (process.platform === 'darwin') {
            // Prefer IINA on macOS if available, otherwise HTML5 could be fallback
            // But for now let's use HTML5 as the primary request was "remove mpv... add html5 player"
            // If the user specifically wanted to keep IINA they usually say so. 
            // I'll default to HTML5 for consistency with the request, or keep IINA if it was separate.
            // The request was about "remove mpv bundling...". IINA is external.
            // But to be safe and consistent, let's just use HTML5 for everything unless explicitly "open-in-iina" is called.
             return openInHtml5Player(mainWindow, streamUrl, startSeconds);
        } else {
            return openInHtml5Player(mainWindow, streamUrl, startSeconds);
        }
    });

    // Helper function to get local network IP
    function getLocalNetworkIP(targetDeviceIP = null) {
        const interfaces = os.networkInterfaces();
        
        // If we have a target device IP, try to find an interface on the same subnet
        if (targetDeviceIP) {
            const targetParts = targetDeviceIP.split('.');
            const targetSubnet = `${targetParts[0]}.${targetParts[1]}.${targetParts[2]}`;
            
            for (const name of Object.keys(interfaces)) {
                for (const iface of interfaces[name]) {
                    if (iface.family === 'IPv4' && !iface.internal) {
                        const ifaceParts = iface.address.split('.');
                        const ifaceSubnet = `${ifaceParts[0]}.${ifaceParts[1]}.${ifaceParts[2]}`;
                        
                        // Found interface on same subnet as target device
                        if (ifaceSubnet === targetSubnet) {
                            console.log(`[Network] Found matching subnet interface: ${iface.address} for target ${targetDeviceIP}`);
                            return iface.address;
                        }
                    }
                }
            }
        }
        
        // Fallback: return first non-internal IPv4 address, skip virtual adapters
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                // Skip internal, virtual adapters, and APIPA addresses
                if (iface.family === 'IPv4' && !iface.internal && 
                    !name.toLowerCase().includes('virtualbox') &&
                    !name.toLowerCase().includes('vmware') &&
                    !iface.address.startsWith('169.254') &&
                    !iface.address.startsWith('192.168.56')) { // Common VirtualBox subnet
                    return iface.address;
                }
            }
        }
        return 'localhost'; // fallback
    }

    // Helper function to replace localhost with network IP
    function replaceLocalhostWithNetworkIP(url, targetDeviceIP = null) {
        const networkIP = getLocalNetworkIP(targetDeviceIP);
        console.log(`[Chromecast] Network IP: ${networkIP}`);
        
        if (url.includes('localhost')) {
            const newUrl = url.replace('localhost', networkIP);
            console.log(`[Chromecast] Replaced localhost URL: ${url} -> ${newUrl}`);
            return newUrl;
        }
        if (url.includes('127.0.0.1')) {
            const newUrl = url.replace('127.0.0.1', networkIP);
            console.log(`[Chromecast] Replaced 127.0.0.1 URL: ${url} -> ${newUrl}`);
            return newUrl;
        }
        return url;
    }

    // IPC handler to cast to Chromecast using bundled castv2-client
    ipcMain.handle('cast-to-chromecast', async (event, data) => {
        const { streamUrl, metadata, deviceHost } = data || {};
        
        if (!streamUrl) {
            return { success: false, message: 'No stream URL provided' };
        }
        
        try {
            console.log('[Chromecast] Starting cast request...');
            console.log('[Chromecast] Original stream URL:', streamUrl);
            
            // Detect if this is HLS
            const isHLS = streamUrl.includes('.m3u8') || streamUrl.includes('mpegurl') || 
                         streamUrl.includes('/playlist/');
            
            // Update metadata contentType if HLS
            if (isHLS && metadata) {
                metadata.contentType = 'application/x-mpegURL';
                console.log('[Chromecast] Detected HLS stream, set contentType to application/x-mpegURL');
            }
            
            // Wrap URL through local proxy if it's not already proxied
            let urlToProxy = streamUrl;
            const alreadyProxied = /\/stream\/debrid\?url=/.test(urlToProxy);
            if (!alreadyProxied) {
                // Wrap through proxy so PC handles fetching/caching
                urlToProxy = `http://localhost:6987/stream/debrid?url=${encodeURIComponent(streamUrl)}`;
            }
            
            // Replace localhost with network IP on same subnet as device
            const networkStreamUrl = replaceLocalhostWithNetworkIP(urlToProxy, deviceHost);
            
            console.log('[Chromecast] Final URL for Chromecast:', networkStreamUrl);
            
            let result;
            if (deviceHost) {
                // Cast to specific device
                console.log(`[Chromecast] Casting to specific device: ${deviceHost}`);
                const { castMedia } = await import('./chromecast.mjs');
                result = await castMedia(deviceHost, networkStreamUrl, metadata);
            } else {
                // Cast to first available device
                const { castToFirstDevice } = await import('./chromecast.mjs');
                result = await castToFirstDevice(networkStreamUrl, metadata);
            }
            
            return { 
                success: true, 
                message: result.message || 'Casting to Chromecast...' 
            };
        } catch (error) {
            console.error('[Chromecast] Casting error:', error);
            
            return { 
                success: false, 
                message: error.message || 'Failed to cast to Chromecast' 
            };
        }
    });

    // IPC handler to discover Chromecast devices
    ipcMain.handle('discover-chromecast-devices', async () => {
        try {
            console.log('[Chromecast] Discovering devices...');
            const { discoverDevices } = await import('./chromecast.mjs');
            const devices = await discoverDevices(3000);
            
            return {
                success: true,
                devices: devices
            };
        } catch (error) {
            console.error('[Chromecast] Discovery error:', error);
            return {
                success: false,
                devices: [],
                message: error.message
            };
        }
    });

    // IPC handler for manual temp folder clearing (e.g., from Close Player button)
    ipcMain.handle('clear-webtorrent-temp', async () => {
        return await clearWebtorrentTemp();
    });

    // IPC handler for the new Clear Cache button
    ipcMain.handle('clear-cache', async () => {
            const results = [];
            
            // Stop all torrent engines first
            try {
                console.log('[ClearCache] Stopping all torrent engines...');
                const stopRes = await fetch('http://localhost:6987/api/alt-stop-all', { method: 'POST' });
                if (stopRes.ok) {
                    results.push({ success: true, message: 'Torrent engines stopped' });
                    console.log('[ClearCache] Torrent engines stopped');
                }
            } catch (e) {
                console.warn('[ClearCache] Failed to stop torrent engines:', e.message);
            }
            
            const r1 = await clearWebtorrentTemp(); results.push(r1);
            const r2 = await clearPlaytorrioSubtitlesTemp(); results.push(r2);
            
            // Also clear API cache
            if (global.clearApiCache) {
                try {
                    global.clearApiCache();
                    results.push({ success: true, message: 'API cache cleared' });
                } catch (error) {
                    results.push({ success: false, message: 'Failed to clear API cache: ' + error.message });
                }
            }
            
            // Clear Stremio engine cache
            if (global.clearStremioCache) {
                try {
                    const stremioResult = global.clearStremioCache();
                    results.push(stremioResult);
                } catch (error) {
                    results.push({ success: false, message: 'Failed to clear Stremio cache: ' + error.message });
                }
            }
            
            const success = results.every(r => r.success);
            const message = success
                ? 'Cache cleared: engines stopped, webtorrent, subtitles, API cache, and Stremio cache.'
                : results.map(r => r.message).join(' | ');
            return { success, message };
    });

    // IPC handler: Select cache folder
    ipcMain.handle('select-cache-folder', async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory', 'createDirectory'],
            title: 'Select Cache Location'
        });
        
        if (!result.canceled && result.filePaths.length > 0) {
            return { success: true, path: result.filePaths[0] };
        }
        return { success: false };
    });

    // IPC handler: Pick a file (for MPV path, etc.)
    ipcMain.handle('pick-file', async (event, options = {}) => {
        const dialogOptions = {
            properties: ['openFile'],
            title: options.title || 'Select File'
        };
        
        if (options.filters) {
            dialogOptions.filters = options.filters;
        }
        
        const result = await dialog.showOpenDialog(mainWindow, dialogOptions);
        
        if (!result.canceled && result.filePaths.length > 0) {
            return result.filePaths[0];
        }
        return null;
    });

    // Removed MPV installer helpers and IPC

    // IPC handler: Get platform information
    ipcMain.handle('get-platform', () => {
        return { 
            platform: process.platform,
            isMac: process.platform === 'darwin',
            isWindows: process.platform === 'win32',
            isLinux: process.platform === 'linux'
        };
    });

    // IPC handler: Restart app on demand
    ipcMain.handle('restart-app', () => {
        app.relaunch();
        app.exit(0);
    });

    // Window control IPC handlers
    ipcMain.handle('window-minimize', () => {
        try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize(); } catch(_) {}
        return { success: true };
    });
    ipcMain.handle('window-maximize-toggle', () => {
        try {
            if (mainWindow && !mainWindow.isDestroyed()) {
                if (mainWindow.isMaximized()) {
                    mainWindow.restore();
                } else {
                    mainWindow.maximize();
                }
                return { success: true, isMaximized: mainWindow.isMaximized() };
            }
        } catch(_) {}
        return { success: false };
    });
    ipcMain.handle('window-close', () => {
        try {
            app.isQuitting = true;
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
        } catch(_) {}
        return { success: true };
    });

    // Notify renderer about maximize state changes (to swap icons)
    try {
        if (mainWindow) {
            mainWindow.on('maximize', () => {
                try { mainWindow.webContents.send('window-maximize-changed', { isMaximized: true }); } catch(_) {}
            });
            mainWindow.on('unmaximize', () => {
                try { mainWindow.webContents.send('window-maximize-changed', { isMaximized: false }); } catch(_) {}
            });
        }
    } catch(_) {}

    // IPC handler: Open external URL in default browser
    ipcMain.handle('open-external', async (event, url) => {
        try {
            if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
                return { success: false, message: 'Invalid URL' };
            }
            await shell.openExternal(url);
            return { success: true };
        } catch (err) {
            return { success: false, message: err?.message || 'Failed to open URL' };
        }
    });

    // IPC: get current Books base URL (dynamic port safe)
    ipcMain.handle('books-get-url', async () => {
        try { return { success: true, url: booksBaseUrl }; } catch(e) { return { success: false, url: 'http://127.0.0.1:3004' }; }
    });

    // IPC: copy text to clipboard
    ipcMain.handle('copy-to-clipboard', async (event, text) => {
        try {
            if (typeof text !== 'string' || !text.length) {
                return { success: false, message: 'Nothing to copy' };
            }
            clipboard.writeText(text);
            return { success: true };
        } catch (err) {
            return { success: false, message: err?.message || 'Failed to copy' };
        }
    });

    // IPC: show folder in file explorer
    ipcMain.handle('show-folder-in-explorer', async (event, inputPath) => {
        try {
            // Accept either a file path or a directory path
            let directory = inputPath;
            if (fs.existsSync(inputPath)) {
                const stat = fs.statSync(inputPath);
                if (stat.isFile()) {
                    directory = path.dirname(inputPath);
                }
            }
            console.log('[Show Folder] Opening directory:', directory);
            await shell.openPath(directory);
            return { success: true };
        } catch (err) {
            console.error('[Show Folder] Error:', err);
            return { success: false, message: err?.message || 'Failed to open folder' };
        }
    });

    // Optional IPC: allow renderer to install the downloaded update
    // Change: Close the app and DO NOT relaunch automatically.
    ipcMain.handle('updater-install', async () => {
        try {
            // Install update and do not run after install
            // electron-updater: quitAndInstall(isSilent=false, isForceRunAfter=false)
            try {
                // Relaunch automatically after install to reduce user friction
                autoUpdater.quitAndInstall(false, true);
            } catch (e) {
                // Fallback: force exit if updater throws; Electron/installer should relaunch
                app.exit(0);
            }
            // Safety: if app still hasn't exited in 3s (edge cases), force exit
            setTimeout(() => { try { app.exit(0); } catch(_) {} }, 3000);
            return { success: true };
        } catch (e) {
            return { success: false, message: e?.message || 'Failed to install update' };
        }
    });

    // My List IPC handlers
    ipcMain.handle('my-list-read', async () => {
        try {
            const myListPath = path.join(app.getPath('userData'), 'my-list.json');
            if (fs.existsSync(myListPath)) {
                const data = await fs.promises.readFile(myListPath, 'utf8');
                return { success: true, data: JSON.parse(data) };
            } else {
                return { success: true, data: [] };
            }
        } catch (error) {
            console.error('Error reading my-list.json:', error);
            return { success: false, message: error.message, data: [] };
        }
    });

    ipcMain.handle('my-list-write', async (event, listData) => {
        try {
            const myListPath = path.join(app.getPath('userData'), 'my-list.json');
            await fs.promises.writeFile(myListPath, JSON.stringify(listData, null, 2));
            return { success: true };
        } catch (error) {
            console.error('Error writing my-list.json:', error);
            return { success: false, message: error.message };
        }
    });

    // Done Watching IPC handlers
    ipcMain.handle('done-watching-read', async () => {
        try {
            const doneWatchingPath = path.join(app.getPath('userData'), 'done-watching.json');
            if (fs.existsSync(doneWatchingPath)) {
                const data = await fs.promises.readFile(doneWatchingPath, 'utf8');
                return { success: true, data: JSON.parse(data) };
            } else {
                return { success: true, data: [] };
            }
        } catch (error) {
            console.error('Error reading done-watching.json:', error);
            return { success: false, message: error.message, data: [] };
        }
    });

    ipcMain.handle('done-watching-write', async (event, listData) => {
        try {
            const doneWatchingPath = path.join(app.getPath('userData'), 'done-watching.json');
            await fs.promises.writeFile(doneWatchingPath, JSON.stringify(listData, null, 2));
            return { success: true };
        } catch (error) {
            console.error('Error writing done-watching.json:', error);
            return { success: false, message: error.message };
        }
    });

    // Fullscreen management
    ipcMain.handle('set-fullscreen', async (event, isFullscreen) => {
        try {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.setFullScreen(isFullscreen);
                return { success: true };
            }
            return { success: false, message: 'Main window not available' };
        } catch (error) {
            console.error('Error setting fullscreen:', error);
            return { success: false, message: error.message };
        }
    });

    ipcMain.handle('get-fullscreen', async () => {
        try {
            if (mainWindow && !mainWindow.isDestroyed()) {
                return { success: true, isFullscreen: mainWindow.isFullScreen() };
            }
            return { success: false, message: 'Main window not available' };
        } catch (error) {
            console.error('Error getting fullscreen state:', error);
            return { success: false, message: error.message };
        }
    });

    ipcMain.handle('toggle-devtools', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.toggleDevTools();
        }
    });

    // Discord Rich Presence handlers
    ipcMain.handle('update-discord-presence', async (event, presenceData) => {
        try {
            if (!discordRpc || !discordRpcReady) {
                return { success: false, message: 'Discord RPC not ready' };
            }
            
            const activity = {
                details: presenceData.details || 'Using PlayTorrio',
                state: presenceData.state || '',
                startTimestamp: presenceData.startTimestamp || new Date(),
                largeImageKey: presenceData.largeImageKey || 'icon',
                largeImageText: presenceData.largeImageText || 'PlayTorrio App'
            };

            // Add small image if provided (for music/video icons)
            if (presenceData.smallImageKey) {
                activity.smallImageKey = presenceData.smallImageKey;
                activity.smallImageText = presenceData.smallImageText || '';
            }

            // Add buttons if provided
            if (presenceData.buttons && Array.isArray(presenceData.buttons)) {
                activity.buttons = presenceData.buttons;
            } else {
                activity.buttons = [
                    { label: 'Download App', url: 'https://github.com/ayman708-UX/PlayTorrio' }
                ];
            }

            await discordRpc.setActivity(activity);
            return { success: true };
        } catch (error) {
            console.error('[Discord RPC] Update error:', error);
            return { success: false, message: error.message };
        }
    });

    ipcMain.handle('clear-discord-presence', async () => {
        try {
            if (!discordRpc || !discordRpcReady) {
                return { success: false, message: 'Discord RPC not ready' };
            }
            
            // Reset to base activity - just "Browsing PlayTorrio"
            await discordRpc.setActivity({
                details: 'Browsing PlayTorrio',
                startTimestamp: new Date(),
                largeImageKey: 'icon',
                largeImageText: 'PlayTorrio App',
                buttons: [
                    { label: 'Download App', url: 'https://github.com/ayman708-UX/PlayTorrio' }
                ]
            });
            return { success: true };
        } catch (error) {
            console.error('[Discord RPC] Clear error:', error);
            return { success: false, message: error.message };
        }
    });

    // EPUB Library functionality
    ipcMain.handle('get-epub-folder', async () => {
        try {
            const epubFolder = path.join(app.getPath('userData'), 'epub');
            // Create folder if it doesn't exist
            if (!fs.existsSync(epubFolder)) {
                fs.mkdirSync(epubFolder, { recursive: true });
            }
            return { success: true, path: epubFolder };
        } catch (error) {
            console.error('Error getting EPUB folder:', error);
            return { success: false, message: error.message };
        }
    });

    ipcMain.handle('download-epub', async (event, { url, bookData }) => {
        try {
            const epubFolder = path.join(app.getPath('userData'), 'epub');
            // Create folder if it doesn't exist
            if (!fs.existsSync(epubFolder)) {
                fs.mkdirSync(epubFolder, { recursive: true });
            }

            // Clean filename for the book
            const safeBook = bookData || {};
            const titleRaw = typeof safeBook.title === 'string' ? safeBook.title : (safeBook.name || 'Unknown Title');
            const cleanTitle = titleRaw.replace(/[<>:"/\\|?*]/g, '').trim() || 'Unknown Title';
            const authorRaw = Array.isArray(safeBook.author)
                ? (safeBook.author[0] || 'Unknown Author')
                : (typeof safeBook.author === 'string' ? safeBook.author : 'Unknown Author');
            const cleanAuthor = String(authorRaw).replace(/[<>:"/\\|?*]/g, '').trim() || 'Unknown Author';
            const filename = `${cleanTitle} - ${cleanAuthor}.epub`;
            const filePath = path.join(epubFolder, filename);

            // Persist cover URL and basic metadata so Library can show covers
            try {
                const metadataPath = path.join(epubFolder, 'covers.json');
                let covers = {};
                if (fs.existsSync(metadataPath)) {
                    try {
                        covers = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) || {};
                    } catch (_) {
                        covers = {};
                    }
                }
                // Helper to normalize title/author for indexing
                const normalize = (s) => String(s || '')
                    .toLowerCase()
                    .replace(/[^a-z0-9\s]/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();

                const indexKey = `${normalize(cleanTitle)}|${normalize(cleanAuthor)}`;

                covers[filename] = {
                    title: cleanTitle,
                    author: cleanAuthor,
                    coverUrl: typeof safeBook.coverUrl === 'string' ? safeBook.coverUrl : null,
                    sourceUrl: url || null,
                    savedAt: new Date().toISOString()
                };
                // Maintain a reverse index for fuzzy lookup by title+author
                covers._index = covers._index || {};
                covers._index[indexKey] = covers._index[indexKey] || [];
                if (!covers._index[indexKey].includes(filename)) {
                    covers._index[indexKey].push(filename);
                }
                fs.writeFileSync(metadataPath, JSON.stringify(covers, null, 2), 'utf8');
            } catch (metaErr) {
                console.warn('Could not persist EPUB cover metadata:', metaErr);
            }

            return { 
                success: true, 
                path: filePath,
                folder: epubFolder,
                filename,
                url: url,
                bookData: safeBook
            };
        } catch (error) {
            console.error('Error preparing EPUB download:', error);
            return { success: false, message: error.message };
        }
    });

    ipcMain.handle('get-epub-library', async () => {
        try {
            const epubFolder = path.join(app.getPath('userData'), 'epub');
            
            if (!fs.existsSync(epubFolder)) {
                return { success: true, books: [] };
            }

            // Scan for .epub files
            const files = fs.readdirSync(epubFolder);
            const epubFiles = files.filter(file => file.toLowerCase().endsWith('.epub'));
            
            // Load cover metadata if present
            let covers = {};
            const metadataPath = path.join(epubFolder, 'covers.json');
            if (fs.existsSync(metadataPath)) {
                try {
                    covers = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) || {};
                } catch (_) {
                    covers = {};
                }
            }
            
            const books = epubFiles.map(filename => {
                const filePath = path.join(epubFolder, filename);
                const stats = fs.statSync(filePath);
                
                // Try to extract title and author from filename
                const nameWithoutExt = filename.replace(/\.epub$/i, '');
                let title = nameWithoutExt;
                let author = 'Unknown Author';
                
                // Check if filename has " - " pattern for author
                const parts = nameWithoutExt.split(' - ');
                if (parts.length >= 2) {
                    title = parts[0].trim();
                    author = parts.slice(1).join(' - ').trim();
                }

                // Merge in any saved cover from metadata (filename match first)
                let meta = covers[filename] || {};
                let coverUrl = typeof meta.coverUrl === 'string' ? meta.coverUrl : null;
                
                // If no cover via filename, try fuzzy match via normalized title|author
                if (!coverUrl && covers._index) {
                    const normalize = (s) => String(s || '')
                        .toLowerCase()
                        .replace(/[^a-z0-9\s]/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();
                    const idxKey = `${normalize(title)}|${normalize(author)}`;
                    const possibleFiles = covers._index[idxKey];
                    if (Array.isArray(possibleFiles) && possibleFiles.length > 0) {
                        const first = possibleFiles[0];
                        const metaAlt = covers[first] || {};
                        if (typeof metaAlt.coverUrl === 'string' && metaAlt.coverUrl) {
                            coverUrl = metaAlt.coverUrl;
                            // Also adopt stored title/author if present
                            if (typeof metaAlt.title === 'string' && metaAlt.title.trim()) title = metaAlt.title;
                            if (typeof metaAlt.author === 'string' && metaAlt.author.trim()) author = metaAlt.author;
                        }
                    }
                }
                // Prefer saved title/author if present
                title = typeof meta.title === 'string' && meta.title.trim() ? meta.title : title;
                author = typeof meta.author === 'string' && meta.author.trim() ? meta.author : author;
                
                return {
                    id: filename,
                    title: title,
                    author: [author],
                    filename: filename,
                    localPath: filePath,
                    fileSize: stats.size,
                    downloadedAt: stats.mtime.toISOString(),
                    fileExtension: 'epub',
                    // Cover URL from metadata or placeholder
                    coverUrl: coverUrl || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMDZiNmQ0Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIxNHB4IiBmaWxsPSJ3aGl0ZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkVQVUI8L3RleHQ+PC9zdmc+'
                };
            });

            return { success: true, books: books };
        } catch (error) {
            console.error('Error getting EPUB library:', error);
            return { success: false, message: error.message, books: [] };
        }
    });

    // Read an EPUB file and return base64 so renderer can load it with epub.js
    ipcMain.handle('read-epub-file', async (event, filePath) => {
        try {
            if (!filePath || !fs.existsSync(filePath)) {
                return { success: false, message: 'File not found' };
            }
            const data = fs.readFileSync(filePath);
            const base64 = data.toString('base64');
            return { success: true, base64, mime: 'application/epub+zip' };
        } catch (err) {
            console.error('Error reading EPUB file:', err);
            return { success: false, message: err.message };
        }
    });

// EPUB Library functionality
    ipcMain.handle('show-save-dialog', async (event, options) => {
        try {
            const result = await dialog.showSaveDialog(mainWindow, options);
            return result;
        } catch (e) {
            console.error('Save dialog error:', e);
            return { canceled: true };
        }
    });

    ipcMain.handle('show-open-dialog', async (event, options) => {
        try {
            const result = await dialog.showOpenDialog(mainWindow, options);
            return result;
        } catch (e) {
            console.error('Open dialog error:', e);
            return { canceled: true, filePaths: [] };
        }
    });

    ipcMain.handle('write-file', async (event, filePath, data) => {
        try {
            fs.writeFileSync(filePath, data, 'utf8');
            return { success: true };
        } catch (e) {
            console.error('Write file error:', e);
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('read-file', async (event, filePath) => {
        try {
            const data = fs.readFileSync(filePath, 'utf8');
            return { success: true, data };
        } catch (e) {
            console.error('Read file error:', e);
            return { success: false, error: e.message };
        }
    });

    // Updater runtime toggle via settings UI
    ipcMain.handle('get-auto-update-enabled', async () => {
        return { success: true, enabled: !!readAutoUpdateEnabled() };
    });
    ipcMain.handle('set-auto-update-enabled', async (event, enabled) => {
        try {
            const settings = readMainSettings();
            settings.autoUpdate = !!enabled;
            writeMainSettings(settings);
            if (!enabled) {
                // Cancel any scheduled updater checks
                try { if (updaterTimers.initial) clearTimeout(updaterTimers.initial); } catch(_) {}
                try { if (updaterTimers.retry) clearTimeout(updaterTimers.retry); } catch(_) {}
                updaterActive = false;
                console.log('[Updater] Disabled by user settings');
            } else {
                // If not active yet and allowed by platform policy, initialize now
                if (!updaterActive && app.isPackaged) {
                    try { setupAutoUpdater(); } catch (e) { console.error('[Updater] re-init failed:', e?.message || e); }
                }
            }
            return { success: true, enabled: !!enabled };
        } catch (e) {
            return { success: false, error: e?.message || String(e) };
        }
    });

    // User preferences API (file-based for reliability across platforms)
    ipcMain.handle('get-user-pref', async (event, key) => {
        try {
            const settings = readMainSettings();
            const userPrefs = settings.userPrefs || {};
            return { success: true, value: userPrefs[key] };
        } catch (e) {
            return { success: false, error: e?.message || String(e) };
        }
    });
ipcMain.handle('set-user-pref', async (event, key, value) => {
    try {
        const userDataPath = app.getPath('userData');
        const settingsPath = path.join(userDataPath, 'user_settings.json');
        let settings = {};
        if (fs.existsSync(settingsPath)) {
            settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        }
        settings[key] = value;
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('set-preferred-mode', async (event, mode) => {
    try {
        const userDataPath = app.getPath('userData');
        const settingsPath = path.join(userDataPath, 'settings.json');
        let settings = {};
        if (fs.existsSync(settingsPath)) {
            settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        }
        settings.preferredMode = mode;
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        console.log('[Settings] Preferred mode updated to:', mode);
        return { success: true };
    } catch (error) {
        console.error('[Settings] Error saving preferred mode:', error.message);
        return { success: false, error: error.message };
    }
});

    // ===================================================
    // MUSIC IPC HANDLERS
    // ===================================================
    
    const SEED_ARTISTS = [
      '06HL4z0CvFAxyc27GXpf02', '3TVXtAsR1Inumwj472S9r4', '1Xyo4u8uXC1ZmMpatF05PJ',
      '66CXWjxzNUsdJxJ2JdwvnR', '4q3ewBCX7sLwd24euuV69X', '0EmeFodog0BfCgMzAIvKQp',
      '53XhwfbYqKCa1cC15pYq2q', '6eUKZXaKkcviH0Ku9w2n3V', '7dGJo4pcD2V6oG8kP0tJRR',
      '3Nrfpe0tUJi4K4DXYWgMUX'
    ];

    const SEED_TRACKS = [
      '11dFghVXANMlKmJXsNCbNl', '0VjIjW4GlUZAMYd2vXMi3b', '6UelLqGlWMcVH1E5c4H7lY',
      '3n3Ppam7vgaVa1iaRUc9Lp', '5ChkMS8OtdzJeqyybCc9R5'
    ];

    ipcMain.handle('music-get-tracks', async (event, { page, limit }) => {
        try {
            let tracks = [];
            if (page === 0) {
                try {
                    const data = await callSpotifyApi(`https://api.spotify.com/v1/recommendations?seed_artists=${SEED_ARTISTS.slice(0, 5).join(',')}&limit=${limit}`);
                    tracks = (data.tracks || []).map(formatTrack).filter(Boolean);
                } catch (error) {
                    console.error('[Tracks] Recommendations failed:', error.message);
                }
            } else if (page === 1) {
                try {
                    const data = await callSpotifyApi(`https://api.spotify.com/v1/recommendations?seed_tracks=${SEED_TRACKS.slice(0, 5).join(',')}&limit=${limit}`);
                    tracks = (data.tracks || []).map(formatTrack).filter(Boolean);
                } catch (error) {
                    console.error('[Tracks] Track recommendations failed:', error.message);
                }
            }

            if (tracks.length === 0) {
                const searchTerms = ['top hits', 'popular songs', 'best music', 'trending', 'viral', 'chart toppers', 'new music', 'hot songs'];
                const searchTerm = searchTerms[page % searchTerms.length];
                const data = await callSpotifyApi(`https://api.spotify.com/v1/search?q=${encodeURIComponent(searchTerm)}&type=track&limit=${limit}`);
                tracks = (data.tracks?.items || []).map(formatTrack).filter(Boolean);
            }
            return { success: true, tracks, hasMore: tracks.length === limit };
        } catch (err) {
            console.error('[Music] Error getting tracks:', err.message);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('music-get-albums', async (event, { page, limit }) => {
        try {
            const searchTerms = ['new releases', 'popular albums', 'top albums', 'trending albums', 'best albums'];
            const searchTerm = searchTerms[page % searchTerms.length];
            const data = await callSpotifyApi(`https://api.spotify.com/v1/search?q=${encodeURIComponent(searchTerm)}&type=album&limit=${limit}`);
            const albums = (data.albums?.items || []).map(formatAlbum).filter(Boolean);
            return { success: true, albums, hasMore: albums.length === limit };
        } catch (err) {
            console.error('[Music] Error getting albums:', err.message);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('music-search', async (event, { q, limit, type }) => {
        try {
            const data = await callSpotifyApi(`https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=${type}&limit=${Math.min(parseInt(limit), 50)}`);
            if (type === 'album') {
                const albums = (data.albums?.items || []).map(formatAlbum).filter(Boolean);
                return { success: true, results: albums };
            } else {
                const tracks = (data.tracks?.items || []).map(formatTrack).filter(Boolean);
                return { success: true, results: tracks };
            }
        } catch (error) {
            console.error('[Music] Search Error:', error.message);
            return { success: false, error: 'Search failed' };
        }
    });

    ipcMain.handle('music-get-album-tracks', async (event, { albumId }) => {
        try {
            const albumData = await callSpotifyApi(`https://api.spotify.com/v1/albums/${albumId}`);
            const tracksData = await callSpotifyApi(`https://api.spotify.com/v1/albums/${albumId}/tracks?limit=50`);
            const tracks = (tracksData.items || []).map(track => ({
                id: track.id,
                title: track.name,
                name: track.name,
                artists: track.artists?.map(a => a.name).join(', ') || 'Unknown Artist',
                duration: formatDuration(track.duration_ms),
                albumArt: albumData.images?.[0]?.url || '',
                thumbnail: albumData.images?.[0]?.url || '',
                url: track.external_urls?.spotify || ''
            })).filter(Boolean);
            return { success: true, album: formatAlbum(albumData), tracks: tracks };
        } catch (error) {
            console.error('[Music] Album Tracks Error:', error.message);
            return { success: false, error: 'Failed to load album tracks' };
        }
    });

    ipcMain.handle('music-get-stream-url', async (event, { trackId }) => {
        try {
            const track = await callSpotifyApi(`https://api.spotify.com/v1/tracks/${trackId}`);
            const title = track.name;
            const artists = track.artists.map(a => a.name).join(', ');
            const searchQuery = `ytsearch1:"${title} ${artists} official audio"`;
            const streamUrl = await getYouTubeAudioUrl(searchQuery, trackId);
            return { success: true, streamUrl };
        } catch (err) {
            console.error('[Music] Stream URL Error:', err.message);
            return { success: false, error: 'Failed to get stream URL' };
        }
    });


        // Initialize the auto-updater with platform-aware gating
        const shouldEnableUpdater = () => {
            if (!readAutoUpdateEnabled()) return false; // user disabled in settings
            if (!app.isPackaged) return false; // never in dev
            // Windows: always OK (NSIS)
            if (process.platform === 'win32') return true;
            // Linux: only when running from AppImage to avoid confusing system package installs (.deb)
            if (process.platform === 'linux') {
                const isAppImage = !!process.env.APPIMAGE;
                if (!isAppImage) {
                    console.log('[Updater] Skipping on Linux (not an AppImage run)');
                    return false;
                }
                return true;
            }
            // macOS: allow unsigned; respect explicit disable via FORCE_ENABLE_UPDATER=0
            if (process.platform === 'darwin') {
                if (process.env.FORCE_ENABLE_UPDATER === '0') {
                    console.log('[Updater] macOS updater disabled via FORCE_ENABLE_UPDATER=0');
                    return false;
                }
                return true;
            }
            return false; // other platforms not supported
        };
        try {
            if (shouldEnableUpdater()) {
                setupAutoUpdater();
            } else {
                console.log('[Updater] Not initialized (conditions not met)');
            }
        } catch (e) {
            console.error('[Updater] setup threw error (will not retry):', e?.message || e);
        }
    });
}

// ===================================================
// STREAM EXTRACTOR - HLS/DASH Stream Detection & Proxy
// ===================================================

let streamExtractionWindow = null;
let streamDetected = false;
const STREAM_PROXY_PORT = 8765;
const streamCapturedHeaders = {};
let streamProxyServer = null;

// Start stream proxy server
function startStreamProxyServer() {
    if (streamProxyServer) return;

    const express = require('express');
    const axios = require('axios');
    const cors = require('cors');
    
    const proxyApp = express();
    proxyApp.use(cors());

    proxyApp.get('/stream-proxy', async (req, res) => {
        const targetUrl = req.query.url;
        
        if (!targetUrl) {
            return res.status(400).send('Missing url parameter');
        }

        console.log('[StreamProxy] Proxying:', targetUrl);

        try {
            const headers = streamCapturedHeaders[targetUrl] || streamCapturedHeaders[Object.keys(streamCapturedHeaders)[0]] || {};
            const requestHeaders = {
                'User-Agent': headers.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': headers.referer || '',
                'Origin': headers.origin || ''
            };

            if (req.headers.range) {
                requestHeaders['Range'] = req.headers.range;
            }

            // Determine if this is a manifest or binary data
            // Only treat as manifest if it's actually a playlist file, not a segment
            const isManifest = (targetUrl.includes('.m3u8') || targetUrl.includes('.mpd')) && 
                               !targetUrl.match(/\.(ts|jpg|jpeg|png|mp4|m4s)$/i) &&
                               !targetUrl.match(/playlist_\d+/i) &&
                               !targetUrl.match(/segment|chunk|frag/i);
            const isEncryptionKey = targetUrl.includes('enc.key') || targetUrl.includes('.key');
            
            const response = await axios({
                method: 'GET',
                url: targetUrl,
                headers: requestHeaders,
                responseType: (isManifest || isEncryptionKey) ? 'arraybuffer' : 'stream',
                validateStatus: () => true
            });

            console.log('[StreamProxy] Response status:', response.status, 'for', targetUrl.substring(0, 100));

            res.status(response.status);
            
            Object.keys(response.headers).forEach(key => {
                if (key.toLowerCase() !== 'content-encoding') {
                    res.setHeader(key, response.headers[key]);
                }
            });

            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', '*');

            if (isManifest) {
                const data = response.data.toString('utf-8');
                console.log('[StreamProxy] Rewriting manifest...');
                console.log('[StreamProxy] Original manifest length:', data.length);
                console.log('[StreamProxy] Original manifest first 800 chars:\n', data.substring(0, 800));
                
                const rewritten = rewriteStreamManifest(data, targetUrl);
                
                console.log('[StreamProxy] Rewritten manifest length:', rewritten.length);
                console.log('[StreamProxy] Rewritten manifest first 800 chars:\n', rewritten.substring(0, 800));
                
                res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
                res.setHeader('Content-Length', Buffer.byteLength(rewritten, 'utf-8'));
                res.send(rewritten);
            } else if (isEncryptionKey) {
                // Send encryption key as-is (binary data)
                console.log('[StreamProxy] Proxying encryption key');
                res.setHeader('Content-Type', 'application/octet-stream');
                res.send(response.data);
            } else {
                // Stream video segments
                response.data.pipe(res);
            }
        } catch (error) {
            console.error('[StreamProxy] Error:', error.message);
            res.status(500).send('Proxy error: ' + error.message);
        }
    });

    streamProxyServer = proxyApp.listen(STREAM_PROXY_PORT, () => {
        console.log(`[StreamProxy] Server running on port ${STREAM_PROXY_PORT}`);
    });
}

function rewriteStreamManifest(content, baseUrl) {
    const base = new URL(baseUrl);
    const lines = content.split('\n');
    
    console.log('[StreamProxy] Rewriting manifest with base URL:', baseUrl);
    console.log('[StreamProxy] Total lines:', lines.length);
    
    const rewritten = lines.map((line, index) => {
        const trimmed = line.trim();
        
        // Handle empty lines
        if (trimmed === '') {
            return line;
        }
        
        // Handle #EXT-X-KEY lines with URI parameter
        if (trimmed.startsWith('#EXT-X-KEY:')) {
            const newLine = line.replace(/URI="([^"]+)"/g, (match, uri) => {
                let fullUrl;
                
                if (uri.startsWith('http://') || uri.startsWith('https://')) {
                    fullUrl = uri;
                } else if (uri.startsWith('/')) {
                    fullUrl = `${base.origin}${uri}`;
                } else {
                    const basePath = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);
                    fullUrl = `${base.origin}${basePath}${uri}`;
                }
                
                const proxied = `URI="http://localhost:${STREAM_PROXY_PORT}/stream-proxy?url=${encodeURIComponent(fullUrl)}"`;
                console.log('[StreamProxy] Rewrote encryption key URI:', uri, '->', proxied);
                return proxied;
            });
            return newLine;
        }
        
        // Handle #EXT-X-MAP lines with URI parameter (for fMP4 segments)
        if (trimmed.startsWith('#EXT-X-MAP:')) {
            const newLine = line.replace(/URI="([^"]+)"/g, (match, uri) => {
                let fullUrl;
                
                if (uri.startsWith('http://') || uri.startsWith('https://')) {
                    fullUrl = uri;
                } else if (uri.startsWith('/')) {
                    fullUrl = `${base.origin}${uri}`;
                } else {
                    const basePath = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);
                    fullUrl = `${base.origin}${basePath}${uri}`;
                }
                
                const proxied = `URI="http://localhost:${STREAM_PROXY_PORT}/stream-proxy?url=${encodeURIComponent(fullUrl)}"`;
                console.log('[StreamProxy] Rewrote map URI:', uri, '->', proxied);
                return proxied;
            });
            return newLine;
        }
        
        // Handle other comment lines (including #EXT-X-STREAM-INF, #EXT-X-MEDIA, etc.)
        if (trimmed.startsWith('#')) {
            return line;
        }
        
        // Handle URL lines (these are the actual stream URLs)
        let url = trimmed;
        let fullUrl;
        
        if (url.startsWith('http://') || url.startsWith('https://')) {
            fullUrl = url;
        } else if (url.startsWith('/')) {
            fullUrl = `${base.origin}${url}`;
        } else {
            // Relative URL - need to resolve against base
            const basePath = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);
            fullUrl = `${base.origin}${basePath}${url}`;
        }
        
        const proxied = `http://localhost:${STREAM_PROXY_PORT}/stream-proxy?url=${encodeURIComponent(fullUrl)}`;
        
        if (index < 20) { // Log first 20 URL rewrites for debugging
            console.log('[StreamProxy] Rewrote URL:', url, '->', proxied.substring(0, 100) + '...');
        }
        
        return proxied;
    }).join('\n');
    
    console.log('[StreamProxy] Manifest rewriting complete');
    return rewritten;
}

function setupStreamNetworkInterception(window) {
    const filter = { urls: ['*://*/*'] };
    streamDetected = false;
    
    window.webContents.session.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
        const url = details.url;
        
        if (url.includes('m3u8') || url.includes('mpd') || url.includes('.ts') || url.includes('.m4s') || url.includes('playlist')) {
            console.log('[StreamExtractor] Network request:', url);
        }
        
        // Detect VixSrc playlist URLs (vixsrc.to/playlist/)
        // Only detect the master playlist (with h=1 parameter), not the quality-specific ones
        if (url.includes('vixsrc.to/playlist/') && url.includes('h=1') && !streamDetected) {
            console.log('[StreamExtractor] VixSrc master playlist detected:', url);
            streamDetected = true;
            
            const pageUrl = window.webContents.getURL();
            
            streamCapturedHeaders[url] = {
                referer: details.requestHeaders['Referer'] || details.referrer || pageUrl,
                origin: details.requestHeaders['Origin'] || new URL(pageUrl).origin,
                userAgent: details.requestHeaders['User-Agent']
            };
            
            console.log('[StreamExtractor] Captured headers:', streamCapturedHeaders[url]);
            
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('stream-detected', {
                    url: url,
                    proxyUrl: `http://localhost:${STREAM_PROXY_PORT}/stream-proxy?url=${encodeURIComponent(url)}`
                });
            }
            
            setTimeout(() => {
                if (streamExtractionWindow) {
                    console.log('[StreamExtractor] Closing extraction window');
                    streamExtractionWindow.close();
                    streamExtractionWindow = null;
                }
            }, 1000);
        }
        
        // Try to reconstruct m3u8 from .ts segments (for other providers)
        if (url.includes('.ts') && !streamDetected && url.includes('/video/')) {
            const tsMatch = url.match(/^(https?:\/\/.+\/video\/\d+p\/)(\d+-\d+\.ts)(.*)$/);
            if (tsMatch) {
                const baseUrl = tsMatch[1];
                const queryParams = tsMatch[3];
                const reconstructedM3u8 = `${baseUrl}playlist.m3u8${queryParams}`;
                
                console.log('[StreamExtractor] Reconstructed m3u8 from .ts segment:', reconstructedM3u8);
                streamDetected = true;
                
                const pageUrl = window.webContents.getURL();
                
                streamCapturedHeaders[reconstructedM3u8] = {
                    referer: details.requestHeaders['Referer'] || details.referrer || pageUrl,
                    origin: details.requestHeaders['Origin'] || new URL(pageUrl).origin,
                    userAgent: details.requestHeaders['User-Agent']
                };
                
                console.log('[StreamExtractor] Captured headers:', streamCapturedHeaders[reconstructedM3u8]);
                
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('stream-detected', {
                        url: reconstructedM3u8,
                        proxyUrl: `http://localhost:${STREAM_PROXY_PORT}/stream-proxy?url=${encodeURIComponent(reconstructedM3u8)}`
                    });
                }
                
                setTimeout(() => {
                    if (streamExtractionWindow) {
                        console.log('[StreamExtractor] Closing extraction window');
                        streamExtractionWindow.close();
                        streamExtractionWindow = null;
                    }
                }, 1000);
            }
        }
        
        // Try to reconstruct mpd from .m4s segments (for DASH streams like Anitaro)
        if (url.includes('.m4s') && !streamDetected) {
            // Extract base URL from m4s segment
            // Example: https://hls-aws.shegu.net/video/1207659/video_1080p_140.m4s?... 
            // Should become: https://hls-aws.shegu.net/video/1207659/manifest.mpd
            const m4sMatch = url.match(/^(https?:\/\/[^\/]+\/[^\/]+\/\d+)\//);
            if (m4sMatch) {
                const baseUrl = m4sMatch[1];
                const reconstructedMpd = `${baseUrl}/manifest.mpd`;
                
                console.log('[StreamExtractor] Reconstructed mpd from .m4s segment:', reconstructedMpd);
                streamDetected = true;
                
                const pageUrl = window.webContents.getURL();
                
                streamCapturedHeaders[reconstructedMpd] = {
                    referer: details.requestHeaders['Referer'] || details.referrer || pageUrl,
                    origin: details.requestHeaders['Origin'] || new URL(pageUrl).origin,
                    userAgent: details.requestHeaders['User-Agent']
                };
                
                console.log('[StreamExtractor] Captured headers:', streamCapturedHeaders[reconstructedMpd]);
                
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('stream-detected', {
                        url: reconstructedMpd,
                        proxyUrl: `http://localhost:${STREAM_PROXY_PORT}/stream-proxy?url=${encodeURIComponent(reconstructedMpd)}`
                    });
                }
                
                setTimeout(() => {
                    if (streamExtractionWindow) {
                        console.log('[StreamExtractor] Closing extraction window');
                        streamExtractionWindow.close();
                        streamExtractionWindow = null;
                    }
                }, 1000);
            }
        }
        
        // Detect Anitaro/shegu.net streams (prioritize these - they have separate audio/video)
        if (url.includes('hls.shegu.net') && url.includes('.m3u8') && !streamDetected) {
            // Only detect the main master m3u8, not the video/audio specific ones
            if (!url.includes('m3u8_proxy') && !url.includes('/video/') && !url.includes('/audio/')) {
                console.log('[StreamExtractor] Anitaro master stream detected:', url);
                streamDetected = true;
                
                const pageUrl = window.webContents.getURL();
                
                streamCapturedHeaders[url] = {
                    referer: details.requestHeaders['Referer'] || details.referrer || pageUrl,
                    origin: details.requestHeaders['Origin'] || new URL(pageUrl).origin,
                    userAgent: details.requestHeaders['User-Agent']
                };
                
                console.log('[StreamExtractor] Captured headers:', streamCapturedHeaders[url]);
                
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('stream-detected', {
                        url: url,
                        proxyUrl: `http://localhost:${STREAM_PROXY_PORT}/stream-proxy?url=${encodeURIComponent(url)}`
                    });
                }
                
                setTimeout(() => {
                    if (streamExtractionWindow) {
                        console.log('[StreamExtractor] Closing extraction window');
                        streamExtractionWindow.close();
                        streamExtractionWindow = null;
                    }
                }, 1000);
                
                return callback({ requestHeaders: details.requestHeaders });
            }
        }
        
        if ((url.includes('.m3u8') || url.includes('.mpd')) && !streamDetected) {
            // Ignore tracking pixels, analytics, and URLs that have m3u8 only in query params
            if (url.includes('ping.gif') || url.includes('analytics') || url.includes('tracking') || 
                url.includes('jwplayer') || url.includes('jwpltx')) {
                return callback({ requestHeaders: details.requestHeaders });
            }
            
            const isSegment = /seg-\d+|segment|chunk|frag|\.ts\b|\.m4s\b|\.jpg|\.jpeg|\.png|\/\d+\.m3u8/i.test(url);
            const isMasterManifest = /master|playlist|index\.m3u8/i.test(url) || (!isSegment && url.includes('.m3u8'));
            
            if (isMasterManifest && !isSegment) {
                console.log('[StreamExtractor] Master stream detected:', url);
                streamDetected = true;
                
                const pageUrl = window.webContents.getURL();
                
                streamCapturedHeaders[url] = {
                    referer: details.requestHeaders['Referer'] || details.referrer || pageUrl,
                    origin: details.requestHeaders['Origin'] || new URL(pageUrl).origin,
                    userAgent: details.requestHeaders['User-Agent']
                };
                
                console.log('[StreamExtractor] Captured headers:', streamCapturedHeaders[url]);
                
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('stream-detected', {
                        url: url,
                        proxyUrl: `http://localhost:${STREAM_PROXY_PORT}/stream-proxy?url=${encodeURIComponent(url)}`
                    });
                }
                
                setTimeout(() => {
                    if (streamExtractionWindow) {
                        console.log('[StreamExtractor] Closing extraction window');
                        streamExtractionWindow.close();
                        streamExtractionWindow = null;
                    }
                }, 1000);
            }
        }
        
        callback({ requestHeaders: details.requestHeaders });
    });

    window.webContents.session.webRequest.onCompleted(filter, (details) => {
        const url = details.url;
        
        if ((url.includes('.m3u8') || url.includes('.mpd')) && details.statusCode === 200 && !streamDetected) {
            // Ignore tracking pixels, analytics, and URLs that have m3u8 only in query params
            if (url.includes('ping.gif') || url.includes('analytics') || url.includes('tracking') || 
                url.includes('jwplayer') || url.includes('jwpltx')) {
                return;
            }
            
            const isSegment = /seg-\d+|segment|chunk|frag|\.ts\b|\.m4s\b|\.jpg|\.jpeg|\.png|\/\d+\.m3u8/i.test(url);
            const isMasterManifest = /master|playlist|index\.m3u8/i.test(url) || (!isSegment && url.includes('.m3u8'));
            
            if (isMasterManifest && !isSegment && !streamCapturedHeaders[url]) {
                console.log('[StreamExtractor] Master stream detected (completed):', url);
                streamDetected = true;
                
                const pageUrl = window.webContents.getURL();
                
                streamCapturedHeaders[url] = {
                    referer: details.referrer || pageUrl,
                    origin: new URL(pageUrl).origin
                };
                
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('stream-detected', {
                        url: url,
                        proxyUrl: `http://localhost:${STREAM_PROXY_PORT}/stream-proxy?url=${encodeURIComponent(url)}`
                    });
                }
                
                setTimeout(() => {
                    if (streamExtractionWindow) {
                        console.log('[StreamExtractor] Closing extraction window');
                        streamExtractionWindow.close();
                        streamExtractionWindow = null;
                    }
                }, 1000);
            }
        }
    });
}

function simulateStreamClick(window, targetUrl) {
    if (!window || window.isDestroyed()) {
        console.log('[StreamExtractor] Window is destroyed, cannot simulate click');
        return;
    }

    const isVideasy = targetUrl.includes('videasy.net');
    
    const clickScript = `
        try {
            console.log('[StreamExtractor] Simulating single click...');
            const isVideasy = ${isVideasy};
            
            const videos = document.querySelectorAll('video');
            for (let i = 0; i < videos.length; i++) {
                videos[i].muted = true;
                videos[i].volume = 0;
            }
            
            if (isVideasy) {
                console.log('[StreamExtractor] Detected videasy.net - clicking specific play button');
                
                const buttons = document.querySelectorAll('button');
                let clicked = false;
                
                for (let i = 0; i < buttons.length; i++) {
                    const svg = buttons[i].querySelector('svg.play-icon-main');
                    if (svg) {
                        buttons[i].click();
                        console.log('[StreamExtractor] Clicked button with play-icon-main SVG');
                        clicked = true;
                        break;
                    }
                }
                
                if (!clicked) {
                    const playIcon = document.querySelector('svg.play-icon-main');
                    if (playIcon) {
                        playIcon.click();
                        console.log('[StreamExtractor] Clicked play-icon-main SVG directly');
                        clicked = true;
                    }
                }
                
                if (!clicked) {
                    const playIcon = document.querySelector('svg.play-icon-main');
                    if (playIcon && playIcon.parentElement) {
                        playIcon.parentElement.click();
                        console.log('[StreamExtractor] Clicked parent of play-icon-main');
                        clicked = true;
                    }
                }
                
                if (!clicked) {
                    const titleYear = document.querySelector('.title-year');
                    if (titleYear) {
                        const button = titleYear.querySelector('button');
                        if (button) {
                            button.click();
                            console.log('[StreamExtractor] Clicked button in title-year container');
                            clicked = true;
                        }
                    }
                }
                
                if (!clicked) {
                    console.log('[StreamExtractor] Could not find videasy play button');
                }
                
            } else {
                const width = window.innerWidth;
                const height = window.innerHeight;
                
                const centerElement = document.elementFromPoint(width / 2, height / 2);
                if (centerElement) {
                    centerElement.click();
                    console.log('Clicked center element:', centerElement.tagName);
                }
                
                const selectors = [
                    'video',
                    'iframe',
                    'button',
                    '.play',
                    '.vjs-big-play-button',
                    '[aria-label*="Play"]',
                    '[aria-label*="play"]',
                    '[class*="play"]',
                    '[id*="play"]'
                ];
                
                for (let s = 0; s < selectors.length; s++) {
                    const elements = document.querySelectorAll(selectors[s]);
                    for (let i = 0; i < elements.length; i++) {
                        const el = elements[i];
                        try {
                            el.click();
                            
                            if (el.tagName === 'VIDEO') {
                                el.muted = true;
                                el.play().catch(function() {});
                            }
                            
                            if (el.tagName === 'IFRAME') {
                                try {
                                    const iframeDoc = el.contentDocument || el.contentWindow.document;
                                    if (iframeDoc) {
                                        const iframeVideos = iframeDoc.querySelectorAll('video');
                                        for (let j = 0; j < iframeVideos.length; j++) {
                                            iframeVideos[j].muted = true;
                                            iframeVideos[j].play().catch(function() {});
                                        }
                                        
                                        const iframeButtons = iframeDoc.querySelectorAll('button, .play, .vjs-big-play-button');
                                        for (let j = 0; j < iframeButtons.length; j++) {
                                            iframeButtons[j].click();
                                        }
                                    }
                                } catch(e) {
                                    console.log('Cannot access iframe');
                                }
                            }
                        } catch(e) {}
                    }
                }
            }
            
            console.log('[StreamExtractor] Single click simulation complete');
        } catch(err) {
            console.error('Click script error:', err);
        }
    `;
    
    window.webContents.executeJavaScript(clickScript).catch(err => {
        console.error('[StreamExtractor] Failed to execute click script:', err);
    });
}

function createStreamExtractionWindow(targetUrl) {
    if (streamExtractionWindow) {
        streamExtractionWindow.close();
    }

    streamExtractionWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false,
            allowRunningInsecureContent: true
        }
    });

    streamExtractionWindow.webContents.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    streamExtractionWindow.webContents.setAudioMuted(true);

    setupStreamNetworkInterception(streamExtractionWindow);
    
    streamExtractionWindow.loadURL(targetUrl);

    streamExtractionWindow.webContents.on('did-finish-load', () => {
        console.log('[StreamExtractor] Page loaded, simulating single click...');
        setTimeout(() => {
            if (streamExtractionWindow && !streamExtractionWindow.isDestroyed()) {
                simulateStreamClick(streamExtractionWindow, targetUrl);
            } else {
                console.log('[StreamExtractor] Window was closed before click could be simulated');
            }
        }, 2000);
    });

    streamExtractionWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('[StreamExtractor] Failed to load:', errorDescription);
    });
}

// IPC handlers for stream extraction
ipcMain.handle('extract-stream', (event, url) => {
    console.log('[StreamExtractor] Starting new extraction, clearing old headers...');
    Object.keys(streamCapturedHeaders).forEach(key => delete streamCapturedHeaders[key]);
    
    if (streamExtractionWindow) {
        streamExtractionWindow.close();
        streamExtractionWindow = null;
    }
    
    createStreamExtractionWindow(url);
    return { success: true };
});

ipcMain.handle('close-stream-extraction', () => {
    if (streamExtractionWindow) {
        streamExtractionWindow.close();
        streamExtractionWindow = null;
    }
    return { success: true };
});

// Start stream proxy server on app ready
startStreamProxyServer();

// ===================================================
// END STREAM EXTRACTOR
// ===================================================

// --- Graceful shutdown flags ---
let isShuttingDown = false;
let cleanupComplete = false;

// --- Graceful shutdown function ---
async function performGracefulShutdown() {
    if (isShuttingDown) return;
    isShuttingDown = true;
    app.isQuitting = true;

    console.log('[Shutdown] Starting graceful shutdown...');

    // 3-second fallback crash (increased from 1s for WebTorrent cleanup)
    const fallback = setTimeout(() => {
        console.warn('[Shutdown] Fallback: force crash after 3s...');
        process.exit(1);
    }, 3000);

    try {
        // --- Clear API cache ---
        console.log('[Shutdown] Clearing API cache...');
        if (global.clearApiCache) {
            try { global.clearApiCache(); } catch (error) {
                console.error('[Shutdown] Error clearing cache:', error);
            }
        }

        // --- TorrServer cleanup ---
        console.log('[Shutdown] Cleaning up TorrServer...');
        if (global.cleanup) {
            try { 
                await Promise.race([
                    global.cleanup(),
                    new Promise(resolve => setTimeout(resolve, 2000)) // 2s timeout
                ]);
            } catch (error) {
                console.error('[Shutdown] Error cleaning up TorrServer:', error);
            }
        }

        // --- Discord RPC cleanup ---
        console.log('[Shutdown] Cleaning up Discord RPC...');
        if (discordRpc) {
            try { await discordRpc.clearActivity(); } catch (_) {}
            try { discordRpc.destroy(); } catch (_) {}
            discordRpc = null;
        }

        // --- Torrent-stream engines (legacy) ---
        console.log('[Shutdown] Destroying torrent-stream engines...');
        if (global.activeTorrents && global.activeTorrents.size > 0) {
            try {
                console.log(`[Shutdown] Destroying ${global.activeTorrents.size} torrent engines...`);
                for (const [hash, engine] of global.activeTorrents.entries()) {
                    try { engine.destroy(); } catch (_) {}
                }
                global.activeTorrents.clear();
                console.log('[Shutdown] Torrent engines destroyed.');
            } catch (e) {
                console.error('[Shutdown] Error during torrent cleanup:', e);
            }
        }

        // --- Clean up PlayTorrio temp folders ---
        console.log('[Shutdown] Cleaning up PlayTorrio temp folders...');
        try {
            const tempBase = process.env.TEMP || process.env.TMP || os.tmpdir();
            const foldersToDelete = [
                'playtorrio-webtorrent',
                'playtorrio-torrentstream', 
                'playtorrio-hybrid',
                'playtorrio-stream',
                'playtorrio_subs'
            ];
            
            for (const folder of foldersToDelete) {
                const folderPath = path.join(tempBase, folder);
                try {
                    if (fs.existsSync(folderPath)) {
                        await fs.promises.rm(folderPath, { recursive: true, force: true });
                        console.log(`[Shutdown] Deleted: ${folderPath}`);
                    }
                } catch (e) {
                    console.warn(`[Shutdown] Failed to delete ${folder}:`, e.message);
                }
            }
            console.log('[Shutdown] Temp folders cleanup complete.');
        } catch (e) {
            console.error('[Shutdown] Error cleaning temp folders:', e);
        }

        // --- HTTP Server ---
        console.log('[Shutdown] Closing HTTP server...');
        if (httpServer) {
            await new Promise((resolve) => {
                try {
                    if (typeof httpServer.destroyAllSockets === 'function') {
                        try {
                            const n = httpServer.getActiveSocketCount ? httpServer.getActiveSocketCount() : undefined;
                            console.log(`[Shutdown] Destroying active sockets${n !== undefined ? ` (${n})` : ''}...`);
                        } catch (_) {}
                        httpServer.destroyAllSockets();
                    } else {
                        httpServer.closeAllConnections && httpServer.closeAllConnections();
                    }

                    httpServer.close((err) => {
                        if (err) console.error('[Shutdown] HTTP server close error:', err);
                        else console.log('[Shutdown] HTTP server closed.');
                        httpServer = null;
                        resolve();
                    });

                    setTimeout(resolve, 2000); // safety timeout
                } catch (e) {
                    console.error('[Shutdown] Error closing HTTP server:', e);
                    resolve();
                }
            });
        }

        console.log('[Shutdown] Cleanup complete.');
        cleanupComplete = true;

        clearTimeout(fallback); // stop fallback crash
        process.exit(0);

    } catch (error) {
        console.error('[Shutdown] Error during shutdown:', error);
        cleanupComplete = true;
        clearTimeout(fallback);
        process.exit(1);
    }
}

// --- Attach to main window ---
if (mainWindow) { // replace mainWindow with your actual variable
    mainWindow.on('close', (e) => {
        if (!cleanupComplete) {
            console.log('[Window] Close requested; starting graceful shutdown...');
            e.preventDefault();
            performGracefulShutdown();
        }
    });
}

// --- Electron app hooks ---
app.on('before-quit', async (event) => {
    if (!cleanupComplete) {
        event.preventDefault();
        await performGracefulShutdown();
    }
});

app.on('will-quit', (event) => {
    app.isQuitting = true;

    if (!cleanupComplete) {
        console.warn('[Shutdown] Cleanup not complete in will-quit, forcing...');
        event.preventDefault();
        setTimeout(() => {
            console.warn('[Shutdown] Force exiting after will-quit timeout...');
            process.exit(0);
        }, 3000);
        performGracefulShutdown();
    }
});

// --- window-all-closed handler ---
app.on('window-all-closed', () => {
    if (!cleanupComplete) performGracefulShutdown();
    if (process.platform !== 'darwin') app.quit();
});