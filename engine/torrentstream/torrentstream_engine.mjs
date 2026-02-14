/**
 * TorrentStream Engine - Alternative torrent streaming engine
 * Uses torrent-stream for reliable streaming with aggressive optimizations
 */

import torrentStream from 'torrent-stream';
import path from 'path';
import fs from 'fs';
import os from 'os';
import parseTorrent from 'parse-torrent';

// Cross-platform temp directory
function getTempDir() {
    const tempBase = process.env.TEMP || process.env.TMP || os.tmpdir();
    const cacheDir = path.join(tempBase, 'playtorrio-torrentstream');
    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
    }
    return cacheDir;
}

// Best trackers for torrent-stream (2025 updated list)
const TRACKERS = [
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://open.stealth.si:80/announce',
    'udp://tracker.torrent.eu.org:451/announce',
    'udp://tracker.bittor.pw:1337/announce',
    'udp://public.popcorn-tracker.org:6969/announce',
    'udp://tracker.dler.org:6969/announce',
    'udp://exodus.desync.com:6969/announce',
    'udp://open.demonii.com:1337/announce',
    'udp://tracker.openbittorrent.com:6969/announce',
    'udp://explodie.org:6969/announce',
    'udp://tracker.moeking.me:6969/announce',
    'udp://tracker1.bt.moack.co.kr:80/announce',
    'udp://tracker.theoks.net:6969/announce',
    'udp://tracker-udp.gbitt.info:80/announce',
    'udp://tracker.tiny-vps.com:6969/announce',
    'udp://tracker.pomf.se:80/announce',
    'udp://tracker.leechers-paradise.org:6969/announce',
    'udp://tracker.coppersurfer.tk:6969/announce',
    'udp://tracker.internetwarriors.net:1337/announce',
    'udp://9.rarbg.to:2710/announce',
    'udp://9.rarbg.me:2710/announce',
    'http://tracker.opentrackr.org:1337/announce',
    'https://tracker.tamersunion.org:443/announce',
    'http://tracker.bt4g.com:2095/announce',
    'https://tracker.loligirl.cn:443/announce',
    'http://tracker.files.fm:6969/announce',
];

let instanceCounter = 0;

/**
 * TorrentStream Instance class
 */
class TorrentStreamInstance {
    constructor(id) {
        this.id = id;
        this.engines = new Map(); // infoHash -> engine
        this.cachePath = getTempDir();
        this.isReady = true;
        
        console.log(`[TorrentStream-${id}] Instance created, cache: ${this.cachePath}`);
    }

    /**
     * Extract info hash from magnet
     */
    _extractHash(magnet) {
        const match = magnet.match(/btih:([a-fA-F0-9]{40})/i) || 
                      magnet.match(/btih:([a-zA-Z0-9]{32})/i);
        return match ? match[1].toLowerCase() : null;
    }

