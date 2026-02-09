// Streaming Mode - Stream Extraction & Player (HLS.js based)
let streamingModeEnabled = true;
let streamingModeLoaded = false; // Track if setting has been loaded
let currentProvider = 'videasy';
let currentStreamUrl = null;
let previousStreamUrl = null; // Store previous stream for cancel fallback
let previousProvider = null; // Store previous provider for cancel fallback
let previousPlaybackTime = 0; // Store playback time for cancel fallback
let currentSubtitles = [];
let isLoadingStream = false;
let streamHls = null;
let streamDash = null;
let activeSub = null;
let subDelay = 0;
let subSize = 150; // percentage
let subPos = 130; // pixels from bottom
let introData = null; // Store intro/recap/credits data
let currentSegmentType = null; // Track which segment we're in
let nextEpisodeInfo = null; // Store next episode info for TV shows

// Load streaming mode setting from API
async function loadStreamingModeSetting() {
    try {
        const response = await fetch('/api/settings');
        if (response.ok) {
            const settings = await response.json();
            // Default to true if not set
            streamingModeEnabled = settings.streamingMode !== undefined ? settings.streamingMode : true;
            streamingModeLoaded = true;
            console.log('[StreamingMode] Loaded setting from API:', streamingModeEnabled);
        } else {
            // Fallback to localStorage
            const localSettings = JSON.parse(localStorage.getItem('streamingModeSettings') || '{}');
            streamingModeEnabled = localSettings.enabled !== false;
            streamingModeLoaded = true;
            console.log('[StreamingMode] Loaded setting from localStorage:', streamingModeEnabled);
        }
    } catch (e) {
        console.warn('[StreamingMode] Failed to load from API, using default:', e);
        streamingModeEnabled = true;
        streamingModeLoaded = true;
    }
    return streamingModeEnabled;
}

// Save streaming mode setting to API
async function saveStreamingModeSetting(enabled) {
    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ streamingMode: enabled })
        });
        
        if (response.ok) {
            streamingModeEnabled = enabled;
            console.log('[StreamingMode] Saved setting to API:', enabled);
        } else {
            // Fallback to localStorage
            localStorage.setItem('streamingModeSettings', JSON.stringify({ enabled }));
            streamingModeEnabled = enabled;
            console.log('[StreamingMode] Saved setting to localStorage:', enabled);
        }
    } catch (e) {
        console.error('[StreamingMode] Failed to save setting:', e);
        // Fallback to localStorage
        localStorage.setItem('streamingModeSettings', JSON.stringify({ enabled }));
        streamingModeEnabled = enabled;
    }
}

// Initialize streaming mode (async) - await this before checking enabled()
const streamingModeReady = loadStreamingModeSetting();

// Provider URLs
const PROVIDERS = {
    videasy: {
        name: 'Videasy',
        movie: (tmdbId) => `https://player.videasy.net/movie/${tmdbId}`,
        tv: (tmdbId, season, episode) => `https://player.videasy.net/tv/${tmdbId}/${season}/${episode}`
    },
    anitaro: {
        name: 'Anitaro (4K)',
        movie: (tmdbId) => `https://api.anitaro.live/cdn/movie/${tmdbId}`,
        tv: (tmdbId, season, episode) => `https://api.anitaro.live/cdn/tv/${tmdbId}/${season}/${episode}`
    },
    cinesrc: {
        name: 'CineSrc',
        movie: (tmdbId) => `https://cinesrc.st/embed/movie/${tmdbId}`,
        tv: (tmdbId, season, episode) => `https://cinesrc.st/embed/tv/${tmdbId}?s=${season}&e=${episode}`
    },
    vidfast: {
        name: 'Vidfast',
        movie: (tmdbId) => `https://vidfast.pro/movie/${tmdbId}`,
        tv: (tmdbId, season, episode) => `https://vidfast.pro/tv/${tmdbId}/${season}/${episode}`
    },
    vidlink: {
        name: 'Vidlink',
        movie: (tmdbId) => `https://vidlink.pro/movie/${tmdbId}`,
        tv: (tmdbId, season, episode) => `https://vidlink.pro/tv/${tmdbId}/${season}/${episode}`
    },
    flixer: {
        name: 'Flixer',
        movie: (tmdbId) => `https://flixer.sh/watch/movie/${tmdbId}`,
        tv: (tmdbId, season, episode) => `https://flixer.sh/watch/tv/${tmdbId}/${season}/${episode}`
    },
    vixsrc: {
        name: 'VixSrc',
        movie: (tmdbId) => `https://vixsrc.to/movie/${tmdbId}/`,
        tv: (tmdbId, season, episode) => `https://vixsrc.to/tv/${tmdbId}/${season}/${episode}/`
    },
    fmovies: {
        name: 'FMovies',
        movie: (tmdbId) => `https://www.fmovies.gd/watch/movie/${tmdbId}`,
        tv: (tmdbId, season, episode) => `https://www.fmovies.gd/watch/tv/${tmdbId}/${season}/${episode}`
    },
    movies111: {
        name: '111Movies',
        movie: (tmdbId) => `https://111movies.com/movie/${tmdbId}`,
        tv: (tmdbId, season, episode) => `https://111movies.com/tv/${tmdbId}/${season}/${episode}`
    },
    vidzee: {
        name: 'Vidzee',
        movie: (tmdbId) => `https://player.vidzee.wtf/embed/movie/${tmdbId}`,
        tv: (tmdbId, season, episode) => `https://player.vidzee.wtf/embed/tv/${tmdbId}/${season}/${episode}`
    }
};

// Get provider URL
function getProviderUrl(provider, type, tmdbId, season = null, episode = null) {
    const prov = PROVIDERS[provider];
    if (!prov) return null;
    
    if (type === 'movie') {
        return prov.movie(tmdbId);
    } else {
        return prov.tv(tmdbId, season, episode);
    }
}

// Extract stream from URL
async function extractStream(url, provider = currentProvider) {
    try {
        console.log('[StreamExtractor] Extracting from:', url);
        console.log('[StreamExtractor] Provider:', provider);
        console.log('[StreamExtractor] electronAPI available:', typeof window.electronAPI !== 'undefined');
        console.log('[StreamExtractor] extractStream method:', typeof window.electronAPI?.extractStream);
        
        // Add delay for Flixer (it's slower)
        if (provider === 'flixer') {
            console.log('[StreamExtractor] Waiting 3 seconds for Flixer...');
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
        // Add delay for VixSrc (needs time to load player)
        if (provider === 'vixsrc') {
            console.log('[StreamExtractor] Waiting 5 seconds for VixSrc...');
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
        
        console.log('[StreamExtractor] Calling electronAPI.extractStream...');
        await window.electronAPI.extractStream(url);
        
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                console.error('[StreamExtractor] ❌ Timeout waiting for stream');
                window.electronAPI.removeStreamListener(handler);
                reject(new Error('Stream extraction timeout'));
            }, 45000);
            
            const handler = (data) => {
                clearTimeout(timeout);
                window.electronAPI.removeStreamListener(handler);
                console.log('[StreamExtractor] ✅ Stream detected:', data);
                console.log('[StreamExtractor] Proxy URL:', data.proxyUrl);
                resolve(data.proxyUrl);
            };
            
            console.log('[StreamExtractor] Waiting for stream-detected event...');
            window.electronAPI.onStreamDetected(handler);
        });
    } catch (error) {
        console.error('[StreamExtractor] ❌ Error:', error);
        throw error;
    }
}

