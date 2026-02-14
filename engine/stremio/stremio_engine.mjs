/**
 * Stremio Torrent Engine Integration
 * Uses the bundled Stremio server.js for FAST torrent streaming
 */

import { spawn, fork } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Engine configuration
const ENGINE_PORT = 6988;
const ENGINE_URL = `http://127.0.0.1:${ENGINE_PORT}`;

let engineProcess = null;
let isReady = false;
let cachePath = null;
let ffmpegPath = null;
let ffprobePath = null;
let logFile = null;

// Track active torrents
const activeTorrents = new Map();
const torrentTimestamps = new Map();

/**
 * Log to file for debugging in production builds
 */
function logToFile(message) {
    const timestamp = new Date().toISOString();
    const logMsg = `[${timestamp}] ${message}\n`;
    console.log(message);
    if (logFile) {
        try {
            fs.appendFileSync(logFile, logMsg);
        } catch (e) {}
    }
}

/**
 * Check if we're running in a packaged Electron app
 */
function isPackaged() {
    // In packaged apps, __dirname will contain 'app.asar'
    return __dirname.includes('app.asar') || (process.resourcesPath && fs.existsSync(path.join(process.resourcesPath, 'app.asar')));
}

/**
 * Get path to engine/server.cjs (in parent directory)
 * Handles both development and production (asar unpacked) paths
 */
function getEnginePath() {
    // Try multiple possible locations
    const possiblePaths = [
        // Development / unpacked from asar - server.cjs is in parent engine folder
        path.join(__dirname, '..', 'server.cjs'),
        // Inside asar but unpacked (when __dirname is inside app.asar)
        path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), '..', 'server.cjs'),
        // Production: resources/app.asar.unpacked/engine
        path.join(process.resourcesPath || '', 'app.asar.unpacked', 'engine', 'server.cjs'),
    ];
    
    logToFile(`[StremioEngine] __dirname: ${__dirname}`);
    logToFile(`[StremioEngine] process.resourcesPath: ${process.resourcesPath || 'undefined'}`);
    logToFile(`[StremioEngine] isPackaged: ${isPackaged()}`);
    
    for (const enginePath of possiblePaths) {
        logToFile(`[StremioEngine] Checking: ${enginePath}`);
        if (fs.existsSync(enginePath)) {
            logToFile(`[StremioEngine] Found engine at: ${enginePath}`);
            return enginePath;
        }
    }
    
    logToFile('[StremioEngine] Engine not found in any location!');
    return null;
}

/**
 * Wait for engine to be ready
 */
async function waitForReady(maxAttempts = 60, delayMs = 500) {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const response = await fetch(`${ENGINE_URL}/stats.json`, { timeout: 2000 });
            if (response.ok) {
                return true;
            }
        } catch (e) {
            // Not ready yet
        }
        await new Promise(r => setTimeout(r, delayMs));
    }
    return false;
}

/**
 * Start the Stremio engine
 */
