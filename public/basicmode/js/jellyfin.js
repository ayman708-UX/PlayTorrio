import { searchMulti, getMovieDetails, getTVShowDetails, getExternalIds } from './api.js';

const JELLYFIN_SERVERS_KEY = 'pt_jellyfin_servers'; // Changed to store array of servers
const JELLYFIN_ACTIVE_SERVER_KEY = 'pt_jellyfin_active_server';

let jellyfinServers = []; // Array of server configs
let activeServerId = null;
let currentLibraryId = null;
let currentShowId = null;
let currentLibraryItems = []; // Store all items for search
let currentShowSeasons = []; // Store all seasons/episodes for search

// Storage helpers for multiple servers
function saveJellyfinServers(servers) {
    try {
        localStorage.setItem(JELLYFIN_SERVERS_KEY, JSON.stringify(servers));
        jellyfinServers = servers;
    } catch (e) {
        console.error('Failed to save Jellyfin servers:', e);
    }
}

function loadJellyfinServers() {
    try {
        const stored = localStorage.getItem(JELLYFIN_SERVERS_KEY);
        if (stored) {
            jellyfinServers = JSON.parse(stored);
            return jellyfinServers;
        }
    } catch (e) {
        console.error('Failed to load Jellyfin servers:', e);
    }
    return [];
}

function addJellyfinServer(config) {
    const serverId = `${config.serverUrl}_${config.username}_${Date.now()}`;
    const serverConfig = { ...config, id: serverId };
    jellyfinServers.push(serverConfig);
    saveJellyfinServers(jellyfinServers);
    return serverId;
}

function removeJellyfinServer(serverId) {
    jellyfinServers = jellyfinServers.filter(s => s.id !== serverId);
    saveJellyfinServers(jellyfinServers);
    if (activeServerId === serverId) {
        activeServerId = null;
        localStorage.removeItem(JELLYFIN_ACTIVE_SERVER_KEY);
    }
}

function setActiveServer(serverId) {
    activeServerId = serverId;
    localStorage.setItem(JELLYFIN_ACTIVE_SERVER_KEY, serverId);
}

function getActiveServer() {
    if (!activeServerId) {
        activeServerId = localStorage.getItem(JELLYFIN_ACTIVE_SERVER_KEY);
    }
    return jellyfinServers.find(s => s.id === activeServerId);
}

// Show notification
function showJellyfinNotification(message, type = 'info') {
    if (window.showNotification) {
        window.showNotification(message, type);
    } else {
        console.log(`[${type}] ${message}`);
    }
}

// Jellyfin API helpers
async function jellyfinAuth(serverUrl, username, password) {
    const cleanUrl = serverUrl.replace(/\/$/, '');
    
    try {
        const response = await fetch(`${cleanUrl}/Users/AuthenticateByName`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Emby-Authorization': 'MediaBrowser Client="PlayTorrio", Device="Web", DeviceId="playtorrio-web", Version="1.0.0"'
            },
            body: JSON.stringify({
                Username: username,
                Pw: password
            })
        });
        
        if (!response.ok) {
            throw new Error('Authentication failed');
        }
        
        const data = await response.json();
        return {
            serverUrl: cleanUrl,
            userId: data.User.Id,
            accessToken: data.AccessToken,
            username: data.User.Name,
            serverName: data.User.ServerId
        };
    } catch (error) {
        console.error('Jellyfin auth error:', error);
        throw error;
    }
}

async function jellyfinRequest(endpoint) {
    const activeServer = getActiveServer();
    if (!activeServer) throw new Error('Not authenticated');
    
    const url = `${activeServer.serverUrl}${endpoint}`;
    const response = await fetch(url, {
        headers: {
            'X-Emby-Authorization': `MediaBrowser Client="PlayTorrio", Device="Web", DeviceId="playtorrio-web", Version="1.0.0", Token="${activeServer.accessToken}"`
        }
    });
    
    if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
    }
    
    return response.json();
}

// Get libraries
async function getJellyfinLibraries() {
    const activeServer = getActiveServer();
    const data = await jellyfinRequest(`/Users/${activeServer.userId}/Views`);
    return data.Items || [];
}

// Get items from a library
async function getJellyfinItems(libraryId, itemType = null) {
    const activeServer = getActiveServer();
    let endpoint = `/Users/${activeServer.userId}/Items?ParentId=${libraryId}&SortBy=SortName&SortOrder=Ascending`;
    if (itemType) {
        endpoint += `&IncludeItemTypes=${itemType}`;
    }
    const data = await jellyfinRequest(endpoint);
    return data.Items || [];
}

// Get seasons for a show
async function getJellyfinSeasons(showId) {
    const activeServer = getActiveServer();
    const data = await jellyfinRequest(`/Shows/${showId}/Seasons?UserId=${activeServer.userId}`);
    return data.Items || [];
}

