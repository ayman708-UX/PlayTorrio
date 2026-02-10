import { 
    getMovieDetails, 
    getTVShowDetails, 
    getSeasonEpisodes, 
    getImageUrl,
    getMovieImages,
    getTVShowImages,
    getMovieVideos,
    getTVShowVideos,
    getEpisodeImages,
    getExternalIds,
    findByExternalId,
    searchMulti
} from './api.js';
import { searchJackett, getJackettKey, setJackettKey, getJackettSettings } from './jackett.js';
import { searchProwlarr, getProwlarrKey, setProwlarrKey, getProwlarrSettings } from './prowlarr.js';
import { getInstalledAddons, installAddon, removeAddon, fetchAddonStreams, parseAddonStream } from './addons.js';
import { initDebridUI, initNodeMPVUI, getDebridSettings } from './debrid.js';
import { 
    fetchStremioMeta, 
    fetchStremioStreams, 
    parseStremioStream, 
    isStremioAddonId,
    extractAddonUrl,
    formatStremioMeta,
    getVideoId
} from './stremio-addon.js';

// Helper functions for parsing torrent/stream info
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

const params = new URLSearchParams(window.location.search);
const type = params.get('type');
const id = params.get('id');
const addonId = params.get('addonId');
const urlSeason = params.get('season');
const urlEpisode = params.get('episode');

// Track both TMDB ID and IMDB ID separately for proper subtitle loading
let currentTmdbId = null;

if (!type || !id) {
    window.location.href = 'index.html';
}

const isTV = type === 'tv' || type === 'series';
let currentDetails = null;
let currentSeason = urlSeason ? parseInt(urlSeason) : 1;
let currentEpisode = urlEpisode ? parseInt(urlEpisode) : null;
let currentImdbId = null;
let allSources = [];
// Set default provider - if addonId is in URL, use that, otherwise default to jackett
let currentProvider = addonId || 'jackett';

// DOM Elements
const loadingOverlay = document.getElementById('loading-overlay');
const contentContainer = document.getElementById('content-container');
const backdropImage = document.getElementById('backdrop-image');
const addonTabsContainer = document.getElementById('addon-tabs');
const mediaContainer = document.getElementById('media-container');
const screenshotsSection = document.getElementById('screenshots-section');
const screenshotsGrid = document.getElementById('screenshots-grid');
const trailerSection = document.getElementById('trailer-section');
const trailerContainer = document.getElementById('trailer-container');
const trailerPlaceholder = document.getElementById('trailer-placeholder');
const screenshotsTab = document.getElementById('screenshots-tab');
const trailerTab = document.getElementById('trailer-tab');
const imageModal = document.getElementById('image-modal');
const modalImage = document.getElementById('modal-image');
const closeImageModal = document.getElementById('close-image-modal');

// Trailer data storage
let currentTrailerKey = null;

// Play Loading Overlay functions
const playLoadingOverlay = document.getElementById('play-loading-overlay');
const playLoadingText = document.getElementById('play-loading-text');

function showPlayLoading(text = 'Preparing stream...') {
    if (playLoadingOverlay) {
        playLoadingText.textContent = text;
        playLoadingOverlay.classList.remove('hidden');
    }
}

function hidePlayLoading() {
    if (playLoadingOverlay) {
        playLoadingOverlay.classList.add('hidden');
    }
}

// Fetch subtitles for PlayTorrioPlayer with 5 second timeout
async function fetchSubtitlesForPlayer(tmdbId, imdbId, seasonNum, episodeNum, mediaType) {
    const subtitles = [];
    const TIMEOUT = 5000; // 5 seconds max
    
    // Create a promise that resolves with current subtitles after timeout
    const timeoutPromise = new Promise(resolve => {
        setTimeout(() => {
            console.log('[Subtitles] Timeout reached, returning what we have');
            resolve('timeout');
        }, TIMEOUT);
    });
    
    // Fetch subtitles with timeout
    const fetchPromise = (async () => {
        const fetchPromises = [];
        
        // 1. Fetch from Wyzie
        if (tmdbId) {
            fetchPromises.push((async () => {
                try {
                    let wyzieUrl = `https://sub.wyzie.ru/search?id=${tmdbId}`;
                    if (seasonNum && episodeNum) wyzieUrl += `&season=${seasonNum}&episode=${episodeNum}`;
                    
                    const res = await fetch(wyzieUrl);
                    const wyzieData = await res.json();
                    
                    if (wyzieData && wyzieData.length > 0) {
                        wyzieData.forEach(sub => {
                            if (sub.url) {
                                subtitles.push({
                                    provider: 'Wyzie',
                                    name: sub.display || sub.languageName || 'Unknown',
                                    url: sub.url
                                });
                            }
                        });
                    }
                } catch (e) {
                    console.warn('[Subtitles] Wyzie fetch error:', e);
                }
            })());
        }
        
        // 2. Fetch from installed Stremio addons
        fetchPromises.push((async () => {
            try {
                const { getInstalledAddons } = await import('./addons.js');
                const addons = await getInstalledAddons();
                
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
                        
                        const resourceId = mediaType === 'tv' && seasonNum && episodeNum
                            ? `${imdbId}:${seasonNum}:${episodeNum}`
                            : imdbId;
                        
                        const endpoint = `${baseUrl}/subtitles/${mediaType}/${encodeURIComponent(resourceId)}.json`;
                        const res = await fetch(endpoint);
                        
                        if (res.ok) {
                            const data = await res.json();
                            const addonSubs = data.subtitles || [];
                            const addonName = addon.manifest?.name || 'Addon';
                            
                            addonSubs.forEach(sub => {
                                if (sub.url) {
                                    subtitles.push({
                                        provider: addonName,
                                        name: sub.lang || sub.language || 'Unknown',
                                        url: sub.url
                                    });
                                }
                            });
                        }
                    } catch (e) {
                        // Addon doesn't support subtitles for this content
                    }
                });
                
                await Promise.allSettled(addonPromises);
            } catch (e) {
                console.warn('[Subtitles] Addon fetch error:', e);
            }
        })());
        
        await Promise.allSettled(fetchPromises);
        return 'done';
    })();
    
    // Race between fetch and timeout
    await Promise.race([fetchPromise, timeoutPromise]);
    
    console.log(`[Subtitles] Returning ${subtitles.length} subtitles`);
    return subtitles;
}

// Open player in iframe overlay instead of separate window
async function openPlayerInIframe(options) {
    const {
        url,
        tmdbId,
        imdbId,
        seasonNum,
        episodeNum,
        type,
        isDebrid,
        isBasicMode,
        showName,
        provider,
        providerUrl,
        quality,
        sourceInfo // New: source info for replay
    } = options;
    
    // Save to Continue Watching with source info
    try {
        const resumeKey = `${type || (isTV ? 'tv' : 'movie')}_${tmdbId || id}${seasonNum ? `_s${seasonNum}` : ''}${episodeNum ? `_e${episodeNum}` : ''}`;
        const resumeData = {
            key: resumeKey,
            position: 0,
            duration: 1, // Will be updated by player
            title: showName || currentDetails?.title || currentDetails?.name || 'Unknown',
            poster_path: currentDetails?.poster_path || null,
            tmdb_id: tmdbId || id,
            media_type: type || (isTV ? 'tv' : 'movie'),
            season: seasonNum || null,
            episode: episodeNum || null,
            sourceInfo: sourceInfo || {
                provider: provider || currentProvider || null,
                url: url || null,
                magnet: options.magnet || null,
                torrentTitle: options.torrentTitle || null,
                streamUrl: url || null
            }
        };
        
        fetch('/api/resume', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(resumeData)
        }).catch(e => console.warn('[Resume] Failed to save:', e));
    } catch (e) {
        console.warn('[Resume] Error preparing save:', e);
    }
    
    // Check player settings
    try {
        const settingsRes = await fetch('/api/settings');
        const settings = await settingsRes.json();
        
        // Determine player type (default to playtorrio)
        const playerType = settings.playerType || (settings.useNodeMPV ? 'nodempv' : 'playtorrio');
        
        if (playerType === 'nodempv') {
            // Use NodeMPV player via Electron IPC
            if (window.electronAPI?.spawnMpvjsPlayer) {
                console.log('[Player] Using NodeMPV player');
                window.electronAPI.spawnMpvjsPlayer(options);
                setTimeout(hidePlayLoading, 500);
                return { success: true };
            }
            // Fall through to HTML5 if electron API not available
        } else if (playerType === 'playtorrio') {
            // Use PlayTorrioPlayer (external player with IPC bridge and subtitle support)
            console.log('[Player] Using PlayTorrioPlayer with IPC bridge');
            try {
                const mediaType = type || (isTV ? 'tv' : 'movie');
                
                console.log(`[Player] Launching with TMDB:${tmdbId}, IMDB:${imdbId}, S${seasonNum}E${episodeNum}`);
                
                // BasicMode: stop torrent when player closes
                const response = await fetch('/api/playtorrioplayer', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        url, 
                        tmdbId: tmdbId || currentTmdbId || id,
                        imdbId: imdbId || currentImdbId,
                        seasonNum,
                        episodeNum,
                        mediaType,
                        stopOnClose: true 
                    })
                });
                const result = await response.json();
                if (result.success) {
                    hidePlayLoading();
                    return { success: true, externalPlayer: true };
                } else {
                    console.warn('[Player] PlayTorrioPlayer failed:', result.error);
                    // Fall through to HTML5 player as fallback
                }
            } catch (e) {
                console.warn('[Player] PlayTorrioPlayer error:', e);
                // Fall through to HTML5 player as fallback
            }
        }
        // playerType === 'builtin' falls through to HTML5 player below
        
    } catch (e) {
        console.warn('[Player] Failed to check settings:', e);
    }
    
    // HTML5 Built-in Player (default fallback)
    console.log('[Player] Using Built-in HTML5 player');
    console.log('[Player] IDs being passed:', { tmdbId, imdbId, seasonNum, episodeNum, type });
    
    // Build player URL with query params for HTML5 player
    const params = new URLSearchParams();
    if (url) params.append('url', url);
    if (tmdbId) params.append('tmdbId', tmdbId);
    if (imdbId) params.append('imdbId', imdbId);
    if (seasonNum) params.append('season', seasonNum);
    if (episodeNum) params.append('episode', episodeNum);
    if (type) params.append('type', type);
    if (isDebrid) params.append('isDebrid', '1');
    if (isBasicMode) params.append('isBasicMode', '1');
    if (showName) params.append('showName', showName);
    if (provider) params.append('provider', provider);
    if (providerUrl) params.append('providerUrl', providerUrl);
    if (quality) params.append('quality', quality);
    
    const playerUrl = `http://localhost:6987/player.html?${params.toString()}`;
    console.log('[Player] Full player URL:', playerUrl);
    
    // Extract stream hash for cleanup (if local torrent stream)
    let streamHash = null;
    let isAltEngine = false;
    if (url && (url.includes('/api/stream-file') || url.includes('/api/alt-stream-file'))) {
        try {
            const urlObj = new URL(url);
            streamHash = urlObj.searchParams.get('hash');
            isAltEngine = url.includes('/api/alt-stream-file');
        } catch (e) {}
    }
    
    // Store alt engine flag for cleanup
    if (streamHash && isAltEngine) {
        window._altEngineStreamHash = streamHash;
    }
    
    // Use the playerOverlay from the parent page (HTML5 player)
    if (window.playerOverlay) {
        window.playerOverlay.open(playerUrl, streamHash, isAltEngine);
        hidePlayLoading();
        return { success: true };
    }
    
    // Fallback to electron API
    if (window.electronAPI?.spawnMpvjsPlayer) {
        window.electronAPI.spawnMpvjsPlayer(options);
        setTimeout(hidePlayLoading, 500);
        return { success: true };
    }
    
    // Last resort: open in new tab
    window.open(playerUrl, '_blank');
    hidePlayLoading();
    return { success: true };
}

// Listen for player window opening to hide the loading overlay
if (window.electronAPI) {
    // When player opens successfully, hide the loading
    window.electronAPI.onPlayerOpened?.(() => {
        hidePlayLoading();
    });
}

const hideImageModal = () => {
    imageModal.classList.add('opacity-0');
    setTimeout(() => {
        imageModal.classList.add('hidden');
        modalImage.src = '';
    }, 300);
};

if (closeImageModal) {
    closeImageModal.addEventListener('click', hideImageModal);
}

if (imageModal) {
    imageModal.addEventListener('click', (e) => {
        if (e.target === imageModal || e.target.closest('.relative') === null) {
            hideImageModal();
        }
    });
}

const sortSelect = document.getElementById('sort-select');
const qualityFilter = document.getElementById('quality-filter');
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const settingsContent = document.getElementById('settings-content');
const closeSettingsBtn = document.getElementById('close-settings');
const saveSettingsBtn = document.getElementById('save-settings');
const toggleConsoleBtn = document.getElementById('toggle-console-btn');
const jackettApiInput = document.getElementById('jackett-api-input');
const jackettUrlInput = document.getElementById('jackett-url-input');
const defaultSortInput = document.getElementById('default-sort-input');
const addonManifestInput = document.getElementById('addon-manifest-input');
const installAddonBtn = document.getElementById('install-addon-btn');
const installedAddonsList = document.getElementById('installed-addons-list');
const addonItemTemplate = document.getElementById('addon-item-template');
const seasonSection = document.getElementById('season-section');
const seasonList = document.getElementById('season-list');
const episodeSection = document.getElementById('episode-section');
const episodeGrid = document.getElementById('episode-grid');
const episodesTitle = document.getElementById('episodes-title');
const sourcesSection = document.getElementById('sources-section');
const sourcesList = document.getElementById('sources-list');
const selectEpisodeMsg = document.getElementById('select-episode-msg');
const sourcesTitle = document.getElementById('sources-title');
const seasonBtnTemplate = document.getElementById('season-btn-template');
const episodeCardTemplate = document.getElementById('episode-card-template');
const sourceCardTemplate = document.getElementById('source-card-template');