export async function startEngine(userDataPath, ffmpegBin = null, ffprobeBin = null) {
    // Set up log file in userData for debugging
    logFile = path.join(userDataPath, 'stremio_engine.log');
    try {
        fs.writeFileSync(logFile, `=== Stremio Engine Log Started ${new Date().toISOString()} ===\n`);
    } catch (e) {}
    
    logToFile(`[StremioEngine] startEngine called`);
    logToFile(`[StremioEngine] userDataPath: ${userDataPath}`);
    logToFile(`[StremioEngine] process.execPath: ${process.execPath}`);
    
    if (isReady && engineProcess) {
        logToFile('[StremioEngine] Already running');
        return { success: true, url: ENGINE_URL };
    }
    
    const enginePath = getEnginePath();
    if (!enginePath) {
        logToFile('[StremioEngine] ERROR: Engine not found!');
        throw new Error('Stremio engine not found in /engine folder');
    }
    
    // Store FFmpeg paths
    ffmpegPath = ffmpegBin;
    ffprobePath = ffprobeBin;
    
    // Set up cache path - engine will create stremio-cache subfolder
    cachePath = userDataPath;
    
    logToFile(`[StremioEngine] Starting from: ${enginePath}`);
    logToFile(`[StremioEngine] Data path: ${cachePath}`);
    logToFile(`[StremioEngine] FFmpeg: ${ffmpegPath || 'system'}`);
    
    // Build environment with FFmpeg paths
    const engineEnv = {
        ...process.env,
        STREMIO_CACHE: cachePath,
        ENGINE_PORT: String(ENGINE_PORT),
        STREAMING_SERVER_PORT: String(ENGINE_PORT),  // New server.js uses this
        PORT: String(ENGINE_PORT),  // Fallback
        NO_CORS: '1',
        APP_PATH: cachePath,
        STREMIO_PATH: cachePath
    };
    
    // Add FFmpeg paths if provided - use multiple env var names for compatibility
    if (ffmpegPath) {
        engineEnv.FFMPEG_BIN = ffmpegPath;
        engineEnv.FFMPEG_PATH = ffmpegPath;
        engineEnv.FFMPEG = ffmpegPath;
    }
    if (ffprobePath) {
        engineEnv.FFPROBE_BIN = ffprobePath;
        engineEnv.FFPROBE_PATH = ffprobePath;
        engineEnv.FFPROBE = ffprobePath;
    }
    
    logToFile(`[StremioEngine] Spawning engine...`);
    
    // In packaged Electron apps, we need to use fork() which properly uses
    // Electron's embedded Node.js runtime. In development, we can use either.
    try {
        if (isPackaged()) {
            // For packaged apps, use spawn with electron as node
            // Electron can run .cjs files when passed as argument
            logToFile(`[StremioEngine] Using spawn with process.execPath for packaged app`);
            engineProcess = spawn(process.execPath, [enginePath], {
                env: {
                    ...engineEnv,
                    ELECTRON_RUN_AS_NODE: '1'  // This makes Electron act as Node.js
                },
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: false,
                windowsHide: true
            });
        } else {
            // Development mode - use fork
            logToFile(`[StremioEngine] Using fork for development`);
            engineProcess = fork(enginePath, [], {
                env: engineEnv,
                stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
                detached: false,
                windowsHide: true
            });
        }
    } catch (spawnError) {
        logToFile(`[StremioEngine] Spawn/fork error: ${spawnError.message}`);
        throw spawnError;
    }
    
    engineProcess.stdout?.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg && !msg.includes('DEBUG')) {
            logToFile(`[StremioEngine] ${msg}`);
        }
    });
    
    engineProcess.stderr?.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg) {
            logToFile(`[StremioEngine] STDERR: ${msg}`);
        }
    });
    
    engineProcess.on('error', (err) => {
        logToFile(`[StremioEngine] Process error: ${err.message}`);
        isReady = false;
    });
    
    engineProcess.on('exit', (code) => {
        logToFile(`[StremioEngine] Process exited with code ${code}`);
        isReady = false;
        engineProcess = null;
    });
    
    // Wait for engine to be ready
    console.log('[StremioEngine] Waiting for engine to start...');
    const ready = await waitForReady(60, 500);
    
    if (!ready) {
        throw new Error('Stremio engine failed to start');
    }
    
    isReady = true;
    console.log(`[StremioEngine] ⚡ Engine ready at ${ENGINE_URL}`);
    
    return { success: true, url: ENGINE_URL };
}

/**
 * Stop the engine
 */
export async function stopEngine() {
    if (!engineProcess) {
        return { success: true };
    }
    
    console.log('[StremioEngine] Stopping...');
    
    try {
        // Remove all torrents first
        try {
            await fetch(`${ENGINE_URL}/removeAll`, { timeout: 2000 });
        } catch (e) {}
        
        // Kill process
        engineProcess.kill('SIGTERM');
        await new Promise(r => setTimeout(r, 500));
        
        if (engineProcess && !engineProcess.killed) {
            engineProcess.kill('SIGKILL');
        }
    } catch (e) {}
    
    engineProcess = null;
    isReady = false;
    activeTorrents.clear();
    torrentTimestamps.clear();
    
    // Clean up cache directory
    const cacheDir = path.join(cachePath, 'stremio-cache');
    if (cacheDir && fs.existsSync(cacheDir)) {
        try {
            fs.rmSync(cacheDir, { recursive: true, force: true });
            console.log(`[StremioEngine] Cache cleaned: ${cacheDir}`);
        } catch (e) {
            console.error('[StremioEngine] Cache cleanup error:', e.message);
        }
    }
    
    console.log('[StremioEngine] Stopped');
    return { success: true };
}

/**
 * Check if engine is ready
 */
export function isEngineReady() {
    return isReady;
}

/**
 * Extract info hash from magnet
 */
function extractHash(magnet) {
    const match = magnet.match(/btih:([a-fA-F0-9]{40})/i) || magnet.match(/btih:([a-zA-Z0-9]{32})/i);
    return match ? match[1].toLowerCase() : null;
}

/**
 * Add a torrent and get file list
 */