    /**
     * Add a torrent and return file info
     */
    async addTorrent(magnet) {
        return new Promise((resolve, reject) => {
            const infoHash = this._extractHash(magnet);
            
            // Check if already exists
            if (infoHash && this.engines.has(infoHash)) {
                const existing = this.engines.get(infoHash);
                resolve(this._formatEngineInfo(existing.engine, infoHash));
                return;
            }

            const opts = {
                connections: 200,         // Increased from 150
                uploads: 10,              // Reduced from 15 to prioritize downloads
                tmp: this.cachePath,
                path: this.cachePath,
                verify: true,
                dht: true,
                tracker: true,
                trackers: TRACKERS,
                // Aggressive settings for faster streaming
                buffer: 30 * 1024 * 1024, // Increased to 30MB buffer
                // Piece selection for streaming
                strategy: 'rarest',
            };

            try {
                console.log(`[TorrentStream-${this.id}] Adding torrent...`);
                const engine = torrentStream(magnet, opts);
                let resolved = false;

                engine.on('ready', () => {
                    if (resolved) return;
                    resolved = true;

                    const hash = engine.infoHash;
                    this.engines.set(hash, {
                        engine,
                        addedAt: Date.now(),
                        lastAccess: Date.now(),
                    });

                    console.log(`[TorrentStream-${this.id}] Ready: ${hash.substring(0, 8)}... (${engine.files.length} files)`);
                    resolve(this._formatEngineInfo(engine, hash));
                });

                engine.on('error', (err) => {
                    if (!resolved) {
                        resolved = true;
                        console.error(`[TorrentStream-${this.id}] Error:`, err.message);
                        reject(err);
                    }
                });

                // Timeout - increased to 45s
                setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        console.error(`[TorrentStream-${this.id}] Metadata timeout`);
                        engine.destroy();
                        reject(new Error('Torrent metadata timeout'));
                    }
                }, 45000);

            } catch (err) {
                console.error(`[TorrentStream-${this.id}] Add error:`, err.message);
                reject(err);
            }
        });
    }

    _formatEngineInfo(engine, infoHash) {
        return {
            infoHash,
            name: engine.torrent?.name || 'Unknown',
            files: engine.files.map((file, index) => ({
                index,
                name: file.name,
                path: file.path,
                length: file.length,
                size: file.length,
            })),
            totalSize: engine.files.reduce((sum, f) => sum + f.length, 0),
        };
    }

    /**
     * Get a file stream with streaming optimizations
     */
    getFileStream(infoHash, fileIndex, range = null) {
        const data = this.engines.get(infoHash);
        if (!data) return null;

        const file = data.engine.files[fileIndex];
        if (!file) return null;

        // Update last access
        data.lastAccess = Date.now();

        // Deselect all other files to focus bandwidth
        data.engine.files.forEach((f, idx) => {
            if (idx !== fileIndex) {
                try { f.deselect(); } catch(e) {}
            }
        });

        // Select this file for download with priority
        file.select();
        
        // Set high priority for streaming pieces
        const engine = data.engine;
        if (engine.swarm && engine.swarm.piecesGot) {
            // Prioritize first and last 10% of pieces for quick start/seek
            const totalPieces = engine.torrent.pieces.length;
            const priorityCount = Math.ceil(totalPieces * 0.1);
            
            for (let i = 0; i < priorityCount; i++) {
                try {
                    engine.swarm.select(i, 2);  // High priority
                    engine.swarm.select(totalPieces - 1 - i, 2);
                } catch(e) {}
            }
        }

        if (range) {
            return file.createReadStream(range);
        }
        return file.createReadStream();
    }

    /**
     * Get file info
     */
    getFile(infoHash, fileIndex) {
        const data = this.engines.get(infoHash);
        if (!data) return null;
        return data.engine.files[fileIndex] || null;
    }

    /**
     * Get torrent stats
     */
    getStats(infoHash) {
        const data = this.engines.get(infoHash);
        if (!data) return null;

        const engine = data.engine;
        const swarm = engine.swarm;

        return {
            infoHash,
            name: engine.torrent?.name || 'Unknown',
            progress: engine.files.reduce((sum, f) => sum + (f.downloaded || 0), 0) / 
                      engine.files.reduce((sum, f) => sum + f.length, 0),
            downloadSpeed: swarm?.downloadSpeed() || 0,
            uploadSpeed: swarm?.uploadSpeed() || 0,
            numPeers: swarm?.wires?.length || 0,
            downloaded: engine.files.reduce((sum, f) => sum + (f.downloaded || 0), 0),
        };
    }

    /**
     * Remove a torrent
     */
    async removeTorrent(infoHash) {
        return new Promise((resolve) => {
            const data = this.engines.get(infoHash);
            if (!data) {
                resolve({ success: true });
                return;
            }

            data.engine.destroy(() => {
                this.engines.delete(infoHash);
                console.log(`[TorrentStream-${this.id}] Removed: ${infoHash.substring(0, 8)}...`);
                resolve({ success: true });
            });
        });
    }

    /**
     * Destroy this instance
     */
    async destroy() {
        const promises = [];
        for (const [hash, data] of this.engines) {
            promises.push(new Promise(resolve => {
                data.engine.destroy(resolve);
            }));
        }
        await Promise.all(promises);
        this.engines.clear();
        console.log(`[TorrentStream-${this.id}] Instance destroyed`);
    }
}

/**
 * Multi-instance TorrentStream Engine Manager
 */
class TorrentStreamEngine {
    constructor() {
        this.instances = [];
        this.instanceCount = 1;
        this.isReady = false;
    }

    /**
     * Start the engine with specified number of instances
     */
    async start(instanceCount = 5) {
        this.instanceCount = Math.min(Math.max(instanceCount, 1), 5); // Allow up to 5 instances
        
        for (let i = 0; i < this.instanceCount; i++) {
            const instance = new TorrentStreamInstance(++instanceCounter);
            this.instances.push(instance);
        }

        this.isReady = true;
        console.log(`[TorrentStreamEngine] Started with ${this.instanceCount} instance(s) for maximum peer discovery`);
        return { success: true, instances: this.instanceCount };
    }

    /**
     * Stop all instances
     */
    async stop() {
        for (const instance of this.instances) {
            await instance.destroy();
        }
        this.instances = [];
        this.isReady = false;
        
        // Clean up cache
        try {
            const cacheDir = getTempDir();
            if (fs.existsSync(cacheDir)) {
                fs.rmSync(cacheDir, { recursive: true, force: true });
                console.log(`[TorrentStreamEngine] Cache cleaned: ${cacheDir}`);
            }
        } catch (e) {
            console.error('[TorrentStreamEngine] Cache cleanup error:', e.message);
        }

        console.log('[TorrentStreamEngine] Stopped');
        return { success: true };
    }