// Get episodes for a season
async function getJellyfinEpisodes(showId, seasonId) {
    const activeServer = getActiveServer();
    const data = await jellyfinRequest(`/Shows/${showId}/Episodes?SeasonId=${seasonId}&UserId=${activeServer.userId}`);
    return data.Items || [];
}

// Get image URL
function getJellyfinImageUrl(itemId, imageType = 'Primary', tag = null) {
    const activeServer = getActiveServer();
    if (!activeServer || !itemId) return 'https://via.placeholder.com/300x450/1a1a2e/ffffff?text=No+Image';
    
    let url = `${activeServer.serverUrl}/Items/${itemId}/Images/${imageType}`;
    if (tag) url += `?tag=${tag}`;
    url += `&api_key=${activeServer.accessToken}`;
    
    return url;
}

// Get stream URL
function getJellyfinStreamUrl(itemId) {
    const activeServer = getActiveServer();
    if (!activeServer || !itemId) return null;
    return `${activeServer.serverUrl}/Videos/${itemId}/stream?static=true&api_key=${activeServer.accessToken}`;
}

// Get subtitles from Jellyfin
async function getJellyfinSubtitles(itemId) {
    const activeServer = getActiveServer();
    if (!activeServer || !itemId) return [];
    
    try {
        // Get item details which includes MediaStreams (subtitles)
        const item = await jellyfinRequest(`/Users/${activeServer.userId}/Items/${itemId}`);
        const subtitles = [];
        
        if (item.MediaStreams) {
            item.MediaStreams.forEach(stream => {
                if (stream.Type === 'Subtitle') {
                    const language = stream.Language || stream.DisplayLanguage || 'Unknown';
                    const title = stream.Title || stream.DisplayTitle || language;
                    const streamIndex = stream.Index;
                    
                    // Get MediaSourceId (usually same as itemId but can be different)
                    const mediaSourceId = item.MediaSources && item.MediaSources[0] ? item.MediaSources[0].Id : itemId;
                    
                    // Build subtitle URL - Jellyfin format: /Videos/{itemId}/{mediaSourceId}/Subtitles/{streamIndex}/0/Stream.srt
                    // The format can be srt, vtt, or js (JSON) - we'll use srt for compatibility
                    const subUrl = `${activeServer.serverUrl}/Videos/${itemId}/${mediaSourceId}/Subtitles/${streamIndex}/0/Stream.srt?api_key=${activeServer.accessToken}`;
                    
                    // Use "Built-in" as provider name for PlayTorrioPlayer grouping
                    const displayName = `${title} (${language})`;
                    
                    console.log(`[Jellyfin] Subtitle: ${displayName}, Index: ${streamIndex}, URL: ${subUrl}`);
                    
                    subtitles.push({
                        provider: 'Built-in',
                        name: displayName,
                        url: subUrl,
                        language: language,
                        isForced: stream.IsForced || false,
                        isDefault: stream.IsDefault || false
                    });
                }
            });
        }
        
        console.log(`[Jellyfin] Found ${subtitles.length} built-in subtitles`);
        return subtitles;
    } catch (error) {
        console.error('[Jellyfin] Failed to fetch subtitles:', error);
        return [];
    }
}

// Fetch subtitles for PlayTorrioPlayer
async function fetchSubtitlesForPlayer(tmdbId, imdbId, seasonNum, episodeNum, mediaType) {
    const subtitles = [];
    const TIMEOUT = 5000; // 5 seconds max
    
    const timeoutPromise = new Promise(resolve => {
        setTimeout(() => {
            console.log('[Jellyfin Subtitles] Timeout reached');
            resolve('timeout');
        }, TIMEOUT);
    });
    
    const fetchPromise = (async () => {
        const fetchPromises = [];
        
        // Fetch from Wyzie
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
                    console.warn('[Jellyfin Subtitles] Wyzie fetch error:', e);
                }
            })());
        }
        
        await Promise.allSettled(fetchPromises);
        return 'done';
    })();
    
    await Promise.race([fetchPromise, timeoutPromise]);
    
    console.log(`[Jellyfin Subtitles] Returning ${subtitles.length} subtitles`);
    return subtitles;
}