export async function addTorrent(magnet) {
    if (!isReady) {
        throw new Error('Engine not ready');
    }
    
    const infoHash = extractHash(magnet);
    if (!infoHash) {
        throw new Error('Invalid magnet link');
    }
    
    console.log(`[StremioEngine] Creating torrent for ${infoHash.substring(0, 8)}...`);
    
    try {
        // Create torrent in engine - use settings similar to actual Stremio
        const createUrl = `${ENGINE_URL}/${infoHash}/create`;
        const createBody = {
            uri: magnet,
            // Use Stremio's actual peer search settings
            peerSearch: { 
                min: 5,   // btMinPeersForStable from Stremio settings
                max: 55,  // btMaxConnections from Stremio settings
                sources: [
                    'dht:' + infoHash,
                    'tracker:' + infoHash
                ]
            }
        };
        
        console.log(`[StremioEngine] POST ${createUrl}`);
        console.log(`[StremioEngine] Body:`, JSON.stringify(createBody, null, 2));
        
        // The /create endpoint in server.cjs waits for the engine to be ready before responding,
        // which can take a long time. So we'll fire the request and don't wait for response.
        // Instead, we'll immediately start polling the stats endpoint.
        
        // Fire and forget the create request
        fetch(createUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(createBody)
        }).catch(e => {
            console.error(`[StremioEngine] Create request error:`, e.message);
        });
        
        console.log(`[StremioEngine] Create request sent, will poll for metadata...`);
        
        // IMPORTANT: To trigger metadata fetching in torrent-stream, we need to actually
        // request a file. Make a HEAD request to file 0 to trigger the download.
        // This is fire-and-forget, just to wake up the engine.
        setTimeout(() => {
            console.log(`[StremioEngine] Triggering metadata fetch by requesting file 0...`);
            fetch(`${ENGINE_URL}/${infoHash}/0`, { method: 'HEAD' })
                .catch(e => console.log(`[StremioEngine] File trigger request (expected to fail):`, e.message));
        }, 1000);
        
        // Track locally
        activeTorrents.set(infoHash, { magnet, addedAt: Date.now() });
        torrentTimestamps.set(infoHash, Date.now());
        
        // Return immediately with empty files - we'll poll for them
        return {
            infoHash,
            files: []
        };
    } catch (error) {
        console.error('[StremioEngine] Add error:', error.message);
        throw error;
    }
}

/**
 * Get torrent files
 */
export async function getTorrentFiles(magnet) {
    console.log(`[StremioEngine] getTorrentFiles called`);
    const result = await addTorrent(magnet);
    
    console.log(`[StremioEngine] addTorrent returned, files count: ${result.files?.length || 0}`);
    
    // If files are already available, return immediately
    if (result.files && result.files.length > 0) {
        console.log(`[StremioEngine] Files available immediately, processing...`);
        return processFiles(result);
    }
    
    // Otherwise, poll for metadata (max 2 minutes)
    const infoHash = result.infoHash;
    const maxAttempts = 120; // 2 minutes with 1 second intervals
    
    console.log(`[StremioEngine] No files yet, waiting for engine to fetch metadata...`);
    console.log(`[StremioEngine] This can take 10-30 seconds depending on seeders and DHT response`);
    
    // Give the engine some time to start connecting to peers before we start polling
    console.log(`[StremioEngine] Initial wait: 3 seconds...`);
    await new Promise(r => setTimeout(r, 3000));
    
    for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, 1000)); // Wait 1 second between polls
        
        try {
            const stats = await getStats(infoHash);
            
            if (stats) {
                console.log(`[StremioEngine] Poll ${i + 1}/${maxAttempts}: Got stats with keys:`, Object.keys(stats));
                
                // Check multiple possible locations for files
                const files = stats.files || stats.torrent?.files || [];
                
                if (files.length > 0) {
                    console.log(`[StremioEngine] ✓ Metadata received after ${i + 3} seconds, ${files.length} files`);
                    return processFiles({ ...result, files, ...stats });
                }
                
                // Log progress indicators
                if (stats.peers !== undefined) {
                    console.log(`[StremioEngine] Poll ${i + 1}: ${stats.peers || 0} peers, ${stats.downloaded || 0} bytes downloaded`);
                }
            } else {
                if (i % 10 === 0) { // Log every 10 seconds
                    console.log(`[StremioEngine] Poll ${i + 1}/${maxAttempts}: Still waiting for stats...`);
                }
            }
        } catch (e) {
            console.error(`[StremioEngine] Poll ${i + 1} error:`, e.message);
            // Continue polling
        }
    }
    
    console.error(`[StremioEngine] Timeout after ${maxAttempts} seconds`);
    throw new Error('Timeout waiting for torrent metadata');
}

