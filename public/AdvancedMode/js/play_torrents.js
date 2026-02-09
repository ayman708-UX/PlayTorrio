// Torrent fetching for play page
import { filterTorrents } from './torrent_filter.js';

// ============================================================================
// Helper Functions
// ============================================================================

const detectQuality = (title) => {
    const t = title.toLowerCase();
    if (t.includes('2160p') || t.includes('4k')) return '4K';
    if (t.includes('1080p')) return '1080p';
    if (t.includes('720p')) return '720p';
    if (t.includes('480p')) return '480p';
    return 'Unknown';
};

const detectCodec = (title) => {
    const t = title.toLowerCase();
    if (t.includes('x265') || t.includes('hevc')) return 'HEVC';
    if (t.includes('x264') || t.includes('avc')) return 'x264';
    if (t.includes('av1')) return 'AV1';
    return 'h264';
};

const detectHDR = (title) => {
    const t = title.toLowerCase();
    if (t.includes('dv') || t.includes('dolby vision')) return 'Dolby Vision';
    if (t.includes('hdr10+')) return 'HDR10+';
    if (t.includes('hdr')) return 'HDR';
    return null;
};

const parseSize = (sizeStr) => {
    if (!sizeStr || sizeStr === 'Unknown') return 0;
    const str = sizeStr.toLowerCase();
    const match = str.match(/([\d.]+)\s*(gb|mb|kb|tb)/i);
    if (!match) return 0;
    const num = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    switch (unit) {
        case 'tb': return num * 1024 * 1024 * 1024 * 1024;
        case 'gb': return num * 1024 * 1024 * 1024;
        case 'mb': return num * 1024 * 1024;
        case 'kb': return num * 1024;
        default: return num;
    }
};

// ============================================================================
// API Helper Functions
// ============================================================================

async function getSettings() {
    try {
        const response = await fetch('/api/settings');
        if (response.ok) {
            return await response.json();
        }
    } catch (e) {
        console.error('[Play] Failed to fetch settings', e);
    }
    return {};
}

async function getJackettKey() {
    try {
        const response = await fetch('/api/get-api-key');
        if (response.ok) {
            const data = await response.json();
            return data.apiKey || '';
        }
    } catch (e) {
        console.error('[Play] Failed to fetch Jackett key', e);
    }
    return '';
}

async function getProwlarrKey() {
    try {
        const response = await fetch('/api/get-prowlarr-api-key');
        if (response.ok) {
            const data = await response.json();
            return data.apiKey || '';
        }
    } catch (e) {
        console.error('[Play] Failed to fetch Prowlarr key', e);
    }
    return '';
}

// ============================================================================
// Jackett Search
// ============================================================================

const fetchFromJackett = async (query) => {
    const apiKey = await getJackettKey();
    const settings = await getSettings();
    const jackettUrl = settings.jackettUrl || 'http://127.0.0.1:9117/api/v2.0/indexers/all/results/torznab';
    
    if (!apiKey) return [];

    const url = new URL(`${window.location.origin}/api/jackett`);
    url.searchParams.append('apikey', apiKey);
    url.searchParams.append('t', 'search');
    url.searchParams.append('q', query);
    url.searchParams.append('jackettUrl', jackettUrl);
    
    try {
        const response = await fetch(url.toString());
        if (!response.ok) throw new Error(`Jackett API Error: ${response.status}`);
        
        const xmlText = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "text/xml");
        
        return Array.from(xmlDoc.querySelectorAll('item')).map(item => {
            const torznabAttrs = {};
            const attrs = item.getElementsByTagName('torznab:attr');
            for (let i = 0; i < attrs.length; i++) {
                const name = attrs[i].getAttribute('name');
                const value = attrs[i].getAttribute('value');
                if (name) torznabAttrs[name] = value;
            }

            const title = item.querySelector('title')?.textContent;
            let link = item.querySelector('link')?.textContent;
            let magnet = torznabAttrs['magneturl'] || null;

            if (!magnet && link && link.startsWith('magnet:')) {
                magnet = link;
            }

            return {
                Title: title,
                Guid: item.querySelector('guid')?.textContent,
                Link: link,
                Size: item.querySelector('size')?.textContent || item.querySelector('enclosure')?.getAttribute('length'),
                MagnetUri: magnet,
                Seeders: parseInt(torznabAttrs['seeders']) || 0,
                Peers: parseInt(torznabAttrs['peers']) || 0,
                Tracker: item.querySelector('jackettindexer')?.textContent || 'Jackett'
            };
        });
    } catch (error) {
        console.error('Jackett Fetch Failed:', error);
        throw new Error('JACKETT_CONNECTION_ERROR');
    }
};

