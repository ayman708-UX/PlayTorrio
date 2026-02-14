import { searchMulti, getMovieDetails, getTVShowDetails, getExternalIds } from './api.js';

const PLEX_STORAGE_KEY = 'pt_plex_config';
const PLEX_CLIENT_ID = 'playtorrio-' + Math.random().toString(36).substring(7);

let plexConfig = null;
let currentLibraryId = null;
let currentShowId = null;
let currentLibraryItems = [];
let currentShowSeasons = [];
let authCheckInterval = null;

// Storage helpers
function savePlexConfig(config) {
    try {
        localStorage.setItem(PLEX_STORAGE_KEY, JSON.stringify(config));
        plexConfig = config;
    } catch (e) {
        console.error('Failed to save Plex config:', e);
    }
}

function loadPlexConfig() {
    try {
        const stored = localStorage.getItem(PLEX_STORAGE_KEY);
        if (stored) {
            plexConfig = JSON.parse(stored);
            return plexConfig;
        }
    } catch (e) {
        console.error('Failed to load Plex config:', e);
    }
    return null;
}

function clearPlexConfig() {
    localStorage.removeItem(PLEX_STORAGE_KEY);
    plexConfig = null;
}

// Show notification
function showPlexNotification(message, type = 'info') {
    if (window.showNotification) {
        window.showNotification(message, type);
    } else {
        console.log(`[${type}] ${message}`);
    }
}

// Plex OAuth flow
async function startPlexAuth() {
    try {
        // Get PIN from Plex
        const pinResponse = await fetch('https://plex.tv/api/v2/pins?strong=true', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'X-Plex-Product': 'PlayTorrio',
                'X-Plex-Client-Identifier': PLEX_CLIENT_ID
            }
        });
        
        if (!pinResponse.ok) throw new Error('Failed to get PIN');
        
        const pinData = await pinResponse.json();
        const pin = pinData.code;
        const pinId = pinData.id;
        
        console.log('[Plex] Got PIN:', pin, 'ID:', pinId);
        
        // Open Plex auth URL in browser
        const authUrl = `https://app.plex.tv/auth#?clientID=${PLEX_CLIENT_ID}&code=${pin}&context[device][product]=PlayTorrio`;
        
        if (window.electronAPI && window.electronAPI.openExternal) {
            window.electronAPI.openExternal(authUrl);
        } else {
            window.open(authUrl, '_blank');
        }
        
        return { pin, pinId };
    } catch (error) {
        console.error('[Plex] Auth start error:', error);
        throw error;
    }
}

async function checkPlexAuth(pinId) {
    try {
        const response = await fetch(`https://plex.tv/api/v2/pins/${pinId}`, {
            headers: {
                'Accept': 'application/json',
                'X-Plex-Client-Identifier': PLEX_CLIENT_ID
            }
        });
        
        if (!response.ok) throw new Error('Failed to check PIN');
        
        const data = await response.json();
        
        if (data.authToken) {
            console.log('[Plex] Got auth token');
            return data.authToken;
        }
        
        return null;
    } catch (error) {
        console.error('[Plex] Auth check error:', error);
        return null;
    }
}

async function getPlexServers(authToken) {
    try {
        const response = await fetch('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1', {
            headers: {
                'Accept': 'application/json',
                'X-Plex-Token': authToken,
                'X-Plex-Client-Identifier': PLEX_CLIENT_ID
            }
        });
        
        if (!response.ok) throw new Error('Failed to get servers');
        
        const servers = await response.json();
        const plexServers = servers.filter(s => s.provides === 'server');
        
        // Check connections for each server in parallel
        await Promise.all(plexServers.map(async (server) => {
            if (server.connections && server.connections.length > 0) {
                // Sort connections: Local > Remote > Relay
                // This prioritizes direct local connections, then direct remote, then relay
                const sortedConnections = server.connections.sort((a, b) => {
                    // Prefer non-relay over relay
                    if (a.relay !== b.relay) return a.relay ? 1 : -1;
                    
                    // Prefer local over remote
                    if (a.local !== b.local) return a.local ? -1 : 1;
                    
                    return 0;
                });
                
                console.log(`[Plex] Checking connections for ${server.name}...`);
                let activeConnection = null;
                
                // Try each connection to find the first reachable one
                for (const connection of sortedConnections) {
                    try {
                        console.log(`[Plex] Testing: ${connection.uri} (Local: ${connection.local}, Relay: ${connection.relay})`);
                        
                        // Test endpoint via proxy to check reachability
                        // We use /identity endpoint which is lightweight
                        const testUrl = `${connection.uri}/identity`;
                        const proxyUrl = `/api/plex/proxy?url=${encodeURIComponent(testUrl)}&token=${encodeURIComponent(server.accessToken)}`;
                        
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout
                        
                        const res = await fetch(proxyUrl, {
                            signal: controller.signal,
                            headers: { 'X-Plex-Client-Identifier': PLEX_CLIENT_ID }
                        });
                        
                        clearTimeout(timeoutId);
                        
                        if (res.ok) {
                            console.log(`[Plex] Connection confirmed: ${connection.uri}`);
                            activeConnection = connection;
                            break; // Stop at first working connection
                        }
                    } catch (e) {
                        console.warn(`[Plex] Connection failed: ${connection.uri}`);
                    }
                }
                
                // Fallback to first sorted connection if verification fails (unlikely to work, but better than nothing)
                server.bestConnection = activeConnection || sortedConnections[0];
                
                if (server.bestConnection) {
                     console.log('[Plex] Selected connection:', server.bestConnection.uri, 
                        'Local:', server.bestConnection.local, 
                        'Relay:', server.bestConnection.relay);
                } else {
                    console.warn('[Plex] No valid connections found for', server.name);
                }
            }
        }));
        
        return plexServers;
    } catch (error) {
        console.error('[Plex] Get servers error:', error);
        throw error;
    }
}