const renderAddonTabs = async () => {
    if (!addonTabsContainer) return;
    addonTabsContainer.innerHTML = '';
    
    const allAddons = await getInstalledAddons();
    
    // Filter to only show addons that provide 'stream' resources.
    // Metadata-only addons (like AIOMetadata) should NOT appear here.
    const addons = allAddons.filter(addon => {
        const resources = addon.manifest?.resources || [];
        // Check if 'stream' is in resources array (can be string or object with name property)
        const hasStream = resources.some(r => {
            if (typeof r === 'string') return r === 'stream';
            if (typeof r === 'object' && r !== null) return r.name === 'stream';
            return false;
        });
        // Also check if resources array includes 'stream' directly (some manifests use simple string arrays)
        const hasStreamDirect = Array.isArray(resources) && resources.includes('stream');
        return hasStream || hasStreamDirect;
    });
    
    // Jackett tab
    const jackettTab = document.createElement('button');
    jackettTab.className = `px-4 py-1.5 rounded-full text-xs font-bold transition-all ${currentProvider === 'jackett' ? 'bg-purple-600 text-white shadow-lg' : 'bg-gray-800 text-gray-400 hover:text-white'}`;
    jackettTab.textContent = 'Jackett';
    jackettTab.onclick = async () => {
        console.log('[AddonTabs] Jackett clicked');
        currentProvider = 'jackett';
        document.querySelectorAll('#addon-tabs button').forEach(btn => {
            btn.classList.remove('bg-purple-600', 'text-white', 'shadow-lg');
            btn.classList.add('bg-gray-800', 'text-gray-400');
        });
        jackettTab.classList.remove('bg-gray-800', 'text-gray-400');
        jackettTab.classList.add('bg-purple-600', 'text-white', 'shadow-lg');
        await renderSources();
    };
    addonTabsContainer.appendChild(jackettTab);

    // Prowlarr tab
    const prowlarrTab = document.createElement('button');
    prowlarrTab.className = `px-4 py-1.5 rounded-full text-xs font-bold transition-all ${currentProvider === 'prowlarr' ? 'bg-purple-600 text-white shadow-lg' : 'bg-gray-800 text-gray-400 hover:text-white'}`;
    prowlarrTab.textContent = 'Prowlarr';
    prowlarrTab.onclick = async () => {
        console.log('[AddonTabs] Prowlarr clicked');
        currentProvider = 'prowlarr';
        document.querySelectorAll('#addon-tabs button').forEach(btn => {
            btn.classList.remove('bg-purple-600', 'text-white', 'shadow-lg');
            btn.classList.add('bg-gray-800', 'text-gray-400');
        });
        prowlarrTab.classList.remove('bg-gray-800', 'text-gray-400');
        prowlarrTab.classList.add('bg-purple-600', 'text-white', 'shadow-lg');
        await renderSources();
    };
    addonTabsContainer.appendChild(prowlarrTab);

    // 111477 tab (native source)
    const tab111477 = document.createElement('button');
    tab111477.className = `px-4 py-1.5 rounded-full text-xs font-bold transition-all ${currentProvider === '111477' ? 'bg-purple-600 text-white shadow-lg' : 'bg-gray-800 text-gray-400 hover:text-white'}`;
    tab111477.textContent = '111477';
    tab111477.onclick = async () => {
        console.log('[AddonTabs] 111477 clicked');
        currentProvider = '111477';
        document.querySelectorAll('#addon-tabs button').forEach(btn => {
            btn.classList.remove('bg-purple-600', 'text-white', 'shadow-lg');
            btn.classList.add('bg-gray-800', 'text-gray-400');
        });
        tab111477.classList.remove('bg-gray-800', 'text-gray-400');
        tab111477.classList.add('bg-purple-600', 'text-white', 'shadow-lg');
        await renderSources();
    };
    addonTabsContainer.appendChild(tab111477);

    // PlayTorrio (Torrentless) tab (native source)
    const torrentlessTab = document.createElement('button');
    torrentlessTab.className = `px-4 py-1.5 rounded-full text-xs font-bold transition-all ${currentProvider === 'torrentless' ? 'bg-purple-600 text-white shadow-lg' : 'bg-gray-800 text-gray-400 hover:text-white'}`;
    torrentlessTab.textContent = 'PlayTorrio';
    torrentlessTab.onclick = async () => {
        console.log('[AddonTabs] PlayTorrio clicked');
        currentProvider = 'torrentless';
        document.querySelectorAll('#addon-tabs button').forEach(btn => {
            btn.classList.remove('bg-purple-600', 'text-white', 'shadow-lg');
            btn.classList.add('bg-gray-800', 'text-gray-400');
        });
        torrentlessTab.classList.remove('bg-gray-800', 'text-gray-400');
        torrentlessTab.classList.add('bg-purple-600', 'text-white', 'shadow-lg');
        await renderSources();
    };
    addonTabsContainer.appendChild(torrentlessTab);

    addons.forEach(addon => {
        const tab = document.createElement('button');
        const addonId = addon.manifest?.id || addon.id;
        const addonName = addon.manifest?.name || addon.name;
        const addonLogo = addon.manifest?.logo || addon.logo;

        tab.className = `px-4 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-2 ${currentProvider === addonId ? 'bg-purple-600 text-white shadow-lg' : 'bg-gray-800 text-gray-400 hover:text-white'}`;
        if (addonLogo) {
            const img = document.createElement('img');
            img.src = addonLogo;
            img.className = 'w-3 h-3 object-contain';
            tab.appendChild(img);
        }
        const nameSpan = document.createElement('span');
        nameSpan.textContent = addonName;
        tab.appendChild(nameSpan);

        tab.onclick = async () => {
            console.log('[AddonTabs] Addon clicked:', addonId);
            currentProvider = addonId;
            document.querySelectorAll('#addon-tabs button').forEach(btn => {
                btn.classList.remove('bg-purple-600', 'text-white', 'shadow-lg');
                btn.classList.add('bg-gray-800', 'text-gray-400');
            });
            tab.classList.remove('bg-gray-800', 'text-gray-400');
            tab.classList.add('bg-purple-600', 'text-white', 'shadow-lg');
            await renderSources();
        };
        addonTabsContainer.appendChild(tab);
    });
};

const renderDetails = (data) => {
    if (data.backdrop_path) {
        backdropImage.style.backgroundImage = `url(${getImageUrl(data.backdrop_path, 'w1280')})`;
        backdropImage.classList.remove('opacity-0');
    }
    const poster = document.getElementById('detail-poster');
    if (poster) poster.src = getImageUrl(data.poster_path, 'w500');
    
    const title = document.getElementById('detail-title');
    if (title) title.textContent = data.title || data.name;
    
    const date = data.release_date || data.first_air_date;
    const yearEl = document.getElementById('detail-year');
    if (yearEl) yearEl.textContent = date ? date.split('-')[0] : '';
    
    const runtime = data.runtime || (data.episode_run_time ? data.episode_run_time[0] : 0);
    const runtimeEl = document.getElementById('detail-runtime');
    if (runtime && runtimeEl) {
        runtimeEl.textContent = `${runtime} min`;
        const sep = document.querySelector('.separator');
        if (sep) sep.classList.remove('hidden');
    }
    
    const ratingEl = document.getElementById('detail-rating');
    if (ratingEl) ratingEl.textContent = data.vote_average ? data.vote_average.toFixed(1) : 'N/A';
    
    const genresEl = document.getElementById('detail-genres');
    if (data.genres && genresEl) {
        genresEl.innerHTML = '';
        data.genres.forEach(genre => {
            const a = document.createElement('a');
            a.className = 'px-3 py-1 bg-purple-600/20 text-purple-300 rounded-full text-sm border border-purple-500/30 hover:bg-purple-600 hover:text-white transition-colors cursor-pointer';
            a.textContent = genre.name;
            a.href = `grid.html?type=genre&id=${genre.id}&name=${encodeURIComponent(genre.name)}`;
            genresEl.appendChild(a);
        });
    }
    const director = data.credits?.crew?.find(c => c.job === 'Director')?.name;
    const dirEl = document.getElementById('detail-director');
    if (director && dirEl) {
        dirEl.textContent = director;
        const dirContainer = document.getElementById('detail-director-container');
        if (dirContainer) dirContainer.classList.remove('hidden');
    }
    const overviewEl = document.getElementById('detail-overview');
    if (overviewEl) overviewEl.textContent = data.overview || 'No description available.';
    
    const castEl = document.getElementById('detail-cast');
    if (data.credits?.cast && castEl) {
        castEl.innerHTML = '';
        data.credits.cast.slice(0, 8).forEach(member => {
            const a = document.createElement('a');
            a.className = 'px-3 py-1.5 bg-gray-800/60 text-gray-300 rounded-full text-sm hover:bg-gray-700 hover:text-white transition-colors cursor-pointer';
            a.textContent = member.name;
            a.href = `grid.html?type=person&id=${member.id}&name=${encodeURIComponent(member.name)}`;
            castEl.appendChild(a);
        });
    }
};

const loadScreenshots = async () => {
    try {
        const fetchFn = isTV ? getTVShowImages : getMovieImages;
        const data = await fetchFn(id);
        const images = data.backdrops || [];
        
        if (images.length > 0) {
            mediaContainer.classList.remove('hidden');
            screenshotsGrid.innerHTML = '';
            
            images.slice(0, 4).forEach((img) => {
                const url = getImageUrl(img.file_path, 'w500');
                const fullUrl = getImageUrl(img.file_path, 'original');
                
                const div = document.createElement('div');
                div.className = 'aspect-video rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-purple-500 transition-all transform hover:scale-[1.02] bg-gray-800';
                div.innerHTML = `<img src="${url}" class="w-full h-full object-cover" loading="lazy">`;
                
                div.onclick = () => {
                    modalImage.src = fullUrl;
                    imageModal.classList.remove('hidden');
                    requestAnimationFrame(() => {
                        imageModal.classList.remove('opacity-0');
                    });
                };
                
                screenshotsGrid.appendChild(div);
            });
        }
    } catch (e) {
        console.warn('Failed to load screenshots:', e);
    }
};

const loadTrailer = async () => {
    try {
        const fetchFn = isTV ? getTVShowVideos : getMovieVideos;
        const data = await fetchFn(id);
        const videos = data.results || [];
        
        // Find the best trailer (prefer official YouTube trailers)
        const trailer = videos.find(v => 
            v.site === 'YouTube' && 
            v.type === 'Trailer' && 
            v.official === true
        ) || videos.find(v => 
            v.site === 'YouTube' && 
            v.type === 'Trailer'
        ) || videos.find(v => 
            v.site === 'YouTube' && 
            (v.type === 'Teaser' || v.type === 'Clip')
        );
        
        if (trailer) {
            currentTrailerKey = trailer.key;
            // Show trailer tab as available
            trailerTab.classList.remove('opacity-50', 'cursor-not-allowed');
            trailerTab.disabled = false;
        } else {
            currentTrailerKey = null;
            // Dim the trailer tab if no trailer available
            trailerTab.classList.add('opacity-50');
        }
    } catch (e) {
        console.warn('Failed to load trailer:', e);
        currentTrailerKey = null;
    }
};

// Tab switching logic
const switchToScreenshots = () => {
    screenshotsTab.classList.remove('bg-gray-800', 'text-gray-400');
    screenshotsTab.classList.add('bg-purple-600', 'text-white');
    trailerTab.classList.remove('bg-purple-600', 'text-white');
    trailerTab.classList.add('bg-gray-800', 'text-gray-400');
    
    screenshotsSection.classList.remove('hidden');
    trailerSection.classList.add('hidden');
    
    // Stop trailer playback when switching away
    const iframe = trailerContainer.querySelector('iframe');
    if (iframe) {
        iframe.src = '';
    }
};

const switchToTrailer = () => {
    if (!currentTrailerKey) {
        // No trailer available, show placeholder
        trailerPlaceholder.classList.remove('hidden');
        const iframe = trailerContainer.querySelector('iframe');
        if (iframe) iframe.remove();
    } else {
        trailerPlaceholder.classList.add('hidden');
        
        // Create or update iframe
        let iframe = trailerContainer.querySelector('iframe');
        if (!iframe) {
            iframe = document.createElement('iframe');
            iframe.className = 'w-full h-full';
            iframe.setAttribute('allowfullscreen', '');
            iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
            iframe.setAttribute('frameborder', '0');
            trailerContainer.appendChild(iframe);
        }
        iframe.src = `https://www.youtube.com/embed/${currentTrailerKey}?autoplay=1&rel=0`;
    }
    
    trailerTab.classList.remove('bg-gray-800', 'text-gray-400');
    trailerTab.classList.add('bg-purple-600', 'text-white');
    screenshotsTab.classList.remove('bg-purple-600', 'text-white');
    screenshotsTab.classList.add('bg-gray-800', 'text-gray-400');
    
    trailerSection.classList.remove('hidden');
    screenshotsSection.classList.add('hidden');
};

// Initialize tab click handlers
if (screenshotsTab) {
    screenshotsTab.addEventListener('click', switchToScreenshots);
}
if (trailerTab) {
    trailerTab.addEventListener('click', switchToTrailer);
}

// ============================================
// EMBEDDED SERVERS FUNCTIONALITY
// ============================================

