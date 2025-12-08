import { app, BrowserWindow, ipcMain, shell, clipboard, dialog, Menu } from 'electron';
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

// ===================================================
// PLATFORM-SPECIFIC INITIALIZATION
// ===================================================

// --------------------------------------------------
// LINUX APPIMAGE FIX (Electron < 9 compatible)
// --------------------------------------------------
if (process.platform === "linux") {
    console.log("[Linux] Applying AppImage compatibility patches");

    app.commandLine.appendSwitch("no-sandbox");
    app.commandLine.appendSwitch("disable-setuid-sandbox");
    app.commandLine.appendSwitch("disable-gpu-sandbox");
    app.commandLine.appendSwitch("disable-gpu");
    app.commandLine.appendSwitch("no-zygote");
    app.commandLine.appendSwitch("ignore-gpu-blacklist");

    if (process.env.APPIMAGE) {
        console.log("[Linux] Detected AppImage mode");
        app.commandLine.appendSwitch("disable-gpu");
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
let webtorrentClient;
let mainWindow;
// Updater runtime state/timers so we can disable cleanly at runtime
let updaterActive = false;
let updaterTimers = { initial: null, retry: null };


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
            const releasesUrl = 'https://github.com/ayman708-UX/PlayTorrio/releases/latest';
            console.log('[Updater] Update available. New version:', info?.version || 'unknown', 'Current:', app.getVersion());
            // Guard: Only proceed if remote version is greater than current
            if (compareVersions(info?.version, app.getVersion()) <= 0) {
                console.log('[Updater] Remote version is not greater than current; skipping download');
                return;
            }
            
            if (process.platform === 'darwin') {
                // macOS: Show native notification AND send to renderer
                const { Notification } = require('electron');
                if (Notification.isSupported()) {
                    const notification = new Notification({
                        title: 'PlayTorrio Update Available',
                        body: `Version ${info?.version || 'newer'} is available. Please download the new DMG.`,
                        silent: false
                    });
                    notification.on('click', () => {
                        shell.openExternal(releasesUrl);
                    });
                    notification.show();
                }
                
                // Also send to renderer so user sees it in the app
                try {
                    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
                        mainWindow.webContents.send('update-available', { 
                            version: info?.version,
                            manual: true,
                            platform: 'darwin',
                            downloadUrl: releasesUrl
                        });
                    }
                } catch(_) {}
                
                console.log('[Updater] macOS: User notified. Manual download required.');
                return; // Don't auto-download on macOS
            }
            
            // Windows/Linux: Send to renderer to show progress bar, then start download
            try {
                if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
                    mainWindow.webContents.send('update-available', { version: info?.version });
                }
            } catch(_) {}
            
            // Windows/Linux: start download programmatically
            try {
                console.log('[Updater] Starting update download...');
                autoUpdater.downloadUpdate().catch(e=>console.error('[Updater] downloadUpdate failed:', e?.message||e));
            } catch(_) {}
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

// Resolve bundled MPV executable path (cross-platform: Windows, macOS, Linux)
function resolveMpvExe() {
    try {
        const candidates = [];
        
        if (process.platform === 'darwin') {
            // macOS: Look for MPV.app bundle
            if (process.resourcesPath) {
                // Packaged app locations
                candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'mpv', 'mpv.app', 'Contents', 'MacOS', 'mpv'));
                candidates.push(path.join(process.resourcesPath, 'mpv', 'mpv.app', 'Contents', 'MacOS', 'mpv'));
                candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'mpv', 'IINA.app', 'Contents', 'MacOS', 'IINA'));
                candidates.push(path.join(process.resourcesPath, 'mpv', 'IINA.app', 'Contents', 'MacOS', 'IINA'));
            }
            // Development locations
            candidates.push(path.join(__dirname, 'mpv', 'mpv.app', 'Contents', 'MacOS', 'mpv'));
            candidates.push(path.join(__dirname, 'mpv', 'IINA.app', 'Contents', 'MacOS', 'IINA'));
            candidates.push(path.join(path.dirname(process.execPath), 'mpv', 'mpv.app', 'Contents', 'MacOS', 'mpv'));
            candidates.push(path.join(path.dirname(process.execPath), 'mpv', 'IINA.app', 'Contents', 'MacOS', 'IINA'));
            // System-wide fallback
            candidates.push('/Applications/mpv.app/Contents/MacOS/mpv');
            candidates.push('/Applications/IINA.app/Contents/MacOS/IINA');
        } else if (process.platform === 'win32') {
            // Windows: Look for mpv.exe
            const execDir = path.dirname(process.execPath);
            const resourcesPath = process.resourcesPath;
            
            // PACKAGED MODE
            if (resourcesPath) {
                candidates.push(path.join(resourcesPath, 'app.asar.unpacked', 'mpv', 'mpv.exe'));
                candidates.push(path.join(resourcesPath, 'mpv', 'mpv.exe'));
            }
            
            // extraResources to root
            candidates.push(path.join(execDir, 'mpv', 'mpv.exe'));
            candidates.push(path.join(execDir, 'resources', 'mpv', 'mpv.exe'));
            candidates.push(path.join(execDir, 'resources', 'app.asar.unpacked', 'mpv', 'mpv.exe'));
            
            // DEV MODE
            candidates.push(path.join(__dirname, 'mpv', 'mpv.exe'));
            
            // Additional fallbacks
            candidates.push(path.join(execDir, '..', 'mpv', 'mpv.exe'));
        } else {
            // Linux: Look for mpv binary
            if (process.resourcesPath) {
                candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'mpv', 'mpv'));
                candidates.push(path.join(process.resourcesPath, 'mpv', 'mpv'));
            }
            candidates.push(path.join(__dirname, 'mpv', 'mpv'));
            candidates.push(path.join(path.dirname(process.execPath), 'mpv', 'mpv'));
            // System-wide fallback for Linux (user installs via apt)
            candidates.push('/usr/bin/mpv');
            candidates.push('/usr/local/bin/mpv');
        }

        console.log('[MPV] Searching for MPV in', candidates.length, 'locations...');
        for (const p of candidates) {
            try { 
                if (fs.existsSync(p)) {
                    console.log('[MPV] ✓ Found executable at:', p);
                    return p;
                }
            } catch {}
        }
        console.log('[MPV] ✗ Not found. Checked:', candidates.slice(0, 8).join(', '), '+ more...');
    } catch (err) {
        console.error('[MPV] Resolver error:', err);
    }
    return null;
}