// Plex API helpers
async function plexRequest(endpoint, server = null) {
    if (!plexConfig) throw new Error('Not authenticated');
    
    const baseUrl = server || plexConfig.serverUrl;
    const url = `${baseUrl}${endpoint}`;
    
    // Use proxy to avoid CORS issues
    const proxyUrl = `/api/plex/proxy?url=${encodeURIComponent(url)}&token=${encodeURIComponent(plexConfig.authToken)}`;
    
    const response = await fetch(proxyUrl, {
        headers: {
            'X-Plex-Client-Identifier': PLEX_CLIENT_ID
        }
    });
    
    if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
    }
    
    return response.json();
}

// Get libraries
async function getPlexLibraries() {
    const data = await plexRequest('/library/sections');
    return data.MediaContainer?.Directory || [];
}

// Get items from a library
async function getPlexItems(libraryId) {
    const data = await plexRequest(`/library/sections/${libraryId}/all`);
    return data.MediaContainer?.Metadata || [];
}

// Get seasons for a show
async function getPlexSeasons(showKey) {
    const data = await plexRequest(showKey);
    return data.MediaContainer?.Metadata || [];
}

// Get episodes for a season
async function getPlexEpisodes(seasonKey) {
    const data = await plexRequest(seasonKey);
    return data.MediaContainer?.Metadata || [];
}

// Get image URL
function getPlexImageUrl(thumb) {
    if (!plexConfig || !thumb) return 'https://via.placeholder.com/300x450/1a1a2e/ffffff?text=No+Image';
    
    // Plex uses relative paths, need to prepend server URL
    return `${plexConfig.serverUrl}${thumb}?X-Plex-Token=${plexConfig.authToken}`;
}

// Get stream URL
function getPlexStreamUrl(key) {
    if (!plexConfig || !key) return null;
    
    // Get the media part key
    return `${plexConfig.serverUrl}${key}?X-Plex-Token=${plexConfig.authToken}`;
}

// Get subtitles from Plex
async function getPlexSubtitles(key) {
    if (!plexConfig || !key) return [];
    
    try {
        const item = await plexRequest(key);
        const metadata = item.MediaContainer?.Metadata?.[0];
        const subtitles = [];
        
        if (metadata?.Media) {
            metadata.Media.forEach(media => {
                if (media.Part) {
                    media.Part.forEach(part => {
                        if (part.Stream) {
                            part.Stream.forEach(stream => {
                                if (stream.streamType === 3) { // 3 = subtitle
                                    const language = stream.languageCode || stream.language || 'Unknown';
                                    const title = stream.displayTitle || stream.title || language;
                                    
                                    if (stream.key) {
                                        const subUrl = `${plexConfig.serverUrl}${stream.key}?X-Plex-Token=${plexConfig.authToken}`;
                                        
                                        subtitles.push({
                                            provider: 'Built-in',
                                            name: title,
                                            url: subUrl,
                                            language: language,
                                            isForced: stream.forced || false,
                                            isDefault: stream.selected || false
                                        });
                                    }
                                }
                            });
                        }
                    });
                }
            });
        }
        
        console.log(`[Plex] Found ${subtitles.length} built-in subtitles`);
        return subtitles;
    } catch (error) {
        console.error('[Plex] Failed to fetch subtitles:', error);
        return [];
    }
}

// Fetch subtitles for PlayTorrioPlayer
async function fetchSubtitlesForPlayer(tmdbId, imdbId, seasonNum, episodeNum, mediaType) {
    const subtitles = [];
    const TIMEOUT = 5000;
    
    const timeoutPromise = new Promise(resolve => {
        setTimeout(() => {
            console.log('[Plex Subtitles] Timeout reached');
            resolve('timeout');
        }, TIMEOUT);
    });
    
    const fetchPromise = (async () => {
        if (tmdbId) {
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
                console.warn('[Plex Subtitles] Wyzie fetch error:', e);
            }
        }
        return 'done';
    })();
    
    await Promise.race([fetchPromise, timeoutPromise]);
    
    console.log(`[Plex Subtitles] Returning ${subtitles.length} subtitles`);
    return subtitles;
}

