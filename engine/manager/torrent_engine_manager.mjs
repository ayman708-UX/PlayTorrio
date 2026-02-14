/**
 * Torrent Engine Manager - Unified interface for all torrent engines
 * Supports: Stremio, WebTorrent, TorrentStream, and Hybrid modes
 */

import * as StremioEngine from '../stremio/stremio_engine.mjs';
import * as WebTorrentEngine from '../webtorrent/webtorrent_engine.mjs';
import * as TorrentStreamEngine from '../torrentstream/torrentstream_engine.mjs';
import * as HybridEngine from '../hybrid/hybrid_engine.mjs';
import path from 'path';
import fs from 'fs';

// Engine types
export const ENGINE_TYPES = {
    STREMIO: 'stremio',
    WEBTORRENT: 'webtorrent',
    TORRENTSTREAM: 'torrentstream',
    HYBRID: 'hybrid',
};

// Current configuration
let currentEngine = ENGINE_TYPES.TORRENTSTREAM; // Default to torrent-stream for better performance
let instanceCount = 5; // Default to 5 instances for maximum peer discovery
let userDataPath = null;
let engineStopped = false; // Flag to prevent auto-restart after explicit stop

/**
 * Get the active engine module
 */
function getActiveEngine() {
    switch (currentEngine) {
        case ENGINE_TYPES.WEBTORRENT:
            return WebTorrentEngine;
        case ENGINE_TYPES.TORRENTSTREAM:
            return TorrentStreamEngine;
        case ENGINE_TYPES.HYBRID:
            return HybridEngine;
        case ENGINE_TYPES.STREMIO:
        default:
            return StremioEngine;
    }
}

/**
 * Initialize the engine manager
 */
export async function initialize(dataPath) {
    userDataPath = dataPath;
    
    // Load saved settings
    const settings = loadSettings();
    if (settings.torrentEngine) {
        currentEngine = settings.torrentEngine;
        
        // MIGRATION: Auto-migrate Stremio users to TorrentStream for better performance
        if (currentEngine === ENGINE_TYPES.STREMIO) {
            console.log(`[EngineManager] Migrating from Stremio to TorrentStream for better performance`);
            currentEngine = ENGINE_TYPES.TORRENTSTREAM;
            instanceCount = 5;
            saveSettings({
                torrentEngine: currentEngine,
                torrentEngineInstances: instanceCount,
            });
        }
    } else {
        // Default to TorrentStream with 5 instances for new installations
        currentEngine = ENGINE_TYPES.TORRENTSTREAM;
        instanceCount = 5;
        // Save the default
        saveSettings({
            torrentEngine: currentEngine,
            torrentEngineInstances: instanceCount,
        });
    }
    if (settings.torrentEngineInstances) {
        instanceCount = settings.torrentEngineInstances;
        
        // MIGRATION: Auto-upgrade users from 3 to 5 instances
        if (instanceCount === 3 && currentEngine === ENGINE_TYPES.TORRENTSTREAM) {
            console.log(`[EngineManager] Migrating from 3 to 5 instances for better performance`);
            instanceCount = 5;
            saveSettings({
                torrentEngine: currentEngine,
                torrentEngineInstances: instanceCount,
            });
        }
    }
    
    console.log(`[EngineManager] Initialized with engine: ${currentEngine}, instances: ${instanceCount}`);
}

/**
 * Load settings from file
 */
function loadSettings() {
    if (!userDataPath) return {};
    const settingsPath = path.join(userDataPath, 'settings.json');
    try {
        if (fs.existsSync(settingsPath)) {
            return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        }
    } catch (e) {
        console.error('[EngineManager] Failed to load settings:', e.message);
    }
    return {};
}

/**
 * Save settings to file
 */
function saveSettings(settings) {
    if (!userDataPath) return;
    const settingsPath = path.join(userDataPath, 'settings.json');
    try {
        const existing = loadSettings();
        const merged = { ...existing, ...settings };
        fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2));
    } catch (e) {
        console.error('[EngineManager] Failed to save settings:', e.message);
    }
}

/**
 * Set the active engine type
 */
export async function setEngine(engineType, instances = 1) {
    if (!Object.values(ENGINE_TYPES).includes(engineType)) {
        throw new Error(`Invalid engine type: ${engineType}`);
    }
    
    // Stop current engine if different
    if (currentEngine !== engineType) {
        await stopEngine();
    }
    
    currentEngine = engineType;
    instanceCount = Math.min(Math.max(instances, 1), 5); // Allow up to 5 instances
    
    // Save settings
    saveSettings({
        torrentEngine: currentEngine,
        torrentEngineInstances: instanceCount,
    });
    
    console.log(`[EngineManager] Engine set to: ${currentEngine}, instances: ${instanceCount}`);
    return { success: true, engine: currentEngine, instances: instanceCount };
}

/**
 * Get current engine configuration
 */
export function getEngineConfig() {
    return {
        engine: currentEngine,
        instances: instanceCount,
        isReady: isEngineReady(),
    };
}

/**
 * Start the current engine
 */