// Match Jellyfin item with TMDB and get IDs
async function matchWithTMDB(item) {
    // For episodes, use the series name instead of episode name
    const searchName = item.Type === 'Episode' && item.SeriesName ? item.SeriesName : item.Name;
    const searchYear = item.Type === 'Episode' && item.SeriesProductionYear ? item.SeriesProductionYear : item.ProductionYear;
    
    console.log('[Jellyfin TMDB] Matching item:', searchName, searchYear);
    
    try {
        const searchResults = await searchMulti(searchName);
        const results = searchResults.results || [];
        
        console.log('[Jellyfin TMDB] Found', results.length, 'results');
        
        const isMovie = item.Type === 'Movie';
        const validResults = results.filter(r => 
            isMovie ? r.media_type === 'movie' : r.media_type === 'tv'
        );
        
        let match = null;
        
        // Try to match by name and year
        if (searchYear) {
            match = validResults.find(r => {
                const resultYear = (r.release_date || r.first_air_date || '').split('-')[0];
                const resultName = (r.title || r.name || '').toLowerCase();
                const searchNameLower = searchName.toLowerCase();
                
                return resultYear === String(searchYear) && resultName === searchNameLower;
            });
        }
        
        // If no exact match, try fuzzy match by name only
        if (!match && validResults.length > 0) {
            const searchNameLower = searchName.toLowerCase();
            match = validResults.find(r => {
                const resultName = (r.title || r.name || '').toLowerCase();
                return resultName === searchNameLower;
            });
        }
        
        // If still no match, take the first result
        if (!match && validResults.length > 0) {
            match = validResults[0];
            console.log('[Jellyfin TMDB] No exact match, using first result');
        }
        
        if (match) {
            console.log('[Jellyfin TMDB] Matched:', match.title || match.name, 'TMDB ID:', match.id);
            
            // Get external IDs (including IMDB)
            const mediaType = isMovie ? 'movie' : 'tv';
            const externalIds = await getExternalIds(match.id, mediaType);
            const imdbId = externalIds.imdb_id;
            
            console.log('[Jellyfin TMDB] IMDB ID:', imdbId);
            
            return {
                tmdbId: match.id,
                imdbId: imdbId,
                mediaType: mediaType
            };
        } else {
            console.warn('[Jellyfin TMDB] No match found');
            return null;
        }
    } catch (error) {
        console.error('[Jellyfin TMDB] Search error:', error);
        return null;
    }
}

// UI Functions
function showJellyfinView(view) {
    const serverSelection = document.getElementById('server-selection');
    const jellyfinServerList = document.getElementById('jellyfin-server-list-container');
    const jellyfinLogin = document.getElementById('jellyfin-login');
    const jellyfinBrowser = document.getElementById('jellyfin-browser');
    const jellyfinLibraries = document.getElementById('jellyfin-libraries');
    const jellyfinItemsContainer = document.getElementById('jellyfin-items-container');
    const jellyfinSeasonsContainer = document.getElementById('jellyfin-seasons-container');
    
    // Hide all
    if (serverSelection) serverSelection.classList.add('hidden');
    if (jellyfinServerList) jellyfinServerList.classList.add('hidden');
    if (jellyfinLogin) jellyfinLogin.classList.add('hidden');
    if (jellyfinBrowser) jellyfinBrowser.classList.add('hidden');
    if (jellyfinLibraries) jellyfinLibraries.classList.add('hidden');
    if (jellyfinItemsContainer) jellyfinItemsContainer.classList.add('hidden');
    if (jellyfinSeasonsContainer) jellyfinSeasonsContainer.classList.add('hidden');
    
    // Show requested view
    switch(view) {
        case 'selection':
            if (serverSelection) serverSelection.classList.remove('hidden');
            break;
        case 'serverlist':
            if (jellyfinServerList) jellyfinServerList.classList.remove('hidden');
            break;
        case 'login':
            if (jellyfinLogin) jellyfinLogin.classList.remove('hidden');
            break;
        case 'browser':
            if (jellyfinBrowser) jellyfinBrowser.classList.remove('hidden');
            if (jellyfinLibraries) jellyfinLibraries.classList.remove('hidden');
            break;
        case 'items':
            if (jellyfinBrowser) jellyfinBrowser.classList.remove('hidden');
            if (jellyfinItemsContainer) jellyfinItemsContainer.classList.remove('hidden');
            break;
        case 'seasons':
            if (jellyfinBrowser) jellyfinBrowser.classList.remove('hidden');
            if (jellyfinSeasonsContainer) jellyfinSeasonsContainer.classList.remove('hidden');
            break;
    }
}

