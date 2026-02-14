import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import xml2js from 'xml2js';
import path from 'path';
import { fileURLToPath } from 'url';
import mime from 'mime-types';
import multer from 'multer';
import fs from 'fs';
import os from 'os';
import zlib from 'zlib';
import crypto from 'crypto';
import { createRequire } from 'module';
import { spawn, execSync } from 'child_process';
import parseTorrent from 'parse-torrent';
import { filterTorrents } from './torrent_filter.mjs';


// Import the CommonJS api.cjs module
const require = createRequire(import.meta.url);
const { registerApiRoutes, registerMusicApi, initMusicDeps } = require('./api.cjs');

// Import Stremio Engine routes (FAST torrent streaming)
import { registerStremioRoutes } from './stremio_routes.mjs';
import { clearStremioCache } from './engine/stremio/stremio_engine.mjs';

// Import unified Torrent Engine routes (supports multiple engines)
import { registerTorrentEngineRoutes } from './torrent_engine_routes.mjs';
import * as TorrentEngineManager from './engine/manager/torrent_engine_manager.mjs';

// Import the new transcoder module
import { initTranscoder, handleTranscodeStream, getMetadata as getTranscoderMetadata } from './transcoder.js';




// This function will be imported and called by main.js
export function startServer(userDataPath, executablePath = null, ffmpegBin = null, ffprobeBin = null) {
    // Ensure userDataPath directory exists with proper permissions
    try {
        if (!fs.existsSync(userDataPath)) {
            fs.mkdirSync(userDataPath, { recursive: true, mode: 0o755 });
            console.log(`✅ Created userDataPath directory: ${userDataPath}`);
        }
        // Verify directory is writable
        fs.accessSync(userDataPath, fs.constants.W_OK);
        console.log(`✅ userDataPath is writable: ${userDataPath}`);
    } catch (err) {
        console.error(`❌ CRITICAL: userDataPath not writable: ${userDataPath}`, err?.message);
        console.error('❌ Application may not be able to save settings or API keys!');
    }
    
    // ============================================================================
    // API CACHE MANAGER - 1 hour cache for all API requests
    // ============================================================================
    const apiCache = new Map();
    const CACHE_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds

    // Cache helper functions
    function getCacheKey(url, params = {}) {
        const sortedParams = JSON.stringify(params, Object.keys(params).sort());
        return `${url}::${sortedParams}`;
    }

    function getFromCache(key) {
        const cached = apiCache.get(key);
        if (!cached) return null;
        
        const now = Date.now();
        if (now - cached.timestamp > CACHE_DURATION) {
            apiCache.delete(key);
            return null;
        }
        
        console.log(`[Cache HIT] ${key.substring(0, 80)}...`);
        return cached.data;
    }

    function setToCache(key, data) {
        apiCache.set(key, {
            data: data,
            timestamp: Date.now()
        });
        console.log(`[Cache SET] ${key.substring(0, 80)}... (Total cached: ${apiCache.size})`);
    }

    function clearCache() {
        const size = apiCache.size;
        apiCache.clear();
        console.log(`[Cache CLEARED] Removed ${size} cached entries`);
    }

    // Periodic cache cleanup (remove expired entries every 15 minutes)
    setInterval(() => {
        const now = Date.now();
        let removed = 0;
        for (const [key, value] of apiCache.entries()) {
            if (now - value.timestamp > CACHE_DURATION) {
                apiCache.delete(key);
                removed++;
            }
        }
        if (removed > 0) {
            console.log(`[Cache Cleanup] Removed ${removed} expired entries`);
        }
    }, 15 * 60 * 1000);

    // Middleware to cache GET requests automatically
    function cacheMiddleware(req, res, next) {
        if (req.method !== 'GET') return next();
        
        const cacheKey = getCacheKey(req.originalUrl || req.url, req.query);
        const cached = getFromCache(cacheKey);
        
        if (cached) {
            return res.json(cached);
        }
        
        // Override res.json to cache the response
        const originalJson = res.json.bind(res);
        res.json = function(data) {
            if (res.statusCode === 200 && data) {
                setToCache(cacheKey, data);
            }
            return originalJson(data);
        };
        
        next();
    }

    // ============================================================================
    // Recursive directory deletion function
    const deleteFolderRecursive = async (directoryPath) => {
        if (fs.existsSync(directoryPath)) {
            for (const file of fs.readdirSync(directoryPath)) {
                const curPath = path.join(directoryPath, file);
                if (fs.lstatSync(curPath).isDirectory()) { // recurse
                    await deleteFolderRecursive(curPath);
                } else { // delete file
                    fs.unlinkSync(curPath);
                }
            }
            fs.rmdirSync(directoryPath);
            console.log(`Successfully deleted directory: ${directoryPath}`);
        }
    };

    const app = express();
    const PORT = 6987;

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    // Trakt API Configuration
    const TRAKT_CONFIG = {
        CLIENT_ID: 'd1fd29900d9ed0b07de3529907bd290c0f5eb7e96c9a8c544ff1f919fd3c0d18',
        CLIENT_SECRET: '2a773d3d57be6662a51266ca40c95366cec011ad630a8601f8710484be20c04c',
        BASE_URL: 'https://api.trakt.tv',
        REDIRECT_URI: 'urn:ietf:wg:oauth:2.0:oob',
        API_VERSION: '2'
    };

    // Trakt API helper function
    async function traktFetch(endpoint, options = {}) {
        const url = `${TRAKT_CONFIG.BASE_URL}${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
            'trakt-api-version': TRAKT_CONFIG.API_VERSION,
            'trakt-api-key': TRAKT_CONFIG.CLIENT_ID,
            ...options.headers
        };

        // Add access token if available
        const traktToken = readTraktToken();
        if (traktToken && traktToken.access_token) {
            headers['Authorization'] = `Bearer ${traktToken.access_token}`;
        }

        console.log(`[TRAKT] ${options.method || 'GET'} ${url}`);
        
        const response = await fetch(url, {
            ...options,
            headers
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[TRAKT] Error ${response.status}: ${errorText}`);
            throw new Error(`Trakt API Error: ${response.status} ${errorText}`);
        }

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return await response.json();
        }
        return null;
    }

    // Trakt token storage functions
    const TRAKT_TOKEN_PATH = path.join(userDataPath, 'trakt_token.json');
    
    function readTraktToken() {
        try {
            if (fs.existsSync(TRAKT_TOKEN_PATH)) {
                const tokenData = JSON.parse(fs.readFileSync(TRAKT_TOKEN_PATH, 'utf8'));
                // Check if token is expired
                if (tokenData.expires_at && Date.now() > tokenData.expires_at) {
                    console.log('[TRAKT] Token expired, needs refresh');
                    return null;
                }
                return tokenData;
            }
        } catch (error) {
            console.error('[TRAKT] Error reading token:', error);
        }
        return null;
    }

    function saveTraktToken(tokenData) {
        try {
            // Calculate expiration time
            if (tokenData.expires_in) {
                tokenData.expires_at = Date.now() + (tokenData.expires_in * 1000);
            }
            fs.writeFileSync(TRAKT_TOKEN_PATH, JSON.stringify(tokenData, null, 2));
            console.log('[TRAKT] Token saved successfully');
            return true;
        } catch (error) {
            console.error('[TRAKT] Error saving token:', error);
            return false;
        }
    }

    function deleteTraktToken() {
        try {
            if (fs.existsSync(TRAKT_TOKEN_PATH)) {
                fs.unlinkSync(TRAKT_TOKEN_PATH);
                console.log('[TRAKT] Token deleted');
            }
            return true;
        } catch (error) {
            console.error('[TRAKT] Error deleting token:', error);
            return false;
        }
    }

    app.use(cors());
    app.use(express.static(path.join(__dirname, 'public')));
    app.use('/audiobooks', express.static(path.join(__dirname, 'AudioBooks', 'public')));
    app.use(express.json());
    
    // ============================================================================
    // IPTV PROXY - Handle redirects for IPTV streams
    // ============================================================================
    app.get('/api/iptv-proxy', async (req, res) => {
        const { url } = req.query;
        
        if (!url) {
            return res.status(400).send('URL parameter required');
        }

        console.log(`[IPTV PROXY] Proxying: ${url}`);

        try {
            // Build headers that mimic a real player
            const headers = {
                'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Connection': 'keep-alive'
            };

            // Forward range header if present
            if (req.headers.range) {
                headers['Range'] = req.headers.range;
            }

            // Forward referer if present
            if (req.headers.referer) {
                headers['Referer'] = req.headers.referer;
            }

            const response = await fetch(url, {
                method: 'GET',
                redirect: 'follow',
                headers: headers
            });

            if (!response.ok) {
                console.error(`[IPTV PROXY] Error: ${response.status} ${response.statusText}`);
                return res.status(response.status).send(`Stream error: ${response.statusText}`);
            }

            // Check if this is an HLS playlist
            const contentType = response.headers.get('content-type') || '';
            const isM3U8 = url.includes('.m3u8') || contentType.includes('mpegurl') || contentType.includes('m3u8');

            if (isM3U8) {
                // For HLS playlists, rewrite URLs to go through proxy
                const text = await response.text();
                const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
                
                // Rewrite relative URLs in the playlist
                const rewritten = text.split('\n').map(line => {
                    if (line.trim() && !line.startsWith('#')) {
                        // This is a URL line
                        if (line.startsWith('http://') || line.startsWith('https://')) {
                            // Absolute URL - proxy it
                            return `/api/iptv-proxy?url=${encodeURIComponent(line)}`;
                        } else {
                            // Relative URL - make it absolute then proxy
                            const absoluteUrl = baseUrl + line;
                            return `/api/iptv-proxy?url=${encodeURIComponent(absoluteUrl)}`;
                        }
                    }
                    return line;
                }).join('\n');

                res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Cache-Control', 'no-cache');
                res.send(rewritten);
            } else {
                // For video segments, stream directly
                res.status(response.status);
                response.headers.forEach((value, key) => {
                    if (!['connection', 'transfer-encoding', 'content-encoding'].includes(key.toLowerCase())) {
                        res.setHeader(key, value);
                    }
                });
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Headers', '*');

                // Pipe the stream
                const reader = response.body.getReader();
                const pump = async () => {
                    try {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            if (!res.write(value)) {
                                await new Promise(resolve => res.once('drain', resolve));
                            }
                        }
                        res.end();
                    } catch (err) {
                        console.error('[IPTV PROXY] Stream error:', err.message);
                        res.end();
                    }
                };
                pump();
            }

        } catch (error) {
            console.error('[IPTV PROXY] Error:', error.message);
            res.status(500).send(`Proxy error: ${error.message}`);
        }
    });
    
    // ============================================================================
    // TMDB PROXY (Added for Basic Mode)
    // ============================================================================
    app.use('/api/tmdb', async (req, res) => {
        const endpoint = req.url; 
        const query = req.query;
        const API_KEY = 'c3515fdc674ea2bd7b514f4bc3616a4a';
        const BASE_URL = 'https://api.themoviedb.org/3';
        
        const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
        const url = new URL(`${BASE_URL}${cleanEndpoint.split('?')[0]}`);
        url.searchParams.append('api_key', API_KEY);
        Object.entries(query).forEach(([key, value]) => {
            url.searchParams.append(key, value);
        });

        console.log(`[TMDB PROXY] Fetching: ${url.toString()}`);

        try {
            const response = await fetch(url.toString());
            if (!response.ok) {
                console.error(`[TMDB PROXY] Error: ${response.status} ${response.statusText}`);
                return res.status(response.status).json({ error: `TMDB API Error: ${response.status}` });
            }
            const data = await response.json();
            res.json(data);
        } catch (error) {
            console.error('[TMDB PROXY] Error:', error.message);
            res.status(500).json({ error: error.message });
        }
    });

    // Proxy for Jackett (Added for Basic Mode)
    app.get('/api/jackett', async (req, res) => {
        let { apikey, q, t, jackettUrl: customUrl } = req.query;
        
        // If apikey is masked (contains *) or missing, use the internal API_KEY
        if (!apikey || apikey.includes('*')) {
            if (!API_KEY) loadAPIKey();
            apikey = API_KEY;
        }

        // Use custom URL if provided, otherwise use the configured JACKETT_URL
        const baseUrl = customUrl || JACKETT_URL;
        console.log(`[Jackett Proxy] Using URL: ${baseUrl}`);
        
        const url = new URL(baseUrl);
        if (apikey) url.searchParams.append('apikey', apikey);
        if (q) url.searchParams.append('q', q);
        if (t) url.searchParams.append('t', t);

        try {
            const response = await fetch(url.toString());
            const data = await response.text(); // Jackett returns XML
            res.header('Content-Type', 'application/xml');
            res.status(response.status).send(data);
        } catch (error) {
            console.error('Jackett Proxy Error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Proxy for Prowlarr (Added for Basic Mode)
    app.get('/api/prowlarr', async (req, res) => {
        let { apikey, q, prowlarrUrl: customUrl } = req.query;
        
        // If apikey is masked (contains *) or missing, use the internal PROWLARR_API_KEY
        if (!apikey || apikey.includes('*')) {
            if (!PROWLARR_API_KEY) loadProwlarrAPIKey();
            apikey = PROWLARR_API_KEY;
        }

        // Use custom URL if provided, otherwise use the configured PROWLARR_URL
        const baseUrl = customUrl || PROWLARR_URL;
        console.log(`[Prowlarr Proxy] Using URL: ${baseUrl}`);
        
        const url = `${baseUrl}/api/v1/search?query=${encodeURIComponent(q || '')}&type=search`;

        try {
            const response = await fetch(url, {
                headers: {
                    'X-Api-Key': apikey
                }
            });
            const data = await response.json(); // Prowlarr returns JSON
            res.json(data);
        } catch (error) {
            console.error('Prowlarr Proxy Error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // ============================================================================
    // RESOLVE TORRENT FILE - Convert .torrent URL to magnet link
    // ============================================================================
    app.get('/api/resolve-torrent-file', async (req, res) => {
        const { url, title } = req.query;
        
        if (!url) {
            return res.status(400).json({ error: 'Missing url parameter' });
        }
        
        // If it's already a magnet link, return it directly
        if (url.startsWith('magnet:')) {
            return res.json({ magnet: url });
        }
        
        console.log(`[ResolveTorrent] Resolving: ${url.substring(0, 100)}...`);
        
        try {
            // Create abort controller for timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);
            
            // Fetch with redirect: 'manual' to catch magnet redirects
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'application/x-bittorrent, application/octet-stream, */*'
                },
                signal: controller.signal,
                redirect: 'manual'  // Don't auto-follow redirects
            });
            
            clearTimeout(timeoutId);
            
            // Check if it's a redirect to a magnet link
            if (response.status >= 300 && response.status < 400) {
                const location = response.headers.get('location');
                if (location) {
                    console.log(`[ResolveTorrent] Redirect to: ${location.substring(0, 100)}...`);
                    if (location.startsWith('magnet:')) {
                        console.log(`[ResolveTorrent] Success: Redirect was a magnet link`);
                        return res.json({ magnet: location });
                    }
                    // Follow non-magnet redirects manually
                    const redirectResponse = await fetch(location, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                            'Accept': 'application/x-bittorrent, application/octet-stream, */*'
                        },
                        redirect: 'manual'
                    });
                    
                    // Check again for magnet redirect
                    if (redirectResponse.status >= 300 && redirectResponse.status < 400) {
                        const loc2 = redirectResponse.headers.get('location');
                        if (loc2 && loc2.startsWith('magnet:')) {
                            console.log(`[ResolveTorrent] Success: Second redirect was a magnet link`);
                            return res.json({ magnet: loc2 });
                        }
                    }
                    
                    if (!redirectResponse.ok) {
                        return res.status(redirectResponse.status).json({ error: `Failed after redirect: ${redirectResponse.status}` });
                    }
                    
                    // Process the redirected response
                    const arrayBuffer = await redirectResponse.arrayBuffer();
                    return processBuffer(Buffer.from(arrayBuffer), title, res);
                }
            }
            
            if (!response.ok) {
                console.error(`[ResolveTorrent] HTTP error: ${response.status} ${response.statusText}`);
                return res.status(response.status).json({ error: `Failed to fetch torrent: ${response.status} ${response.statusText}` });
            }
            
            // Get the torrent file as buffer
            const arrayBuffer = await response.arrayBuffer();
            return processBuffer(Buffer.from(arrayBuffer), title, res);
            
        } catch (error) {
            console.error(`[ResolveTorrent] Error:`, error);
            if (error.name === 'AbortError') {
                return res.status(504).json({ error: 'Request timed out' });
            }
            res.status(500).json({ error: error.message || 'Failed to resolve torrent' });
        }
    });
    
    // Helper function to process torrent buffer
    async function processBuffer(buffer, title, res) {
        console.log(`[ResolveTorrent] Downloaded ${buffer.length} bytes`);
        
        if (buffer.length === 0) {
            return res.status(400).json({ error: 'Empty response from torrent URL' });
        }
        
        // Check first byte - bencoded dict starts with 'd'
        const firstChar = String.fromCharCode(buffer[0]);
        if (firstChar !== 'd') {
            // Maybe it's a magnet link or HTML error page
            const text = buffer.toString('utf8').substring(0, 500).trim();
            if (text.startsWith('magnet:')) {
                console.log(`[ResolveTorrent] URL returned magnet link directly`);
                return res.json({ magnet: text.split('\n')[0].trim() });
            }
            console.error(`[ResolveTorrent] Not a torrent file. First 100 chars: ${text.substring(0, 100)}`);
            return res.status(400).json({ error: 'URL did not return a valid torrent file' });
        }
        
        // Parse the torrent file
        let parsed;
        try {
            parsed = await parseTorrent(buffer);
        } catch (parseErr) {
            console.error(`[ResolveTorrent] Parse error:`, parseErr.message);
            return res.status(400).json({ error: `Invalid torrent file: ${parseErr.message}` });
        }
        
        if (!parsed || !parsed.infoHash) {
            return res.status(400).json({ error: 'Could not extract info hash from torrent' });
        }
        
        // Build magnet link
        const magnetParts = [`magnet:?xt=urn:btih:${parsed.infoHash}`];
        
        // Add display name
        const displayName = parsed.name || title || 'Unknown';
        magnetParts.push(`&dn=${encodeURIComponent(displayName)}`);
        
        // Add trackers if available
        if (parsed.announce && parsed.announce.length > 0) {
            parsed.announce.forEach(tracker => {
                magnetParts.push(`&tr=${encodeURIComponent(tracker)}`);
            });
        }
        
        const magnet = magnetParts.join('');
        console.log(`[ResolveTorrent] Success: ${parsed.infoHash} - ${displayName.substring(0, 50)}`);
        
        return res.json({ 
            magnet,
            infoHash: parsed.infoHash,
            name: displayName
        });
    }

    // Apply cache middleware to all API routes
    app.use('/anime/api', cacheMiddleware);
    app.use('/torrentio/api', cacheMiddleware);
    app.use('/torrentless/api', cacheMiddleware);
    app.use('/zlib', cacheMiddleware);
    app.use('/otherbook/api', cacheMiddleware);
    app.use('/111477/api', cacheMiddleware);
    app.use('/moviebox', cacheMiddleware);
    app.use('/api/torrents', cacheMiddleware);
    app.use('/api/trakt', cacheMiddleware);
    
    // Health check endpoint
    app.get('/', (req, res) => {
        res.json({ 
            status: 'running', 
            message: 'PlayTorrio Server is running',
            version: '1.3.9',
            cacheSize: apiCache.size,
            endpoints: {
                anime: '/anime/api/*',
                torrentio: '/torrentio/api/*',
                torrentless: '/torrentless/api/*',
                webtorrent: '/api/webtorrent/* (via TorrServer)',
                trakt: '/api/trakt/*'
            }
        });
    });
    
    // Cache management endpoint
    app.post('/api/clear-cache', (req, res) => {
        clearCache();
        res.json({ success: true, message: 'Cache cleared successfully' });
    });

    app.get('/api/cache-stats', (req, res) => {
        res.json({ 
            size: apiCache.size,
            duration: CACHE_DURATION / 1000 / 60 + ' minutes'
        });
    });

    // ============================================================================
    // ULTIMATE TORRENT SEARCH - Aggregates results from 12 sources
    // ============================================================================
    app.get('/api/ultimate', async (req, res) => {
        const { query } = req.query;
        
        if (!query) {
            return res.status(400).json({ error: 'Query parameter is required' });
        }

        try {
            // Dynamically import all scrapers
            const scraperModules = await Promise.all([
                import('./public/js/scrapers/elitetorrent.js'),
                import('./public/js/scrapers/eztv.js'),
                import('./public/js/scrapers/ilcorsaronero.js'),
                import('./public/js/scrapers/knaben.js'),
                import('./public/js/scrapers/limetorrents.js'),
                import('./public/js/scrapers/megapeer.js'),
                import('./public/js/scrapers/oxtorrent.js'),
                import('./public/js/scrapers/thepiratebay.js'),
                import('./public/js/scrapers/therarbg.js'),
                import('./public/js/scrapers/torrentgalaxy.js'),
                import('./public/js/scrapers/uindex.js'),
                import('./public/js/scrapers/yts.js')
            ]);

            const results = await Promise.allSettled([
                scraperModules[0].searchEliteTorrent(query),
                scraperModules[1].searchEZTV(query),
                scraperModules[2].searchIlCorsaroNero(query),
                scraperModules[3].searchKnaben(query),
                scraperModules[4].searchLimeTorrents(query),
                scraperModules[5].searchMegapeer(query),
                scraperModules[6].searchOxTorrent(query),
                scraperModules[7].searchThePirateBay(query),
                scraperModules[8].searchTheRARBG(query),
                scraperModules[9].searchTorrentGalaxy(query),
                scraperModules[10].searchUIndex(query),
                scraperModules[11].searchYTS(query)
            ]);

            const aggregated = [];
            
            results.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    aggregated.push(...result.value);
                } else {
                    console.error(`Ultimate scraper ${index} failed:`, result.reason);
                }
            });

            // Remove duplicates based on magnet link (infohash)
            const seen = new Set();
            const unique = aggregated.filter(torrent => {
                // Extract infohash from magnet link
                const match = torrent.magnet.match(/btih:([a-fA-F0-9]+)/i);
                if (match) {
                    const infohash = match[1].toUpperCase();
                    if (seen.has(infohash)) {
                        return false;
                    }
                    seen.add(infohash);
                    return true;
                }
                return true; // Keep if we can't extract infohash
            });

            // Sort by seeders (highest to lowest)
            // Convert seeders to numbers, treating "Unknown" as -1
            unique.sort((a, b) => {
                const seedersA = a.seeders === 'Unknown' ? -1 : parseInt(a.seeders.replace(/,/g, '')) || -1;
                const seedersB = b.seeders === 'Unknown' ? -1 : parseInt(b.seeders.replace(/,/g, '')) || -1;
                return seedersB - seedersA;
            });

            res.json({
                query,
                totalResults: unique.length,
                results: unique
            });
        } catch (error) {
            console.error('[Ultimate Search] Error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // ============================================================================
    // TRANSCODER INTEGRATION
    // ============================================================================
    
    // Use passed-in binaries
    let resolvedFfmpegPath = ffmpegBin; 
    let resolvedFfprobePath = ffprobeBin;
    let bestEncoder = 'libx264';
    let encoderPreset = 'ultrafast';
    let hwAccel = 'auto'; // Default to auto, will be set to strict 'cuda'/'d3d11va' etc if HW is confirmed

    if (!resolvedFfmpegPath) {
        console.error('[Transcoder] CRITICAL: No FFmpeg binary provided to startServer!');
    }

    console.log(`[Transcoder] Active FFmpeg: ${resolvedFfmpegPath}`);
    console.log(`[Transcoder] Active FFprobe: ${resolvedFfprobePath}`);
    console.log(`[Transcoder] Platform: ${process.platform}`);

    // Initialize the new transcoder module with FFmpeg paths
    initTranscoder(resolvedFfmpegPath, resolvedFfprobePath);

    // Detect best encoder on startup - CROSS-PLATFORM
    const detectBestEncoder = async () => {
        console.log('[Transcoder] Detecting hardware acceleration...');
        
        // Platform-specific encoder list
        // Windows: NVENC > QSV > AMF
        // macOS: VideoToolbox > (no other HW options)
        // Linux: NVENC > VAAPI > QSV
        const platform = process.platform;
        let encoders = [];
        
        if (platform === 'darwin') {
            // macOS - VideoToolbox is the only option
            encoders = [
                { name: 'h264_videotoolbox', hwaccel: 'videotoolbox', desc: 'Apple VideoToolbox' }
            ];
        } else if (platform === 'linux') {
            // Linux - NVENC (if NVIDIA), VAAPI (Intel/AMD), QSV (Intel)
            encoders = [
                { name: 'h264_nvenc', hwaccel: 'cuda', desc: 'NVIDIA NVENC' },
                { name: 'h264_vaapi', hwaccel: 'vaapi', desc: 'VAAPI (Intel/AMD)' },
                { name: 'h264_qsv', hwaccel: 'qsv', desc: 'Intel QuickSync' }
            ];
        } else {
            // Windows - NVENC > QSV > AMF
            encoders = [
                { name: 'h264_nvenc', hwaccel: 'cuda', desc: 'NVIDIA NVENC' },
                { name: 'h264_qsv', hwaccel: 'qsv', desc: 'Intel QuickSync' },
                { name: 'h264_amf', hwaccel: 'd3d11va', desc: 'AMD AMF' }
            ];
        }

        for (const enc of encoders) {
            try {
                // Test encode a small black frame to verify encoder works
                const args = [
                    '-hide_banner', '-loglevel', 'error',
                    '-f', 'lavfi', '-i', 'color=c=black:s=128x128:d=0.1',
                    '-c:v', enc.name,
                    '-frames:v', '1',
                    '-f', 'null', '-'
                ];
                
                await new Promise((resolve, reject) => {
                    const p = spawn(resolvedFfmpegPath, args);
                    let stderr = '';
                    p.stderr.on('data', d => stderr += d.toString());
                    p.on('close', (code) => {
                        if (code === 0) resolve();
                        else reject(new Error(`Exit code ${code}: ${stderr}`));
                    });
                    p.on('error', reject);
                    // Timeout after 10 seconds
                    setTimeout(() => {
                        p.kill('SIGKILL');
                        reject(new Error('Timeout'));
                    }, 10000);
                });

                console.log(`[Transcoder] ✅ Hardware acceleration enabled: ${enc.desc} (${enc.name})`);
                bestEncoder = enc.name;
                
                // Set optimal presets for each encoder
                if (enc.name.includes('nvenc')) {
                    encoderPreset = 'p4'; // Balanced speed/quality
                    hwAccel = 'cuda';
                } else if (enc.name.includes('qsv')) {
                    encoderPreset = 'faster';
                    hwAccel = 'qsv';
                } else if (enc.name.includes('amf')) {
                    encoderPreset = 'speed';
                    hwAccel = 'd3d11va';
                } else if (enc.name.includes('videotoolbox')) {
                    encoderPreset = 'fast'; // VideoToolbox uses different preset names
                    hwAccel = 'videotoolbox';
                } else if (enc.name.includes('vaapi')) {
                    encoderPreset = 'fast';
                    hwAccel = 'vaapi';
                }
                return;
            } catch (e) {
                // Silent fail, try next encoder
            }
        }
        
        console.log('[Transcoder] ⚠️ No hardware acceleration found. Using CPU (libx264).');
        console.log('[Transcoder] 💡 Tip: Install NVIDIA/AMD/Intel drivers for faster transcoding.');
        bestEncoder = 'libx264';
        encoderPreset = 'superfast';
        hwAccel = 'auto';
    };

    // Run detection asynchronously
    detectBestEncoder();

    const metadataCache = new Map();
    const activeProbes = new Map();

    async function getVideoMetadata(videoUrl) {
        // Normalize URL for caching
        const normalizedUrl = videoUrl.replace('localhost', '127.0.0.1');
        
        if (metadataCache.has(normalizedUrl)) return metadataCache.get(normalizedUrl);
        
        // If there's already a probe running for this URL, wait for it
        if (activeProbes.has(normalizedUrl)) {
            return activeProbes.get(normalizedUrl);
        }

        const probePromise = (async () => {
            try {
                const targetUrl = normalizedUrl;
                const isLocal = targetUrl.includes('127.0.0.1');
                
                const runProbe = () => new Promise((resolve, reject) => {
                    // ============ OPTIMIZED FFPROBE FOR SPEED ============
                    // Key optimizations:
                    // 1. Reduced analyzeduration/probesize for faster startup
                    // 2. Only read first 5MB of file for metadata
                    // 3. Skip frame analysis (-count_frames removed)
                    // 4. Use faster format detection
                    const args = [
                        '-hide_banner',
                        '-loglevel', 'error',
                        '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        
                        // ============ SPEED OPTIMIZATIONS ============
                        '-analyzeduration', '10000000',   // 10M microseconds (10s) - increased for reliability
                        '-probesize', '10000000',         // 10MB - increased for reliability
                        '-fflags', '+fastseek+nobuffer', // Fast seeking, no buffering
                        '-flags', 'low_delay',           // Low delay mode
                        
                        // Network optimizations
                        '-reconnect', '1',
                        '-reconnect_streamed', '1',
                        '-reconnect_delay_max', '2',     // Reduced from 5s
                        '-timeout', '10000000',          // 10s timeout (microseconds)
                        
                        // Output format
                        '-print_format', 'json',
                        '-show_format',
                        '-show_streams',
                    ];

                    // Only add TorBox Referer for TorBox links
                    if (targetUrl.includes('torbox')) {
                        args.push('-headers', 'Referer: https://torbox.app/\r\n');
                    }

                    args.push('-i', targetUrl);
                    
                    const ffprobe = spawn(resolvedFfprobePath, args, {
                        stdio: ['ignore', 'pipe', 'pipe'],
                        windowsHide: true  // Hide console window on Windows
                    });
                    
                    let stdout = '', stderr = '';
                    ffprobe.stdout.on('data', (d) => stdout += d.toString());
                    ffprobe.stderr.on('data', (d) => stderr += d.toString());
                    
                    ffprobe.on('error', (err) => {
                        console.error(`[FFprobe] Failed to spawn process:`, err.message);
                        reject(err);
                    });

                    ffprobe.on('close', (code, signal) => {
                        if (code !== 0) {
                            const errorMsg = stderr || stdout || 'Unknown error';
                            return reject(new Error(`ffprobe failed (code ${code}): ${errorMsg}`));
                        }
                        try {
                            const data = JSON.parse(stdout);
                            const videoStream = data.streams?.find(s => s.codec_type === 'video');
                            const audioStreams = data.streams?.filter(s => s.codec_type === 'audio') || [];
                            
                            const videoCodec = videoStream?.codec_name || 'unknown';
                            const audioCodecs = audioStreams.map(s => s.codec_name);
                            
                            // Check if codecs are web-compatible (can be remuxed without transcoding)
                            // Web-compatible video: h264 only for maximum browser compatibility
                            // HEVC/VP9/AV1 have limited browser support, so transcode them
                            const webCompatibleVideo = ['h264'].includes(videoCodec);
                            const webCompatibleAudio = audioCodecs.length === 0 || audioCodecs.some(c => 
                                ['aac', 'mp3', 'opus', 'vorbis', 'flac'].includes(c)
                            );
                            const canRemux = webCompatibleVideo && webCompatibleAudio;
                            
                            // Find the first web-compatible audio track index
                            let webCompatibleAudioIndex = 0;
                            for (let i = 0; i < audioStreams.length; i++) {
                                if (['aac', 'mp3', 'opus', 'vorbis', 'flac'].includes(audioStreams[i].codec_name)) {
                                    webCompatibleAudioIndex = i;
                                    break;
                                }
                            }
                            
                            // Robust duration detection
                            let duration = parseFloat(data.format?.duration);
                            if (!duration || isNaN(duration)) duration = parseFloat(videoStream?.duration);
                            if ((!duration || isNaN(duration)) && audioStreams.length > 0) duration = parseFloat(audioStreams[0]?.duration);

                            const meta = {
                                duration: duration || 0,
                                videoCodec: videoCodec,
                                width: videoStream?.width || 0,
                                height: videoStream?.height || 0,
                                bitrate: parseInt(data.format?.bit_rate) || 0,
                                // Web compatibility info
                                canRemux: canRemux,
                                webCompatibleVideo: webCompatibleVideo,
                                webCompatibleAudio: webCompatibleAudio,
                                webCompatibleAudioIndex: webCompatibleAudioIndex,
                                audioTracks: audioStreams.map((s, index) => ({
                                    index: s.index,
                                    id: index,
                                    codec: s.codec_name,
                                    language: s.tags?.language || 'und',
                                    title: s.tags?.title || `Track ${index + 1}`,
                                    webCompatible: ['aac', 'mp3', 'opus', 'vorbis', 'flac'].includes(s.codec_name)
                                }))
                            };
                            metadataCache.set(normalizedUrl, meta);
                            resolve(meta);
                        } catch (e) { 
                            reject(new Error(`ffprobe JSON parse error: ${e.message}`)); 
                        }
                    });

                    // Reduced timeout for faster failure detection
                    const timeout = setTimeout(() => { 
                        ffprobe.kill('SIGKILL'); 
                        reject(new Error('ffprobe timeout')); 
                    }, 20000);  // 20s timeout (reduced from 45s)

                    ffprobe.on('close', () => clearTimeout(timeout));
                });

                // Optimized retry logic - fewer retries, shorter delays
                let lastError = null;
                for (let i = 0; i < 3; i++) {  // Reduced from 5 to 3 retries
                    try {
                        const meta = await runProbe();
                        return meta;
                    } catch (err) {
                        lastError = err;
                        const msg = err.message || '';
                        // Fast fail on certain errors
                        if (msg.includes('404') || msg.includes('403') || msg.includes('401')) throw err;

                        // Shorter wait before retry
                        if (i < 2) await new Promise(r => setTimeout(r, 800));  // Reduced from 1500ms
                    }
                }
                throw lastError;
            } finally {
                activeProbes.delete(normalizedUrl);
            }
        })();

        activeProbes.set(normalizedUrl, probePromise);
        return probePromise;
    }

    app.get('/api/transcode/metadata', async (req, res) => {
        const { url: videoUrl } = req.query;
        if (!videoUrl) return res.status(400).json({ error: 'Missing url' });
        try {
            const meta = await getVideoMetadata(videoUrl);
            res.json(meta);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ============================================================================
    // REMUX ENDPOINT - Fast stream copy for web-compatible codecs
    // No transcoding, just repackages into fragmented MP4 container
    // ============================================================================
    app.get('/api/transcode/remux', async (req, res) => {
        const { url: videoUrl, start = 0, audioTrack = 0 } = req.query;
        if (!videoUrl) return res.status(400).send('Missing url');

        const targetUrl = videoUrl.replace('localhost', '127.0.0.1');
        
        console.log(`[Remux] Request: ${start}s - Fast stream copy (no transcoding)`);
        
        res.writeHead(200, {
            'Content-Type': 'video/mp4',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Connection': 'keep-alive',
            'Accept-Ranges': 'bytes',
            'Transfer-Encoding': 'chunked',
            'X-Content-Type-Options': 'nosniff'
        });

        const args = [
            '-hide_banner', '-loglevel', 'warning',
            
            // ============ ULTRA-FAST INPUT FOR INSTANT START ============
            '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            '-fflags', '+genpts+discardcorrupt+fastseek+nobuffer+igndts',
            '-flags', 'low_delay',
            '-probesize', '1M',        // Absolute minimum for remux
            '-analyzeduration', '1M',  // Absolute minimum for remux
            '-thread_queue_size', '512',
            
            // Seek BEFORE input for instant startup
            '-ss', start.toString(),
            
            // Fast reconnection for network streams
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_on_network_error', '1',
            '-reconnect_at_eof', '1',
            '-reconnect_delay_max', '2',
            '-i', targetUrl,
            
            // Stream mapping
            '-map', '0:v:0',
            '-map', `0:a:${audioTrack}?`,
            
            // COPY streams - no transcoding!
            '-c:v', 'copy',
            '-c:a', 'copy',
            
            // Fragmented MP4 for instant playback - optimized flags
            '-movflags', 'frag_keyframe+empty_moov+default_base_moof+faststart+delay_moov+omit_tfhd_offset',
            '-frag_duration', '500000',  // 0.5s fragments for lower latency (reduced from 1s)
            
            // Output
            '-f', 'mp4',
            '-'
        ];

        const ffmpeg = spawn(resolvedFfmpegPath, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true  // Hide console window on Windows
        });
        
        ffmpeg.stdout.pipe(res);
        
        ffmpeg.stderr.on('data', (data) => {
            const msg = data.toString().trim();
            if (msg.includes('buffer underflow') || 
                msg.includes('Past duration') ||
                msg.includes('Discarding') ||
                msg.includes('deprecated')) return;
            if (msg.toLowerCase().includes('error') || msg.toLowerCase().includes('fatal')) {
                console.error('[Remux Error]', msg);
            }
        });

        res.on('close', () => {
            if (!ffmpeg.killed) {
                ffmpeg.kill('SIGKILL');
            }
        });

        ffmpeg.on('error', (err) => {
            console.error('[Remux Process Error]', err.message);
            if (!res.writableEnded) {
                res.end();
            }
        });

        ffmpeg.on('exit', (code, signal) => {
            if (code !== 0 && code !== null && signal !== 'SIGKILL') {
                console.warn(`[Remux] Exited with code ${code}, signal ${signal}`);
            }
        });
    });

    // Encoder status endpoint - shows current hardware acceleration status
    app.get('/api/transcode/status', (req, res) => {
        const isHW = bestEncoder !== 'libx264';
        let encoderType = 'CPU (Software)';
        if (bestEncoder.includes('nvenc')) encoderType = 'NVIDIA NVENC';
        else if (bestEncoder.includes('qsv')) encoderType = 'Intel QuickSync';
        else if (bestEncoder.includes('amf')) encoderType = 'AMD AMF';
        else if (bestEncoder.includes('videotoolbox')) encoderType = 'Apple VideoToolbox';
        else if (bestEncoder.includes('vaapi')) encoderType = 'VAAPI';
        else if (bestEncoder.includes('mf')) encoderType = 'Windows MediaFoundation';
        
        res.json({
            encoder: bestEncoder,
            encoderType,
            preset: encoderPreset,
            hwAccel: hwAccel,
            platform: process.platform,
            isHardwareAccelerated: isHW,
            capabilities: {
                native: true,
                high: true,  // 1080p
                mid: true,   // 720p
                low: true    // 480p
            }
        });
    });

    app.get('/api/transcode/stream', async (req, res) => {
        // Use the new transcoder.js implementation
        await handleTranscodeStream(req, res);
    });

    // ============================================================================
    // NUVIO PROXY - Cache Nuvio streaming API requests
    // ============================================================================
    app.get('/api/nuvio/stream/:type/:id', cacheMiddleware, async (req, res) => {
        try {
            const { type, id } = req.params;
            const { cookie, region = 'US' } = req.query;

            if (!['movie', 'series'].includes(type)) {
                return res.status(400).json({ error: 'Invalid type. Must be movie or series.' });
            }

            const providers = 'showbox,vidzee,vidsrc,vixsrc,mp4hydra,uhdmovies,moviesmod,4khdhub,topmovies';
            const nuvioUrl = `https://nuviostreams.hayd.uk/providers=${providers}/stream/${type}/${id}.json?cookie=${cookie || ''}&region=${region}`;

            console.log('[Nuvio Proxy] Fetching:', nuvioUrl);

            const response = await fetch(nuvioUrl);
            if (!response.ok) {
                throw new Error(`Nuvio API error: ${response.statusText}`);
            }

            const data = await response.json();
            res.json(data);
        } catch (error) {
            console.error('[Nuvio Proxy Error]:', error);
            res.status(500).json({ error: error.message || 'Failed to fetch Nuvio streams' });
        }
    });

    // ============================================================================
    // COMET PROXY - Cache Comet debrid API requests
    // ============================================================================
    app.get('/api/comet/stream/:type/:id', cacheMiddleware, async (req, res) => {
        try {
            const { type, id } = req.params;
            const { config } = req.query;

            if (!['movie', 'series'].includes(type)) {
                return res.status(400).json({ error: 'Invalid type. Must be movie or series.' });
            }

            // Default Comet config if none provided
            const cometConfig = config || 'eyJtYXhSZXN1bHRzUGVyUmVzb2x1dGlvbiI6MCwibWF4U2l6ZSI6MCwiY2FjaGVkT25seSI6dHJ1ZSwicmVtb3ZlVHJhc2giOnRydWUsInJlc3VsdEZvcm1hdCI6WyJhbGwiXSwiZGVicmlkU2VydmljZSI6InRvcnJlbnQiLCJkZWJyaWRBcGlLZXkiOiIiLCJkZWJyaWRTdHJlYW1Qcm94eVBhc3N3b3JkIjoiIiwibGFuZ3VhZ2VzIjp7ImV4Y2x1ZGUiOltdLCJwcmVmZXJyZWQiOlsiZW4iXX0sInJlc29sdXRpb25zIjp7fSwib3B0aW9ucyI6eyJyZW1vdmVfcmFua3NfdW5kZXIiOi0xMDAwMDAwMDAwMCwiYWxsb3dfZW5nbGlzaF9pbl9sYW5ndWFnZXMiOmZhbHNlLCJyZW1vdmVfdW5rbm93bl9sYW5ndWFnZXMiOmZhbHNlfX0=';
            
            const cometUrl = `https://comet.elfhosted.com/${cometConfig}/stream/${type}/${id}.json`;

            console.log('[Comet Proxy] Fetching:', cometUrl);

            const response = await fetch(cometUrl);
            if (!response.ok) {
                throw new Error(`Comet API error: ${response.statusText}`);
            }

            const data = await response.json();
            res.json(data);
        } catch (error) {
            console.error('[Comet Proxy Error]:', error);
            res.status(500).json({ error: error.message || 'Failed to fetch Comet streams' });
        }
    });
    
    // Register all API routes from api.js (anime, torrentio, torrentless, zlib, otherbook, 111477)
    console.log('📦 Registering API routes from api.js...');
    registerApiRoutes(app);
    console.log('✅ API routes registered successfully');
    try {
        initMusicDeps();
    } catch (e) {
        console.error('[Music] Failed to initialize dependencies:', e.message);
    }
    registerMusicApi(app);
    // Simple playback resume storage in userData
    const RESUME_PATH = path.join(userDataPath, 'playback_positions.json');
    function readResumeMap() {
        try {
            if (fs.existsSync(RESUME_PATH)) {
                const j = JSON.parse(fs.readFileSync(RESUME_PATH, 'utf8'));
                if (j && typeof j === 'object') return j;
            }
        } catch {}
        return {};
    }
    function writeResumeMap(obj) {
        try {
            fs.mkdirSync(path.dirname(RESUME_PATH), { recursive: true });
            fs.writeFileSync(RESUME_PATH, JSON.stringify(obj, null, 2));
            return true;
        } catch {
            return false;
        }
    }
    // Simple settings storage in userData
    const SETTINGS_PATH = path.join(userDataPath, 'settings.json');
    function readSettings() {
        try {
            const s = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
            
            // Migration: Auto-switch to PlayTorrioPlayer for existing users (one-time)
            // If playerType is not set and useNodeMPV is false (or not set), migrate to playtorrio
            if (!s.playerType && !s.useNodeMPV && !s._migratedToPlayTorrio) {
                console.log('[Settings] Migrating existing user to PlayTorrioPlayer as default');
                s.playerType = 'playtorrio';
                s._migratedToPlayTorrio = true;
                writeSettings(s);
            }
            
            // Migration v1.8.44: Force switch all users to PlayTorrioPlayer (one-time)
            // This ensures everyone gets the new NipaPlay AppImage on Linux and updated player on all platforms
            if (!s._migratedToPlayTorrioV1844) {
                console.log('[Settings] Auto-switching to PlayTorrioPlayer (v1.8.44 update)');
                s.playerType = 'playtorrio';
                s._migratedToPlayTorrioV1844 = true;
                writeSettings(s);
            }
            
            return {
                autoUpdate: true,
                useTorrentless: false,
                torrentSource: 'torrentio',
                useDebrid: false,
                debridProvider: 'realdebrid',
                rdToken: null,
                rdRefresh: null,
                rdClientId: null,
                rdCredId: null,
                rdCredSecret: null,
                adApiKey: null,
                tbApiKey: null,
                pmApiKey: null,
                useNodeMPV: false, // Windows only - use MPV player instead of HTML5
                mpvPath: null, // Custom path to mpv.exe
                playerType: 'playtorrio', // Default player: 'builtin', 'playtorrio', 'nodempv'
                ...s,
            };
        } catch {
            return { 
                autoUpdate: true, 
                useTorrentless: false, 
                torrentSource: 'torrentio', 
                useDebrid: false, 
                debridProvider: 'realdebrid', 
                rdToken: null, 
                rdRefresh: null, 
                rdClientId: null, 
                rdCredId: null, 
                rdCredSecret: null, 
                adApiKey: null, 
                tbApiKey: null, 
                pmApiKey: null, 
                useNodeMPV: false, 
                mpvPath: null,
                playerType: 'playtorrio' // Default for new users
            };
        }
    }
    function writeSettings(obj) {
        try { fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true }); fs.writeFileSync(SETTINGS_PATH, JSON.stringify(obj, null, 2)); return true; } catch { return false; }
    }

    // ===== IPTV settings endpoints =====
    function defaultIptvSettings() {
        return {
            lastMode: 'iframe', // 'iframe' | 'xtream' | 'm3u' | 'direct' | 'none'
            rememberCreds: false,
            xtream: { base: '', username: '', password: '' },
            m3u: { url: '' }
        };
    }

    app.get('/api/iptv/settings', (req, res) => {
        try {
            const s = readSettings();
            const iptv = { ...defaultIptvSettings(), ...(s.iptv || {}) };
            res.json({ success: true, iptv });
        } catch (e) {
            res.status(500).json({ success: false, error: e?.message || 'failed to load settings' });
        }
    });

    app.post('/api/iptv/settings', (req, res) => {
        try {
            const patch = req.body || {};
            const s = readSettings();
            const current = { ...defaultIptvSettings(), ...(s.iptv || {}) };
            const nextIptv = {
                ...current,
                ...patch,
                xtream: { ...(current.xtream || {}), ...(patch.xtream || {}) },
                m3u: { ...(current.m3u || {}), ...(patch.m3u || {}) }
            };
            const nextAll = { ...s, iptv: nextIptv };
            const ok = writeSettings(nextAll);
            if (!ok) return res.status(500).json({ success: false, error: 'failed to save settings' });
            res.json({ success: true, iptv: nextIptv });
        } catch (e) {
            res.status(500).json({ success: false, error: e?.message || 'failed to save settings' });
        }
    });

    // Diagnostics helpers for logging
    function mask(value, visible = 4) {
        if (!value) return null;
        const s = String(value);
        if (s.length <= visible) return '*'.repeat(Math.max(2, s.length));
        return s.slice(0, visible) + '***';
    }
    function truncate(s, n = 300) {
        try { const v = String(s || ''); return v.length > n ? v.slice(0, n) + '…' : v; } catch { return ''; }
    }

    app.get('/api/settings', (req, res) => {
        const s = readSettings();
        // Also load Jackett URL, Prowlarr URL and cache location from user settings
        const userSettings = loadUserSettings();
        // Determine auth state for the selected provider
        const provider = s.debridProvider || 'realdebrid';
        const debridAuth = provider === 'alldebrid' ? !!s.adApiKey 
            : provider === 'torbox' ? !!s.tbApiKey 
            : provider === 'premiumize' ? !!s.pmApiKey 
            : !!s.rdToken;
        res.json({
            autoUpdate: s.autoUpdate !== false,
            useTorrentless: !!s.useTorrentless,
            torrentSource: s.torrentSource || 'torrentio',
            useDebrid: !!s.useDebrid,
            debridProvider: provider,
            debridAuth,
            rdClientId: s.rdClientId || null,
            jackettUrl: userSettings.jackettUrl || JACKETT_URL,
            prowlarrUrl: userSettings.prowlarrUrl || PROWLARR_URL,
            cacheLocation: userSettings.cacheLocation || CACHE_LOCATION,
            playerType: s.playerType || 'playtorrio',
            useNodeMPV: !!s.useNodeMPV,
            mpvPath: s.mpvPath || null,
            discordActivity: s.discordActivity !== false,
            showSponsor: s.showSponsor !== false,
            torrentEngine: s.torrentEngine || 'stremio',
            torrentEngineInstances: s.torrentEngineInstances || 1,
            streamingMode: s.streamingMode !== false // Default to true
        });
    });
    
    // Platform detection endpoint
    app.get('/api/platform', (req, res) => {
        res.json({ platform: process.platform });
    });
    
    // Books Library endpoint - read epub files from local folder
    app.get('/api/books/library', async (req, res) => {
        try {
            const os = await import('os');
            const fsPromises = await import('fs/promises');
            const pathModule = await import('path');
            
            // Determine epub folder based on platform
            let epubFolder;
            if (process.platform === 'win32') {
                epubFolder = pathModule.default.join(process.env.APPDATA || '', 'PlayTorrio', 'epub');
            } else if (process.platform === 'darwin') {
                epubFolder = pathModule.default.join(os.default.homedir(), 'Library', 'Application Support', 'PlayTorrio', 'epub');
            } else {
                epubFolder = pathModule.default.join(os.default.homedir(), '.config', 'PlayTorrio', 'epub');
            }
            
            // Check if folder exists
            try {
                await fsPromises.default.access(epubFolder);
            } catch {
                // Folder doesn't exist, create it and return empty
                await fsPromises.default.mkdir(epubFolder, { recursive: true });
                return res.json({ success: true, books: [], folder: epubFolder });
            }
            
            // Read all epub files
            const files = await fsPromises.default.readdir(epubFolder);
            const epubFiles = files.filter(f => f.toLowerCase().endsWith('.epub'));
            
            const books = await Promise.all(epubFiles.map(async (filename) => {
                const filePath = pathModule.default.join(epubFolder, filename);
                const stats = await fsPromises.default.stat(filePath);
                
                // Extract title from filename (remove .epub extension)
                const title = filename.replace(/\.epub$/i, '');
                
                return {
                    title,
                    filename,
                    path: filePath,
                    size: stats.size,
                    modified: stats.mtime
                };
            }));
            
            // Sort by modified date (newest first)
            books.sort((a, b) => new Date(b.modified) - new Date(a.modified));
            
            res.json({ success: true, books, folder: epubFolder });
        } catch (e) {
            console.error('[Books] Library error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    // Read epub file content as base64
    app.get('/api/books/read', async (req, res) => {
        try {
            const fsPromises = await import('fs/promises');
            const filePath = req.query.path;
            
            if (!filePath) {
                return res.status(400).json({ success: false, error: 'Missing path parameter' });
            }
            
            // Security check: ensure the path is within allowed directories
            const os = await import('os');
            const pathModule = await import('path');
            
            let epubFolder;
            if (process.platform === 'win32') {
                epubFolder = pathModule.default.join(process.env.APPDATA || '', 'PlayTorrio', 'epub');
            } else if (process.platform === 'darwin') {
                epubFolder = pathModule.default.join(os.default.homedir(), 'Library', 'Application Support', 'PlayTorrio', 'epub');
            } else {
                epubFolder = pathModule.default.join(os.default.homedir(), '.config', 'PlayTorrio', 'epub');
            }
            
            const normalizedPath = pathModule.default.normalize(filePath);
            if (!normalizedPath.startsWith(epubFolder)) {
                return res.status(403).json({ success: false, error: 'Access denied' });
            }
            
            const fileBuffer = await fsPromises.default.readFile(filePath);
            const base64 = fileBuffer.toString('base64');
            
            res.json({ success: true, base64 });
        } catch (e) {
            console.error('[Books] Read error:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    
    app.post('/api/settings', (req, res) => {
        const s = readSettings();
        const next = {
            ...s,
            autoUpdate: req.body.autoUpdate !== undefined ? !!req.body.autoUpdate : (s.autoUpdate !== false),
            useTorrentless: req.body.useTorrentless != null ? !!req.body.useTorrentless : !!s.useTorrentless,
            torrentSource: req.body.torrentSource !== undefined ? req.body.torrentSource : (s.torrentSource || 'torrentio'),
            useDebrid: req.body.useDebrid != null ? !!req.body.useDebrid : !!s.useDebrid,
            debridProvider: req.body.debridProvider || s.debridProvider || 'realdebrid',
            rdClientId: typeof req.body.rdClientId === 'string' ? req.body.rdClientId.trim() || null : (s.rdClientId || null),
            playerType: req.body.playerType !== undefined ? req.body.playerType : (s.playerType || 'builtin'),
            useNodeMPV: req.body.useNodeMPV != null ? !!req.body.useNodeMPV : !!s.useNodeMPV,
            mpvPath: req.body.mpvPath !== undefined ? (req.body.mpvPath || null) : (s.mpvPath || null),
            discordActivity: req.body.discordActivity !== undefined ? !!req.body.discordActivity : (s.discordActivity !== false),
            showSponsor: req.body.showSponsor !== undefined ? !!req.body.showSponsor : (s.showSponsor !== false),
            torrentEngine: req.body.torrentEngine !== undefined ? req.body.torrentEngine : (s.torrentEngine || 'stremio'),
            torrentEngineInstances: req.body.torrentEngineInstances !== undefined ? parseInt(req.body.torrentEngineInstances, 10) : (s.torrentEngineInstances || 1),
            streamingMode: req.body.streamingMode !== undefined ? !!req.body.streamingMode : (s.streamingMode !== false), // Default to true
        };
        const ok = writeSettings(next);
        
        // Also handle Jackett URL and cache location
        const userSettings = loadUserSettings();
        let settingsUpdated = false;
        
        if (req.body.jackettUrl !== undefined) {
            userSettings.jackettUrl = req.body.jackettUrl;
            JACKETT_URL = req.body.jackettUrl;
            settingsUpdated = true;
        }
        if (req.body.prowlarrUrl !== undefined) {
            userSettings.prowlarrUrl = req.body.prowlarrUrl;
            PROWLARR_URL = req.body.prowlarrUrl;
            settingsUpdated = true;
        }
        if (req.body.cacheLocation !== undefined) {
            userSettings.cacheLocation = req.body.cacheLocation;
            CACHE_LOCATION = req.body.cacheLocation;
            settingsUpdated = true;
        }
        
        if (settingsUpdated) {
            saveUserSettings(userSettings);
        }
        
        if (ok) return res.json({ success: true, settings: { ...next, ...userSettings, rdToken: next.rdToken ? '***' : null } });
        return res.status(500).json({ success: false, error: 'Failed to save settings' });
    });

    // Debrid: token storage for Real-Debrid (server-side only)
    app.post('/api/debrid/token', async (req, res) => {
        const { token } = req.body || {};
        const s = readSettings();
        
        // Validate token if provided
        if (token && typeof token === 'string' && token.trim()) {
            const tokenToTest = token.trim();
            try {
                // Test the token by making a simple API call
                console.log('[RD][token] Testing API token validity...');
                const testUrl = 'https://api.real-debrid.com/rest/1.0/user';
                const testResp = await safeFetch(testUrl, {
                    headers: { Authorization: `Bearer ${tokenToTest}` }
                });
                
                if (!testResp.ok) {
                    const errorText = await testResp.text();
                    console.error('[RD][token] Invalid token:', errorText);
                    return res.status(401).json({ 
                        success: false, 
                        error: 'Invalid Real-Debrid API token. Please check your token and try again.',
                        code: 'INVALID_TOKEN'
                    });
                }
                
                const userData = await testResp.json();
                console.log('[RD][token] Valid API token for user:', userData?.username || 'unknown');
                
                // Save token (clear OAuth credentials since this is direct API token)
                const next = { 
                    ...s, 
                    rdToken: tokenToTest,
                    rdRefresh: null,  // API tokens don't have refresh tokens
                    rdCredId: null,   // Clear OAuth credentials
                    rdCredSecret: null
                };
                const ok = writeSettings(next);
                if (ok) return res.json({ success: true, username: userData?.username });
                return res.status(500).json({ success: false, error: 'Failed to save token' });
            } catch (e) {
                console.error('[RD][token] Error testing token:', e?.message);
                return res.status(502).json({ 
                    success: false, 
                    error: 'Failed to validate token with Real-Debrid',
                    code: 'VALIDATION_FAILED'
                });
            }
        } else {
            // Clear token
            const next = { ...s, rdToken: null, rdRefresh: null, rdCredId: null, rdCredSecret: null };
            const ok = writeSettings(next);
            if (ok) return res.json({ success: true });
            return res.status(500).json({ success: false, error: 'Failed to clear token' });
        }
    });

    // --- Playback resume endpoints ---
    // Get a saved resume position by key
    app.get('/api/resume', (req, res) => {
        try {
            const key = (req.query?.key || '').toString();
            if (!key) return res.status(400).json({ error: 'Missing key' });
            const map = readResumeMap();
            const rec = map[key];
            if (!rec) return res.status(404).json({});
            return res.json(rec);
        } catch (e) {
            return res.status(500).json({ error: e?.message || 'Failed to read resume' });
        }
    });
    // Save/update a resume position
    app.post('/api/resume', (req, res) => {
        try {
            const { key, position, duration, title, poster_path, tmdb_id, media_type, season, episode, sourceInfo } = req.body || {};
            const k = (key || '').toString();
            const pos = Number(position || 0);
            const dur = Number(duration || 0);
            if (!k) return res.status(400).json({ error: 'Missing key' });
            if (pos < 0) return res.status(400).json({ error: 'Bad position' });
            const map = readResumeMap();
            // If watched almost to end, clear entry instead of saving
            if (dur > 0 && pos / dur >= 0.95) {
                delete map[k];
                writeResumeMap(map);
                return res.json({ success: true, cleared: true });
            }
            const rec = { position: pos, duration: dur, updatedAt: new Date().toISOString() };
            if (title) rec.title = String(title);
            if (poster_path) rec.poster_path = String(poster_path);
            if (tmdb_id) rec.tmdb_id = tmdb_id;
            if (media_type) rec.media_type = String(media_type);
            if (season !== undefined && season !== null) rec.season = Number(season);
            if (episode !== undefined && episode !== null) rec.episode = Number(episode);
            // Store source info for replay functionality (provider, magnet, url, etc.)
            if (sourceInfo && typeof sourceInfo === 'object') {
                rec.sourceInfo = {
                    provider: sourceInfo.provider || null,
                    magnet: sourceInfo.magnet || null,
                    url: sourceInfo.url || null,
                    torrentTitle: sourceInfo.torrentTitle || null,
                    fileIndex: sourceInfo.fileIndex !== undefined ? sourceInfo.fileIndex : null,
                    streamUrl: sourceInfo.streamUrl || null,
                    embeddedServer: sourceInfo.embeddedServer || null
                };
            }
            map[k] = rec;
            // Cap entries to avoid unbounded growth (keep latest 500)
            const entries = Object.entries(map).sort((a, b) => new Date(b[1]?.updatedAt || 0) - new Date(a[1]?.updatedAt || 0));
            if (entries.length > 500) {
                const trimmed = Object.fromEntries(entries.slice(0, 500));
                writeResumeMap(trimmed);
                return res.json({ success: true });
            }
            writeResumeMap(map);
            return res.json({ success: true });
        } catch (e) {
            return res.status(500).json({ error: e?.message || 'Failed to save resume' });
        }
    });
    // Delete a resume record
    app.delete('/api/resume', (req, res) => {
        try {
            const key = (req.query?.key || req.body?.key || '').toString();
            if (!key) return res.status(400).json({ error: 'Missing key' });
            const map = readResumeMap();
            if (map[key]) delete map[key];
            writeResumeMap(map);
            return res.json({ success: true });
        } catch (e) {
            return res.status(500).json({ error: e?.message || 'Failed to delete resume' });
        }
    });
    
    // Get all resume records (for Continue Watching section)
    app.get('/api/resume/all', (req, res) => {
        try {
            const map = readResumeMap();
            // Convert to array and sort by most recent
            const items = Object.entries(map)
                .map(([key, data]) => ({
                    key,
                    title: data.title || 'Unknown',
                    position: data.position || 0,
                    duration: data.duration || 0,
                    poster_path: data.poster_path || null,
                    tmdb_id: data.tmdb_id || null,
                    media_type: data.media_type || null,
                    season: data.season || null,
                    episode: data.episode || null,
                    sourceInfo: data.sourceInfo || null,
                    updatedAt: data.updatedAt || new Date().toISOString()
                }))
                .filter(item => item.duration > 0 && item.position > 0 && item.position / item.duration < 0.95) // Only show items not fully watched
                .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
                .slice(0, 20); // Return max 20 items
            
            return res.json(items);
        } catch (e) {
            return res.status(500).json({ error: e?.message || 'Failed to read resume data' });
        }
    });

    // ============================================================================
    // MY LIST ENDPOINTS - User's personal watchlist
    // ============================================================================
    
    // Get my list
    app.get('/api/my-list', async (req, res) => {
        try {
            const MY_LIST_PATH = path.join(userDataPath, 'my-list.json');
            
            if (fs.existsSync(MY_LIST_PATH)) {
                const data = await fs.promises.readFile(MY_LIST_PATH, 'utf8');
                const list = JSON.parse(data);
                return res.json(Array.isArray(list) ? list : []);
            }
            
            return res.json([]);
        } catch (e) {
            console.error('[MyList] Error reading:', e);
            return res.status(500).json({ error: e?.message || 'Failed to read my list' });
        }
    });
    
    // Add to my list
    app.post('/api/my-list/add', async (req, res) => {
        try {
            const MY_LIST_PATH = path.join(userDataPath, 'my-list.json');
            const newItem = req.body;
            
            // Validate required fields
            if (!newItem.id || !newItem.media_type || !newItem.title) {
                return res.status(400).json({ error: 'Missing required fields: id, media_type, title' });
            }
            
            // Read existing list
            let list = [];
            if (fs.existsSync(MY_LIST_PATH)) {
                const data = await fs.promises.readFile(MY_LIST_PATH, 'utf8');
                list = JSON.parse(data);
            }
            
            // Check if already exists
            const exists = list.some(item => item.id === newItem.id && item.media_type === newItem.media_type);
            if (exists) {
                return res.json({ success: true, message: 'Item already in list' });
            }
            
            // Add new item with timestamp
            const itemToAdd = {
                ...newItem,
                added_date: new Date().toISOString()
            };
            
            list.push(itemToAdd);
            
            // Write back to file
            await fs.promises.writeFile(MY_LIST_PATH, JSON.stringify(list, null, 2));
            
            return res.json({ success: true, message: 'Added to my list' });
        } catch (e) {
            console.error('[MyList] Error adding:', e);
            return res.status(500).json({ error: e?.message || 'Failed to add to my list' });
        }
    });
    
    // Remove from my list
    app.post('/api/my-list/remove', async (req, res) => {
        try {
            const MY_LIST_PATH = path.join(userDataPath, 'my-list.json');
            const { id } = req.body;
            
            if (!id) {
                return res.status(400).json({ error: 'Missing id' });
            }
            
            // Read existing list
            let list = [];
            if (fs.existsSync(MY_LIST_PATH)) {
                const data = await fs.promises.readFile(MY_LIST_PATH, 'utf8');
                list = JSON.parse(data);
            }
            
            // Filter out the item
            const newList = list.filter(item => item.id !== parseInt(id));
            
            // Write back to file
            await fs.promises.writeFile(MY_LIST_PATH, JSON.stringify(newList, null, 2));
            
            return res.json({ success: true, message: 'Removed from my list' });
        } catch (e) {
            console.error('[MyList] Error removing:', e);
            return res.status(500).json({ error: e?.message || 'Failed to remove from my list' });
        }
    });

    // --- AllDebrid minimal adapter & auth (PIN flow) ---
    const AD_BASE = 'https://api.alldebrid.com/v4';
    function isNetworkError(e) {
        const msg = (e?.message || '').toLowerCase();
        return (
            /econnrefused|enotfound|eai_again|network|fetch failed|timeout|timed out|socket hang up/.test(msg)
        );
    }
    function withTimeout(fetchPromise, ms = 8000) {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), ms);
        return fetchPromise(ac.signal).finally(() => clearTimeout(t));
    }
    async function safeFetch(url, options = {}, timeoutMs = 8000) {
        try {
            const run = (signal) => fetch(url, { ...options, signal });
            const resp = await withTimeout(run, timeoutMs);
            return resp;
        } catch (e) {
            if (isNetworkError(e)) {
                const err = new Error('Network unreachable');
                err.code = 'NETWORK_UNREACHABLE';
                throw err;
            }
            throw e;
        }
    }
    async function adFetch(endpoint, opts = {}) {
        const s = readSettings();
        if (!s.adApiKey) throw new Error('Not authenticated with AllDebrid');
        const url = `${AD_BASE}${endpoint}`;
        console.log('[AD][call]', { endpoint, method: (opts.method || 'GET').toUpperCase() });
        let resp;
        try {
            resp = await safeFetch(url, { ...opts, headers: { Authorization: `Bearer ${s.adApiKey}`, ...(opts.headers || {}) } });
        } catch (e) {
            if (e?.code === 'NETWORK_UNREACHABLE') {
                const err = new Error('AllDebrid is unreachable right now.');
                err.code = 'AD_NETWORK';
                throw err;
            }
            throw e;
        }
        let bodyText = '';
        try { bodyText = await resp.text(); } catch {}
        // AllDebrid returns 200 with status success/error in JSON
        try {
            const j = bodyText ? JSON.parse(bodyText) : {};
            if (j && j.status === 'success') return j.data || j; // prefer data
            // map common errors
            const rawCode = j?.error?.code;
            const code = rawCode || `${resp.status}`;
            const msg = j?.error?.message || resp.statusText || 'AD error';
            const err = new Error(`AD ${endpoint} failed: ${code} ${msg}`);
            // normalize auth errors
            if (rawCode === 'AUTH_BAD_APIKEY' || rawCode === 'AUTH_MISSING') {
                err.code = 'AD_AUTH_INVALID';
                err.rawCode = rawCode;
            } else if (rawCode === 'AUTH_BLOCKED') {
                err.code = 'AD_AUTH_BLOCKED';
                err.rawCode = rawCode;
            } else {
                err.code = code;
            }
            throw err;
        } catch (e) {
            if (e instanceof SyntaxError) {
                if (!resp.ok) throw new Error(`AD ${endpoint} http ${resp.status}`);
                return bodyText;
            }
            throw e;
        }
    }

    // --- TorBox minimal adapter ---
const TB_BASE = 'https://api.torbox.app/v1';

async function tbFetch(endpoint, opts = {}) {
    const s = readSettings();
    if (!s.tbApiKey) throw new Error('Not authenticated with TorBox');

    const url = `${TB_BASE}${endpoint}`;
    console.log('[TB][call]', { endpoint, method: (opts.method || 'GET').toUpperCase() });

    let resp;
    try {
        resp = await safeFetch(url, { ...opts, headers: { Authorization: `Bearer ${s.tbApiKey}`, Accept: 'application/json', ...(opts.headers || {}) } });
    } catch (e) {
        if (e?.code === 'NETWORK_UNREACHABLE') {
            const err = new Error('TorBox is unreachable right now.');
            err.code = 'TB_NETWORK';
            throw err;
        }
        throw e;
    }

    const ct = resp.headers.get('content-type') || '';
    let bodyText = '';
    try { bodyText = await resp.text(); } catch {}

    let data = null;
    if (/json/i.test(ct)) {
        try { data = bodyText ? JSON.parse(bodyText) : null; } catch {}
    }

    if (!resp.ok) {
        const lower = (bodyText || '').toLowerCase();
        if (resp.status === 401 || lower.includes('unauthorized') || lower.includes('invalid token')) {
            try { const cur = readSettings(); writeSettings({ ...cur, tbApiKey: null }); } catch {}
            const err = new Error('TorBox authentication invalid'); err.code = 'TB_AUTH_INVALID'; throw err;
        }
        if (resp.status === 429 || lower.includes('rate')) { const err = new Error('TorBox rate limited'); err.code = 'TB_RATE_LIMIT'; throw err; }
        if (resp.status === 402 || lower.includes('premium')) { const err = new Error('TorBox premium required'); err.code = 'RD_PREMIUM_REQUIRED'; throw err; }
        const err = new Error(`TB ${endpoint} failed: ${resp.status} ${truncate(bodyText, 300)}`);
        throw err;
    }

    return data != null ? data : bodyText;
}

// Create a torrent from magnet
async function tbCreateTorrentFromMagnet(magnet) {
    // Strip trackers and extra params, sending only the info hash for maximum compatibility
    let cleanMagnet = magnet;
    const hashMatch = magnet.match(/xt=urn:btih:[a-zA-Z0-9]{32,40}/i);
    if (hashMatch) {
        cleanMagnet = `magnet:?${hashMatch[0]}`;
        console.log('[TB][prepare] Stripped magnet to hash only:', cleanMagnet);
    }

    const attempts = [
        { ep: '/api/torrents/createtorrent', type: 'form', body: { magnet: cleanMagnet } },
        { ep: '/api/torrents/createtorrent', type: 'form', body: { link: cleanMagnet } },
        { ep: '/api/torrents/createtorrent', type: 'json', body: { magnet: cleanMagnet } },
        { ep: '/api/torrents/createtorrent', type: 'json', body: { link: cleanMagnet } },
        { ep: '/api/torrents/createtorrent', type: 'json', body: { magnet_link: cleanMagnet } },
    ];

    let lastErr = null;
    for (const a of attempts) {
        try {
            const headers = a.type === 'json'
                ? { 'Content-Type': 'application/json' }
                : { 'Content-Type': 'application/x-www-form-urlencoded' };
            const body = a.type === 'json' ? JSON.stringify(a.body) : new URLSearchParams(a.body);
            const r = await tbFetch(a.ep, { method: 'POST', headers, body });

            const id = r?.id || r?.torrent_id || r?.data?.id || r?.data?.torrent_id || r?.data?.torrent?.id;
            if (id) return { ok: true, id: String(id), raw: r };
            lastErr = new Error('TorBox create returned no id');
        } catch (e) {
            lastErr = e;
            const msg = (e?.message || '').toLowerCase();
            // Continue if we hit an endpoint that doesn't exist or doesn't like the payload
            if (/404|400|422|missing|required/.test(msg)) continue;
            // Stop on auth/rate limit/etc
            throw e;
        }
    }

    if (lastErr) throw lastErr;
    throw new Error('Failed to create TorBox torrent');
}

// Get a permanent direct streaming URL
async function tbRequestDirectLink(torrentId, fileId = 0) {
    const s = readSettings();
    if (!s.tbApiKey) throw new Error('Not authenticated with TorBox');

    const qs = new URLSearchParams({
        token: s.tbApiKey,
        torrent_id: String(torrentId),
        file_id: String(fileId),
        redirect: 'true'
    });

    const url = `${TB_BASE}/api/torrents/requestdl?${qs.toString()}`;
    console.log('[TB][requestdl] calling:', url.replace(s.tbApiKey, 'API_KEY'));

    const resp = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${s.tbApiKey}`, Accept: '*/*' },
        redirect: 'follow'
    });

    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`TorBox requestdl failed: ${resp.status} ${text}`);
    }

    return resp.url || (await resp.text()).trim();
}

// Fetch torrent info and return streamable link
async function tbGetStreamUrl(torrentId, timeout = 30_000) {
    const start = Date.now();

    while (true) {
        const data = await tbFetch(`/api/torrents/mylist?id=${torrentId}&bypassCache=true`);
        if (!data?.files || !data.files.length) throw new Error('No files found in torrent');

        const fileId = data.files[0].id; // Use the raw file.id directly
        if (fileId == null) throw new Error('Torrent file has no ID');

        if (data.cached) { // Torrent is cached
            const streamUrl = await tbRequestDirectLink(torrentId, fileId);
            console.log('[TB] Streaming URL ready:', streamUrl);
            return streamUrl;
        }

        if (Date.now() - start > timeout) {
            throw new Error('Torrent not cached within timeout');
        }

        console.log('[TB] Waiting for torrent to be cached...');
        await new Promise(r => setTimeout(r, 2000));
    }
}



// Example usage
(async () => {
    try {
        const torrent = await tbCreateTorrentFromMagnet('MAGNET_LINK_HERE');
        const url = await tbGetStreamUrl(torrent.id);
        console.log('Play this URL in your player:', url);
    } catch (err) {
        console.error('TorBox error:', err);
    }
})();



    function extractNamedStringDeep(obj, names = []) {
        if (!obj) return null;
        const seen = new Set();
        const stack = [obj];
        while (stack.length) {
            const cur = stack.pop();
            if (!cur || typeof cur !== 'object') continue;
            if (seen.has(cur)) continue;
            seen.add(cur);
            for (const [k, v] of Object.entries(cur)) {
                if (v && typeof v === 'object') stack.push(v);
                if (typeof v === 'string') {
                    const lowerK = k.toLowerCase();
                    if (names.some(n => lowerK === n.toLowerCase())) return v;
                }
            }
        }
        return null;
    }

    // Premiumize.me API helper
    const PM_BASE = 'https://www.premiumize.me/api';
    async function pmFetch(endpoint, opts = {}) {
        const s = readSettings();
        if (!s.pmApiKey) {
            const err = new Error('Not authenticated with Premiumize');
            err.code = 'PM_AUTH_INVALID';
            throw err;
        }
        
        // Build URL with apikey parameter
        const url = new URL(`${PM_BASE}${endpoint}`);
        url.searchParams.set('apikey', s.pmApiKey);
        
        console.log('[PM][call]', { endpoint, method: (opts.method || 'GET').toUpperCase() });
        
        let resp;
        try {
            resp = await safeFetch(url.toString(), {
                ...opts,
                headers: {
                    'Accept': 'application/json',
                    ...(opts.headers || {})
                }
            });
        } catch (e) {
            if (e?.code === 'NETWORK_UNREACHABLE') {
                const err = new Error('Premiumize is unreachable right now.');
                err.code = 'PM_NETWORK';
                throw err;
            }
            throw e;
        }
        
        const ct = resp.headers.get('content-type') || '';
        let bodyText = '';
        try { bodyText = await resp.text(); } catch {}
        
        let data = null;
        if (/json/i.test(ct)) {
            try { data = bodyText ? JSON.parse(bodyText) : null; } catch {}
        }
        
        if (!resp.ok) {
            const lower = (bodyText || '').toLowerCase();
            // Clear API key on auth errors
            if (resp.status === 401 || resp.status === 403 || lower.includes('unauthorized') || lower.includes('invalid') || lower.includes('auth')) {
                try { 
                    const cur = readSettings(); 
                    writeSettings({ ...cur, pmApiKey: null }); 
                } catch {}
                const err = new Error('Premiumize authentication invalid');
                err.code = 'PM_AUTH_INVALID';
                throw err;
            }
            if (resp.status === 429 || lower.includes('rate')) {
                const err = new Error('Premiumize rate limited');
                err.code = 'PM_RATE_LIMIT';
                throw err;
            }
            if (resp.status === 402 || lower.includes('premium')) {
                const err = new Error('Premiumize premium required');
                err.code = 'PM_PREMIUM_REQUIRED';
                throw err;
            }
            const err = new Error(`PM ${endpoint} failed: ${resp.status} ${truncate(bodyText, 300)}`);
            throw err;
        }
        
        // Check for API-level error in response
        if (data && data.status === 'error') {
            const errMsg = data.message || 'Premiumize API error';
            if (/auth|unauthorized|invalid/i.test(errMsg)) {
                try { 
                    const cur = readSettings(); 
                    writeSettings({ ...cur, pmApiKey: null }); 
                } catch {}
                const err = new Error(errMsg);
                err.code = 'PM_AUTH_INVALID';
                throw err;
            }
            throw new Error(errMsg);
        }
        
        return data != null ? data : bodyText;
    }

    // Save/clear AllDebrid API key manually (optional)
    app.post('/api/debrid/ad/apikey', (req, res) => {
        try {
            const s = readSettings();
            const key = (req.body?.apikey || '').toString().trim();
            const next = { ...s, adApiKey: key || null };
            const ok = writeSettings(next);
            if (!ok) return res.status(500).json({ success: false, error: 'Failed to save apikey' });
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ success: false, error: e?.message || 'Failed' });
        }
    });

    // TorBox token save/clear (placeholder auth storage)
    app.post('/api/debrid/tb/token', (req, res) => {
        try {
            const s = readSettings();
            const token = (req.body?.token || '').toString().trim();
            const next = { ...s, tbApiKey: token || null };
            const ok = writeSettings(next);
            if (!ok) return res.status(500).json({ success: false, error: 'Failed to save TorBox token' });
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ success: false, error: e?.message || 'Failed' });
        }
    });

    // Premiumize API key save/clear
    app.post('/api/debrid/pm/apikey', (req, res) => {
        try {
            const s = readSettings();
            const apikey = (req.body?.apikey || '').toString().trim();
            const next = { ...s, pmApiKey: apikey || null };
            const ok = writeSettings(next);
            if (!ok) return res.status(500).json({ success: false, error: 'Failed to save Premiumize API key' });
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ success: false, error: e?.message || 'Failed' });
        }
    });

    // AllDebrid PIN start
    app.get('/api/debrid/ad/pin', async (req, res) => {
        try {
            const r = await fetch('https://api.alldebrid.com/v4.1/pin/get');
            const j = await r.json();
            if (j?.status !== 'success') return res.status(502).json({ error: j?.error?.message || 'Failed to start PIN' });
            res.json(j.data || {});
        } catch (e) {
            res.status(502).json({ error: e?.message || 'Failed to start AD pin' });
        }
    });

    // AllDebrid PIN check (poll until apikey)
    app.post('/api/debrid/ad/check', async (req, res) => {
        try {
            const { pin, check } = req.body || {};
            if (!pin || !check) return res.status(400).json({ error: 'Missing pin/check' });
            const r = await fetch('https://api.alldebrid.com/v4/pin/check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
                body: new URLSearchParams({ pin, check })
            });
            const j = await r.json();
            if (j?.status !== 'success') return res.status(400).json({ error: j?.error?.message || 'PIN invalid or expired' });
            const data = j.data || {};
            if (data.activated && data.apikey) {
                const s = readSettings();
                writeSettings({ ...s, adApiKey: data.apikey });
                return res.json({ success: true });
            }
            res.json({ success: false, activated: !!data.activated, expires_in: data.expires_in || 0 });
        } catch (e) {
            res.status(502).json({ error: e?.message || 'AD check failed' });
        }
    });

    // RD device-code: start flow (requires rdClientId provided in settings or param)
    app.get('/api/debrid/rd/device-code', async (req, res) => {
        try {
            const s = readSettings();
            // Use official Real-Debrid public client ID if none provided
            const DEFAULT_RD_CLIENT_ID = 'X245A4XAIBGVM';
            const clientId = (req.query.client_id || s.rdClientId || DEFAULT_RD_CLIENT_ID).toString().trim();
            if (!clientId) return res.status(400).json({ error: 'Missing Real-Debrid client_id' });
            console.log('[RD][device-code] start', { clientId: mask(clientId) });
            
            // Real-Debrid device code endpoint requires GET with query parameters
            const url = new URL('https://api.real-debrid.com/oauth/v2/device/code');
            url.searchParams.append('client_id', clientId);
            url.searchParams.append('new_credentials', 'yes');
            
            const r = await fetch(url.toString(), {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });
            
            if (!r.ok) {
                const errorText = await r.text();
                console.error('[RD][device-code] error response:', errorText);
                return res.status(r.status).json({ error: errorText });
            }
            
            const j = await r.json();
            console.log('[RD][device-code] response', { verification_url: j?.verification_url, interval: j?.interval, expires_in: j?.expires_in });
            res.json(j); // { device_code, user_code, interval, expires_in, verification_url }
        } catch (e) {
            console.error('[RD][device-code] error', e?.message);
            res.status(502).json({ error: e?.message || 'Device code start failed' });
        }
    });

    // RD device-code: poll for token
    app.post('/api/debrid/rd/poll', async (req, res) => {
        try {
            const s = readSettings();
            const DEFAULT_RD_CLIENT_ID = 'X245A4XAIBGVM';
            const clientId = (req.body?.client_id || s.rdClientId || DEFAULT_RD_CLIENT_ID).toString().trim();
            const deviceCode = (req.body?.device_code || '').toString().trim();
            if (!clientId || !deviceCode) return res.status(400).json({ error: 'Missing client_id or device_code' });
            console.log('[RD][poll] begin', { clientId: mask(clientId), deviceCode: mask(deviceCode) });

            // Step 1: obtain client credentials
            const credsUrl = new URL('https://api.real-debrid.com/oauth/v2/device/credentials');
            credsUrl.searchParams.append('client_id', clientId);
            credsUrl.searchParams.append('code', deviceCode);
            
            const credsRes = await fetch(credsUrl.toString(), {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });
            
            if (!credsRes.ok) {
                const errorText = await credsRes.text();
                console.error('[RD][poll] credentials error:', errorText);
                return res.status(credsRes.status).json({ error: errorText });
            }
            
            const creds = await credsRes.json(); // { client_id, client_secret }
            if (!creds.client_id || !creds.client_secret) {
                console.error('[RD][poll] invalid credentials response:', creds);
                return res.status(500).json({ error: 'Invalid credentials response' });
            }
            console.log('[RD][poll] creds ok');

            // Step 2: exchange for access token
            const tokenBody = new URLSearchParams({
                client_id: creds.client_id,
                client_secret: creds.client_secret,
                code: deviceCode,
                grant_type: 'http://oauth.net/grant_type/device/1.0'
            });
            const tokenRes = await fetch('https://api.real-debrid.com/oauth/v2/token', {
                method: 'POST',
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
                body: tokenBody
            });
            
            if (!tokenRes.ok) {
                const errorText = await tokenRes.text();
                console.error('[RD][poll] token error:', errorText);
                return res.status(tokenRes.status).json({ error: errorText });
            }
            
            const token = await tokenRes.json();
            if (!token.access_token) {
                console.error('[RD][poll] no access_token in response:', token);
                return res.status(500).json({ error: 'No access_token returned' });
            }
            
            const next = { ...s, rdToken: token.access_token, rdRefresh: token.refresh_token || null, rdCredId: creds.client_id, rdCredSecret: creds.client_secret };
            writeSettings(next);
            console.log('[RD][poll] token saved', { hasRefresh: !!token.refresh_token });
            res.json({ success: true });
        } catch (e) {
            console.error('[RD][poll] error', e?.message, e?.stack);
            res.status(502).json({ error: e?.message || 'Device code poll failed' });
        }
    });

    // Download any subtitle by direct URL and serve as .vtt (when possible)
    app.post('/api/subtitles/download-direct', async (req, res) => {
        try {
            ensureSubsDir();
            const { url, preferredName } = req.body || {};
            if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
                return res.status(400).json({ error: 'Invalid url' });
            }
            const r = await fetch(url);
            if (!r.ok) return res.status(500).json({ error: `Failed to fetch subtitle (${r.status})` });
            const buf = Buffer.from(await r.arrayBuffer());
            const ct = r.headers.get('content-type') || '';
            const cd = r.headers.get('content-disposition') || '';
            let base = preferredName || 'subtitle';
            let ext = '.srt';
            const m = cd.match(/filename="?([^";]+)"?/i);
            if (m) {
                base = m[1].replace(/\.[^.]+$/,'');
            }
            if (/vtt/i.test(ct)) ext = '.vtt';
            else if (/srt/i.test(ct)) ext = '.srt';
            else if (/ass|ssa/i.test(ct)) ext = '.ass';
            // Convert to VTT when SRT detected
            let text = buf.toString('utf8');
            let finalPath = '';
            if (ext === '.vtt' || /^\s*WEBVTT/i.test(text)) {
                finalPath = path.join(SUB_TMP_DIR, `${base}.vtt`);
                fs.writeFileSync(finalPath, /^\s*WEBVTT/i.test(text) ? text : `WEBVTT\n\n${text}`);
            } else if (ext === '.srt' || /(\d{2}:\d{2}:\d{2}),(\d{3})\s*-->/m.test(text)) {
                const vtt = srtToVtt(text);
                finalPath = path.join(SUB_TMP_DIR, `${base}.vtt`);
                fs.writeFileSync(finalPath, vtt);
            } else if (ext === '.ass' || /\[Script Info\]/i.test(text)) {
                const vtt = assToVtt(text);
                finalPath = path.join(SUB_TMP_DIR, `${base}.vtt`);
                fs.writeFileSync(finalPath, vtt);
            } else {
                finalPath = path.join(SUB_TMP_DIR, `${base}.vtt`);
                fs.writeFileSync(finalPath, `WEBVTT\n\n${text}`);
            }
            const servedName = path.basename(finalPath);
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            res.json({ url: `${baseUrl}/subtitles/${encodeURIComponent(servedName)}`, filename: servedName });
        } catch (e) {
            res.status(500).json({ error: e?.message || 'Failed to download direct subtitle' });
        }
    });

    // --- Real-Debrid minimal adapter ---
    const RD_BASE = 'https://api.real-debrid.com/rest/1.0';
    let rdRefreshing = false;
    // RD rate limiter: simple token bucket with 250 req/min limit
    const rdRateLimiter = {
        tokens: 250,
        maxTokens: 250,
        refillRate: 250 / 60, // 250 per minute = ~4.17 per second
        lastRefill: Date.now(),
        
        async acquire() {
            const now = Date.now();
            const elapsed = (now - this.lastRefill) / 1000; // seconds
            this.tokens = Math.min(this.maxTokens, this.tokens + (elapsed * this.refillRate));
            this.lastRefill = now;
            
            if (this.tokens >= 1) {
                this.tokens -= 1;
                return;
            }
            
            // Wait until we have a token
            const waitTime = ((1 - this.tokens) / this.refillRate) * 1000;
            console.log(`[RD][rate-limit] Waiting ${Math.ceil(waitTime)}ms for token...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            this.tokens = 0; // consumed the token we waited for
        }
    };

    // Instant availability is intentionally disabled in this app flow
    let rdInstantAvailabilityDisabled = true;

    async function rdFetch(endpoint, opts = {}) {
        const started = Date.now();
        
        // Rate limiting: acquire token before making request
        await rdRateLimiter.acquire();
        
        const attempt = async (token, retryCount = 0) => {
            const url = `${RD_BASE}${endpoint}`;
            console.log('[RD][call]', { endpoint, method: (opts.method || 'GET').toUpperCase(), retry: retryCount });
            
            const headers = {
                Authorization: `Bearer ${token}`,
                Accept: 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                ...(opts.headers || {})
            };
            
            let response;
            try {
                response = await safeFetch(url, { ...opts, headers });
            } catch (e) {
                if (e?.code === 'NETWORK_UNREACHABLE') {
                    const err = new Error('Real‑Debrid is unreachable right now.');
                    err.code = 'RD_NETWORK';
                    throw err;
                }
                throw e;
            }
            
            // Handle 429 rate limit with exponential backoff
            if (response.status === 429) {
                if (retryCount < 3) {
                    const backoffMs = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
                    console.warn(`[RD][429] Rate limited, backing off ${backoffMs}ms (attempt ${retryCount + 1}/3)`);
                    await new Promise(resolve => setTimeout(resolve, backoffMs));
                    // Reset rate limiter tokens to prevent cascading issues
                    rdRateLimiter.tokens = Math.max(0, rdRateLimiter.tokens - 10);
                    return attempt(token, retryCount + 1);
                }
                console.error('[RD][429] Rate limit exceeded after 3 retries');
                const err = new Error('Real-Debrid rate limit exceeded. Please wait a moment.');
                err.code = 'RD_RATE_LIMIT';
                err.status = 429;
                throw err;
            }
            
            return response;
        };
        
        let s = readSettings();
        if (!s.rdToken) throw new Error('Not authenticated with Real-Debrid');
        let resp = await attempt(s.rdToken);
        
        if (resp.status === 401 || resp.status === 403) {
            // Try token refresh if possible (only for OAuth tokens with refresh capability)
            if (!rdRefreshing && s.rdRefresh && s.rdCredId && s.rdCredSecret) {
                try {
                    rdRefreshing = true;
                    console.warn('[RD][refresh] attempting refresh_token flow');
                    // Per RD docs, refresh is performed using device grant with code = refresh_token
                    const tb = new URLSearchParams({
                        client_id: s.rdCredId,
                        client_secret: s.rdCredSecret,
                        code: s.rdRefresh,
                        grant_type: 'http://oauth.net/grant_type/device/1.0'
                    });
                    const tr = await fetch('https://api.real-debrid.com/oauth/v2/token', {
                        method: 'POST', 
                        headers: { 
                            'Accept': 'application/json', 
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                        }, 
                        body: tb
                    });
                    if (tr.ok) {
                        const tj = await tr.json();
                        const next = { ...s, rdToken: tj.access_token || s.rdToken, rdRefresh: tj.refresh_token || s.rdRefresh };
                        writeSettings(next);
                        s = next;
                        console.log('[RD][refresh] success, token rotated');
                        // Retry once with new token
                        resp = await attempt(s.rdToken);
                    } else {
                        const errorText = await tr.text();
                        console.warn('[RD][refresh] failed:', errorText);
                        // Refresh failed, clear OAuth tokens
                        const cleared = { ...s, rdToken: null, rdRefresh: null, rdCredId: null, rdCredSecret: null };
                        writeSettings(cleared);
                    }
                } catch (e) {
                    console.error('[RD][refresh] exception:', e?.message);
                }
                finally { rdRefreshing = false; }
            } else if (!s.rdRefresh && !s.rdCredId && !s.rdCredSecret) {
                // This is a direct API token (no OAuth credentials)
                // Don't auto-clear API tokens - they're permanent unless manually revoked
                console.warn('[RD] Direct API token got 401/403 - may be invalid, expired, or IP-blocked');
                console.warn('[RD] Please generate a new API token from Real-Debrid website');
                // Still throw the error so user gets notified, but don't auto-clear
            } else {
                // OAuth token but no refresh capability (shouldn't happen normally)
                console.warn('[RD] OAuth token without refresh capability, clearing');
                const cleared = { ...s, rdToken: null, rdRefresh: null };
                writeSettings(cleared);
            }
        }
        
        if (!resp.ok) {
            let msg = resp.statusText;
            let rawBody = '';
            try { 
                rawBody = await resp.text();
                msg = rawBody;
            } catch {}
            
            // Log detailed error info
            console.error('[RD][call] error', { 
                endpoint, 
                status: resp.status, 
                statusText: resp.statusText,
                body: truncate(msg, 500) 
            });
            
            // Provide specific error messages for common status codes
            if (resp.status === 403) {
                if (/permission_denied|account_locked|not_premium/i.test(msg)) {
                    const err = new Error('Real-Debrid premium account is required for this feature.');
                    err.code = 'RD_PREMIUM_REQUIRED';
                    err.status = 403;
                    throw err;
                } else if (/disabled_endpoint/i.test(msg)) {
                    const err = new Error('This Real-Debrid feature is disabled for your account.');
                    err.code = 'RD_FEATURE_UNAVAILABLE';
                    err.status = 403;
                    throw err;
                } else {
                    const err = new Error('Real-Debrid access denied. Check your account status and IP restrictions.');
                    err.code = 'RD_FORBIDDEN';
                    err.status = 403;
                    throw err;
                }
            }
            
            if (resp.status === 429) {
                const err = new Error('Real-Debrid rate limit exceeded. Please wait before retrying.');
                err.code = 'RD_RATE_LIMIT';
                err.status = 429;
                throw err;
            }
            
            if (resp.status === 502 || resp.status === 503) {
                const err = new Error('Real-Debrid service is temporarily unavailable.');
                err.code = 'RD_UNAVAILABLE';
                err.status = resp.status;
                throw err;
            }
            
            // For OAuth tokens that failed refresh, we already cleared them above
            // For API tokens, we keep them and just report the error
            const err = new Error(`RD ${endpoint} failed: ${resp.status} ${msg}`);
            err.status = resp.status;
            throw err;
        }
        
        const ct = resp.headers.get('content-type') || '';
        const cl = resp.headers.get('content-length') || '?';
        const elapsed = Date.now() - started;
        console.log('[RD][call] ok', { endpoint, status: resp.status, ms: elapsed, cl });
        
        // Handle JSON parsing with error handling
        // We relax the check to include 201 Created which implies a resource was made (and usually returns JSON)
        if (/json/i.test(ct) || resp.status === 201) {
            try {
                const text = await resp.text();
                if (!text || text.trim() === '') {
                    console.warn('[RD][call] Empty JSON response for', endpoint);
                    return {};
                }
                return JSON.parse(text);
            } catch (e) {
                console.error('[RD][call] JSON parse error for', endpoint, ':', e?.message);
                // console.error('[RD][call] Response text:', text?.substring(0, 200)); // text not available here in catch scope easily without refactor
                const err = new Error(`RD ${endpoint} returned invalid JSON: ${e?.message}`);
                err.code = 'RD_PARSE_ERROR';
                err.status = 502;
                throw err;
            }
        }
        
        return resp.text();
    }

    // Helper: extract info hash from magnet link
    function extractInfoHash(magnet) {
        const match = magnet.match(/[?&]xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i);
        if (!match) return null;
        let hash = match[1];
        // Convert base32 to hex if needed (32 chars = base32, 40 chars = hex)
        if (hash.length === 32) {
            // For simplicity, RD API accepts both formats, so just return uppercase
            return hash.toUpperCase();
        }
        return hash.toUpperCase();
    }

    // Helper: no-op; we no longer call RD instantAvailability
    async function rdMarkCachedFiles(info) { return info; }

    // Debrid availability endpoint
    app.get('/api/debrid/availability', async (req, res) => {
        try {
            const s = readSettings();
            if (!s.useDebrid) return res.status(400).json({ error: 'Debrid disabled' });
            const btih = String(req.query.btih || '').trim().toUpperCase();
            if (!btih || btih.length < 32) return res.status(400).json({ error: 'Invalid btih' });
            const provider = (s.debridProvider || 'realdebrid').toLowerCase();
            
            if (provider === 'realdebrid') {
                // Real-Debrid Instant Availability
                // Endpoint: /torrents/instantAvailability/{hash}
                try {
                    const data = await rdFetch(`/torrents/instantAvailability/${btih}`);
                    // Response structure: { "HASH": { "rd": [ { ...variants... } ] } }
                    // If "rd" key exists and is an array with items, it is cached on RD servers.
                    const lower = btih.toLowerCase();
                    const entry = data?.[lower];
                    
                    // Check if 'rd' property exists and has content
                    let available = false;
                    if (entry && Array.isArray(entry.rd) && entry.rd.length > 0) {
                        available = true;
                    }
                    
                    return res.json({ provider: 'realdebrid', available, raw: data });
                } catch (e) {
                    const msg = e?.message || '';
                    // 404 from RD instant availability usually just means "not found/not valid hash" or similar, 
                    // but usually it returns 200 with empty object or specific structure.
                    // If actual error:
                    console.error('[RD][availability] check failed', msg);
                    if (e?.code === 'RD_FORBIDDEN') return res.status(403).json({ error: 'RD access denied', code: 'RD_FORBIDDEN' });
                    return res.json({ provider: 'realdebrid', available: false, error: msg });
                }
            }
            if (provider === 'torbox') {
                console.log('[TB][availability]', { btih });
                try {
                    const data = await tbFetch(`/api/torrents/checkcached?hash=${encodeURIComponent(btih)}&format=object`);
                    // Heuristic: available if object contains the hash key or indicates truthy cached/list
                    const lower = btih.toLowerCase();
                    const available = !!(data && (data[btih] || data[lower] || data?.cached || (Array.isArray(data?.list) && data.list.length)));
                    return res.json({ provider: 'torbox', available, raw: data });
                } catch (e) {
                    const msg = e?.message || '';
                    if (e?.code === 'TB_AUTH_INVALID') return res.status(401).json({ error: 'TorBox authentication invalid.', code: 'DEBRID_UNAUTH' });
                    if (e?.code === 'TB_NETWORK') return res.status(503).json({ error: 'TorBox is unreachable right now. Please try again later.', code: 'TB_UNAVAILABLE' });
                    if (e?.code === 'TB_RATE_LIMIT' || /429/.test(msg)) return res.status(429).json({ error: 'TorBox rate limit. Try again shortly.', code: 'TB_RATE_LIMIT' });
                    return res.status(502).json({ error: 'TorBox availability failed' });
                }
            }
            if (provider === 'premiumize') {
                console.log('[PM][availability]', { btih });
                try {
                    const data = await pmFetch(`/cache/check?items[]=${encodeURIComponent(btih)}`);
                    // Premiumize returns { status: 'success', response: [true/false], transcoded: [...] }
                    const available = !!(data && data.status === 'success' && Array.isArray(data.response) && data.response[0] === true);
                    return res.json({ provider: 'premiumize', available, raw: data });
                } catch (e) {
                    const msg = e?.message || '';
                    if (e?.code === 'PM_AUTH_INVALID') return res.status(401).json({ error: 'Premiumize authentication invalid.', code: 'DEBRID_UNAUTH' });
                    if (e?.code === 'PM_NETWORK') return res.status(503).json({ error: 'Premiumize is unreachable right now. Please try again later.', code: 'PM_UNAVAILABLE' });
                    if (e?.code === 'PM_RATE_LIMIT' || /429/.test(msg)) return res.status(429).json({ error: 'Premiumize rate limit. Try again shortly.', code: 'PM_RATE_LIMIT' });
                    return res.status(502).json({ error: 'Premiumize availability failed' });
                }
            }
            return res.status(400).json({ error: 'Availability not supported for this provider' });
        } catch (e) {
            const msg = e?.message || '';
            console.error('[RD][availability] error', msg);
            if (/\s429\s/i.test(msg) || /too_many_requests/i.test(msg)) {
                return res.status(429).json({ error: 'Real‑Debrid rate limit. Try again shortly.', code: 'RD_RATE_LIMIT' });
            }
            if (e?.code === 'RD_NETWORK' || /econnrefused|enotfound|network|timeout/i.test(msg)) {
                return res.status(503).json({ error: 'Real‑Debrid is unreachable right now. Please try again later.', code: 'RD_UNAVAILABLE' });
            }
            if (/disabled_endpoint/i.test(msg)) {
                return res.status(403).json({ error: 'Real‑Debrid availability endpoint disabled for this account.', code: 'RD_FEATURE_UNAVAILABLE' });
            }
            res.status(502).json({ error: msg || 'Debrid availability failed' });
        }
    });

    // Add magnet to Debrid provider. Returns torrent id and current info.
    app.post('/api/debrid/prepare', async (req, res) => {
        try {
            const s = readSettings();
            if (!s.useDebrid) return res.status(400).json({ error: 'Debrid disabled' });
            const magnet = (req.body?.magnet || '').toString();
            if (!magnet.startsWith('magnet:')) return res.status(400).json({ error: 'Missing magnet' });
            const provider = (s.debridProvider || 'realdebrid').toLowerCase();
            
            if (provider === 'realdebrid') {
                // Extract info hash from magnet
                const btih = extractInfoHash(magnet);
                
                // Step 2: Check existing torrents to avoid duplicates
                if (btih) {
                    try {
                        // Check first page (limit 100)
                        const existing = await rdFetch('/torrents?limit=100');
                        if (Array.isArray(existing)) {
                            const match = existing.find(t => (t?.hash || '').toLowerCase() === btih.toLowerCase());
                            if (match && match.id) {
                                console.log('[RD][prepare] Reusing existing torrent (found in page 1)', { id: match.id, status: match.status });
                                
                                // Ensure files are selected so links are generated, even on reuse
                                if (match.status === 'downloaded' || match.status === 'waiting_files_selection') {
                                    try {
                                        await rdFetch(`/torrents/selectFiles/${match.id}`, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                                            body: new URLSearchParams({ files: 'all' })
                                        });
                                    } catch (e) {
                                        console.warn('[RD][prepare] Failed to select files on reuse:', e?.message);
                                    }
                                }

                                let info = await rdFetch(`/torrents/info/${match.id}`);
                                return res.json({ id: match.id, info, reused: true });
                            }
                        }
                    } catch (e) {
                        console.warn('[RD][prepare] Could not check existing torrents:', e?.message);
                    }
                }
                
                // Step 3: If not cached and not exists, add new magnet
                console.log('[RD][prepare] Adding magnet to Real-Debrid');
                const addRes = await rdFetch('/torrents/addMagnet', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ magnet })
                });
                
                let id = addRes?.id;
                
                // Fallback: If addMagnet returned 200 OK but empty body (no ID), check torrent list again.
                // This handles transient RD API glitches where it accepts the magnet but drops the JSON response.
                if (!id && btih) {
                    console.warn('[RD][prepare] addMagnet returned no ID, scanning torrent list for fallback...');
                    try {
                        // Small delay to ensure RD processed it
                        await new Promise(r => setTimeout(r, 500));
                        
                        // DEEP SCAN: Check up to 5 pages (500 torrents)
                        // If "200 Empty" means "Already Exists", it might be an old torrent deep in history
                        let foundId = null;
                        for (let page = 1; page <= 5; page++) {
                            console.log(`[RD][prepare] Scanning torrents page ${page}...`);
                            const list = await rdFetch(`/torrents?limit=100&page=${page}`);
                            if (!Array.isArray(list) || list.length === 0) break;
                            
                            const match = list.find(t => (t?.hash || '').toLowerCase() === btih.toLowerCase());
                            if (match && match.id) {
                                console.log('[RD][prepare] Found torrent in fallback scan', { id: match.id, page });
                                foundId = match.id;
                                break;
                            }
                        }
                        
                        if (foundId) {
                            id = foundId;
                        } else {
                            // If NOT found in list after deep scan, retry addMagnet once with minimal hash
                            console.warn('[RD][prepare] Torrent not found in deep scan. Retrying addMagnet with minimal hash...');
                            const minimalMagnet = `magnet:?xt=urn:btih:${btih}`;
                            const retryAdd = await rdFetch('/torrents/addMagnet', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                                body: new URLSearchParams({ magnet: minimalMagnet })
                            });
                            if (retryAdd?.id) {
                                console.log('[RD][prepare] Retry addMagnet succeeded', { id: retryAdd.id });
                                id = retryAdd.id;
                            }
                        }
                    } catch (e) {
                        console.warn('[RD][prepare] Fallback check failed:', e?.message);
                    }
                }

                if (!id) return res.status(500).json({ error: 'Failed to add magnet' });
                console.log('[RD][prepare] added', { id });
                
                // CRITICAL: For cached torrents, we MUST select files immediately
                // Otherwise RD times out and starts downloading from scratch
                // We select "all" here to claim the cache, then user can switch to specific file later
                console.log('[RD][prepare] Selecting all files to claim cache...');
                
                try {
                    await rdFetch(`/torrents/selectFiles/${id}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({ files: 'all' })
                    });
                    console.log('[RD][prepare] Files selected - cache claimed');
                } catch (e) {
                    console.warn('[RD][prepare] Failed to select files:', e?.message);
                }
                
                // Fetch latest info (should now have links for cached items)
                let info = await rdFetch(`/torrents/info/${id}`);
                
                // Server-side logging of files for immediate visibility in terminal
                if (info && info.files) {
                    console.log(`--- FILES FOUND IN RD TORRENT: ${info.filename || 'Torrent'} ---`);
                    info.files.forEach((file, i) => {
                        console.log(`  [File ${i+1}] ${file.path || file.filename || 'Unknown'} (${(file.bytes / 1024 / 1024).toFixed(2)} MB)`);
                    });
                    console.log(`--------------------------------------------------`);
                }

                return res.json({ id, info });
            } else if (provider === 'alldebrid') {
                console.log('[AD][prepare] magnet/upload');
                // Upload magnet
                let data;
                try {
                    data = await adFetch('/magnet/upload', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams([['magnets[]', magnet]])
                    });
                } catch (e) {
                    const msg = e?.message || '';
                    if (e?.code === 'AD_AUTH_INVALID' || /AUTH_BAD_APIKEY|Not authenticated with AllDebrid/i.test(msg)) {
                        // Clear invalid key so UI reflects logged-out state
                        const cur = readSettings();
                        writeSettings({ ...cur, adApiKey: null });
                        return res.status(401).json({ error: 'AllDebrid authentication invalid. Please login again.', code: 'DEBRID_UNAUTH' });
                    }
                    if (e?.code === 'AD_NETWORK') {
                        return res.status(503).json({ error: 'AllDebrid is unreachable right now. Please try again later.', code: 'AD_UNAVAILABLE' });
                    }
                    if (e?.code === 'AD_AUTH_BLOCKED' || /AUTH_BLOCKED/i.test(msg)) {
                        return res.status(403).json({ error: 'AllDebrid security check: verify the authorization email, then retry.', code: 'AD_AUTH_BLOCKED' });
                    }
                    if (e?.code === 'MAGNET_MUST_BE_PREMIUM' || /MUST_BE_PREMIUM/i.test(msg)) {
                        return res.status(403).json({ error: 'AllDebrid premium is required to add torrents.', code: 'RD_PREMIUM_REQUIRED' });
                    }
                    throw e;
                }
                const first = Array.isArray(data?.magnets) ? data.magnets.find(m => m?.id) : null;
                const id = first?.id?.toString();
                if (!id) return res.status(500).json({ error: 'Failed to add magnet' });
                // Gather status and files
                let filename = null;
                try {
                    const st2 = await fetch('https://api.alldebrid.com/v4.1/magnet/status', { method: 'POST', headers: { 'Authorization': `Bearer ${readSettings().adApiKey}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ id }) });
                    if (st2.ok) {
                        const j = await st2.json();
                        if (j?.status === 'success' && Array.isArray(j?.data?.magnets) && j.data.magnets[0]?.filename) filename = j.data.magnets[0].filename;
                    }
                } catch {}
                // Get files tree
                const filesData = await adFetch('/magnet/files', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams([['id[]', id]])
                });
                const record = Array.isArray(filesData?.magnets) ? filesData.magnets.find(m => String(m?.id) === String(id)) : null;
                const outFiles = [];
                let counter = 1;
                const walk = (nodes, base = '') => {
                    if (!Array.isArray(nodes)) return;
                    for (const n of nodes) {
                        if (n.e) {
                            walk(n.e, base ? `${base}/${n.n}` : n.n);
                        } else {
                            const full = base ? `${base}/${n.n}` : n.n;
                            outFiles.push({ id: counter++, path: full, filename: full, bytes: Number(n.s || 0), size: Number(n.s || 0), links: n.l ? [n.l] : [] });
                        }
                    }
                };
                if (record?.files) walk(record.files, '');
                const info = { id, filename: filename || (first?.name || 'Magnet'), files: outFiles };

                // Server-side logging for AllDebrid
                console.log(`--- FILES FOUND IN AD TORRENT: ${info.filename} ---`);
                info.files.forEach((file, i) => {
                    console.log(`  [File ${i+1}] ${file.filename || file.path} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
                });
                console.log(`--------------------------------------------------`);

                return res.json({ id, info });
            } else if (provider === 'torbox') {
                console.log('[TB][prepare] createtorrent');
                let createdId;
                try {
                    const out = await tbCreateTorrentFromMagnet(magnet);
                    createdId = out?.id;
                } catch (e) {
                    const code = e?.code || '';
                    const msg = e?.message || '';
                    if (code === 'TB_AUTH_INVALID') return res.status(401).json({ error: 'TorBox authentication invalid. Please login again.', code: 'DEBRID_UNAUTH' });
                    if (code === 'TB_NETWORK') return res.status(503).json({ error: 'TorBox is unreachable right now. Please try again later.', code: 'TB_UNAVAILABLE' });
                    if (code === 'TB_RATE_LIMIT') return res.status(429).json({ error: 'TorBox rate limit. Try again shortly.', code: 'TB_RATE_LIMIT' });
                    if (code === 'RD_PREMIUM_REQUIRED') return res.status(403).json({ error: 'TorBox premium is required to add torrents.', code: 'RD_PREMIUM_REQUIRED' });
                    if (/missing_required_option/i.test(msg)) return res.status(400).json({ error: 'TorBox rejected the magnet payload.', code: 'TB_BAD_PAYLOAD' });
                    throw e;
                }
                const id = createdId;
                if (!id) return res.status(500).json({ error: 'Failed to add magnet (TorBox)' });
                // Fetch files info; may need a short wait for metadata
                let infoObj = null;
for (let i = 0; i < 10; i++) {
    try {
        const details = await tbFetch(`/api/torrents/mylist?id=${encodeURIComponent(String(id))}&bypassCache=true`);
        console.log('[TB][mylist] response:', JSON.stringify(details, null, 2));

        // Normalize into our shape
        const tor = Array.isArray(details?.data) ? details.data[0] : (details?.data || details || null);

        if (tor) {
            const files = [];
            const rawFiles = tor.files || tor.file_list || [];
            const isCached = Boolean(tor.cached); // Use explicit cached flag
            const isStalled = Boolean(tor.stalled || tor.status === 'stalled');
            const hasFiles = rawFiles.length > 0;

            console.log('[TB][files] found', rawFiles.length, 'cached:', isCached, 'stalled:', isStalled);

            // If stalled with no files/progress and not cached, attempt to request download
            if (isStalled && !isCached && !hasFiles && i === 0) {
                console.log('[TB][prepare] Torrent is stalled/uncached, attempting to request download...');
                try {
                    await tbFetch('/api/torrents/controltorrent', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ torrent_id: String(tor.id || id), operation: 'reannounce' })
                    });
                    console.log('[TB][prepare] Requested reannounce, waiting for peers...');
                } catch (controlErr) {
                    console.warn('[TB][prepare] Failed to control torrent:', controlErr?.message);
                }
            }

            let counter = 0;
            for (const f of rawFiles) {
                const fid = f.id != null ? f.id : counter; // fallback to counter if id missing
                const fname = f.name || f.filename || f.path || `file_${fid}`;
                const fsize = Number(f.size || f.bytes || f.length || 0);

                console.log('[TB][file]', { originalId: f.id, fileId: f.file_id, mappedId: fid, name: fname });

                const vlink = `torbox://${id}/${fid}`;
                const links = isCached ? [vlink] : [];

                files.push({ id: fid, path: fname, filename: fname, bytes: fsize, size: fsize, links });
                counter++;
            }

            infoObj = { id: String(tor.id || id), filename: tor.name || tor.filename || 'TorBox Torrent', files };
        }

        if (infoObj && infoObj.files && infoObj.files.length) {
            // Server-side logging for TorBox
            console.log(`--- FILES FOUND IN TORBOX TORRENT: ${infoObj.filename} ---`);
            infoObj.files.forEach((file, i) => {
                console.log(`  [File ${i+1}] ${file.filename || file.path} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
            });
            console.log(`--------------------------------------------------`);
            break;
        }

    } catch {}

    await new Promise(r => setTimeout(r, 800));
}

                
                // If after polling we still have no files, check final state
                if (!infoObj || !infoObj.files || infoObj.files.length === 0) {
                    try {
                        const finalCheck = await tbFetch(`/api/torrents/mylist?id=${encodeURIComponent(String(id))}&bypassCache=true`);
                        const finalTor = Array.isArray(finalCheck?.data) ? finalCheck.data[0] : (finalCheck?.data || finalCheck || null);
                        if (finalTor) {
                            const finalState = (finalTor.download_state || finalTor.state || '').toString().toLowerCase();
                            const finalFiles = finalTor.files || finalTor.file_list || [];
                            const finalSeeds = Number(finalTor.seeds || 0);
                            const finalPeers = Number(finalTor.peers || 0);
                            
                            if (finalState.includes('stalled') && finalFiles.length === 0 && finalSeeds === 0 && finalPeers === 0) {
                                console.warn('[TB][prepare] Torrent is stalled with no seeds/peers after polling');
                                return res.status(503).json({ 
                                    error: 'This torrent has no seeders and cannot be cached by TorBox. Try a different release.', 
                                    code: 'TB_NO_SEEDS',
                                    id: String(id)
                                });
                            }
                        }
                    } catch {}
                    
                    if (!infoObj) infoObj = { id: String(id), filename: 'TorBox Torrent', files: [] };
                }
                
                return res.json({ id: String(id), info: infoObj });
            } else if (provider === 'premiumize') {
                console.log('[PM][prepare] transfer/directdl');
                let data;
                try {
                    // Use /transfer/directdl to get instant cached links or create transfer
                    data = await pmFetch('/transfer/directdl', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({ src: magnet })
                    });
                } catch (e) {
                    const msg = e?.message || '';
                    if (e?.code === 'PM_AUTH_INVALID' || /auth|unauthorized/i.test(msg)) {
                        const cur = readSettings();
                        writeSettings({ ...cur, pmApiKey: null });
                        return res.status(401).json({ error: 'Premiumize authentication invalid. Please login again.', code: 'DEBRID_UNAUTH' });
                    }
                    if (e?.code === 'PM_NETWORK') {
                        return res.status(503).json({ error: 'Premiumize is unreachable right now. Please try again later.', code: 'PM_UNAVAILABLE' });
                    }
                    if (e?.code === 'PM_PREMIUM_REQUIRED' || /premium/i.test(msg)) {
                        return res.status(403).json({ error: 'Premiumize premium is required to add torrents.', code: 'RD_PREMIUM_REQUIRED' });
                    }
                    throw e;
                }
                
                console.log('[PM][prepare] directdl response:', JSON.stringify(data, null, 2));
                
                // directdl returns: { status: 'success', content: [...files with links...] }
                // This is the instant cached scenario
                if (data?.status === 'success' && Array.isArray(data.content) && data.content.length > 0) {
                    const files = [];
                    for (let idx = 0; idx < data.content.length; idx++) {
                        const f = data.content[idx];
                        // Each file has: path, size, link, stream_link, transcode_status
                        const fname = f.path || f.name || `file_${idx}`;
                        const fsize = Number(f.size || 0);
                        // Prefer stream_link for videos, fallback to link
                        const flink = f.stream_link || f.link || '';
                        
                        files.push({
                            id: idx,
                            path: fname,
                            filename: fname,
                            bytes: fsize,
                            size: fsize,
                            links: flink ? [flink] : []
                        });
                    }
                    
                    const infoObj = {
                        id: 'directdl',
                        filename: data.filename || 'Premiumize Direct Download',
                        files
                    };
                    
                    console.log('[PM][prepare] directdl success, returning', files.length, 'files');

                    // Server-side logging for Premiumize (Direct DL)
                    console.log(`--- FILES FOUND IN PM DIRECT DOWNLOAD: ${infoObj.filename} ---`);
                    infoObj.files.forEach((file, i) => {
                        console.log(`  [File ${i+1}] ${file.filename || file.path} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
                    });
                    console.log(`--------------------------------------------------`);

                    return res.json({ id: 'directdl', info: infoObj });
                }
                
                // Not cached - create transfer and wait for it to finish
                console.log('[PM][prepare] not cached, creating transfer');
                let transferData;
                try {
                    transferData = await pmFetch('/transfer/create', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({ src: magnet })
                    });
                } catch (e) {
                    throw e;
                }
                
                const transferId = transferData?.id;
                if (!transferId) return res.status(500).json({ error: 'Failed to create Premiumize transfer' });
                
                console.log('[PM][prepare] transfer created:', transferId, 'waiting for completion...');
                
                // Poll transfer status until finished
                let infoObj = null;
                let folderId = null;
                
                for (let i = 0; i < 30; i++) {
                    try {
                        const listData = await pmFetch('/transfer/list');
                        if (listData?.status === 'success' && Array.isArray(listData.transfers)) {
                            const transfer = listData.transfers.find(t => String(t.id) === String(transferId));
                            
                            if (!transfer) {
                                console.log('[PM][prepare] transfer not found in list, waiting...');
                                await new Promise(r => setTimeout(r, 2000));
                                continue;
                            }
                            
                            console.log('[PM][prepare] transfer status:', transfer.status, 'progress:', transfer.progress);
                            
                            if (transfer.status === 'finished' && transfer.folder_id) {
                                folderId = transfer.folder_id;
                                console.log('[PM][prepare] transfer finished, folder_id:', folderId);
                                break;
                            }
                            
                            if (transfer.status === 'error' || transfer.status === 'banned') {
                                const errMsg = transfer.message || 'Transfer failed';
                                console.error('[PM][prepare] transfer failed:', errMsg);
                                return res.status(500).json({ error: 'Premiumize transfer failed: ' + errMsg });
                            }
                        }
                    } catch (e) {
                        console.log('[PM][prepare] error polling status:', e.message);
                    }
                    await new Promise(r => setTimeout(r, 2000));
                }
                
                if (!folderId) {
                    console.log('[PM][prepare] timeout waiting for transfer, returning empty');
                    return res.json({ 
                        id: String(transferId), 
                        info: { id: String(transferId), filename: 'Premiumize Transfer (pending)', files: [] }
                    });
                }
                
                // Fetch files from folder
                try {
                    console.log('[PM][prepare] fetching folder contents for folder_id:', folderId);
                    const folderData = await pmFetch(`/folder/list?id=${encodeURIComponent(folderId)}`);
                    
                    if (folderData?.status === 'success' && Array.isArray(folderData.content)) {
                        const files = [];
                        
                        for (let idx = 0; idx < folderData.content.length; idx++) {
                            const f = folderData.content[idx];
                            
                            // Skip folders, only process files
                            if (f.type === 'folder') continue;
                            
                            const fname = f.name || `file_${idx}`;
                            const fsize = Number(f.size || 0);
                            const flink = f.stream_link || f.link || '';
                            
                            files.push({
                                id: idx,
                                path: fname,
                                filename: fname,
                                bytes: fsize,
                                size: fsize,
                                links: flink ? [flink] : []
                            });
                        }
                        
                        infoObj = {
                            id: String(transferId),
                            filename: transferData.name || 'Premiumize Transfer',
                            files
                        };
                        
                        console.log('[PM][prepare] folder fetched successfully, returning', files.length, 'files');

                        // Server-side logging for Premiumize (Transfer)
                        console.log(`--- FILES FOUND IN PM TRANSFER: ${infoObj.filename} ---`);
                        infoObj.files.forEach((file, i) => {
                            console.log(`  [File ${i+1}] ${file.filename || file.path} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
                        });
                        console.log(`--------------------------------------------------`);
                    }
                } catch (e) {
                    console.error('[PM][prepare] error fetching folder:', e.message);
                }
                
                if (!infoObj) {
                    infoObj = { id: String(transferId), filename: 'Premiumize Transfer', files: [] };
                }
                
                return res.json({ id: String(transferId), info: infoObj });
            } else {
                return res.status(400).json({ error: 'Debrid provider not supported' });
            }
        } catch (e) {
            const msg = e?.message || '';
            console.error('[DEBRID][prepare] error', msg);
            
            // Handle authentication errors
            if (/401|bad_token|invalid_token/i.test(msg)) {
                return res.status(401).json({ error: 'Real-Debrid authentication expired. Please login again.', code: 'DEBRID_UNAUTH' });
            }
            
            // Map premium-required case to a clearer response
            if (/403\s+\{[^}]*permission_denied/i.test(msg)) {
                return res.status(403).json({
                    error: 'Real-Debrid premium is required to add torrents.',
                    code: 'RD_PREMIUM_REQUIRED'
                });
            }
            if (/MAGNET_MUST_BE_PREMIUM|MUST_BE_PREMIUM/i.test(msg)) {
                return res.status(403).json({ error: 'Debrid premium is required to add torrents.', code: 'RD_PREMIUM_REQUIRED' });
            }
            
            // Handle rate limiting
            if (/429|too_many_requests/i.test(msg)) {
                return res.status(429).json({ error: 'Real-Debrid rate limit. Please wait a moment.', code: 'RD_RATE_LIMIT' });
            }
            
            // Handle network errors
            if (e?.code === 'RD_NETWORK' || /econnrefused|enotfound|network|timeout/i.test(msg)) {
                return res.status(503).json({ error: 'Real‑Debrid is unreachable right now. Please try again later.', code: 'RD_UNAVAILABLE' });
            }
            
            res.status(502).json({ error: msg || 'Debrid prepare failed' });
        }
    });

    // Debrid select files by id list or 'all' (RD supports, AD no-op)
    app.post('/api/debrid/select-files', async (req, res) => {
        try {
            const s = readSettings();
            const provider = (s.debridProvider || 'realdebrid').toLowerCase();
            if (provider === 'alldebrid') {
                // No-op for AllDebrid
                return res.json({ success: true });
            }
            if (provider === 'torbox') {
                // No-op for TorBox (files unlocked per-file when requested)
                return res.json({ success: true });
            }
            if (provider === 'premiumize') {
                // No-op for Premiumize (files are already available)
                return res.json({ success: true });
            }
            const id = (req.body?.id || '').toString();
            const files = Array.isArray(req.body?.files) ? req.body.files.join(',') : (req.body?.files || 'all').toString();
            if (!id) return res.status(400).json({ error: 'Missing id' });
            
            console.log('[RD][select-files]', { id, files: files.split(',').slice(0,5) });
            
            try {
                // For season packs with single file selection: RD doesn't allow changing selected files
                // Solution: Delete old torrent and re-add with new file selection
                const fileIds = files.split(',').filter(f => f && f !== 'all');
                const isSingleFileSelection = fileIds.length === 1;
                
                if (isSingleFileSelection) {
                    // Get current torrent info
                    const currentInfo = await rdFetch(`/torrents/info/${id}`);
                    const currentlySelected = currentInfo?.files?.filter(f => f.selected === 1).map(f => f.id) || [];
                    const requestedFileId = parseInt(fileIds[0]);
                    
                    // If a different file is currently selected, delete and re-add torrent
                    if (currentlySelected.length > 0 && !currentlySelected.includes(requestedFileId)) {
                        console.log('[RD][select-files] Different file requested. Deleting torrent', id, 'and re-adding with file', requestedFileId);
                        
                        // Get magnet link from torrent info to re-add it
                        const magnetHash = currentInfo?.hash;
                        if (!magnetHash) {
                            console.error('[RD][select-files] Cannot re-add torrent: no hash found');
                            return res.status(500).json({ error: 'Cannot switch files: torrent hash not found' });
                        }
                        
                        // Delete the old torrent
                        try {
                            await rdFetch(`/torrents/delete/${id}`, { method: 'DELETE' });
                            console.log('[RD][select-files] Deleted old torrent:', id);
                        } catch (e) {
                            console.warn('[RD][select-files] Failed to delete torrent:', e?.message);
                        }
                        
                        // Re-add the torrent with magnet
                        const magnet = `magnet:?xt=urn:btih:${magnetHash}`;
                        console.log('[RD][select-files] Re-adding torrent with magnet:', magnet.substring(0, 50) + '...');
                        
                        const addRes = await rdFetch('/torrents/addMagnet', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                            body: new URLSearchParams({ magnet })
                        });
                        
                        const newId = addRes?.id;
                        if (!newId) {
                            console.error('[RD][select-files] Failed to re-add torrent');
                            return res.status(500).json({ error: 'Failed to re-add torrent' });
                        }
                        
                        console.log('[RD][select-files] Re-added torrent with new ID:', newId);
                        
                        // Now select the requested file on the NEW torrent
                        const selectRes = await rdFetch(`/torrents/selectFiles/${newId}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                            body: new URLSearchParams({ files: requestedFileId.toString() })
                        });
                        
                        console.log('[RD][select-files] File selection response:', selectRes);
                        
                        // Get updated info with new links
                        const newInfo = await rdFetch(`/torrents/info/${newId}`);
                        console.log('[RD][select-files] New torrent info:', {
                            id: newInfo?.id,
                            status: newInfo?.status,
                            torrentLinks: newInfo?.links,
                            selectedFiles: newInfo?.files?.filter(f => f.selected === 1).map(f => ({ 
                                id: f.id, 
                                path: f.path 
                            }))
                        });
                        
                        return res.json({ 
                            id: newId, 
                            info: newInfo, 
                            reAddedForFileSwitch: true,
                            oldId: id
                        });
                    }
                }
                
                // Normal file selection (first time or same file)
                const out = await rdFetch(`/torrents/selectFiles/${id}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ files })
                });
                
                console.log('[RD][select-files] Response:', out);
                
                // After selecting, immediately fetch torrent info to see if links are populated
                const info = await rdFetch(`/torrents/info/${id}`);
                console.log('[RD][select-files] Updated torrent info:', {
                    id: info?.id,
                    status: info?.status,
                    torrentLinks: info?.links,
                    selectedFiles: info?.files?.filter(f => f.selected === 1).map(f => ({ 
                        id: f.id, 
                        path: f.path, 
                        hasLinks: !!f.links,
                        links: f.links 
                    }))
                });
                
                res.json({ success: true, out, info });
            } catch (e) {
                // Handle specific RD errors
                if (e?.status === 429 || e?.code === 'RD_RATE_LIMIT') {
                    return res.status(429).json({ success: false, error: 'Real-Debrid rate limit. Please wait before retrying.', code: 'RD_RATE_LIMIT' });
                }
                if (e?.status === 403 || e?.code === 'RD_PREMIUM_REQUIRED' || e?.code === 'RD_FORBIDDEN') {
                    return res.status(403).json({ success: false, error: e?.message || 'Real-Debrid premium is required.', code: e?.code || 'RD_FORBIDDEN' });
                }
                if (e?.status === 502 || e?.code === 'RD_PARSE_ERROR') {
                    console.error('[RD][select-files] JSON parse error - response may be malformed');
                    return res.status(502).json({ success: false, error: 'Real-Debrid returned invalid response. Try again.', code: 'RD_PARSE_ERROR' });
                }
                if (e?.code === 'RD_NETWORK' || e?.code === 'RD_UNAVAILABLE') {
                    return res.status(503).json({ success: false, error: 'Real-Debrid is unreachable. Please try again later.', code: 'RD_UNAVAILABLE' });
                }
                
                // Generic error fallback
                throw e;
            }
        } catch (e) {
            const msg = e?.message || '';
            console.error('[RD][select-files] error', msg);
            
            // Handle authentication errors
            if (/401|bad_token|invalid_token/i.test(msg)) {
                return res.status(401).json({ success: false, error: 'Real-Debrid authentication expired. Please login again.', code: 'DEBRID_UNAUTH' });
            }
            
            // Handle permission errors
            if (/403\s+\{[^}]*permission_denied/i.test(msg)) {
                return res.status(403).json({ success: false, error: 'Real-Debrid premium is required to select files.', code: 'RD_PREMIUM_REQUIRED' });
            }
            
            // Handle rate limiting
            if (/429|too_many_requests/i.test(msg)) {
                return res.status(429).json({ success: false, error: 'Real-Debrid rate limit. Please wait a moment.', code: 'RD_RATE_LIMIT' });
            }
            
            // Handle network errors
            if (e?.code === 'RD_NETWORK' || /econnrefused|enotfound|network|timeout/i.test(msg)) {
                return res.status(503).json({ success: false, error: 'Real-Debrid is unreachable. Please try again later.', code: 'RD_UNAVAILABLE' });
            }
            
            res.status(502).json({ success: false, error: msg || 'Debrid select files failed' });
        }
    });

    // Cleanup/delete debrid torrent (for when user closes file selector or switches files)
    app.post('/api/debrid/cleanup', async (req, res) => {
        try {
            const s = readSettings();
            const provider = (s.debridProvider || 'realdebrid').toLowerCase();
            const id = (req.body?.id || '').toString();
            
            if (!id) return res.json({ success: true, message: 'No ID provided, nothing to cleanup' });
            
            if (provider === 'realdebrid') {
                console.log('[RD][cleanup] Deleting torrent:', id);
                try {
                    await rdFetch(`/torrents/delete/${id}`, { method: 'DELETE' });
                    console.log('[RD][cleanup] Successfully deleted torrent:', id);
                    return res.json({ success: true, deleted: true, id });
                } catch (e) {
                    // Torrent might already be deleted, that's okay
                    console.warn('[RD][cleanup] Failed to delete torrent (might already be deleted):', e?.message);
                    return res.json({ success: true, deleted: false, message: 'Torrent already deleted or not found' });
                }
            } else if (provider === 'alldebrid') {
                console.log('[AD][cleanup] Deleting magnet:', id);
                try {
                    await adFetch(`/magnet/delete?id=${id}`, { method: 'GET' });
                    console.log('[AD][cleanup] Successfully deleted magnet:', id);
                    return res.json({ success: true, deleted: true, id });
                } catch (e) {
                    console.warn('[AD][cleanup] Failed to delete magnet:', e?.message);
                    return res.json({ success: true, deleted: false, message: 'Magnet already deleted or not found' });
                }
            } else {
                // Other providers - no-op
                return res.json({ success: true, message: 'Cleanup not needed for ' + provider });
            }
        } catch (e) {
            console.error('[Debrid][cleanup] error', e?.message);
            res.status(500).json({ success: false, error: e?.message || 'Cleanup failed' });
        }
    });

    // List Debrid torrent info/files
    app.get('/api/debrid/files', async (req, res) => {
        try {
            const s = readSettings();
            const provider = (s.debridProvider || 'realdebrid').toLowerCase();
            const id = (req.query?.id || '').toString();
            if (!id) return res.status(400).json({ error: 'Missing id' });
            if (provider === 'realdebrid') {
                console.log('[RD][files]', { id });
                let info = await rdFetch(`/torrents/info/${id}`);
                
                // DEBUG: Log the raw response structure
                console.log('[RD][files] Raw response structure:', {
                    id: info?.id,
                    status: info?.status,
                    filesCount: info?.files?.length,
                    hasTorrentLevelLinks: !!info?.links,
                    torrentLinksCount: Array.isArray(info?.links) ? info.links.length : 0,
                    firstFile: info?.files?.[0] ? {
                        id: info.files[0].id,
                        selected: info.files[0].selected,
                        hasLinks: !!info.files[0].links,
                        linksType: typeof info.files[0].links,
                        linksLength: Array.isArray(info.files[0].links) ? info.files[0].links.length : 0
                    } : null
                });
                
                // No instant availability augmentation
                
                // CRITICAL: RD API doesn't always populate 'links' in /torrents/info response
                // For downloaded torrents with selected files, we need to construct the download link manually
                // Format: https://real-debrid.com/d/[download_id] (needs unrestricting)
                if (info && Array.isArray(info.files)) {
                    // For multi-file torrents (season packs): RD populates info.links with download links
                    // but ONLY for currently selected files, and the array indexing doesn't match file IDs
                    // We need to distribute available links to selected files
                    const selectedFiles = info.files.filter(f => f.selected === 1);
                    const availableLinks = Array.isArray(info.links) ? info.links.filter(l => l) : [];
                    
                    for (const f of info.files) {
                        // Normalize links to array format first
                        if (typeof f.links === 'string') {
                            f.links = [f.links];
                        } else if (!f.links) {
                            f.links = [];
                        }
                        
                        // If file is selected but has no links, try to get from torrent-level links array
                        if (f.selected === 1 && f.links.length === 0) {
                            // Try direct indexing first (works for single-file torrents)
                            if (availableLinks[f.id - 1]) {
                                f.links = [availableLinks[f.id - 1]];
                            }
                            // For season packs: if only 1 link available and 1 file selected, use it
                            else if (selectedFiles.length === 1 && availableLinks.length === 1) {
                                f.links = [availableLinks[0]];
                            }
                            // For season packs with multiple selected files: match by position
                            else if (selectedFiles.length > 0 && availableLinks.length > 0) {
                                const selectedIndex = selectedFiles.indexOf(f);
                                if (selectedIndex >= 0 && availableLinks[selectedIndex]) {
                                    f.links = [availableLinks[selectedIndex]];
                                }
                            }
                        }
                    }
                }
                
                console.log('[RD][files] Response:', { 
                    id, 
                    status: info?.status, 
                    filesCount: info?.files?.length,
                    selectedFiles: info?.files?.filter(f => f.selected === 1).length,
                    filesWithLinks: info?.files?.filter(f => Array.isArray(f.links) && f.links.length > 0).length,
                    torrentLevelLinks: Array.isArray(info?.links) ? info.links.length : 0,
                    sampleFiles: info?.files?.slice(0, 3).map(f => ({
                        id: f.id,
                        selected: f.selected,
                        path: f.path?.split('/').pop(),
                        links: f.links
                    }))
                });
                
                return res.json(info);
            }
            if (provider === 'alldebrid') {
                console.log('[AD][files]', { id });
                let filesData;
                try {
                    filesData = await adFetch('/magnet/files', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams([['id[]', id]]) });
                } catch (e) {
                    const msg = e?.message || '';
                    if (e?.code === 'AD_AUTH_INVALID' || /AUTH_BAD_APIKEY|Not authenticated with AllDebrid/i.test(msg)) {
                        const cur = readSettings();
                        writeSettings({ ...cur, adApiKey: null });
                        return res.status(401).json({ error: 'AllDebrid authentication invalid. Please login again.', code: 'DEBRID_UNAUTH' });
                    }
                    if (e?.code === 'AD_NETWORK') {
                        return res.status(503).json({ error: 'AllDebrid is unreachable right now. Please try again later.', code: 'AD_UNAVAILABLE' });
                    }
                    if (e?.code === 'AD_AUTH_BLOCKED' || /AUTH_BLOCKED/i.test(msg)) {
                        return res.status(403).json({ error: 'AllDebrid security check: verify the authorization email, then retry.', code: 'AD_AUTH_BLOCKED' });
                    }
                    throw e;
                }
                const record = Array.isArray(filesData?.magnets) ? filesData.magnets.find(m => String(m?.id) === String(id)) : null;
                const outFiles = [];
                let counter = 1;
                const walk = (nodes, base = '') => {
                    if (!Array.isArray(nodes)) return;
                    for (const n of nodes) {
                        if (n.e) walk(n.e, base ? `${base}/${n.n}` : n.n);
                        else outFiles.push({ id: counter++, path: base ? `${base}/${n.n}` : n.n, filename: n.n, bytes: Number(n.s || 0), size: Number(n.s || 0), links: n.l ? [n.l] : [] });
                    }
                };
                if (record?.files) walk(record.files, '');
                // Try to fetch filename via status (best-effort)
                let filename = null;
                try {
                    const r = await fetch('https://api.alldebrid.com/v4.1/magnet/status', { method: 'POST', headers: { 'Authorization': `Bearer ${readSettings().adApiKey}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ id }) });
                    if (r.ok) {
                        const j = await r.json();
                        if (j?.status === 'success' && Array.isArray(j?.data?.magnets) && j.data.magnets[0]?.filename) filename = j.data.magnets[0].filename;
                    }
                } catch {}
                return res.json({ id, filename: filename || null, files: outFiles });
            }
            if (provider === 'torbox') {
                console.log('[TB][files]', { id });
                try {
                    const details = await tbFetch(`/api/torrents/mylist?id=${encodeURIComponent(String(id))}&bypassCache=true`);
                    const tor = Array.isArray(details?.data) ? details.data[0] : (details?.data || details || null);
                    const outFiles = [];
                    if (tor) {
                        const rawFiles = tor.files || tor.file_list || [];
                        const stateRaw = (tor.download_state || tor.downloadState || tor.state || tor.status || '').toString().toLowerCase();
                        const isCached = stateRaw.includes('cached');
                        const isStalled = stateRaw.includes('stalled');
                        const progress = Number(tor.progress || 0);
                        const seeds = Number(tor.seeds || 0);
                        const peers = Number(tor.peers || 0);
                        
                        // If stalled with no progress and no peers, it can't be cached
                        if (isStalled && !isCached && progress === 0 && seeds === 0 && peers === 0 && rawFiles.length === 0) {
                            console.warn('[TB][files] Torrent is permanently stalled (no seeds)');
                            return res.status(503).json({ 
                                error: 'This torrent has no seeders and cannot be cached. Try a different release.',
                                code: 'TB_NO_SEEDS',
                                id: String(id),
                                filename: tor?.name || tor?.filename || null,
                                files: [],
                                status: stateRaw,
                                progress: 0
                            });
                        }
                        
                        let counter = 1;
                        for (const f of rawFiles) {
                            const fid = f.id || f.file_id || counter;
                            const fname = f.name || f.filename || f.path || `file_${fid}`;
                            const fsize = Number(f.size || f.bytes || f.length || 0);
                            const vlink = `torbox://${id}/${fid}`;
                            const links = isCached ? [vlink] : [];
                            outFiles.push({ id: fid, path: fname, filename: fname, bytes: fsize, size: fsize, links });
                            counter++;
                        }
                    }
                    return res.json({ id: String(id), filename: tor?.name || tor?.filename || null, files: outFiles });
                } catch (e) {
                    const code = e?.code || '';
                    if (code === 'TB_AUTH_INVALID') return res.status(401).json({ error: 'TorBox authentication invalid. Please login again.', code: 'DEBRID_UNAUTH' });
                    if (code === 'TB_NETWORK') return res.status(503).json({ error: 'TorBox is unreachable right now. Please try again later.', code: 'TB_UNAVAILABLE' });
                    if (code === 'TB_RATE_LIMIT') return res.status(429).json({ error: 'TorBox rate limit. Try again shortly.', code: 'TB_RATE_LIMIT' });
                    throw e;
                }
            }
            if (provider === 'premiumize') {
                console.log('[PM][files]', { id });
                
                // Special case: if id is 'directdl', files were already provided in prepare response
                if (id === 'directdl') {
                    return res.status(400).json({ error: 'Use files from prepare response for directdl' });
                }
                
                try {
                    const listData = await pmFetch('/transfer/list');
                    if (listData && listData.status === 'success' && Array.isArray(listData.transfers)) {
                        const transfer = listData.transfers.find(t => String(t.id) === String(id));
                        if (!transfer) {
                            return res.status(404).json({ error: 'Transfer not found' });
                        }
                        
                        const outFiles = [];
                        const fileList = Array.isArray(transfer.file_list) ? transfer.file_list : [];
                        
                        for (let idx = 0; idx < fileList.length; idx++) {
                            const f = fileList[idx];
                            const fname = f.path || f.name || `file_${idx}`;
                            const fsize = Number(f.size || 0);
                            const flink = f.stream_link || f.link || '';
                            
                            outFiles.push({
                                id: idx,
                                path: fname,
                                filename: fname,
                                bytes: fsize,
                                size: fsize,
                                links: flink ? [flink] : []
                            });
                        }
                        
                        return res.json({
                            id: String(id),
                            filename: transfer.name || 'Premiumize Transfer',
                            files: outFiles
                        });
                    }
                    return res.status(404).json({ error: 'Transfer not found' });
                } catch (e) {
                    const code = e?.code || '';
                    if (code === 'PM_AUTH_INVALID') return res.status(401).json({ error: 'Premiumize authentication invalid. Please login again.', code: 'DEBRID_UNAUTH' });
                    if (code === 'PM_NETWORK') return res.status(503).json({ error: 'Premiumize is unreachable right now. Please try again later.', code: 'PM_UNAVAILABLE' });
                    if (code === 'PM_RATE_LIMIT') return res.status(429).json({ error: 'Premiumize rate limit. Try again shortly.', code: 'PM_RATE_LIMIT' });
                    throw e;
                }
            }
            return res.status(400).json({ error: 'Debrid provider not supported' });
        } catch (e) {
            const msg = e?.message || '';
            console.error('[RD][files] error', msg);
            if (/403\s+\{[^}]*permission_denied/i.test(msg)) {
                return res.status(403).json({ error: 'Real-Debrid premium is required to view torrent info.', code: 'RD_PREMIUM_REQUIRED' });
            }
            if (e?.code === 'RD_NETWORK' || /econnrefused|enotfound|network|timeout/i.test(msg)) {
                return res.status(503).json({ error: 'Real‑Debrid is unreachable right now. Please try again later.', code: 'RD_UNAVAILABLE' });
            }
            res.status(502).json({ error: msg || 'Debrid files failed' });
        }
    });

    // Unrestrict a Debrid link into direct CDN URL
    app.post('/api/debrid/link', async (req, res) => {
        try {
            const s = readSettings();
            const provider = (s.debridProvider || 'realdebrid').toLowerCase();
            const link = (req.body?.link || '').toString();
            if (!link) return res.status(400).json({ error: 'Missing link' });
            if (provider === 'realdebrid') {
                // ALWAYS unrestrict RD links to get the actual direct download URL
                // Links from /torrents/info are download page URLs (e.g., /d/...), not direct CDN links
                console.log('[RD][unrestrict] link:', link);
                
                try {
                    const out = await rdFetch('/unrestrict/link', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({ link })
                    });
                    
                    if (!out?.download) {
                        console.error('[RD][unrestrict] No download URL in response:', out);
                        return res.status(502).json({ error: 'RD unrestrict returned no download URL' });
                    }
                    
                    console.log('[RD][unrestrict] success, CDN URL:', out.download);
                    return res.json({ url: out.download, raw: out });
                } catch (e) {
                    console.error('[RD][unrestrict] failed:', e?.message);
                    return res.status(502).json({ error: 'Failed to unrestrict RD link: ' + (e?.message || 'unknown error') });
                }
            }
            if (provider === 'alldebrid') {
                // AD magnet/file links need to be unlocked through /link/unlock API
                console.log('[AD][unlock] link:', link);
                console.log('[AD][unlock] start');
                let data;
                try {
                    data = await adFetch('/link/unlock', {
                        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ link })
                    });
                } catch (e) {
                    const msg = e?.message || '';
                    if (e?.code === 'AD_AUTH_INVALID' || /AUTH_BAD_APIKEY|Not authenticated with AllDebrid/i.test(msg)) {
                        const cur = readSettings();
                        writeSettings({ ...cur, adApiKey: null });
                        return res.status(401).json({ error: 'AllDebrid authentication invalid. Please login again.', code: 'DEBRID_UNAUTH' });
                    }
                    if (e?.code === 'AD_NETWORK') {
                        return res.status(503).json({ error: 'AllDebrid is unreachable right now. Please try again later.', code: 'AD_UNAVAILABLE' });
                    }
                    if (e?.code === 'AD_AUTH_BLOCKED' || /AUTH_BLOCKED/i.test(msg)) {
                        return res.status(403).json({ error: 'AllDebrid security check: verify the authorization email, then retry.', code: 'AD_AUTH_BLOCKED' });
                    }
                    if (e?.code === 'MUST_BE_PREMIUM' || /MUST_BE_PREMIUM/i.test(msg)) {
                        return res.status(403).json({ error: 'AllDebrid premium is required for this link.', code: 'RD_PREMIUM_REQUIRED' });
                    }
                    throw e;
                }
                let direct = data?.link || '';
                // Handle delayed links
                if (!direct && data?.delayed) {
                    const delayedId = data.delayed;
                    for (let i = 0; i < 15; i++) {
                        try {
                            const dd = await adFetch('/link/delayed', {
                                method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ id: String(delayedId) })
                            });
                            if (dd?.status === 2 && dd?.link) { direct = dd.link; break; }
                            await new Promise(r => setTimeout(r, 1000));
                        } catch { await new Promise(r => setTimeout(r, 1000)); }
                    }
                }
                if (!direct) return res.status(502).json({ error: 'Failed to unlock link' });
                return res.json({ url: direct, raw: data });
            }
            if (provider === 'torbox') {
                // Expect a virtual torbox link: torbox://{torrentId}/{fileId}
                try {
                    const m = /^torbox:\/\/([^\/]+)\/(.+)$/i.exec(link || '');
                    if (!m) return res.status(400).json({ error: 'Invalid TorBox link' });
                    const torrentId = m[1];
                    const fileId = m[2];
                    
                    // Use official TorBox API: GET /torrents/requestdl with redirect=true
                    // This returns a permanent streaming URL per official documentation
                    console.log('[TB][link] requesting stream link for torrent:', torrentId, 'file:', fileId);
                    
                    try {
                        const direct = await tbRequestDirectLink(torrentId, fileId);
                        if (direct && /^https?:\/\//i.test(direct)) {
                            console.log('[TB][link] success, returning CDN URL');
                            return res.json({ url: direct });
                        }
                        
                        console.error('[TB][link] no valid URL returned');
                        return res.status(502).json({ error: 'TorBox returned no valid stream URL' });
                    } catch (e) {
                        const msg = e?.message || '';
                        console.error('[TB][link] error:', msg);
                        
                        if (/authentication invalid|401/i.test(msg)) {
                            return res.status(401).json({ error: 'TorBox authentication invalid. Please login again.', code: 'DEBRID_UNAUTH' });
                        }
                        if (/not found|404/i.test(msg)) {
                            return res.status(404).json({ error: 'TorBox torrent or file not found. The file may have been removed.', code: 'TB_NOT_FOUND' });
                        }
                        if (/rate limit|429/i.test(msg)) {
                            return res.status(429).json({ error: 'TorBox rate limit exceeded. Please wait and try again.', code: 'TB_RATE_LIMIT' });
                        }
                        if (e?.code === 'TB_NETWORK' || /network|unreachable|econnrefused/i.test(msg)) {
                            return res.status(503).json({ error: 'TorBox is unreachable right now. Please try again later.', code: 'TB_UNAVAILABLE' });
                        }
                        
                        return res.status(502).json({ error: 'Failed to get TorBox stream link: ' + msg });
                    }
                } catch (e) {
                    const msg = e?.message || '';
                    console.error('[TB][link] outer error:', msg);
                    return res.status(502).json({ error: 'TorBox link request failed: ' + msg });
                }
            }
            if (provider === 'premiumize') {
                
                // The link should already be a direct HTTPS URL ready for streaming
                if (/^https?:\/\//i.test(link)) {
                    console.log('[PM][link] using direct link:', link);
                    return res.json({ url: link });
                }
                
                // If not HTTP, something went wrong - Premiumize always returns HTTP URLs
                console.error('[PM][link] unexpected non-HTTP link:', link);
                return res.status(400).json({ error: 'Invalid Premiumize link format' });
            }
            return res.status(400).json({ error: 'Debrid provider not supported' });
        } catch (e) {
            console.error('[RD][unrestrict] error', e?.message);
            if (e?.code === 'RD_NETWORK' || /econnrefused|enotfound|network|timeout/i.test(e?.message || '')) {
                return res.status(503).json({ error: 'Real‑Debrid is unreachable right now. Please try again later.', code: 'RD_UNAVAILABLE' });
            }
            res.status(502).json({ error: e?.message || 'Debrid unrestrict failed' });
        }
    });

    // Delete a Debrid torrent by id (optional cleanup)
    app.delete('/api/debrid/torrent', async (req, res) => {
        try {
            const s = readSettings();
            const provider = (s.debridProvider || 'realdebrid').toLowerCase();
            const id = (req.query?.id || req.body?.id || '').toString();
            if (!id) return res.status(400).json({ error: 'Missing id' });
            if (provider === 'realdebrid') {
                console.log('[RD][delete]', { id });
                await rdFetch(`/torrents/delete/${id}`, { method: 'DELETE' });
                return res.json({ success: true });
            }
            if (provider === 'alldebrid') {
                console.log('[AD][delete]', { id });
                try {
                    await adFetch('/magnet/delete', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ id }) });
                } catch (e) {
                    const msg = e?.message || '';
                    if (e?.code === 'AD_AUTH_INVALID' || /AUTH_BAD_APIKEY|Not authenticated with AllDebrid/i.test(msg)) {
                        const cur = readSettings();
                        writeSettings({ ...cur, adApiKey: null });
                        return res.status(401).json({ success: false, error: 'AllDebrid authentication invalid. Please login again.', code: 'DEBRID_UNAUTH' });
                    }
                    if (e?.code === 'AD_NETWORK') {
                        return res.status(503).json({ success: false, error: 'AllDebrid is unreachable right now. Please try again later.', code: 'AD_UNAVAILABLE' });
                    }
                    if (e?.code === 'AD_AUTH_BLOCKED' || /AUTH_BLOCKED/i.test(msg)) {
                        return res.status(403).json({ success: false, error: 'AllDebrid security check: verify the authorization email, then retry.', code: 'AD_AUTH_BLOCKED' });
                    }
                    throw e;
                }
                return res.json({ success: true });
            }
            if (provider === 'torbox') {
                console.log('[TB][delete]', { id });
                try {
                    await tbFetch('/api/torrents/controltorrent', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ torrent_id: String(id), operation: 'delete' })
                    });
                    return res.json({ success: true });
                } catch (e) {
                    const code = e?.code || '';
                    if (code === 'TB_AUTH_INVALID') return res.status(401).json({ success: false, error: 'TorBox authentication invalid. Please login again.', code: 'DEBRID_UNAUTH' });
                    if (code === 'TB_NETWORK') return res.status(503).json({ success: false, error: 'TorBox is unreachable right now. Please try again later.', code: 'TB_UNAVAILABLE' });
                    throw e;
                }
            }
            if (provider === 'premiumize') {
                console.log('[PM][delete]', { id });
                
                // Special case: directdl doesn't create a transfer, so nothing to delete
                if (id === 'directdl') {
                    return res.json({ success: true });
                }
                
                try {
                    await pmFetch('/transfer/delete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({ id: String(id) })
                    });
                    return res.json({ success: true });
                } catch (e) {
                    const code = e?.code || '';
                    if (code === 'PM_AUTH_INVALID') return res.status(401).json({ success: false, error: 'Premiumize authentication invalid. Please login again.', code: 'DEBRID_UNAUTH' });
                    if (code === 'PM_NETWORK') return res.status(503).json({ success: false, error: 'Premiumize is unreachable right now. Please try again later.', code: 'PM_UNAVAILABLE' });
                    throw e;
                }
            }
            return res.status(400).json({ success: false, error: 'Debrid provider not supported' });
        } catch (e) {
            console.error('[RD][delete] error', e?.message);
            res.status(502).json({ success: false, error: e?.message || 'Failed to delete RD torrent' });
        }
    });

    // ===== TRAKT API ENDPOINTS =====

    // Trakt device authentication - step 1: get device code
    app.post('/api/trakt/device/code', async (req, res) => {
        try {
            const response = await traktFetch('/oauth/device/code', {
                method: 'POST',
                body: JSON.stringify({
                    client_id: TRAKT_CONFIG.CLIENT_ID
                })
            });

            // Store device code for verification
            saveTraktToken({ device_code: response.device_code });

            res.json({
                success: true,
                device_code: response.device_code,
                user_code: response.user_code,
                verification_url: response.verification_url,
                expires_in: response.expires_in,
                interval: response.interval
            });
        } catch (error) {
            console.error('[TRAKT] Device code error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Legacy endpoint for backwards compatibility
    app.get('/api/trakt/device-code', async (req, res) => {
        try {
            const response = await traktFetch('/oauth/device/code', {
                method: 'POST',
                body: JSON.stringify({
                    client_id: TRAKT_CONFIG.CLIENT_ID
                })
            });

            res.json({
                success: true,
                device_code: response.device_code,
                user_code: response.user_code,
                verification_url: response.verification_url,
                expires_in: response.expires_in,
                interval: response.interval
            });
        } catch (error) {
            console.error('[TRAKT] Device code error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Trakt device authentication - step 2: verify device code
    app.post('/api/trakt/device/verify', async (req, res) => {
        try {
            const traktToken = readTraktToken();
            if (!traktToken || !traktToken.device_code) {
                return res.json({ success: false, error: 'No device code found' });
            }

            const response = await traktFetch('/oauth/device/token', {
                method: 'POST',
                body: JSON.stringify({
                    code: traktToken.device_code,
                    client_id: TRAKT_CONFIG.CLIENT_ID,
                    client_secret: TRAKT_CONFIG.CLIENT_SECRET
                })
            });

            if (response.access_token) {
                saveTraktToken({
                    access_token: response.access_token,
                    refresh_token: response.refresh_token,
                    expires_in: response.expires_in,
                    created_at: response.created_at
                });
                res.json({ success: true });
            } else {
                res.json({ success: false, error: 'pending' });
            }
        } catch (error) {
            const msg = String(error?.message || '');
            // Map common device flow errors explicitly for the renderer
            if (msg.includes('authorization_pending') || msg.includes(' 400 ')) {
                return res.json({ success: false, error: 'pending' });
            }
            if (msg.includes('slow_down') || msg.includes(' 429 ')) {
                return res.status(429).json({ success: false, error: 'slow_down' });
            }
            if (msg.includes('expired_token') || msg.includes(' 410 ')) {
                return res.status(410).json({ success: false, error: 'expired' });
            }
            if (msg.includes('access_denied') || msg.includes(' 418 ')) {
                return res.status(418).json({ success: false, error: 'denied' });
            }
            if (msg.includes('invalid_grant') || msg.includes(' 409 ') || msg.includes(' 404 ')) {
                return res.status(409).json({ success: false, error: 'invalid' });
            }
            console.error('[TRAKT] Device verify error:', error);
            res.status(500).json({ success: false, error: 'verify_failed' });
        }
    });

    // Trakt device authentication - step 2: poll for token
    app.post('/api/trakt/device-token', async (req, res) => {
        try {
            const { device_code } = req.body;
            
            const response = await traktFetch('/oauth/device/token', {
                method: 'POST',
                body: JSON.stringify({
                    code: device_code,
                    client_id: TRAKT_CONFIG.CLIENT_ID,
                    client_secret: TRAKT_CONFIG.CLIENT_SECRET
                })
            });

            // Save the token
            if (saveTraktToken(response)) {
                res.json({ success: true, token: response });
            } else {
                res.status(500).json({ success: false, error: 'Failed to save token' });
            }
        } catch (error) {
            console.error('[TRAKT] Token exchange error:', error);
            // Handle specific Trakt errors
            if (error.message.includes('400')) {
                res.status(400).json({ success: false, error: 'Pending - user hasn\'t authorized yet' });
            } else if (error.message.includes('404')) {
                res.status(404).json({ success: false, error: 'Not found - invalid device code' });
            } else if (error.message.includes('409')) {
                res.status(409).json({ success: false, error: 'Already used - device code already approved' });
            } else if (error.message.includes('410')) {
                res.status(410).json({ success: false, error: 'Expired - device code expired' });
            } else if (error.message.includes('418')) {
                res.status(418).json({ success: false, error: 'Denied - user denied authorization' });
            } else if (error.message.includes('429')) {
                res.status(429).json({ success: false, error: 'Slow down - polling too quickly' });
            } else {
                res.status(500).json({ success: false, error: error.message });
            }
        }
    });

    // Get Trakt authentication status
    app.get('/api/trakt/status', async (req, res) => {
        try {
            const token = readTraktToken();
            if (!token) {
                return res.json({ authenticated: false });
            }

            // Test the token by getting user info
            const userInfo = await traktFetch('/users/me');
            res.json({ 
                authenticated: true, 
                user: userInfo,
                token_expires: token.expires_at 
            });
        } catch (error) {
            console.error('[TRAKT] Status check error:', error);
            // Token might be invalid, delete it
            deleteTraktToken();
            res.json({ authenticated: false, error: error.message });
        }
    });

    // Logout from Trakt
    app.post('/api/trakt/logout', (req, res) => {
        try {
            deleteTraktToken();
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Refresh Trakt token
    app.post('/api/trakt/refresh', async (req, res) => {
        try {
            const currentToken = readTraktToken();
            if (!currentToken || !currentToken.refresh_token) {
                return res.status(400).json({ success: false, error: 'No refresh token available' });
            }

            const response = await traktFetch('/oauth/token', {
                method: 'POST',
                body: JSON.stringify({
                    refresh_token: currentToken.refresh_token,
                    client_id: TRAKT_CONFIG.CLIENT_ID,
                    client_secret: TRAKT_CONFIG.CLIENT_SECRET,
                    redirect_uri: TRAKT_CONFIG.REDIRECT_URI,
                    grant_type: 'refresh_token'
                })
            });

            if (saveTraktToken(response)) {
                res.json({ success: true, token: response });
            } else {
                res.status(500).json({ success: false, error: 'Failed to save refreshed token' });
            }
        } catch (error) {
            console.error('[TRAKT] Token refresh error:', error);
            deleteTraktToken(); // Delete invalid token
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Scrobble start watching
    app.post('/api/trakt/scrobble/start', async (req, res) => {
        try {
            const { title, type, year, season, episode, progress = 0 } = req.body;
            
            let scrobbleData = {
                progress: Math.min(Math.max(progress, 0), 100)
            };

            if (type === 'movie') {
                scrobbleData.movie = {
                    title: title,
                    year: year
                };
            } else if (type === 'show') {
                scrobbleData.show = {
                    title: title,
                    year: year
                };
                scrobbleData.episode = {
                    season: season,
                    number: episode
                };
            }

            const response = await traktFetch('/scrobble/start', {
                method: 'POST',
                body: JSON.stringify(scrobbleData)
            });

            res.json({ success: true, data: response });
        } catch (error) {
            console.error('[TRAKT] Scrobble start error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Scrobble pause
    app.post('/api/trakt/scrobble/pause', async (req, res) => {
        try {
            const { title, type, year, season, episode, progress } = req.body;
            
            let scrobbleData = {
                progress: Math.min(Math.max(progress, 0), 100)
            };

            if (type === 'movie') {
                scrobbleData.movie = {
                    title: title,
                    year: year
                };
            } else if (type === 'show') {
                scrobbleData.show = {
                    title: title,
                    year: year
                };
                scrobbleData.episode = {
                    season: season,
                    number: episode
                };
            }

            const response = await traktFetch('/scrobble/pause', {
                method: 'POST',
                body: JSON.stringify(scrobbleData)
            });

            res.json({ success: true, data: response });
        } catch (error) {
            console.error('[TRAKT] Scrobble pause error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Scrobble stop/finish watching
    app.post('/api/trakt/scrobble/stop', async (req, res) => {
        try {
            const { title, type, year, season, episode, progress } = req.body;
            
            let scrobbleData = {
                progress: Math.min(Math.max(progress, 0), 100)
            };

            if (type === 'movie') {
                scrobbleData.movie = {
                    title: title,
                    year: year
                };
            } else if (type === 'show') {
                scrobbleData.show = {
                    title: title,
                    year: year
                };
                scrobbleData.episode = {
                    season: season,
                    number: episode
                };
            }

            const response = await traktFetch('/scrobble/stop', {
                method: 'POST',
                body: JSON.stringify(scrobbleData)
            });

            res.json({ success: true, data: response });
        } catch (error) {
            console.error('[TRAKT] Scrobble stop error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get user's watchlist
    app.get('/api/trakt/watchlist', async (req, res) => {
        try {
            const type = req.query.type || 'mixed'; // movies, shows, mixed
            const page = req.query.page || 1;
            const limit = req.query.limit || 100;
            const response = await traktFetch(`/users/me/watchlist/${type}?page=${page}&limit=${limit}`);
            res.json({ success: true, watchlist: response });
        } catch (error) {
            console.error('[TRAKT] Watchlist error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Add to watchlist
    app.post('/api/trakt/watchlist/add', async (req, res) => {
        try {
            const { title, type, year, season } = req.body;
            
            let requestData = {};
            if (type === 'movie') {
                requestData.movies = [{
                    title: title,
                    year: year
                }];
            } else if (type === 'show') {
                requestData.shows = [{
                    title: title,
                    year: year
                }];
            }

            const response = await traktFetch('/sync/watchlist', {
                method: 'POST',
                body: JSON.stringify(requestData)
            });

            res.json({ success: true, data: response });
        } catch (error) {
            console.error('[TRAKT] Add to watchlist error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Remove from watchlist
    app.post('/api/trakt/watchlist/remove', async (req, res) => {
        try {
            const { title, type, year } = req.body;
            
            let requestData = {};
            if (type === 'movie') {
                requestData.movies = [{
                    title: title,
                    year: year
                }];
            } else if (type === 'show') {
                requestData.shows = [{
                    title: title,
                    year: year
                }];
            }

            const response = await traktFetch('/sync/watchlist/remove', {
                method: 'POST',
                body: JSON.stringify(requestData)
            });

            res.json({ success: true, data: response });
        } catch (error) {
            console.error('[TRAKT] Remove from watchlist error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get viewing history
    app.get('/api/trakt/history', async (req, res) => {
        try {
            const type = req.query.type || 'mixed'; // movies, shows, mixed
            const page = req.query.page || 1;
            const limit = req.query.limit || 10;
            
            const response = await traktFetch(`/users/me/history/${type}?page=${page}&limit=${limit}`);
            res.json({ success: true, history: response });
        } catch (error) {
            console.error('[TRAKT] History error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get user stats
    app.get('/api/trakt/stats', async (req, res) => {
        try {
            const response = await traktFetch('/users/me/stats');
            res.json({ success: true, stats: response });
        } catch (error) {
            console.error('[TRAKT] Stats error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Search for content on Trakt
    app.get('/api/trakt/search', async (req, res) => {
        try {
            const { query, type = 'movie,show' } = req.query;
            if (!query) {
                return res.status(400).json({ success: false, error: 'Query parameter required' });
            }

            const response = await traktFetch(`/search/${type}?query=${encodeURIComponent(query)}`);
            res.json({ success: true, results: response });
        } catch (error) {
            console.error('[TRAKT] Search error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get comprehensive user stats including watchlist, collection, etc.
    app.get('/api/trakt/user/stats', async (req, res) => {
        try {
            const [stats, watchlist, collection, ratings] = await Promise.all([
                traktFetch('/users/me/stats'),
                traktFetch('/users/me/watchlist').catch(() => []),
                traktFetch('/users/me/collection/movies').catch(() => []),
                traktFetch('/users/me/ratings').catch(() => [])
            ]);

            res.json({
                success: true,
                stats: {
                    movies: stats.movies || { watched: 0, collected: 0, ratings: 0 },
                    shows: stats.shows || { watched: 0, collected: 0, ratings: 0 },
                    episodes: stats.episodes || { watched: 0, collected: 0, ratings: 0 },
                    network: stats.network || { friends: 0, followers: 0, following: 0 },
                    watchlist: Array.isArray(watchlist) ? watchlist : [],
                    collection: Array.isArray(collection) ? collection : [],
                    ratings: Array.isArray(ratings) ? ratings : []
                }
            });
        } catch (error) {
            console.error('[TRAKT] Comprehensive stats error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get user profile info
    app.get('/api/trakt/user/profile', async (req, res) => {
        try {
            const profile = await traktFetch('/users/me');
            res.json({ success: true, profile });
        } catch (error) {
            console.error('[TRAKT] Profile error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get user collection
    app.get('/api/trakt/collection', async (req, res) => {
        try {
            const [movies, shows] = await Promise.all([
                traktFetch('/users/me/collection/movies').catch(() => []),
                traktFetch('/users/me/collection/shows').catch(() => [])
            ]);
            res.json({ 
                success: true, 
                collection: { 
                    movies: Array.isArray(movies) ? movies : [],
                    shows: Array.isArray(shows) ? shows : []
                }
            });
        } catch (error) {
            console.error('[TRAKT] Collection error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get user ratings
    app.get('/api/trakt/ratings', async (req, res) => {
        try {
            const ratings = await traktFetch('/users/me/ratings');
            res.json({ success: true, ratings: Array.isArray(ratings) ? ratings : [] });
        } catch (error) {
            console.error('[TRAKT] Ratings error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Rate content
    app.post('/api/trakt/rate', async (req, res) => {
        try {
            const { title, type, year, rating } = req.body;
            if (!title || !type || !rating) {
                return res.status(400).json({ success: false, error: 'Missing required parameters' });
            }

            const items = [{
                [type]: {
                    title,
                    year: parseInt(year)
                },
                rating: parseInt(rating)
            }];

            const response = await traktFetch('/sync/ratings', {
                method: 'POST',
                body: JSON.stringify({ [type + 's']: items })
            });

            res.json({ success: true, response });
        } catch (error) {
            console.error('[TRAKT] Rate error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Add to collection
    app.post('/api/trakt/collection/add', async (req, res) => {
        try {
            const { title, type, year } = req.body;
            if (!title || !type) {
                return res.status(400).json({ success: false, error: 'Missing required parameters' });
            }

            const items = [{
                [type]: {
                    title,
                    year: parseInt(year)
                }
            }];

            const response = await traktFetch('/sync/collection', {
                method: 'POST',
                body: JSON.stringify({ [type + 's']: items })
            });

            res.json({ success: true, response });
        } catch (error) {
            console.error('[TRAKT] Add to collection error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Remove from collection
    app.post('/api/trakt/collection/remove', async (req, res) => {
        try {
            const { title, type, year } = req.body;
            if (!title || !type) {
                return res.status(400).json({ success: false, error: 'Missing required parameters' });
            }

            const items = [{
                [type]: {
                    title,
                    year: parseInt(year)
                }
            }];

            const response = await traktFetch('/sync/collection/remove', {
                method: 'POST',
                body: JSON.stringify({ [type + 's']: items })
            });

            res.json({ success: true, response });
        } catch (error) {
            console.error('[TRAKT] Remove from collection error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get trending content
    app.get('/api/trakt/trending', async (req, res) => {
        try {
            const { type = 'movies' } = req.query;
            const response = await traktFetch(`/${type}/trending?limit=20`);
            res.json({ success: true, trending: Array.isArray(response) ? response : [] });
        } catch (error) {
            console.error('[TRAKT] Trending error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get popular content
    app.get('/api/trakt/popular', async (req, res) => {
        try {
            const { type = 'movies' } = req.query;
            const response = await traktFetch(`/${type}/popular?limit=20`);
            res.json({ success: true, popular: Array.isArray(response) ? response : [] });
        } catch (error) {
            console.error('[TRAKT] Popular error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get recommendations
    app.get('/api/trakt/recommendations', async (req, res) => {
        try {
            const { type = 'movies' } = req.query;
            const response = await traktFetch(`/recommendations/${type}?limit=20`);
            res.json({ success: true, recommendations: Array.isArray(response) ? response : [] });
        } catch (error) {
            console.error('[TRAKT] Recommendations error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ===== END TRAKT API ENDPOINTS =====

    // ===== GENERIC PROXY ENDPOINTS (to avoid CORS) =====
    // Proxy Xtream player_api.php JSON
    app.get('/api/proxy/xtream', async (req, res) => {
        try {
            let base = (req.query.base || '').toString();
            const params = (req.query.params || '').toString();
            if (!base.startsWith('http')) return res.status(400).json({ success: false, error: 'Invalid base' });
            // Basic sanitization: strip known portal suffixes
            try {
                const u = new URL(base);
                base = u.origin + u.pathname.replace(/\/+$/, '');
            } catch {}
            base = base.replace(/\/(player_api\.php|xmltv\.php|get\.php)$/i, '')
                       .replace(/\/(c|panel_api|client_area)\/?$/i, '')
                       .replace(/\/+$/, '');
            const headers = {
                'Accept': 'application/json,text/plain,*/*',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118 Safari/537.36',
                'Referer': base
            };
            async function tryJsonResponse(up) {
                const ct = up.headers.get('content-type') || '';
                const text = await up.text();
                if (/application\/json|\+json/i.test(ct) || (text.trim().startsWith('{') || text.trim().startsWith('['))) {
                    try { return { ok: true, json: JSON.parse(text) }; } catch {}
                }
                return { ok: false, status: up.status, contentType: ct, bodySnippet: text.slice(0, 1000) };
            }

            // Attempt 1: GET player_api.php
            let url = `${base}/player_api.php?${params}`;
            let up = await fetch(url, { headers });
            let parsed = await tryJsonResponse(up);

            // If 414 (Request-URI Too Large) or not JSON, try POST to player_api.php
            if (!parsed.ok && (up.status === 414 || true)) {
                let upPost = await fetch(`${base}/player_api.php`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
                let parsedPost = await tryJsonResponse(upPost);
                if (parsedPost.ok) return res.json(parsedPost.json);
                parsed = parsedPost; up = upPost;
            }

            // If still not JSON and this looks like a login (no action=), try panel_api.php GET then POST
            if (!parsed.ok && !/(^|&)action=/.test(params)) {
                let upPanel = await fetch(`${base}/panel_api.php?${params}`, { headers });
                let parsedPanel = await tryJsonResponse(upPanel);
                if (!parsedPanel.ok) {
                    upPanel = await fetch(`${base}/panel_api.php`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
                    parsedPanel = await tryJsonResponse(upPanel);
                }
                if (parsedPanel.ok) return res.json(parsedPanel.json);
                parsed = parsedPanel; up = upPanel;
            }

            if (parsed.ok) return res.json(parsed.json);
            return res.json({ success: false, nonJson: true, status: up.status, contentType: parsed.contentType, bodySnippet: parsed.bodySnippet });
        } catch (e) {
            console.error('[PROXY] xtream error:', e.message);
            res.status(502).json({ success: false, error: 'xtream proxy failed' });
        }
    });

    // Proxy fetch text (e.g., M3U/M3U8 playlists)
    app.get('/api/proxy/fetch-text', async (req, res) => {
        try {
            let url = (req.query.url || '').toString();
            if (!url.startsWith('http')) return res.status(400).end('Invalid URL');
            const upstream = await fetch(url, { headers: { 'Accept': '*/*', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118 Safari/537.36' } });
            const body = await upstream.text();
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.send(body);
        } catch (e) {
            console.error('[PROXY] fetch-text error:', e.message);
            res.status(502).end('proxy error');
        }
    });

    // Range-capable proxy for debrid direct URLs with HLS support
    app.get('/stream/debrid', async (req, res) => {
        try {
            const directUrl = (req.query?.url || '').toString();
            if (!directUrl.startsWith('http')) return res.status(400).end('Bad URL');
            
            // Check if this is an HLS playlist
            const isHLS = directUrl.includes('.m3u8');
            
            let range = req.headers.range;
            const startSec = Number(req.query?.start || 0);
            let headers = {};
            if (range && !isHLS) headers.Range = range;
            else if (!isNaN(startSec) && startSec > 0 && !isHLS) {
                headers = {};
            }
            
            // Add proper headers for AllDebrid links
            if (directUrl.includes('alldebrid.com')) {
                headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
                headers['Referer'] = 'https://alldebrid.com/';
                headers['Accept'] = '*/*';
                headers['Accept-Encoding'] = 'identity';
                headers['Connection'] = 'keep-alive';
            }
            
            console.log('[STREAM] requesting:', directUrl, 'headers:', headers);
            const upstream = await fetch(directUrl, { headers });
            const status = upstream.status;
            console.log('[STREAM] response status:', status);
            console.log('[STREAM] response headers:', Object.fromEntries([...upstream.headers.entries()]));
            
            if (!upstream.ok) {
                console.error('[STREAM] upstream error:', status, await upstream.text());
                return res.status(status).end('upstream error');
            }
            
            res.status(status);
            
            if (isHLS) {
                // For HLS streams, set proper content type and handle as text
                res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
                res.setHeader('Cache-Control', 'no-cache');
                const body = await upstream.text();
                
                // Rewrite relative URLs in the playlist to go through our proxy
                const baseUrl = directUrl.substring(0, directUrl.lastIndexOf('/') + 1);
                const rewrittenBody = body.replace(/^([^#\n\r]+\.(ts|m3u8))/gm, (match, segment) => {
                    const segmentUrl = segment.startsWith('http') ? segment : baseUrl + segment;
                    return `${req.protocol}://${req.get('host')}/stream/debrid?url=${encodeURIComponent(segmentUrl)}`;
                });
                
                console.log('[STREAM] HLS playlist rewritten, segments proxied through', `${req.protocol}://${req.get('host')}`);
                res.send(rewrittenBody);
            } else {
                // Regular file streaming with range support
                const passthrough = ['content-length','content-range','accept-ranges','content-type'];
                passthrough.forEach((h) => {
                    const v = upstream.headers.get(h);
                    if (v) res.setHeader(h, v);
                });
                
                // Fallback content-type by extension
                if (!res.getHeader('content-type')) {
                    try {
                        const u = new URL(directUrl);
                        const ct = mime.lookup(u.pathname) || 'application/octet-stream';
                        res.setHeader('Content-Type', ct);
                    } catch {}
                }
                
                const body = upstream.body;
                body.on('error', () => { try { res.end(); } catch {} });
                req.on('close', () => { try { body.destroy(); } catch {} });
                body.pipe(res);
            }
        } catch (e) {
            console.error('[STREAM] proxy error:', e.message);
            res.status(502).end('debrid proxy error');
        }
    });

    // Alias with /api prefix for clients that use API_BASE_URL for streaming
    app.get('/api/stream/debrid', async (req, res) => {
        try {
            console.log('[STREAM] Request received:', {
                userAgent: req.headers['user-agent'],
                url: req.url,
                queryUrl: req.query?.url,
                method: req.method,
                headers: req.headers
            });
            
            let directUrl = (req.query?.url || '').toString();
            
            if (!directUrl) {
                console.error('[STREAM] Missing URL parameter');
                return res.status(400).end('Missing URL parameter');
            }
            
            // Handle double URL encoding: if the URL contains %XX sequences, decode them
            // This happens when the CDN URL itself has encoded characters that get re-encoded
            if (directUrl.includes('%')) {
                try {
                    directUrl = decodeURIComponent(directUrl);
                    console.log('[STREAM] Decoded URL to:', directUrl);
                } catch (e) {
                    // Already decoded or malformed, use as-is
                    console.log('[STREAM] URL decode failed, using as-is:', e.message);
                }
            }
            
            if (!directUrl.startsWith('http')) {
                console.error('[STREAM] Invalid URL after decode:', directUrl);
                return res.status(400).end('Bad URL');
            }
            
            // Check if this is an HLS playlist
            const isHLS = directUrl.includes('.m3u8');
            
            const range = req.headers.range;
            let headers = {};
            if (range && !isHLS) headers.Range = range;
            
            // Add proper headers for AllDebrid links
            if (directUrl.includes('alldebrid.com')) {
                headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
                headers['Referer'] = 'https://alldebrid.com/';
                headers['Accept'] = '*/*';
                headers['Accept-Encoding'] = 'identity';
                headers['Connection'] = 'keep-alive';
            }
            
            console.log('[STREAM] API requesting:', directUrl, 'headers:', headers);
            const upstream = await fetch(directUrl, { headers });
            const status = upstream.status;
            console.log('[STREAM] API response status:', status);
            console.log('[STREAM] API response headers:', Object.fromEntries([...upstream.headers.entries()]));
            
            if (!upstream.ok) {
                console.error('[STREAM] API upstream error:', status, await upstream.text());
                return res.status(status).end('upstream error');
            }
            
            res.status(status);
            
            if (isHLS) {
                // For HLS streams, set proper content type and handle as text
                res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
                res.setHeader('Cache-Control', 'no-cache');
                const body = await upstream.text();
                
                // Rewrite relative URLs in the playlist to go through our proxy
                const baseUrl = directUrl.substring(0, directUrl.lastIndexOf('/') + 1);
                const rewrittenBody = body.replace(/^([^#\n\r]+\.(ts|m3u8))/gm, (match, segment) => {
                    const segmentUrl = segment.startsWith('http') ? segment : baseUrl + segment;
                    return `${req.protocol}://${req.get('host')}/api/stream/debrid?url=${encodeURIComponent(segmentUrl)}`;
                });
                
                console.log('[STREAM] API HLS playlist rewritten');
                res.send(rewrittenBody);
            } else {
                // Regular file streaming
                const passthrough = ['content-length','content-range','accept-ranges','content-type'];
                passthrough.forEach((h) => {
                    const v = upstream.headers.get(h);
                    if (v) res.setHeader(h, v);
                });
                
                if (!res.getHeader('content-type')) {
                    try {
                        const u = new URL(directUrl);
                        const ct = mime.lookup(u.pathname) || 'application/octet-stream';
                        res.setHeader('Content-Type', ct);
                    } catch {}
                }
                
                const body = upstream.body;
                body.on('error', () => { try { res.end(); } catch {} });
                req.on('close', () => { try { body.destroy(); } catch {} });
                body.pipe(res);
            }
        } catch (e) {
            console.error('[STREAM] proxy error:', e.message);
            res.status(502).end('debrid proxy error');
        }
    });

    // Note: SUB_TMP_DIR, ensureSubsDir, and /subtitles middleware are initialized after settings are loaded (see below)
    
    // ----------------------
    // Configuration and API Key Management
    // ----------------------
// ---- Manifest URL persistent storage ----


    // API Key Management
    let API_KEY = '';
    let lastKeyPath = '';

    // Determine where to read/write the root-level key file
    const installDir = path.dirname(process.execPath); // In packaged builds, next to the app exe
    const devRoot = __dirname; // In dev, server.mjs resides at project root

    // Prefer userData in installed builds to avoid permission issues; keep other locations for backward-compat
    const resolveReadCandidates = () => [
        path.join(userDataPath, 'jackett_api_key.json'), // primary location for installed app
        path.join(installDir, 'jackett_api_key.json'),    // legacy next to exe (when per-user installs were writable)
        path.join(devRoot, 'jackett_api_key.json'),       // project root (dev)
        path.join(process.cwd(), 'jackett_api_key.json')  // current working dir (fallback)
    ];

    const rootKeyExists = () => {
        const candidates = [
            path.join(userDataPath, 'jackett_api_key.json'),
            path.join(installDir, 'jackett_api_key.json'),
            path.join(devRoot, 'jackett_api_key.json'),
            path.join(process.cwd(), 'jackett_api_key.json')
        ];
        return candidates.some(p => {
            try { return fs.existsSync(p); } catch { return false; }
        });
    };

    const isPackagedByExe = (() => {
        try {
            const exe = path.basename(process.execPath).toLowerCase();
            return !(exe === 'electron.exe' || exe === 'node.exe' || exe === 'node');
        } catch {
            return false;
        }
    })();

    const resolveWritePath = () => {
        // ALWAYS write to userData for consistency (both dev and packaged)
        // This matches the read priority in loadAPIKey()
        return path.join(userDataPath, 'jackett_api_key.json');
    };

    function loadAPIKey() {
        try {
            // Always try to read from a root-level file if present
            for (const candidate of resolveReadCandidates()) {
                try {
                    if (fs.existsSync(candidate)) {
                        const raw = fs.readFileSync(candidate, 'utf8');
                        
                        // Handle both cases: JSON file and plain text (legacy)
                        let key = '';
                        try {
                            const parsed = JSON.parse(raw);
                            key = parsed.apiKey || '';
                        } catch (jsonErr) {
                            // Not JSON, try as plain text
                            key = raw.trim();
                        }
                        
                        if (key) {
                            API_KEY = key;
                            lastKeyPath = candidate;
                            console.log(`✅ API Key loaded from ${candidate}`);
                            return true;
                        } else {
                            console.warn(`⚠️ API Key file exists but is empty: ${candidate}`);
                        }
                    }
                } catch (e) {
                    console.warn(`⚠️ Error reading API key from ${candidate}:`, e?.message);
                    // keep trying other candidates
                }
            }

            // No root-level file found; clear cached key
            if (API_KEY) {
                console.log('ℹ️ No API key file found, clearing cached key');
            }
            API_KEY = '';
        } catch (error) {
            console.error('❌ Error loading API key:', error);
        }
        return false;
    }

    // Prowlarr API Key Management (same pattern as Jackett)
    const resolveProwlarrReadCandidates = () => [
        path.join(userDataPath, 'prowlarr_api_key.json'),
        path.join(installDir, 'prowlarr_api_key.json'),
        path.join(devRoot, 'prowlarr_api_key.json'),
        path.join(process.cwd(), 'prowlarr_api_key.json')
    ];

    const resolveProwlarrWritePath = () => {
        return path.join(userDataPath, 'prowlarr_api_key.json');
    };

    function loadProwlarrAPIKey() {
        try {
            for (const candidate of resolveProwlarrReadCandidates()) {
                try {
                    if (fs.existsSync(candidate)) {
                        const raw = fs.readFileSync(candidate, 'utf8');
                        
                        let key = '';
                        try {
                            const parsed = JSON.parse(raw);
                            key = parsed.apiKey || '';
                        } catch (jsonErr) {
                            key = raw.trim();
                        }
                        
                        if (key) {
                            PROWLARR_API_KEY = key;
                            console.log(`✅ Prowlarr API Key loaded from ${candidate}`);
                            return true;
                        } else {
                            console.warn(`⚠️ Prowlarr API Key file exists but is empty: ${candidate}`);
                        }
                    }
                } catch (e) {
                    console.warn(`⚠️ Error reading Prowlarr API key from ${candidate}:`, e?.message);
                }
            }

            if (PROWLARR_API_KEY) {
                console.log('ℹ️ No Prowlarr API key file found, clearing cached key');
            }
            PROWLARR_API_KEY = '';
        } catch (error) {
            console.error('❌ Error loading Prowlarr API key:', error);
        }
        return false;
    }

    function saveAPIKey(apiKey) {
        const payload = JSON.stringify({ apiKey }, null, 2);
        
        // Try multiple locations in order of preference
        const writeCandidates = [
            path.join(userDataPath, 'jackett_api_key.json'),     // Primary: userData (always writable)
            path.join(installDir, 'jackett_api_key.json'),       // Secondary: next to exe (legacy)
            path.join(devRoot, 'jackett_api_key.json'),          // Tertiary: dev root
            path.join(process.cwd(), 'jackett_api_key.json')     // Fallback: current working dir
        ];
        
        let lastError = null;
        
        for (const targetPath of writeCandidates) {
            try {
                console.log(`[API Key] Attempting to save to: ${targetPath}`);
                
                // Ensure directory exists with error handling
                const targetDir = path.dirname(targetPath);
                try {
                    if (!fs.existsSync(targetDir)) {
                        fs.mkdirSync(targetDir, { recursive: true, mode: 0o755 });
                        console.log(`[API Key] Created directory: ${targetDir}`);
                    }
                    
                    // Verify directory is writable
                    fs.accessSync(targetDir, fs.constants.W_OK);
                } catch (dirErr) {
                    console.warn(`[API Key] Directory not writable: ${targetDir}`, dirErr?.message);
                    lastError = dirErr;
                    continue; // Try next location
                }
                
                // Write the file with explicit error handling
                fs.writeFileSync(targetPath, payload, { encoding: 'utf8', mode: 0o644 });
                
                // Verify the file was written correctly
                if (fs.existsSync(targetPath)) {
                    const verification = fs.readFileSync(targetPath, 'utf8');
                    const parsed = JSON.parse(verification);
                    if (parsed.apiKey === apiKey) {
                        API_KEY = apiKey;
                        lastKeyPath = targetPath;
                        console.log(`✅ API Key successfully saved to ${targetPath}`);
                        
                        // Clean up old files from other locations to avoid confusion
                        for (const oldPath of writeCandidates) {
                            if (oldPath !== targetPath) {
                                try {
                                    if (fs.existsSync(oldPath)) {
                                        fs.unlinkSync(oldPath);
                                        console.log(`🗑️ Removed old API key from ${oldPath}`);
                                    }
                                } catch (cleanupErr) {
                                    // Ignore cleanup errors
                                }
                            }
                        }
                        
                        return true;
                    } else {
                        console.warn(`[API Key] Verification failed for ${targetPath}`);
                        lastError = new Error('Verification failed');
                    }
                } else {
                    console.warn(`[API Key] File not found after write: ${targetPath}`);
                    lastError = new Error('File not found after write');
                }
            } catch (err) {
                console.warn(`[API Key] Failed to write to ${targetPath}:`, err?.message || err);
                lastError = err;
                continue; // Try next location
            }
        }
        
        // All locations failed
        console.error('❌ Failed to save API key to any location. Last error:', lastError?.message || lastError);
        return false;
    }

    // Diagnostics: where is the API key stored/loaded from?
    app.get('/api/key-location', (req, res) => {
        // Refresh view
        loadAPIKey();
        res.json({
            hasApiKey: !!API_KEY,
            path: lastKeyPath || null,
            userDataPath,
        });
    });

    // Load any existing key at startup
    const hasAPIKey = loadAPIKey();
    const hasProwlarrAPIKey = loadProwlarrAPIKey();

    // Configuration defaults
    let JACKETT_URL = 'http://127.0.0.1:9117/api/v2.0/indexers/all/results/torznab';
    let PROWLARR_URL = 'http://127.0.0.1:9696';
    let PROWLARR_API_KEY = '';
    let CACHE_LOCATION = os.tmpdir(); // Default to system temp

    // Load user settings for Jackett URL, Prowlarr URL and cache location
    function loadUserSettings() {
        const settingsPath = path.join(userDataPath, 'user_settings.json');
        try {
            if (fs.existsSync(settingsPath)) {
                const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
                if (settings.jackettUrl) {
                    JACKETT_URL = settings.jackettUrl;
                    console.log(`Loaded custom Jackett URL: ${JACKETT_URL}`);
                }
                if (settings.prowlarrUrl) {
                    PROWLARR_URL = settings.prowlarrUrl;
                    console.log(`Loaded custom Prowlarr URL: ${PROWLARR_URL}`);
                }
                if (settings.cacheLocation) {
                    CACHE_LOCATION = settings.cacheLocation;
                    console.log(`Loaded custom cache location: ${CACHE_LOCATION}`);
                }
                return settings;
            }
        } catch (error) {
            console.error('Error loading user settings:', error);
        }
        return { jackettUrl: JACKETT_URL, prowlarrUrl: PROWLARR_URL, cacheLocation: CACHE_LOCATION };
    }

    function saveUserSettings(settings) {
        const settingsPath = path.join(userDataPath, 'user_settings.json');
        try {
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
            console.log('User settings saved:', settings);
            return true;
        } catch (error) {
            console.error('Error saving user settings:', error);
            return false;
        }
    }

    // Load settings on startup
    loadUserSettings();

    // Temporary subtitles storage (must be after loadUserSettings)
    const SUB_TMP_DIR = path.join(CACHE_LOCATION, 'playtorrio_subs');
    const ensureSubsDir = () => { try { fs.mkdirSync(SUB_TMP_DIR, { recursive: true }); } catch {} };
    ensureSubsDir();

    // Register subtitle middleware now that SUB_TMP_DIR is defined
    // Guard: recreate folder if it was cleared just before a request
    app.use('/subtitles', (req, res, next) => { ensureSubsDir(); next(); });
    // Serve temp subtitles under /subtitles/*.ext with explicit content types
    app.use('/subtitles', express.static(SUB_TMP_DIR, {
        fallthrough: true,
        setHeaders: (res, filePath) => {
            const lower = filePath.toLowerCase();
            if (lower.endsWith('.vtt')) {
                res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
            } else if (lower.endsWith('.srt')) {
                // Most browsers expect WebVTT, but we convert to .vtt; keep for completeness
                res.setHeader('Content-Type', 'application/x-subrip; charset=utf-8');
            }
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        }
    }));

    // ============================================================================
    // TORRENT ENGINE MANAGER - MULTI-ENGINE SUPPORT
    // ============================================================================
    // Supports: Stremio, WebTorrent, TorrentStream, and Hybrid modes
    // ============================================================================
    
    // Register unified Torrent Engine routes (handles all engine types)
    const engineRefs = registerTorrentEngineRoutes(app, userDataPath);
    const cleanupEngines = engineRefs.cleanup;
    
    console.log('[TorrentEngineManager] ⚡ Multi-engine routes registered');

    // ============================================================================
    // STREMIO ENGINE - FAST TORRENT STREAMING (Legacy/Fallback)
    // ============================================================================
    // Uses Stremio's bundled engine (engine/server.js) for maximum speed
    // ============================================================================
    
    // Register Stremio Engine routes and get references
    const stremioRefs = registerStremioRoutes(app, userDataPath, resolvedFfmpegPath, resolvedFfprobePath);
    const activeTorrents = stremioRefs.activeTorrents;
    const torrentTimestamps = stremioRefs.torrentTimestamps;
    const cleanupStremio = stremioRefs.cleanup;
    
    console.log('[StremioEngine] ⚡ Routes registered');

    // Legacy compatibility variables (for code that references these)
    const selectedFiles = new Map();
    const streamingState = new Map();
    const peerStats = new Map();

    // OpenSubtitles API key (provided by user for this app)
    const OPEN_SUBTITLES_API_KEY = 'bAYQ53sQ01tx14QcOrPjGkdnTOUMjMC0';

    // Multer for handling subtitle uploads (memory storage so we can convert before saving)
    const upload = multer({ storage: multer.memoryStorage() });

    // Helper: Convert basic SRT text into WebVTT
    const srtToVtt = (srtText) => {
        try {
            const body = String(srtText)
                .replace(/\r+/g, '')
                // Remove numeric indices on their own line
                .replace(/^\d+\s*$/gm, '')
                // Replace comma with dot in timestamps
                .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
                .trim();
            return `WEBVTT\n\n${body}\n`;
        } catch {
            return `WEBVTT\n\n` + String(srtText || '');
        }
    };
    // Helper: Convert basic ASS/SSA into WebVTT (best-effort)
    // Parses the [Events] section using its Format line to extract Start, End, Text.
    // Strips styling tags and converts \N to line breaks. Timing is converted from h:mm:ss.cs to hh:mm:ss.mmm
    const assToVtt = (assText) => {
        try {
            const text = String(assText || '');
            const lines = text.replace(/\r+/g, '').split(/\n/);
            let inEvents = false;
            let format = [];
            const cues = [];
            const cleanAssText = (t) => {
                let s = String(t || '');
                // Remove styling override blocks {\...}
                s = s.replace(/\{[^}]*\}/g, '');
                // Replace \N with newlines and \h with space
                s = s.replace(/\\N/g, '\n').replace(/\\h/g, ' ');
                // Collapse multiple spaces
                s = s.replace(/\s{2,}/g, ' ').trim();
                return s;
            };
            const toVttTime = (assTime) => {
                // ASS: H:MM:SS.CS (centiseconds)
                const m = String(assTime || '').trim().match(/^(\d+):(\d{2}):(\d{2})[.](\d{2})$/);
                if (!m) return null;
                const h = String(m[1]).padStart(2, '0');
                const mm = m[2];
                const ss = m[3];
                const cs = m[4];
                const ms = String(parseInt(cs, 10) * 10).padStart(3, '0');
                return `${h}:${mm}:${ss}.${ms}`;
            };
            for (let raw of lines) {
                const line = raw.trim();
                if (!line) continue;
                if (/^\[events\]/i.test(line)) { inEvents = true; continue; }
                if (/^\[.*\]/.test(line)) { inEvents = false; continue; }
                if (!inEvents) {
                    if (/^format\s*:/i.test(line)) {
                        // Build field order
                        const parts = line.split(':')[1] || '';
                        format = parts.split(',').map(s => s.trim().toLowerCase());
                    }
                    continue;
                }
                if (!/^dialogue\s*:/i.test(line)) continue;
                // Parse Dialogue using the known number of fields from Format
                const after = line.replace(/^dialogue\s*:\s*/i, '');
                const fieldsCount = format.length || 10; // common default is 10
                const parts = [];
                let remaining = after;
                for (let i = 0; i < Math.max(1, fieldsCount - 1); i++) {
                    const idx = remaining.indexOf(',');
                    if (idx === -1) { parts.push(remaining); remaining = ''; break; }
                    parts.push(remaining.slice(0, idx));
                    remaining = remaining.slice(idx + 1);
                }
                parts.push(remaining);
                // Map to a record
                const rec = {};
                for (let i = 0; i < format.length && i < parts.length; i++) {
                    rec[format[i]] = parts[i];
                }
                const start = toVttTime(rec.start);
                const end = toVttTime(rec.end);
                let body = rec.text || parts[parts.length - 1] || '';
                body = cleanAssText(body);
                if (start && end && body) {
                    cues.push(`${start} --> ${end}\n${body}`);
                }
            }
            return `WEBVTT\n\n${cues.join('\n\n')}\n`;
        } catch {
            // Fallback: wrap raw text into VTT
            return `WEBVTT\n\n${String(assText || '')}`;
        }
    };

    // --- API Routes ---

    app.get('/api/check-api-key', (req, res) => {
        // Re-read on demand so external edits to any file are reflected
        loadAPIKey();
        // For UI: report whether a root-level file exists (user wants modal if not present)
        const s = readSettings();
        res.json({ hasApiKey: rootKeyExists(), useTorrentless: !!s.useTorrentless });
    });

    app.post('/api/set-api-key', (req, res) => {
        if (!req.body.apiKey) return res.status(400).json({ error: 'Invalid API key' });
        const key = req.body.apiKey.trim();

        // If the key is masked, don't overwrite the existing one
        if (key.includes('*')) {
            return res.json({ 
                success: true, 
                message: 'API key is masked, not updating' 
            });
        }
        
        console.log('[API Key] Save request received');
        
        if (saveAPIKey(key)) {
            console.log('[API Key] Save successful, verifying...');
            
            // Verify by reading it back
            loadAPIKey();
            if (API_KEY === key) {
                console.log('[API Key] Verification successful');
                res.json({ 
                    success: true, 
                    message: 'API key saved successfully',
                    path: lastKeyPath 
                });
            } else {
                console.error('[API Key] Verification failed - saved key does not match');
                res.status(500).json({ 
                    error: 'API key saved but verification failed',
                    details: 'The key was written but could not be read back correctly'
                });
            }
        } else {
            console.error('[API Key] Save failed - no writable location found');
            res.status(500).json({ 
                error: 'Failed to save API key',
                details: 'Could not write to any of the expected locations. Check file permissions.',
                attemptedPaths: [
                    path.join(userDataPath, 'jackett_api_key.json'),
                    path.join(path.dirname(process.execPath), 'jackett_api_key.json')
                ]
            });
        }
    });

    app.get('/api/get-api-key', (req, res) => {
        // Ensure we have the latest view of the key file
        loadAPIKey();
        if (API_KEY) {
            const masked = API_KEY.substring(0, 4) + '*'.repeat(Math.max(0, API_KEY.length - 8)) + API_KEY.substring(Math.max(4, API_KEY.length - 4));
            res.json({ apiKey: masked, hasApiKey: true });
        } else {
            res.json({ apiKey: '', hasApiKey: false });
        }
    });

    // Prowlarr API Key endpoints (same pattern as Jackett)
    app.post('/api/set-prowlarr-api-key', (req, res) => {
        if (!req.body.apiKey) return res.status(400).json({ error: 'Invalid API key' });
        const key = req.body.apiKey.trim();

        if (key.includes('*')) {
            return res.json({ 
                success: true, 
                message: 'API key is masked, not updating' 
            });
        }
        
        console.log('[Prowlarr API Key] Save request received');
        
        const writePath = resolveProwlarrWritePath();
        try {
            const dir = path.dirname(writePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            fs.writeFileSync(writePath, JSON.stringify({ apiKey: key }, null, 2), 'utf8');
            console.log(`[Prowlarr API Key] Saved to ${writePath}`);
            
            // Verify by reading it back
            loadProwlarrAPIKey();
            if (PROWLARR_API_KEY === key) {
                console.log('[Prowlarr API Key] Verification successful');
                res.json({ 
                    success: true, 
                    message: 'Prowlarr API key saved successfully',
                    path: writePath 
                });
            } else {
                console.error('[Prowlarr API Key] Verification failed');
                res.status(500).json({ 
                    error: 'API key saved but verification failed'
                });
            }
        } catch (error) {
            console.error('[Prowlarr API Key] Save failed:', error);
            res.status(500).json({ 
                error: 'Failed to save Prowlarr API key',
                details: error.message,
                attemptedPath: writePath
            });
        }
    });

    app.get('/api/get-prowlarr-api-key', (req, res) => {
        loadProwlarrAPIKey();
        if (PROWLARR_API_KEY) {
            const masked = PROWLARR_API_KEY.substring(0, 4) + '*'.repeat(Math.max(0, PROWLARR_API_KEY.length - 8)) + PROWLARR_API_KEY.substring(Math.max(4, PROWLARR_API_KEY.length - 4));
            res.json({ apiKey: masked, hasApiKey: true });
        } else {
            res.json({ apiKey: '', hasApiKey: false });
        }
    });

    // NOTE: Torrent streaming routes (/api/torrent-files, /api/stream-file, /api/prepare-file, 
    // /api/stop-stream, /api/torrent-stats, /api/webtorrent-status, /api/resolve-torrent-file)
    // are now handled by TorrServer routes registered above via registerTorrServerRoutes()

    // ============================================================================
    // TORRENT SEARCH API (Jackett/Torrentless)
    // ============================================================================

    app.get('/api/torrents', async (req, res) => {
        const { q: query, page, season, episode, title, useProwlarr } = req.query;
        if (!query) return res.status(400).json({ error: 'Missing query' });
        const s = readSettings();
        const useTorrentless = !!s.useTorrentless;
        const shouldUseProwlarr = useProwlarr === 'true' || useProwlarr === true;
        
        console.log(`[/api/torrents] query="${query}", useTorrentless=${useTorrentless}, useProwlarr=${shouldUseProwlarr}`);
        
        // If Prowlarr is explicitly requested
        if (shouldUseProwlarr) {
            if (!PROWLARR_API_KEY) loadProwlarrAPIKey();
            console.log(`[Prowlarr] API_KEY check: ${PROWLARR_API_KEY ? 'KEY EXISTS (length=' + PROWLARR_API_KEY.length + ')' : 'KEY IS EMPTY'}`);
            if (!PROWLARR_API_KEY) return res.status(400).json({ error: 'Prowlarr API key not configured' });
            
            try {
                const url = `${PROWLARR_URL}/api/v1/search?query=${encodeURIComponent(query)}&type=search`;
                const response = await fetch(url, {
                    headers: {
                        'X-Api-Key': PROWLARR_API_KEY
                    }
                });
                if (!response.ok) throw new Error(`Prowlarr error: ${response.statusText}`);
                const results = await response.json();
                
                let torrents = results.map(item => {
                    const isMagnet = item.magnetUrl || (item.downloadUrl && item.downloadUrl.startsWith('magnet:'));
                    const isHttpDownload = item.downloadUrl && item.downloadUrl.startsWith('http');
                    
                    return {
                        title: item.title,
                        magnet: isMagnet ? (item.magnetUrl || item.downloadUrl) : null,
                        torrentFileUrl: isHttpDownload ? item.downloadUrl : null,
                        seeders: item.seeders || 0,
                        size: item.size || 0
                    };
                }).filter(t => t.magnet || t.torrentFileUrl);
                
                // Apply strict filtering
                if (season || episode || title) {
                    console.log(`[Prowlarr Filter] Applying strict filter: Title="${title}", S=${season}, E=${episode}`);
                    const showTitle = title || query.replace(/s\d+e\d+.*$/i, '').replace(/s\d+.*$/i, '').trim();
                    torrents = filterTorrents(torrents, showTitle, season, episode);
                    console.log(`[Prowlarr Filter] Remaining torrents: ${torrents.length}`);
                }
                
                return res.json(torrents);
            } catch (error) {
                console.error('[Prowlarr] Error fetching torrents:', error);
                return res.status(500).json({ error: 'Failed to fetch from Prowlarr', message: error.message });
            }
        }
        
        // If Torrentless is enabled, prefer it
        if (useTorrentless) {
            try {
                const p = Math.max(1, parseInt(page, 10) || 1);
                const url = `http://127.0.0.1:3002/api/search?q=${encodeURIComponent(query)}&page=${p}`;
                const response = await fetch(url);
                // If Torrentless rate-limits or errors, proxy the JSON body to the client instead of throwing
                let data;
                try { data = await response.json(); } catch { data = null; }
                if (!response.ok) {
                    // Ensure a friendly structured error instead of ECONNREFUSED noise
                    const fallback = data && typeof data === 'object' ? data : { error: `Torrentless error: ${response.status} ${response.statusText}` };
                    return res.status(response.status).json(fallback);
                }
                const items = Array.isArray(data.items) ? data.items : [];
                const torrents = items.map(it => ({
                    title: it.title,
                    magnet: it.magnet,
                    seeders: Number(it.seeds || it.seeders || 0),
                    size: (() => {
                        // Try to convert "2.54 GB" style strings to bytes; else 0
                        const m = String(it.size || '').match(/([0-9.]+)\s*(KB|MB|GB|TB)/i);
                        if (!m) return 0;
                        const n = parseFloat(m[1]);
                        const unit = m[2].toUpperCase();
                        const mult = unit === 'KB' ? 1024 : unit === 'MB' ? 1024**2 : unit === 'GB' ? 1024**3 : 1024**4;
                        return Math.round(n * mult);
                    })(),
                }));
                return res.json(torrents);
            } catch (error) {
                // If Torrentless is unreachable or throws, return a friendly JSON error and do NOT fall back to Jackett
                const msg = (error && error.message || '').toLowerCase();
                if (msg.includes('ecconnrefused') || msg.includes('connect')) {
                    return res.status(503).json({ error: 'Torrentless service is unavailable. Try again shortly.' });
                }
                return res.status(500).json({ error: 'Failed to fetch from Torrentless.' });
            }
        }

        // Jackett fallback/default
        // Ensure key is loaded from disk whenever we need Jackett
        if (!API_KEY) loadAPIKey();
        console.log(`[Jackett] API_KEY check: ${API_KEY ? 'KEY EXISTS (length=' + API_KEY.length + ')' : 'KEY IS EMPTY'}`);
        if (!API_KEY) return res.status(400).json({ error: 'API key not configured' });
        try {
            // Exclude adult/XXX categories (category IDs: 6000-6999 are adult categories in Jackett/Newznab)
            // Also exclude specific category codes: XXX (6000), Other XXX (6010-6090)
            const url = `${JACKETT_URL}?apikey=${API_KEY}&t=search&q=${encodeURIComponent(query)}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Jackett error: ${response.statusText}`);
            const xml = await response.text();
            const result = await xml2js.parseStringPromise(xml, { mergeAttrs: true, explicitArray: false });
            const items = result.rss.channel.item || [];
            let torrents = (Array.isArray(items) ? items : [items])
                .map(item => {
                    if (!item || (!item.link && !item.guid)) return null;
                    
                    let magnet = null;
                    let torrentFileUrl = null;

                    if (item.link?.startsWith('magnet:')) {
                        magnet = item.link;
                    } else if (item.guid?.startsWith('magnet:')) {
                        magnet = item.guid;
                    } else if (item.link?.startsWith('http')) {
                        torrentFileUrl = item.link;
                    } else if (item.guid?.startsWith('http')) {
                        torrentFileUrl = item.guid;
                    }

                    if (!magnet && !torrentFileUrl) {
                        return null;
                    }
                    
                    // Check for adult categories
                    const attrs = Array.isArray(item['torznab:attr']) ? item['torznab:attr'] : [item['torznab:attr']];
                    const categoryAttr = attrs.find(attr => attr?.name === 'category');
                    if (categoryAttr) {
                        const catValue = String(categoryAttr.value || '');
                        // Exclude adult categories (6000-6999) and check title for adult keywords
                        if (catValue.startsWith('6') && parseInt(catValue) >= 6000 && parseInt(catValue) < 7000) {
                            return null; // Skip adult content
                        }
                    }
                    
                    // Additional title-based filtering for common adult keywords
                    const title = String(item.title || '').toLowerCase();
                    const adultKeywords = ['xxx', 'porn', 'adult', '18+', 'hentai', 'erotic', 'nsfw'];
                    if (adultKeywords.some(kw => title.includes(kw))) {
                        return null; // Skip if title contains adult keywords
                    }
                    
                    const seeders = attrs.find(attr => attr?.name === 'seeders')?.value || 0;
                    return { title: item.title, magnet, torrentFileUrl, seeders: +seeders, size: +(item.enclosure?.length || 0) };
                })
                .filter(Boolean);

            // Apply strict filtering
            if (season || episode || title) {
                console.log(`[Filter] Applying strict filter: Title="${title}", S=${season}, E=${episode}`);
                // Use provided title or fallback to query (cleaned)
                const showTitle = title || query.replace(/s\d+e\d+.*$/i, '').replace(/s\d+.*$/i, '').trim();
                torrents = filterTorrents(torrents, showTitle, season, episode);
                console.log(`[Filter] Remaining torrents: ${torrents.length}`);
            }

            res.json(torrents);
        } catch (error) {
            console.error('[Jackett] Error fetching torrents:', error);
            try {
                const msg = String(error?.message || '').toLowerCase();
                // Detect common connection failures to Jackett (e.g., ECONNREFUSED 127.0.0.1:9117)
                const isConnRefused = msg.includes('econnrefused');
                const isConnReset = msg.includes('econnreset');
                const isNotFound = msg.includes('enotfound');
                const isTimeout = msg.includes('timeout') || msg.includes('timed out');
                if (isConnRefused || isConnReset || isNotFound || isTimeout) {
                    return res.status(503).json({
                        error: 'Jackett is not enabled or not installed, please enable it and try again, other providers dont need jackett',
                        code: 'JACKETT_UNAVAILABLE'
                    });
                }
            } catch {}
            res.status(500).json({ error: error?.message || 'Jackett error' });
        }
    });

    // App UA for OpenSubtitles (must include app name and version)
    const APP_USER_AGENT = 'PlayTorrio v1.0.0';

    // Map an ISO 639-1 language code to English name (basic set, extend as needed)
    const isoToName = (code) => {
        const map = {
            af: 'Afrikaans', ar: 'Arabic', bg: 'Bulgarian', bn: 'Bengali', ca: 'Catalan', cs: 'Czech', da: 'Danish', de: 'German', el: 'Greek',
            en: 'English', es: 'Spanish', et: 'Estonian', fa: 'Persian', fi: 'Finnish', fr: 'French', he: 'Hebrew', hi: 'Hindi', hr: 'Croatian',
            hu: 'Hungarian', id: 'Indonesian', it: 'Italian', ja: 'Japanese', ka: 'Georgian', kk: 'Kazakh', ko: 'Korean', lt: 'Lithuanian',
            lv: 'Latvian', ms: 'Malay', nl: 'Dutch', no: 'Norwegian', pl: 'Polish', pt: 'Portuguese', ro: 'Romanian', ru: 'Russian', sk: 'Slovak',
            sl: 'Slovenian', sr: 'Serbian', sv: 'Swedish', th: 'Thai', tr: 'Turkish', uk: 'Ukrainian', ur: 'Urdu', vi: 'Vietnamese', zh: 'Chinese',
            pb: 'Portuguese (BR)'
        };
        if (!code) return 'Unknown';
        const key = String(code).toLowerCase();
        return map[key] || code.toUpperCase();
    };

    // Parse torrent filename to infer title/season/episode for TV shows
    function parseReleaseFromFilename(filename = '') {
        try {
            // Strip path and extension
            const base = path.basename(String(filename));
            const noExt = base.replace(/\.[^.]+$/i, '');
            // Normalize separators and remove common tags (brackets)
            const cleaned = noExt
                .replace(/[\[\(].*?[\)\]]/g, ' ') // remove bracketed groups
                .replace(/[_]+/g, ' ')
                .replace(/\s{2,}/g, ' ')
                .trim();

            // Patterns to detect season/episode in many forms
            const patterns = [
                // S01E10 / s01.e10 / S01.E10
                { re: /(s)(\d{1,2})[ ._-]*e(\d{1,3})/i, season: 2, episode: 3 },
                // 01x10 / 1x10
                { re: /\b(\d{1,2})[xX](\d{1,3})\b/, season: 1, episode: 2 },
                // 01.10 or 01-10 (avoid matching 1080, 2160 etc.)
                { re: /\b(\d{1,2})[ ._-]+(\d{1,2})\b/, season: 1, episode: 2 },
            ];

            let season = null, episode = null, title = cleaned;
            let matchIdx = -1, m = null;
            for (let i = 0; i < patterns.length; i++) {
                const p = patterns[i];
                const mm = cleaned.match(p.re);
                if (mm) {
                    // Filter out false positives like 1080 2160 by simple heuristic
                    const sVal = parseInt(mm[p.season], 10);
                    const eVal = parseInt(mm[p.episode], 10);
                    if (!isNaN(sVal) && !isNaN(eVal) && sVal <= 99 && eVal <= 999) {
                        season = sVal;
                        episode = eVal;
                        m = mm;
                        matchIdx = mm.index;
                        break;
                    }
                }
            }
            if (m && matchIdx >= 0) {
                title = cleaned.slice(0, matchIdx).replace(/[-_.]+$/,'').trim();
            }
            // Further cleanup title: drop trailing separators and common quality strings
            title = title
                .replace(/\b(\d{3,4}p|4k|bluray|web[- ]?dl|webrip|bdrip|hdr|dv|x264|x265|hevc|h264)\b/ig, '')
                .replace(/\s{2,}/g, ' ')
                .trim();

            const type = season && episode ? 'tv' : 'movie';
            return { title, season, episode, type };
        } catch {
            return { title: '', season: null, episode: null, type: 'movie' };
        }
    }

    // ============================================================================
    // SUBTITLE VTT CONVERSION - Convert SRT to WebVTT for Chromecast
    // ============================================================================
    app.get('/api/subtitles/vtt', async (req, res) => {
        const { url } = req.query;
        
        if (!url) {
            return res.status(400).json({ error: 'Missing url parameter' });
        }
        
        console.log(`[Subtitles/VTT] Converting: ${url.substring(0, 80)}...`);
        
        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            
            if (!response.ok) {
                return res.status(response.status).json({ error: `Failed to fetch subtitle: ${response.status}` });
            }
            
            let text = await response.text();
            
            // Check if it's already VTT
            if (/^\s*WEBVTT/i.test(text)) {
                res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
                res.setHeader('Access-Control-Allow-Origin', '*');
                return res.send(text);
            }
            
            // Convert SRT to VTT
            const vtt = srtToVtt(text);
            
            res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.send(vtt);
            
        } catch (error) {
            console.error('[Subtitles/VTT] Error:', error.message);
            res.status(500).json({ error: error.message });
        }
    });

    // Fetch subtitles list from OpenSubtitles and Wyzie
    app.get('/api/subtitles', async (req, res) => {
        try {
            const tmdbId = req.query.tmdbId; // optional when filename is provided
            let type = (req.query.type || 'movie').toLowerCase(); // 'movie' or 'tv'
            let season = req.query.season ? parseInt(req.query.season, 10) : undefined;
            let episode = req.query.episode ? parseInt(req.query.episode, 10) : undefined;
            const filename = (req.query.filename || '').toString();

            // If a torrent filename is provided, parse season/episode for TV only and extract a fallback title
            let parsed = { title: '', season: null, episode: null, type: null };
            if (filename) {
                parsed = parseReleaseFromFilename(filename);
                // Only allow filename parsing to switch to TV when current request isn't explicitly for a movie
                if (type !== 'movie' && parsed.type === 'tv') type = 'tv';
                // Only apply season/episode when we are dealing with TV
                if (type === 'tv') {
                    if (parsed.season != null) season = parsed.season;
                    if (parsed.episode != null) episode = parsed.episode;
                }
            }

            // Allow operation if either tmdbId exists OR filename provided for query-based search
            if (!tmdbId && !filename) {
                return res.status(400).json({ error: 'Missing tmdbId or filename' });
            }

            const wyzieUrl = (tmdbId ? (type === 'tv' && season && episode
                ? `https://sub.wyzie.ru/search?id=${encodeURIComponent(tmdbId)}&season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode)}`
                : `https://sub.wyzie.ru/search?id=${encodeURIComponent(tmdbId)}`) : null);

            // Build OpenSubtitles search URL
            const qs = new URLSearchParams();
            if (tmdbId) {
                qs.set('tmdb_id', tmdbId);
            }
            if (type === 'tv') {
                qs.set('type', 'episode');
                if (season) qs.set('season_number', String(season));
                if (episode) qs.set('episode_number', String(episode));
            } else {
                qs.set('type', 'movie');
            }
            // If we don't have tmdbId, start with a query-based search using parsed title
            const parsedTitle = parsed.title || '';
            if (!tmdbId && parsedTitle) {
                qs.set('query', parsedTitle);
            }
            qs.set('order_by', 'download_count');
            qs.set('order_direction', 'desc');
            qs.set('per_page', '50');
            const osUrl = `https://api.opensubtitles.com/api/v1/subtitles?${qs.toString()}`;

            // Optional title/year for fallback search
            const fallbackTitle = (req.query.title || '').toString();
            const fallbackYear = (req.query.year || '').toString();

            const headers = { 'Accept': 'application/json', 'User-Agent': APP_USER_AGENT };
            const osHeaders = { ...headers, 'Api-Key': OPEN_SUBTITLES_API_KEY };

            const promises = [];
            if (wyzieUrl) promises.push(fetch(wyzieUrl, { headers }));
            promises.push(fetch(osUrl, { headers: osHeaders }));
            const settled = await Promise.allSettled(promises);
            // Map back results
            const wyzieRes = wyzieUrl ? settled[0] : { status: 'rejected' };
            const osRes = wyzieUrl ? settled[1] : settled[0];

            const wyzieList = [];
            if (wyzieRes.status === 'fulfilled' && wyzieRes.value.ok) {
                try {
                    const json = await wyzieRes.value.json();
                    // Expecting array of items with at least url and lang or language
                    if (Array.isArray(json)) {
                        json.forEach((item, idx) => {
                            const url = item.url || item.link || item.download || null;
                            const langCode = (item.language || item.lang || item.languageCode || '').toString().toLowerCase();
                            const langName = (item.display && String(item.display).trim()) || item.languageName || isoToName(langCode);
                            // Determine extension (supported: srt, vtt)
                            let ext = (item.format || '').toString().toLowerCase();
                            if (!ext && url) {
                                const mext = url.match(/\.([a-z0-9]+)(?:\.[a-z0-9]+)?$/i);
                                if (mext) {
                                    const raw = mext[1].toLowerCase();
                                    ext = raw === 'vtt' ? 'vtt' : (raw === 'srt' ? 'srt' : ext);
                                }
                            }
                            if (url) {
                                wyzieList.push({
                                    id: `wyzie-${idx}`,
                                    source: 'wyzie',
                                    lang: langCode || 'unknown',
                                    langName,
                                    url,
                                    name: item.filename || item.name || `${langName}`,
                                    flagUrl: item.flagUrl || null,
                                    encoding: item.encoding || null,
                                    format: item.format || null,
                                    ext: ext || null
                                });
                            }
                        });
                    }
                } catch (e) {
                    // ignore
                }
            }

            const osList = [];
            const collectOsResults = (json) => {
                const arr = Array.isArray(json?.data) ? json.data : [];
                arr.forEach((entry) => {
                    const at = entry && entry.attributes ? entry.attributes : {};
                    const langCode = (at.language || at.language_code || '').toLowerCase();
                    const files = Array.isArray(at.files) ? at.files : [];
                    files.forEach((f) => {
                        const fileId = f && f.file_id;
                        let ext = null;
                        const fname = (f && f.file_name) || '';
                        const m = fname.match(/\.(srt|vtt)(?:\.[a-z0-9]+)?$/i);
                        if (m) ext = m[1].toLowerCase();
                        if (fileId) {
                            osList.push({
                                id: `os-${fileId}`,
                                source: 'opensubtitles',
                                lang: langCode || 'unknown',
                                langName: isoToName(langCode),
                                file_id: fileId,
                                name: at.release && at.release.length ? at.release : `${isoToName(langCode)}`,
                                ext
                            });
                        }
                    });
                });
            };

            if (osRes.status === 'fulfilled' && osRes.value.ok) {
                try {
                    const json = await osRes.value.json();
                    collectOsResults(json);
                    // Fallback: if nothing returned, try by title/year query (when provided)
                    const useTitle = parsedTitle || fallbackTitle;
                    if (!osList.length && (useTitle || fallbackYear)) {
                        const qs2 = new URLSearchParams();
                        if (useTitle) qs2.set('query', useTitle);
                        if (fallbackYear) qs2.set('year', fallbackYear);
                        if (type === 'tv') {
                            qs2.set('type', 'episode');
                            if (season) qs2.set('season_number', String(season));
                            if (episode) qs2.set('episode_number', String(episode));
                        } else {
                            qs2.set('type', 'movie');
                        }
                        qs2.set('order_by', 'download_count');
                        qs2.set('order_direction', 'desc');
                        qs2.set('per_page', '50');
                        const osUrl2 = `https://api.opensubtitles.com/api/v1/subtitles?${qs2.toString()}`;
                        try {
                            const osRes2 = await fetch(osUrl2, { headers: osHeaders });
                            if (osRes2.ok) {
                                const json2 = await osRes2.json();
                                collectOsResults(json2);
                            }
                        } catch {}
                    }
                } catch (e) {
                    // If OS listing throws/quota, ignore and proceed with Wyzie results
                }
            }

            // Combine and filter supported formats (we convert srt -> vtt; skip ass/ssa/others)
            // Prefer Wyzie entries first so users are less likely to hit OS quota
            const combined = [...wyzieList, ...osList];
            const supported = combined.filter(it => {
                if (it.ext) return ['srt','vtt'].includes(String(it.ext).toLowerCase());
                if (it.format) return ['srt','vtt'].includes(String(it.format).toLowerCase());
                if (it.url) {
                    const u = String(it.url).toLowerCase();
                    return u.includes('.srt') || u.includes('.vtt') || u.includes('.srt.gz');
                }
                return true; // default keep
            });
            // Return grouped by language with stable ordering
            res.json({ subtitles: supported });
        } catch (e) {
            res.status(500).json({ error: e?.message || 'Failed to fetch subtitles' });
        }
    });

    // Get installed Stremio addons
    app.get('/api/addons', async (req, res) => {
        try {
            const addonsPath = path.join(userDataPath, 'addons.json');
            if (fs.existsSync(addonsPath)) {
                const data = fs.readFileSync(addonsPath, 'utf8');
                const addons = JSON.parse(data);
                res.json(addons);
            } else {
                res.json([]);
            }
        } catch (e) {
            console.error('[API] Failed to read addons:', e);
            res.json([]);
        }
    });

    // Download subtitle to temp dir (supports OpenSubtitles and Wyzie direct URL)
    app.post('/api/subtitles/download', async (req, res) => {
        try {
            // Ensure temp subtitles directory exists before writing
            ensureSubsDir();
            const { source, fileId, url, preferredName } = req.body || {};
            if (!source) return res.status(400).json({ error: 'Missing source' });

            let downloadUrl = url || null;
            let filenameBase = preferredName || 'subtitle';

            if (source === 'opensubtitles') {
                if (!fileId) return res.status(400).json({ error: 'Missing fileId for OpenSubtitles' });
                const osResp = await fetch('https://api.opensubtitles.com/api/v1/download', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Api-Key': OPEN_SUBTITLES_API_KEY, 'User-Agent': APP_USER_AGENT },
                    body: JSON.stringify({ file_id: fileId, sub_format: 'vtt' })
                });
                if (!osResp.ok) {
                    const txt = await osResp.text();
                    // Detect OS quota/limit errors and return a structured message
                    const lower = (txt || '').toLowerCase();
                    if (osResp.status === 429 || lower.includes('allowed 5 subtitles') || lower.includes('quota')) {
                        return res.status(429).json({
                            error: 'OpenSubtitles quota reached. Using Wyzie subtitles is recommended until reset.',
                            provider: 'opensubtitles',
                            code: 'OS_QUOTA',
                            details: txt
                        });
                    }
                    return res.status(500).json({ error: `OpenSubtitles download failed: ${txt}` });
                }
                const j = await osResp.json();
                downloadUrl = j?.link || j?.url || null;
                if (j?.file_name) filenameBase = j.file_name.replace(/\.[^.]+$/, '');
                if (!downloadUrl) return res.status(500).json({ error: 'No download URL from OpenSubtitles' });
            }

            if (!downloadUrl) return res.status(400).json({ error: 'No download URL' });

            // Fetch the subtitle content
            const resp = await fetch(downloadUrl);
            if (!resp.ok) return res.status(500).json({ error: `Failed to fetch subtitle file (${resp.status})` });

            // Infer extension
            let ext = '.srt';
            const ct = resp.headers.get('content-type') || '';
            if (/webvtt|vtt/i.test(ct)) ext = '.vtt';
            else if (/ass|ssa/i.test(ct)) ext = '.ass';
            else if (/gzip/i.test(resp.headers.get('content-encoding') || '')) ext = '.srt.gz';
            const cd = resp.headers.get('content-disposition') || '';
            const m = cd.match(/filename="?([^";]+)"?/i);
            if (m && m[1]) {
                const name = m[1];
                const found = (name.match(/\.(srt|vtt|ass|ssa|gz)$/i) || [])[0];
                if (found) ext = found.startsWith('.') ? found : '.' + found;
            }

            const rand = crypto.randomBytes(8).toString('hex');
            const baseOut = path.join(SUB_TMP_DIR, `${filenameBase}-${rand}`);
            const buf = Buffer.from(await resp.arrayBuffer());

            // If gzipped, gunzip into memory first
            let contentBuf = buf;
            if (/\.gz$/i.test(ext)) {
                try { contentBuf = zlib.gunzipSync(buf); ext = ext.replace(/\.gz$/i, ''); } catch {}
            }

            // Determine if we should convert to VTT
            const text = contentBuf.toString('utf8');
            const looksLikeVtt = /^\s*WEBVTT/i.test(text);
            const looksLikeSrt = /(\d{2}:\d{2}:\d{2}),(\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}),(\d{3})/m.test(text);
            const looksLikeAss = /\[Script Info\]/i.test(text);

            let finalPath = '';
            if (looksLikeVtt || /\.vtt$/i.test(ext)) {
                finalPath = `${baseOut}.vtt`;
                try { fs.writeFileSync(finalPath, looksLikeVtt ? text : `WEBVTT\n\n${text}`); }
                catch { ensureSubsDir(); fs.writeFileSync(finalPath, looksLikeVtt ? text : `WEBVTT\n\n${text}`); }
            } else if (looksLikeSrt || /\.srt$/i.test(ext)) {
                const vtt = srtToVtt(text);
                finalPath = `${baseOut}.vtt`;
                try { fs.writeFileSync(finalPath, vtt); }
                catch { ensureSubsDir(); fs.writeFileSync(finalPath, vtt); }
            } else if (looksLikeAss || /\.(ass|ssa)$/i.test(ext)) {
                const vtt = assToVtt(text);
                finalPath = `${baseOut}.vtt`;
                try { fs.writeFileSync(finalPath, vtt); }
                catch { ensureSubsDir(); fs.writeFileSync(finalPath, vtt); }
            } else {
                // Unknown/ASS format: save as-is with original ext
                finalPath = `${baseOut}${ext.startsWith('.') ? ext : ('.' + ext)}`;
                try { fs.writeFileSync(finalPath, contentBuf); }
                catch { ensureSubsDir(); fs.writeFileSync(finalPath, contentBuf); }
            }

            const servedName = path.basename(finalPath);
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            res.json({ url: `${baseUrl}/subtitles/${encodeURIComponent(servedName)}`, filename: servedName });
        } catch (e) {
            res.status(500).json({ error: e?.message || 'Failed to download subtitle' });
        }
    });

    // Upload a user-provided subtitle file and return a served URL (converts SRT to VTT)
    app.post('/api/upload-subtitle', upload.single('subtitle'), async (req, res) => {
        try {
            // Ensure temp subtitles directory exists before writing
            ensureSubsDir();
            if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
            const original = req.file.originalname || 'subtitle.srt';
            const contentBuf = req.file.buffer;
            const text = contentBuf.toString('utf8');
            const looksLikeVtt = /^\s*WEBVTT/i.test(text);
            const looksLikeSrt = /(\d{2}:\d{2}:\d{2}),(\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}),(\d{3})/m.test(text);
            const looksLikeAss = /\[Script Info\]/i.test(text) || /\.(ass|ssa)$/i.test(original);
            const filenameBase = original.replace(/\.[^.]+$/, '') + '-' + crypto.randomBytes(6).toString('hex');

            let finalPath = '';
            if (looksLikeVtt || /\.vtt$/i.test(original)) {
                finalPath = path.join(SUB_TMP_DIR, `${filenameBase}.vtt`);
                try { fs.writeFileSync(finalPath, looksLikeVtt ? text : `WEBVTT\n\n${text}`); }
                catch { ensureSubsDir(); fs.writeFileSync(finalPath, looksLikeVtt ? text : `WEBVTT\n\n${text}`); }
            } else if (looksLikeSrt || /\.srt$/i.test(original)) {
                const vtt = srtToVtt(text);
                finalPath = path.join(SUB_TMP_DIR, `${filenameBase}.vtt`);
                try { fs.writeFileSync(finalPath, vtt); }
                catch { ensureSubsDir(); fs.writeFileSync(finalPath, vtt); }
            } else if (looksLikeAss) {
                const vtt = assToVtt(text);
                finalPath = path.join(SUB_TMP_DIR, `${filenameBase}.vtt`);
                try { fs.writeFileSync(finalPath, vtt); }
                catch { ensureSubsDir(); fs.writeFileSync(finalPath, vtt); }
            } else {
                // Keep as-is for other formats
                const ext = path.extname(original) || '.txt';
                finalPath = path.join(SUB_TMP_DIR, `${filenameBase}${ext}`);
                try { fs.writeFileSync(finalPath, contentBuf); }
                catch { ensureSubsDir(); fs.writeFileSync(finalPath, contentBuf); }
            }

            const servedName = path.basename(finalPath);
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            res.json({ url: `${baseUrl}/subtitles/${encodeURIComponent(servedName)}`, filename: servedName });
        } catch (e) {
            res.status(500).json({ error: e?.message || 'Failed to upload subtitle' });
        }
    });

    // Cleanup all temporary subtitles
    app.post('/api/subtitles/cleanup', async (req, res) => {
        try {
            if (fs.existsSync(SUB_TMP_DIR)) {
                for (const f of fs.readdirSync(SUB_TMP_DIR)) {
                    try { fs.unlinkSync(path.join(SUB_TMP_DIR, f)); } catch {}
                }
            }
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ success: false, error: e?.message || 'Failed to cleanup subtitles' });
        }
    });

    // Delete a specific subtitle file
    app.post('/api/subtitles/delete', (req, res) => {
        try {
            const { filename } = req.body || {};
            if (!filename) return res.status(400).json({ success: false, error: 'Missing filename' });
            const target = path.join(SUB_TMP_DIR, filename);
            // Ensure within temp dir
            if (!target.startsWith(SUB_TMP_DIR)) return res.status(400).json({ success: false, error: 'Invalid path' });
            if (fs.existsSync(target)) fs.unlinkSync(target);
            return res.json({ success: true });
        } catch (e) {
            res.status(500).json({ success: false, error: e?.message || 'Failed to delete subtitle' });
        }
    });

    // ===== MUSIC DOWNLOAD ENDPOINT =====
    
    // Store download progress and processes in memory
    const downloadProgress = new Map();
    const downloadProcesses = new Map(); // downloadId -> { proc, outputPath }
    
    app.post('/api/music/download', async (req, res) => {
        try {
            const { trackUrl, songName, artistName, downloadId } = req.body;
            
            console.log('\n[Music Download] Starting download...');
            console.log(`[Music Download] Song: "${songName}" by ${artistName}`);
            console.log(`[Music Download] Track URL: ${trackUrl}`);
            console.log(`[Music Download] Download ID: ${downloadId}`);
            
            if (!trackUrl || !songName || !artistName) {
                return res.status(400).json({ success: false, error: 'Missing required fields' });
            }

            // Create download directory in app data
            const downloadDir = path.join(userDataPath, 'Music Downloads');
            if (!fs.existsSync(downloadDir)) {
                fs.mkdirSync(downloadDir, { recursive: true });
                console.log(`[Music Download] Created download directory: ${downloadDir}`);
            }

            // Sanitize filename
            const sanitize = (str) => str.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim();
            const filename = `${sanitize(songName)} - ${sanitize(artistName)}.flac`;
            const outputPath = path.join(downloadDir, filename);

            console.log(`[Music Download] Output path: ${outputPath}`);

            // Check if file already exists
            if (fs.existsSync(outputPath)) {
                console.log('[Music Download] File already exists, skipping download');
                return res.json({ 
                    success: true, 
                    message: 'File already exists',
                    filePath: outputPath 
                });
            }

            // Start ffmpeg process
            // Resolve ffmpeg binary path (handle asar packaging)
            let resolvedFfmpegPath = ffmpegPath || 'ffmpeg';
            let useFfmpeg = true;
            try {
                if (resolvedFfmpegPath && resolvedFfmpegPath.includes('app.asar')) {
                    resolvedFfmpegPath = resolvedFfmpegPath.replace('app.asar', 'app.asar.unpacked');
                }
                // If path doesn't exist (packaged quirks), fall back to PATH lookup
                if (resolvedFfmpegPath && resolvedFfmpegPath !== 'ffmpeg') {
                    if (!fs.existsSync(resolvedFfmpegPath)) {
                        console.warn(`[Music Download] ffmpeg binary not found at ${resolvedFfmpegPath}. Falling back to PATH executable.`);
                        resolvedFfmpegPath = 'ffmpeg';
                    } else {
                        // Check if executable (Linux AppImage permission issue)
                        try {
                            fs.accessSync(resolvedFfmpegPath, fs.constants.X_OK);
                        } catch (permErr) {
                            console.warn(`[Music Download] ffmpeg binary not executable at ${resolvedFfmpegPath}. Attempting to set permissions...`);
                            try {
                                fs.chmodSync(resolvedFfmpegPath, 0o755);
                                console.log('[Music Download] Successfully set executable permission');
                            } catch (chmodErr) {
                                console.warn('[Music Download] Failed to set executable permission, falling back to PATH');
                                resolvedFfmpegPath = 'ffmpeg';
                            }
                        }
                    }
                }
            } catch (_) {}

            console.log('[Music Download] Starting FFmpeg process using:', resolvedFfmpegPath);
            const ffmpeg = spawn(resolvedFfmpegPath, [
                '-i', trackUrl,
                '-vn',
                '-ar', '44100',
                '-ac', '2',
                '-c:a', 'flac',
                '-y', // Overwrite output file if exists
                outputPath
            ]);

            let currentProgress = 0;
            let duration = 0;

            // Initialize progress tracking
            if (downloadId) {
                downloadProgress.set(downloadId, { 
                    progress: 0, 
                    complete: false,
                    filePath: outputPath 
                });
                downloadProcesses.set(downloadId, { proc: ffmpeg, outputPath });
            }

            // Parse ffmpeg output for progress
            ffmpeg.stderr.on('data', (data) => {
                const output = data.toString();
                
                // Extract duration
                const durationMatch = output.match(/Duration: (\d{2}):(\d{2}):(\d{2}.\d{2})/);
                if (durationMatch) {
                    const hours = parseInt(durationMatch[1]);
                    const minutes = parseInt(durationMatch[2]);
                    const seconds = parseFloat(durationMatch[3]);
                    duration = hours * 3600 + minutes * 60 + seconds;
                    console.log(`[Music Download] Duration detected: ${durationMatch[0]}`);
                }

                // Extract current time for progress
                const timeMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2}.\d{2})/);
                if (timeMatch && duration > 0) {
                    const hours = parseInt(timeMatch[1]);
                    const minutes = parseInt(timeMatch[2]);
                    const seconds = parseFloat(timeMatch[3]);
                    const currentTime = hours * 3600 + minutes * 60 + seconds;
                    const newProgress = Math.min(100, Math.round((currentTime / duration) * 100));
                    
                    // Update progress map
                    if (downloadId && downloadProgress.has(downloadId)) {
                        downloadProgress.get(downloadId).progress = newProgress;
                    }
                    
                    // Only log every 10% change
                    if (newProgress >= currentProgress + 10 || newProgress === 100) {
                        console.log(`[Music Download] Progress: ${newProgress}%`);
                        currentProgress = newProgress;
                    }
                }
            });

            ffmpeg.on('close', async (code, signal) => {
                // Remove process reference
                if (downloadId) downloadProcesses.delete(downloadId);
                if (code === 0) {
                    console.log('[Music Download] ✓ Download complete!');
                    console.log(`[Music Download] Saved to: ${outputPath}\n`);
                    
                    // Mark as complete
                    if (downloadId && downloadProgress.has(downloadId)) {
                        downloadProgress.get(downloadId).complete = true;
                        downloadProgress.get(downloadId).progress = 100;
                    }
                    
                    if (!res.headersSent) {
                        res.json({ 
                            success: true, 
                            message: 'Download complete',
                            filePath: outputPath 
                        });
                    }
                    
                    // Clean up progress after 5 seconds
                    setTimeout(() => {
                        if (downloadId) downloadProgress.delete(downloadId);
                    }, 5000);
                } else {
                    const exitInfo = code !== null ? `code ${code}` : signal ? `signal ${signal}` : 'unknown reason';
                    console.error(`[Music Download] ✗ FFmpeg exited with ${exitInfo}`);
                    
                    // If FFmpeg failed (especially with null code/signal on Linux), try direct download
                    if (code === null || signal) {
                        console.log('[Music Download] Attempting direct download fallback (no conversion)...');
                        try {
                            // Determine extension from URL
                            const urlLower = trackUrl.toLowerCase();
                            let directExt = 'flac';
                            if (urlLower.includes('.mp3')) directExt = 'mp3';
                            else if (urlLower.includes('.m4a')) directExt = 'm4a';
                            else if (urlLower.includes('.aac')) directExt = 'aac';
                            else if (urlLower.includes('.ogg')) directExt = 'ogg';
                            
                            const directFilename = `${sanitize(songName)} - ${sanitize(artistName)}.${directExt}`;
                            const directOutputPath = path.join(downloadDir, directFilename);
                            
                            // Download directly using fetch/stream
                            const https = await import('https');
                            const http = await import('http');
                            const protocol = trackUrl.startsWith('https') ? https : http;
                            
                            await new Promise((resolve, reject) => {
                                const file = fs.createWriteStream(directOutputPath);
                                protocol.get(trackUrl, (response) => {
                                    if (response.statusCode !== 200) {
                                        reject(new Error(`HTTP ${response.statusCode}`));
                                        return;
                                    }
                                    response.pipe(file);
                                    file.on('finish', () => {
                                        file.close();
                                        resolve();
                                    });
                                }).on('error', (err) => {
                                    fs.unlinkSync(directOutputPath);
                                    reject(err);
                                });
                            });
                            
                            console.log('[Music Download] ✓ Direct download complete (fallback)!');
                            console.log(`[Music Download] Saved to: ${directOutputPath}\n`);
                            
                            if (downloadId && downloadProgress.has(downloadId)) {
                                downloadProgress.get(downloadId).complete = true;
                                downloadProgress.get(downloadId).progress = 100;
                                downloadProgress.get(downloadId).filePath = directOutputPath;
                            }
                            
                            if (!res.headersSent) {
                                res.json({ 
                                    success: true, 
                                    message: 'Download complete (direct)',
                                    filePath: directOutputPath 
                                });
                            }
                            
                            setTimeout(() => {
                                if (downloadId) downloadProgress.delete(downloadId);
                            }, 5000);
                            return;
                        } catch (fallbackErr) {
                            console.error('[Music Download] ✗ Direct download fallback also failed:', fallbackErr.message);
                        }
                    }
                    
                    // Clean up partial file
                    if (fs.existsSync(outputPath)) {
                        try { 
                            fs.unlinkSync(outputPath); 
                            console.log('[Music Download] Deleted partial file');
                        } catch(_) {}
                    }
                    
                    if (downloadId) downloadProgress.delete(downloadId);
                    
                    if (!res.headersSent) {
                        res.status(500).json({ 
                            success: false, 
                            error: `FFmpeg failed: ${exitInfo}` 
                        });
                    }
                }
            });

            ffmpeg.on('error', (err) => {
                if (downloadId) downloadProcesses.delete(downloadId);
                console.error('[Music Download] ✗ FFmpeg error:', err);
                // Clean up partial file
                if (fs.existsSync(outputPath)) {
                    try { 
                        fs.unlinkSync(outputPath); 
                        console.log('[Music Download] Deleted partial file');
                    } catch(_) {}
                }
                
                if (downloadId) downloadProgress.delete(downloadId);
                
                if (!res.headersSent) {
                    res.status(500).json({ 
                        success: false, 
                        error: 'Failed to start download: ' + err.message 
                    });
                }
            });

        } catch (error) {
            console.error('[Music Download] Error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get download progress
    app.get('/api/music/download/progress/:downloadId', (req, res) => {
        const { downloadId } = req.params;
        const progress = downloadProgress.get(downloadId);
        if (progress) {
            res.json(progress);
        } else {
            res.json({ progress: 0, complete: false });
        }
    });

    // Cancel a music download
    app.post('/api/music/download/cancel', (req, res) => {
        try {
            const { downloadId } = req.body || {};
            if (!downloadId) return res.status(400).json({ success: false, error: 'Missing downloadId' });
            const procEntry = downloadProcesses.get(downloadId);
            const progEntry = downloadProgress.get(downloadId);
            if (!procEntry && !progEntry) {
                return res.status(404).json({ success: false, error: 'Download not found' });
            }
            // Kill ffmpeg process if exists
            if (procEntry && procEntry.proc && !procEntry.proc.killed) {
                try {
                    procEntry.proc.kill('SIGKILL');
                } catch (_) {
                    try { procEntry.proc.kill(); } catch (_) {}
                }
            }
            // Delete partial file if exists
            const outputPath = (procEntry && procEntry.outputPath) || (progEntry && progEntry.filePath);
            if (outputPath && fs.existsSync(outputPath)) {
                try { fs.unlinkSync(outputPath); } catch (_) {}
            }
            downloadProcesses.delete(downloadId);
            downloadProgress.delete(downloadId);
            console.log(`[Music Download] ✗ Cancelled download ${downloadId} and cleaned up`);
            return res.json({ success: true });
        } catch (error) {
            console.error('[Music Download] Cancel error:', error);
            return res.status(500).json({ success: false, error: error.message });
        }
    });

    // Serve downloaded music files
    app.get('/api/music/serve/:filePath(*)', (req, res) => {
        try {
            const filePath = decodeURIComponent(req.params.filePath);
            console.log(`[Music Serve] Request to serve: ${filePath}`);
            
            const downloadDir = path.join(userDataPath, 'Music Downloads');
            // Ensure the path is within our download directory
            if (!filePath.startsWith(downloadDir)) {
                console.log('[Music Serve] ✗ Invalid path - outside download directory');
                return res.status(400).json({ error: 'Invalid path' });
            }
            
            if (!fs.existsSync(filePath)) {
                console.log('[Music Serve] ✗ File not found');
                return res.status(404).json({ error: 'File not found' });
            }
            
            console.log('[Music Serve] ✓ Serving file');
            res.setHeader('Content-Type', 'audio/flac');
            res.setHeader('Accept-Ranges', 'bytes');
            
            const stat = fs.statSync(filePath);
            const fileSize = stat.size;
            const range = req.headers.range;
            
            if (range) {
                const parts = range.replace(/bytes=/, "").split("-");
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                const chunksize = (end - start) + 1;
                const file = fs.createReadStream(filePath, { start, end });
                
                res.writeHead(206, {
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Content-Length': chunksize
                });
                file.pipe(res);
            } else {
                res.writeHead(200, { 'Content-Length': fileSize });
                fs.createReadStream(filePath).pipe(res);
            }
        } catch (error) {
            console.error('[Music Serve] ✗ Error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Delete downloaded music file
    app.post('/api/music/delete', (req, res) => {
        try {
            const { filePath } = req.body;
            console.log(`[Music Delete] Request to delete: ${filePath}`);
            
            if (!filePath) return res.status(400).json({ success: false, error: 'Missing filePath' });
            
            const downloadDir = path.join(userDataPath, 'Music Downloads');
            // Ensure the path is within our download directory
            if (!filePath.startsWith(downloadDir)) {
                console.log('[Music Delete] ✗ Invalid path - outside download directory');
                return res.status(400).json({ success: false, error: 'Invalid path' });
            }
            
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log('[Music Delete] ✓ File deleted successfully');
                return res.json({ success: true });
            } else {
                console.log('[Music Delete] ✗ File not found');
                return res.status(404).json({ success: false, error: 'File not found' });
            }
        } catch (error) {
            console.error('[Music Delete] ✗ Error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Batch check for existence of downloaded music files
    app.post('/api/music/exists-batch', (req, res) => {
        try {
            const { filePaths } = req.body || {};
            if (!Array.isArray(filePaths)) {
                return res.status(400).json({ success: false, error: 'filePaths must be an array' });
            }

            const downloadDir = path.join(userDataPath, 'Music Downloads');
            const normDownloadDir = path.normalize(downloadDir);

            const results = {};
            for (const fp of filePaths) {
                try {
                    if (!fp || typeof fp !== 'string') { results[String(fp)] = false; continue; }
                    const norm = path.normalize(fp);
                    // Security: ensure within downloads directory
                    if (!norm.startsWith(normDownloadDir)) { results[fp] = false; continue; }
                    results[fp] = fs.existsSync(norm);
                } catch (_) {
                    results[String(fp)] = false;
                }
            }
            return res.json({ success: true, results });
        } catch (error) {
            console.error('[Music Exists Batch] ✗ Error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ============================================================================
    // GAME DOWNLOAD MANAGER - Download games with TorBox or direct download
    // ============================================================================
    
    const GAME_DOWNLOADS_PATH = path.join(userDataPath, 'game_downloads.json');
    const activeGameDownloads = new Map(); // Track active download streams
    
    // Get user's Downloads folder cross-platform
    function getDownloadsFolder() {
        const homeDir = os.homedir();
        return path.join(homeDir, 'Downloads', 'PlayTorrio Games');
    }
    
    // Ensure downloads folder exists
    function ensureDownloadsFolder() {
        const folder = getDownloadsFolder();
        if (!fs.existsSync(folder)) {
            fs.mkdirSync(folder, { recursive: true });
        }
        return folder;
    }
    
    // Load game downloads from disk
    function loadGameDownloads() {
        try {
            if (fs.existsSync(GAME_DOWNLOADS_PATH)) {
                return JSON.parse(fs.readFileSync(GAME_DOWNLOADS_PATH, 'utf8'));
            }
        } catch (e) {
            console.error('[GameDownloads] Error loading:', e.message);
        }
        return { downloads: [] };
    }
    
    // Save game downloads to disk
    function saveGameDownloads(data) {
        try {
            fs.writeFileSync(GAME_DOWNLOADS_PATH, JSON.stringify(data, null, 2));
        } catch (e) {
            console.error('[GameDownloads] Error saving:', e.message);
        }
    }
    
    // Generate unique download ID
    function generateDownloadId() {
        return `dl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    // Get file name from URL
    function getFileNameFromUrl(url, gameName) {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const fileName = pathname.split('/').pop();
            if (fileName && fileName.length > 3 && fileName.includes('.')) {
                return decodeURIComponent(fileName);
            }
        } catch (e) {}
        // Fallback to game name
        const safeName = (gameName || 'game').replace(/[^a-zA-Z0-9\s\-_.]/g, '').trim();
        return `${safeName}.zip`;
    }
    
    // Get library (all downloads)
    app.get('/api/game-downloads/library', (req, res) => {
        try {
            const data = loadGameDownloads();
            res.json({ success: true, downloads: data.downloads || [] });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    
    // Add game to library and start download
    app.post('/api/game-downloads/add', async (req, res) => {
        try {
            const { url, gameName, gameImage, gameSize, provider } = req.body;
            if (!url) return res.status(400).json({ error: 'URL is required' });
            
            const settings = readSettings();
            const hasTorBox = !!settings.tbApiKey;
            
            const downloadId = generateDownloadId();
            const fileName = getFileNameFromUrl(url, gameName);
            const downloadsFolder = ensureDownloadsFolder();
            const filePath = path.join(downloadsFolder, fileName);
            
            const downloadEntry = {
                id: downloadId,
                url: url,
                gameName: gameName || 'Unknown Game',
                gameImage: gameImage || null,
                gameSize: gameSize || null,
                provider: provider || 'direct',
                fileName: fileName,
                filePath: filePath,
                status: 'pending', // pending, downloading, paused, completed, error
                progress: 0,
                downloadedBytes: 0,
                totalBytes: 0,
                speed: 0,
                useTorBox: hasTorBox,
                torboxId: null,
                torboxDownloadUrl: null,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                error: null
            };
            
            // Save to library
            const data = loadGameDownloads();
            data.downloads.push(downloadEntry);
            saveGameDownloads(data);
            
            // Start download in background
            startGameDownload(downloadId);
            
            res.json({ success: true, download: downloadEntry });
        } catch (e) {
            console.error('[GameDownloads] Add error:', e);
            res.status(500).json({ error: e.message });
        }
    });
    
    // File hosts that require debrid service (can't be downloaded directly)
    const DEBRID_REQUIRED_HOSTS = [
        'megadb.net', 'mega.nz', 'mega.co.nz',
        '1fichier.com', 'gofile.io', 'buzzheavier.com',
        'pixeldrain.com', 'mediafire.com', 'rapidgator.net',
        'uploaded.net', 'turbobit.net', 'nitroflare.com',
        'katfile.com', 'filefactory.com'
    ];
    
    function requiresDebrid(url) {
        try {
            const hostname = new URL(url).hostname.toLowerCase();
            return DEBRID_REQUIRED_HOSTS.some(h => hostname.includes(h));
        } catch {
            return false;
        }
    }
    
    // Start/resume download
    async function startGameDownload(downloadId) {
        const data = loadGameDownloads();
        const download = data.downloads.find(d => d.id === downloadId);
        if (!download) return;
        
        try {
            download.status = 'downloading';
            download.updatedAt = Date.now();
            saveGameDownloads(data);
            
            let downloadUrl = download.url;
            const needsDebrid = requiresDebrid(download.url);
            
            // If TorBox is enabled, use it to get premium link
            if (download.useTorBox) {
                const settings = readSettings();
                if (settings.tbApiKey) {
                    try {
                        console.log(`[GameDownloads] Using TorBox for: ${download.gameName}`);
                        
                        // Create web download on TorBox
                        const createResp = await fetch('https://api.torbox.app/v1/api/webdl/createwebdownload', {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${settings.tbApiKey}`,
                                'Content-Type': 'application/x-www-form-urlencoded'
                            },
                            body: new URLSearchParams({ link: download.url }).toString()
                        });
                        
                        const createData = await createResp.json();
                        console.log(`[GameDownloads] TorBox create response:`, JSON.stringify(createData));
                        
                        if (createData.success && createData.data?.webdownload_id) {
                            download.torboxId = createData.data.webdownload_id;
                            saveGameDownloads(data);
                            
                            // Poll for completion
                            let attempts = 0;
                            const maxAttempts = 180; // 15 minutes max
                            let lastState = '';
                            
                            while (attempts < maxAttempts) {
                                await new Promise(r => setTimeout(r, 3000)); // Wait 3 seconds
                                
                                // Reload data in case it was modified
                                const freshData = loadGameDownloads();
                                const freshDownload = freshData.downloads.find(d => d.id === downloadId);
                                if (!freshDownload || freshDownload.status === 'paused') {
                                    console.log(`[GameDownloads] Download paused or removed, stopping TorBox poll`);
                                    return;
                                }
                                
                                const statusResp = await fetch(`https://api.torbox.app/v1/api/webdl/mylist`, {
                                    headers: { 'Authorization': `Bearer ${settings.tbApiKey}` }
                                });
                                const statusData = await statusResp.json();
                                
                                if (statusData.success && Array.isArray(statusData.data)) {
                                    const item = statusData.data.find(i => String(i.id) === String(download.torboxId));
                                    if (item) {
                                        if (lastState !== item.download_state) {
                                            console.log(`[GameDownloads] TorBox state: ${item.download_state} (${item.progress || 0}%)`);
                                            lastState = item.download_state;
                                        }
                                        
                                        if (item.download_state === 'cached' || item.download_state === 'completed' || item.download_state === 'downloading') {
                                            // Try to get direct download link
                                            const dlResp = await fetch(`https://api.torbox.app/v1/api/webdl/requestdl?token=${settings.tbApiKey}&web_id=${download.torboxId}&zip_link=false`);
                                            const dlData = await dlResp.json();
                                            console.log(`[GameDownloads] TorBox requestdl response:`, JSON.stringify(dlData));
                                            
                                            if (dlData.success && dlData.data) {
                                                downloadUrl = dlData.data;
                                                download.torboxDownloadUrl = downloadUrl;
                                                console.log(`[GameDownloads] Got TorBox download URL: ${downloadUrl.substring(0, 80)}...`);
                                                saveGameDownloads(data);
                                                break;
                                            }
                                        } else if (item.download_state === 'error' || item.download_state === 'failed') {
                                            throw new Error(`TorBox download failed: ${item.error || 'Unknown error'}`);
                                        }
                                        
                                        // Update progress from TorBox
                                        download.progress = Math.round(item.progress || 0);
                                        download.updatedAt = Date.now();
                                        saveGameDownloads(data);
                                    }
                                }
                                attempts++;
                            }
                            
                            if (attempts >= maxAttempts && !download.torboxDownloadUrl) {
                                throw new Error('TorBox download timed out');
                            }
                        } else {
                            throw new Error(createData.detail || createData.error || 'Failed to create TorBox download');
                        }
                    } catch (tbError) {
                        console.error('[GameDownloads] TorBox error:', tbError.message);
                        
                        // If this host requires debrid, we can't download directly
                        if (needsDebrid) {
                            download.status = 'error';
                            download.error = `TorBox failed: ${tbError.message}. This file host requires a debrid service.`;
                            download.updatedAt = Date.now();
                            saveGameDownloads(data);
                            return;
                        }
                        
                        // Fall back to direct download
                        console.warn('[GameDownloads] Falling back to direct download');
                        download.useTorBox = false;
                        downloadUrl = download.url;
                    }
                }
            } else if (needsDebrid) {
                // No TorBox but host requires debrid
                download.status = 'error';
                download.error = 'This file host requires TorBox or another debrid service. Please login to TorBox in settings.';
                download.updatedAt = Date.now();
                saveGameDownloads(data);
                return;
            }
            
            // Direct download
            console.log(`[GameDownloads] Starting download from: ${downloadUrl.substring(0, 80)}...`);
            
            const controller = new AbortController();
            activeGameDownloads.set(downloadId, { controller, paused: false });
            
            // Check if we can resume
            let startByte = 0;
            if (fs.existsSync(download.filePath)) {
                const stats = fs.statSync(download.filePath);
                startByte = stats.size;
                download.downloadedBytes = startByte;
            }
            
            const headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Encoding': 'gzip, deflate, br'
            };
            
            if (startByte > 0) {
                headers['Range'] = `bytes=${startByte}-`;
            }
            
            const response = await fetch(downloadUrl, {
                headers,
                signal: controller.signal,
                redirect: 'follow'
            });
            
            // Check if we got HTML instead of a file (common with file hosts)
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('text/html')) {
                throw new Error('File host returned HTML page instead of file. This host requires TorBox.');
            }
            
            if (!response.ok && response.status !== 206) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const contentLength = response.headers.get('content-length');
            const contentRange = response.headers.get('content-range');
            
            if (contentRange) {
                const match = contentRange.match(/\/(\d+)/);
                if (match) download.totalBytes = parseInt(match[1]);
            } else if (contentLength) {
                download.totalBytes = startByte + parseInt(contentLength);
            }
            
            // Create write stream (append if resuming)
            const writeStream = fs.createWriteStream(download.filePath, { flags: startByte > 0 ? 'a' : 'w' });
            
            let lastUpdate = Date.now();
            let lastBytes = download.downloadedBytes;
            
            response.body.on('data', (chunk) => {
                const active = activeGameDownloads.get(downloadId);
                if (!active || active.paused) {
                    response.body.destroy();
                    writeStream.end();
                    return;
                }
                
                download.downloadedBytes += chunk.length;
                
                // Calculate speed every second
                const now = Date.now();
                if (now - lastUpdate >= 1000) {
                    const bytesPerSec = (download.downloadedBytes - lastBytes) / ((now - lastUpdate) / 1000);
                    download.speed = bytesPerSec;
                    lastBytes = download.downloadedBytes;
                    lastUpdate = now;
                }
                
                if (download.totalBytes > 0) {
                    download.progress = Math.round((download.downloadedBytes / download.totalBytes) * 100);
                }
                
                download.updatedAt = Date.now();
                saveGameDownloads(data);
            });
            
            await new Promise((resolve, reject) => {
                response.body.pipe(writeStream);
                writeStream.on('finish', resolve);
                writeStream.on('error', reject);
                response.body.on('error', reject);
            });
            
            // Verify download completed properly
            const active = activeGameDownloads.get(downloadId);
            if (active && !active.paused) {
                // Check if we got a reasonable file size
                const finalSize = fs.existsSync(download.filePath) ? fs.statSync(download.filePath).size : 0;
                
                // If totalBytes is known and we didn't get it all, mark as error
                if (download.totalBytes > 0 && finalSize < download.totalBytes * 0.99) {
                    download.status = 'error';
                    download.error = `Incomplete download: got ${(finalSize/1024/1024).toFixed(1)}MB of ${(download.totalBytes/1024/1024).toFixed(1)}MB`;
                    download.progress = Math.round((finalSize / download.totalBytes) * 100);
                }
                // If file is suspiciously small (< 100KB), likely an error page
                else if (finalSize < 100 * 1024 && !download.gameSize?.includes('KB')) {
                    download.status = 'error';
                    download.error = `Download failed: received only ${(finalSize/1024).toFixed(1)}KB. This host may require TorBox.`;
                    download.progress = 0;
                } else {
                    download.status = 'completed';
                    download.progress = 100;
                    download.downloadedBytes = finalSize;
                    console.log(`[GameDownloads] Completed: ${download.gameName} (${(finalSize/1024/1024).toFixed(1)}MB)`);
                }
                download.speed = 0;
            }
            
            download.updatedAt = Date.now();
            saveGameDownloads(data);
            activeGameDownloads.delete(downloadId);
            
        } catch (e) {
            if (e.name === 'AbortError') {
                // Paused or cancelled
                download.status = 'paused';
            } else {
                console.error(`[GameDownloads] Error downloading ${download.gameName}:`, e.message);
                download.status = 'error';
                download.error = e.message;
            }
            download.speed = 0;
            download.updatedAt = Date.now();
            saveGameDownloads(data);
            activeGameDownloads.delete(downloadId);
        }
    }
    
    // Resume download
    app.post('/api/game-downloads/resume/:id', (req, res) => {
        try {
            const { id } = req.params;
            const data = loadGameDownloads();
            const download = data.downloads.find(d => d.id === id);
            
            if (!download) {
                return res.status(404).json({ error: 'Download not found' });
            }
            
            if (download.status === 'completed') {
                return res.json({ success: true, message: 'Already completed' });
            }
            
            // Start download in background
            startGameDownload(id);
            
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    
    // Pause download
    app.post('/api/game-downloads/pause/:id', (req, res) => {
        try {
            const { id } = req.params;
            const active = activeGameDownloads.get(id);
            
            if (active) {
                active.paused = true;
                active.controller.abort();
            }
            
            const data = loadGameDownloads();
            const download = data.downloads.find(d => d.id === id);
            if (download) {
                download.status = 'paused';
                download.speed = 0;
                download.updatedAt = Date.now();
                saveGameDownloads(data);
            }
            
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    
    // Remove download from library
    app.delete('/api/game-downloads/:id', (req, res) => {
        try {
            const { id } = req.params;
            const { deleteFile } = req.query;
            
            console.log(`[GameDownloads] Removing download: ${id}, deleteFile: ${deleteFile}`);
            
            // Stop if active - force abort
            const active = activeGameDownloads.get(id);
            if (active) {
                try {
                    active.controller.abort();
                } catch (e) {
                    console.warn('[GameDownloads] Error aborting download:', e.message);
                }
                activeGameDownloads.delete(id);
            }
            
            // Load current data
            const data = loadGameDownloads();
            const download = data.downloads.find(d => d.id === id);
            
            // Delete file if requested
            if (download && deleteFile === 'true' && download.filePath) {
                try {
                    if (fs.existsSync(download.filePath)) {
                        fs.unlinkSync(download.filePath);
                        console.log(`[GameDownloads] Deleted file: ${download.filePath}`);
                    }
                } catch (e) {
                    console.warn('[GameDownloads] Could not delete file:', e.message);
                }
            }
            
            // Remove from list
            const originalLength = data.downloads.length;
            data.downloads = data.downloads.filter(d => d.id !== id);
            
            // Save immediately
            saveGameDownloads(data);
            
            console.log(`[GameDownloads] Removed ${id}. Downloads: ${originalLength} -> ${data.downloads.length}`);
            
            res.json({ success: true, removed: originalLength !== data.downloads.length });
        } catch (e) {
            console.error('[GameDownloads] Delete error:', e);
            res.status(500).json({ error: e.message });
        }
    });
    
    // Get download status
    app.get('/api/game-downloads/status/:id', (req, res) => {
        try {
            const { id } = req.params;
            const data = loadGameDownloads();
            const download = data.downloads.find(d => d.id === id);
            
            if (!download) {
                return res.status(404).json({ error: 'Download not found' });
            }
            
            res.json({ success: true, download });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    
    // Open downloads folder
    app.get('/api/game-downloads/open-folder', (req, res) => {
        try {
            const folder = ensureDownloadsFolder();
            res.json({ success: true, folder });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    
    // Check TorBox status
    app.get('/api/game-downloads/torbox-status', (req, res) => {
        try {
            const settings = readSettings();
            res.json({ 
                success: true, 
                hasTorBox: !!settings.tbApiKey,
                provider: settings.tbApiKey ? 'torbox' : 'direct'
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    
    // Resume incomplete downloads on startup
    setTimeout(() => {
        try {
            const data = loadGameDownloads();
            const incomplete = data.downloads.filter(d => d.status === 'downloading');
            incomplete.forEach(d => {
                d.status = 'paused'; // Mark as paused so user can resume
                d.speed = 0;
            });
            if (incomplete.length > 0) {
                saveGameDownloads(data);
                console.log(`[GameDownloads] ${incomplete.length} incomplete downloads marked as paused`);
            }
        } catch (e) {}
    }, 2000);

    // ============================================================================
    // PLAYTORRIOPLAYER - Launch external player with IPC bridge (All platforms)
    // ============================================================================
    app.post('/api/playtorrioplayer', async (req, res) => {
        try {
            const { url, tmdbId, imdbId, seasonNum, episodeNum, mediaType = 'movie', stopOnClose = true } = req.body;
            if (!url) {
                return res.status(400).json({ error: 'Missing url parameter' });
            }
            
            const { spawn } = await import('child_process');
            const path = await import('path');
            const fs = await import('fs');
            const { fileURLToPath } = await import('url');
            
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = path.dirname(__filename);
            
            // Path to PlayTorrioPlayer - check multiple locations for dev and built app
            // In built app, extraResources are in process.resourcesPath
            const possiblePlayerDirs = [
                path.join(__dirname, 'PlayTorrioPlayer'),  // Dev mode
                path.join(process.resourcesPath || __dirname, 'PlayTorrioPlayer'),  // Built app (extraResources)
                path.join(__dirname, '..', 'PlayTorrioPlayer'),  // Alternative location
            ];
            
            let playerDir = null;
            for (const dir of possiblePlayerDirs) {
                if (fs.existsSync(dir)) {
                    playerDir = dir;
                    break;
                }
            }
            
            if (!playerDir) {
                console.error('[PlayTorrioPlayer] Player directory not found in any location');
                return res.status(404).json({ 
                    error: 'PlayTorrioPlayer directory not found',
                    searchedPaths: possiblePlayerDirs
                });
            }
            
            let playerExe = null;
            
            // Find the player executable based on platform
            if (process.platform === 'win32') {
                // Windows: Check for both PlayTorrio.exe and PlayTorrioPlayer.exe
                // Check multiple possible locations
                const possiblePaths = [
                    path.join(playerDir, 'PlayTorrio.exe'),  // V2 name
                    path.join(playerDir, 'PlayTorrioPlayer.exe'),  // V1 name
                    path.join(playerDir, 'PlayTorrio-Windows-x64', 'PlayTorrio.exe'),  // Nested V2
                    path.join(playerDir, 'PlayTorrio-Windows-x64', 'PlayTorrioPlayer.exe'),  // Nested V1
                ];
                
                for (const p of possiblePaths) {
                    if (fs.existsSync(p)) {
                        playerExe = p;
                        console.log(`[PlayTorrioPlayer] Found Windows exe at: ${p}`);
                        break;
                    }
                }
            } else if (process.platform === 'darwin') {
                // macOS: Check multiple possible locations
                const possiblePaths = [
                    path.join(playerDir, 'NipaPlay.app', 'Contents', 'MacOS', 'NipaPlay'),  // V2 name
                    path.join(playerDir, 'PlayTorrioPlayer.app', 'Contents', 'MacOS', 'PlayTorrioPlayer'),  // V1 name (root)
                    path.join(playerDir, 'PlayTorrio-macOS-Universal', 'NipaPlay.app', 'Contents', 'MacOS', 'NipaPlay'),  // V2 nested
                    path.join(playerDir, 'PlayTorrio-macOS-Universal', 'PlayTorrioPlayer.app', 'Contents', 'MacOS', 'PlayTorrioPlayer'),  // V1 nested
                    path.join(playerDir, 'PlayTorrioPlayer'),  // Direct binary
                    path.join(playerDir, 'NipaPlay'),  // Direct binary V2
                    path.join(playerDir, 'bin', 'PlayTorrioPlayer'),  // bin folder
                    path.join(playerDir, 'bin', 'NipaPlay'),  // bin folder V2
                ];
                
                for (const p of possiblePaths) {
                    if (fs.existsSync(p)) {
                        playerExe = p;
                        console.log(`[PlayTorrioPlayer] Found macOS binary at: ${p}`);
                        break;
                    }
                }
            } else {
                // Linux: Check for AppImage or extracted binary in bundle folder
                const possiblePaths = [
                    // Specific AppImage names from v1.8.44+ release (NipaPlay) and older versions
                    path.join(playerDir, 'NipaPlay-1.8.44-Linux-amd64.AppImage'),  // v1.8.44+
                    path.join(playerDir, 'PlayTorrio-Linux-x64.AppImage'),  // Older versions
                    // AppImage in root (glob pattern - find any AppImage)
                    ...(() => {
                        try {
                            const files = fs.readdirSync(playerDir);
                            return files
                                .filter(f => f.endsWith('.AppImage'))
                                .map(f => path.join(playerDir, f));
                        } catch { return []; }
                    })(),
                    // AppImage in nested folder
                    ...(() => {
                        try {
                            const nestedDir = path.join(playerDir, 'PlayTorrio-Linux-x64');
                            if (fs.existsSync(nestedDir)) {
                                const files = fs.readdirSync(nestedDir);
                                return files
                                    .filter(f => f.endsWith('.AppImage'))
                                    .map(f => path.join(nestedDir, f));
                            }
                        } catch { return []; }
                        return [];
                    })(),
                    // Extracted binary in bundle folder (V2)
                    path.join(playerDir, 'bundle', 'playtorrio'),
                    path.join(playerDir, 'bundle', 'PlayTorrio'),
                    path.join(playerDir, 'bundle', 'NipaPlay'),
                    path.join(playerDir, 'PlayTorrio-Linux-x64', 'bundle', 'playtorrio'),
                    path.join(playerDir, 'PlayTorrio-Linux-x64', 'bundle', 'PlayTorrio'),
                    path.join(playerDir, 'PlayTorrio-Linux-x64', 'bundle', 'NipaPlay'),
                    // Other possible locations
                    path.join(playerDir, 'bin', 'PlayTorrioPlayer'),
                    path.join(playerDir, 'bin', 'playtorrio'),
                    path.join(playerDir, 'PlayTorrioPlayer'),
                    path.join(playerDir, 'playtorrio'),
                    path.join(playerDir, 'PlayTorrio-Linux-x64', 'bin', 'PlayTorrioPlayer'),
                    path.join(playerDir, 'PlayTorrio-Linux-x64', 'bin', 'playtorrio'),
                    path.join(playerDir, 'PlayTorrio-Linux-x64', 'PlayTorrioPlayer'),
                    path.join(playerDir, 'PlayTorrio-Linux-x64', 'playtorrio'),
                ];
                
                for (const p of possiblePaths) {
                    if (fs.existsSync(p)) {
                        playerExe = p;
                        console.log(`[PlayTorrioPlayer] Found Linux binary at: ${p}`);
                        // Make sure it's executable on Linux
                        try {
                            fs.chmodSync(p, 0o755);
                        } catch (e) {
                            console.warn('[PlayTorrioPlayer] Could not set executable permission:', e.message);
                        }
                        break;
                    }
                }
            }
            
            if (!playerExe) {
                console.error(`[PlayTorrioPlayer] Player not found in: ${playerDir}`);
                console.error(`[PlayTorrioPlayer] Platform: ${process.platform}`);
                return res.status(404).json({ 
                    error: 'PlayTorrioPlayer not found',
                    message: `Please download PlayTorrioPlayer for your platform and place it in the PlayTorrioPlayer folder.`,
                    platform: process.platform,
                    searchedDir: playerDir
                });
            }
            
            console.log(`[PlayTorrioPlayer] Launching with IPC bridge`);
            console.log(`[PlayTorrioPlayer] Player exe: ${playerExe}`);
            console.log(`[PlayTorrioPlayer] Original URL: ${url}`);
            
            // Keep localhost as-is for PlayTorrioPlayer - it handles localhost properly
            // No need to convert to 127.0.0.1 for the new player
            let playerUrl = url;
            
            // Launch player with IPC mode (without --url, we'll load via IPC command)
            const args = ['--ipc'];
            
            const playerProcess = spawn(playerExe, args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                cwd: path.dirname(playerExe)
            });
            
            let messageId = 0;
            const pendingCommands = new Map();
            let subtitlesFetched = false;  // Track if we've already fetched subtitles
            
            // Helper to send IPC commands
            const sendCommand = (type, data = {}) => {
                return new Promise((resolve, reject) => {
                    const id = `cmd_${messageId++}`;
                    const command = { type, id, data };
                    
                    console.log(`[PlayTorrioPlayer] Sending command: ${type}`, data);
                    
                    pendingCommands.set(id, { resolve, reject });
                    
                    const timeout = setTimeout(() => {
                        pendingCommands.delete(id);
                        reject(new Error(`Command timeout: ${type}`));
                    }, 10000);
                    
                    pendingCommands.get(id).timeout = timeout;
                    
                    try {
                        playerProcess.stdin.write(JSON.stringify(command) + '\n');
                        console.log(`[PlayTorrioPlayer] Command sent to stdin: ${type}`);
                    } catch (e) {
                        clearTimeout(timeout);
                        pendingCommands.delete(id);
                        reject(e);
                    }
                });
            };
            
            // Handle stdout (responses and events from player)
            playerProcess.stdout.on('data', (data) => {
                const lines = data.toString().split('\n');
                for (const line of lines) {
                    if (line.trim()) {
                        try {
                            const message = JSON.parse(line);
                            
                            if (message.type === 'response' && message.id) {
                                const pending = pendingCommands.get(message.id);
                                if (pending) {
                                    clearTimeout(pending.timeout);
                                    pendingCommands.delete(message.id);
                                    pending.resolve(message.data);
                                }
                            } else if (message.type === 'event') {
                                console.log(`[PlayTorrioPlayer] Event: ${message.event}`, JSON.stringify(message.data || {}));
                                
                                if (message.event === 'ready') {
                                    console.log('[PlayTorrioPlayer] Player ready, loading video...');
                                    console.log('[PlayTorrioPlayer] Sending load_video command with URL:', playerUrl);
                                    
                                    // Load the video
                                    sendCommand('load_video', { url: playerUrl, startTime: 0 })
                                        .then((result) => {
                                            console.log('[PlayTorrioPlayer] load_video command sent successfully:', result);
                                            // Don't fetch subtitles yet - wait for video to actually load
                                            // We'll do it when we get state_changed event with hasVideo: true
                                        })
                                        .catch(err => {
                                            console.error('[PlayTorrioPlayer] Failed to send load_video command:', err.message);
                                        });
                                        
                                } else if (message.event === 'state_changed') {
                                    // Check if video has loaded
                                    if (message.data && message.data.hasVideo && !subtitlesFetched) {
                                        console.log('[PlayTorrioPlayer] Video loaded! Now fetching subtitles...');
                                        subtitlesFetched = true;
                                        fetchAndAddSubtitles();
                                    }
                                    
                                } else if (message.event === 'error' || message.event === 'playback_error') {
                                    console.error(`[PlayTorrioPlayer] Playback error:`, message.data);
                                }
                            } else if (message.type === 'error') {
                                console.error(`[PlayTorrioPlayer] Error: ${message.code} - ${message.message}`);
                                if (message.id) {
                                    const pending = pendingCommands.get(message.id);
                                    if (pending) {
                                        clearTimeout(pending.timeout);
                                        pendingCommands.delete(message.id);
                                        pending.reject(new Error(`${message.code}: ${message.message}`));
                                    }
                                }
                            }
                        } catch (e) {
                            // Non-JSON output - log it for debugging
                            console.log('[PlayTorrioPlayer] stdout:', line);
                        }
                    }
                }
            });
            
            // Handle stderr
            playerProcess.stderr.on('data', (data) => {
                console.error('[PlayTorrioPlayer] stderr:', data.toString());
            });
            
            // Extract hash from torrent stream URLs for cleanup when player closes
            let streamHash = null;
            let isAltEngine = false;
            if (playerUrl.includes('/api/stream-file') || playerUrl.includes('/api/alt-stream-file')) {
                try {
                    const urlObj = new URL(playerUrl);
                    streamHash = urlObj.searchParams.get('hash');
                    isAltEngine = playerUrl.includes('/api/alt-stream-file');
                    console.log(`[PlayTorrioPlayer] Torrent stream detected - hash: ${streamHash}, altEngine: ${isAltEngine}`);
                } catch (e) {}
            }
            
            console.log(`[PlayTorrioPlayer] TMDB: ${tmdbId}, IMDB: ${imdbId}, S${seasonNum}E${episodeNum}`);
            
            // Fetch and add subtitles from Wyzie and Stremio addons
            const fetchAndAddSubtitles = async () => {
                try {
                    const subtitles = [];
                    const TIMEOUT = 5000;
                    
                    console.log(`[PlayTorrioPlayer] Fetching subtitles for TMDB:${tmdbId}, IMDB:${imdbId}, S${seasonNum}E${episodeNum}`);
                    
                    const fetchPromises = [];
                    
                    // 1. Fetch from Wyzie
                    if (tmdbId) {
                        fetchPromises.push((async () => {
                            try {
                                let wyzieUrl = `https://sub.wyzie.ru/search?id=${tmdbId}`;
                                if (seasonNum && episodeNum) {
                                    wyzieUrl += `&season=${seasonNum}&episode=${episodeNum}`;
                                }
                                
                                console.log(`[PlayTorrioPlayer] Fetching from Wyzie: ${wyzieUrl}`);
                                const res = await fetch(wyzieUrl, { timeout: 3000 });
                                if (!res.ok) {
                                    console.warn(`[PlayTorrioPlayer] Wyzie returned status: ${res.status}`);
                                    return;
                                }
                                const wyzieData = await res.json();
                                
                                if (wyzieData && Array.isArray(wyzieData) && wyzieData.length > 0) {
                                    wyzieData.forEach(sub => {
                                        if (sub.url) {
                                            // Convert localhost to 127.0.0.1 in subtitle URLs too
                                            let subUrl = sub.url;
                                            if (subUrl.includes('localhost')) {
                                                subUrl = subUrl.replace(/localhost/g, '127.0.0.1');
                                            }
                                            subtitles.push({
                                                name: sub.display || sub.languageName || 'Unknown',
                                                url: subUrl,
                                                comment: 'Wyzie'
                                            });
                                        }
                                    });
                                    console.log(`[PlayTorrioPlayer] Got ${wyzieData.length} subtitles from Wyzie`);
                                }
                            } catch (e) {
                                console.warn('[PlayTorrioPlayer] Wyzie fetch error:', e.message);
                            }
                        })());
                    }
                    
                    // 2. Fetch from installed Stremio addons
                    fetchPromises.push((async () => {
                        try {
                            const addonsPath = path.join(userDataPath, 'addons.json');
                            if (!fs.existsSync(addonsPath)) return;
                            
                            const addonsData = fs.readFileSync(addonsPath, 'utf8');
                            const addons = JSON.parse(addonsData);
                            
                            const addonPromises = addons.map(async (addon) => {
                                const resources = addon.manifest?.resources || [];
                                const hasSubtitles = resources.some(r => 
                                    (typeof r === 'string' && r === 'subtitles') ||
                                    (typeof r === 'object' && r?.name === 'subtitles')
                                );
                                
                                if (!hasSubtitles) return;
                                
                                try {
                                    let baseUrl = addon.url.replace('/manifest.json', '');
                                    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
                                    
                                    // Need IMDB ID for Stremio addons
                                    let useImdbId = imdbId;
                                    if (!useImdbId && tmdbId) {
                                        try {
                                            const imdbRes = await fetch(`http://localhost:6987/api/tmdb-to-imdb?tmdbId=${tmdbId}&type=${mediaType}`);
                                            if (imdbRes.ok) {
                                                const imdbData = await imdbRes.json();
                                                useImdbId = imdbData.imdbId;
                                            }
                                        } catch (e) {}
                                    }
                                    
                                    if (!useImdbId) return;
                                    
                                    const resourceId = mediaType === 'tv' && seasonNum && episodeNum
                                        ? `${useImdbId}:${seasonNum}:${episodeNum}`
                                        : useImdbId;
                                    
                                    const endpoint = `${baseUrl}/subtitles/${mediaType}/${encodeURIComponent(resourceId)}.json`;
                                    const res = await fetch(endpoint);
                                    
                                    if (res.ok) {
                                        const data = await res.json();
                                        const addonSubs = data.subtitles || [];
                                        const addonName = addon.manifest?.name || 'Stremio Addon';
                                        
                                        addonSubs.forEach(sub => {
                                            if (sub.url) {
                                                // Convert localhost to 127.0.0.1 in subtitle URLs
                                                let subUrl = sub.url;
                                                if (subUrl.includes('localhost')) {
                                                    subUrl = subUrl.replace(/localhost/g, '127.0.0.1');
                                                }
                                                subtitles.push({
                                                    name: sub.lang || sub.language || 'Unknown',
                                                    url: subUrl,
                                                    comment: addonName
                                                });
                                            }
                                        });
                                        console.log(`[PlayTorrioPlayer] Got ${addonSubs.length} subtitles from ${addonName}`);
                                    }
                                } catch (e) {
                                    // Addon doesn't support subtitles for this content
                                }
                            });
                            
                            await Promise.allSettled(addonPromises);
                        } catch (e) {
                            console.warn('[PlayTorrioPlayer] Stremio addon fetch error:', e);
                        }
                    })());
                    
                    // Wait for all subtitle fetches with timeout
                    await Promise.race([
                        Promise.allSettled(fetchPromises),
                        new Promise(resolve => setTimeout(resolve, TIMEOUT))
                    ]);
                    
                    console.log(`[PlayTorrioPlayer] Total subtitles fetched: ${subtitles.length}`);
                    
                    // Add all subtitles to player using IPC
                    for (const sub of subtitles) {
                        try {
                            const result = await sendCommand('add_external_subtitle', {
                                name: sub.name,
                                url: sub.url,
                                comment: sub.comment
                            });
                            console.log(`[PlayTorrioPlayer] Added subtitle: ${sub.name} (${sub.comment}) at index ${result.index}`);
                        } catch (e) {
                            console.error(`[PlayTorrioPlayer] Failed to add subtitle ${sub.name}:`, e);
                        }
                    }
                    
                    console.log('[PlayTorrioPlayer] All subtitles added successfully');
                } catch (e) {
                    console.error('[PlayTorrioPlayer] Error fetching/adding subtitles:', e);
                }
            };
            
            // When player closes, stop the torrent stream only if stopOnClose is true
            playerProcess.on('close', (code) => {
                console.log(`[PlayTorrioPlayer] Player closed with code: ${code}`);
                
                if (streamHash && stopOnClose) {
                    const endpoint = isAltEngine ? '/api/alt-stop-stream' : '/api/stop-stream';
                    console.log(`[PlayTorrioPlayer] Stopping torrent stream: ${streamHash}`);
                    fetch(`http://localhost:6987${endpoint}?hash=${streamHash}`).catch(e => {
                        console.warn(`[PlayTorrioPlayer] Failed to stop stream:`, e.message);
                    });
                } else if (streamHash && !stopOnClose) {
                    console.log(`[PlayTorrioPlayer] Keeping torrent stream alive: ${streamHash} (stopOnClose=false)`);
                }
            });
            
            playerProcess.on('error', (err) => {
                console.error(`[PlayTorrioPlayer] Process error:`, err.message);
            });
            
            res.json({ success: true, message: 'PlayTorrioPlayer launched with IPC bridge' });
        } catch (e) {
            console.error('[PlayTorrioPlayer] Error:', e);
            res.status(500).json({ error: e.message });
        }
    });
    
    // Check if PlayTorrioPlayer is available
    app.get('/api/playtorrioplayer/status', async (req, res) => {
        try {
            const path = await import('path');
            const fs = await import('fs');
            const { fileURLToPath } = await import('url');
            
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = path.dirname(__filename);
            const playerDir = path.join(__dirname, 'PlayTorrioPlayer');
            
            let playerExe = null;
            let searchedPaths = [];
            
            if (process.platform === 'win32') {
                // Windows: Check for both PlayTorrio.exe and PlayTorrioPlayer.exe
                searchedPaths = [
                    path.join(playerDir, 'PlayTorrio.exe'),
                    path.join(playerDir, 'PlayTorrioPlayer.exe'),
                    path.join(playerDir, 'PlayTorrio-Windows-x64', 'PlayTorrio.exe'),
                    path.join(playerDir, 'PlayTorrio-Windows-x64', 'PlayTorrioPlayer.exe'),
                ];
                for (const p of searchedPaths) {
                    if (fs.existsSync(p)) {
                        playerExe = p;
                        break;
                    }
                }
            } else if (process.platform === 'darwin') {
                // macOS: Check multiple possible locations
                searchedPaths = [
                    path.join(playerDir, 'NipaPlay.app', 'Contents', 'MacOS', 'NipaPlay'),
                    path.join(playerDir, 'PlayTorrioPlayer.app', 'Contents', 'MacOS', 'PlayTorrioPlayer'),
                    path.join(playerDir, 'PlayTorrio-macOS-Universal', 'NipaPlay.app', 'Contents', 'MacOS', 'NipaPlay'),
                    path.join(playerDir, 'PlayTorrio-macOS-Universal', 'PlayTorrioPlayer.app', 'Contents', 'MacOS', 'PlayTorrioPlayer'),
                    path.join(playerDir, 'PlayTorrioPlayer'),
                    path.join(playerDir, 'NipaPlay'),
                    path.join(playerDir, 'bin', 'PlayTorrioPlayer'),
                    path.join(playerDir, 'bin', 'NipaPlay'),
                ];
                for (const p of searchedPaths) {
                    if (fs.existsSync(p)) {
                        playerExe = p;
                        break;
                    }
                }
            } else {
                // Linux: Check for AppImage or extracted binary in bundle folder
                // Start with specific AppImage names from v1.8.44+ release (NipaPlay) and older versions
                searchedPaths = [
                    path.join(playerDir, 'NipaPlay-1.8.44-Linux-amd64.AppImage'),  // v1.8.44+
                    path.join(playerDir, 'PlayTorrio-Linux-x64.AppImage'),  // Older versions
                ];
                
                try {
                    // Check root directory for any AppImage
                    const files = fs.readdirSync(playerDir);
                    const appImages = files.filter(f => f.endsWith('.AppImage'));
                    searchedPaths.push(...appImages.map(f => path.join(playerDir, f)));
                    
                    // Check nested directory
                    const nestedDir = path.join(playerDir, 'PlayTorrio-Linux-x64');
                    if (fs.existsSync(nestedDir)) {
                        const nestedFiles = fs.readdirSync(nestedDir);
                        const nestedAppImages = nestedFiles.filter(f => f.endsWith('.AppImage'));
                        searchedPaths.push(...nestedAppImages.map(f => path.join(nestedDir, f)));
                    }
                } catch {}
                
                searchedPaths.push(
                    // Bundle folder locations (V2)
                    path.join(playerDir, 'bundle', 'playtorrio'),
                    path.join(playerDir, 'bundle', 'PlayTorrio'),
                    path.join(playerDir, 'bundle', 'NipaPlay'),
                    path.join(playerDir, 'PlayTorrio-Linux-x64', 'bundle', 'playtorrio'),
                    path.join(playerDir, 'PlayTorrio-Linux-x64', 'bundle', 'PlayTorrio'),
                    path.join(playerDir, 'PlayTorrio-Linux-x64', 'bundle', 'NipaPlay'),
                    // Other locations
                    path.join(playerDir, 'bin', 'PlayTorrioPlayer'),
                    path.join(playerDir, 'bin', 'playtorrio'),
                    path.join(playerDir, 'PlayTorrioPlayer'),
                    path.join(playerDir, 'playtorrio'),
                    path.join(playerDir, 'PlayTorrio-Linux-x64', 'bin', 'PlayTorrioPlayer'),
                    path.join(playerDir, 'PlayTorrio-Linux-x64', 'bin', 'playtorrio'),
                    path.join(playerDir, 'PlayTorrio-Linux-x64', 'PlayTorrioPlayer'),
                    path.join(playerDir, 'PlayTorrio-Linux-x64', 'playtorrio')
                );
                
                for (const p of searchedPaths) {
                    if (fs.existsSync(p)) {
                        playerExe = p;
                        break;
                    }
                }
            }
            
            res.json({
                available: !!playerExe,
                platform: process.platform,
                playerPath: playerExe,
                playerDir: playerDir,
                searchedPaths: searchedPaths
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // 404 handler - must come after all routes
    app.use((req, res, next) => {
        if (!res.headersSent) {
            res.status(404).json({ error: 'Route not found: ' + req.path });
        }
    });

    // Global error handling middleware - must be last
    app.use((err, req, res, next) => {
        console.error('[Express Error]:', err.stack || err);
        if (!res.headersSent) {
            res.status(500).json({ 
                error: 'Internal server error',
                message: err.message || 'Unknown error'
            });
        }
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (err) => {
        console.error('[UNCAUGHT EXCEPTION]:', err);
        console.error('Stack:', err.stack);
        // Don't exit the process, just log it
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
        console.error('[UNHANDLED REJECTION]:', reason);
        console.error('Promise:', promise);
        // Don't exit the process, just log it
    });

    // Track active sockets for forceful shutdown
    const activeSockets = new Set();

    const server = app.listen(PORT, () => {
        console.log(`\n${'='.repeat(70)}`);
        console.log(`🚀 UNIFIED SERVER RUNNING ON http://localhost:${PORT}`);
        console.log(`${'='.repeat(70)}`);
        console.log(`\n📚 Available API Services:\n`);
        console.log(`  🎬 ANIME        → http://localhost:${PORT}/anime/api/{query}`);
        console.log(`  🎥 TORRENTIO    → http://localhost:${PORT}/torrentio/api/{imdbid}`);
        console.log(`  🔍 TORRENTLESS  → http://localhost:${PORT}/torrentless/api/search?q={query}`);
        console.log(`  📖 ZLIB         → http://localhost:${PORT}/zlib/search/{query}`);
        console.log(`  📚 OTHERBOOK    → http://localhost:${PORT}/otherbook/api/search/{query}`);
        console.log(`  🎞️  111477       → http://localhost:${PORT}/111477/api/tmdb/movie/{tmdbId}`);
        console.log(`\n🎯 Main Services:\n`);
        console.log(`  🔧 Settings     → http://localhost:${PORT}/api/settings`);
        console.log(`  🎬 Trakt        → http://localhost:${PORT}/api/trakt/*`);
        console.log(`  📺 Torrents     → http://localhost:${PORT}/api/torrents`);
        console.log(`  🎮 TorrServer   → http://localhost:${PORT}/api/webtorrent/*`);
        console.log(`  🎮 Games       → http://localhost:${PORT}/api/games/search/*`);
        console.log(`  🌊 Nuvio Proxy  → http://localhost:${PORT}/api/nuvio/stream/*`);
        console.log(`  ☄️  Comet Proxy  → http://localhost:${PORT}/api/comet/stream/*`);
        console.log(`\n💾 Cache System:\n`);
        console.log(`  ⏱️  Duration     → 1 hour (auto-refresh)`);
        console.log(`  🗑️  Clear Cache  → POST /api/clear-cache`);
        console.log(`  📊 Cache Stats  → GET /api/cache-stats`);
        if (!hasAPIKey) console.log('\n⚠️  Jackett API key not configured.');
        console.log(`\n${'='.repeat(70)}\n`);
    });

    // Track connections for later forced destroy
    server.on('connection', (socket) => {
        activeSockets.add(socket);
        socket.on('close', () => { activeSockets.delete(socket); });
    });

    // Handle server errors
    server.on('error', (err) => {
        console.error('[Server Error]:', err);
        if (err.code === 'EADDRINUSE') {
            console.error(`Port ${PORT} is already in use. Please close other instances or change the port.`);
        }
    });

    // Augment server with forceful shutdown helpers
    server.destroyAllSockets = () => {
        for (const s of activeSockets) {
            try { s.destroy(); } catch(_) {}
        }
        activeSockets.clear();
    };
    server.getActiveSocketCount = () => activeSockets.size;

    // Cleanup function for graceful shutdown
    const cleanup = async () => {
        console.log('[Server] Starting cleanup...');
        try {
            // Cleanup alt torrent engines (WebTorrent, TorrentStream, Hybrid)
            if (cleanupEngines) {
                console.log('[Server] Cleaning up alt torrent engines...');
                await cleanupEngines();
            }
            
            // Cleanup Stremio Engine
            console.log('[Server] Cleaning up Stremio engine...');
            await cleanupStremio();
            
            // Clear local tracking maps
            selectedFiles.clear();
            streamingState.clear();
            peerStats.clear();
        } catch (e) {
            console.error('[Server] Cleanup error:', e.message);
        }
        console.log('[Server] Cleanup complete');
    };

    return { server, clearCache, clearStremioCache, cleanup, activeTorrents };
}