// Match Plex item with TMDB
async function matchWithTMDB(item) {
    // For episodes, use the series name without year
    let searchName = item.type === 'episode' && item.grandparentTitle ? item.grandparentTitle : item.title;
    const searchYear = item.type === 'episode' && item.grandparentYear ? item.grandparentYear : item.year;
    
    // Remove year from name if it's in the format "Name (Year)"
    searchName = searchName.replace(/\s*\(\d{4}\)\s*$/, '').trim();
    
    console.log('[Plex TMDB] Matching item:', searchName, searchYear);
    
    try {
        // Search by name only, without year
        const searchResults = await searchMulti(searchName);
        const results = searchResults.results || [];
        
        console.log('[Plex TMDB] Found', results.length, 'results');
        
        const isMovie = item.type === 'movie';
        const validResults = results.filter(r => 
            isMovie ? r.media_type === 'movie' : r.media_type === 'tv'
        );
        
        let match = null;
        const searchNameLower = searchName.toLowerCase();
        
        // First priority: Match by exact name AND year
        if (searchYear) {
            match = validResults.find(r => {
                const resultYear = (r.release_date || r.first_air_date || '').split('-')[0];
                const resultName = (r.title || r.name || '').toLowerCase();
                
                // Exact name match and year match
                return resultName === searchNameLower && resultYear === String(searchYear);
            });
            
            if (match) {
                console.log('[Plex TMDB] Exact match (name + year):', match.title || match.name);
            }
        }
        
        // Second priority: Match by exact name only (if no year match found)
        if (!match) {
            match = validResults.find(r => {
                const resultName = (r.title || r.name || '').toLowerCase();
                return resultName === searchNameLower;
            });
            
            if (match) {
                console.log('[Plex TMDB] Exact name match:', match.title || match.name);
            }
        }
        
        // Third priority: Fuzzy match by name similarity
        if (!match && validResults.length > 0) {
            // Find the closest match by checking if search name is contained in result or vice versa
            match = validResults.find(r => {
                const resultName = (r.title || r.name || '').toLowerCase();
                return resultName.includes(searchNameLower) || searchNameLower.includes(resultName);
            });
            
            if (match) {
                console.log('[Plex TMDB] Fuzzy match:', match.title || match.name);
            }
        }
        
        // Last resort: Use first result
        if (!match && validResults.length > 0) {
            match = validResults[0];
            console.log('[Plex TMDB] No exact match, using first result:', match.title || match.name);
        }
        
        if (match) {
            console.log('[Plex TMDB] Matched:', match.title || match.name, 'TMDB ID:', match.id);
            
            const mediaType = isMovie ? 'movie' : 'tv';
            const externalIds = await getExternalIds(match.id, mediaType);
            const imdbId = externalIds.imdb_id;
            
            console.log('[Plex TMDB] IMDB ID:', imdbId);
            
            return {
                tmdbId: match.id,
                imdbId: imdbId,
                mediaType: mediaType
            };
        } else {
            console.warn('[Plex TMDB] No match found');
            return null;
        }
    } catch (error) {
        console.error('[Plex TMDB] Search error:', error);
        return null;
    }
}

// UI Functions
function showPlexView(view) {
    const serverSelection = document.getElementById('server-selection');
    const plexAccount = document.getElementById('plex-account');
    const plexLogin = document.getElementById('plex-login');
    const plexBrowser = document.getElementById('plex-browser');
    const plexLibraries = document.getElementById('plex-libraries');
    const plexItemsContainer = document.getElementById('plex-items-container');
    const plexSeasonsContainer = document.getElementById('plex-seasons-container');
    
    // Hide all
    if (serverSelection) serverSelection.classList.add('hidden');
    if (plexAccount) plexAccount.classList.add('hidden');
    if (plexLogin) plexLogin.classList.add('hidden');
    if (plexBrowser) plexBrowser.classList.add('hidden');
    if (plexLibraries) plexLibraries.classList.add('hidden');
    if (plexItemsContainer) plexItemsContainer.classList.add('hidden');
    if (plexSeasonsContainer) plexSeasonsContainer.classList.add('hidden');
    
    // Show requested view
    switch(view) {
        case 'selection':
            if (serverSelection) serverSelection.classList.remove('hidden');
            break;
        case 'account':
            if (plexAccount) plexAccount.classList.remove('hidden');
            break;
        case 'login':
            if (plexLogin) plexLogin.classList.remove('hidden');
            break;
        case 'browser':
            if (plexBrowser) plexBrowser.classList.remove('hidden');
            if (plexLibraries) plexLibraries.classList.remove('hidden');
            break;
        case 'items':
            if (plexBrowser) plexBrowser.classList.remove('hidden');
            if (plexItemsContainer) plexItemsContainer.classList.remove('hidden');
            break;
        case 'seasons':
            if (plexBrowser) plexBrowser.classList.remove('hidden');
            if (plexSeasonsContainer) plexSeasonsContainer.classList.remove('hidden');
            break;
    }
}