async function renderJellyfinLibraries() {
    const grid = document.getElementById('jellyfin-libraries-grid');
    const serverName = document.getElementById('jellyfin-server-name');
    
    if (!grid) return;
    
    grid.innerHTML = '<div class="col-span-full text-center py-8"><div class="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto"></div><p class="text-gray-400 mt-2 text-sm">Loading libraries...</p></div>';
    
    try {
        const libraries = await getJellyfinLibraries();
        grid.innerHTML = '';
        
        const activeServer = getActiveServer();
        if (serverName && activeServer) {
            serverName.textContent = `Connected as ${activeServer.username}`;
        }
        
        libraries.forEach(lib => {
            const card = document.createElement('button');
            card.className = 'p-4 rounded-xl bg-gray-800/50 border border-gray-700/50 hover:border-purple-500/50 transition-all text-left group';
            
            const icon = lib.CollectionType === 'movies' ? '🎬' : 
                        lib.CollectionType === 'tvshows' ? '📺' : 
                        lib.CollectionType === 'music' ? '🎵' : '📁';
            
            card.innerHTML = `
                <div class="flex items-center gap-3">
                    <div class="text-3xl">${icon}</div>
                    <div class="flex-1 min-w-0">
                        <p class="text-sm font-medium text-white truncate">${lib.Name}</p>
                        <p class="text-xs text-gray-400 capitalize">${lib.CollectionType || 'Library'}</p>
                    </div>
                    <svg class="w-5 h-5 text-gray-400 group-hover:text-purple-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
                    </svg>
                </div>
            `;
            
            card.addEventListener('click', () => openJellyfinLibrary(lib));
            grid.appendChild(card);
        });
        
        if (libraries.length === 0) {
            grid.innerHTML = '<div class="col-span-full text-center text-gray-400 py-8">No libraries found</div>';
        }
    } catch (error) {
        console.error('Failed to load libraries:', error);
        grid.innerHTML = `
            <div class="col-span-full text-center py-8">
                <div class="text-red-400 mb-2">
                    <i class="fas fa-exclamation-triangle text-3xl mb-3"></i>
                    <p class="font-medium">Failed to connect to Jellyfin server</p>
                </div>
                <p class="text-gray-400 text-sm">The server may be offline or unreachable.</p>
                <button onclick="location.reload()" class="mt-4 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors">
                    Retry
                </button>
            </div>
        `;
    }
}

async function openJellyfinLibrary(library) {
    currentLibraryId = library.Id;
    
    const title = document.getElementById('jellyfin-items-title');
    const grid = document.getElementById('jellyfin-items-grid');
    const searchInput = document.getElementById('jellyfin-items-search');
    
    if (title) title.textContent = library.Name;
    if (grid) grid.innerHTML = '<div class="col-span-full text-center py-8"><div class="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto"></div><p class="text-gray-400 mt-2 text-sm">Loading content...</p></div>';
    if (searchInput) searchInput.value = '';
    
    showJellyfinView('items');
    
    try {
        const itemType = library.CollectionType === 'movies' ? 'Movie' : 
                        library.CollectionType === 'tvshows' ? 'Series' : null;
        
        const items = await getJellyfinItems(library.Id, itemType);
        currentLibraryItems = items; // Store for search
        
        renderJellyfinItems(items, grid, library.CollectionType);
        
        // Add search functionality
        if (searchInput) {
            // Remove old listener
            const newSearchInput = searchInput.cloneNode(true);
            searchInput.parentNode.replaceChild(newSearchInput, searchInput);
            
            newSearchInput.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase().trim();
                if (!query) {
                    renderJellyfinItems(currentLibraryItems, grid, library.CollectionType);
                } else {
                    const filtered = currentLibraryItems.filter(item => 
                        (item.Name || '').toLowerCase().includes(query)
                    );
                    renderJellyfinItems(filtered, grid, library.CollectionType);
                }
            });
        }
    } catch (error) {
        console.error('Failed to load items:', error);
        if (grid) grid.innerHTML = '<div class="col-span-full text-center text-red-400 py-8">Failed to load items. Please try again.</div>';
    }
}

function renderJellyfinItems(items, grid, collectionType) {
    if (!grid) return;
    
    grid.innerHTML = '';
    
    items.forEach(item => {
        const card = createJellyfinItemCard(item, collectionType);
        grid.appendChild(card);
    });
    
    if (items.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-center text-gray-400 py-8">No items found</div>';
    }
}