export async function startEngine() {
    console.log(`[EngineManager] Starting engine: ${currentEngine}`);
    engineStopped = false; // Clear the stopped flag when explicitly starting
    
    switch (currentEngine) {
        case ENGINE_TYPES.WEBTORRENT:
            return WebTorrentEngine.startEngine(instanceCount);
        case ENGINE_TYPES.TORRENTSTREAM:
            return TorrentStreamEngine.startEngine(instanceCount);
        case ENGINE_TYPES.HYBRID:
            // Split instances between both engines
            const wtCount = Math.ceil(instanceCount / 2);
            const tsCount = Math.floor(instanceCount / 2) || 1;
            return HybridEngine.startEngine(wtCount, tsCount);
        case ENGINE_TYPES.STREMIO:
        default:
            return StremioEngine.startEngine(userDataPath);
    }
}

/**
 * Stop the current engine
 */
export async function stopEngine() {
    console.log(`[EngineManager] Stopping engine: ${currentEngine}`);
    engineStopped = true; // Set flag to prevent auto-restart
    
    // Stop all engines to be safe
    await Promise.all([
        WebTorrentEngine.stopEngine().catch(() => {}),
        TorrentStreamEngine.stopEngine().catch(() => {}),
        HybridEngine.stopEngine().catch(() => {}),
        StremioEngine.stopEngine().catch(() => {}),
    ]);
    
    console.log(`[EngineManager] All engines stopped, engineStopped flag set`);
    return { success: true };
}

/**
 * Check if engine is ready
 */
export function isEngineReady() {
    const engine = getActiveEngine();
    // For Stremio, check its specific ready state
    if (currentEngine === ENGINE_TYPES.STREMIO) {
        return engine.isEngineReady();
    }
    // For other engines, check if they have been started
    try {
        return engine.isEngineReady();
    } catch {
        return false;
    }
}

/**
 * Ensure engine is started before use
 */
async function ensureEngineStarted() {
    // Don't auto-restart if engine was explicitly stopped (e.g., file picker closed)
    if (engineStopped) {
        console.log(`[EngineManager] Engine was explicitly stopped, not auto-restarting`);
        throw new Error('Engine stopped - please select a new torrent');
    }
    
    if (!isEngineReady()) {
        console.log(`[EngineManager] Engine not ready, starting ${currentEngine}...`);
        await startEngine();
    }
}

/**
 * Add a torrent
 */
export async function addTorrent(magnet) {
    // Clear the stopped flag when user explicitly adds a new torrent
    engineStopped = false;
    await ensureEngineStarted();
    const engine = getActiveEngine();
    return engine.addTorrent(magnet);
}

/**
 * Get torrent files
 */
export async function getTorrentFiles(magnet) {
    // Clear the stopped flag when user explicitly requests torrent files
    engineStopped = false;
    await ensureEngineStarted();
    return getActiveEngine().getTorrentFiles(magnet);
}

/**
 * Get file stream
 */
export function getFileStream(infoHash, fileIndex, range = null) {
    const engine = getActiveEngine();
    
    // Stremio doesn't have getFileStream, it uses proxy URLs
    if (currentEngine === ENGINE_TYPES.STREMIO) {
        return null;
    }
    
    // Normalize hash to lowercase
    const hash = infoHash.toLowerCase();
    return engine.getFileStream(hash, fileIndex, range);
}

/**
 * Get file info
 */
export function getFile(infoHash, fileIndex) {
    const engine = getActiveEngine();
    
    if (currentEngine === ENGINE_TYPES.STREMIO) {
        return null;
    }
    
    // Normalize hash to lowercase
    const hash = infoHash.toLowerCase();
    return engine.getFile(hash, fileIndex);
}

/**
 * Get stream URL
 */
export function getStreamUrl(infoHash, fileIndex) {
    switch (currentEngine) {
        case ENGINE_TYPES.WEBTORRENT:
            return `/api/wt-stream?hash=${infoHash}&file=${fileIndex}`;
        case ENGINE_TYPES.TORRENTSTREAM:
            return `/api/ts-stream?hash=${infoHash}&file=${fileIndex}`;
        case ENGINE_TYPES.HYBRID:
            return `/api/hybrid-stream?hash=${infoHash}&file=${fileIndex}`;
        case ENGINE_TYPES.STREMIO:
        default:
            return StremioEngine.getStreamUrl(infoHash, fileIndex);
    }
}

/**
 * Get torrent stats
 */
export function getStats(infoHash) {
    // Normalize hash to lowercase
    const hash = infoHash.toLowerCase();
    return getActiveEngine().getStats(hash);
}

/**
 * Remove a torrent
 */
export async function removeTorrent(infoHash) {
    // Normalize hash to lowercase
    const hash = infoHash.toLowerCase();
    return getActiveEngine().removeTorrent(hash);
}

/**
 * Get engine status
 */
export function getStatus() {
    const status = getActiveEngine().getStatus();
    return {
        ...status,
        engineType: currentEngine,
        instanceCount,
    };
}

/**
 * Clear cache for current engine
 */
export function clearCache() {
    if (currentEngine === ENGINE_TYPES.STREMIO) {
        return StremioEngine.clearStremioCache();
    }
    // Other engines clean up on stop
    return { success: true, message: 'Cache will be cleared on engine stop' };
}

export { ENGINE_TYPES as default };