function showPlexAccountView() {
    const config = loadPlexConfig();
    
    if (config) {
        // Show account view with existing account
        showPlexView('account');
        const accountInfo = document.getElementById('plex-account-info');
        if (accountInfo) {
            accountInfo.innerHTML = `
                <div class="flex items-center justify-between p-4 bg-gray-800/50 border border-gray-700/50 rounded-xl">
                    <div>
                        <p class="text-white font-medium">${config.username || 'Plex User'}</p>
                        <p class="text-gray-400 text-sm">${config.serverName || 'Plex Server'}</p>
                    </div>
                    <button id="plex-load-account-btn" class="bg-orange-600 hover:bg-orange-500 text-white px-4 py-2 rounded-lg transition-colors">
                        Load
                    </button>
                </div>
            `;
            
            // Add load button handler
            const loadBtn = document.getElementById('plex-load-account-btn');
            if (loadBtn) {
                loadBtn.addEventListener('click', () => {
                    showPlexView('browser');
                    renderPlexLibraries();
                });
            }
        }
    } else {
        // No account, show login
        showPlexView('login');
    }
}

async function renderPlexLibraries() {
    const grid = document.getElementById('plex-libraries-grid');
    const serverName = document.getElementById('plex-server-name');
    
    if (!grid) return;
    
    grid.innerHTML = '<div class="col-span-full text-center py-8"><div class="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto"></div><p class="text-gray-400 mt-2 text-sm">Loading libraries...</p></div>';
    
    try {
        const libraries = await getPlexLibraries();
        grid.innerHTML = '';
        
        if (serverName && plexConfig) {
            serverName.textContent = `Connected to ${plexConfig.serverName}`;
        }
        
        libraries.forEach(lib => {
            const card = document.createElement('button');
            card.className = 'p-4 rounded-xl bg-gray-800/50 border border-gray-700/50 hover:border-orange-500/50 transition-all text-left group';
            
            const icon = lib.type === 'movie' ? '🎬' : 
                        lib.type === 'show' ? '📺' : 
                        lib.type === 'artist' ? '🎵' : '📁';
            
            card.innerHTML = `
                <div class="flex items-center gap-3">
                    <div class="text-3xl">${icon}</div>
                    <div class="flex-1 min-w-0">
                        <p class="text-sm font-medium text-white truncate">${lib.title}</p>
                        <p class="text-xs text-gray-400 capitalize">${lib.type || 'Library'}</p>
                    </div>
                    <svg class="w-5 h-5 text-gray-400 group-hover:text-orange-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
                    </svg>
                </div>
            `;
            
            card.addEventListener('click', () => openPlexLibrary(lib));
            grid.appendChild(card);
        });
        
        if (libraries.length === 0) {
            grid.innerHTML = '<div class="col-span-full text-center text-gray-400 py-8">No libraries found</div>';
        }
    } catch (error) {
        console.error('Failed to load libraries:', error);
        grid.innerHTML = '<div class="col-span-full text-center text-red-400 py-8">Failed to load libraries. Please check your connection.</div>';
    }
}

async function openPlexLibrary(library) {
    currentLibraryId = library.key;
    
    const title = document.getElementById('plex-items-title');
    const grid = document.getElementById('plex-items-grid');
    const searchInput = document.getElementById('plex-items-search');
    
    if (title) title.textContent = library.title;
    if (grid) grid.innerHTML = '<div class="col-span-full text-center py-8"><div class="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto"></div><p class="text-gray-400 mt-2 text-sm">Loading content...</p></div>';
    if (searchInput) searchInput.value = '';
    
    showPlexView('items');
    
    try {
        const items = await getPlexItems(library.key);
        currentLibraryItems = items;
        
        renderPlexItems(items, grid, library.type);
        
        if (searchInput) {
            const newSearchInput = searchInput.cloneNode(true);
            searchInput.parentNode.replaceChild(newSearchInput, searchInput);
            
            newSearchInput.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase().trim();
                if (!query) {
                    renderPlexItems(currentLibraryItems, grid, library.type);
                } else {
                    const filtered = currentLibraryItems.filter(item => 
                        (item.title || '').toLowerCase().includes(query)
                    );
                    renderPlexItems(filtered, grid, library.type);
                }
            });
        }
    } catch (error) {
        console.error('Failed to load items:', error);
        if (grid) grid.innerHTML = '<div class="col-span-full text-center text-red-400 py-8">Failed to load items. Please try again.</div>';
    }
}

function renderPlexItems(items, grid, libraryType) {
    if (!grid) return;
    
    grid.innerHTML = '';
    
    items.forEach(item => {
        const card = createPlexItemCard(item, libraryType);
        grid.appendChild(card);
    });
    
    if (items.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-center text-gray-400 py-8">No items found</div>';
    }
}