function createJellyfinItemCard(item, collectionType) {
    const card = document.createElement('div');
    card.className = 'bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden hover:border-purple-500/50 transition-all cursor-pointer group';
    
    const imageUrl = getJellyfinImageUrl(item.Id, 'Primary', item.ImageTags?.Primary);
    const title = item.Name || 'Unknown';
    const year = item.ProductionYear || '';
    
    card.innerHTML = `
        <div class="relative aspect-[2/3]">
            <img src="${imageUrl}" alt="${title}" class="w-full h-full object-cover" onerror="this.src='https://via.placeholder.com/300x450/1a1a2e/ffffff?text=No+Image'">
            <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <div class="w-12 h-12 rounded-full bg-purple-600 flex items-center justify-center">
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
        if (item.Type === 'Series') {
            openJellyfinShow(item);
        } else if (item.Type === 'Movie') {
            playJellyfinItem(item);
        }
    });
    
    return card;
}

async function openJellyfinShow(show) {
    currentShowId = show.Id;
    
    const title = document.getElementById('jellyfin-seasons-title');
    const grid = document.getElementById('jellyfin-seasons-grid');
    const searchInput = document.getElementById('jellyfin-seasons-search');
    
    if (title) title.textContent = show.Name;
    if (grid) grid.innerHTML = '<div class="text-center py-8"><div class="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto"></div></div>';
    if (searchInput) searchInput.value = '';
    
    showJellyfinView('seasons');
    
    try {
        const seasons = await getJellyfinSeasons(show.Id);
        
        currentShowSeasons = { seasons, show }; // Store for later use
        
        renderJellyfinSeasons(seasons, grid);
        
        // Add search functionality for episodes (only works after a season is expanded)
        if (searchInput) {
            // Remove old listener
            const newSearchInput = searchInput.cloneNode(true);
            searchInput.parentNode.replaceChild(newSearchInput, searchInput);
            
            newSearchInput.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase().trim();
                
                // Filter visible episodes
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

function renderJellyfinSeasons(seasons, grid) {
    if (!grid) return;
    
    grid.innerHTML = '';
    
    if (seasons.length === 0) {
        grid.innerHTML = '<div class="text-center text-gray-400 py-8">No seasons found</div>';
        return;
    }
    
    // Create season cards
    const seasonsGrid = document.createElement('div');
    seasonsGrid.className = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4';
    
    seasons.forEach(season => {
        const seasonCard = createJellyfinSeasonCard(season);
        seasonsGrid.appendChild(seasonCard);
    });
    
    grid.appendChild(seasonsGrid);
}

function createJellyfinSeasonCard(season) {
    const card = document.createElement('div');
    card.className = 'bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden hover:border-purple-500/50 transition-all cursor-pointer group';
    card.setAttribute('data-season-id', season.Id);
    
    const imageUrl = getJellyfinImageUrl(season.Id, 'Primary', season.ImageTags?.Primary);
    const title = season.Name || 'Unknown';
    const episodeCount = season.UserData?.UnplayedItemCount || 0;
    
    card.innerHTML = `
        <div class="relative aspect-[2/3]">
            <img src="${imageUrl}" alt="${title}" class="w-full h-full object-cover" onerror="this.src='https://via.placeholder.com/300x450/1a1a2e/ffffff?text=${title}'">
            <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <div class="w-12 h-12 rounded-full bg-purple-600 flex items-center justify-center">
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
    
    card.addEventListener('click', () => openJellyfinSeason(season));
    
    return card;
}

