// Basic Mode Addons - Bridged to Main App via ElectronAPI

export const getInstalledAddons = async () => {
    try {
        let addons = [];
        if (window.electronAPI?.addonList) {
            const res = await window.electronAPI.addonList();
            addons = res.success ? res.addons : [];
        } else {
            // Fallback for non-electron env (testing)
            const stored = localStorage.getItem('stremio_addons');
            addons = stored ? JSON.parse(stored) : [];
        }
        
        // Ensure every addon has a baseUrl (Critical for fetchAddonStreams)
        return addons.map(addon => {
            // Normalize 'url' to 'manifestUrl' if 'url' exists (Main App structure)
            if (addon.url && !addon.manifestUrl) {
                addon.manifestUrl = addon.url;
            }

            if (!addon.baseUrl) {
                // Try transportUrl
                if (addon.transportUrl) {
                    addon.baseUrl = addon.transportUrl;
                } else if (addon.manifest?.transportUrl) {
                    addon.baseUrl = addon.manifest.transportUrl;
                } else if (addon.manifestUrl) {
                    // Derive from manifestUrl - try standard replace first
                    if (addon.manifestUrl.endsWith('/manifest.json')) {
                         addon.baseUrl = addon.manifestUrl.slice(0, -14);
                    } else {
                         addon.baseUrl = addon.manifestUrl.replace('/manifest.json', '').replace('manifest.json', '');
                    }
                }
                
                // Cleanup trailing slash
                if (addon.baseUrl && addon.baseUrl.endsWith('/')) {
                    addon.baseUrl = addon.baseUrl.slice(0, -1);
                }
            }
            return addon;
        });
    } catch (e) {
        console.error("Failed to fetch addons", e);
        return [];
    }
};

export const installAddon = async (manifestUrl) => {
    try {
        if (window.electronAPI?.addonInstall) {
            const res = await window.electronAPI.addonInstall(manifestUrl);
            if (!res.success) throw new Error(res.message);
            return res.addon;
        }
        throw new Error("Electron API not available");
    } catch (error) {
        console.error("Installation failed", error);
        throw error;
    }
};

export const removeAddon = async (id) => {
    if (window.electronAPI?.addonRemove) {
        await window.electronAPI.addonRemove(id);
        return;
    }
};

export const fetchAddonStreams = async (addon, type, id) => {
    try {
        const name = addon.name || addon.manifest?.name || 'Unknown Addon';
        console.log(`[Addons] Fetching streams for ${type}/${id} from ${name}`);
        
        // 1. Try to get the base URL from standard properties
        let targetUrl = addon.baseUrl || addon.transportUrl || addon.manifest?.transportUrl;
        
        // Handle 'url' property from Main App structure
        if (!targetUrl && addon.url) {
             if (addon.url.endsWith('/manifest.json')) {
                 targetUrl = addon.url.replace('/manifest.json', '');
             } else {
                 targetUrl = addon.url;
             }
        }
        
        // 2. If no explicit transportUrl, try to derive from manifestUrl
        if (!targetUrl && addon.manifestUrl) {
            // Remove /manifest.json suffix to get base
            targetUrl = addon.manifestUrl.replace('/manifest.json', '');
        }

        if (!targetUrl) {
            console.error(`[Addons] No transport/base URL found for ${name}. Addon object:`, addon);
            return [];
        }
        
        // Ensure no trailing slash
        if (targetUrl.endsWith('/')) targetUrl = targetUrl.slice(0, -1);

        // Construct stream URL
        const url = `${targetUrl}/stream/${type}/${id}.json`;
        console.log(`[Addons] Requesting URL: ${url}`);
        
        const response = await fetch(url);
        if (!response.ok) {
            console.error(`[Addons] HTTP Error ${response.status} fetching streams from ${name}: ${response.statusText}`);
            return [];
        }
        
        const data = await response.json();
        if (!data.streams) {
            console.warn(`[Addons] No 'streams' property in response from ${name}:`, data);
        }
        
        console.log(`[Addons] Received ${data.streams?.length || 0} streams from ${name}`);
        return data.streams || [];
    } catch (e) {
        console.error(`[Addons] Exception fetching from ${addon?.name || 'addon'}`, e);
        return [];
    }
};

export const parseAddonStream = (stream, addonName) => {
    const fullText = (stream.name + ' ' + (stream.title || '') + ' ' + (stream.description || '')).toLowerCase();

    // Extract seeders: 👤 100 or 👥 1
    const seederMatch = (stream.title || '' + stream.description || '').match(/[👤👥]\s*(\d+)/);
    const seeders = seederMatch ? parseInt(seederMatch[1]) : 0;

    // Extract size: 💾 6.91 GB or 📦 92.9 GB or behaviorHints.videoSize
    let size = 'N/A';
    let sizeBytes = 0;

    if (stream.behaviorHints?.videoSize) {
        sizeBytes = stream.behaviorHints.videoSize;
        size = (sizeBytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    } else {
        const sizeMatch = (stream.title || '' + stream.description || '').match(/[💾📦]\s*([\d.]+)\s*([GM]B)/i);
        if (sizeMatch) {
            const val = parseFloat(sizeMatch[1]);
            const unit = sizeMatch[2].toUpperCase();
            size = `${val} ${unit}`;
            sizeBytes = val * (unit === 'GB' ? 1024 * 1024 * 1024 : 1024 * 1024);
        }
    }

    // Resolution parsing
    let quality = 'Unknown';
    if (fullText.includes('2160p') || fullText.includes('4k')) quality = '4K';
    else if (fullText.includes('1080p')) quality = '1080p';
    else if (fullText.includes('720p')) quality = '720p';
    else if (fullText.includes('480p')) quality = '480p';

    // Magnet or URL construction
    let playUrl = stream.url; // Direct URL support
    if (!playUrl && stream.infoHash) {
        const trackers = (stream.sources || []).filter(s => s.startsWith('tracker:')).map(s => `&tr=${encodeURIComponent(s.replace('tracker:', ''))}`).join('');
        playUrl = `magnet:?xt=urn:btih:${stream.infoHash}&dn=${encodeURIComponent(stream.behaviorHints?.filename || 'stream')}${trackers}`;
    }

    // Title construction: use filename or behaviorHints if title is messy
    let displayTitle = (stream.title || '').split('\n')[0] || stream.behaviorHints?.filename || stream.name;
    if (displayTitle.length < 5 && stream.behaviorHints?.filename) {
        displayTitle = stream.behaviorHints.filename;
    }

    // Capture cached icon (⚡) if present in the stream name or title
    const streamName = stream.name || '';
    const cachedIcon = streamName.includes('⚡') ? '⚡ ' : '';

    return {
        id: stream.infoHash || stream.url || Math.random().toString(),
        title: displayTitle,
        fullTitle: stream.title || stream.description || '',
        size: size,
        sizeBytes: sizeBytes,
        seeders: seeders,
        peers: 0,
        indexer: `${cachedIcon}${addonName}`, // Include emoji in indexer for the filter to see
        magnet: playUrl,
        quality: quality,
        codec: fullText.includes('x265') || fullText.includes('hevc') ? 'HEVC' : 'x264',
        hdr: fullText.includes('hdr') ? 'HDR' : (fullText.includes('dv') ? 'Dolby Vision' : null),
        externalUrl: stream.externalUrl, // Preserve externalUrl for stremio:/// links
        url: stream.url || stream.externalUrl // Also set url property
    };
};