const embeddedServers = {
    'CinemaOS': (type, id, season, episode) =>
        type === 'movie'
            ? `https://cinemaos.tech/player/${id}`
            : `https://cinemaos.tech/player/${id}/${season}/${episode}`,
    'Videasy': (type, id, season, episode) =>
        type === 'movie'
            ? `https://player.videasy.net/movie/${id}`
            : `https://player.videasy.net/tv/${id}/${season}/${episode}`,
    'Vidlink': (type, id, season, episode) =>
        type === 'movie'
            ? `https://vidlink.pro/movie/${id}`
            : `https://vidlink.pro/tv/${id}/${season}/${episode}`,
    'LunaStream': (type, id, season, episode) =>
        type === 'movie'
            ? `https://lunastream.fun/watch/movie/${id}`
            : `https://lunastream.fun/watch/tv/${id}/${season}/${episode}`,
    'VidRock': (type, id, season, episode) =>
        type === 'movie'
            ? `https://vidrock.net/movie/${id}`
            : `https://vidrock.net/tv/${id}/${season}/${episode}`,
    'HexaWatch': (type, id, season, episode) =>
        type === 'movie'
            ? `https://hexa.watch/watch/movie/${id}`
            : `https://hexa.watch/watch/tv/${id}/${season}/${episode}`,
    'FMovies': (type, id, season, episode) =>
        type === 'movie'
            ? `https://www.fmovies.gd/watch/movie/${id}`
            : `https://www.fmovies.gd/watch/tv/${id}/${season}/${episode}`,
    'Xprime': (type, id, season, episode) =>
        type === 'movie'
            ? `https://xprime.tv/watch/${id}`
            : `https://xprime.tv/watch/${id}/${season}/${episode}`,
    'Vidnest': (type, id, season, episode) =>
        type === 'movie'
            ? `https://vidnest.fun/movie/${id}`
            : `https://vidnest.fun/tv/${id}/${season}/${episode}`,
    'VeloraTV': (type, id, season, episode) =>
        type === 'movie'
            ? `https://veloratv.ru/watch/movie/${id}`
            : `https://veloratv.ru/watch/tv/${id}/${season}/${episode}`,
    'Vidfast 1': (type, id, season, episode) =>
        type === 'movie'
            ? `https://vidfast.pro/movie/${id}`
            : `https://vidfast.pro/tv/${id}/${season}/${episode}`,
    'Vidfast 2': (type, id, season, episode) =>
        type === 'movie'
            ? `https://vidfast.to/embed/movie/${id}`
            : `https://vidfast.to/embed/tv/${id}/${season}/${episode}`,
    '111Movies': (type, id, season, episode) =>
        type === 'movie'
            ? `https://111movies.com/movie/${id}`
            : `https://111movies.com/tv/${id}/${season}/${episode}`,
    'VidSrc 1': (type, id, season, episode) =>
        type === 'movie'
            ? `https://vidsrc.wtf/api/1/movie/?id=${id}&color=e01621`
            : `https://vidsrc.wtf/api/1/tv/?id=${id}&s=${season}&e=${episode}&color=e01621`,
    'VidSrc 2': (type, id, season, episode) =>
        type === 'movie'
            ? `https://vidsrc.wtf/api/2/movie/?id=${id}&color=e01621`
            : `https://vidsrc.wtf/api/2/tv/?id=${id}&s=${season}&e=${episode}&color=e01621`,
    'VidSrc 3': (type, id, season, episode) =>
        type === 'movie'
            ? `https://vidsrc.wtf/api/3/movie/?id=${id}&color=e01621`
            : `https://vidsrc.wtf/api/3/tv/?id=${id}&s=${season}&e=${episode}&color=e01621`,
    'VidSrc 4': (type, id, season, episode) =>
        type === 'movie'
            ? `https://vidsrc.wtf/api/4/movie/?id=${id}&color=e01621`
            : `https://vidsrc.wtf/api/4/tv/?id=${id}&s=${season}&e=${episode}&color=e01621`,
    'PrimeSrc': (type, id, season, episode) =>
        type === 'movie'
            ? `https://primesrc.me/embed/movie?tmdb=${id}`
            : `https://primesrc.me/embed/tv?tmdb=${id}&season=${season}&episode=${episode}`,
    'MovieClub': (type, id, season, episode) =>
        type === 'movie'
            ? `https://moviesapi.club/movie/${id}`
            : `https://moviesapi.club/tv/${id}-${season}-${episode}`,
    'MapleTV': (type, id, season, episode) =>
        type === 'movie'
            ? `https://mapple.uk/watch/movie/${id}`
            : `https://mapple.uk/watch/tv/${id}-${season}-${episode}`,
    '2Embed': (type, id, season, episode) =>
        `https://multiembed.mov/?video_id=${id}&tmdb=1&media_type=${type}${type === 'tv' ? `&season=${season}&episode=${episode}` : ''}`,
    'SmashyStream': (type, id, season, episode) =>
        type === 'movie'
            ? `https://player.smashy.stream/movie/${id}`
            : `https://player.smashy.stream/tv/${id}?s=${season}&e=${episode}`,
    'Autoembed': (type, id, season, episode) =>
        type === 'movie'
            ? `https://player.autoembed.cc/embed/movie/${id}`
            : `https://player.autoembed.cc/embed/tv/${id}/${season}/${episode}`,
    'GoDrivePlayer': (type, id, season, episode) =>
        type === 'movie'
            ? `https://godriveplayer.com/player.php?imdb=${id}`
            : `https://godriveplayer.com/player.php?type=tv&tmdb=${id}&season=${season}&episode=${episode}`,
    'VidWTF Premium': (type, id, season, episode) =>
        type === 'movie'
            ? `https://vidsrc.wtf/api/4/movie/?id=${id}&color=e01621`
            : `https://vidsrc.wtf/api/4/tv/?id=${id}&s=${season}&e=${episode}&color=e01621`,
    'CinemaOS Embed': (type, id, season, episode) =>
        type === 'movie'
            ? `https://cinemaos.tech/embed/movie/${id}`
            : `https://cinemaos.tech/embed/tv/${id}/${season}/${episode}`,
    'GDrivePlayer API': (type, id, season, episode) =>
        type === 'movie'
            ? `https://databasegdriveplayer.xyz/player.php?tmdb=${id}`
            : `https://database.gdriveplayer.us/player.php?type=series&tmdb=${id}&season=${season}&episode=${episode}`,
    'Nontongo': (type, id, season, episode) =>
        type === 'movie'
            ? `https://nontongo.win/embed/movie/${id}`
            : `https://nontongo.win/embed/tv/${id}/${season}/${episode}`,
    'SpencerDevs': (type, id, season, episode) =>
        type === 'movie'
            ? `https://spencerdevs.xyz/movie/${id}`
            : `https://spencerdevs.xyz/tv/${id}/${season}/${episode}`,
    'VidAPI': (type, id, season, episode) =>
        type === 'movie'
            ? `https://vidapi.xyz/embed/movie/${id}`
            : `https://vidapi.xyz/embed/tv/${id}/${season}/${episode}`,
    'Vidify': (type, id, season, episode) =>
        type === 'movie'
            ? `https://vidify.top/embed/movie/${id}`
            : `https://vidify.top/embed/tv/${id}/${season}/${episode}`,
    'VidSrc CX': (type, id, season, episode) =>
        type === 'movie'
            ? `https://vidsrc.cx/embed/movie/${id}`
            : `https://vidsrc.cx/embed/tv/${id}/${season}/${episode}`,
    'VidSrc ME': (type, id, season, episode) =>
        type === 'movie'
            ? `https://vidsrc.me/embed/movie/${id}`
            : `https://vidsrc.me/embed/tv/${id}/${season}/${episode}`,
    'VidSrc TO': (type, id, season, episode) =>
        type === 'movie'
            ? `https://vidsrc.to/embed/movie/${id}`
            : `https://vidsrc.to/embed/tv/${id}/${season}/${episode}`,
    'VidSrc VIP': (type, id, season, episode) =>
        type === 'movie'
            ? `https://vidsrc.vip/embed/movie/${id}`
            : `https://vidsrc.vip/embed/tv/${id}/${season}/${episode}`,
    'VidSrc CC': (type, id, season, episode) =>
        type === 'movie'
            ? `https://vidsrc.cc/v2/embed/movie/${id}`
            : `https://vidsrc.cc/v2/embed/tv/${id}/${season}/${episode}`,
    'VidNest': (type, id, season, episode) =>
        type === 'movie'
            ? `https://vidnest.fun/movie/${id}`
            : `https://vidnest.fun/tv/${id}/${season}/${episode}`
};

// DOM elements for embedded servers
const embeddedServersTab = document.getElementById('embedded-servers-tab');
const torrentSourcesTab = document.getElementById('torrent-sources-tab');
const embeddedServersSection = document.getElementById('embedded-servers-section');
const torrentSourcesSection = document.getElementById('torrent-sources-section');
const embeddedServerSelect = document.getElementById('embedded-server-select');
const embeddedWatchBtn = document.getElementById('embedded-watch-btn');
const embeddedEpisodeWarning = document.getElementById('embedded-episode-warning');
const embeddedPlayerContainer = document.getElementById('embedded-player-container');
const embeddedPlayerIframe = document.getElementById('embedded-player-iframe');

// Populate server dropdown
if (embeddedServerSelect) {
    Object.keys(embeddedServers).forEach(serverName => {
        const option = document.createElement('option');
        option.value = serverName;
        option.textContent = serverName;
        embeddedServerSelect.appendChild(option);
    });
}

// Tab switching for embedded servers vs torrent sources
if (embeddedServersTab) {
    embeddedServersTab.addEventListener('click', () => {
        embeddedServersTab.classList.remove('bg-gray-800', 'text-gray-400');
        embeddedServersTab.classList.add('bg-purple-600', 'text-white');
        torrentSourcesTab.classList.remove('bg-purple-600', 'text-white');
        torrentSourcesTab.classList.add('bg-gray-800', 'text-gray-400');
        
        embeddedServersSection.classList.remove('hidden');
        torrentSourcesSection.classList.add('hidden');
        
        // Update warning visibility for TV shows
        if (isTV && !currentEpisode) {
            embeddedEpisodeWarning.classList.remove('hidden');
        } else {
            embeddedEpisodeWarning.classList.add('hidden');
        }
    });
}

if (torrentSourcesTab) {
    torrentSourcesTab.addEventListener('click', () => {
        torrentSourcesTab.classList.remove('bg-gray-800', 'text-gray-400');
        torrentSourcesTab.classList.add('bg-purple-600', 'text-white');
        embeddedServersTab.classList.remove('bg-purple-600', 'text-white');
        embeddedServersTab.classList.add('bg-gray-800', 'text-gray-400');
        
        torrentSourcesSection.classList.remove('hidden');
        embeddedServersSection.classList.add('hidden');
        
        // Stop any playing embedded video
        if (embeddedPlayerIframe) {
            embeddedPlayerIframe.src = '';
        }
        embeddedPlayerContainer.classList.add('hidden');
    });
}

// Watch button for embedded servers
if (embeddedWatchBtn) {
    embeddedWatchBtn.addEventListener('click', () => {
        // Check if TV show and no episode selected
        if (isTV && !currentEpisode) {
            embeddedEpisodeWarning.classList.remove('hidden');
            return;
        }
        
        const selectedServer = embeddedServerSelect.value;
        const serverFn = embeddedServers[selectedServer];
        
        if (!serverFn) {
            console.error('Server not found:', selectedServer);
            return;
        }
        
        const mediaType = isTV ? 'tv' : 'movie';
        const tmdbId = id;
        const season = currentSeason || 1;
        const episode = currentEpisode || 1;
        
        const embedUrl = serverFn(mediaType, tmdbId, season, episode);
        console.log('[Embedded Server] Loading:', selectedServer, embedUrl);
        
        // Save to Continue Watching with embedded server info
        try {
            const resumeKey = `${mediaType}_${tmdbId}${isTV ? `_s${season}_e${episode}` : ''}`;
            const resumeData = {
                key: resumeKey,
                position: 0,
                duration: 1,
                title: currentDetails?.title || currentDetails?.name || 'Unknown',
                poster_path: currentDetails?.poster_path || null,
                tmdb_id: tmdbId,
                media_type: mediaType,
                season: isTV ? season : null,
                episode: isTV ? episode : null,
                sourceInfo: {
                    provider: 'embedded',
                    embeddedServer: selectedServer,
                    url: embedUrl
                }
            };
            
            fetch('/api/resume', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(resumeData)
            }).catch(e => console.warn('[Resume] Failed to save:', e));
        } catch (e) {
            console.warn('[Resume] Error:', e);
        }
        
        // Show player and load iframe
        embeddedPlayerContainer.classList.remove('hidden');
        embeddedPlayerIframe.src = embedUrl;
        
        // Scroll player into view but keep it centered, not at the very top
        embeddedPlayerContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
}

// Function to update embedded player when episode changes (if player is visible)
const updateEmbeddedPlayerForEpisode = () => {
    // Only update if embedded servers section is visible and player is already showing
    if (embeddedServersSection && 
        !embeddedServersSection.classList.contains('hidden') && 
        embeddedPlayerContainer && 
        !embeddedPlayerContainer.classList.contains('hidden') &&
        currentEpisode) {
        
        const selectedServer = embeddedServerSelect.value;
        const serverFn = embeddedServers[selectedServer];
        
        if (!serverFn) return;
        
        const mediaType = isTV ? 'tv' : 'movie';
        const tmdbId = id;
        const season = currentSeason || 1;
        const episode = currentEpisode;
        
        const embedUrl = serverFn(mediaType, tmdbId, season, episode);
        console.log('[Embedded Server] Auto-updating for episode:', selectedServer, embedUrl);
        
        embeddedPlayerIframe.src = embedUrl;
        
        // Save to Continue Watching
        try {
            const resumeKey = `${mediaType}_${tmdbId}_s${season}_e${episode}`;
            const resumeData = {
                key: resumeKey,
                position: 0,
                duration: 1,
                title: currentDetails?.title || currentDetails?.name || 'Unknown',
                poster_path: currentDetails?.poster_path || null,
                tmdb_id: tmdbId,
                media_type: mediaType,
                season: season,
                episode: episode,
                sourceInfo: {
                    provider: 'embedded',
                    embeddedServer: selectedServer,
                    url: embedUrl
                }
            };
            
            fetch('/api/resume', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(resumeData)
            }).catch(e => console.warn('[Resume] Failed to save:', e));
        } catch (e) {
            console.warn('[Resume] Error:', e);
        }
    }
};

// Update embedded warning when episode changes
const updateEmbeddedWarning = () => {
    if (embeddedEpisodeWarning && !embeddedServersSection.classList.contains('hidden')) {
        if (isTV && !currentEpisode) {
            embeddedEpisodeWarning.classList.remove('hidden');
        } else {
            embeddedEpisodeWarning.classList.add('hidden');
        }
    }
};

// ============================================
// END EMBEDDED SERVERS
// ============================================

