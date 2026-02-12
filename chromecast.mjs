import Client from 'castv2-client';
import mdns from 'mdns-js';
import fetch from 'node-fetch';
import os from 'os';

const { DefaultMediaReceiver } = Client;

/**
 * Discover Chromecast devices on the network
 * @returns {Promise<Array>} Array of discovered devices
 */
export function discoverDevices(timeout = 5000) {
    return new Promise((resolve) => {
        const devices = [];
        const browser = mdns.createBrowser(mdns.tcp('googlecast'));

        const timer = setTimeout(() => {
            browser.stop();
            resolve(devices);
        }, timeout);

        browser.on('ready', () => {
            browser.discover();
        });

        browser.on('update', (service) => {
            if (service.addresses && service.addresses.length > 0) {
                const device = {
                    name: service.txt?.[0] || service.name || 'Unknown Device',
                    host: service.addresses[0],
                    port: service.port || 8009
                };
                
                // Avoid duplicates
                if (!devices.find(d => d.host === device.host)) {
                    devices.push(device);
                    console.log(`[Chromecast] Discovered: ${device.name} at ${device.host}`);
                }
            }
        });
    });
}

/**
 * Fetch subtitles from Wyzie API
 * @param {Object} options - Options for subtitle search
 * @param {string} options.tmdbId - TMDB ID
 * @param {string} options.imdbId - IMDB ID (alternative)
 * @param {string} options.type - 'movie' or 'tv'
 * @param {number} options.season - Season number (for TV)
 * @param {number} options.episode - Episode number (for TV)
 * @param {string} options.lang - Preferred language code (e.g., 'en', 'es')
 * @returns {Promise<Array>} Array of subtitle tracks for Chromecast
 */