export const searchJackett = async (queries, metadata = {}) => {
    const queryList = Array.isArray(queries) ? queries : [queries];
    const results = await Promise.all(queryList.map(q => fetchFromJackett(q)));
    
    const seen = new Set();
    const merged = [];
    
    results.flat().forEach(item => {
        const id = item.Guid || item.MagnetUri || item.Link;
        if (id && !seen.has(id)) {
            seen.add(id);
            merged.push(item);
        }
    });

    return filterTorrents(merged, metadata);
};

// ============================================================================
// Prowlarr Search
// ============================================================================

const fetchFromProwlarr = async (query) => {
    const apiKey = await getProwlarrKey();
    const settings = await getSettings();
    const prowlarrUrl = settings.prowlarrUrl || 'http://127.0.0.1:9696';
    
    if (!apiKey) return [];

    // Use the proxy through server
    const url = new URL(`${window.location.origin}/api/prowlarr`);
    url.searchParams.append('apikey', apiKey);
    url.searchParams.append('q', query);
    url.searchParams.append('prowlarrUrl', prowlarrUrl);
    
    try {
        const response = await fetch(url.toString());
        if (!response.ok) throw new Error(`Prowlarr API Error: ${response.status}`);
        
        const results = await response.json();
        
        return results.map(item => ({
            Title: item.title,
            Guid: item.guid,
            Link: item.downloadUrl || item.magnetUrl,
            Size: item.size,
            MagnetUri: item.magnetUrl || (item.downloadUrl?.startsWith('magnet:') ? item.downloadUrl : null),
            Seeders: parseInt(item.seeders) || 0,
            Peers: parseInt(item.leechers) || 0,
            Tracker: item.indexer || 'Prowlarr'
        }));
    } catch (error) {
        console.error('Prowlarr Fetch Failed:', error);
        throw new Error('PROWLARR_CONNECTION_ERROR');
    }
};

export const searchProwlarr = async (queries, metadata = {}) => {
    const queryList = Array.isArray(queries) ? queries : [queries];
    const results = await Promise.all(queryList.map(q => fetchFromProwlarr(q)));
    
    const seen = new Set();
    const merged = [];
    
    results.flat().forEach(item => {
        const id = item.Guid || item.MagnetUri || item.Link;
        if (id && !seen.has(id)) {
            seen.add(id);
            merged.push(item);
        }
    });

    return filterTorrents(merged, metadata);
};

// ============================================================================
// Build Search Queries
// ============================================================================

export function buildSearchQueries(mediaData) {
    const { title, type, season, episode, year } = mediaData;
    const queries = [];
    const metadata = { title, type, year };
    
    if (type === 'tv' && season) {
        const s = String(season).padStart(2, '0');
        metadata.season = season;
        
        if (episode) {
            const e = String(episode).padStart(2, '0');
            queries.push(`${title} S${s}E${e}`);
            queries.push(`${title} S${s}`); // Also search for season pack
            metadata.episode = episode;
        } else {
            queries.push(`${title} S${s}`);
            metadata.episode = null;
        }
    } else {
        // For movies
        if (year) {
            queries.push(`${title} ${year}`);
        }
        queries.push(title);
    }
    
    return { queries, metadata };
}

// ============================================================================
// 111477 Search
// ============================================================================

