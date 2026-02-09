/**
 * Stremio Addon Protocol Handler
 * Handles addons that don't use TMDB IDs
 */

/**
 * Fetch meta from Stremio addon
 * @param {string} addonUrl - Base URL of the addon (e.g., "https://addon.com")
 * @param {string} type - Content type (movie, series, etc.)
 * @param {string} id - Content ID from the addon
 * @returns {Promise<Object>} Meta object
 */
export async function fetchStremioMeta(addonUrl, type, id) {
    try {
        // Remove trailing slash
        const baseUrl = addonUrl.replace(/\/$/, '');
        // URL encode the ID to handle IDs with special characters (like URLs)
        const encodedId = encodeURIComponent(id);
        const metaUrl = `${baseUrl}/meta/${type}/${encodedId}.json`;
        
        console.log('[StremioAddon] Fetching meta:', metaUrl);
        console.log('[StremioAddon] Original ID:', id);
        console.log('[StremioAddon] Encoded ID:', encodedId);
        
        const response = await fetch(metaUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('[StremioAddon] Meta response:', data);
        
        return data.meta || data;
    } catch (error) {
        console.error('[StremioAddon] Meta fetch error:', error);
        throw error;
    }
}

/**
 * Fetch streams from Stremio addon
 * @param {string} addonUrl - Base URL of the addon
 * @param {string} type - Content type (movie, series, etc.)
 * @param {string} videoId - Video ID (for movies, same as meta ID; for series, includes season/episode)
 * @returns {Promise<Array>} Array of stream objects
 */
export async function fetchStremioStreams(addonUrl, type, videoId) {
    try {
        // Remove trailing slash
        const baseUrl = addonUrl.replace(/\/$/, '');
        // URL encode the video ID to handle IDs with special characters (like URLs)
        const encodedVideoId = encodeURIComponent(videoId);
        const streamUrl = `${baseUrl}/stream/${type}/${encodedVideoId}.json`;
        
        console.log('[StremioAddon] Fetching streams:', streamUrl);
        console.log('[StremioAddon] Original video ID:', videoId);
        console.log('[StremioAddon] Encoded video ID:', encodedVideoId);
        
        const response = await fetch(streamUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('[StremioAddon] Streams response:', data);
        
        return data.streams || [];
    } catch (error) {
        console.error('[StremioAddon] Streams fetch error:', error);
        throw error;
    }
}

/**
 * Parse Stremio stream object and convert to playable URL
 * @param {Object} stream - Stream object from addon
 * @returns {Object} Parsed stream with URL and metadata
 */
export function parseStremioStream(stream) {
    const parsed = {
        title: stream.title || stream.name || 'Unknown',
        url: null,
        type: null,
        quality: null,
        source: 'stremio-addon'
    };
    
    // Direct URL
    if (stream.url) {
        parsed.url = stream.url;
        parsed.type = 'url';
    }
    // YouTube
    else if (stream.ytId) {
        parsed.url = `https://www.youtube.com/watch?v=${stream.ytId}`;
        parsed.type = 'youtube';
    }
    // Torrent info hash
    else if (stream.infoHash) {
        // Build magnet link
        const trackers = [
            'udp://tracker.opentrackr.org:1337/announce',
            'udp://open.stealth.si:80/announce',
            'udp://tracker.torrent.eu.org:451/announce'
        ];
        const trackerParams = trackers.map(t => `&tr=${encodeURIComponent(t)}`).join('');
        parsed.url = `magnet:?xt=urn:btih:${stream.infoHash}${trackerParams}`;
        parsed.type = 'torrent';
    }
    // External URL (some addons use this)
    else if (stream.externalUrl) {
        parsed.url = stream.externalUrl;
        parsed.type = 'external';
    }
    
    // Extract quality from title if present
    const qualityMatch = stream.title?.match(/(\d+p|4K|HD|SD|CAM|TS)/i);
    if (qualityMatch) {
        parsed.quality = qualityMatch[1];
    }
    
    return parsed;
}

/**
 * Check if an ID is from a Stremio addon (not TMDB)
 * @param {string} id - Content ID
 * @returns {boolean}
 */
export function isStremioAddonId(id) {
    // TMDB IDs are numeric or start with 'tt' (IMDB)
    // Stremio addon IDs are usually custom strings
    return id && !id.match(/^(tt)?\d+$/);
}

/**
 * Extract addon URL from catalog URL
 * @param {string} catalogUrl - Full catalog URL
 * @returns {string} Base addon URL
 */
export function extractAddonUrl(catalogUrl) {
    try {
        const url = new URL(catalogUrl);
        // Remove /catalog/... path
        return `${url.protocol}//${url.host}`;
    } catch (e) {
        console.error('[StremioAddon] Invalid catalog URL:', catalogUrl);
        return null;
    }
}

/**
 * Format Stremio meta for display
 * @param {Object} meta - Meta object from addon
 * @returns {Object} Formatted meta for details page
 */
export function formatStremioMeta(meta) {
    return {
        id: meta.id,
        title: meta.name || meta.title,
        poster: meta.poster,
        background: meta.background || meta.poster,
        logo: meta.logo,
        description: meta.description || meta.overview,
        genres: meta.genre || meta.genres || [],
        type: meta.type,
        year: meta.releaseInfo ? parseInt(meta.releaseInfo) : null,
        rating: meta.imdbRating || meta.rating,
        runtime: meta.runtime,
        director: meta.director,
        cast: meta.cast,
        trailer: meta.trailerStreams?.[0]?.ytId,
        // Stremio-specific fields
        behaviorHints: meta.behaviorHints || {},
        links: meta.links || [],
        posterShape: meta.posterShape || 'poster'
    };
}

/**
 * Get video ID for stream request
 * For movies: same as meta ID
 * For series: meta ID + season + episode (e.g., "id:1:1")
 * @param {Object} meta - Meta object
 * @param {number} season - Season number (for series)
 * @param {number} episode - Episode number (for series)
 * @returns {string} Video ID
 */
export function getVideoId(meta, season = null, episode = null) {
    // Check behaviorHints for default video ID
    if (meta.behaviorHints?.defaultVideoId) {
        return meta.behaviorHints.defaultVideoId;
    }
    
    // For series with season/episode
    if (meta.type === 'series' && season !== null && episode !== null) {
        return `${meta.id}:${season}:${episode}`;
    }
    
    // For movies or single-video items
    return meta.id;
}