// Load intro/recap/credits data from IntroDB
async function loadIntroData(tmdbId, season = null, episode = null) {
    try {
        let url = `https://api.theintrodb.org/v1/media?tmdb_id=${tmdbId}`;
        if (season && episode) {
            url += `&season=${season}&episode=${episode}`;
        }
        
        console.log('[IntroDB] Loading intro data from:', url);
        
        const response = await fetch(url);
        const data = await response.json();
        
        console.log('[IntroDB] Loaded intro data:', data);
        return data;
    } catch (error) {
        console.error('[IntroDB] Error loading intro data:', error);
        return null;
    }
}
async function loadSubtitles(tmdbId, imdbId, season = null, episode = null, mediaType = 'movie') {
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
                    let url = `https://sub.wyzie.ru/search?id=${tmdbId}`;
                    if (season && episode) {
                        url += `&season=${season}&episode=${episode}`;
                    }
                    
                    console.log('[Subtitles] Loading from Wyzie:', url);
                    
                    const response = await fetch(url);
                    const subs = await response.json();
                    
                    if (subs && subs.length > 0) {
                        subs.forEach(sub => {
                            if (sub.url) {
                                subtitles.push({
                                    provider: 'Wyzie',
                                    display: sub.display || sub.languageName || 'Unknown',
                                    language: sub.language || 'unknown',
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
        
        // 2. Fetch from Stremio Addons
        fetchPromises.push((async () => {
            try {
                const { getInstalledAddons } = await import('./addons.js');
                const addons = await getInstalledAddons();
                
                if (!addons || addons.length === 0) return;
                
                const addonPromises = addons.map(async (addon) => {
                    const resources = addon.manifest?.resources || [];
                    const hasSubtitles = resources.some(r => 
                        (typeof r === 'string' && r === 'subtitles') ||
                        (typeof r === 'object' && r?.name === 'subtitles')
                    );
                    
                    if (!hasSubtitles) return;
                    
                    try {
                        let baseUrl = addon.url ? addon.url.replace('/manifest.json', '') : addon.baseUrl;
                        if (baseUrl && baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
                        
                        if (!baseUrl) return;
                        
                        const resourceId = mediaType === 'tv' && season && episode
                            ? `${imdbId}:${season}:${episode}`
                            : imdbId;
                        
                        if (!resourceId) return;
                        
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
                                        display: `${sub.lang || sub.language || 'Unknown'}`,
                                        language: sub.lang || sub.language || 'unknown',
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
    })();
    
    await Promise.race([fetchPromise, timeoutPromise]);
    
    console.log('[Subtitles] Loaded:', subtitles.length, 'subtitles');
    return subtitles || [];
}

// Show loading screen
function showLoadingScreen(posterUrl, title) {
    const loadingScreen = document.getElementById('stream-loading-screen');
    if (!loadingScreen) return;
    
    const poster = loadingScreen.querySelector('.loading-poster');
    const titleEl = loadingScreen.querySelector('.loading-title');
    const statusEl = loadingScreen.querySelector('.loading-status');
    
    if (poster) poster.style.backgroundImage = `url(${posterUrl})`;
    if (titleEl) titleEl.textContent = title;
    if (statusEl) statusEl.textContent = 'Getting streams...';
    
    loadingScreen.classList.add('active');
    document.body.style.overflow = 'hidden';
}

// Hide loading screen
function hideLoadingScreen() {
    const loadingScreen = document.getElementById('stream-loading-screen');
    if (!loadingScreen) return;
    
    loadingScreen.classList.remove('active');
    document.body.style.overflow = '';
}

// Update loading status
function updateLoadingStatus(status) {
    const statusEl = document.querySelector('.loading-status');
    if (statusEl) statusEl.textContent = status;
}

// Show stream player
function showStreamPlayer() {
    const player = document.getElementById('stream-player-container');
    if (!player) return;
    
    player.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    // Initialize player controls after showing
    initPlayerControls();
}

// Hide stream player
function hideStreamPlayer() {
    // Exit fullscreen first if in fullscreen mode
    if (document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement) {
        console.log('[Player] Exiting fullscreen before closing...');
        
        // Exit fullscreen
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.mozCancelFullScreen) {
            document.mozCancelFullScreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
        
        // Wait for fullscreen to exit before closing
        setTimeout(() => {
            actuallyHidePlayer();
        }, 300);
    } else {
        // Not in fullscreen, close immediately
        actuallyHidePlayer();
    }
}

// Actually hide the player (separated for fullscreen handling)
function actuallyHidePlayer() {
    const player = document.getElementById('stream-player-container');
    if (!player) return;
    
    // Save playback position before closing
    const video = document.getElementById('stream-video');
    if (video && window.currentMediaInfo) {
        savePlaybackPosition(video.currentTime);
    }
    
    player.classList.remove('active');
    document.body.style.overflow = '';
    
    // Stop video and cleanup
    if (video) {
        video.pause();
        video.src = '';
        video.load();
    }
    
    // Destroy HLS instance if exists
    if (streamHls) {
        streamHls.destroy();
        streamHls = null;
    }
    
    // Destroy DASH instance if exists
    if (streamDash) {
        streamDash.reset();
        streamDash = null;
    }
    
    // Clear subtitle overlay
    const subOverlay = document.getElementById('subtitle-overlay');
    if (subOverlay) subOverlay.textContent = '';
    
    // Hide skip button
    const skipBtn = document.getElementById('skip-segment-btn');
    if (skipBtn) skipBtn.style.display = 'none';
    
    // Hide next episode button
    const nextEpBtn = document.getElementById('next-episode-btn');
    if (nextEpBtn) nextEpBtn.style.display = 'none';
    
    // Reset current stream data
    currentStreamUrl = null;
    currentSubtitles = [];
    activeSub = null;
    introData = null;
    currentSegmentType = null;
    nextEpisodeInfo = null;
}

// Save playback position to localStorage
function savePlaybackPosition(time) {
    if (!window.currentMediaInfo) return;
    
    const { type, tmdbId, season, episode, posterUrl, title } = window.currentMediaInfo;
    const key = type === 'movie' 
        ? `playback_${type}_${tmdbId}`
        : `playback_${type}_${tmdbId}_${season}_${episode}`;
    
    try {
        // Save playback position
        localStorage.setItem(key, time.toString());
        console.log('[Playback] Saved position:', time, 'for', key);
        
        // Save to continue watching list
        const continueWatching = getContinueWatchingList();
        const itemKey = type === 'movie' ? `${type}_${tmdbId}` : `${type}_${tmdbId}`;
        
        // Remove existing entry if present
        const filtered = continueWatching.filter(item => item.key !== itemKey);
        
        // Add new entry at the beginning
        filtered.unshift({
            key: itemKey,
            type,
            tmdbId,
            season: season || null,
            episode: episode || null,
            posterUrl,
            title,
            time,
            timestamp: Date.now()
        });
        
        // Keep only last 20 items
        const limited = filtered.slice(0, 20);
        localStorage.setItem('continueWatching', JSON.stringify(limited));
        
    } catch (e) {
        console.error('[Playback] Failed to save position:', e);
    }
}

// Get saved playback position from localStorage
function getSavedPlaybackPosition() {
    if (!window.currentMediaInfo) return 0;
    
    const { type, tmdbId, season, episode } = window.currentMediaInfo;
    const key = type === 'movie' 
        ? `playback_${type}_${tmdbId}`
        : `playback_${type}_${tmdbId}_${season}_${episode}`;
    
    try {
        const saved = localStorage.getItem(key);
        const time = saved ? parseFloat(saved) : 0;
        console.log('[Playback] Retrieved position:', time, 'for', key);
        return time;
    } catch (e) {
        console.error('[Playback] Failed to retrieve position:', e);
        return 0;
    }
}

// Get continue watching list
function getContinueWatchingList() {
    try {
        const saved = localStorage.getItem('continueWatching');
        return saved ? JSON.parse(saved) : [];
    } catch (e) {
        console.error('[ContinueWatching] Failed to retrieve list:', e);
        return [];
    }
}

// Remove item from continue watching
function removeFromContinueWatching(itemKey) {
    try {
        const continueWatching = getContinueWatchingList();
        const filtered = continueWatching.filter(item => item.key !== itemKey);
        localStorage.setItem('continueWatching', JSON.stringify(filtered));
        
        // Also remove the playback position
        const item = continueWatching.find(i => i.key === itemKey);
        if (item) {
            const posKey = item.type === 'movie' 
                ? `playback_${item.type}_${item.tmdbId}`
                : `playback_${item.type}_${item.tmdbId}_${item.season}_${item.episode}`;
            localStorage.removeItem(posKey);
        }
        
        console.log('[ContinueWatching] Removed item:', itemKey);
        return true;
    } catch (e) {
        console.error('[ContinueWatching] Failed to remove item:', e);
        return false;
    }
}

// Make functions globally accessible
window.getContinueWatchingList = getContinueWatchingList;
window.removeFromContinueWatching = removeFromContinueWatching;

// Play stream
async function playStream(type, tmdbId, posterUrl, title, season = null, episode = null) {
    console.log('[StreamingMode] ========================================');
    console.log('[StreamingMode] playStream called');
    console.log('[StreamingMode] Type:', type);
    console.log('[StreamingMode] TMDB ID:', tmdbId);
    console.log('[StreamingMode] Title:', title);
    console.log('[StreamingMode] Season:', season, 'Episode:', episode);
    console.log('[StreamingMode] Enabled:', streamingModeEnabled);
    console.log('[StreamingMode] Already loading:', isLoadingStream);
    console.log('[StreamingMode] ========================================');
    
    if (!streamingModeEnabled) {
        console.log('[StreamingMode] Disabled, using default player');
        return false;
    }
    
    if (isLoadingStream) {
        console.log('[StreamingMode] Already loading a stream');
        return true;
    }
    
    isLoadingStream = true;
    
    // Get backdrop image instead of poster
    let backdropUrl = posterUrl;
    try {
        const API_KEY = 'c3515fdc674ea2bd7b514f4bc3616a4a';
        const BASE_URL = 'https://api.themoviedb.org/3';
        const IMG_BASE_URL = 'https://image.tmdb.org/t/p';
        
        const detailsUrl = `${BASE_URL}/${type}/${tmdbId}?api_key=${API_KEY}`;
        const response = await fetch(detailsUrl);
        const data = await response.json();
        
        if (data.backdrop_path) {
            backdropUrl = `${IMG_BASE_URL}/original${data.backdrop_path}`;
            console.log('[StreamingMode] Got backdrop URL:', backdropUrl);
        }
    } catch (error) {
        console.log('[StreamingMode] Could not fetch backdrop, using poster');
    }
    
    // Store media info for provider switching
    window.currentMediaInfo = { type, tmdbId, posterUrl: backdropUrl, title, season, episode };
    
    // For TV shows, calculate next episode info
    if (type === 'tv' && season && episode) {
        nextEpisodeInfo = {
            type: 'tv',
            tmdbId,
            season: parseInt(season),
            episode: parseInt(episode) + 1,
            posterUrl: backdropUrl,
            title
        };
        console.log('[StreamingMode] Next episode info:', nextEpisodeInfo);
    } else {
        nextEpisodeInfo = null;
    }
    
    try {
        // Show loading screen with backdrop
        console.log('[StreamingMode] Showing loading screen...');
        showLoadingScreen(backdropUrl, title);
        
        // Get provider URL
        const providerUrl = getProviderUrl(currentProvider, type, tmdbId, season, episode);
        if (!providerUrl) {
            throw new Error('Invalid provider or parameters');
        }
        
        console.log('[StreamingMode] Provider URL:', providerUrl);
        console.log('[StreamingMode] Current provider:', currentProvider);
        
        updateLoadingStatus(`Extracting from ${PROVIDERS[currentProvider].name}...`);
        
        // Extract stream
        console.log('[StreamingMode] Starting stream extraction...');
        const streamUrl = await extractStream(providerUrl, currentProvider);
        console.log('[StreamingMode] ✅ Stream extracted:', streamUrl);
        
        currentStreamUrl = streamUrl;
        
        updateLoadingStatus('Loading subtitles...');
        
        // Load subtitles
        console.log('[StreamingMode] Loading subtitles...');
        
        // Fetch IMDB ID for Stremio addons
        let imdbId = null;
        try {
            const API_KEY = 'c3515fdc674ea2bd7b514f4bc3616a4a';
            const BASE_URL = 'https://api.themoviedb.org/3';
            const externalIdsUrl = `${BASE_URL}/${type}/${tmdbId}/external_ids?api_key=${API_KEY}`;
            const externalIdsResponse = await fetch(externalIdsUrl);
            const externalIdsData = await externalIdsResponse.json();
            imdbId = externalIdsData.imdb_id;
            console.log('[StreamingMode] IMDB ID:', imdbId);
        } catch (error) {
            console.warn('[StreamingMode] Could not fetch IMDB ID:', error);
        }
        
        currentSubtitles = await loadSubtitles(tmdbId, imdbId, season, episode, type);
        console.log('[StreamingMode] Loaded', currentSubtitles.length, 'subtitles');
        
        // Load intro/recap/credits data
        console.log('[StreamingMode] Loading intro data...');
        introData = await loadIntroData(tmdbId, season, episode);
        console.log('[StreamingMode] Intro data:', introData);
        
        // Hide loading, show player
        console.log('[StreamingMode] Hiding loading screen...');
        hideLoadingScreen();
        
        console.log('[StreamingMode] Showing player...');
        showStreamPlayer();
        
        // Load stream into player
        console.log('[StreamingMode] Loading stream into player...');
        loadStreamIntoPlayer(streamUrl, title);
        
        // Load subtitles into player
        console.log('[StreamingMode] Loading subtitles into player...');
        loadSubtitlesIntoPlayer(currentSubtitles);
        
        console.log('[StreamingMode] ✅ Stream playback initiated successfully');
        
        return true;
    } catch (error) {
        console.error('[StreamingMode] ❌ Error:', error);
        console.error('[StreamingMode] Error stack:', error.stack);
        hideLoadingScreen();
        isLoadingStream = false;
        alert(`Failed to load stream: ${error.message}`);
        return false;
    } finally {
        isLoadingStream = false;
        console.log('[StreamingMode] isLoadingStream reset to false');
    }
}

// Load stream into video player using HLS.js or dash.js
function loadStreamIntoPlayer(streamUrl, title) {
    const video = document.getElementById('stream-video');
    const titleEl = document.getElementById('stream-player-title');
    
    console.log('[Player] loadStreamIntoPlayer called with:', streamUrl);
    console.log('[Player] Video element:', video);
    console.log('[Player] HLS available:', typeof Hls !== 'undefined');
    console.log('[Player] DASH available:', typeof dashjs !== 'undefined');
    
    if (!video) {
        console.error('[Player] Video element not found!');
        return;
    }
    
    if (titleEl) titleEl.textContent = title;
    
    // Destroy old instances
    if (streamHls) {
        try {
            console.log('[Player] Destroying old HLS instance');
            streamHls.destroy();
        } catch (e) {
            console.log('[Player] Error destroying HLS:', e);
        }
        streamHls = null;
    }
    
    if (streamDash) {
        try {
            console.log('[Player] Destroying old DASH instance');
            streamDash.reset();
        } catch (e) {
            console.log('[Player] Error destroying DASH:', e);
        }
        streamDash = null;
    }
    
    // Check if this is DASH (.mpd) or HLS (.m3u8)
    const isDash = streamUrl.includes('.mpd') || streamUrl.includes('manifest');
    const isM3U8 = streamUrl.includes('.m3u8') || streamUrl.includes('playlist');
    
    console.log('[Player] Is DASH stream:', isDash);
    console.log('[Player] Is M3U8 stream:', isM3U8);
    
    if (isDash && typeof dashjs !== 'undefined') {
        console.log('[Player] Using dash.js for DASH stream');
        
        streamDash = dashjs.MediaPlayer().create();
        streamDash.initialize(video, streamUrl, true);
        
        streamDash.on(dashjs.MediaPlayer.events.PLAYBACK_STARTED, () => {
            console.log('[Player] ✅ DASH playback started');
            
            // Restore saved playback position
            const savedTime = getSavedPlaybackPosition();
            if (savedTime > 0) {
                console.log('[Player] Restoring playback position:', savedTime);
                video.currentTime = savedTime;
            }
        });
        
        streamDash.on(dashjs.MediaPlayer.events.ERROR, (e) => {
            console.error('[Player] ❌ DASH Error:', e);
        });
        
        console.log('[Player] DASH stream loading initiated');
        
    } else if (isM3U8 && typeof Hls !== 'undefined' && Hls.isSupported()) {
        console.log('[Player] Using HLS.js for m3u8 stream');
        
        streamHls = new Hls({
            debug: true,
            enableWorker: false,
            lowLatencyMode: false,
            backBufferLength: 90,
            maxBufferLength: 30,
            maxMaxBufferLength: 600
        });
        
        console.log('[Player] Loading source:', streamUrl);
        streamHls.loadSource(streamUrl);
        
        console.log('[Player] Attaching media to video element');
        streamHls.attachMedia(video);
        
        streamHls.on(Hls.Events.MANIFEST_PARSED, () => {
            console.log('[Player] ✅ HLS manifest parsed, ready to play');
            console.log('[Player] Available levels:', streamHls.levels);
            
            // Populate quality selector
            populateQualityLevels();
            
            // Restore saved playback position
            const savedTime = getSavedPlaybackPosition();
            if (savedTime > 0) {
                console.log('[Player] Restoring playback position:', savedTime);
                video.currentTime = savedTime;
            }
            
            video.play().then(() => {
                console.log('[Player] ✅ Video playback started');
            }).catch(e => {
                console.error('[Player] ❌ Autoplay prevented:', e);
            });
        });
        
        streamHls.on(Hls.Events.LEVEL_LOADED, (event, data) => {
            console.log('[Player] Level loaded:', data.level, 'details:', data.details);
        });
        
        streamHls.on(Hls.Events.FRAG_LOADED, (event, data) => {
            console.log('[Player] Fragment loaded:', data.frag.sn);
        });
        
        streamHls.on(Hls.Events.ERROR, (event, data) => {
            console.error('[Player] ❌ HLS Error:', data);
            if (data.fatal) {
                console.error('[Player] Fatal error type:', data.type);
                console.error('[Player] Fatal error details:', data.details);
                
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                    console.log('[Player] Network error, trying to recover...');
                    streamHls.startLoad();
                } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                    console.log('[Player] Media error, trying to recover...');
                    streamHls.recoverMediaError();
                } else {
                    console.error('[Player] Unrecoverable error, destroying HLS');
                    streamHls.destroy();
                    streamHls = null;
                }
            }
        });
    } else if (isM3U8 && video.canPlayType('application/vnd.apple.mpegurl')) {
        console.log('[Player] Using native HLS support (Safari)');
        video.src = streamUrl;
        video.load();
        
        // Restore saved playback position
        video.addEventListener('loadedmetadata', () => {
            const savedTime = getSavedPlaybackPosition();
            if (savedTime > 0) {
                console.log('[Player] Restoring playback position:', savedTime);
                video.currentTime = savedTime;
            }
        }, { once: true });
        
        video.play().then(() => {
            console.log('[Player] ✅ Video playback started (native)');
        }).catch(e => {
            console.error('[Player] ❌ Autoplay prevented:', e);
        });
    } else {
        console.log('[Player] Using native video for direct stream');
        
        video.src = streamUrl;
        video.load();
        
        // Restore saved playback position
        video.addEventListener('loadedmetadata', () => {
            const savedTime = getSavedPlaybackPosition();
            if (savedTime > 0) {
                console.log('[Player] Restoring playback position:', savedTime);
                video.currentTime = savedTime;
            }
        }, { once: true });
        video.play().then(() => {
            console.log('[Player] ✅ Video playback started (direct)');
        }).catch(e => {
            console.error('[Player] ❌ Autoplay prevented:', e);
        });
    }
    
    console.log('[Player] Stream loading initiated');
}

// Parse SRT subtitle format (like player.html)
function parseSRT(srtText) {
    const lines = srtText.trim().split('\n');
    const cues = [];
    let i = 0;
    
    while (i < lines.length) {
        // Skip empty lines
        if (!lines[i].trim()) {
            i++;
            continue;
        }
        
        // Skip index line
        if (/^\d+$/.test(lines[i].trim())) {
            i++;
        }
        
        // Parse timestamp line
        if (i < lines.length && lines[i].includes('-->')) {
            const timeLine = lines[i];
            const [startStr, endStr] = timeLine.split('-->').map(s => s.trim());
            
            const start = parseTimestamp(startStr);
            const end = parseTimestamp(endStr);
            
            i++;
            
            // Collect text lines until empty line or next cue
            let text = '';
            while (i < lines.length && lines[i].trim() && !/^\d+$/.test(lines[i].trim())) {
                text += (text ? '\n' : '') + lines[i].trim();
                i++;
            }
            
            if (text) {
                cues.push({ start, end, text });
            }
        } else {
            i++;
        }
    }
    
    return cues;
}

// Parse SRT timestamp to seconds
function parseTimestamp(timestamp) {
    const parts = timestamp.replace(',', '.').split(':');
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const seconds = parseFloat(parts[2]);
    return hours * 3600 + minutes * 60 + seconds;
}

// Update subtitle display based on current time
function updateSubtitleDisplay() {
    const video = document.getElementById('stream-video');
    const overlay = document.getElementById('subtitle-overlay');
    
    if (!video || !overlay || !activeSub) {
        return;
    }
    
    const currentTime = video.currentTime + subDelay;
    
    // Find current cue
    const cue = activeSub.cues.find(c => currentTime >= c.start && currentTime <= c.end);
    
    if (cue) {
        overlay.textContent = cue.text;
        overlay.style.display = 'block';
    } else {
        overlay.textContent = '';
        overlay.style.display = 'none';
    }
}

// Check if we're in a skippable segment and show button
function checkSkippableSegment() {
    const video = document.getElementById('stream-video');
    const skipBtn = document.getElementById('skip-segment-btn');
    
    if (!video || !skipBtn || !introData) return;
    
    const currentTimeMs = video.currentTime * 1000;
    let inSegment = false;
    let segmentType = null;
    let segmentEnd = null;
    
    // Lower confidence threshold to 0.2 (20%) to catch more segments
    const CONFIDENCE_THRESHOLD = 0.2;
    
    // Check intro
    if (introData.intro && introData.intro.confidence >= CONFIDENCE_THRESHOLD) {
        const start = introData.intro.start_ms || 0;
        const end = introData.intro.end_ms;
        if (end && currentTimeMs >= start && currentTimeMs <= end) {
            inSegment = true;
            segmentType = 'intro';
            segmentEnd = end;
            console.log('[IntroDB] In intro segment:', currentTimeMs, 'ms');
        }
    }
    
    // Check recap
    if (!inSegment && introData.recap && introData.recap.confidence >= CONFIDENCE_THRESHOLD) {
        const start = introData.recap.start_ms;
        const end = introData.recap.end_ms;
        if (start && end && currentTimeMs >= start && currentTimeMs <= end) {
            inSegment = true;
            segmentType = 'recap';
            segmentEnd = end;
            console.log('[IntroDB] In recap segment:', currentTimeMs, 'ms');
        }
    }
    
    // Check credits
    if (!inSegment && introData.credits && introData.credits.confidence >= CONFIDENCE_THRESHOLD) {
        const start = introData.credits.start_ms;
        const end = introData.credits.end_ms || (video.duration * 1000);
        if (start && currentTimeMs >= start && currentTimeMs <= end) {
            inSegment = true;
            segmentType = 'credits';
            segmentEnd = end;
            console.log('[IntroDB] In credits segment:', currentTimeMs, 'ms');
        }
    }
    
    // Check preview
    if (!inSegment && introData.preview && introData.preview.confidence >= CONFIDENCE_THRESHOLD) {
        const start = introData.preview.start_ms;
        const end = introData.preview.end_ms;
        if (start && end && currentTimeMs >= start && currentTimeMs <= end) {
            inSegment = true;
            segmentType = 'preview';
            segmentEnd = end;
            console.log('[IntroDB] In preview segment:', currentTimeMs, 'ms');
        }
    }
    
    if (inSegment && segmentType) {
        // Show skip button
        const skipText = skipBtn.querySelector('.skip-text');
        if (skipText) {
            const labels = {
                intro: 'Skip Intro',
                recap: 'Skip Recap',
                credits: 'Skip Credits',
                preview: 'Skip Preview'
            };
            skipText.textContent = labels[segmentType] || 'Skip';
        }
        
        skipBtn.style.display = 'flex';
        currentSegmentType = segmentType;
        
        // Store segment end for skip action
        skipBtn.dataset.skipTo = (segmentEnd / 1000).toString();
    } else {
        // Hide skip button
        if (skipBtn.style.display === 'flex') {
            skipBtn.style.display = 'none';
            currentSegmentType = null;
        }
    }
}

// Skip to end of current segment
function skipSegment() {
    const video = document.getElementById('stream-video');
    const skipBtn = document.getElementById('skip-segment-btn');
    
    if (!video || !skipBtn) return;
    
    const skipTo = parseFloat(skipBtn.dataset.skipTo);
    if (skipTo && !isNaN(skipTo)) {
        video.currentTime = skipTo;
        skipBtn.style.display = 'none';
        console.log('[IntroDB] Skipped to:', skipTo);
    }
}

// Check if we should show next episode button (last 2 minutes of TV show)
function checkNextEpisodeButton() {
    const video = document.getElementById('stream-video');
    const nextEpBtn = document.getElementById('next-episode-btn');
    
    if (!video || !nextEpBtn || !nextEpisodeInfo) return;
    
    const timeRemaining = video.duration - video.currentTime;
    
    // Show button in last 2 minutes (120 seconds)
    if (timeRemaining <= 120 && timeRemaining > 0) {
        nextEpBtn.style.display = 'flex';
    } else {
        nextEpBtn.style.display = 'none';
    }
}

// Play next episode
async function playNextEpisode() {
    if (!nextEpisodeInfo) {
        console.log('[StreamingMode] No next episode info available');
        return;
    }
    
    const nextEpBtn = document.getElementById('next-episode-btn');
    if (nextEpBtn) {
        nextEpBtn.disabled = true;
        nextEpBtn.classList.add('loading');
    }
    
    console.log('[StreamingMode] Playing next episode:', nextEpisodeInfo);
    
    // Close current player
    const playerContainer = document.getElementById('stream-player-container');
    if (playerContainer) {
        playerContainer.classList.remove('active');
    }
    
    // Play next episode
    await playStream(
        nextEpisodeInfo.type,
        nextEpisodeInfo.tmdbId,
        nextEpisodeInfo.posterUrl,
        nextEpisodeInfo.title,
        nextEpisodeInfo.season,
        nextEpisodeInfo.episode
    );
    
    if (nextEpBtn) {
        nextEpBtn.disabled = false;
        nextEpBtn.classList.remove('loading');
    }
}

// Load subtitles into player
function loadSubtitlesIntoPlayer(subtitles) {
    const subsList = document.getElementById('stream-subs-list');
    if (!subsList) return;
    
    subsList.innerHTML = '';
    
    if (subtitles.length === 0) {
        subsList.innerHTML = '<div class="no-subs">No subtitles available</div>';
        return;
    }
    
    // Add "No Subtitles" option
    const noSubItem = document.createElement('div');
    noSubItem.className = 'sub-item';
    noSubItem.innerHTML = `
        <i class="material-icons sub-icon">subtitles_off</i>
        <div class="sub-info">
            <div class="sub-title">No Subtitles</div>
        </div>
    `;
    noSubItem.onclick = () => disableSubtitles();
    subsList.appendChild(noSubItem);
    
    // Add search box
    const searchBox = document.createElement('div');
    searchBox.className = 'sub-search-box';
    searchBox.innerHTML = `
        <input type="text" class="sub-search-input" placeholder="Search subtitles..." />
    `;
    subsList.appendChild(searchBox);
    
    // Group subtitles by language
    const grouped = {};
    subtitles.forEach(sub => {
        const lang = sub.language || 'unknown';
        if (!grouped[lang]) {
            grouped[lang] = [];
        }
        grouped[lang].push(sub);
    });
    
    // Sort languages: English first, then alphabetically
    const sortedLangs = Object.keys(grouped).sort((a, b) => {
        if (a === 'en') return -1;
        if (b === 'en') return 1;
        return a.localeCompare(b);
    });
    
    // Create subtitle items grouped by language
    sortedLangs.forEach(lang => {
        const subs = grouped[lang];
        
        // Language header
        const langHeader = document.createElement('div');
        langHeader.className = 'sub-lang-header';
        langHeader.textContent = subs[0].display || lang.toUpperCase();
        subsList.appendChild(langHeader);
        
        // Subtitle items
        subs.forEach((sub, index) => {
            const item = document.createElement('div');
            item.className = 'sub-item';
            item.dataset.language = sub.language;
            item.dataset.display = sub.display || '';
            item.dataset.release = sub.release || '';
            item.dataset.url = sub.url;
            item.dataset.provider = sub.provider || '';
            
            const hiLabel = sub.isHearingImpaired ? '<span class="sub-hi-badge">HI</span>' : '';
            const downloads = sub.downloadCount ? `<span class="sub-downloads">${formatDownloads(sub.downloadCount)} downloads</span>` : '';
            const providerBadge = sub.provider ? `<span class="sub-provider-badge">${sub.provider}</span>` : '';
            
            item.innerHTML = `
                <i class="material-icons sub-icon">subtitles</i>
                <div class="sub-info">
                    <div class="sub-title">${sub.display || sub.language} ${hiLabel} ${providerBadge}</div>
                    ${downloads}
                </div>
                <i class="material-icons sub-check-icon">check_circle</i>
            `;
            item.onclick = () => selectSubtitle(sub, item);
            subsList.appendChild(item);
        });
    });
    
    // Add search functionality
    const searchInput = subsList.querySelector('.sub-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            const items = subsList.querySelectorAll('.sub-item');
            const headers = subsList.querySelectorAll('.sub-lang-header');
            
            items.forEach(item => {
                const display = (item.dataset.display || '').toLowerCase();
                const release = (item.dataset.release || '').toLowerCase();
                const matches = display.includes(query) || release.includes(query);
                item.style.display = matches ? 'flex' : 'none';
            });
            
            // Hide headers if no items visible in that language
            headers.forEach(header => {
                const nextItems = [];
                let next = header.nextElementSibling;
                while (next && next.classList.contains('sub-item')) {
                    nextItems.push(next);
                    next = next.nextElementSibling;
                }
                const hasVisible = nextItems.some(item => item.style.display !== 'none');
                header.style.display = hasVisible ? 'block' : 'none';
            });
        });
    }
}

// Select subtitle and load it
async function selectSubtitle(sub, itemElement) {
    if (!sub) return;
    
    console.log('[Subtitles] Selecting:', sub.display, sub.url);
    
    // Remove active state from all items
    document.querySelectorAll('.sub-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // Add active state to selected item
    if (itemElement) {
        itemElement.classList.add('active');
    }
    
    try {
        // Fetch and parse subtitle
        const response = await fetch(sub.url);
        const srtText = await response.text();
        
        console.log('[Subtitles] Downloaded subtitle, parsing...');
        
        const cues = parseSRT(srtText);
        
        console.log('[Subtitles] Parsed', cues.length, 'cues');
        
        activeSub = { cues, info: sub };
        
        // Start updating subtitle display
        const video = document.getElementById('stream-video');
        if (video) {
            video.addEventListener('timeupdate', updateSubtitleDisplay);
        }
        
        console.log('[Subtitles] Subtitle loaded successfully');
    } catch (error) {
        console.error('[Subtitles] Error loading subtitle:', error);
        alert('Failed to load subtitle');
    }
    
    // Close menu
    const subsMenu = document.getElementById('stream-subs-menu');
    if (subsMenu) subsMenu.classList.remove('visible');
}

// Disable subtitles
function disableSubtitles() {
    console.log('[Subtitles] Disabling subtitles');
    
    activeSub = null;
    
    const overlay = document.getElementById('subtitle-overlay');
    if (overlay) {
        overlay.textContent = '';
        overlay.style.display = 'none';
    }
    
    // Remove active state from all subtitle items
    document.querySelectorAll('.sub-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // Close menu
    const subsMenu = document.getElementById('stream-subs-menu');
    if (subsMenu) subsMenu.classList.remove('visible');
}

// Format download count
function formatDownloads(count) {
    if (count >= 1000000) {
        return (count / 1000000).toFixed(1) + 'M';
    } else if (count >= 1000) {
        return (count / 1000).toFixed(1) + 'K';
    }
    return count.toString();
}

// Apply subtitle customization
function applySubtitleCustomization() {
    const overlay = document.getElementById('subtitle-overlay');
    if (!overlay) return;
    
    overlay.style.fontSize = `${subSize}%`;
    overlay.style.bottom = `${subPos}px`;
    
    console.log('[Subtitles] Applied customization - Size:', subSize + '%, Position:', subPos + 'px');
}

// Populate quality levels from HLS.js
function populateQualityLevels() {
    if (!streamHls || !streamHls.levels) return;
    
    const container = document.getElementById('quality-levels-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    // Sort levels by height (quality) descending
    const sortedLevels = streamHls.levels
        .map((level, index) => ({ level, index }))
        .sort((a, b) => b.level.height - a.level.height);
    
    sortedLevels.forEach(({ level, index }) => {
        const btn = document.createElement('button');
        btn.className = 'quality-btn';
        btn.dataset.quality = index;
        
        // Format quality label
        const height = level.height;
        const bitrate = Math.round(level.bitrate / 1000);
        btn.textContent = `${height}p (${bitrate} kbps)`;
        
        btn.addEventListener('click', () => {
            setQuality(index);
        });
        
        container.appendChild(btn);
    });
    
    // Show quality button only for VixSrc
    const qualityBtn = document.getElementById('stream-quality-btn');
    if (qualityBtn && currentProvider === 'vixsrc') {
        qualityBtn.style.display = 'flex';
    }
    
    console.log('[Player] Populated', sortedLevels.length, 'quality levels');
}

// Set quality level
function setQuality(levelIndex) {
    if (!streamHls) return;
    
    const qualityBtns = document.querySelectorAll('.quality-btn');
    qualityBtns.forEach(btn => btn.classList.remove('active'));
    
    if (levelIndex === -1) {
        // Auto quality
        streamHls.currentLevel = -1;
        document.querySelector('.quality-btn[data-quality="-1"]')?.classList.add('active');
        console.log('[Player] Set quality to Auto');
    } else {
        // Manual quality
        streamHls.currentLevel = levelIndex;
        document.querySelector(`.quality-btn[data-quality="${levelIndex}"]`)?.classList.add('active');
        const level = streamHls.levels[levelIndex];
        console.log('[Player] Set quality to', level.height + 'p');
    }
    
    // Close quality menu
    const qualityMenu = document.getElementById('stream-quality-menu');
    if (qualityMenu) qualityMenu.classList.remove('visible');
}

// Show/hide quality button based on provider
function updateQualityButtonVisibility() {
    const qualityBtn = document.getElementById('stream-quality-btn');
    if (qualityBtn) {
        if (currentProvider === 'vixsrc' && streamHls && streamHls.levels && streamHls.levels.length > 0) {
            qualityBtn.style.display = 'flex';
        } else {
            qualityBtn.style.display = 'none';
        }
    }
}

// Change provider
async function changeProvider(provider) {
    if (provider === currentProvider) return;
    
    const oldProvider = currentProvider;
    const oldStreamUrl = currentStreamUrl;
    
    // Save current playback time
    const video = document.getElementById('stream-video');
    const oldPlaybackTime = video ? video.currentTime : 0;
    
    // Save to localStorage for persistence
    if (video && window.currentMediaInfo) {
        savePlaybackPosition(video.currentTime);
    }
    
    currentProvider = provider;
    console.log('[StreamingMode] Changed provider from', oldProvider, 'to:', provider);
    
    // Update quality button visibility
    updateQualityButtonVisibility();
    
    // If player is active, reload stream with new provider
    const playerContainer = document.getElementById('stream-player-container');
    if (playerContainer && playerContainer.classList.contains('active')) {
        // Store previous stream for cancel fallback
        previousStreamUrl = oldStreamUrl;
        previousProvider = oldProvider;
        previousPlaybackTime = oldPlaybackTime;
        
        console.log('[StreamingMode] Saved previous stream state:', {
            provider: previousProvider,
            time: previousPlaybackTime
        });
        
        // Store current media info
        if (!window.currentMediaInfo) {
            console.error('[StreamingMode] No media info stored, cannot reload');
            return;
        }
        
        const { type, tmdbId, posterUrl, title, season, episode } = window.currentMediaInfo;
        
        console.log('[StreamingMode] Reloading stream with new provider...');
        
        // Pause video first
        if (video) {
            video.pause();
        }
        
        // Hide player, show loading
        playerContainer.classList.remove('active');
        showLoadingScreen(posterUrl, title);
        updateLoadingStatus(`Extracting from ${PROVIDERS[provider].name}...`);
        
        try {
            // Get provider URL
            const providerUrl = getProviderUrl(provider, type, tmdbId, season, episode);
            if (!providerUrl) {
                throw new Error('Invalid provider or parameters');
            }
            
            // Extract stream
            const streamUrl = await extractStream(providerUrl, provider);
            currentStreamUrl = streamUrl;
            
            // Hide loading, show player
            hideLoadingScreen();
            playerContainer.classList.add('active');
            
            // Load stream into player
            loadStreamIntoPlayer(streamUrl, title);
            
            // Re-initialize controls
            initPlayerControls();
            
            console.log('[StreamingMode] Stream reloaded successfully');
        } catch (error) {
            console.error('[StreamingMode] Error reloading stream:', error);
            hideLoadingScreen();
            alert(`Failed to load stream from ${PROVIDERS[provider].name}: ${error.message}`);
            // Revert provider
            currentProvider = oldProvider;
        }
    }
}

// Initialize player controls (called when player is shown)
function initPlayerControls() {
    console.log('[StreamingMode] Initializing player controls...');
    
    const video = document.getElementById('stream-video');
    
    // Back button
    const playerBackBtn = document.getElementById('stream-player-back');
    if (playerBackBtn) {
        const newBackBtn = playerBackBtn.cloneNode(true);
        playerBackBtn.parentNode.replaceChild(newBackBtn, playerBackBtn);
        
        newBackBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('[StreamingMode] Back button clicked');
            hideStreamPlayer();
        });
    }
    
    // Play/pause button
    const playPauseBtn = document.getElementById('stream-play-pause');
    
    if (playPauseBtn && video) {
        const newPlayPauseBtn = playPauseBtn.cloneNode(true);
        playPauseBtn.parentNode.replaceChild(newPlayPauseBtn, playPauseBtn);
        
        newPlayPauseBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (video.paused) {
                video.play();
            } else {
                video.pause();
            }
        });
        
        video.addEventListener('play', () => {
            newPlayPauseBtn.innerHTML = '<i class="material-icons">pause</i>';
        });
        
        video.addEventListener('pause', () => {
            newPlayPauseBtn.innerHTML = '<i class="material-icons">play_arrow</i>';
        });
    }
    
    // Fullscreen button
    const fullscreenBtn = document.getElementById('stream-fullscreen');
    if (fullscreenBtn) {
        const newFullscreenBtn = fullscreenBtn.cloneNode(true);
        fullscreenBtn.parentNode.replaceChild(newFullscreenBtn, fullscreenBtn);
        
        newFullscreenBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const playerContainer = document.getElementById('stream-player-container');
            if (!document.fullscreenElement) {
                playerContainer.requestFullscreen().catch(err => {
                    console.error('[StreamingMode] Fullscreen error:', err);
                });
            } else {
                document.exitFullscreen();
            }
        });
    }
    
    // Volume button and slider
    const volumeBtn = document.getElementById('stream-volume');
    const volumeSlider = document.getElementById('stream-volume-slider');
    if (volumeBtn && volumeSlider && video) {
        const newVolumeBtn = volumeBtn.cloneNode(true);
        volumeBtn.parentNode.replaceChild(newVolumeBtn, volumeBtn);
        
        const newVolumeSlider = volumeSlider.cloneNode(true);
        volumeSlider.parentNode.replaceChild(newVolumeSlider, volumeSlider);
        
        // Load saved volume
        const savedVolume = localStorage.getItem('playerVolume') || '100';
        video.volume = parseInt(savedVolume) / 100;
        newVolumeSlider.value = savedVolume;
        
        // Update icon based on volume
        const updateVolumeIcon = (volume) => {
            const icon = newVolumeBtn.querySelector('.material-icons');
            if (volume === 0) {
                icon.textContent = 'volume_off';
            } else if (volume < 50) {
                icon.textContent = 'volume_down';
            } else {
                icon.textContent = 'volume_up';
            }
        };
        
        updateVolumeIcon(parseInt(savedVolume));
        
        // Volume slider
        newVolumeSlider.addEventListener('input', (e) => {
            const volume = parseInt(e.target.value);
            video.volume = volume / 100;
            updateVolumeIcon(volume);
            localStorage.setItem('playerVolume', volume.toString());
        });
        
        // Volume button (mute/unmute)
        let lastVolume = parseInt(savedVolume);
        newVolumeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (video.volume > 0) {
                lastVolume = Math.round(video.volume * 100);
                video.volume = 0;
                newVolumeSlider.value = '0';
                updateVolumeIcon(0);
            } else {
                video.volume = lastVolume / 100;
                newVolumeSlider.value = lastVolume.toString();
                updateVolumeIcon(lastVolume);
            }
        });
    }
    
    // Settings button
    const settingsBtn = document.getElementById('stream-settings');
    const settingsMenu = document.getElementById('stream-settings-menu');
    if (settingsBtn && settingsMenu) {
        const newSettingsBtn = settingsBtn.cloneNode(true);
        settingsBtn.parentNode.replaceChild(newSettingsBtn, settingsBtn);
        
        newSettingsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            settingsMenu.classList.toggle('visible');
            const subsMenu = document.getElementById('stream-subs-menu');
            if (subsMenu) subsMenu.classList.remove('visible');
            const qualityMenu = document.getElementById('stream-quality-menu');
            if (qualityMenu) qualityMenu.classList.remove('visible');
        });
    }
    
    // Quality button (VixSrc only)
    const qualityBtn = document.getElementById('stream-quality-btn');
    const qualityMenu = document.getElementById('stream-quality-menu');
    if (qualityBtn && qualityMenu) {
        const newQualityBtn = qualityBtn.cloneNode(true);
        qualityBtn.parentNode.replaceChild(newQualityBtn, qualityBtn);
        
        newQualityBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            qualityMenu.classList.toggle('visible');
            const subsMenu = document.getElementById('stream-subs-menu');
            if (subsMenu) subsMenu.classList.remove('visible');
            if (settingsMenu) settingsMenu.classList.remove('visible');
        });
    }
    
    // Subtitles button
    const subsBtn = document.getElementById('stream-subs');
    const subsMenu = document.getElementById('stream-subs-menu');
    if (subsBtn && subsMenu) {
        const newSubsBtn = subsBtn.cloneNode(true);
        subsBtn.parentNode.replaceChild(newSubsBtn, subsBtn);
        
        newSubsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            subsMenu.classList.toggle('visible');
            if (settingsMenu) settingsMenu.classList.remove('visible');
            if (qualityMenu) qualityMenu.classList.remove('visible');
        });
    }
    
    // Provider buttons inside settings menu
    document.querySelectorAll('.provider-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const provider = btn.dataset.provider;
            changeProvider(provider);
            
            // Update active state
            document.querySelectorAll('.provider-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Close menu
            if (settingsMenu) settingsMenu.classList.remove('visible');
        });
    });
    
    // Quality buttons - Auto button
    const autoQualityBtn = document.querySelector('.quality-btn[data-quality="-1"]');
    if (autoQualityBtn) {
        autoQualityBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            setQuality(-1);
        });
    }
    
    console.log('[StreamingMode] Player controls initialized');
}