async function openJellyfinSeason(season) {
    const grid = document.getElementById('jellyfin-seasons-grid');
    if (!grid) return;
    
    // Show loading state
    grid.innerHTML = '<div class="text-center py-8"><div class="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto"></div><p class="text-gray-400 mt-2 text-sm">Loading episodes...</p></div>';
    
    try {
        const episodes = await getJellyfinEpisodes(currentShowId, season.Id);
        
        // Add back button and render episodes
        grid.innerHTML = '';
        
        // Back button to seasons
        const backBtn = document.createElement('button');
        backBtn.className = 'mb-4 px-4 py-2 bg-gray-800/50 border border-gray-700/50 rounded-lg text-white hover:border-purple-500/50 transition-all flex items-center gap-2';
        backBtn.innerHTML = `
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
            </svg>
            Back to Seasons
        `;
        backBtn.addEventListener('click', () => {
            if (currentShowSeasons && currentShowSeasons.seasons) {
                renderJellyfinSeasons(currentShowSeasons.seasons, grid);
            }
        });
        grid.appendChild(backBtn);
        
        // Season header
        const seasonHeader = document.createElement('h5');
        seasonHeader.className = 'text-lg font-semibold text-white mb-4 flex items-center gap-2';
        seasonHeader.innerHTML = `
            <span>${season.Name}</span>
            <span class="text-sm text-gray-400">(${episodes.length} episodes)</span>
        `;
        grid.appendChild(seasonHeader);
        
        // Episodes grid
        const episodesGrid = document.createElement('div');
        episodesGrid.className = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3';
        
        episodes.forEach(episode => {
            episode._seasonName = season.Name;
            episode._seasonId = season.Id;
            const episodeCard = createJellyfinEpisodeCard(episode);
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

function createJellyfinEpisodeCard(episode) {
    const card = document.createElement('div');
    card.className = 'bg-gray-800/30 border border-gray-700/30 rounded-lg overflow-hidden hover:border-purple-500/50 transition-all cursor-pointer group';
    card.setAttribute('data-episode-card', 'true');
    card.setAttribute('data-episode-name', episode.Name || '');
    card.setAttribute('data-season-name', episode._seasonName || '');
    
    const imageUrl = getJellyfinImageUrl(episode.Id, 'Primary', episode.ImageTags?.Primary);
    const title = episode.Name || 'Unknown';
    const episodeNum = episode.IndexNumber ? `E${episode.IndexNumber}` : '';
    
    card.innerHTML = `
        <div class="flex gap-3 p-3">
            <div class="relative w-32 h-20 flex-shrink-0 rounded overflow-hidden">
                <img src="${imageUrl}" alt="${title}" class="w-full h-full object-cover" onerror="this.src='https://via.placeholder.com/160x90/1a1a2e/ffffff?text=${episodeNum}'">
                <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div class="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center">
                        <svg class="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z"/>
                        </svg>
                    </div>
                </div>
            </div>
            <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-white truncate">${episodeNum} - ${title}</p>
                ${episode.Overview ? `<p class="text-xs text-gray-400 line-clamp-2 mt-1">${episode.Overview}</p>` : ''}
            </div>
        </div>
    `;
    
    card.addEventListener('click', () => playJellyfinItem(episode));
    
    return card;
}

async function playJellyfinItem(item) {
    console.log('[Jellyfin] Playing item:', item);
    
    const streamUrl = getJellyfinStreamUrl(item.Id);
    console.log('[Jellyfin] Stream URL:', streamUrl);
    
    if (!streamUrl) {
        showJellyfinNotification('Failed to get stream URL', 'error');
        return;
    }
    
    // Match with TMDB to get IDs for subtitles
    console.log('[Jellyfin] Matching with TMDB...');
    const tmdbMatch = await matchWithTMDB(item);
    
    let tmdbId = null;
    let imdbId = null;
    let mediaType = item.Type === 'Movie' ? 'movie' : 'tv';
    let seasonNum = null;
    let episodeNum = null;
    
    if (tmdbMatch) {
        tmdbId = tmdbMatch.tmdbId;
        imdbId = tmdbMatch.imdbId;
        mediaType = tmdbMatch.mediaType;
        console.log('[Jellyfin] TMDB Match - TMDB ID:', tmdbId, 'IMDB ID:', imdbId);
    } else {
        console.warn('[Jellyfin] No TMDB match found, playing without subtitles');
    }
    
    // For episodes, get season and episode numbers from Jellyfin
    if (item.Type === 'Episode') {
        seasonNum = item.ParentIndexNumber;
        episodeNum = item.IndexNumber;
        console.log('[Jellyfin] Episode info - Season:', seasonNum, 'Episode:', episodeNum);
    }
    
    // Get player preference from API settings (same as details page)
    let playerPreference = 'builtin'; // Default
    try {
        const settingsRes = await fetch('/api/settings');
        const settings = await settingsRes.json();
        playerPreference = settings.playerType || (settings.useNodeMPV ? 'nodempv' : 'builtin');
        console.log('[Jellyfin] Player preference from API:', playerPreference);
    } catch (e) {
        console.error('[Jellyfin] Failed to load player preference:', e);
    }
    
    const title = item.Name || 'Unknown';
    const subtitle = item.SeriesName ? `${item.SeriesName} - S${seasonNum}E${episodeNum}` : '';
    
    console.log('[Jellyfin] Opening player:', playerPreference, 'for:', title);
    
    if (playerPreference === 'nodempv') {
        // Use Node MPV player
        if (window.electronAPI && window.electronAPI.spawnMpvjsPlayer) {
            console.log('[Jellyfin] Using Node MPV');
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
            return; // Exit after spawning MPV
        } else {
            console.warn('[Jellyfin] Node MPV not available, falling back to PlayTorrio');
            playerPreference = 'playtorrio'; // Fall through
        }
    }
    
    if (playerPreference === 'playtorrio') {
        // Use PlayTorrio player with subtitles
        console.log('[Jellyfin] Using PlayTorrio player');
        
        // Use PlayTorrio player with IPC bridge
        console.log('[Jellyfin] Using PlayTorrio player with IPC bridge');
        
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
                console.log('[Jellyfin] PlayTorrio player opened successfully with IPC bridge');
                return; // Exit after opening PlayTorrio
            } else {
                console.error('[Jellyfin] PlayTorrio player failed:', result.error);
                console.warn('[Jellyfin] Falling back to HTML5 player');
                playerPreference = 'builtin'; // Fall through
            }
        } catch (err) {
            console.error('[Jellyfin] PlayTorrio player error:', err);
            console.warn('[Jellyfin] Falling back to HTML5 player');
            playerPreference = 'builtin'; // Fall through
        }
    }
    
    // Use HTML5 player (default/builtin or fallback)
    if (playerPreference === 'builtin') {
        console.log('[Jellyfin] Using HTML5 player');
        
        // Fetch Jellyfin built-in subtitles for HTML5 player
        console.log('[Jellyfin] Fetching built-in subtitles for HTML5 player...');
        const jellyfinSubs = await getJellyfinSubtitles(item.Id);
        console.log('[Jellyfin] Found', jellyfinSubs.length, 'built-in subtitles for HTML5 player');
        
        // Build player URL with proper localhost address
        const params = new URLSearchParams();
        params.append('url', streamUrl);
        params.append('showName', title);
        if (subtitle) params.append('subtitle', subtitle);
        if (tmdbId) params.append('tmdbId', tmdbId);
        if (imdbId) params.append('imdbId', imdbId);
        if (seasonNum) params.append('season', seasonNum);
        if (episodeNum) params.append('episode', episodeNum);
        if (mediaType) params.append('type', mediaType);
        
        // Pass Jellyfin subtitles as JSON in query param
        if (jellyfinSubs.length > 0) {
            params.append('jellyfinSubs', JSON.stringify(jellyfinSubs));
        }
        
        const playerUrl = `http://localhost:6987/player.html?${params.toString()}`;
        console.log('[Jellyfin] Player URL:', playerUrl);
        
        // Try to use playerOverlay if available (same as details page)
        if (window.playerOverlay) {
            console.log('[Jellyfin] Using playerOverlay');
            window.playerOverlay.open(playerUrl);
        } else {
            // Fallback to window.open
            console.log('[Jellyfin] Using window.open');
            window.open(playerUrl, '_blank');
        }
    }
}

// Render server list
function renderJellyfinServerList() {
    const serverList = document.getElementById('jellyfin-server-list');
    if (!serverList) return;
    
    serverList.innerHTML = '';
    
    if (jellyfinServers.length === 0) {
        serverList.innerHTML = '<p class="text-gray-400 text-center py-4">No servers added yet</p>';
        return;
    }
    
    jellyfinServers.forEach(server => {
        const serverCard = document.createElement('div');
        serverCard.className = 'flex items-center justify-between p-4 bg-gray-800/50 border border-gray-700/50 rounded-xl hover:border-purple-500/50 transition-all';
        
        serverCard.innerHTML = `
            <div class="flex-1 cursor-pointer" data-server-id="${server.id}">
                <p class="text-white font-medium">${server.username}</p>
                <p class="text-gray-400 text-sm">${server.serverUrl}</p>
            </div>
            <button class="delete-server-btn px-3 py-2 bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded-lg transition-all" data-server-id="${server.id}">
                <i class="fas fa-trash"></i>
            </button>
        `;
        
        // Click server to load it
        const serverInfo = serverCard.querySelector('[data-server-id]');
        serverInfo.addEventListener('click', () => {
            setActiveServer(server.id);
            showJellyfinView('browser');
            renderJellyfinLibraries();
        });
        
        // Delete button
        const deleteBtn = serverCard.querySelector('.delete-server-btn');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`Remove server ${server.username}?`)) {
                removeJellyfinServer(server.id);
                renderJellyfinServerList();
                showJellyfinNotification('Server removed', 'info');
            }
        });
        
        serverList.appendChild(serverCard);
    });
}