export const search111477 = async (mediaData) => {
    const { type, season, episode } = mediaData;
    
    try {
        // Get TMDB ID from URL params
        const params = new URLSearchParams(window.location.search);
        const tmdbId = params.get('id');
        
        if (!tmdbId) {
            throw new Error('No TMDB ID available');
        }
        
        let apiUrl;
        
        if (type === 'tv') {
            if (!episode) {
                throw new Error('Please select an episode');
            }
            apiUrl = `http://localhost:6987/111477/api/tmdb/tv/${encodeURIComponent(tmdbId)}/season/${encodeURIComponent(season)}/episode/${encodeURIComponent(episode)}`;
        } else {
            apiUrl = `http://localhost:6987/111477/api/tmdb/movie/${encodeURIComponent(tmdbId)}`;
        }
        
        console.log('[111477] Fetching from:', apiUrl);
        
        const response = await fetch(apiUrl);
        
        if (!response.ok) {
            throw new Error(`111477 API Error: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        // Handle multi-result format from 111477 API
        let allFiles = [];
        if (Array.isArray(data?.results)) {
            data.results.forEach(result => {
                if (result.files && Array.isArray(result.files)) {
                    allFiles = allFiles.concat(result.files.map(f => ({ ...f, source: result.source || '111477' })));
                }
            });
        } else if (data?.files && Array.isArray(data.files)) {
            allFiles = data.files.map(f => ({ ...f, source: '111477' }));
        }
        
        console.log('[111477] Found', allFiles.length, 'files');
        
        // Convert 111477 files to standard source format
        return allFiles.map(file => {
            const fileTitle = file.filename || file.name || 'Unknown';
            const quality = detectQuality(fileTitle);
            const codec = detectCodec(fileTitle);
            const size = file.size || 'Unknown';
            
            return {
                Title: fileTitle,
                title: fileTitle,
                quality: quality,
                codec: codec,
                Size: size,
                size: size,
                sizeBytes: parseSize(size),
                Seeders: 0,
                seeders: 0,
                Tracker: file.source || '111477',
                indexer: file.source || '111477',
                Link: file.url || file.link,
                link: file.url || file.link,
                MagnetUri: null,
                magnet: null,
                hdr: detectHDR(fileTitle)
            };
        });
    } catch (error) {
        console.error('[111477] Error:', error);
        throw new Error('111477_CONNECTION_ERROR');
    }
};

// ============================================================================
// PlayTorrio (Torrentless) Search
// ============================================================================

export const searchPlayTorrio = async (mediaData) => {
    const { title, type, season, episode, year } = mediaData;
    
    try {
        if (!title) {
            throw new Error('No title available for search');
        }
        
        let query;
        if (type === 'tv') {
            const s = String(season).padStart(2, '0');
            const e = episode ? String(episode).padStart(2, '0') : '';
            query = episode ? `${title} S${s}E${e}` : `${title} S${s}`;
        } else {
            query = `${title} ${year}`;
        }
        
        const torrentlessUrl = `http://localhost:6987/torrentless/api/search?q=${encodeURIComponent(query)}&page=1`;
        console.log('[PlayTorrio] Query:', query);
        console.log('[PlayTorrio] Fetching from:', torrentlessUrl);
        
        const response = await fetch(torrentlessUrl);
        
        if (!response.ok) {
            throw new Error(`PlayTorrio API Error: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        const items = data.items || [];
        console.log('[PlayTorrio] Found', items.length, 'results');
        
        // Convert torrentless items to standard source format
        return items.map(item => {
            const itemTitle = item.name || item.title || 'Unknown';
            const quality = detectQuality(itemTitle);
            const codec = detectCodec(itemTitle);
            // Parse seeds - API returns formatted string like "1,234"
            const seeders = parseInt((item.seeds || '0').toString().replace(/,/g, ''), 10) || 0;
            
            return {
                Title: itemTitle,
                title: itemTitle,
                quality: quality,
                codec: codec,
                Size: item.size || 'Unknown',
                size: item.size || 'Unknown',
                sizeBytes: parseSize(item.size || '0'),
                Seeders: seeders,
                seeders: seeders,
                Tracker: 'PlayTorrio',
                indexer: 'PlayTorrio',
                Link: null,
                link: null,
                MagnetUri: item.magnet,
                magnet: item.magnet,
                hdr: detectHDR(itemTitle)
            };
        });
    } catch (error) {
        console.error('[PlayTorrio] Error:', error);
        throw new Error('PLAYTORRIO_CONNECTION_ERROR');
    }
};
