/**
 * Stremio Engine Routes
 * Fast torrent streaming using Stremio's engine
 */

import * as StremioEngine from './engine/stremio/stremio_engine.mjs';
import fetch from 'node-fetch';

const selectedFiles = new Map();

/**
 * Register Stremio engine routes
 */
export function registerStremioRoutes(app, userDataPath, ffmpegBin = null, ffprobeBin = null) {
    // Start engine immediately on app startup (idle/warm start)
    console.log('[StremioRoutes] Starting engine on app startup...');
    StremioEngine.startEngine(userDataPath, ffmpegBin, ffprobeBin).then(() => {
        console.log('[StremioRoutes] ⚡ Engine started and ready (idle mode)');
    }).catch(err => {
        console.error('[StremioRoutes] Failed to start engine on startup:', err.message);
        console.log('[StremioRoutes] Engine will auto-start on first request');
    });

    // ============================================================================
    // GET FILES - Get list of files in a torrent
    // ============================================================================
    app.get('/api/torrent-files', async (req, res) => {
        try {
            const { magnet } = req.query;
            if (!magnet) return res.status(400).json({ error: 'Missing magnet' });
            
            // Auto-start engine if not ready (similar to alt-torrent-files)
            if (!StremioEngine.isEngineReady()) {
                console.log('[StremioRoutes] Engine not ready, starting...');
                try {
                    await StremioEngine.startEngine(userDataPath, ffmpegBin, ffprobeBin);
                } catch (startError) {
                    console.error('[StremioRoutes] Failed to start engine:', startError.message);
                    return res.status(503).json({ error: 'Failed to start engine: ' + startError.message });
                }
            }
            
            console.log(`[StremioRoutes] Getting files: ${magnet.substring(0, 60)}...`);
            
            // No timeout - let the user cancel via the UI cancel button
            const result = await StremioEngine.getTorrentFiles(magnet);
            
            res.json(result);
        } catch (error) {
            console.error('[StremioRoutes] Get files error:', error.message);
            res.status(500).json({ error: error.message });
        }
    });

    // ============================================================================
    // TORRENT INFO - Get info for active torrent
    // ============================================================================
    app.get('/api/torrent-info', async (req, res) => {
        try {
            const { hash } = req.query;
            if (!hash) return res.status(400).json({ error: 'Missing hash' });
            
            const stats = await StremioEngine.getStats(hash);
            if (!stats) {
                return res.status(404).json({ error: 'Torrent not found' });
            }
            
            res.json({
                infoHash: hash,
                ...stats
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // ============================================================================
    // STREAM FILE - Proxy stream from Stremio engine
    // ============================================================================
    app.get('/api/stream-file', async (req, res) => {
        try {
            const { hash, file: fileIndex } = req.query;
            if (!hash || fileIndex === undefined) {
                return res.status(400).json({ error: 'Missing hash or file index' });
            }
            
            // Auto-start engine if not ready
            if (!StremioEngine.isEngineReady()) {
                console.log('[StremioRoutes] Engine not ready for streaming, starting...');
                try {
                    await StremioEngine.startEngine(userDataPath);
                } catch (startError) {
                    console.error('[StremioRoutes] Failed to start engine:', startError.message);
                    return res.status(503).json({ error: 'Failed to start engine: ' + startError.message });
                }
            }
            
            selectedFiles.set(hash, Number(fileIndex));
            
            // Get stream URL from engine
            const streamUrl = StremioEngine.getStreamUrl(hash, fileIndex);
            
            console.log(`[StremioRoutes] Streaming: ${hash.substring(0, 8)}/${fileIndex}`);
            
            // Proxy the request to Stremio engine
            const headers = {};
            if (req.headers.range) {
                headers['Range'] = req.headers.range;
            }
            
            const response = await fetch(streamUrl, { headers });
            
            // Forward response headers
            const resHeaders = {
                'Content-Type': response.headers.get('content-type') || 'video/mp4',
                'Accept-Ranges': 'bytes'
            };
            
            if (response.headers.get('content-length')) {
                resHeaders['Content-Length'] = response.headers.get('content-length');
            }
            if (response.headers.get('content-range')) {
                resHeaders['Content-Range'] = response.headers.get('content-range');
            }
            
            res.writeHead(response.status, resHeaders);
            response.body.pipe(res);
            
            res.on('close', () => {
                try { response.body.destroy(); } catch {}
            });
        } catch (error) {
            console.error('[StremioRoutes] Stream error:', error.message);
            if (!res.headersSent) {
                res.status(500).json({ error: error.message });
            }
        }
    });

    // ============================================================================
    // HLS STREAM - Proxy HLS from Stremio engine (for HTML5 player transcoding)
    // ============================================================================
    app.get('/api/hls/:hash/:file/*', async (req, res) => {
        try {
            const { hash, file } = req.params;
            const hlsPath = req.params[0] || 'hls.m3u8';
            
            if (!StremioEngine.isEngineReady()) {
                return res.status(503).json({ error: 'Engine not ready' });
            }
            
            // Build HLS URL to Stremio engine
            const hlsUrl = `${StremioEngine.ENGINE_URL}/${hash}/${file}/${hlsPath}`;
            
            console.log(`[StremioRoutes] HLS: ${hash.substring(0, 8)}/${file}/${hlsPath}`);
            
            const response = await fetch(hlsUrl);
            
            // Determine content type
            let contentType = 'application/vnd.apple.mpegurl';
            if (hlsPath.endsWith('.ts')) {
                contentType = 'video/mp2t';
            } else if (hlsPath.endsWith('.mp4') || hlsPath.endsWith('.m4s')) {
                contentType = 'video/mp4';
            }
            
            res.writeHead(response.status, {
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-cache'
            });
            
            response.body.pipe(res);
            
            res.on('close', () => {
                try { response.body.destroy(); } catch {}
            });
        } catch (error) {
            console.error('[StremioRoutes] HLS error:', error.message);
            if (!res.headersSent) {
                res.status(500).json({ error: error.message });
            }
        }
    });

    // ============================================================================
    // HLS V2 STREAM - Proxy HLSv2 transcoding from Stremio engine
    // This is the FAST hardware-accelerated transcoder
    // ============================================================================
    app.get('/api/hlsv2/:id/*', async (req, res) => {
        try {
            const { id } = req.params;
            const hlsPath = req.params[0] || 'master.m3u8';
            const queryString = req.url.includes('?') ? req.url.split('?')[1] : '';
            
            if (!StremioEngine.isEngineReady()) {
                return res.status(503).json({ error: 'Engine not ready' });
            }
            
            // Build HLSv2 URL to Stremio engine
            let hlsUrl = `${StremioEngine.ENGINE_URL}/hlsv2/${id}/${hlsPath}`;
            if (queryString) {
                hlsUrl += '?' + queryString;
            }
            
            console.log(`[StremioRoutes] HLSv2: ${id}/${hlsPath}`);
            
            const response = await fetch(hlsUrl);
            
            // Determine content type
            let contentType = 'application/vnd.apple.mpegurl';
            if (hlsPath.endsWith('.ts')) {
                contentType = 'video/mp2t';
            } else if (hlsPath.endsWith('.mp4') || hlsPath.endsWith('.m4s')) {
                contentType = 'video/mp4';
            } else if (hlsPath.endsWith('.vtt')) {
                contentType = 'text/vtt';
            }
            
            // For m3u8 files, we need to rewrite URLs to go through our proxy
            if (hlsPath.endsWith('.m3u8')) {
                const text = await response.text();
                // Rewrite URLs in the playlist to go through our proxy
                const rewritten = text.replace(
                    /^(?!#)(.+)$/gm,
                    (match) => {
                        if (match.startsWith('http')) return match;
                        return `/api/hlsv2/${id}/${match}`;
                    }
                );
                res.writeHead(200, {
                    'Content-Type': contentType,
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'no-cache'
                });
                res.end(rewritten);
            } else {
                res.writeHead(response.status, {
                    'Content-Type': contentType,
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'no-cache'
                });
                response.body.pipe(res);
                
                res.on('close', () => {
                    try { response.body.destroy(); } catch {}
                });
            }
        } catch (error) {
            console.error('[StremioRoutes] HLSv2 error:', error.message);
            if (!res.headersSent) {
                res.status(500).json({ error: error.message });
            }
        }
    });

    // ============================================================================
    // PREPARE FILE - Pre-select file
    // ============================================================================
    app.get('/api/prepare-file', async (req, res) => {
        try {
            const { hash, file: fileIndex } = req.query;
            if (!hash || fileIndex === undefined) {
                return res.status(400).json({ success: false, error: 'Missing params' });
            }
            
            selectedFiles.set(hash, Number(fileIndex));
            
            res.json({
                success: true,
                infoHash: hash,
                streamUrl: StremioEngine.getStreamUrl(hash, fileIndex)
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ============================================================================
    // STOP STREAM - Remove torrent
    // ============================================================================
    app.get('/api/stop-stream', async (req, res) => {
        try {
            const { hash } = req.query;
            if (!hash) return res.status(400).json({ error: 'Missing hash' });
            
            console.log(`[StremioRoutes] Stopping: ${hash.substring(0, 8)}...`);
            
            await StremioEngine.removeTorrent(hash);
            selectedFiles.delete(hash);
            
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ============================================================================
    // TORRENT STATS
    // ============================================================================
    app.get('/api/torrent-stats', async (req, res) => {
        try {
            const { hash } = req.query;
            if (!hash) return res.status(400).json({ error: 'Missing hash' });
            
            const stats = await StremioEngine.getStats(hash);
            res.json(stats || { error: 'Not found' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // ============================================================================
    // STATUS
    // ============================================================================
    app.get('/api/webtorrent-status', async (req, res) => {
        try {
            const status = await StremioEngine.getStatus();
            res.json(status);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Return cleanup
    return {
        activeTorrents: StremioEngine.activeTorrents,
        torrentTimestamps: StremioEngine.torrentTimestamps,
        cleanup: async () => {
            console.log('[StremioRoutes] Cleaning up...');
            await StremioEngine.stopEngine();
            selectedFiles.clear();
        }
    };
}

export default { registerStremioRoutes };