// Video time display update
function updateTimeDisplay() {
    const video = document.getElementById('stream-video');
    const timeDisplay = document.getElementById('stream-time-display');
    
    if (!video || !timeDisplay) return;
    
    const formatTime = (seconds) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        
        if (h > 0) {
            return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
        return `${m}:${s.toString().padStart(2, '0')}`;
    };
    
    const current = formatTime(video.currentTime);
    const duration = formatTime(video.duration || 0);
    
    timeDisplay.textContent = `${current} / ${duration}`;
}

// Progress bar update
function updateProgressBar() {
    const video = document.getElementById('stream-video');
    const progressBar = document.getElementById('stream-progress-bar');
    
    if (!video || !progressBar) return;
    
    const percent = (video.currentTime / video.duration) * 100;
    progressBar.style.width = `${percent}%`;
}

// Initialize subtitle customization controls
function initSubtitleCustomization() {
    const sizeSlider = document.getElementById('subtitle-size-slider');
    const sizeValue = document.getElementById('subtitle-size-value');
    const positionSlider = document.getElementById('subtitle-position-slider');
    const positionValue = document.getElementById('subtitle-position-value');
    const delaySlider = document.getElementById('subtitle-delay-slider');
    const delayValue = document.getElementById('subtitle-delay-value');
    
    if (!sizeSlider || !positionSlider || !delaySlider) return;
    
    // Load saved settings
    const settings = JSON.parse(localStorage.getItem('subtitleSettings') || '{}');
    subSize = settings.fontSize || 150;
    subPos = settings.position || 130;
    subDelay = settings.delay || 0;
    
    sizeSlider.value = subSize;
    sizeValue.textContent = subSize + '%';
    positionSlider.value = subPos;
    positionValue.textContent = subPos + 'px';
    delaySlider.value = subDelay;
    delayValue.textContent = subDelay + 's';
    
    // Apply initial customization
    applySubtitleCustomization();
    
    // Font size slider
    sizeSlider.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        sizeValue.textContent = value + '%';
        subSize = value;
        
        const settings = JSON.parse(localStorage.getItem('subtitleSettings') || '{}');
        settings.fontSize = value;
        localStorage.setItem('subtitleSettings', JSON.stringify(settings));
        
        applySubtitleCustomization();
    });
    
    // Position slider
    positionSlider.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        positionValue.textContent = value + 'px';
        subPos = value;
        
        const settings = JSON.parse(localStorage.getItem('subtitleSettings') || '{}');
        settings.position = value;
        localStorage.setItem('subtitleSettings', JSON.stringify(settings));
        
        applySubtitleCustomization();
    });
    
    // Delay slider
    delaySlider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        delayValue.textContent = value + 's';
        subDelay = value;
        
        const settings = JSON.parse(localStorage.getItem('subtitleSettings') || '{}');
        settings.delay = value;
        localStorage.setItem('subtitleSettings', JSON.stringify(settings));
    });
    
    console.log('[Subtitles] Customization controls initialized');
}