    /**
     * Add torrent to all instances (swarm mode)
     */
    async addTorrent(magnet) {
        if (!this.isReady || this.instances.length === 0) {
            throw new Error('Engine not ready');
        }

        const results = await Promise.all(
            this.instances.map(inst => inst.addTorrent(magnet).catch(e => {
                console.error(`[TorrentStreamEngine] Instance add failed:`, e.message);
                return null;
            }))
        );

        const result = results.find(r => r !== null);
        if (!result) {
            throw new Error('Failed to add torrent to any instance - check logs for details');
        }

        return result;
    }

    /**
     * Get file stream from best instance
     */
    getFileStream(infoHash, fileIndex, range = null) {
        let bestInstance = null;
        let bestSpeed = -1;

        for (const instance of this.instances) {
            const stats = instance.getStats(infoHash);
            if (stats && stats.downloadSpeed > bestSpeed) {
                bestSpeed = stats.downloadSpeed;
                bestInstance = instance;
            }
        }

        if (!bestInstance) {
            bestInstance = this.instances.find(inst => inst.getFile(infoHash, fileIndex));
        }

        if (!bestInstance) return null;
        return bestInstance.getFileStream(infoHash, fileIndex, range);
    }

    /**
     * Get file info
     */
    getFile(infoHash, fileIndex) {
        for (const instance of this.instances) {
            const file = instance.getFile(infoHash, fileIndex);
            if (file) return file;
        }
        return null;
    }

    /**
     * Get combined stats from all instances
     */
    getStats(infoHash) {
        let combined = null;

        for (const instance of this.instances) {
            const stats = instance.getStats(infoHash);
            if (stats) {
                if (!combined) {
                    combined = { ...stats, instances: 1 };
                } else {
                    combined.downloadSpeed += stats.downloadSpeed;
                    combined.uploadSpeed += stats.uploadSpeed;
                    combined.numPeers += stats.numPeers;
                    combined.instances++;
                }
            }
        }

        return combined;
    }

    /**
     * Remove torrent from all instances
     */
    async removeTorrent(infoHash) {
        await Promise.all(
            this.instances.map(inst => inst.removeTorrent(infoHash))
        );
        return { success: true };
    }

    /**
     * Get overall status
     */
    getStatus() {
        return {
            running: this.isReady,
            instances: this.instances.length,
            activeTorrents: this.instances.reduce(
                (sum, inst) => sum + inst.engines.size, 0
            ),
        };
    }
}

// Singleton instance
let engineInstance = null;

export function getEngine() {
    if (!engineInstance) {
        engineInstance = new TorrentStreamEngine();
    }
    return engineInstance;
}

export async function startEngine(instanceCount = 5) {
    const engine = getEngine();
    if (engine.isReady) {
        return { success: true, instances: engine.instanceCount };
    }
    return engine.start(instanceCount);
}

export async function stopEngine() {
    if (engineInstance) {
        await engineInstance.stop();
        engineInstance = null;
    }
    return { success: true };
}

export function isEngineReady() {
    return engineInstance?.isReady || false;
}

export async function addTorrent(magnet) {
    return getEngine().addTorrent(magnet);
}

export function getFileStream(infoHash, fileIndex, range = null) {
    return getEngine().getFileStream(infoHash, fileIndex, range);
}

export function getFile(infoHash, fileIndex) {
    return getEngine().getFile(infoHash, fileIndex);
}

export async function getTorrentFiles(magnet) {
    const result = await addTorrent(magnet);
    
    const videoRegex = /\.(mp4|mkv|avi|mov|webm|m4v|wmv|flv|ts|m2ts)$/i;
    const subRegex = /\.(srt|vtt|ass|ssa|sub)$/i;
    
    const videoFiles = [];
    const subtitleFiles = [];
    
    (result.files || []).forEach((file, index) => {
        const fileInfo = {
            index,
            name: file.name || file.path || `File ${index}`,
            path: file.path || file.name,
            size: file.length || file.size || 0,
        };
        
        if (videoRegex.test(fileInfo.name)) {
            videoFiles.push(fileInfo);
        } else if (subRegex.test(fileInfo.name)) {
            subtitleFiles.push(fileInfo);
        }
    });
    
    videoFiles.sort((a, b) => b.size - a.size);
    
    return {
        infoHash: result.infoHash,
        name: result.name || 'Unknown',
        videoFiles,
        subtitleFiles,
        files: videoFiles,
        totalSize: result.totalSize || 0,
    };
}

export function getStats(infoHash) {
    return getEngine().getStats(infoHash);
}

export async function removeTorrent(infoHash) {
    return getEngine().removeTorrent(infoHash);
}

export function getStatus() {
    return getEngine().getStatus();
}

export function getStreamUrl(infoHash, fileIndex) {
    return `/api/torrentstream-stream?hash=${infoHash}&file=${fileIndex}`;
}

export { getTempDir, TRACKERS };