function createPlexItemCard(item, libraryType) {
    const card = document.createElement('div');
    card.className = 'bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden hover:border-orange-500/50 transition-all cursor-pointer group';
    
    const imageUrl = getPlexImageUrl(item.thumb);
    const title = item.title || 'Unknown';
    const year = item.year || '';
    
    card.innerHTML = `
        <div class="relative aspect-[2/3]">
            <img src="${imageUrl}" alt="${title}" class="w-full h-full object-cover" onerror="this.src='https://via.placeholder.com/300x450/1a1a2e/ffffff?text=No+Image'">
            <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <div class="w-12 h-12 rounded-full bg-orange-600 flex items-center justify-center">
                    <svg class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z"/>
                    </svg>
                </div>
            </div>
        </div>
        <div class="p-3">
            <p class="text-sm font-medium text-white truncate">${title}</p>
            ${year ? `<p class="text-xs text-gray-400">${year}</p>` : ''}
        </div>
    `;
    
    card.addEventListener('click', () => {
        if (item.type === 'show') {
            openPlexShow(item);
        } else if (item.type === 'movie') {
            playPlexItem(item);
        }
    });
    
    return card;
}

async function openPlexShow(show) {
    currentShowId = show.key;
    
    const title = document.getElementById('plex-seasons-title');
    const grid = document.getElementById('plex-seasons-grid');
    const searchInput = document.getElementById('plex-seasons-search');
    
    if (title) title.textContent = show.title;
    if (grid) grid.innerHTML = '<div class="text-center py-8"><div class="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto"></div></div>';
    if (searchInput) searchInput.value = '';
    
    showPlexView('seasons');
    
    try {
        const seasons = await getPlexSeasons(show.key);
        
        currentShowSeasons = { seasons, show };
        
        renderPlexSeasons(seasons, grid);
        
        if (searchInput) {
            const newSearchInput = searchInput.cloneNode(true);
            searchInput.parentNode.replaceChild(newSearchInput, searchInput);
            
            newSearchInput.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase().trim();
                
                const allEpisodeCards = grid.querySelectorAll('[data-episode-card]');
                allEpisodeCards.forEach(card => {
                    const episodeName = card.getAttribute('data-episode-name') || '';
                    const seasonName = card.getAttribute('data-season-name') || '';
                    
                    if (!query || episodeName.toLowerCase().includes(query) || seasonName.toLowerCase().includes(query)) {
                        card.style.display = '';
                    } else {
                        card.style.display = 'none';
                    }
                });
            });
        }
    } catch (error) {
        console.error('Failed to load seasons:', error);
        if (grid) grid.innerHTML = '<div class="text-center text-red-400 py-8">Failed to load seasons</div>';
    }
}

function renderPlexSeasons(seasons, grid) {
    if (!grid) return;
    
    grid.innerHTML = '';
    
    if (seasons.length === 0) {
        grid.innerHTML = '<div class="text-center text-gray-400 py-8">No seasons found</div>';
        return;
    }
    
    const seasonsGrid = document.createElement('div');
    seasonsGrid.className = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4';
    
    seasons.forEach(season => {
        const seasonCard = createPlexSeasonCard(season);
        seasonsGrid.appendChild(seasonCard);
    });
    
    grid.appendChild(seasonsGrid);
}

function createPlexSeasonCard(season) {
    const card = document.createElement('div');
    card.className = 'bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden hover:border-orange-500/50 transition-all cursor-pointer group';
    card.setAttribute('data-season-key', season.key);
    
    const imageUrl = getPlexImageUrl(season.thumb);
    const title = season.title || 'Unknown';
    const episodeCount = season.leafCount || 0;
    
    card.innerHTML = `
        <div class="relative aspect-[2/3]">
            <img src="${imageUrl}" alt="${title}" class="w-full h-full object-cover" onerror="this.src='https://via.placeholder.com/300x450/1a1a2e/ffffff?text=${title}'">
            <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <div class="w-12 h-12 rounded-full bg-orange-600 flex items-center justify-center">
                    <svg class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M9 5l7 7-7 7V5z"/>
                    </svg>
                </div>
            </div>
        </div>
        <div class="p-3">
            <p class="text-sm font-medium text-white truncate">${title}</p>
            ${episodeCount > 0 ? `<p class="text-xs text-gray-400">${episodeCount} episodes</p>` : ''}
        </div>
    `;
    
    card.addEventListener('click', () => openPlexSeason(season));
    
    return card;
}