function processFiles(result) {
    const videoRegex = /\.(mp4|mkv|avi|mov|webm|m4v|wmv|flv|ts|m2ts)$/i;
    const subRegex = /\.(srt|vtt|ass|ssa|sub)$/i;
    
    const videoFiles = [];
    const subtitleFiles = [];
    
    (result.files || []).forEach((file, index) => {
        const fileInfo = {
            index,
            name: file.name || file.path || `File ${index}`,
            path: file.path || file.name,
            size: file.length || file.size || 0
        };
        
        if (videoRegex.test(fileInfo.name)) {
            videoFiles.push(fileInfo);
        } else if (subRegex.test(fileInfo.name)) {
            subtitleFiles.push(fileInfo);
        }
    });
    
    // Sort by size
    videoFiles.sort((a, b) => b.size - a.size);
    
    return {
        infoHash: result.infoHash,
        name: result.name || 'Unknown',
        videoFiles,
        subtitleFiles,
        files: videoFiles,
        totalSize: result.files?.reduce((sum, f) => sum + (f.length || f.size || 0), 0) || 0
    };
}

/**
 * Get stream URL for a file
 */
export function getStreamUrl(infoHash, fileIndex) {
    return `${ENGINE_URL}/${infoHash}/${fileIndex}`;
}

/**
 * Get torrent stats
 */
export async function getStats(infoHash) {
    if (!isReady) {
        console.log(`[StremioEngine] getStats: Engine not ready`);
        return null;
    }
    
    try {
        const statsUrl = `${ENGINE_URL}/${infoHash}/stats.json`;
        const response = await fetch(statsUrl, { timeout: 5000 });
        
        if (response.ok) {
            const stats = await response.json();
            torrentTimestamps.set(infoHash, Date.now());
            
            // Log what we got
            if (stats) {
                const keys = Object.keys(stats);
                const hasFiles = stats.files || stats.torrent?.files;
                console.log(`[StremioEngine] getStats: Got response with keys [${keys.join(', ')}], files: ${hasFiles ? hasFiles.length : 0}`);
            }
            
            return stats;
        } else {
            console.log(`[StremioEngine] getStats: Response not OK (${response.status})`);
        }
    } catch (e) {
        console.error(`[StremioEngine] getStats error:`, e.message);
    }
    
    return null;
}

/**
 * Remove a torrent
 */
export async function removeTorrent(hash) {
    const infoHash = hash.toLowerCase();
    
    try {
        await fetch(`${ENGINE_URL}/${infoHash}/remove`);
        activeTorrents.delete(infoHash);
        torrentTimestamps.delete(infoHash);
        console.log(`[StremioEngine] Removed: ${infoHash.substring(0, 8)}...`);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * Get overall status
 */
export async function getStatus() {
    if (!isReady) {
        return { running: false, activeTorrents: 0 };
    }
    
    try {
        const response = await fetch(`${ENGINE_URL}/stats.json`);
        if (response.ok) {
            const stats = await response.json();
            return {
                running: true,
                url: ENGINE_URL,
                activeTorrents: Object.keys(stats).length,
                stats
            };
        }
    } catch (e) {}
    
    return { running: true, activeTorrents: activeTorrents.size };
}

// Auto-cleanup inactive torrents
setInterval(async () => {
    if (!isReady) return;
    
    const now = Date.now();
    const TIMEOUT = 30 * 60 * 1000;
    
    for (const [hash, timestamp] of torrentTimestamps.entries()) {
        if (now - timestamp > TIMEOUT) {
            console.log(`[StremioEngine] Auto-removing: ${hash.substring(0, 8)}...`);
            await removeTorrent(hash);
        }
    }
}, 10 * 60 * 1000);

/**
 * Clear the stremio cache directory
 */
export function clearStremioCache() {
    if (!cachePath) {
        return { success: false, message: 'Cache path not set' };
    }
    
    const cacheDir = path.join(cachePath, 'stremio-cache');
    if (fs.existsSync(cacheDir)) {
        try {
            fs.rmSync(cacheDir, { recursive: true, force: true });
            console.log(`[StremioEngine] Cache cleared: ${cacheDir}`);
            return { success: true, message: `Stremio cache cleared: ${cacheDir}` };
        } catch (e) {
            console.error('[StremioEngine] Cache cleanup error:', e.message);
            return { success: false, message: `Failed to clear stremio cache: ${e.message}` };
        }
    }
    
    return { success: true, message: 'Stremio cache already empty' };
}

export { activeTorrents, torrentTimestamps, ENGINE_URL };
