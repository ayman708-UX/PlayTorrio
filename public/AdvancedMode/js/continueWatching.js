// Continue Watching functionality for home page
// Uses API_KEY, BASE_URL, and IMG_BASE_URL from app.js

// Get continue watching list (fallback if streaming.js not loaded yet)
function getContinueWatchingListLocal() {
    if (window.getContinueWatchingList) {
        return window.getContinueWatchingList();
    }
    
    // Fallback implementation
    try {
        const saved = localStorage.getItem('continueWatching');
        return saved ? JSON.parse(saved) : [];
    } catch (e) {
        console.error('[ContinueWatching] Failed to retrieve list:', e);
        return [];
    }
}

// Remove item from continue watching (fallback if streaming.js not loaded yet)
function removeFromContinueWatchingLocal(itemKey) {
    if (window.removeFromContinueWatching) {
        return window.removeFromContinueWatching(itemKey);
    }
    
    // Fallback implementation
    try {
        const continueWatching = getContinueWatchingListLocal();
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

// Initialize Continue Watching section
function initContinueWatching() {
    const continueWatching = getContinueWatchingListLocal();
    
    if (continueWatching.length === 0) {
        // Hide section if empty
        const section = document.getElementById('continue-watching-section');
        if (section) section.style.display = 'none';
        return;
    }
    
    renderContinueWatching(continueWatching);
}

// Render Continue Watching slider
async function renderContinueWatching(items) {
    const container = document.getElementById('continue-watching-grid');
    if (!container) {
        console.warn('[ContinueWatching] Container not found');
        return;
    }
    
    const section = document.getElementById('continue-watching-section');
    if (section) section.style.display = 'block';
    
    container.innerHTML = '';
    
    // Limit to first 10 items to avoid too many API calls
    const limitedItems = items.slice(0, 10);
    
    for (const item of limitedItems) {
        try {
            // Fetch additional metadata from TMDB
            const detailsUrl = `${BASE_URL}/${item.type}/${item.tmdbId}?api_key=${API_KEY}`;
            const response = await fetch(detailsUrl);
            
            if (!response.ok) {
                console.warn('[ContinueWatching] Failed to fetch metadata for', item.tmdbId);
                continue;
            }
            
            const data = await response.json();
            
            const card = createContinueWatchingCard(item, data);
            container.appendChild(card);
        } catch (error) {
            console.error('[ContinueWatching] Error fetching metadata:', error);
            // Continue with next item instead of breaking
        }
    }
    
    // If no cards were added, hide the section
    if (container.children.length === 0) {
        if (section) section.style.display = 'none';
    }
}

// Create Continue Watching card
function createContinueWatchingCard(item, metadata) {
    const card = document.createElement('div');
    card.className = 'continue-watching-card';
    
    const posterPath = metadata.poster_path 
        ? `${IMG_BASE_URL}/w500${metadata.poster_path}`
        : item.posterUrl || 'https://via.placeholder.com/500x750?text=No+Image';
    
    const title = metadata.title || metadata.name || item.title;
    
    // Calculate progress percentage (assume 2 hour max for movies, 1 hour for TV)
    const estimatedDuration = item.type === 'movie' ? 7200 : 3600;
    const progress = Math.min((item.time / estimatedDuration) * 100, 100);
    
    // Format time
    const minutes = Math.floor(item.time / 60);
    const seconds = Math.floor(item.time % 60);
    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    
    // Episode info for TV shows
    let episodeInfo = '';
    if (item.type === 'tv' && item.season && item.episode) {
        episodeInfo = `<div class="continue-episode-info">S${item.season} E${item.episode}</div>`;
    }
    
    card.innerHTML = `
        <div class="continue-card-poster">
            <img src="${posterPath}" alt="${title}" loading="lazy">
            <button class="continue-remove-btn" onclick="removeContinueWatchingItem('${item.key}', event)">
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
            </button>
            <div class="continue-play-overlay">
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z"/>
                </svg>
            </div>
        </div>
        <div class="continue-card-info">
            <h3 class="continue-card-title">${title}</h3>
            ${episodeInfo}
            <div class="continue-progress-bar">
                <div class="continue-progress-fill" style="width: ${progress}%"></div>
            </div>
            <div class="continue-time">${timeStr}</div>
        </div>
    `;
    
    // Click handler to resume playback
    card.addEventListener('click', (e) => {
        if (!e.target.closest('.continue-remove-btn')) {
            resumePlayback(item);
        }
    });
    
    return card;
}

// Resume playback from Continue Watching
async function resumePlayback(item) {
    console.log('[ContinueWatching] Resuming playback:', item);
    
    // Navigate to details page with auto-play flag
    sessionStorage.setItem('autoPlayStream', 'true');
    sessionStorage.setItem('skipIntro', 'true');
    
    if (item.type === 'movie') {
        window.location.href = `details.html?id=${item.tmdbId}&type=movie`;
    } else {
        window.location.href = `details.html?id=${item.tmdbId}&type=tv&season=${item.season}&episode=${item.episode}`;
    }
}

// Remove item from Continue Watching
function removeContinueWatchingItem(itemKey, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    
    const success = removeFromContinueWatchingLocal(itemKey);
    if (success) {
        // Refresh the Continue Watching section
        initContinueWatching();
    }
}

// Make function globally accessible
window.removeContinueWatchingItem = removeContinueWatchingItem;

// Initialize on page load - wrap in try/catch to prevent breaking other scripts
document.addEventListener('DOMContentLoaded', () => {
    try {
        initContinueWatching();
    } catch (error) {
        console.error('[ContinueWatching] Error initializing:', error);
        // Hide section on error
        const section = document.getElementById('continue-watching-section');
        if (section) section.style.display = 'none';
    }
});