async function openPlexSeason(season) {
    const grid = document.getElementById('plex-seasons-grid');
    if (!grid) return;
    
    grid.innerHTML = '<div class="text-center py-8"><div class="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto"></div><p class="text-gray-400 mt-2 text-sm">Loading episodes...</p></div>';
    
    try {
        const episodes = await getPlexEpisodes(season.key);
        
        grid.innerHTML = '';
        
        const backBtn = document.createElement('button');
        backBtn.className = 'mb-4 px-4 py-2 bg-gray-800/50 border border-gray-700/50 rounded-lg text-white hover:border-orange-500/50 transition-all flex items-center gap-2';
        backBtn.innerHTML = `
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
            </svg>
            Back to Seasons
        `;
        backBtn.addEventListener('click', () => {
            if (currentShowSeasons && currentShowSeasons.seasons) {
                renderPlexSeasons(currentShowSeasons.seasons, grid);
            }
        });
        grid.appendChild(backBtn);
        
        const seasonHeader = document.createElement('h5');
        seasonHeader.className = 'text-lg font-semibold text-white mb-4 flex items-center gap-2';
        seasonHeader.innerHTML = `
            <span>${season.title}</span>
            <span class="text-sm text-gray-400">(${episodes.length} episodes)</span>
        `;
        grid.appendChild(seasonHeader);
        
        const episodesGrid = document.createElement('div');
        episodesGrid.className = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3';
        
        episodes.forEach(episode => {
            episode._seasonName = season.title;
            episode._seasonKey = season.key;
            const episodeCard = createPlexEpisodeCard(episode);
            episodesGrid.appendChild(episodeCard);
        });
        
        grid.appendChild(episodesGrid);
        
        if (episodes.length === 0) {
            episodesGrid.innerHTML = '<div class="col-span-full text-center text-gray-400 py-8">No episodes found</div>';
        }
    } catch (error) {
        console.error('Failed to load episodes:', error);
        grid.innerHTML = '<div class="text-center text-red-400 py-8">Failed to load episodes</div>';
    }
}

function createPlexEpisodeCard(episode) {
    const card = document.createElement('div');
    card.className = 'bg-gray-800/30 border border-gray-700/30 rounded-lg overflow-hidden hover:border-orange-500/50 transition-all cursor-pointer group';
    card.setAttribute('data-episode-card', 'true');
    card.setAttribute('data-episode-name', episode.title || '');
    card.setAttribute('data-season-name', episode._seasonName || '');
    
    const imageUrl = getPlexImageUrl(episode.thumb);
    const title = episode.title || 'Unknown';
    const episodeNum = episode.index ? `E${episode.index}` : '';
    
    card.innerHTML = `
        <div class="flex gap-3 p-3">
            <div class="relative w-32 h-20 flex-shrink-0 rounded overflow-hidden">
                <img src="${imageUrl}" alt="${title}" class="w-full h-full object-cover" onerror="this.src='https://via.placeholder.com/160x90/1a1a2e/ffffff?text=${episodeNum}'">
                <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div class="w-8 h-8 rounded-full bg-orange-600 flex items-center justify-center">
                        <svg class="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z"/>
                        </svg>
                    </div>
                </div>
            </div>
            <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-white truncate">${episodeNum} - ${title}</p>
                ${episode.summary ? `<p class="text-xs text-gray-400 line-clamp-2 mt-1">${episode.summary}</p>` : ''}
            </div>
        </div>
    `;
    
    card.addEventListener('click', () => playPlexItem(episode));
    
    return card;
}