// Resolve bundled VLC executable path (cross-platform: Windows, macOS, Linux)
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
            // macOS: Look for VLC.app bundle
            if (process.resourcesPath) {
                // Packaged app locations
                candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'VLC', 'VLC.app', 'Contents', 'MacOS', 'VLC'));
                candidates.push(path.join(process.resourcesPath, 'VLC', 'VLC.app', 'Contents', 'MacOS', 'VLC'));
            }
            // Development locations
            candidates.push(path.join(__dirname, 'VLC', 'VLC.app', 'Contents', 'MacOS', 'VLC'));
            candidates.push(path.join(path.dirname(process.execPath), 'VLC', 'VLC.app', 'Contents', 'MacOS', 'VLC'));
            // System-wide fallback
            candidates.push('/Applications/VLC.app/Contents/MacOS/VLC');
        } else if (process.platform === 'win32') {
            // Windows: Consider portable, extraResources, system installs, PortableApps and user overrides
            const execDir = path.dirname(process.execPath);
            const resourcesPath = process.resourcesPath;
            const programFiles = process.env['ProgramFiles'] || 'C:/Program Files';
            const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)';
            const localAppData = process.env['LOCALAPPDATA'] || path.join(process.env['USERPROFILE'] || 'C:/Users/Default', 'AppData', 'Local');
            const portableAppsRoot = process.env['PORTABLEAPPS'] || path.join(process.env['USERPROFILE'] || 'C:/Users/Default', 'PortableApps');

            // PACKAGED MODE - resource paths
            if (resourcesPath) {
                pushUnique(path.join(resourcesPath, 'app.asar.unpacked', 'VLC', 'App', 'vlc', 'vlc.exe'));
                pushUnique(path.join(resourcesPath, 'VLC', 'App', 'vlc', 'vlc.exe'));
                pushUnique(path.join(resourcesPath, 'app.asar.unpacked', 'vlc', 'vlc.exe'));
                pushUnique(path.join(resourcesPath, 'vlc', 'vlc.exe'));
            }
            // extraResources near executable
            pushUnique(path.join(execDir, 'VLC', 'App', 'vlc', 'vlc.exe'));
            pushUnique(path.join(execDir, 'resources', 'VLC', 'App', 'vlc', 'vlc.exe'));
            pushUnique(path.join(execDir, 'resources', 'app.asar.unpacked', 'VLC', 'App', 'vlc', 'vlc.exe'));
            // Dev mode
            pushUnique(path.join(__dirname, 'VLC', 'App', 'vlc', 'vlc.exe'));
            pushUnique(path.join(__dirname, 'vlc', 'vlc.exe'));
            // Additional relative fallbacks
            pushUnique(path.join(execDir, '..', 'VLC', 'App', 'vlc', 'vlc.exe'));
            pushUnique(path.join(execDir, 'vlc', 'vlc.exe'));

            // Standard installer locations (VLC official)
            pushUnique(path.join(programFiles, 'VideoLAN', 'VLC', 'vlc.exe'));
            pushUnique(path.join(programFilesX86, 'VideoLAN', 'VLC', 'vlc.exe'));

            // Windows Store / sandboxed style (rare, but attempt)
            pushUnique(path.join(localAppData, 'Programs', 'VLC', 'vlc.exe'));
            pushUnique(path.join(localAppData, 'VideoLAN', 'VLC', 'vlc.exe'));

            // PortableApps structures
            pushUnique(path.join(portableAppsRoot, 'VLCPortable', 'App', 'vlc', 'vlc.exe'));
            pushUnique(path.join(portableAppsRoot, 'VLCPortable', 'VLCPortable.exe')); // Portable launcher (we prefer direct VLC but fallback)

            // Common user-downloaded unzip patterns
            pushUnique(path.join(execDir, 'VideoLAN', 'VLC', 'vlc.exe'));
            pushUnique(path.join(execDir, 'App', 'vlc', 'vlc.exe'));
            pushUnique(path.join(execDir, 'bin', 'vlc.exe'));
            pushUnique(path.join(execDir, 'vlc.exe'));

            // Environment variable override already added (envVlc)
            if (envVlc && envVlc.toLowerCase().endsWith('vlcportable.exe')) {
                // If user pointed to VLCPortable.exe, try deriving real vlc.exe path
                pushUnique(path.join(path.dirname(envVlc), 'App', 'vlc', 'vlc.exe'));
            }
        } else {
            // Linux: Look for vlc binary
            if (process.resourcesPath) {
                pushUnique(path.join(process.resourcesPath, 'app.asar.unpacked', 'vlc', 'vlc'));
                pushUnique(path.join(process.resourcesPath, 'vlc', 'vlc'));
            }
            pushUnique(path.join(__dirname, 'vlc', 'vlc'));
            pushUnique(path.join(path.dirname(process.execPath), 'vlc', 'vlc'));
            // System-wide fallback for Linux
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
                        console.warn('[VLC] Found VLCPortable.exe; using it as last resort. Consider bundling VLC/App/vlc/vlc.exe');
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

// Launch MPV and set up cleanup listeners
async function openInMPV(win, streamUrl, infoHash, startSeconds) {
    try {
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('[MPV] LAUNCH ATTEMPT');
        console.log('[MPV] Stream URL:', streamUrl);
        console.log('[MPV] InfoHash:', infoHash);
        console.log('[MPV] Start Time:', startSeconds || 0, 'seconds');
        
        const mpvPath = resolveMpvExe();
        console.log('[MPV] Resolved MPV path:', mpvPath);
        
        if (!mpvPath) {
            let msg = 'Bundled MPV not found. ';
            if (process.platform === 'darwin') {
                msg += 'Place mpv.app or IINA.app under the app/mpv folder, or install MPV system-wide.';
            } else if (process.platform === 'win32') {
                msg += 'Place portable mpv.exe under the app/mpv folder.';
            } else {
                msg += 'Place mpv binary under the app/mpv folder.';
            }
            console.error('[MPV] ERROR: MPV executable not found!');
            console.error('[MPV] Error message:', msg);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            return { success: false, message: msg };
        }
        
        // Detect if this is a local torrent stream (file selector from Jackett/Torrentio/Comet/PlayTorrio)
        const isLocalTorrentStream = streamUrl && (
            streamUrl.includes('localhost:6987/api/stream-file') || 
            streamUrl.includes('127.0.0.1:6987/api/stream-file') ||
            streamUrl.includes('localhost:6987/stream') || 
            streamUrl.includes('127.0.0.1:6987/stream')
        );
        
        let args = [];
        
        if (isLocalTorrentStream) {
            // Simple command for torrent streams - just open the URL
            console.log('[MPV] Using SIMPLE mode (torrent stream from file selector)');
            
            // Add force-window to show MPV immediately
            args.push('--force-window=immediate');
            args.push(streamUrl);
            
            // Give WebTorrent 1 second to start buffering before launching MPV
            // This prevents spam-clicking and ensures torrent is initializing
            console.log('[MPV] Waiting 1s for WebTorrent to initialize...');
            await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
            // Advanced buffering for debrid/direct HTTP/HLS streams
            console.log('[MPV] Using ADVANCED mode (debrid/direct stream)');
            const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
            
            args = [
                '--cache=yes',
                '--cache-secs=30',
                '--demuxer-readahead-secs=20',
                '--cache-pause=yes',
                '--force-seekable=yes',
                `--http-header-fields=User-Agent: ${userAgent}`,
                '--vd-lavc-threads=4',
                '--profile=fast',
                '--cache-on-disk=yes'
            ];
            
            // Platform-specific hardware acceleration
            if (process.platform === 'darwin') {
                // macOS: Use VideoToolbox hardware acceleration
                args.push('--hwdec=videotoolbox');
                args.push('--vo=libmpv');
            } else if (process.platform === 'win32') {
                // Windows: Use D3D11 hardware acceleration
                args.push('--hwdec=d3d11va');
                args.push('--gpu-context=d3d11');
            } else {
                // Linux: Use VAAPI or VDPAU
                args.push('--hwdec=vaapi');
            }
            
            const start = Number(startSeconds || 0);
            if (!isNaN(start) && start > 10) {
                args.push(`--start=${Math.floor(start)}`);
            }
            args.push(streamUrl);
        }
        
        console.log('[MPV] Full command line arguments:');
        args.forEach((arg, i) => console.log(`  [${i}]:`, arg));
        console.log('[MPV] Complete command:', mpvPath, args.join(' '));
        console.log('[MPV] Spawning process...');
        
        const mpvProcess = spawn(mpvPath, args, { 
            stdio: ['ignore', 'pipe', 'pipe']  // Changed from 'ignore' to capture stdout/stderr
        });
        
        console.log('[MPV] Process spawned with PID:', mpvProcess.pid);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        // Capture and log stdout
        mpvProcess.stdout.on('data', (data) => {
            const output = data.toString().trim();
            if (output) {
                console.log(`[MPV STDOUT] ${output}`);
            }
        });

        // Capture and log stderr
        mpvProcess.stderr.on('data', (data) => {
            const error = data.toString().trim();
            if (error) {
                console.error(`[MPV STDERR] ${error}`);
            }
        });

        mpvProcess.on('close', async (code, signal) => {
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('[MPV] PROCESS CLOSED');
            console.log('[MPV] Exit code:', code);
            console.log('[MPV] Exit signal:', signal);
            console.log('[MPV] InfoHash:', infoHash);
            
            if (code !== 0 && code !== null) {
                console.error('[MPV] NON-ZERO EXIT CODE - POTENTIAL CRASH!');
            }
            if (signal) {
                console.error('[MPV] TERMINATED BY SIGNAL:', signal);
            }
            
            // By request: do not disconnect torrent or delete temp when MPV closes.
            console.log('[MPV] Leaving torrent active and temp files intact.');
            
            // Clear Discord presence when MPV closes
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
                console.error('[Discord RPC] Failed to clear on MPV close:', err);
            }
            
            // Optionally inform renderer that MPV closed (no cleanup performed)
            try { win.webContents.send('mpv-closed', { infoHash, code }); } catch(_) {}
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        });

        mpvProcess.on('error', (err) => {
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.error('[MPV] PROCESS ERROR EVENT!');
            console.error('[MPV] Error type:', err.name);
            console.error('[MPV] Error message:', err.message);
            console.error('[MPV] Error code:', err.code);
            console.error('[MPV] Full error:', err);
            console.error('[MPV] Stack trace:', err.stack);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        });

        mpvProcess.on('exit', (code, signal) => {
            console.log('[MPV] EXIT event - Code:', code, 'Signal:', signal);
        });

        console.log('[MPV] All event handlers attached successfully');
        return { success: true, message: 'MPV launched successfully' };
    } catch (error) {
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error('[MPV] EXCEPTION IN openInMPV FUNCTION!');
        console.error('[MPV] Exception type:', error.name);
        console.error('[MPV] Exception message:', error.message);
        console.error('[MPV] Exception stack:', error.stack);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        return { success: false, message: 'Failed to launch MPV: ' + error.message };
    }
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
            let msg = 'Bundled VLC not found. ';
            if (process.platform === 'darwin') {
                msg += 'Place VLC.app under the app/VLC folder, or install VLC system-wide.';
            } else if (process.platform === 'win32') {
                msg += 'Place portable VLC under the app/VLC (PortableApps) or app/vlc folder.';
            } else {
                msg += 'Place vlc binary under the app/vlc folder.';
            }
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
            console.log(`VLC player closed with code ${code}. Leaving torrent active and temp files intact.`);
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

function createWindow() {
    const isMac = process.platform === 'darwin';
    const win = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1200,
        minHeight: 800,
        // Use native title bar on macOS; keep frameless custom bar on Windows/Linux
        frame: isMac ? true : false,
        titleBarStyle: isMac ? 'default' : 'hidden',
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
            partition: 'persist:playtorrio'
        },
        backgroundColor: '#120a1f',
    });
    // Remove default application menu (File/Edit/View/Help)
    try { Menu.setApplicationMenu(null); } catch(_) {}

    // Enable all permissions for iframe content
    win.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
        // Allow all permissions (autoplay, media, etc.)
        callback(true);
    });

    // Helper: allow-list for external reader/login domains
    const ALLOWED_READER_HOSTS = new Set([
        'reader.z-lib.gd',
        'reader.z-library.sk',
        'reader.z-lib.fm'
    ]);
    const isAllowedReaderDomain = (url) => {
        try {
            const { hostname } = new URL(url);
            const h = hostname.toLowerCase();
            if (ALLOWED_READER_HOSTS.has(h)) return true;
            // Allow SingleLogin for auth redirects if reader requires it
            if (h.includes('singlelogin')) return true;
            return false;
        } catch (_) { return false; }
    };

    // Intercept new windows (target=_blank) and open allowed reader domains externally
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (isAllowedReaderDomain(url)) {
            console.log('[Books] Opening reader in external browser:', url);
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
        if (isAllowedReaderDomain(url)) {
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
                    win.loadURL('http://localhost:6987').catch(e => {
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
                            await win.loadURL('http://localhost:6987');
                            console.log('[Window] UI loaded successfully');
                            return;
                        } catch (loadErr) {
                            console.error('[Window] Failed to load URL:', loadErr);
                            // Retry once
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            await win.loadURL('http://localhost:6987');
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
                await win.loadURL('http://localhost:6987');
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
                win.loadURL('http://localhost:6987').catch(e => {
                    console.error('[Window] Final load attempt failed:', e);
                });
            }
        }, 2000);
    });

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
    const childEnv = { ...process.env, PORT: '3003', ELECTRON_RUN_AS_NODE: '1', NODE_PATH: NODE_PATH_VALUE, TMDB_API_KEY: 'b3556f3b206e16f82df4d1f6fd4545e6' };
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
                                    env: { ...process.env, PORT: '3003', TMDB_API_KEY: 'b3556f3b206e16f82df4d1f6fd4545e6' },
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