const renderSources = async () => {
    // Update embedded warning when sources are rendered
    updateEmbeddedWarning();
    
    if (isTV && !currentEpisode) {
        sourcesList.innerHTML = '';
        sourcesList.classList.add('hidden');
        selectEpisodeMsg.classList.remove('hidden');
        return;
    }
    sourcesList.innerHTML = '<div class="col-span-full text-center py-12"><div class="inline-block w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div><p class="text-gray-500 text-sm mt-4">Searching for sources...</p></div>';
    sourcesList.classList.remove('hidden');
    selectEpisodeMsg.classList.add('hidden');
    if (isTV) {
        sourcesTitle.innerHTML = currentEpisode ? `Available Sources <span class="text-gray-500 text-sm font-normal">— S${String(currentSeason).padStart(2, '0')}E${String(currentEpisode).padStart(2, '0')}</span>` : `Available Sources <span class="text-gray-500 text-sm font-normal">— Season ${currentSeason} Pack</span>`;
    }
    try {
        if (currentProvider === 'jackett') {
            let queries = [];
            const title = currentDetails.title || currentDetails.name;
            
            // Extract year from release_date or first_air_date
            let year = '';
            if (currentDetails.release_date) {
                year = String(currentDetails.release_date).split('-')[0];
            } else if (currentDetails.first_air_date) {
                year = String(currentDetails.first_air_date).split('-')[0];
            } else if (currentDetails.releaseInfo) {
                // For custom addon items that might have releaseInfo
                year = String(currentDetails.releaseInfo).match(/\d{4}/)?.[0] || '';
            }
            
            const metadata = { 
                title: title, 
                type: type, 
                year: year 
            };
            
            console.log('[Jackett] Searching for:', { title, year, type, isTV });
            
            if (isTV) {
                const s = String(currentSeason).padStart(2, '0');
                metadata.season = currentSeason;
                if (currentEpisode) {
                    const e = String(currentEpisode).padStart(2, '0');
                    queries.push(`${title} S${s}E${e}`);
                    queries.push(`${title} S${s}`);
                    metadata.episode = currentEpisode;
                } else {
                    queries.push(`${title} S${s}`);
                    metadata.episode = null;
                }
            } else {
                // For movies, try with and without year
                if (year) {
                    queries.push(`${title} ${year}`);
                }
                queries.push(title); // Also try without year
            }
            
            console.log('[Jackett] Queries:', queries);
            
            try {
                allSources = await searchJackett(queries, metadata);
                console.log('[Jackett] Found sources:', allSources.length);
            } catch (err) {
                if (err.message === 'JACKETT_CONNECTION_ERROR') {
                    sourcesList.innerHTML = `
                        <div class="col-span-full text-center py-12 px-6">
                            <div class="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                                <svg class="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                            </div>
                            <h3 class="text-white font-bold text-lg mb-2">Jackett Connection Failed</h3>
                            <p class="text-gray-400 text-sm max-w-md mx-auto">
                                Jackett is not installed, turned off, or the API key is incorrect. 
                                Please ensure Jackett is running and configured correctly in Settings.
                            </p>
                        </div>`;
                    return;
                }
                throw err; // Re-throw if it's a different error
            }
        } else if (currentProvider === 'prowlarr') {
            let queries = [];
            const title = currentDetails.title || currentDetails.name;
            
            // Extract year from release_date or first_air_date
            let year = '';
            if (currentDetails.release_date) {
                year = String(currentDetails.release_date).split('-')[0];
            } else if (currentDetails.first_air_date) {
                year = String(currentDetails.first_air_date).split('-')[0];
            } else if (currentDetails.releaseInfo) {
                year = String(currentDetails.releaseInfo).match(/\d{4}/)?.[0] || '';
            }
            
            const metadata = { 
                title: title, 
                type: type, 
                year: year 
            };
            
            console.log('[Prowlarr] Searching for:', { title, year, type, isTV });
            
            if (isTV) {
                const s = String(currentSeason).padStart(2, '0');
                metadata.season = currentSeason;
                if (currentEpisode) {
                    const e = String(currentEpisode).padStart(2, '0');
                    queries.push(`${title} S${s}E${e}`);
                    queries.push(`${title} S${s}`);
                    metadata.episode = currentEpisode;
                } else {
                    queries.push(`${title} S${s}`);
                    metadata.episode = null;
                }
            } else {
                // For movies, try with and without year
                if (year) {
                    queries.push(`${title} ${year}`);
                }
                queries.push(title); // Also try without year
            }
            
            console.log('[Prowlarr] Queries:', queries);
            
            try {
                allSources = await searchProwlarr(queries, metadata);
                console.log('[Prowlarr] Found sources:', allSources.length);
            } catch (err) {
                if (err.message === 'PROWLARR_CONNECTION_ERROR') {
                    sourcesList.innerHTML = `
                        <div class="col-span-full text-center py-12 px-6">
                            <div class="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                                <svg class="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                            </div>
                            <h3 class="text-white font-bold text-lg mb-2">Prowlarr Connection Failed</h3>
                            <p class="text-gray-400 text-sm max-w-md mx-auto">
                                Prowlarr is not installed, turned off, or the API key is incorrect. 
                                Please ensure Prowlarr is running and configured correctly in Settings.
                            </p>
                        </div>`;
                    return;
                }
                throw err; // Re-throw if it's a different error
            }
        } else if (currentProvider === '111477') {
            // 111477 native source - direct streaming links
            console.log('[Sources] Fetching from 111477...');
            
            try {
                const tmdbId = id;
                
                if (!tmdbId) {
                    sourcesList.innerHTML = '<div class="text-center py-12 text-gray-500">No TMDB ID available.</div>';
                    return;
                }
                
                let apiUrl;
                
                if (isTV) {
                    if (currentEpisode) {
                        apiUrl = `http://localhost:6987/111477/api/tmdb/tv/${encodeURIComponent(tmdbId)}/season/${encodeURIComponent(currentSeason)}/episode/${encodeURIComponent(currentEpisode)}`;
                    } else {
                        sourcesList.innerHTML = '<div class="text-center py-12 text-gray-500">Please select an episode to view sources.</div>';
                        return;
                    }
                } else {
                    apiUrl = `http://localhost:6987/111477/api/tmdb/movie/${encodeURIComponent(tmdbId)}`;
                }
                
                console.log('[111477] Fetching from:', apiUrl);
                
                const response = await fetch(apiUrl);
                
                if (!response.ok) {
                    console.error('[111477] API returned error:', response.status, response.statusText);
                    sourcesList.innerHTML = `<div class="text-center py-12 text-red-400">111477 search failed (${response.status}). Try again later.</div>`;
                    return;
                }
                
                const data = await response.json();
                
                if (data.error) {
                    console.error('[111477] API error:', data.error);
                    sourcesList.innerHTML = `<div class="text-center py-12 text-red-400">111477: ${data.error}</div>`;
                    return;
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
                
                if (allFiles.length === 0) {
                    allSources = [];
                } else {
                    // Convert 111477 files to standard source format
                    allSources = allFiles.map(file => {
                        const fileTitle = file.filename || file.name || 'Unknown';
                        const quality = detectQuality(fileTitle);
                        const codec = detectCodec(fileTitle);
                        const size = file.size || 'Unknown';
                        
                        return {
                            title: fileTitle,
                            quality: quality,
                            codec: codec,
                            size: size,
                            sizeBytes: parseSize(size),
                            seeders: 0, // Direct links don't have seeders
                            indexer: file.source || '111477',
                            link: file.url || file.link,
                            magnet: null,
                            hdr: detectHDR(fileTitle)
                        };
                    });
                }
            } catch (err) {
                console.error('[111477] Error:', err);
                allSources = [];
                sourcesList.innerHTML = `<div class="text-center py-12 text-red-400">111477 connection failed. Make sure the app server is running.</div>`;
                return;
            }
        } else if (currentProvider === 'torrentless') {
            // PlayTorrio (Torrentless) native source - torrent search via UIndex & Knaben
            console.log('[Sources] Fetching from Torrentless (PlayTorrio)...');
            
            try {
                const title = currentDetails?.title || currentDetails?.name || '';
                const year = (currentDetails?.release_date || currentDetails?.first_air_date || '').split('-')[0];
                
                if (!title) {
                    sourcesList.innerHTML = '<div class="text-center py-12 text-gray-500">No title available for search.</div>';
                    return;
                }
                
                let query;
                if (isTV) {
                    const s = String(currentSeason).padStart(2, '0');
                    const e = currentEpisode ? String(currentEpisode).padStart(2, '0') : '';
                    query = currentEpisode ? `${title} S${s}E${e}` : `${title} S${s}`;
                } else {
                    query = `${title} ${year}`;
                }
                
                const torrentlessUrl = `http://localhost:6987/torrentless/api/search?q=${encodeURIComponent(query)}&page=1`;
                console.log('[Torrentless] Query:', query);
                console.log('[Torrentless] Fetching from:', torrentlessUrl);
                
                const response = await fetch(torrentlessUrl);
                
                if (!response.ok) {
                    console.error('[Torrentless] API returned error:', response.status, response.statusText);
                    sourcesList.innerHTML = `<div class="text-center py-12 text-red-400">PlayTorrio search failed (${response.status}). Try again later.</div>`;
                    return;
                }
                
                const data = await response.json();
                
                if (data.error) {
                    console.error('[Torrentless] API error:', data.error);
                    sourcesList.innerHTML = `<div class="text-center py-12 text-red-400">PlayTorrio: ${data.error}</div>`;
                    return;
                }
                
                const items = data.items || [];
                console.log('[Torrentless] Found', items.length, 'results');
                
                if (items.length === 0) {
                    allSources = [];
                } else {
                    // Convert torrentless items to standard source format
                    // API returns: { name, magnet, size, seeds (string with commas), leech }
                    allSources = items.map(item => {
                        const itemTitle = item.name || item.title || 'Unknown';
                        const quality = detectQuality(itemTitle);
                        const codec = detectCodec(itemTitle);
                        // Parse seeds - API returns formatted string like "1,234"
                        const seeders = parseInt((item.seeds || '0').toString().replace(/,/g, ''), 10) || 0;
                        
                        return {
                            title: itemTitle,
                            quality: quality,
                            codec: codec,
                            size: item.size || 'Unknown',
                            sizeBytes: parseSize(item.size || '0'),
                            seeders: seeders,
                            indexer: 'PlayTorrio',
                            link: null,
                            magnet: item.magnet,
                            hdr: detectHDR(itemTitle)
                        };
                    });
                }
            } catch (err) {
                console.error('[Torrentless] Error:', err);
                allSources = [];
                sourcesList.innerHTML = `<div class="text-center py-12 text-red-400">PlayTorrio connection failed. Make sure the app server is running.</div>`;
                return;
            }
        } else {
            console.log(`[Sources] Fetching for addon provider: ${currentProvider}`);
            console.log('[Sources] currentDetails:', { 
                hasStremioMeta: !!currentDetails._stremioMeta, 
                hasAddonUrl: !!currentDetails._addonUrl,
                addonId: currentDetails._addonId,
                id: currentDetails.id
            });
            
            const addons = await getInstalledAddons();
            const addon = addons.find(a => (a.manifest?.id || a.id) === currentProvider);
            
            if (!addon) {
                 console.error('[Sources] Addon not found in installed list:', currentProvider);
                 console.log('[Sources] Available addons:', addons.map(a => a.manifest?.id || a.id));
                 sourcesList.innerHTML = '<div class="text-center py-12 text-red-500">Addon not found (check console).</div>';
                 return;
            }

            console.log('[Sources] Found addon:', addon.manifest?.name || addon.name);

            try {
                // Check if this is a custom Stremio addon ID (not TMDB/IMDB)
                const isCustomId = isStremioAddonId(id);
                
                if (isCustomId || (currentDetails._stremioMeta && currentDetails._addonUrl)) {
                    console.log('[Sources] Using Stremio protocol for custom ID...');
                    
                    // Get addon URL
                    let addonBaseUrl = currentDetails._addonUrl;
                    if (!addonBaseUrl) {
                        addonBaseUrl = addon.url.replace('/manifest.json', '');
                        if (addonBaseUrl.endsWith('/')) addonBaseUrl = addonBaseUrl.slice(0, -1);
                    }
                    
                    // Get or construct video ID
                    let videoId;
                    if (currentDetails._stremioMeta) {
                        videoId = getVideoId(
                            currentDetails._stremioMeta,
                            isTV ? currentSeason : null,
                            isTV ? currentEpisode : null
                        );
                    } else {
                        // Construct video ID from current state
                        if (isTV && currentEpisode) {
                            videoId = `${id}:${currentSeason}:${currentEpisode}`;
                        } else {
                            videoId = id;
                        }
                    }
                    
                    console.log('[Sources] Video ID:', videoId);
                    console.log('[Sources] Addon URL:', addonBaseUrl);
                    
                    // Use the stored Stremio type or convert from current type
                    const stremioType = currentDetails._stremioType || (type === 'tv' ? 'series' : type);
                    console.log('[Sources] Stremio type:', stremioType);
                    console.log('[Sources] Full stream URL will be:', `${addonBaseUrl}/stream/${stremioType}/${videoId}.json`);
                    
                    try {
                        const streams = await fetchStremioStreams(
                            addonBaseUrl,
                            stremioType,
                            videoId
                        );
                        
                        console.log('[Sources] Got Stremio streams:', streams.length);
                        
                        allSources = streams.map(stream => {
                            const parsed = parseStremioStream(stream);
                            const addonName = addon.manifest?.name || addon.name;
                            
                            console.log('[StreamMapping]', {
                                streamTitle: stream.name || stream.title,
                                parsedType: parsed.type,
                                parsedUrl: parsed.url,
                                externalUrl: stream.externalUrl
                            });
                            
                            return {
                                title: parsed.title,
                                fullTitle: stream.description || stream.title || parsed.title, // Store full description
                                quality: parsed.quality || 'Unknown',
                                codec: 'Unknown',
                                size: 'N/A',
                                sizeBytes: 0,
                                seeders: 0,
                                indexer: addonName,
                                link: parsed.type === 'url' ? parsed.url : (parsed.type === 'external' ? parsed.url : null),
                                magnet: parsed.type === 'torrent' ? parsed.url : null,
                                url: parsed.url,
                                streamType: parsed.type,
                                hdr: false,
                                description: stream.description, // Keep original description for externalUrl parsing
                                externalUrl: stream.externalUrl // Keep original externalUrl
                            };
                        }).filter(source => {
                            // Filter out web.stremio.com links
                            if (source.externalUrl && source.externalUrl.startsWith('https://web.stremio.com')) {
                                console.log('[StreamMapping] Filtering out web.stremio.com link:', source.title);
                                return false;
                            }
                            return true;
                        });
                        
                        if (allSources.length === 0) {
                            console.warn('[Sources] No streams found from Stremio addon.');
                        }
                    } catch (streamError) {
                        console.error('[Sources] Stream fetch error:', streamError);
                        
                        // Check if it's an authentication error
                        if (streamError.message.includes('500') || streamError.message.includes('handler error')) {
                            sourcesList.innerHTML = `
                                <div class="col-span-full text-center py-12 px-6">
                                    <div class="w-16 h-16 bg-yellow-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                                        <svg class="w-8 h-8 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                        </svg>
                                    </div>
                                    <h3 class="text-white font-bold text-lg mb-2">Addon Configuration Required</h3>
                                    <p class="text-gray-400 text-sm max-w-md mx-auto mb-4">
                                        This addon requires authentication or configuration to access streams. 
                                        Please configure the addon in Stremio with your credentials.
                                    </p>
                                    <p class="text-gray-500 text-xs">
                                        Some addons (like Hanime) require you to enter your account credentials 
                                        in the addon settings before streams can be accessed.
                                    </p>
                                </div>`;
                            return;
                        }
                        
                        throw streamError; // Re-throw other errors
                    }
                } else {
                    // Standard IMDB-based addon stream fetching
                    const imdbId = currentImdbId;
                    
                    if (imdbId) {
                        let stremioId = isTV 
                            ? (currentEpisode ? `${imdbId}:${currentSeason}:${currentEpisode}` : `${imdbId}:${currentSeason}:1`) 
                            : imdbId;
                            
                        console.log(`[Sources] Constructed Stremio ID: ${stremioId} (isTV: ${isTV})`);
                        
                        const resourceType = isTV ? 'series' : 'movie';
                        console.log(`[Sources] Calling fetchAddonStreams with type=${resourceType}, id=${stremioId}`);
                        
                        const streams = await fetchAddonStreams(addon, resourceType, stremioId);
                        console.log(`[Sources] fetchAddonStreams returned ${streams.length} items`);
                        
                        const addonName = addon.manifest?.name || addon.name;
                        allSources = streams
                            .map(s => parseAddonStream(s, addonName))
                            .filter(source => {
                                // Filter out web.stremio.com links
                                if (source.externalUrl && source.externalUrl.startsWith('https://web.stremio.com')) {
                                    console.log('[Sources] Filtering out web.stremio.com link:', source.title);
                                    return false;
                                }
                                return true;
                            });
                        
                        if (allSources.length === 0) {
                            console.warn('[Sources] No streams found from addon.');
                        }
                    } else {
                        console.warn('[Sources] No IMDB ID found in external_ids response for this TMDB ID.');
                        sourcesList.innerHTML = '<div class="text-center py-12 text-gray-500">No IMDB ID found. Cannot fetch from Stremio addons.</div>';
                        return;
                    }
                }
            } catch (err) {
                console.error('[Sources] Error in addon fetch loop:', err);
                sourcesList.innerHTML = `<div class="text-center py-12 text-red-500">Error: ${err.message}</div>`;
                return;
            }
        }
        displaySources(allSources);
        handleSortAndFilter();
    } catch (e) {
        console.error('Error fetching sources:', e);
        sourcesList.innerHTML = `<div class="text-center py-12 text-red-500">Error: ${e.message}</div>`;
    }
};

const handleSortAndFilter = () => {
    if (!allSources.length) return;

    let filtered = [...allSources];

    // Quality Filter
    const quality = qualityFilter.value;
    if (quality !== 'all') {
        filtered = filtered.filter(s => s.quality === quality);
    }

    // Sort
    const sort = sortSelect.value;
    filtered.sort((a, b) => {
        // Cached Priority (contains ⚡ emoji)
        const aCached = a.indexer.includes('⚡') || a.title.includes('⚡');
        const bCached = b.indexer.includes('⚡') || b.title.includes('⚡');
        
        if (aCached && !bCached) return -1;
        if (!aCached && bCached) return 1;

        if (sort === 'seeders') return b.seeders - a.seeders;
        if (sort === 'size-desc') return b.sizeBytes - a.sizeBytes;
        if (sort === 'size-asc') return a.sizeBytes - b.sizeBytes;
        if (sort === 'quality') {
            const qMap = { '4K': 4, '1080p': 3, '720p': 2, '480p': 1, 'Unknown': 0 };
            return qMap[b.quality] - qMap[a.quality] || b.seeders - a.seeders;
        }
        return 0;
    });

    displaySources(filtered);
};

sortSelect?.addEventListener('change', () => {
    localStorage.setItem('basic_default_sort', sortSelect.value);
    handleSortAndFilter();
});
qualityFilter?.addEventListener('change', handleSortAndFilter);

const matchEpisodeFile = (files, season, episode) => {
    if (!files || !files.length) return null;
    const s = parseInt(season);
    const e = parseInt(episode);
    
    console.log(`[Matching] TARGET: S${s}E${e}`);

    const scoredFiles = files.map(file => {
        const fullPath = (file.path || file.filename || file.name || '').toLowerCase();
        const fileName = fullPath.split('/').pop();
        let score = 0;
        
        // Disqualify non-video/junk immediately - Expanded formats
        if (!fullPath.match(/\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v|mpg|mpeg)$/i) || fullPath.includes('sample') || fullPath.includes('trailer')) {
            return { file, score: -1000000, reason: 'Invalid type or sample' };
        }

        // --- PHASE 1: Filename Analysis (Ultra High Priority) ---
        
        // Exact SxxExx or XxXX patterns
        const exactPatterns = [
            { p: new RegExp(`s0*${s}e0*${e}\\b`, 'i'), b: 50000 },
            { p: new RegExp(`\\b${s}x0*${e}\\b`, 'i'), b: 50000 },
            { p: new RegExp(`season\\s*${s}\\s*episode\\s*${e}\\b`, 'i'), b: 50000 },
            { p: new RegExp(`\\b0*${s}x0*${e}\\b`, 'i'), b: 50000 },
            { p: new RegExp(`s0*${s}\\.e0*${e}\\b`, 'i'), b: 50000 }, // S02.E01
            { p: new RegExp(`\\[${s}x${e}\\]`, 'i'), b: 50000 },       // [2x01]
            { p: new RegExp(`\\b${s}${String(e).padStart(2, '0')}\\b`, 'i'), b: 10000 } // 201 for S02E01
        ];

        for (const item of exactPatterns) {
            if (item.p.test(fileName)) score += item.b;
        }

        // Catch-all Episode markers in filename
        const epMarkers = [
            { p: new RegExp(`e0*${e}\\b`, 'i'), b: 5000 },
            { p: new RegExp(`ep\\.?\\s*0*${e}\\b`, 'i'), b: 5000 },
            { p: new RegExp(`episode\\s*0*${e}\\b`, 'i'), b: 5000 },
            { p: new RegExp(`#\\s*0*${e}\\b`, 'i'), b: 5000 },
            { p: new RegExp(`\\-\\s*0*${e}\\b`, 'i'), b: 5000 },
            { p: new RegExp(`\\b0*${e}\\b`, 'i'), b: 2000 },
            { p: new RegExp(`\\[0*${e}\\]`, 'i'), b: 5000 },
            { p: new RegExp(`_0*${e}_`, 'i'), b: 5000 }, // episode in underscores
            { p: new RegExp(`\\s0*${e}\\s`, 'i'), b: 2000 } // standalone number with spaces
        ];

        for (const item of epMarkers) {
            if (item.p.test(fileName)) score += item.b;
        }

        // Season boost (if season is present and matches)
        const seasonMarkers = [
            new RegExp(`s0*${s}\\b`, 'i'),
            new RegExp(`season\\s*${s}\\b`, 'i'),
            new RegExp(`\\[s0*${s}\\]`, 'i')
        ];
        for (const p of seasonMarkers) {
            if (p.test(fileName)) score += 1000;
        }

        // --- PHASE 2: Path Analysis (Low Priority) ---
        if (new RegExp(`s0*${s}e0*${e}\\b`, 'i').test(fullPath)) score += 100;
        if (new RegExp(`season\\s*${s}`, 'i').test(fullPath)) score += 50;

        // --- PHASE 3: THE "ABSOLUTE ZERO" DISQUALIFIER ---
        
        // Disqualify if it has an explicit WRONG episode marker in filename
        // Regex looks for E01, Ep 01, 2x01, Episode 01
        const allEpTags = fileName.match(/e(\d+)|ep\s*(\d+)|\b(\d+)x(\d+)\b|episode\s*(\d+)/gi);
        if (allEpTags) {
            const hasCorrectEp = allEpTags.some(tag => {
                const nums = tag.match(/\d+/g);
                const foundEp = parseInt(nums[nums.length - 1]);
                return foundEp === e;
            });
            const hasWrongEp = allEpTags.some(tag => {
                const nums = tag.match(/\d+/g);
                const foundEp = parseInt(nums[nums.length - 1]);
                return foundEp !== e;
            });

            if (hasWrongEp && !hasCorrectEp) {
                score -= 1000000;
                return { file, score, name: fileName, reason: 'Wrong episode tag' };
            }
        }

        // Disqualify if it has an explicit WRONG season marker anywhere
        const allSeasonTags = fullPath.match(/s(\d+)|season\s*(\d+)/gi);
        if (allSeasonTags) {
            const hasCorrectSeason = allSeasonTags.some(tag => {
                const num = parseInt(tag.replace(/\D/g, ''));
                return num === s;
            });
            const hasWrongSeason = allSeasonTags.some(tag => {
                const num = parseInt(tag.replace(/\D/g, ''));
                return num !== s;
            });
            if (hasWrongSeason && !hasCorrectSeason) {
                score -= 1000000;
                return { file, score, name: fileName, reason: 'Wrong season tag' };
            }
        }

        return { file, score, name: fileName };
    });

    scoredFiles.sort((a, b) => b.score - a.score);
    
    // Log top 3 for debugging
    console.log('[Matching] Top Candidates:');
    scoredFiles.slice(0, 3).forEach((cand, idx) => {
        console.log(`  ${idx+1}. ${cand.name} (Score: ${cand.score})${cand.reason ? ' - ' + cand.reason : ''}`);
    });

    const best = scoredFiles[0];

    if (best && best.score > 0) {
        console.log(`[Matching] SUCCESS: Picked "${best.name}" (Score: ${best.score})`);
        return best.file;
    }

    console.warn(`[Matching] FAILED: No accurate match found for S${s}E${e}`);
    return null;
};