async function playPlexItem(item) {
    console.log('[Plex] Playing item:', item);
    
    // Get the actual stream URL from media parts
    let streamUrl = null;
    
    try {
        const itemData = await plexRequest(item.key);
        const metadata = itemData.MediaContainer?.Metadata?.[0];
        
        if (metadata?.Media?.[0]?.Part?.[0]?.key) {
            streamUrl = getPlexStreamUrl(metadata.Media[0].Part[0].key);
        }
    } catch (error) {
        console.error('[Plex] Failed to get stream URL:', error);
    }
    
    if (!streamUrl) {
        showPlexNotification('Failed to get stream URL', 'error');
        return;
    }
    
    console.log('[Plex] Stream URL:', streamUrl);
    
    // Match with TMDB
    const tmdbMatch = await matchWithTMDB(item);
    
    let tmdbId = null;
    let imdbId = null;
    let mediaType = item.type === 'movie' ? 'movie' : 'tv';
    let seasonNum = null;
    let episodeNum = null;
    
    if (tmdbMatch) {
        tmdbId = tmdbMatch.tmdbId;
        imdbId = tmdbMatch.imdbId;
        mediaType = tmdbMatch.mediaType;
        console.log('[Plex] TMDB Match - TMDB ID:', tmdbId, 'IMDB ID:', imdbId);
    } else {
        console.warn('[Plex] No TMDB match found, playing without subtitles');
    }
    
    if (item.type === 'episode') {
        seasonNum = item.parentIndex;
        episodeNum = item.index;
        console.log('[Plex] Episode info - Season:', seasonNum, 'Episode:', episodeNum);
    }
    
    // Get player preference
    let playerPreference = 'builtin';
    try {
        const settingsRes = await fetch('/api/settings');
        const settings = await settingsRes.json();
        playerPreference = settings.playerType || (settings.useNodeMPV ? 'nodempv' : 'builtin');
        console.log('[Plex] Player preference from API:', playerPreference);
    } catch (e) {
        console.error('[Plex] Failed to load player preference:', e);
    }
    
    const title = item.title || 'Unknown';
    const subtitle = item.grandparentTitle ? `${item.grandparentTitle} - S${seasonNum}E${episodeNum}` : '';
    
    console.log('[Plex] Opening player:', playerPreference, 'for:', title);
    
    if (playerPreference === 'nodempv') {
        if (window.electronAPI && window.electronAPI.spawnMpvjsPlayer) {
            console.log('[Plex] Using Node MPV');
            window.electronAPI.spawnMpvjsPlayer({
                url: streamUrl,
                title: title,
                subtitle: subtitle,
                tmdbId: tmdbId,
                imdbId: imdbId,
                seasonNum: seasonNum,
                episodeNum: episodeNum,
                type: mediaType
            });
            return;
        } else {
            console.warn('[Plex] Node MPV not available, falling back to PlayTorrio');
            playerPreference = 'playtorrio';
        }
    }
    
    if (playerPreference === 'playtorrio') {
        console.log('[Plex] Using PlayTorrio player with IPC bridge');
        
        try {
            const response = await fetch('/api/playtorrioplayer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    url: streamUrl, 
                    tmdbId: tmdbId,
                    imdbId: imdbId,
                    seasonNum: seasonNum,
                    episodeNum: episodeNum,
                    mediaType: mediaType,
                    stopOnClose: false 
                })
            });
            const result = await response.json();
            
            if (result.success) {
                console.log('[Plex] PlayTorrio player opened successfully with IPC bridge');
                return;
            } else {
                console.error('[Plex] PlayTorrio player failed:', result.error);
                console.warn('[Plex] Falling back to HTML5 player');
                playerPreference = 'builtin';
            }
        } catch (err) {
            console.error('[Plex] PlayTorrio player error:', err);
            console.warn('[Plex] Falling back to HTML5 player');
            playerPreference = 'builtin';
        }
    }
    
    if (playerPreference === 'builtin') {
        console.log('[Plex] Using HTML5 player');
        
        console.log('[Plex] Fetching built-in subtitles for HTML5 player...');
        const plexSubs = await getPlexSubtitles(item.key);
        console.log('[Plex] Found', plexSubs.length, 'built-in subtitles for HTML5 player');
        
        const params = new URLSearchParams();
        params.append('url', streamUrl);
        params.append('showName', title);
        if (subtitle) params.append('subtitle', subtitle);
        if (tmdbId) params.append('tmdbId', tmdbId);
        if (imdbId) params.append('imdbId', imdbId);
        if (seasonNum) params.append('season', seasonNum);
        if (episodeNum) params.append('episode', episodeNum);
        if (mediaType) params.append('type', mediaType);
        
        if (plexSubs.length > 0) {
            params.append('plexSubs', JSON.stringify(plexSubs));
        }
        
        const playerUrl = `http://localhost:6987/player.html?${params.toString()}`;
        console.log('[Plex] Player URL:', playerUrl);
        
        if (window.playerOverlay) {
            console.log('[Plex] Using playerOverlay');
            window.playerOverlay.open(playerUrl);
        } else {
            console.log('[Plex] Using window.open');
            window.open(playerUrl, '_blank');
        }
    }
}