// Initialize streaming mode UI
function initStreamingModeUI() {
    console.log('[StreamingMode] Initializing UI...');
    
    // Auto-hide controls and cursor when idle
    let idleTimeout;
    const playerContainer = document.getElementById('stream-player-container');
    const controls = document.querySelector('.stream-controls');
    const playerTitle = document.getElementById('stream-player-title');
    const backBtn = document.getElementById('stream-player-back');
    
    function showControls() {
        if (playerContainer) playerContainer.classList.remove('idle');
        if (controls) controls.style.opacity = '1';
        if (playerTitle) playerTitle.style.opacity = '1';
        if (backBtn) backBtn.style.opacity = '1';
    }
    
    function hideControls() {
        if (playerContainer) playerContainer.classList.add('idle');
        if (controls) controls.style.opacity = '0';
        if (playerTitle) playerTitle.style.opacity = '0';
        if (backBtn) backBtn.style.opacity = '0';
    }
    
    function resetIdleTimer() {
        showControls();
        clearTimeout(idleTimeout);
        idleTimeout = setTimeout(() => {
            const video = document.getElementById('stream-video');
            // Only hide if video is playing
            if (video && !video.paused) {
                hideControls();
            }
        }, 3000); // Hide after 3 seconds of inactivity
    }
    
    // Add event listeners for user activity
    if (playerContainer) {
        playerContainer.addEventListener('mousemove', resetIdleTimer);
        playerContainer.addEventListener('mousedown', resetIdleTimer);
        playerContainer.addEventListener('keydown', resetIdleTimer);
        playerContainer.addEventListener('touchstart', resetIdleTimer);
    }
    
    // Show controls when video is paused
    const video = document.getElementById('stream-video');
    if (video) {
        video.addEventListener('play', () => {
            resetIdleTimer();
        });
        
        video.addEventListener('pause', () => {
            clearTimeout(idleTimeout);
            showControls();
        });
    }
    
    // Back button in loading screen - direct handler
    const cancelBtn = document.querySelector('.loading-back-btn');
    if (cancelBtn) {
        // Remove any existing listeners by cloning
        const newCancelBtn = cancelBtn.cloneNode(true);
        cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
        
        newCancelBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('[StreamingMode] Cancel button clicked - checking for previous stream');
            
            // Cancel extraction
            hideLoadingScreen();
            isLoadingStream = false;
            if (window.electronAPI && window.electronAPI.closeStreamExtraction) {
                window.electronAPI.closeStreamExtraction();
            }
            
            // If we have a previous stream (from provider switch), restore it
            if (previousStreamUrl && previousProvider) {
                console.log('[StreamingMode] Restoring previous stream from', previousProvider, 'at time', previousPlaybackTime);
                
                // Restore previous provider
                currentProvider = previousProvider;
                currentStreamUrl = previousStreamUrl;
                
                // Update provider button states
                document.querySelectorAll('.provider-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.provider === previousProvider);
                });
                
                // Show player and reload previous stream
                const playerContainer = document.getElementById('stream-player-container');
                if (playerContainer) {
                    playerContainer.classList.add('active');
                    
                    const title = window.currentMediaInfo?.title || 'Video';
                    loadStreamIntoPlayer(previousStreamUrl, title);
                    
                    // Restore playback position after video loads
                    const video = document.getElementById('stream-video');
                    if (video && previousPlaybackTime > 0) {
                        const restoreTime = () => {
                            video.currentTime = previousPlaybackTime;
                            video.play().catch(e => console.log('[StreamingMode] Autoplay prevented:', e));
                            video.removeEventListener('loadedmetadata', restoreTime);
                        };
                        video.addEventListener('loadedmetadata', restoreTime);
                    }
                    
                    initPlayerControls();
                }
                
                // Clear previous stream data
                previousStreamUrl = null;
                previousProvider = null;
                previousPlaybackTime = 0;
            }
            // Otherwise just stay on details page (don't navigate)
        });
    }
    
    // Also use event delegation as fallback
    document.addEventListener('click', (e) => {
        if (e.target.closest('.loading-back-btn')) {
            e.preventDefault();
            e.stopPropagation();
            console.log('[StreamingMode] Cancel button clicked (delegation) - checking for previous stream');
            
            // Cancel extraction
            hideLoadingScreen();
            isLoadingStream = false;
            if (window.electronAPI && window.electronAPI.closeStreamExtraction) {
                window.electronAPI.closeStreamExtraction();
            }
            
            // If we have a previous stream (from provider switch), restore it
            if (previousStreamUrl && previousProvider) {
                console.log('[StreamingMode] Restoring previous stream from', previousProvider, 'at time', previousPlaybackTime);
                
                // Restore previous provider
                currentProvider = previousProvider;
                currentStreamUrl = previousStreamUrl;
                
                // Update provider button states
                document.querySelectorAll('.provider-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.provider === previousProvider);
                });
                
                // Show player and reload previous stream
                const playerContainer = document.getElementById('stream-player-container');
                if (playerContainer) {
                    playerContainer.classList.add('active');
                    
                    const title = window.currentMediaInfo?.title || 'Video';
                    loadStreamIntoPlayer(previousStreamUrl, title);
                    
                    // Restore playback position after video loads
                    const video = document.getElementById('stream-video');
                    if (video && previousPlaybackTime > 0) {
                        const restoreTime = () => {
                            video.currentTime = previousPlaybackTime;
                            video.play().catch(e => console.log('[StreamingMode] Autoplay prevented:', e));
                            video.removeEventListener('loadedmetadata', restoreTime);
                        };
                        video.addEventListener('loadedmetadata', restoreTime);
                    }
                    
                    initPlayerControls();
                }
                
                // Clear previous stream data
                previousStreamUrl = null;
                previousProvider = null;
                previousPlaybackTime = 0;
            }
            // Otherwise just stay on details page (don't navigate)
        }
    });
    
    // Close menus when clicking outside
    document.addEventListener('click', (e) => {
        const settingsBtn = document.getElementById('stream-settings');
        const settingsMenu = document.getElementById('stream-settings-menu');
        const subsBtn = document.getElementById('stream-subs');
        const subsMenu = document.getElementById('stream-subs-menu');
        const qualityBtn = document.getElementById('stream-quality-btn');
        const qualityMenu = document.getElementById('stream-quality-menu');
        
        if (settingsMenu && settingsBtn && !settingsBtn.contains(e.target) && !settingsMenu.contains(e.target)) {
            settingsMenu.classList.remove('visible');
        }
        
        if (subsMenu && subsBtn && !subsBtn.contains(e.target) && !subsMenu.contains(e.target)) {
            subsMenu.classList.remove('visible');
        }
        
        if (qualityMenu && qualityBtn && !qualityBtn.contains(e.target) && !qualityMenu.contains(e.target)) {
            qualityMenu.classList.remove('visible');
        }
    });
    
    console.log('[StreamingMode] UI initialized');
}