export async function fetchWyzieSubtitles(options = {}) {
    const { tmdbId, imdbId, type, season, episode, lang } = options;
    
    if (!tmdbId && !imdbId) {
        console.log('[Chromecast] No TMDB/IMDB ID provided, skipping subtitles');
        return [];
    }
    
    try {
        let wyzieUrl = 'https://sub.wyzie.ru/search?';
        if (imdbId) {
            wyzieUrl += `id=${encodeURIComponent(imdbId)}`;
        } else if (tmdbId) {
            wyzieUrl += `id=${encodeURIComponent(tmdbId)}`;
        }
        
        if (type === 'tv' && season && episode) {
            wyzieUrl += `&season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode)}`;
        }
        
        console.log(`[Chromecast] Fetching subtitles from: ${wyzieUrl}`);
        
        const response = await fetch(wyzieUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        if (!response.ok) {
            console.warn(`[Chromecast] Wyzie API returned ${response.status}`);
            return [];
        }
        
        const subtitles = await response.json();
        
        if (!Array.isArray(subtitles) || subtitles.length === 0) {
            console.log('[Chromecast] No subtitles found from Wyzie');
            return [];
        }
        
        console.log(`[Chromecast] Found ${subtitles.length} subtitles from Wyzie`);
        
        // Convert Wyzie subtitles to Chromecast track format
        // Chromecast requires WebVTT format - Wyzie provides SRT which needs conversion
        // We'll filter for VTT or use a proxy that converts SRT to VTT
        const tracks = [];
        let trackId = 1;
        
        // Group by language and pick best one per language
        const byLang = new Map();
        
        for (const sub of subtitles) {
            const subUrl = sub.url || sub.link;
            const langCode = sub.lang || sub.language || 'en';
            const langName = sub.display || sub.langName || langCode.toUpperCase();
            
            if (!subUrl) continue;
            
            // Skip non-SRT/VTT formats
            const ext = subUrl.split('.').pop()?.toLowerCase();
            if (ext && !['srt', 'vtt'].includes(ext)) continue;
            
            // Keep first (usually best) subtitle per language
            if (!byLang.has(langCode)) {
                byLang.set(langCode, {
                    url: subUrl,
                    langCode,
                    langName,
                    isVtt: ext === 'vtt'
                });
            }
        }
        
        // Prioritize preferred language if specified
        const sortedLangs = [...byLang.keys()].sort((a, b) => {
            if (lang) {
                if (a === lang) return -1;
                if (b === lang) return 1;
            }
            // English first by default
            if (a === 'en') return -1;
            if (b === 'en') return 1;
            return a.localeCompare(b);
        });
        
        for (const langCode of sortedLangs) {
            const sub = byLang.get(langCode);
            
            // Chromecast needs WebVTT - if it's SRT, we need to convert via proxy
            // The server should have a /api/subtitles/vtt endpoint that converts SRT to VTT
            let trackUrl = sub.url;
            if (!sub.isVtt) {
                // Use server proxy to convert SRT to VTT
                trackUrl = `http://localhost:6987/api/subtitles/vtt?url=${encodeURIComponent(sub.url)}`;
            }
            
            tracks.push({
                trackId: trackId++,
                type: 'TEXT',
                trackContentId: trackUrl,
                trackContentType: 'text/vtt',
                name: sub.langName,
                language: sub.langCode,
                subtype: 'SUBTITLES'
            });
        }
        
        console.log(`[Chromecast] Prepared ${tracks.length} subtitle tracks`);
        return tracks;
        
    } catch (error) {
        console.error('[Chromecast] Error fetching Wyzie subtitles:', error.message);
        return [];
    }
}

/**
 * Cast a media URL to a Chromecast device
 * @param {string} host - Chromecast device IP address
 * @param {string} mediaUrl - URL of the media to cast
 * @param {Object} metadata - Optional metadata (title, images, etc.)
 * @param {Object} subtitleOptions - Options for fetching subtitles
 * @returns {Promise<Object>} Result object with success status
 */
export function castMedia(host, mediaUrl, metadata = {}, subtitleOptions = {}) {
    return new Promise(async (resolve, reject) => {
        const client = new Client.Client();

        console.log(`[Chromecast] Attempting to cast:`);
        console.log(`[Chromecast] - Host: ${host}`);
        console.log(`[Chromecast] - Media URL: ${mediaUrl}`);
        console.log(`[Chromecast] - Metadata:`, metadata);

        // Fetch subtitles from Wyzie if we have TMDB/IMDB ID
        let subtitleTracks = [];
        
        // First, try to use provided subtitles from the app
        if (subtitleOptions.subtitles && Array.isArray(subtitleOptions.subtitles) && subtitleOptions.subtitles.length > 0) {
            console.log(`[Chromecast] Using ${subtitleOptions.subtitles.length} provided subtitles`);
            
            // Get the network IP of the computer (not the Chromecast)
            const os = await import('os');
            const interfaces = os.networkInterfaces();
            let computerIP = 'localhost';
            
            // Find the network IP on the same subnet as the Chromecast
            const chromecastIP = host.split(':')[0];
            const chromecastSubnet = chromecastIP.split('.').slice(0, 3).join('.');
            
            for (const name of Object.keys(interfaces)) {
                for (const iface of interfaces[name]) {
                    if (iface.family === 'IPv4' && !iface.internal) {
                        const ifaceSubnet = iface.address.split('.').slice(0, 3).join('.');
                        if (ifaceSubnet === chromecastSubnet) {
                            computerIP = iface.address;
                            break;
                        }
                    }
                }
                if (computerIP !== 'localhost') break;
            }
            
            console.log(`[Chromecast] Computer IP for subtitles: ${computerIP}`);
            
            let trackId = 1;
            for (const sub of subtitleOptions.subtitles) {
                if (!sub.url) continue;
                
                // Chromecast needs WebVTT format
                // Proxy the subtitle URL through the server to ensure it's accessible and converted to VTT
                const trackUrl = `http://${computerIP}:6987/api/subtitles/vtt?url=${encodeURIComponent(sub.url)}`;
                
                console.log(`[Chromecast] Subtitle ${trackId}:`);
                console.log(`[Chromecast]   - Name: ${sub.display || sub.language}`);
                console.log(`[Chromecast]   - Original URL: ${sub.url.substring(0, 80)}...`);
                console.log(`[Chromecast]   - Network URL: ${trackUrl.substring(0, 100)}...`);
                
                subtitleTracks.push({
                    trackId: trackId++,
                    type: 'TEXT',
                    trackContentId: trackUrl,
                    trackContentType: 'text/vtt',
                    name: sub.display || sub.language || `Subtitle ${trackId}`,
                    language: sub.language || 'en',
                    subtype: 'SUBTITLES'
                });
            }
            
            console.log(`[Chromecast] Prepared ${subtitleTracks.length} subtitle tracks from provided subtitles`);
        } else if (subtitleOptions.tmdbId || subtitleOptions.imdbId) {
            // Fallback: Fetch from Wyzie if no subtitles provided
            try {
                subtitleTracks = await fetchWyzieSubtitles(subtitleOptions);
            } catch (e) {
                console.warn('[Chromecast] Failed to fetch subtitles:', e.message);
            }
        }

        client.connect(host, () => {
            console.log(`[Chromecast] Connected to ${host}`);

            client.launch(DefaultMediaReceiver, (err, player) => {
                if (err) {
                    client.close();
                    return reject(new Error(`Failed to launch receiver: ${err.message}`));
                }

                console.log(`[Chromecast] DefaultMediaReceiver launched`);

                // Determine stream type based on content
                const isHLS = mediaUrl.includes('.m3u8') || metadata.contentType === 'application/x-mpegURL';
                
                const media = {
                    contentId: mediaUrl,
                    contentType: metadata.contentType || 'video/mp4',
                    streamType: 'BUFFERED',
                    metadata: {
                        type: 0,
                        metadataType: 0,
                        title: metadata.title || 'PlayTorrio Stream',
                        images: metadata.images || []
                    }
                };
                
                // For HLS streams, ensure proper content type
                if (isHLS) {
                    media.contentType = 'application/x-mpegURL';
                    console.log(`[Chromecast] Detected HLS stream, using application/x-mpegURL`);
                }

                // Add subtitle tracks if available
                if (subtitleTracks.length > 0) {
                    media.tracks = subtitleTracks;
                    console.log(`[Chromecast] Added ${subtitleTracks.length} subtitle tracks`);
                    console.log(`[Chromecast] Subtitle tracks:`, JSON.stringify(subtitleTracks, null, 2));
                }

                console.log(`[Chromecast] Loading media:`, media);

                // Prepare load options
                const loadOptions = { autoplay: true };
                
                // Auto-enable first subtitle track if available
                if (subtitleTracks.length > 0) {
                    loadOptions.activeTrackIds = [subtitleTracks[0].trackId];
                    console.log(`[Chromecast] Auto-enabling subtitle track ID: ${subtitleTracks[0].trackId} - ${subtitleTracks[0].name}`);
                }
                
                console.log(`[Chromecast] Load options:`, loadOptions);

                player.load(media, loadOptions, (err, status) => {
                    if (err) {
                        console.error(`[Chromecast] Failed to load media:`, err);
                        console.error(`[Chromecast] Error details:`, JSON.stringify(err, null, 2));
                        client.close();
                        return reject(new Error(`Failed to load media: ${err.message}`));
                    }

                    console.log(`[Chromecast] Media loaded successfully`);
                    console.log(`[Chromecast] Status:`, status);
                    
                    // Log detailed status
                    if (status.playerState === 'IDLE' && status.idleReason) {
                        console.error(`[Chromecast] Player is IDLE with reason: ${status.idleReason}`);
                        if (status.idleReason === 'ERROR') {
                            console.error(`[Chromecast] Playback error occurred`);
                        }
                    }

                    player.on('status', (status) => {
                        console.log(`[Chromecast] Player status update:`, status);
                        
                        // Log errors
                        if (status.playerState === 'IDLE' && status.idleReason === 'ERROR') {
                            console.error(`[Chromecast] Playback error detected in status update`);
                        }
                    });

                    resolve({
                        success: true,
                        message: `Casting to Chromecast at ${host}`,
                        player: player,
                        client: client,
                        subtitleTracks: subtitleTracks
                    });
                });
            });
        });

        client.on('error', (err) => {
            console.error(`[Chromecast] Client error:`, err);
            client.close();
            reject(new Error(`Chromecast error: ${err.message}`));
        });
    });
}

/**
 * Cast to the first available Chromecast device
 * @param {string} mediaUrl - URL of the media to cast
 * @param {Object} metadata - Optional metadata
 * @param {Object} subtitleOptions - Options for fetching subtitles
 * @returns {Promise<Object>} Result object
 */
export async function castToFirstDevice(mediaUrl, metadata = {}, subtitleOptions = {}) {
    console.log('[Chromecast] Discovering devices...');
    const devices = await discoverDevices(3000);

    if (devices.length === 0) {
        throw new Error('No Chromecast devices found on the network');
    }

    console.log(`[Chromecast] Found ${devices.length} device(s)`);
    const device = devices[0];
    console.log(`[Chromecast] Using device: ${device.name} (${device.host})`);

    return await castMedia(device.host, mediaUrl, metadata, subtitleOptions);
}

/**
 * Enable/disable a subtitle track on an active cast session
 * @param {Object} player - The player object from castMedia
 * @param {number|null} trackId - Track ID to enable, or null to disable subtitles
 */
export function setSubtitleTrack(player, trackId) {
    if (!player) {
        console.warn('[Chromecast] No active player');
        return;
    }
    
    const activeTrackIds = trackId ? [trackId] : [];
    
    player.media.editTracksInfo({
        activeTrackIds: activeTrackIds
    }, (err) => {
        if (err) {
            console.error('[Chromecast] Failed to change subtitle track:', err);
        } else {
            console.log(`[Chromecast] Subtitle track ${trackId ? `#${trackId} enabled` : 'disabled'}`);
        }
    });
}

/**
 * Stop casting on a device
 * @param {Object} client - The client object from castMedia
 */
export function stopCasting(client) {
    if (client) {
        try {
            client.close();
            console.log('[Chromecast] Stopped casting');
        } catch (err) {
            console.error('[Chromecast] Error stopping cast:', err);
        }
    }
}