// Initialize Plex UI
export function initPlex() {
    console.log('[Plex] Initializing...');
    
    const plexBtn = document.getElementById('plex-btn');
    const plexAccountBackBtn = document.getElementById('plex-account-back-btn');
    const plexDeleteAccountBtn = document.getElementById('plex-delete-account-btn');
    const plexBackBtn = document.getElementById('plex-back-btn');
    const plexLoginBtn = document.getElementById('plex-login-btn');
    const plexDisconnectBtn = document.getElementById('plex-disconnect-btn');
    const plexItemsBackBtn = document.getElementById('plex-items-back-btn');
    const plexSeasonsBackBtn = document.getElementById('plex-seasons-back-btn');
    
    // Always show selection first
    showPlexView('selection');
    
    // Remove old listeners
    const cloneAndReplace = (element) => {
        if (!element) return null;
        const clone = element.cloneNode(true);
        element.parentNode.replaceChild(clone, element);
        return clone;
    };
    
    // Plex button - show account view
    const newPlexBtn = cloneAndReplace(plexBtn);
    if (newPlexBtn) {
        newPlexBtn.addEventListener('click', () => {
            console.log('[Plex] Plex button clicked');
            showPlexAccountView();
        });
    }
    
    // Account back button
    const newPlexAccountBackBtn = cloneAndReplace(plexAccountBackBtn);
    if (newPlexAccountBackBtn) {
        newPlexAccountBackBtn.addEventListener('click', () => {
            console.log('[Plex] Account back button clicked');
            showPlexView('selection');
        });
    }
    
    // Delete account button
    const newPlexDeleteAccountBtn = cloneAndReplace(plexDeleteAccountBtn);
    if (newPlexDeleteAccountBtn) {
        newPlexDeleteAccountBtn.addEventListener('click', () => {
            console.log('[Plex] Delete account button clicked');
            if (confirm('Remove Plex account?')) {
                clearPlexConfig();
                showPlexView('selection');
                showPlexNotification('Account removed', 'info');
            }
        });
    }
    
    // Back to account view from login
    const newPlexBackBtn = cloneAndReplace(plexBackBtn);
    if (newPlexBackBtn) {
        newPlexBackBtn.addEventListener('click', () => {
            console.log('[Plex] Back button clicked');
            if (authCheckInterval) {
                clearInterval(authCheckInterval);
                authCheckInterval = null;
            }
            showPlexAccountView();
        });
    }
    
    // Login button
    const newPlexLoginBtn = cloneAndReplace(plexLoginBtn);
    if (newPlexLoginBtn) {
        newPlexLoginBtn.addEventListener('click', async () => {
            console.log('[Plex] Login button clicked');
            const errorDiv = document.getElementById('plex-error');
            const statusDiv = document.getElementById('plex-status');
            
            if (errorDiv) errorDiv.classList.add('hidden');
            if (statusDiv) {
                statusDiv.textContent = 'Opening Plex login in browser...';
                statusDiv.classList.remove('hidden');
            }
            
            newPlexLoginBtn.disabled = true;
            newPlexLoginBtn.innerHTML = '<div class="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto"></div>';
            
            try {
                const { pinId } = await startPlexAuth();
                
                if (statusDiv) {
                    statusDiv.textContent = 'Waiting for authentication...';
                }
                
                // Poll for auth token
                authCheckInterval = setInterval(async () => {
                    const token = await checkPlexAuth(pinId);
                    
                    if (token) {
                        clearInterval(authCheckInterval);
                        authCheckInterval = null;
                        
                        if (statusDiv) {
                            statusDiv.textContent = 'Getting servers...';
                        }
                        
                        try {
                            const servers = await getPlexServers(token);
                            
                            if (servers.length === 0) {
                                throw new Error('No servers found');
                            }
                            
                            // Use first server with best connection
                            const server = servers[0];
                            
                            if (!server.bestConnection) {
                                throw new Error('No valid connection found for server');
                            }
                            
                            const serverUrl = server.bestConnection.uri;
                            
                            console.log('[Plex] Using server:', server.name, 'at', serverUrl);
                            
                            savePlexConfig({
                                authToken: server.accessToken, // Use server's accessToken, not user token
                                serverUrl: serverUrl,
                                serverName: server.name,
                                serverId: server.clientIdentifier
                            });
                            
                            showPlexNotification('Connected successfully!', 'success');
                            showPlexView('browser');
                            renderPlexLibraries();
                            
                            const serverName = document.getElementById('plex-server-name');
                            if (serverName) serverName.textContent = `Connected to ${server.name}`;
                            
                        } catch (error) {
                            console.error('Failed to get servers:', error);
                            if (errorDiv) {
                                errorDiv.textContent = 'Failed to connect to server. Please try again.';
                                errorDiv.classList.remove('hidden');
                            }
                        } finally {
                            newPlexLoginBtn.disabled = false;
                            newPlexLoginBtn.innerHTML = 'Login with Plex';
                            if (statusDiv) statusDiv.classList.add('hidden');
                        }
                    }
                }, 2000);
                
            } catch (error) {
                console.error('Login failed:', error);
                if (errorDiv) {
                    errorDiv.textContent = 'Login failed. Please try again.';
                    errorDiv.classList.remove('hidden');
                }
                newPlexLoginBtn.disabled = false;
                newPlexLoginBtn.innerHTML = 'Login with Plex';
                if (statusDiv) statusDiv.classList.add('hidden');
            }
        });
    }
    
    // Disconnect button - goes back to account view
    const newPlexDisconnectBtn = cloneAndReplace(plexDisconnectBtn);
    if (newPlexDisconnectBtn) {
        newPlexDisconnectBtn.addEventListener('click', () => {
            console.log('[Plex] Disconnect button clicked');
            showPlexAccountView();
        });
    }
    
    // Items back button
    const newPlexItemsBackBtn = cloneAndReplace(plexItemsBackBtn);
    if (newPlexItemsBackBtn) {
        newPlexItemsBackBtn.addEventListener('click', () => {
            console.log('[Plex] Items back button clicked');
            showPlexView('browser');
        });
    }
    
    // Seasons back button
    const newPlexSeasonsBackBtn = cloneAndReplace(plexSeasonsBackBtn);
    if (newPlexSeasonsBackBtn) {
        newPlexSeasonsBackBtn.addEventListener('click', () => {
            console.log('[Plex] Seasons back button clicked');
            if (currentLibraryId) {
                openPlexLibrary({ key: currentLibraryId, title: 'Library' });
            } else {
                showPlexView('browser');
            }
        });
    }
}