// Add video event listeners for time and progress
document.addEventListener('DOMContentLoaded', () => {
    const video = document.getElementById('stream-video');
    
    if (video) {
        video.addEventListener('timeupdate', () => {
            updateTimeDisplay();
            updateProgressBar();
            checkSkippableSegment(); // Check for intro/recap/credits
            checkNextEpisodeButton(); // Check for next episode button (TV shows)
        });
        
        video.addEventListener('loadedmetadata', () => {
            updateTimeDisplay();
        });
        
        // Progress bar click to seek
        const progressWrapper = document.querySelector('.stream-progress-wrapper');
        if (progressWrapper) {
            progressWrapper.style.cursor = 'pointer';
            
            progressWrapper.addEventListener('click', (e) => {
                const progressContainer = progressWrapper.querySelector('.stream-progress-container');
                if (!progressContainer) return;
                
                const rect = progressContainer.getBoundingClientRect();
                const percent = (e.clientX - rect.left) / rect.width;
                
                if (percent >= 0 && percent <= 1 && video.duration) {
                    video.currentTime = percent * video.duration;
                    console.log('[Player] Seeked to', Math.floor(percent * 100) + '%');
                }
            });
        }
    }
    
    // Skip button click handler
    const skipBtn = document.getElementById('skip-segment-btn');
    if (skipBtn) {
        skipBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            skipSegment();
        });
    }
    
    // Next episode button click handler
    const nextEpBtn = document.getElementById('next-episode-btn');
    if (nextEpBtn) {
        nextEpBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            playNextEpisode();
        });
    }
    
    // Initialize subtitle customization
    setTimeout(() => {
        initSubtitleCustomization();
    }, 1000);
});

// Export functions
window.streamingMode = {
    enabled: () => streamingModeEnabled,
    isReady: () => streamingModeLoaded,
    waitForReady: () => streamingModeReady, // Returns promise
    setEnabled: saveStreamingModeSetting,
    playStream,
    changeProvider,
    init: initStreamingModeUI,
    reload: loadStreamingModeSetting // Add reload function for settings page
};

// Initialize UI immediately
initStreamingModeUI();

console.log('[StreamingMode] Module loaded with HLS.js support');