// Initialize Jellyfin UI
export function initJellyfin() {
    console.log('[Jellyfin] Initializing...');
    
    // Load servers from storage
    jellyfinServers = loadJellyfinServers();
    console.log('[Jellyfin] Loaded servers:', jellyfinServers);
    
    const jellyfinBtn = document.getElementById('jellyfin-btn');
    const jellyfinServerListBackBtn = document.getElementById('jellyfin-server-list-back-btn');
    const jellyfinAddServerBtn = document.getElementById('jellyfin-add-server-btn');
    const jellyfinBackBtn = document.getElementById('jellyfin-back-btn');
    const jellyfinConnectBtn = document.getElementById('jellyfin-connect-btn');
    const jellyfinDisconnectBtn = document.getElementById('jellyfin-disconnect-btn');
    const jellyfinItemsBackBtn = document.getElementById('jellyfin-items-back-btn');
    const jellyfinSeasonsBackBtn = document.getElementById('jellyfin-seasons-back-btn');
    
    // Always show server selection first
    showJellyfinView('selection');
    
    // Remove old listeners by cloning and replacing (prevents duplicate listeners)
    const cloneAndReplace = (element) => {
        if (!element) return null;
        const clone = element.cloneNode(true);
        element.parentNode.replaceChild(clone, element);
        return clone;
    };
    
    // Jellyfin button - show server list
    const newJellyfinBtn = cloneAndReplace(jellyfinBtn);
    if (newJellyfinBtn) {
        newJellyfinBtn.addEventListener('click', () => {
            console.log('[Jellyfin] Jellyfin button clicked');
            showJellyfinView('serverlist');
            renderJellyfinServerList();
        });
    }
    
    // Server list back button
    const newJellyfinServerListBackBtn = cloneAndReplace(jellyfinServerListBackBtn);
    if (newJellyfinServerListBackBtn) {
        newJellyfinServerListBackBtn.addEventListener('click', () => {
            console.log('[Jellyfin] Server list back button clicked');
            showJellyfinView('selection');
        });
    }
    
    // Add server button
    const newJellyfinAddServerBtn = cloneAndReplace(jellyfinAddServerBtn);
    if (newJellyfinAddServerBtn) {
        newJellyfinAddServerBtn.addEventListener('click', () => {
            console.log('[Jellyfin] Add server button clicked');
            showJellyfinView('login');
        });
    }
    
    // Login back button
    const newJellyfinBackBtn = cloneAndReplace(jellyfinBackBtn);
    if (newJellyfinBackBtn) {
        newJellyfinBackBtn.addEventListener('click', () => {
            console.log('[Jellyfin] Login back button clicked');
            showJellyfinView('serverlist');
        });
    }
    
    // Connect button - adds new server
    const newJellyfinConnectBtn = cloneAndReplace(jellyfinConnectBtn);
    if (newJellyfinConnectBtn) {
        newJellyfinConnectBtn.addEventListener('click', async () => {
            console.log('[Jellyfin] Connect button clicked');
            const urlInput = document.getElementById('jellyfin-url');
            const usernameInput = document.getElementById('jellyfin-username');
            const passwordInput = document.getElementById('jellyfin-password');
            const errorDiv = document.getElementById('jellyfin-error');
            
            const url = urlInput?.value.trim();
            const username = usernameInput?.value.trim();
            const password = passwordInput?.value;
            
            if (!url || !username || !password) {
                if (errorDiv) {
                    errorDiv.textContent = 'Please fill in all fields';
                    errorDiv.classList.remove('hidden');
                }
                return;
            }
            
            if (errorDiv) errorDiv.classList.add('hidden');
            newJellyfinConnectBtn.disabled = true;
            newJellyfinConnectBtn.innerHTML = '<div class="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto"></div>';
            
            try {
                const config = await jellyfinAuth(url, username, password);
                const serverId = addJellyfinServer(config);
                setActiveServer(serverId);
                
                showJellyfinNotification('Server added successfully!', 'success');
                showJellyfinView('browser');
                renderJellyfinLibraries();
                
                // Clear inputs
                if (urlInput) urlInput.value = '';
                if (usernameInput) usernameInput.value = '';
                if (passwordInput) passwordInput.value = '';
                
            } catch (error) {
                console.error('Connection failed:', error);
                if (errorDiv) {
                    errorDiv.textContent = 'Connection failed. Please check your credentials.';
                    errorDiv.classList.remove('hidden');
                }
            } finally {
                newJellyfinConnectBtn.disabled = false;
                newJellyfinConnectBtn.innerHTML = '<span>Connect</span><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6"/></svg>';
            }
        });
    }
    
    // Disconnect button - goes back to server list
    const newJellyfinDisconnectBtn = cloneAndReplace(jellyfinDisconnectBtn);
    if (newJellyfinDisconnectBtn) {
        newJellyfinDisconnectBtn.addEventListener('click', () => {
            console.log('[Jellyfin] Disconnect button clicked');
            showJellyfinView('serverlist');
            renderJellyfinServerList();
        });
    }
    
    // Items back button
    const newJellyfinItemsBackBtn = cloneAndReplace(jellyfinItemsBackBtn);
    if (newJellyfinItemsBackBtn) {
        newJellyfinItemsBackBtn.addEventListener('click', () => {
            console.log('[Jellyfin] Items back button clicked');
            showJellyfinView('browser');
        });
    }
    
    // Seasons back button
    const newJellyfinSeasonsBackBtn = cloneAndReplace(jellyfinSeasonsBackBtn);
    if (newJellyfinSeasonsBackBtn) {
        newJellyfinSeasonsBackBtn.addEventListener('click', () => {
            console.log('[Jellyfin] Seasons back button clicked');
            if (currentLibraryId) {
                openJellyfinLibrary({ Id: currentLibraryId, Name: 'Library' });
            } else {
                showJellyfinView('browser');
            }
        });
    }
    
    // Enter key support for login
    const jellyfinPassword = document.getElementById('jellyfin-password');
    if (jellyfinPassword) {
        jellyfinPassword.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && newJellyfinConnectBtn) {
                newJellyfinConnectBtn.click();
            }
        });
    }
}