/**
 * Spawn mpv.js player (Windows only)
 * @param {string} url - Stream URL
 * @param {string} tmdbId - TMDB ID
 * @param {string} seasonNum - Season number (for shows)
 * @param {string} episodeNum - Episode number (for shows)
 */
function spawnMpvJsPlayer(url, tmdbId, seasonNum = null, episodeNum = null, subtitles = null) {
    if (process.platform !== 'win32') {
        console.log('[MPV.js] Not Windows, skipping mpv.js player');
        return { success: false, message: 'mpv.js player is only available on Windows' };
    }
    
    try {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        
        const mpvJsPath = app.isPackaged
            ? path.join(process.resourcesPath, 'mpv.js-master-updated')
            : path.join(__dirname, 'mpv.js-master-updated');
        
        const electronPath = path.join(mpvJsPath, 'node_modules', 'electron', 'dist', 'electron.exe');
        const indexPath = path.join(mpvJsPath, 'example', 'index.js');

        if (!fs.existsSync(indexPath)) {
            console.error('[MPV.js] example/index.js missing at', indexPath);
            return { success: false, message: 'mpv.js example entry not found' };
        }
        if (!fs.existsSync(electronPath)) {
            console.error('[MPV.js] electron.exe missing at', electronPath);
            return { success: false, message: 'mpv.js electron runtime missing' };
        }
        
        // Build args expected by example/index.js:
        // Order: URL, TMDB ID (optional), Season (optional), Episode (optional), Subtitles JSON (optional)
        // So:
        // - Movies: [indexPath, url, tmdbId]
        // - TV:     [indexPath, url, tmdbId, seasonNum, episodeNum]
        // - Anime with subs: [indexPath, url, tmdbId, seasonNum, episodeNum, subtitlesJSON]
        let args;
        if (seasonNum && episodeNum) {
            args = [indexPath, url, tmdbId || '', String(seasonNum), String(episodeNum)];
            if (subtitles && Array.isArray(subtitles) && subtitles.length > 0) {
                args.push(JSON.stringify(subtitles));
            }
        } else {
            args = [indexPath, url, tmdbId || ''];
            if (subtitles && Array.isArray(subtitles) && subtitles.length > 0) {
                args.push('', '', JSON.stringify(subtitles)); // Empty season/episode for movies
            }
        }
        
        console.log('[MPV.js] Spawning player:', { electronPath, args, hasSubtitles: !!subtitles });
        
        const playerProcess = spawn(electronPath, args, {
            stdio: 'ignore',
            detached: false
        });
        
        playerProcess.on('error', (err) => {
            console.error('[MPV.js] Player error:', err);
        });
        
        playerProcess.on('exit', (code) => {
            console.log('[MPV.js] Player exited with code:', code);
        });
        
        return { success: true, message: 'MPV.js player launched' };
    } catch (err) {
        console.error('[MPV.js] Failed to spawn player:', err);
        return { success: false, message: err.message };
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
        const { server, client, clearCache } = startServer(app.getPath('userData'), app.getPath('exe'));
        httpServer = server;
        webtorrentClient = client;
        // Store clearCache function globally for cleanup on exit
        global.clearApiCache = clearCache;
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

    // IPC handler to open MPV from renderer
    ipcMain.handle('open-in-mpv', (event, data) => {
        const { streamUrl, infoHash, startSeconds } = data || {};
        console.log(`Received MPV open request for hash: ${infoHash}`);
            return openInMPV(mainWindow, streamUrl, infoHash, startSeconds);
    });

    // Advanced MPV launcher with headers (for MovieBox/FMovies)
    ipcMain.handle('open-mpv-headers', async (event, options) => {
        try {
            const {
                url,
                userAgent,
                referer,
                cookie,
                startSeconds,
                hlsBitrate
            } = options || {};

            if (!url) {
                return { success: false, message: 'Missing URL' };
            }

            const mpvPath = resolveMpvExe();
            if (!mpvPath) {
                return { success: false, message: 'Bundled MPV not found' };
            }

            const args = [];
            const start = Number(startSeconds || 0);
            if (!isNaN(start) && start > 10) {
                args.push(`--start=${Math.floor(start)}`);
            }

            if (userAgent) {
                args.push(`--user-agent=${userAgent}`);
            }
            if (referer) {
                args.push(`--referrer=${referer}`);
            }
            if (cookie) {
                // Pass cookie via HTTP header fields
                args.push(`--http-header-fields=Cookie: ${cookie}`);
            }
            if (typeof hlsBitrate === 'number' && hlsBitrate > 0) {
                args.push(`--hls-bitrate=${Math.floor(hlsBitrate)}`);
            }

            // Finally add the URL
            args.push(url);

            const mpvProcess = spawn(mpvPath, args, { stdio: 'ignore' });

            mpvProcess.on('close', async (code) => {
                console.log(`MPV (headers) closed with code ${code}`);
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
                    console.error('[Discord RPC] Failed to clear on MPV (headers) close:', err);
                }
            });

            mpvProcess.on('error', (err) => {
                console.error('Failed to start MPV (headers):', err);
            });

            return { success: true, message: 'MPV launched with headers' };
        } catch (e) {
            console.error('Error launching MPV with headers:', e);
            return { success: false, message: e?.message || 'Failed to launch MPV with headers' };
        }
    });

    // IPC handler to spawn mpv.js player (Windows only)
    ipcMain.handle('spawn-mpvjs-player', async (event, { url, tmdbId, seasonNum, episodeNum, subtitles }) => {
        console.log('[MPV.js] Received spawn request:', { url, tmdbId, seasonNum, episodeNum, hasSubtitles: !!subtitles });
        return spawnMpvJsPlayer(url, tmdbId, seasonNum, episodeNum, subtitles);
    });

    // Direct MPV launch for external URLs (111477, etc.)
    ipcMain.handle('open-mpv-direct', async (event, url) => {
        try {
            console.log('Opening URL in MPV (direct):', url);
            const mpvPath = resolveMpvExe();
            if (!mpvPath) {
                throw new Error('MPV not found');
            }

            // Performance-friendly defaults and UA header for direct HTTP playback (111477, etc.)
            const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
            
            // Platform-specific hardware acceleration
            const hwdecArgs = process.platform === 'darwin' 
                ? ['--hwdec=videotoolbox']  // macOS hardware acceleration
                : process.platform === 'win32'
                ? ['--hwdec=d3d11va', '--gpu-context=d3d11']  // Windows hardware acceleration
                : ['--hwdec=auto'];  // Linux auto-detect
            
            const args = [
                // Ensure MPV window opens immediately and waits while the connection/buffer starts
                '--force-window=immediate',
                '--cache=yes',
                '--cache-secs=30',
                '--demuxer-readahead-secs=20',
                '--cache-pause=yes',
                '--force-seekable=yes',
                `--http-header-fields=User-Agent: ${userAgent}`,
                '--vd-lavc-threads=4',
                ...hwdecArgs,
                '--profile=fast',
                '--cache-on-disk=yes',
                url
            ];

            const mpvProcess = spawn(mpvPath, args, { stdio: 'ignore', detached: true });
            
            // Listen for process close to clear Discord presence
            mpvProcess.on('close', async (code) => {
                console.log(`MPV (direct) closed with code ${code}`);
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
                    console.error('[Discord RPC] Failed to clear on MPV direct close:', err);
                }
            });
            
            mpvProcess.unref();
            return { success: true };
        } catch (error) {
            console.error('Error opening MPV:', error);
            return { success: false, error: error.message };
        }
    });

    // IPC handler to open IINA from renderer (macOS only)
    ipcMain.handle('open-in-iina', (event, data) => {
        const { streamUrl, infoHash, startSeconds } = data || {};
        console.log(`Received IINA open request for hash: ${infoHash}`);
        return openInIINA(mainWindow, streamUrl, infoHash, startSeconds);
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

    // Play XDmovies link on PC (opens in MPV)
    ipcMain.handle('play-xdmovies-mpv', (event, data) => {
        const { streamUrl, movieTitle, startSeconds } = data || {};
        console.log(`[XDmovies] Opening in MPV: ${movieTitle}`);
        return openInMPV(mainWindow, streamUrl, movieTitle || 'xdmovies', startSeconds);
    });

    // Play XDmovies link on Mac (opens in IINA)
    ipcMain.handle('play-xdmovies-iina', (event, data) => {
        const { streamUrl, movieTitle, startSeconds } = data || {};
        console.log(`[XDmovies] Opening in IINA: ${movieTitle}`);
        return openInIINA(mainWindow, streamUrl, movieTitle || 'xdmovies', startSeconds);
    });

    // Play XDmovies link on Linux (opens in MPV)
    ipcMain.handle('play-xdmovies-linux', (event, data) => {
        const { streamUrl, movieTitle, startSeconds } = data || {};
        console.log(`[XDmovies] Opening in MPV (Linux): ${movieTitle}`);
        return openInMPV(mainWindow, streamUrl, movieTitle || 'xdmovies', startSeconds);
    });

    // Generic XDmovies play handler (selects player based on platform)
    ipcMain.handle('play-xdmovies', (event, data) => {
        const { streamUrl, movieTitle, startSeconds } = data || {};
        console.log(`[XDmovies] Playing on platform: ${process.platform}`);
        
        if (!streamUrl) {
            return { success: false, message: 'Stream URL is required' };
        }

        if (process.platform === 'darwin') {
            // macOS: Use IINA
            return openInIINA(mainWindow, streamUrl, movieTitle || 'xdmovies', startSeconds);
        } else if (process.platform === 'linux') {
            // Linux: Use openMPVDirect (same as 111477)
            return new Promise(async (resolve) => {
                try {
                    const mpvPath = resolveMpvExe();
                    if (!mpvPath) {
                        resolve({ success: false, message: 'MPV not found' });
                        return;
                    }
                    const args = [];
                    const start = Number(startSeconds || 0);
                    if (!isNaN(start) && start > 10) {
                        args.push(`--start=${Math.floor(start)}`);
                    }
                    args.push(streamUrl);
                    const mpvProcess = spawn(mpvPath, args, { stdio: 'ignore' });
                    mpvProcess.on('close', () => {
                        console.log('[XDmovies] MPV closed');
                    });
                    resolve({ success: true, message: 'MPV launched' });
                } catch (error) {
                    console.error('[XDmovies] Error:', error);
                    resolve({ success: false, message: error.message });
                }
            });
        } else {
            // Windows: Use openMPVDirect (same as 111477) - this uses the system/global mpv
            return new Promise(async (resolve) => {
                try {
                    const mpvPath = resolveMpvExe();
                    if (!mpvPath) {
                        // Fallback: try using system mpv or just launch with the URL directly
                        try {
                            shell.openExternal(streamUrl);
                            resolve({ success: true, message: 'Opening in default player' });
                            return;
                        } catch (_) {
                            resolve({ success: false, message: 'MPV not found and cannot open externally' });
                            return;
                        }
                    }
                    const args = [];
                    const start = Number(startSeconds || 0);
                    if (!isNaN(start) && start > 10) {
                        args.push(`--start=${Math.floor(start)}`);
                    }
                    args.push(streamUrl);
                    const mpvProcess = spawn(mpvPath, args, { stdio: 'ignore' });
                    mpvProcess.on('close', () => {
                        console.log('[XDmovies] MPV closed');
                    });
                    resolve({ success: true, message: 'MPV launched' });
                } catch (error) {
                    console.error('[XDmovies] Error:', error);
                    resolve({ success: false, message: error.message });
                }
            });
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
            
            const success = results.every(r => r.success);
            const message = success
                ? 'Cache cleared: webtorrent, downloaded subtitles, and API cache.'
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

    // ----------------------
    // Music Offline Download
    // ----------------------
    const HIFI_BASE = 'https://hifi.401658.xyz';
    const offlineDir = path.join(app.getPath('userData'), 'music_offline');
    const coversDir = path.join(offlineDir, 'covers');
    const offlineIndexPath = path.join(offlineDir, 'offline_music.json');
    function ensureDirSync(dir) {
        try { fs.mkdirSync(dir, { recursive: true }); } catch(_) {}
    }
    function readOfflineIndex() {
        try {
            if (fs.existsSync(offlineIndexPath)) {
                return JSON.parse(fs.readFileSync(offlineIndexPath, 'utf8'));
            }
        } catch(_) {}
        return [];
    }
    function writeOfflineIndex(arr) {
        try { ensureDirSync(offlineDir); fs.writeFileSync(offlineIndexPath, JSON.stringify(arr, null, 2)); } catch(_) {}
    }
    function sanitizeFilename(name) {
        return (name || '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
    }
    async function downloadToFile(url, destPath) {
        await streamPipeline(got.stream(url), fs.createWriteStream(destPath));
        return destPath;
    }

    ipcMain.handle('music-download-track', async (event, track) => {
        try {
            if (!track || !track.id) return { success: false, message: 'Invalid track' };
            ensureDirSync(offlineDir); ensureDirSync(coversDir);
            const index = readOfflineIndex();
            // If already exists, return it
            const existing = index.find(e => e.id == track.id);
            if (existing && fs.existsSync(existing.filePath)) {
                return { success: true, entry: existing, already: true };
            }
            // Fetch OriginalTrackUrl
            const resp = await got(`${HIFI_BASE}/track/?id=${encodeURIComponent(track.id)}&quality=LOSSLESS`, { timeout: 20000 }).json();
            let audioUrl = null;
            if (Array.isArray(resp)) {
                for (const it of resp) {
                    const cand = it?.OriginalTrackUrl || it?.originalTrackUrl;
                    if (cand && !String(cand).includes('tidal.com/browse')) { audioUrl = cand; break; }
                }
            }
            if (!audioUrl) return { success: false, message: 'Audio URL not found' };
            const lower = audioUrl.toLowerCase();
            let ext = 'mp3';
            if (lower.includes('.flac')) ext = 'flac';
            else if (lower.includes('.m4a')) ext = 'm4a';
            else if (lower.includes('.mp4')) ext = 'mp4';
            else if (lower.includes('.aac')) ext = 'aac';
            else if (lower.includes('.ogg')) ext = 'ogg';
            const baseName = sanitizeFilename(`${track.artist || 'Artist'} - ${track.title || 'Track'}`);
            const audioPath = path.join(offlineDir, `${baseName}.${ext}`);
            await downloadToFile(audioUrl, audioPath);
            // Download cover offline if available and http(s)
            let coverPath = '';
            try {
                if (track.cover && /^https?:\/\//i.test(track.cover)) {
                    const coverExt = track.cover.toLowerCase().includes('.png') ? 'png' : 'jpg';
                    const coverName = sanitizeFilename(`${track.id}.${coverExt}`);
                    const coverDest = path.join(coversDir, coverName);
                    await downloadToFile(track.cover, coverDest);
                    coverPath = coverDest;
                }
            } catch(_) {}

            const entry = {
                id: track.id,
                title: track.title || 'Unknown Title',
                artist: track.artist || 'Unknown Artist',
                cover: coverPath || track.cover || '',
                filePath: audioPath,
                ext,
                addedAt: new Date().toISOString()
            };
            const updated = existing ? index.map(e => e.id == entry.id ? entry : e) : [...index, entry];
            writeOfflineIndex(updated);
            return { success: true, entry };
        } catch (e) {
            console.error('[Music Offline] download failed:', e);
            return { success: false, message: e?.message || 'Download failed' };
        }
    });

    ipcMain.handle('music-offline-library', async () => {
        try {
            const index = readOfflineIndex();
            // Filter out missing files
            const valid = index.filter(e => {
                try { return e.filePath && fs.existsSync(e.filePath); } catch(_) { return false; }
            });
            if (valid.length !== index.length) writeOfflineIndex(valid);
            return { success: true, items: valid };
        } catch (e) {
            return { success: false, items: [], message: e?.message || 'Failed to read offline library' };
        }
    });

    ipcMain.handle('music-offline-delete', async (event, entryId) => {
        try {
            if (!entryId) return { success: false, message: 'Missing id' };
            const index = readOfflineIndex();
            const entry = index.find(e => e.id == entryId);
            if (entry) {
                try { if (entry.filePath && fs.existsSync(entry.filePath)) fs.unlinkSync(entry.filePath); } catch(_) {}
                // Remove cover only if inside coversDir
                try {
                    if (entry.cover && entry.cover.startsWith(coversDir) && fs.existsSync(entry.cover)) fs.unlinkSync(entry.cover);
                } catch(_) {}
            }
            const updated = index.filter(e => e.id != entryId);
            writeOfflineIndex(updated);
            return { success: true };
        } catch (e) {
            return { success: false, message: e?.message || 'Failed to delete offline item' };
        }
    });

    // Playlist import/export dialog handlers
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
            const settings = readMainSettings();
            if (!settings.userPrefs) settings.userPrefs = {};
            settings.userPrefs[key] = value;
            writeMainSettings(settings);
            console.log('[UserPrefs] Saved', key, '=', value);
            return { success: true };
        } catch (e) {
            console.error('[UserPrefs] Failed to save', key, ':', e?.message);
            return { success: false, error: e?.message || String(e) };
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

// --- Graceful shutdown flags ---
let isShuttingDown = false;
let cleanupComplete = false;

// --- Graceful shutdown function ---
async function performGracefulShutdown() {
    if (isShuttingDown) return;
    isShuttingDown = true;
    app.isQuitting = true;

    console.log('[Shutdown] Starting graceful shutdown...');

    // 1-second fallback crash
    const fallback = setTimeout(() => {
        console.warn('[Shutdown] Fallback: force crash after 1s...');
        process.exit(1);
    }, 1000);

    try {
        // --- Clear API cache ---
        console.log('[Shutdown] Clearing API cache...');
        if (global.clearApiCache) {
            try { global.clearApiCache(); } catch (error) {
                console.error('[Shutdown] Error clearing cache:', error);
            }
        }

        // --- Discord RPC cleanup ---
        console.log('[Shutdown] Cleaning up Discord RPC...');
        if (discordRpc) {
            try { await discordRpc.clearActivity(); } catch (_) {}
            try { discordRpc.destroy(); } catch (_) {}
            discordRpc = null;
        }

        // --- WebTorrent client ---
        console.log('[Shutdown] Destroying WebTorrent client...');
        if (webtorrentClient) {
            await new Promise((resolve) => {
                try {
                    const torrents = webtorrentClient.torrents.slice();
                    console.log(`[Shutdown] Destroying ${torrents.length} torrents...`);
                    torrents.forEach(t => { try { t.destroy(); } catch (_) {} });

                    webtorrentClient.destroy((err) => {
                        if (err) console.error('[Shutdown] WebTorrent destroy error:', err);
                        else console.log('[Shutdown] WebTorrent client destroyed.');
                        webtorrentClient = null;
                        resolve();
                    });

                    setTimeout(resolve, 2000); // safety timeout
                } catch (e) {
                    console.error('[Shutdown] Error during WebTorrent cleanup:', e);
                    resolve();
                }
            });
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