const resolveTorrent = async (url, title) => {
    if (!url || !url.startsWith('http')) return url;
    // If it's already a magnet, no need to resolve
    if (url.startsWith('magnet:')) return url;
    try {
        const res = await fetch(`/api/resolve-torrent-file?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title || '')}`);
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            console.error('[resolveTorrent] Server error:', errData.error || res.status);
            return null;
        }
        const data = await res.json();
        if (data.error) {
            console.error('[resolveTorrent] Resolution error:', data.error);
            return null;
        }
        if (data.magnet && data.magnet.startsWith('magnet:')) {
            return data.magnet;
        }
        console.warn('[resolveTorrent] No magnet returned from resolution');
        return null;
    } catch (err) {
        console.error('[resolveTorrent] Failed to resolve torrent:', err);
        return null;
    }
};

const displaySources = (sources) => {
    sourcesList.innerHTML = '';
    if (sources.length === 0) {
        sourcesList.innerHTML = '<div class="text-center py-12 text-gray-500">No sources found matching your criteria.</div>';
        return;
    }
    
    sources.forEach((source, index) => {
        const clone = sourceCardTemplate.content.cloneNode(true);
        const card = clone.querySelector('.source-card');
        
        // Resolution color logic
        let resColor = 'from-gray-500 to-gray-600';
        if (source.quality === '4K') resColor = 'from-yellow-500 to-orange-500';
        else if (source.quality === '1080p') resColor = 'from-purple-500 to-pink-500';
        else if (source.quality === '720p') resColor = 'from-blue-500 to-cyan-500';

        const resBadge = clone.querySelector('.res-badge');
        resBadge.className = `res-badge text-white text-sm px-3 py-1 rounded-full font-bold bg-gradient-to-r ${resColor}`;
        resBadge.textContent = source.quality;

        clone.querySelector('.codec-badge').textContent = source.codec;

        if (source.hdr) {
            const hdrBadge = clone.querySelector('.hdr-badge');
            hdrBadge.textContent = source.hdr;
            hdrBadge.classList.remove('hidden');
            const hdrColors = source.hdr.includes('Dolby') ? 'bg-gradient-to-r from-pink-500 to-purple-500' : 'bg-gradient-to-r from-yellow-500 to-orange-500';
            hdrBadge.className = `hdr-badge text-white text-xs px-2 py-0.5 rounded-full font-medium ${hdrColors}`;
        }

        clone.querySelector('.release-name').textContent = source.title;
        clone.querySelector('.seeders-count').textContent = source.seeders;
        clone.querySelector('.file-size').textContent = source.size;
        clone.querySelector('.provider-name').textContent = source.indexer;

        const link = source.magnet || source.link || source.url || source.externalUrl;

        // Copy button logic
        const copyBtn = clone.querySelector('.copy-btn');
        copyBtn.onclick = async (e) => {
            e.stopPropagation();
            if (link) {
                let finalLink = link;
                // Resolve torrent if it's a download URL (Jackett, .torrent, etc.)
                const needsResolution = link.startsWith('http') && !link.startsWith('magnet:') && (
                    link.includes('.torrent') ||
                    link.includes('/dl/') ||
                    link.includes('/download') ||
                    link.includes('jackett_apikey') ||
                    link.includes('apikey=')
                );
                if (needsResolution) {
                    const originalIcon = copyBtn.innerHTML;
                    copyBtn.innerHTML = '<div class="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>';
                    finalLink = await resolveTorrent(link, source.title);
                    copyBtn.innerHTML = originalIcon;
                    if (!finalLink) {
                        alert('Failed to resolve torrent link');
                        return;
                    }
                }
                
                const showSuccess = () => {
                    const originalIcon = copyBtn.innerHTML;
                    copyBtn.innerHTML = '<svg class="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>';
                    setTimeout(() => copyBtn.innerHTML = originalIcon, 2000);
                };

                if (window.electronAPI?.copyToClipboard) {
                    await window.electronAPI.copyToClipboard(finalLink);
                    showSuccess();
                } else {
                    navigator.clipboard.writeText(finalLink).then(showSuccess);
                }
            }
        };

        // Play button logic
        const playBtn = clone.querySelector('.play-btn');
        playBtn.onclick = async () => {
            console.log('[PlayButton] Clicked! Link:', link);
            console.log('[PlayButton] Source:', source);
            
            // Get the URL to work with (prioritize externalUrl for addon streams)
            const externalUrl = source.externalUrl || link || source.url;
            
            if (!externalUrl) {
                console.warn('[PlayButton] No link or externalUrl available');
                return;
            }

            // Check if this is a stremio:///detail external URL
            // These URLs indicate we should search TMDB and navigate to the details page
            if (externalUrl.includes('stremio:///detail') || externalUrl.includes('stremio:///search')) {
                console.log('[ExternalURL] Detected stremio external link:', externalUrl);
                
                // Check if it's a detail URL with IMDB ID (e.g., stremio:///detail/movie/tt32642706)
                const detailMatch = externalUrl.match(/stremio:\/\/\/detail\/(movie|series|tv)\/(.+)/);
                if (detailMatch) {
                    const mediaType = detailMatch[1] === 'series' ? 'tv' : detailMatch[1];
                    const contentId = detailMatch[2];
                    
                    // Check if it's a recommendation ID (e.g., mlt-rec-tt0295701)
                    if (contentId.startsWith('mlt-rec-')) {
                        const imdbId = contentId.replace('mlt-rec-', '');
                        console.log('[ExternalURL] Recommendation URL detected, IMDB ID:', imdbId);
                        
                        // Navigate to grid page with addon catalog for recommendations
                        // The addon should have a catalog like: /catalog/movie/mlt-tmdb-movie-rec/search=tt0295701.json
                        const addonId = currentProvider || 'community.morelikethis';
                        const catalogId = mediaType === 'movie' ? 'mlt-tmdb-movie-rec' : 'mlt-tmdb-series-rec';
                        
                        hidePlayLoading();
                        window.location.href = `grid.html?type=addon&addonId=${addonId}&catalogId=${catalogId}&catalogType=${mediaType}&search=${imdbId}&name=Similar to this`;
                        return;
                    }
                    
                    // Regular IMDB ID (e.g., tt32642706)
                    const imdbId = contentId;
                    
                    console.log('[ExternalURL] Found IMDB ID in detail URL:', imdbId);
                    showPlayLoading('Looking up on TMDB...');
                    
                    try {
                        // Use TMDB's find API to get TMDB data from IMDB ID
                        const findResults = await findByExternalId(imdbId, 'imdb_id');
                        console.log('[ExternalURL] TMDB find results:', findResults);
                        
                        // Find the result based on media type
                        let tmdbResult = null;
                        if (mediaType === 'movie' && findResults.movie_results && findResults.movie_results.length > 0) {
                            tmdbResult = findResults.movie_results[0];
                        } else if (mediaType === 'tv' && findResults.tv_results && findResults.tv_results.length > 0) {
                            tmdbResult = findResults.tv_results[0];
                        }
                        
                        if (tmdbResult) {
                            console.log('[ExternalURL] Found TMDB match:', tmdbResult.title || tmdbResult.name, tmdbResult.id);
                            hidePlayLoading();
                            
                            // Navigate to details page
                            window.location.href = `details.html?type=${mediaType}&id=${tmdbResult.id}`;
                            return;
                        } else {
                            console.warn('[ExternalURL] No TMDB match found for IMDB ID:', imdbId);
                            hidePlayLoading();
                            alert('Could not find this content on TMDB.');
                            return;
                        }
                    } catch (error) {
                        console.error('[ExternalURL] TMDB find error:', error);
                        hidePlayLoading();
                        alert('Failed to lookup on TMDB: ' + error.message);
                        return;
                    }
                }
                
                // Check if it's a search URL (e.g., stremio:///search?search=tt32642706)
                const searchMatch = externalUrl.match(/stremio:\/\/\/search\?search=(.+)/);
                if (searchMatch) {
                    const searchQuery = decodeURIComponent(searchMatch[1]);
                    console.log('[ExternalURL] Search URL detected, query:', searchQuery);
                    
                    // Navigate to grid page with addon catalog search to display the results
                    // Use the current provider that's generating these streams
                    const addonId = currentProvider;
                    
                    // Determine media type from current page
                    const mediaType = type === 'tv' ? 'series' : 'movie';
                    const catalogId = mediaType === 'movie' ? 'mlt-tmdb-movie-rec' : 'mlt-tmdb-series-rec';
                    
                    hidePlayLoading();
                    window.location.href = `grid.html?type=addon&addonId=${addonId}&catalogId=${catalogId}&catalogType=${mediaType}&search=${searchQuery}&name=More Like This`;
                    return;
                }
                
                // If it's just a generic stremio:/// URL without specific handling, try name-based search
                console.log('[ExternalURL] Generic stremio URL, checking for metadata...');
                
                // Check if we have metadata (name and year) to search TMDB
                if (source.fullTitle && source.fullTitle.includes('📆 Release:')) {
                    console.log('[ExternalURL] Has metadata, searching TMDB...');
                    
                    // Extract name and year from fullTitle/description
                    const description = source.fullTitle || source.description || '';
                    
                    // Parse release date from description (format: 📆 Release: 2009-12-19)
                    const releaseMatch = description.match(/📆\s*Release:\s*(\d{4})-\d{2}-\d{2}/);
                    const year = releaseMatch ? releaseMatch[1] : null;
                    
                    // Get the name from source.title
                    const name = source.title || '';
                    
                    console.log('[ExternalURL] Extracted:', { name, year });
                    
                    if (name) {
                        showPlayLoading('Searching TMDB...');
                        
                        try {
                            // Search TMDB with just the name (don't include year in search query)
                            console.log('[ExternalURL] Searching TMDB for:', name);
                            
                            const searchResults = await searchMulti(name);
                            const results = searchResults.results || [];
                            
                            console.log('[ExternalURL] Found', results.length, 'results');
                            
                            // Filter to only movies and TV shows
                            const validResults = results.filter(r => r.media_type === 'movie' || r.media_type === 'tv');
                            
                            // Try to match by name and year
                            let match = null;
                            
                            if (year) {
                                // Match by name and year
                                match = validResults.find(r => {
                                    const resultYear = (r.release_date || r.first_air_date || '').split('-')[0];
                                    const resultName = (r.title || r.name || '').toLowerCase();
                                    const searchName = name.toLowerCase();
                                    
                                    return resultYear === year && resultName === searchName;
                                });
                            }
                            
                            // If no exact match, try fuzzy match by name only
                            if (!match && validResults.length > 0) {
                                const searchNameLower = name.toLowerCase();
                                match = validResults.find(r => {
                                    const resultName = (r.title || r.name || '').toLowerCase();
                                    return resultName === searchNameLower;
                                });
                            }
                            
                            // If still no match, take the first result
                            if (!match && validResults.length > 0) {
                                match = validResults[0];
                                console.log('[ExternalURL] No exact match, using first result');
                            }
                            
                            if (match) {
                                console.log('[ExternalURL] Matched:', match.title || match.name, match.id);
                                hidePlayLoading();
                                
                                // Navigate to details page
                                const mediaType = match.media_type === 'tv' ? 'tv' : 'movie';
                                window.location.href = `details.html?type=${mediaType}&id=${match.id}`;
                                return;
                            } else {
                                console.warn('[ExternalURL] No match found on TMDB');
                                hidePlayLoading();
                                alert('Could not find this content on TMDB. Please try searching manually.');
                                return;
                            }
                        } catch (error) {
                            console.error('[ExternalURL] TMDB search error:', error);
                            hidePlayLoading();
                            alert('Failed to search TMDB: ' + error.message);
                            return;
                        }
                    }
                }
                
                // If we get here, it's a stremio URL but we can't handle it
                console.warn('[ExternalURL] Cannot handle this stremio URL');
                hidePlayLoading();
                alert('This stream type is not supported.');
                return;
            }

            // Show loading overlay immediately
            showPlayLoading('Preparing stream...');

            try {
                // Check if this is a Jackett/torrent download URL that needs resolution
                // Jackett URLs look like: http://127.0.0.1:9117/dl/...?jackett_apikey=...
                const isJackettUrl = externalUrl.includes('jackett') ||      // jackett_apikey or jackett in URL
                                     externalUrl.includes(':9117') ||        // Default Jackett port
                                     externalUrl.includes('/dl/') ||         // Jackett download path
                                     externalUrl.includes('/download');      // Generic download path
                
                console.log(`[Play] Link: ${externalUrl.substring(0, 100)}...`);
                console.log(`[Play] isJackettUrl: ${isJackettUrl}`);
                
                // Check if this is a direct streaming URL (not a magnet, torrent file, or Jackett URL)
                const isDirectUrl = externalUrl.startsWith('http') && 
                                    !externalUrl.includes('.torrent') && 
                                    !externalUrl.startsWith('magnet:') &&
                                    !isJackettUrl;
                const isMagnet = externalUrl.startsWith('magnet:');
                
                console.log(`[Play] isDirectUrl: ${isDirectUrl}, isMagnet: ${isMagnet}`);
                
                // For direct URLs from addons like Nuvio, play directly through transcoder
                if (isDirectUrl && !isMagnet) {
                    console.log(`[Direct Stream] Playing direct URL: ${externalUrl.substring(0, 80)}...`);
                
                // Get provider info for Next Episode feature
                let providerUrl = '';
                if (currentProvider !== 'jackett') {
                    try {
                        const addons = await getInstalledAddons();
                        const addon = addons.find(a => (a.manifest?.id || a.id) === currentProvider);
                        if (addon) {
                            providerUrl = addon.url || addon.manifestUrl || '';
                            if (providerUrl.endsWith('/manifest.json')) {
                                providerUrl = providerUrl.replace('/manifest.json', '');
                            }
                        }
                    } catch (e) {}
                }
                
                // Save provider info
                try {
                    localStorage.setItem('basicmode_last_provider', JSON.stringify({
                        provider: currentProvider,
                        quality: source.quality,
                        showName: currentDetails?.name || currentDetails?.title || ''
                    }));
                } catch (e) {}
                
                // Extract target season/episode
                let targetS = currentSeason;
                let targetE = currentEpisode;
                const sourcesTitle = document.getElementById('sources-title');
                if (sourcesTitle && isTV) {
                    const titleText = sourcesTitle.innerText;
                    const match = titleText.match(/S(\d+)E(\d+)/i);
                    if (match) {
                        targetS = parseInt(match[1]);
                        targetE = parseInt(match[2]);
                    }
                }
                
                // Launch player with direct URL using iframe overlay
                openPlayerInIframe({
                    url: externalUrl,
                    tmdbId: currentTmdbId || id,
                    imdbId: currentImdbId,
                    seasonNum: targetS,
                    episodeNum: targetE,
                    type: type,
                    isDebrid: false,  // Not debrid, direct stream
                    isBasicMode: true,
                    showName: currentDetails?.name || currentDetails?.title || '',
                    provider: currentProvider,
                    providerUrl: providerUrl,
                    quality: source.quality
                });
                return;
            }

            // For torrent files or magnets, continue with existing logic
            let activeLink = externalUrl;
            
            // Check if this is a torrent download URL that needs resolution
            // This includes: .torrent files, Jackett /dl/ URLs, and other torrent download endpoints
            const needsResolution = externalUrl.startsWith('http') && !externalUrl.startsWith('magnet:') && (
                externalUrl.includes('.torrent') ||
                externalUrl.includes('/dl/') ||           // Jackett download URLs
                externalUrl.includes('/download') ||      // Common torrent download paths
                externalUrl.includes('jackett_apikey') || // Jackett API key in URL
                externalUrl.includes('apikey=')           // Generic API key patterns
            );
            
            if (needsResolution) {
                showPlayLoading('Resolving torrent...');
                console.log(`[Torrent] Resolving download URL: ${externalUrl.substring(0, 100)}...`);
                activeLink = await resolveTorrent(externalUrl, source.title);
                if (!activeLink) {
                    hidePlayLoading();
                    alert('Failed to resolve torrent link. Please try another source.');
                    return;
                }
                if (!activeLink.startsWith('magnet:')) {
                    // Resolution didn't return a magnet - this is a problem for debrid/webtorrent
                    console.error('[Torrent] Resolution failed to return a magnet link:', activeLink.substring(0, 100));
                    hidePlayLoading();
                    alert('Could not extract magnet link from this torrent. The source may be unavailable or require manual download.');
                    return;
                }
                console.log(`[Torrent] Resolved to magnet: ${activeLink.substring(0, 80)}...`);
            }

            // Check if we should use Debrid or WebTorrent
            const debridSettings = await getDebridSettings();
            
            // Final validation: ensure we have a magnet link for debrid/webtorrent
            if (!activeLink.startsWith('magnet:')) {
                console.error('[Torrent] activeLink is not a magnet:', activeLink.substring(0, 100));
                hidePlayLoading();
                alert('Invalid torrent link. Expected a magnet link but got: ' + activeLink.substring(0, 50) + '...');
                return;
            }
            
            // Extract Target S/E from UI text as requested by user
            let targetS = currentSeason;
            let targetE = currentEpisode;
            const sourcesTitle = document.getElementById('sources-title');
            if (sourcesTitle && isTV) {
                const titleText = sourcesTitle.innerText;
                const match = titleText.match(/S(\d+)E(\d+)/i);
                if (match) {
                    targetS = parseInt(match[1]);
                    targetE = parseInt(match[2]);
                    console.log(`[UI-MATCH] Found target from UI: S${targetS}E${targetE}`);
                }
            }

            // Save provider info for Next Episode feature
            // Get addon URL if using a Stremio addon
            let providerUrl = '';
            if (currentProvider !== 'jackett') {
                try {
                    const addons = await getInstalledAddons();
                    const addon = addons.find(a => (a.manifest?.id || a.id) === currentProvider);
                    if (addon) {
                        providerUrl = addon.url || addon.manifestUrl || '';
                        if (providerUrl.endsWith('/manifest.json')) {
                            providerUrl = providerUrl.replace('/manifest.json', '');
                        }
                    }
                } catch (e) {}
            }
            
            try {
                localStorage.setItem('basicmode_last_provider', JSON.stringify({
                    provider: currentProvider,
                    quality: source.quality,
                    showName: currentDetails?.name || currentDetails?.title || ''
                }));
            } catch (e) {}

            if (debridSettings.useDebrid && debridSettings.debridAuth) {
                console.log(`[Debrid] Preparing magnet: ${source.title}`);
                showPlayLoading('Preparing debrid...');
                try {
                    const res = await fetch('/api/debrid/prepare', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ magnet: activeLink })
                    });
                    const data = await res.json();
                    
                    if (data && data.info) {
                        const info = data.info;
                        const files = info.files || [];
                        
                        console.log(`--- DEBRID FILE LIST (${debridSettings.debridProvider}): ${info.filename || data.name || 'Torrent'} ---`);
                        
                        let targetFile = null;
                        if (isTV && targetE) {
                            targetFile = matchEpisodeFile(files, targetS, targetE);
                        } else {
                            // For movies, pick the largest file
                            targetFile = files.sort((a, b) => (b.bytes || b.size || 0) - (a.bytes || a.size || 0))[0];
                        }

                        if (targetFile) {
                            const fileName = targetFile.path || targetFile.filename || targetFile.name || `File ${targetFile.id}`;
                            const fileSize = targetFile.bytes || targetFile.size || 0;
                            console.log(`[TARGET MATCHED] ${fileName} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
                            
                            // Unrestrict the specific file link
                            let fileLink = (targetFile.links && targetFile.links[0]) || null;
                            
                            // Real-Debrid Fallback: links are in info.links, not per-file
                            if (!fileLink && debridSettings.debridProvider === 'realdebrid' && info.links && info.links.length > 0) {
                                const selectedFiles = files.filter(f => f.selected === 1);
                                const linkIndex = selectedFiles.indexOf(targetFile);
                                
                                if (linkIndex !== -1 && info.links[linkIndex]) {
                                    fileLink = info.links[linkIndex];
                                    console.log(`[Debrid] RD Link matched via selected-index [${linkIndex}]: ${fileLink}`);
                                } else {
                                    console.warn('[Debrid] Target file not found in selected files list or link missing.');
                                }
                            }

                            if (fileLink) {
                                showPlayLoading('Getting stream link...');
                                console.log('[Debrid] Unrestricting target file link...');
                                const unres = await fetch('/api/debrid/link', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ link: fileLink })
                                });
                                const unresData = await unres.json();
                                if (unresData.url) {
                                    console.log(`[FINAL STREAM LINK] ${unresData.url}`);
                                    openPlayerInIframe({
                                        url: unresData.url,
                                        tmdbId: currentTmdbId || id,
                                        imdbId: currentImdbId,
                                        seasonNum: targetS,
                                        episodeNum: targetE,
                                        type: type,
                                        isDebrid: true,
                                        isBasicMode: true,
                                        showName: currentDetails?.name || currentDetails?.title || '',
                                        provider: currentProvider,
                                        providerUrl: providerUrl,
                                        quality: source.quality
                                    });
                                } else {
                                    console.error('[Debrid] Failed to unrestrict link:', unresData.error);
                                    hidePlayLoading();
                                    alert('Failed to get stream link: ' + (unresData.error || 'Unknown error'));
                                }
                            } else {
                                console.warn('[Debrid] No direct link available for this file yet.');
                                hidePlayLoading();
                                alert('This file is not yet ready for streaming on the debrid provider.');
                            }
                        } else {
                            console.error('[Debrid] No matching file found in torrent.');
                            hidePlayLoading();
                            alert('Could not find the correct episode in this torrent.');
                        }

                        // List all files anyway for console visibility
                        files.forEach((file, i) => {
                            const fileName = file.path || file.filename || file.name || `File ${file.id || i+1}`;
                            const fileSize = file.bytes || file.size || 0;
                            console.log(`  [File ${i+1}] ${fileName} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
                        });
                        console.log(`-------------------------------------------`);
                    } else if (data.error) {
                        console.error('[Debrid] Error:', data.error);
                        hidePlayLoading();
                        alert('Debrid error: ' + data.error);
                    }
                } catch (err) {
                    console.error('[Debrid] Error preparing torrent:', err);
                    hidePlayLoading();
                    alert('Error preparing torrent: ' + err.message);
                }
            } else {
                // Torrent Engine Path: Fetch metadata and list files
                showPlayLoading('Fetching torrent metadata...');
                console.log(`[TorrentEngine] Fetching metadata for: ${source.title}`);
                try {
                    // Check which engine is configured
                    let engineConfig = { engine: 'stremio' };
                    try {
                        const configRes = await fetch('/api/torrent-engine/config');
                        if (configRes.ok) {
                            engineConfig = await configRes.json();
                        }
                    } catch (e) {
                        console.warn('[TorrentEngine] Failed to get engine config, defaulting to stremio');
                    }
                    
                    const isAltEngine = engineConfig.engine !== 'stremio';
                    console.log(`[TorrentEngine] Engine config: ${engineConfig.engine}, isAltEngine: ${isAltEngine}`);
                    
                    // Use appropriate API endpoint based on engine
                    const apiEndpoint = isAltEngine ? '/api/alt-torrent-files' : '/api/torrent-files';
                    console.log(`[TorrentEngine] Using ${engineConfig.engine} engine via ${apiEndpoint}`);
                    
                    const res = await fetch(`${apiEndpoint}?magnet=${encodeURIComponent(activeLink)}`);
                    
                    if (!res.ok) {
                        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
                    }
                    
                    const data = await res.json();
                    
                    console.log('[TorrentEngine] Response data:', data);
                    
                    if (data && !data.error) {
                        console.log(`--- TORRENT DATA RECEIVED: ${data.name} ---`);
                        const allFiles = [...(data.videoFiles || []), ...(data.subtitleFiles || [])];
                        
                        console.log(`[TorrentEngine] Total files: ${allFiles.length}, Video files: ${data.videoFiles?.length || 0}`);
                        
                        if (allFiles.length === 0 || !data.videoFiles || data.videoFiles.length === 0) {
                            hidePlayLoading();
                            alert('No video files found in this torrent. The torrent may still be loading metadata. Please try again in a few seconds.');
                            return;
                        }
                        
                        let targetFile = null;
                        if (isTV && targetE) {
                            targetFile = matchEpisodeFile(allFiles, targetS, targetE);
                        } else {
                            targetFile = data.videoFiles && data.videoFiles[0];
                        }

                        if (targetFile) {
                            showPlayLoading('Starting stream...');
                            console.log(`[TARGET MATCHED] ${targetFile.name} (${(targetFile.size / 1024 / 1024).toFixed(2)} MB)`);
                            console.log(`[TorrentEngine] Starting stream for file index: ${targetFile.index}`);
                            
                            // Use appropriate stream endpoint based on engine
                            const streamEndpoint = isAltEngine ? '/api/alt-stream-file' : '/api/stream-file';
                            const prepareEndpoint = isAltEngine ? '/api/alt-prepare-file' : '/api/prepare-file';
                            
                            console.log(`[TorrentEngine] Stream endpoint: ${streamEndpoint}`);
                            
                            const streamUrl = `${window.location.origin}${streamEndpoint}?hash=${data.infoHash}&file=${targetFile.index}`;
                            console.log(`[TorrentEngine] Stream URL: ${streamUrl}`);
                            
                            fetch(`${prepareEndpoint}?hash=${data.infoHash}&file=${targetFile.index}`);
                            
                            // Launch player using iframe overlay
                            openPlayerInIframe({
                                url: streamUrl,
                                tmdbId: currentTmdbId || id,
                                imdbId: currentImdbId,
                                seasonNum: targetS,
                                episodeNum: targetE,
                                type: type,
                                isDebrid: false,
                                isBasicMode: true,
                                showName: currentDetails?.name || currentDetails?.title || '',
                                provider: currentProvider,
                                providerUrl: providerUrl,
                                quality: source.quality
                            });
                        } else {
                            // No matching file found
                            hidePlayLoading();
                            alert('Could not find a matching video file in this torrent.');
                        }

                        if (data.videoFiles) {
                            data.videoFiles.forEach((file, i) => {
                                console.log(`  [Video ${i+1}] ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
                            });
                        }
                        console.log(`-------------------------------------------`);
                    } else {
                        hidePlayLoading();
                        alert('Failed to get torrent info: ' + (data?.error || 'Unknown error'));
                    }
                } catch (err) {
                    console.error('[TorrentEngine] Error fetching torrent info:', err);
                    hidePlayLoading();
                    alert('Error fetching torrent: ' + err.message);
                }
            }
        } catch (err) {
            // Catch-all for any unexpected errors
            console.error('[Play] Unexpected error:', err);
            hidePlayLoading();
        }
    };

    // Animation delay
    setTimeout(() => {
        if(card) card.classList.remove('opacity-0', 'translate-x-4');
    }, index * 50);

    sourcesList.appendChild(clone);
});
};

const loadEpisodes = async (seasonNum) => {
    episodeGrid.innerHTML = '<div class="col-span-full text-center text-gray-500 py-4">Loading episodes...</div>';
    try {
        // Use currentTmdbId if available (for addon items), otherwise use id (for direct TMDB items)
        const tmdbIdToUse = currentTmdbId || id;
        const data = await getSeasonEpisodes(tmdbIdToUse, seasonNum);
        episodeGrid.innerHTML = '';
        episodesTitle.textContent = `Episodes (${data.episodes.length})`;
        data.episodes.forEach((episode) => {
            const clone = episodeCardTemplate.content.cloneNode(true);
            const btn = clone.querySelector('.episode-btn');
            if (episode.still_path) {
                const img = clone.querySelector('.episode-img');
                img.src = getImageUrl(episode.still_path, 'w300');
                img.classList.remove('hidden');
                clone.querySelector('.episode-placeholder').classList.add('hidden');
            }
            clone.querySelector('.episode-number').textContent = episode.episode_number;
            clone.querySelector('.episode-name').textContent = episode.name;
            btn.onclick = () => {
                document.querySelectorAll('.episode-btn').forEach(b => {
                    b.classList.remove('ring-2', 'ring-purple-500');
                    b.querySelector('.episode-overlay').classList.remove('opacity-100');
                });
                btn.classList.add('ring-2', 'ring-purple-500');
                btn.querySelector('.episode-overlay').classList.add('opacity-100');
                currentEpisode = episode.episode_number;
                renderSources();
                // Auto-update embedded player if it's visible
                updateEmbeddedPlayerForEpisode();
            };
            episodeGrid.appendChild(clone);
            
            // Auto-select episode from URL if it matches
            if (urlEpisode && episode.episode_number === parseInt(urlEpisode)) {
                setTimeout(() => {
                    btn.classList.add('ring-2', 'ring-purple-500');
                    btn.querySelector('.episode-overlay').classList.add('opacity-100');
                    currentEpisode = episode.episode_number;
                    renderSources();
                }, 100);
            }
        });
    } catch (e) {
        console.error('[Episodes] Failed to load:', e);
        episodeGrid.innerHTML = '<div class="col-span-full text-red-500">Failed to load episodes.</div>';
    }
};

const init = async () => {
    // Load Default Sort Preference
    if (sortSelect) {
        const savedSort = localStorage.getItem('basic_default_sort');
        if (savedSort) {
            sortSelect.value = savedSort;
        }
    }

    // Settings Modal
    if (settingsBtn) {
        settingsBtn.onclick = async () => {
            jackettApiInput.value = await getJackettKey() || '';
            const settings = await getJackettSettings();
            if (jackettUrlInput) jackettUrlInput.value = settings.jackettUrl || '';
            
            // Load Default Sort
            if (defaultSortInput) {
                defaultSortInput.value = localStorage.getItem('basic_default_sort') || 'seeders';
            }

            settingsModal.classList.remove('hidden');
            setTimeout(() => settingsModal.classList.remove('opacity-0'), 10);
        };
    }

    if (closeSettingsBtn) {
        closeSettingsBtn.onclick = () => {
            settingsModal.classList.add('opacity-0');
            setTimeout(() => settingsModal.classList.add('hidden'), 300);
        };
    }

    if (saveSettingsBtn) {
        saveSettingsBtn.onclick = async () => {
            const key = jackettApiInput.value.trim();
            const url = jackettUrlInput ? jackettUrlInput.value.trim() : null;

            if (key && !key.includes('*')) {
                await setJackettKey(key);
            }

            if (url !== null) {
                try {
                    await fetch('/api/settings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ jackettUrl: url })
                    });
                } catch (e) {
                    console.error("Failed to save Jackett URL", e);
                }
            }

            // Save Default Sort
            if (defaultSortInput) {
                localStorage.setItem('basic_default_sort', defaultSortInput.value);
                if (sortSelect) {
                    sortSelect.value = defaultSortInput.value;
                    handleSortAndFilter();
                }
            }

            settingsModal.classList.add('opacity-0');
            setTimeout(() => settingsModal.classList.add('hidden'), 300);
        };
    }

    // Console Toggle
    if (toggleConsoleBtn) {
        toggleConsoleBtn.onclick = () => {
            if (window.electronAPI?.toggleDevTools) window.electronAPI.toggleDevTools();
        };
    }

    try {
        if (addonId) {
            // Check if this is a custom Stremio addon ID (not TMDB/IMDB)
            const isCustomId = isStremioAddonId(id);
            
            if (isCustomId) {
                console.log('[Details] Custom Stremio addon ID detected:', id);
                
                const addons = await getInstalledAddons();
                const addon = addons.find(a => a.manifest.id === addonId);
                if (!addon) throw new Error('Addon not found');
                
                let addonBaseUrl = addon.url.replace('/manifest.json', '');
                if (addonBaseUrl.endsWith('/')) addonBaseUrl = addonBaseUrl.slice(0, -1);
                
                // Convert type to Stremio format (tv -> series)
                const stremioType = type === 'tv' ? 'series' : type;
                
                let stremioMeta = null;
                let formattedMeta = null;
                
                // Try to fetch meta from addon endpoint
                try {
                    stremioMeta = await fetchStremioMeta(addonBaseUrl, stremioType, id);
                    formattedMeta = formatStremioMeta(stremioMeta);
                    console.log('[Details] Successfully fetched meta from addon endpoint');
                } catch (metaError) {
                    console.warn('[Details] Meta endpoint failed, trying sessionStorage fallback:', metaError.message);
                    
                    // Fallback to catalog metadata from sessionStorage
                    const cachedMeta = sessionStorage.getItem(`addon_meta_${addonId}_${id}`);
                    if (cachedMeta) {
                        stremioMeta = JSON.parse(cachedMeta);
                        formattedMeta = formatStremioMeta(stremioMeta);
                        console.log('[Details] Using cached catalog metadata');
                    } else {
                        throw new Error('Meta endpoint failed and no cached metadata available');
                    }
                }
                
                currentDetails = {
                    id: formattedMeta.id,
                    title: formattedMeta.title,
                    name: formattedMeta.title,
                    poster_path: formattedMeta.poster,
                    backdrop_path: formattedMeta.background,
                    overview: formattedMeta.description,
                    vote_average: formattedMeta.rating,
                    runtime: formattedMeta.runtime,
                    genres: formattedMeta.genres ? formattedMeta.genres.map(g => typeof g === 'string' ? { name: g } : g) : [],
                    release_date: formattedMeta.year ? `${formattedMeta.year}-01-01` : null,
                    // Store original Stremio meta for stream fetching
                    _stremioMeta: stremioMeta,
                    _addonUrl: addonBaseUrl,
                    _addonId: addonId,
                    _stremioType: stremioType
                };

                
                if (formattedMeta.cast) {
                    currentDetails.credits = { 
                        cast: formattedMeta.cast.map(c => typeof c === 'string' ? { name: c, id: '' } : c) 
                    };
                }
                
                renderDetails(currentDetails);
                await renderAddonTabs();
                
                // Handle series with videos array
                if (isTV && stremioMeta.videos && stremioMeta.videos.length > 0) {
                    seasonSection.classList.remove('hidden');
                    episodeSection.classList.remove('hidden');
                    
                    const seasons = {};
                    stremioMeta.videos.forEach(v => {
                        if (!seasons[v.season]) seasons[v.season] = [];
                        seasons[v.season].push({
                            episode_number: v.episode,
                            name: v.title || `Episode ${v.episode}`,
                            still_path: v.thumbnail,
                            overview: v.overview,
                            id: v.id
                        });
                    });
                    
                    Object.keys(seasons).sort((a,b) => a - b).forEach(sNum => {
                        const clone = seasonBtnTemplate.content.cloneNode(true);
                        const btn = clone.querySelector('.season-btn');
                        btn.textContent = `Season ${sNum}`;
                        btn.onclick = () => {
                            document.querySelectorAll('.season-btn').forEach(b => b.classList.remove('bg-purple-600', 'text-white'));
                            btn.classList.add('bg-purple-600', 'text-white');
                            currentSeason = parseInt(sNum);
                            currentEpisode = null;
                            sourcesList.classList.add('hidden');
                            selectEpisodeMsg.classList.remove('hidden');
                            
                            episodeGrid.innerHTML = '';
                            episodesTitle.textContent = `Episodes (${seasons[sNum].length})`;
                            seasons[sNum].sort((a,b) => a.episode_number - b.episode_number).forEach(ep => {
                                const epClone = episodeCardTemplate.content.cloneNode(true);
                                const epBtn = epClone.querySelector('.episode-btn');
                                if (ep.still_path) {
                                    const img = epClone.querySelector('.episode-img');
                                    img.src = ep.still_path;
                                    img.classList.remove('hidden');
                                    epClone.querySelector('.episode-placeholder').classList.add('hidden');
                                }
                                epClone.querySelector('.episode-number').textContent = ep.episode_number;
                                epClone.querySelector('.episode-name').textContent = ep.name;
                                epBtn.onclick = () => {
                                    document.querySelectorAll('.episode-btn').forEach(b => {
                                        b.classList.remove('ring-2', 'ring-purple-500');
                                        b.querySelector('.episode-overlay').classList.remove('opacity-100');
                                    });
                                    epBtn.classList.add('ring-2', 'ring-purple-500');
                                    epBtn.querySelector('.episode-overlay').classList.add('opacity-100');
                                    currentEpisode = ep.episode_number;
                                    renderSources();
                                    updateEmbeddedPlayerForEpisode();
                                };
                                episodeGrid.appendChild(epClone);
                            });
                        };
                        if (parseInt(sNum) === 1) {
                            btn.click();
                        }
                        seasonList.appendChild(clone);
                    });
                } else if (type === 'movie') {
                    // For movies, show sources immediately
                    renderSources();
                }
                
                // Finish loading
                loadingOverlay.classList.add('opacity-0');
                setTimeout(() => loadingOverlay.remove(), 300);
                contentContainer.classList.remove('hidden');
                requestAnimationFrame(() => {
                    contentContainer.classList.remove('opacity-0');
                    document.querySelectorAll('#poster-anim-target, #info-anim-target, #right-panel-anim-target, #detail-overview, #cast-container, #media-container').forEach(el => {
                        el?.classList.remove('opacity-0', 'translate-y-4');
                    });
                });
                return; // Exit early - custom ID handled
            }
            
            // Check if the ID is an IMDB ID - if so, try TMDB first for richer metadata
            const isImdbId = id.startsWith('tt');
            let tmdbId = null;
            let tmdbType = isTV ? 'tv' : 'movie';
            
            if (isImdbId) {
                try {
                    console.log('[Details] ID is IMDB, looking up TMDB...');
                    const findResult = await findByExternalId(id, 'imdb_id');
                    
                    // Check movie_results and tv_results
                    if (findResult.movie_results && findResult.movie_results.length > 0) {
                        tmdbId = findResult.movie_results[0].id;
                        tmdbType = 'movie';
                    } else if (findResult.tv_results && findResult.tv_results.length > 0) {
                        tmdbId = findResult.tv_results[0].id;
                        tmdbType = 'tv';
                    }
                    
                    if (tmdbId) {
                        console.log(`[Details] Found TMDB ID: ${tmdbId} (${tmdbType})`);
                    }
                } catch (e) {
                    console.warn('[Details] TMDB lookup failed:', e.message);
                }
            }
            
            // If we found a TMDB ID, use TMDB for details
            if (tmdbId) {
                currentTmdbId = tmdbId; // Store the actual TMDB ID
                const fetchFn = tmdbType === 'tv' ? getTVShowDetails : getMovieDetails;
                const data = await fetchFn(tmdbId);
                currentDetails = data;
                currentImdbId = id; // We already have the IMDB ID
                
                renderDetails(data);
                loadScreenshots();
                loadTrailer();
                await renderAddonTabs();

                if (tmdbType === 'tv') {
                    seasonSection.classList.remove('hidden');
                    episodeSection.classList.remove('hidden');
                    const regularSeasons = data.seasons.filter(s => s.season_number > 0);
                    regularSeasons.forEach(season => {
                        const clone = seasonBtnTemplate.content.cloneNode(true);
                        const btn = clone.querySelector('.season-btn');
                        btn.textContent = `Season ${season.season_number}`;
                        btn.onclick = () => {
                            document.querySelectorAll('.season-btn').forEach(b => b.classList.remove('bg-purple-600', 'text-white'));
                            btn.classList.add('bg-purple-600', 'text-white');
                            currentSeason = season.season_number;
                            currentEpisode = null;
                            sourcesList.classList.add('hidden');
                            selectEpisodeMsg.classList.remove('hidden');
                            loadEpisodes(currentSeason);
                        };
                        if (season.season_number === (regularSeasons[0]?.season_number || 1)) {
                            btn.classList.add('bg-purple-600', 'text-white');
                            currentSeason = season.season_number;
                            loadEpisodes(currentSeason);
                        }
                        seasonList.appendChild(clone);
                    });
                } else {
                    renderSources();
                }
            } else {
                // Fallback to addon meta endpoint
                const addons = await getInstalledAddons();
                const addon = addons.find(a => a.manifest.id === addonId);
                if (!addon) throw new Error('Addon not found');
                
                let url = addon.url.replace('/manifest.json', '');
                if (url.endsWith('/')) url = url.slice(0, -1);
                
                const metaUrl = `${url}/meta/${type}/${id}.json`;
                console.log('Fetching addon meta:', metaUrl);
                const res = await fetch(metaUrl);
                const data = await res.json();
                
                if (!data.meta) throw new Error('Metadata not found');
                
                currentDetails = data.meta;
                currentDetails.title = currentDetails.name;
                currentDetails.name = currentDetails.name;
                currentDetails.poster_path = currentDetails.poster;
                currentDetails.backdrop_path = currentDetails.background;
                currentDetails.overview = currentDetails.description;
                currentDetails.vote_average = currentDetails.imdbRating ? parseFloat(currentDetails.imdbRating) : null;
                
                if (currentDetails.runtime) {
                     // Format usually "120 min" or similar
                     currentDetails.runtime = parseInt(currentDetails.runtime);
                }

                if (currentDetails.cast) {
                    currentDetails.credits = { cast: currentDetails.cast.map(c => ({ name: c, id: '' })) };
                }

                currentImdbId = currentDetails.imdb_id || currentDetails.imdb_id || (id.startsWith('tt') ? id : null);
                
                // Check if addon meta includes moviedb_id (TMDB ID) - use it for richer metadata
                const addonTmdbId = currentDetails.moviedb_id || currentDetails.tmdb_id;
                if (addonTmdbId) {
                    console.log('[Details] Addon meta includes TMDB ID:', addonTmdbId);
                    currentTmdbId = addonTmdbId;
                    
                    // Fetch full TMDB data for better metadata and episodes
                    try {
                        const tmdbFetchFn = isTV ? getTVShowDetails : getMovieDetails;
                        const tmdbData = await tmdbFetchFn(addonTmdbId);
                        
                        // Merge TMDB data with addon data (prefer TMDB for most fields)
                        currentDetails = {
                            ...currentDetails,
                            ...tmdbData,
                            // Keep addon-specific fields
                            id: currentDetails.id,
                            imdb_id: currentImdbId
                        };
                        
                        renderDetails(currentDetails);
                        loadScreenshots();
                        loadTrailer();
                        await renderAddonTabs();
                        
                        if (isTV && tmdbData.seasons) {
                            seasonSection.classList.remove('hidden');
                            episodeSection.classList.remove('hidden');
                            const regularSeasons = tmdbData.seasons.filter(s => s.season_number > 0);
                            regularSeasons.forEach(season => {
                                const clone = seasonBtnTemplate.content.cloneNode(true);
                                const btn = clone.querySelector('.season-btn');
                                btn.textContent = `Season ${season.season_number}`;
                                btn.onclick = () => {
                                    document.querySelectorAll('.season-btn').forEach(b => b.classList.remove('bg-purple-600', 'text-white'));
                                    btn.classList.add('bg-purple-600', 'text-white');
                                    currentSeason = season.season_number;
                                    currentEpisode = null;
                                    sourcesList.classList.add('hidden');
                                    selectEpisodeMsg.classList.remove('hidden');
                                    loadEpisodes(currentSeason);
                                };
                                if (season.season_number === (regularSeasons[0]?.season_number || 1)) {
                                    btn.classList.add('bg-purple-600', 'text-white');
                                    currentSeason = season.season_number;
                                    loadEpisodes(currentSeason);
                                }
                                seasonList.appendChild(clone);
                            });
                        } else {
                            renderSources();
                        }
                        
                        // Skip the rest of addon meta handling since we used TMDB
                        loadingOverlay.classList.add('opacity-0');
                        setTimeout(() => loadingOverlay.remove(), 300);
                        contentContainer.classList.remove('hidden');
                        requestAnimationFrame(() => {
                            contentContainer.classList.remove('opacity-0');
                            document.querySelectorAll('#poster-anim-target, #info-anim-target, #right-panel-anim-target, #detail-overview, #cast-container, #media-container').forEach(el => {
                                el?.classList.remove('opacity-0', 'translate-y-4');
                            });
                        });
                        return; // Exit early since we handled everything with TMDB data
                    } catch (e) {
                        console.warn('[Details] Failed to fetch TMDB data using moviedb_id:', e);
                        // Continue with addon meta fallback
                    }
                }
            
                renderDetails(currentDetails);
                await renderAddonTabs();
                
                if (isTV && currentDetails.videos && currentDetails.videos.length > 0) {
                    seasonSection.classList.remove('hidden');
                    episodeSection.classList.remove('hidden');
                    
                    const seasons = {};
                    currentDetails.videos.forEach(v => {
                        if (!seasons[v.season]) seasons[v.season] = [];
                        seasons[v.season].push({
                            episode_number: v.episode,
                            name: v.title || `Episode ${v.episode}`,
                            still_path: v.thumbnail,
                            overview: v.overview,
                            id: v.id
                        });
                    });
                    
                    Object.keys(seasons).sort((a,b) => a - b).forEach(sNum => {
                        const clone = seasonBtnTemplate.content.cloneNode(true);
                        const btn = clone.querySelector('.season-btn');
                        btn.textContent = `Season ${sNum}`;
                        btn.onclick = () => {
                            document.querySelectorAll('.season-btn').forEach(b => b.classList.remove('bg-purple-600', 'text-white'));
                            btn.classList.add('bg-purple-600', 'text-white');
                            currentSeason = parseInt(sNum);
                            currentEpisode = null;
                            sourcesList.classList.add('hidden');
                            selectEpisodeMsg.classList.remove('hidden');
                            
                            episodeGrid.innerHTML = '';
                            episodesTitle.textContent = `Episodes (${seasons[sNum].length})`;
                            seasons[sNum].sort((a,b) => a.episode_number - b.episode_number).forEach(ep => {
                                const epClone = episodeCardTemplate.content.cloneNode(true);
                                const epBtn = epClone.querySelector('.episode-btn');
                                if (ep.still_path) {
                                    const img = epClone.querySelector('.episode-img');
                                    img.src = ep.still_path;
                                    img.classList.remove('hidden');
                                    epClone.querySelector('.episode-placeholder').classList.add('hidden');
                                }
                                epClone.querySelector('.episode-number').textContent = ep.episode_number;
                                epClone.querySelector('.episode-name').textContent = ep.name;
                                epBtn.onclick = () => {
                                    document.querySelectorAll('.episode-btn').forEach(b => {
                                        b.classList.remove('ring-2', 'ring-purple-500');
                                        b.querySelector('.episode-overlay').classList.remove('opacity-100');
                                    });
                                    epBtn.classList.add('ring-2', 'ring-purple-500');
                                    epBtn.querySelector('.episode-overlay').classList.add('opacity-100');
                                    currentEpisode = ep.episode_number;
                                    renderSources();
                                    // Auto-update embedded player if it's visible
                                    updateEmbeddedPlayerForEpisode();
                                };
                                episodeGrid.appendChild(epClone);
                            });
                        };
                        if (parseInt(sNum) === 1) {
                             btn.click();
                        }
                        seasonList.appendChild(clone);
                    });
                } else if (isTV) {
                    // Addon meta doesn't have videos array - try to get episode info from TMDB using IMDB ID
                    let tmdbData = null;
                    if (currentImdbId) {
                        try {
                            const findResult = await findByExternalId(currentImdbId, 'imdb_id');
                            const tvResult = findResult.tv_results?.[0];
                            if (tvResult) {
                                currentTmdbId = tvResult.id;
                                tmdbData = await getTVShowDetails(tvResult.id);
                            }
                        } catch (e) {
                            console.warn('[Details] TMDB lookup for episodes failed:', e);
                        }
                    }
                    
                    if (tmdbData && tmdbData.seasons) {
                        seasonSection.classList.remove('hidden');
                        episodeSection.classList.remove('hidden');
                        const regularSeasons = tmdbData.seasons.filter(s => s.season_number > 0);
                        regularSeasons.forEach(season => {
                            const clone = seasonBtnTemplate.content.cloneNode(true);
                            const btn = clone.querySelector('.season-btn');
                            btn.textContent = `Season ${season.season_number}`;
                            btn.onclick = () => {
                                document.querySelectorAll('.season-btn').forEach(b => b.classList.remove('bg-purple-600', 'text-white'));
                                btn.classList.add('bg-purple-600', 'text-white');
                                currentSeason = season.season_number;
                                currentEpisode = null;
                                sourcesList.classList.add('hidden');
                                selectEpisodeMsg.classList.remove('hidden');
                                loadEpisodes(currentSeason);
                            };
                            if (season.season_number === (regularSeasons[0]?.season_number || 1)) {
                                btn.classList.add('bg-purple-600', 'text-white');
                                currentSeason = season.season_number;
                                loadEpisodes(currentSeason);
                            }
                            seasonList.appendChild(clone);
                        });
                    } else {
                        // No episode info available - show message
                        seasonSection.classList.remove('hidden');
                        episodeSection.classList.remove('hidden');
                        episodeGrid.innerHTML = '<div class="col-span-full text-center text-gray-400 py-8">Episode information not available. Select a season and episode manually when searching for sources.</div>';
                        renderSources();
                    }
                } else {
                    renderSources();
                }
            } // Close the else block for addon meta fallback

        } else {
            currentTmdbId = id; // For non-addon items, id IS the TMDB ID
            const fetchFn = isTV ? getTVShowDetails : getMovieDetails;
            const data = await fetchFn(id);
            currentDetails = data;
            
            try {
                const extIds = await getExternalIds(id, type);
                currentImdbId = extIds.imdb_id;
                console.log('[Details] Fetched IMDB ID:', currentImdbId);
            } catch (e) {
                console.warn('[Details] Failed to fetch external IDs:', e.message);
            }

            renderDetails(data);
            loadScreenshots();
            loadTrailer();
            await renderAddonTabs();

            if (isTV) {
                seasonSection.classList.remove('hidden');
                episodeSection.classList.remove('hidden');
                const regularSeasons = data.seasons.filter(s => s.season_number > 0);
                regularSeasons.forEach(season => {
                    const clone = seasonBtnTemplate.content.cloneNode(true);
                    const btn = clone.querySelector('.season-btn');
                    btn.textContent = `Season ${season.season_number}`;
                    btn.onclick = () => {
                        document.querySelectorAll('.season-btn').forEach(b => b.classList.remove('bg-purple-600', 'text-white'));
                        btn.classList.add('bg-purple-600', 'text-white');
                        currentSeason = season.season_number;
                        currentEpisode = null;
                        sourcesList.classList.add('hidden');
                        selectEpisodeMsg.classList.remove('hidden');
                        loadEpisodes(currentSeason);
                    };
                    if (season.season_number === (regularSeasons[0]?.season_number || 1)) {
                        btn.classList.add('bg-purple-600', 'text-white');
                        currentSeason = season.season_number;
                        loadEpisodes(currentSeason);
                    }
                    seasonList.appendChild(clone);
                });
            } else {
                renderSources();
            }
        }

        loadingOverlay.classList.add('opacity-0');
        setTimeout(() => loadingOverlay.remove(), 300);
        contentContainer.classList.remove('hidden');
        requestAnimationFrame(() => {
            contentContainer.classList.remove('opacity-0');
            document.querySelectorAll('#poster-anim-target, #info-anim-target, #right-panel-anim-target, #detail-overview, #cast-container, #media-container').forEach(el => {
               el.classList.remove('opacity-0', 'translate-y-4', 'translate-x-4'); 
            });
        });
    } catch (error) {
        console.error("[DETAILS] Init failed:", error);
        loadingOverlay.innerHTML = '<p class="text-red-500">Failed to load content. Please try again.</p>';
    }
};

document.addEventListener('DOMContentLoaded', init);
