// Details Page JavaScript
const API_KEY = 'c3515fdc674ea2bd7b514f4bc3616a4a';
const BASE_URL = 'https://api.themoviedb.org/3';
const IMG_BASE_URL = 'https://image.tmdb.org/t/p';

let currentMediaType = 'movie';
let currentMediaId = null;
let currentSeasonNumber = 1;
let allScreenshots = [];
let currentLightboxIndex = 0;

// Get URL parameters
function getUrlParams() {
    const params = new URLSearchParams(window.location.search);
    return {
        id: params.get('id'),
        type: params.get('type') || 'movie',
        season: params.get('season'),
        episode: params.get('episode')
    };
}

// Initialize page
async function initDetailsPage() {
    const params = getUrlParams();
    currentMediaId = params.id;
    currentMediaType = params.type;
    
    if (!currentMediaId) {
        showError('No media ID provided');
        return;
    }
    
    await loadMediaDetails();
    
    // Check for auto-play after page is fully loaded
    checkAutoPlay();
}

// Load all media details
async function loadMediaDetails() {
    try {
        showLoading();
        
        // Fetch main details
        const detailsUrl = `${BASE_URL}/${currentMediaType}/${currentMediaId}?api_key=${API_KEY}&append_to_response=videos,credits,images,similar`;
        const response = await fetch(detailsUrl);
        const data = await response.json();
        
        // Display details
        displayMainInfo(data);
        displayTrailer(data.videos);
        displayScreenshots(data.images);
        displayCast(data.credits);
        displaySimilar(data.similar);
        
        // Load TV show seasons if applicable
        if (currentMediaType === 'tv' && data.number_of_seasons) {
            await loadSeasons(data.number_of_seasons);
        }
        
        hideLoading();
        
        // Check my list status after details are loaded
        checkMyListStatus();
    } catch (error) {
        console.error('Error loading details:', error);
        showError('Failed to load details');
    }
}

// Display main info
function displayMainInfo(data) {
    const title = data.title || data.name;
    const releaseDate = data.release_date || data.first_air_date;
    const year = releaseDate ? new Date(releaseDate).getFullYear() : 'N/A';
    const rating = data.vote_average ? data.vote_average.toFixed(1) : 'N/A';
    const runtime = data.runtime || (data.episode_run_time && data.episode_run_time[0]);
    const posterPath = data.poster_path ? `${IMG_BASE_URL}/w500${data.poster_path}` : '';
    const backdropPath = data.backdrop_path ? `${IMG_BASE_URL}/original${data.backdrop_path}` : '';
    
    // Set backdrop
    document.querySelector('.hero-backdrop').style.backgroundImage = `url(${backdropPath})`;
    
    // Set poster
    document.getElementById('detailsPoster').src = posterPath;
    document.getElementById('detailsPoster').alt = title;
    
    // Set title
    document.getElementById('detailsTitle').textContent = title;
    
    // Set meta info
    document.getElementById('detailsRating').innerHTML = `⭐ ${rating}`;
    document.getElementById('detailsYear').textContent = year;
    document.getElementById('detailsRuntime').textContent = runtime ? `${runtime} min` : '';
    document.getElementById('detailsType').textContent = currentMediaType.toUpperCase();
    
    // Set genres
    const genresContainer = document.getElementById('detailsGenres');
    genresContainer.innerHTML = '';
    if (data.genres) {
        data.genres.forEach(genre => {
            const tag = document.createElement('span');
            tag.className = 'genre-tag';
            tag.textContent = genre.name;
            tag.style.cursor = 'pointer';
            tag.addEventListener('click', () => {
                // Navigate to genre page
                window.location.href = `index.html#genre-${genre.id}`;
            });
            genresContainer.appendChild(tag);
        });
    }
    
    // Set tagline and overview
    document.getElementById('detailsTagline').textContent = data.tagline || '';
    document.getElementById('detailsOverview').textContent = data.overview || 'No overview available.';
    
    // Set extra info
    document.getElementById('detailsStatus').textContent = data.status || 'N/A';
    document.getElementById('detailsLanguage').textContent = data.original_language?.toUpperCase() || 'N/A';
    
    // Budget and revenue (movies only)
    if (currentMediaType === 'movie') {
        document.getElementById('detailsBudget').textContent = data.budget ? `$${(data.budget / 1000000).toFixed(1)}M` : 'N/A';
        document.getElementById('detailsRevenue').textContent = data.revenue ? `$${(data.revenue / 1000000).toFixed(1)}M` : 'N/A';
    } else {
        document.getElementById('budgetItem').style.display = 'none';
        document.getElementById('revenueItem').style.display = 'none';
    }
}

// Display trailer
function displayTrailer(videos) {
    if (!videos || !videos.results || videos.results.length === 0) {
        return;
    }
    
    // Find YouTube trailer
    const trailer = videos.results.find(v => v.type === 'Trailer' && v.site === 'YouTube') || videos.results[0];
    
    if (trailer) {
        const trailerBtn = document.getElementById('trailerBtn');
        trailerBtn.style.display = 'flex';
        trailerBtn.setAttribute('data-trailer-key', trailer.key);
        
        trailerBtn.addEventListener('click', () => {
            openTrailerModal(trailer.key);
        });
    }
}

// Open trailer modal
function openTrailerModal(trailerKey) {
    const modal = document.getElementById('trailerModal');
    const container = document.getElementById('trailerModalContainer');
    
    // Use youtube-nocookie.com and simplified params to fix "Error 153" 
    // which usually happens in local environments due to origin/referrer issues.
    container.innerHTML = `
        <iframe 
            id="ytPlayer"
            src="https://www.youtube-nocookie.com/embed/${trailerKey}?autoplay=1&rel=0&showinfo=0&modestbranding=1" 
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowfullscreen
            frameborder="0">
        </iframe>
    `;
    
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

// Close trailer modal
function closeTrailerModal() {
    const modal = document.getElementById('trailerModal');
    const container = document.getElementById('trailerModalContainer');
    
    container.innerHTML = ''; // Stop video
    modal.classList.remove('active');
    document.body.style.overflow = 'auto';
}

// Display screenshots
function displayScreenshots(images) {
    if (!images || !images.backdrops || images.backdrops.length === 0) {
        return;
    }
    
    allScreenshots = images.backdrops.slice(0, 6); // Limit to 6 screenshots
    const screenshotsGrid = document.getElementById('screenshotsGrid');
    const screenshotsSection = document.getElementById('screenshotsSection');
    
    screenshotsGrid.innerHTML = '';
    allScreenshots.forEach((screenshot, index) => {
        const item = document.createElement('div');
        item.className = 'screenshot-item';
        item.innerHTML = `<img src="${IMG_BASE_URL}/w780${screenshot.file_path}" alt="Screenshot ${index + 1}">`;
        item.addEventListener('click', () => openLightbox(index));
        screenshotsGrid.appendChild(item);
    });
    
    screenshotsSection.style.display = 'block';
}

// Display cast
function displayCast(credits) {
    if (!credits || !credits.cast || credits.cast.length === 0) {
        return;
    }
    
    const castSlider = document.getElementById('castSlider');
    const castSection = document.getElementById('castSection');
    const cast = credits.cast.slice(0, 20); // Limit to 20 cast members
    
    castSlider.innerHTML = '';
    cast.forEach(person => {
        const card = document.createElement('div');
        card.className = 'cast-card';
        
        const photoPath = person.profile_path 
            ? `${IMG_BASE_URL}/w185${person.profile_path}` 
            : 'https://via.placeholder.com/185x278?text=No+Photo';
        
        card.innerHTML = `
            <div class="cast-photo">
                <img src="${photoPath}" alt="${person.name}">
            </div>
            <div class="cast-info">
                <div class="cast-name">${person.name}</div>
                <div class="cast-character">${person.character || 'Unknown'}</div>
            </div>
        `;
        
        // Add click handler to navigate to person page
        card.addEventListener('click', () => {
            window.location.href = `person.html?id=${person.id}`;
        });
        
        castSlider.appendChild(card);
    });
    
    castSection.style.display = 'block';
}

// Display similar content
function displaySimilar(similar) {
    if (!similar || !similar.results || similar.results.length === 0) {
        return;
    }
    
    const similarGrid = document.getElementById('similarGrid');
    const similarSection = document.getElementById('similarSection');
    const items = similar.results.slice(0, 20); // Show more items for scrolling
    
    similarGrid.innerHTML = '';
    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'similar-card';
        
        const title = item.title || item.name;
        const releaseDate = item.release_date || item.first_air_date;
        const year = releaseDate ? new Date(releaseDate).getFullYear() : 'N/A';
        const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
        const posterPath = item.poster_path 
            ? `${IMG_BASE_URL}/w342${item.poster_path}` 
            : 'https://via.placeholder.com/342x513?text=No+Image';
        
        card.innerHTML = `
            <div class="similar-poster">
                <img src="${posterPath}" alt="${title}">
            </div>
            <div class="similar-info">
                <div class="similar-title">${title}</div>
                <div class="similar-meta">
                    <span class="similar-year">${year}</span>
                    <span class="similar-rating">⭐ ${rating}</span>
                </div>
            </div>
        `;
        
        card.addEventListener('click', () => {
            const mediaType = item.media_type || currentMediaType;
            sessionStorage.setItem('skipIntro', 'true');
            window.location.href = `details.html?id=${item.id}&type=${mediaType}`;
        });
        
        similarGrid.appendChild(card);
    });
    
    similarSection.style.display = 'block';
}

// Load TV show seasons
async function loadSeasons(numberOfSeasons) {
    const seasonsSelector = document.getElementById('seasonsSelector');
    const seasonsSection = document.getElementById('seasonsSection');
    
    seasonsSelector.innerHTML = '';
    
    for (let i = 1; i <= numberOfSeasons; i++) {
        const btn = document.createElement('button');
        btn.className = `season-btn ${i === 1 ? 'active' : ''}`;
        btn.textContent = `Season ${i}`;
        btn.addEventListener('click', (e) => selectSeason(i, e));
        seasonsSelector.appendChild(btn);
    }
    
    seasonsSection.style.display = 'block';
    await loadEpisodes(1);
}

// Select season
async function selectSeason(seasonNumber, event) {
    currentSeasonNumber = seasonNumber;
    
    // Update active button
    document.querySelectorAll('.season-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    if (event && event.target) {
        event.target.classList.add('active');
    }
    
    await loadEpisodes(seasonNumber);
}

// Load episodes for a season
async function loadEpisodes(seasonNumber) {
    try {
        const url = `${BASE_URL}/tv/${currentMediaId}/season/${seasonNumber}?api_key=${API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        
        displayEpisodes(data.episodes);
    } catch (error) {
        console.error('Error loading episodes:', error);
    }
}

// Display episodes
function displayEpisodes(episodes) {
    const episodesGrid = document.getElementById('episodesGrid');
    episodesGrid.innerHTML = '';
    
    if (!episodes || episodes.length === 0) {
        episodesGrid.innerHTML = '<p style="color: rgba(255,255,255,0.5);">No episodes available</p>';
        return;
    }
    
    episodes.forEach(episode => {
        const card = document.createElement('div');
        card.className = 'episode-card';
        
        const stillPath = episode.still_path 
            ? `${IMG_BASE_URL}/w500${episode.still_path}` 
            : 'https://via.placeholder.com/500x281?text=No+Image';
        
        const airDate = episode.air_date ? new Date(episode.air_date).toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        }) : 'TBA';
        
        const rating = episode.vote_average ? episode.vote_average.toFixed(1) : 'N/A';
        
        card.innerHTML = `
            <div class="episode-thumbnail">
                <img src="${stillPath}" alt="${episode.name}">
                <div class="episode-play-overlay">
                    <div class="episode-play-btn">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z"/>
                        </svg>
                    </div>
                </div>
                <span class="episode-number">E${episode.episode_number}</span>
                ${episode.runtime ? `<span class="episode-runtime">${episode.runtime}m</span>` : ''}
            </div>
            <div class="episode-info">
                <div class="episode-title">${episode.name}</div>
                <div class="episode-air-date">${airDate}</div>
                <div class="episode-overview">${episode.overview || 'No overview available.'}</div>
                <div class="episode-rating">⭐ ${rating}</div>
            </div>
        `;
        
        card.addEventListener('click', async () => {
            // Check streaming mode setting directly from API
            let streamingEnabled = true; // default to ON (scraping)
            try {
                const res = await fetch('/api/settings');
                if (res.ok) {
                    const settings = await res.json();
                    streamingEnabled = settings.streamingMode !== false; // default to true
                }
            } catch (e) {
                console.warn('[Details] Failed to check streaming mode, defaulting to true');
            }
            
            console.log('[Details] Streaming mode:', streamingEnabled ? 'ON (scraping)' : 'OFF (play.html)');
            
            if (streamingEnabled && window.streamingMode) {
                // Streaming mode ON - scrape and extract from videasy/anitaro
                const posterPath = document.getElementById('detailsPoster').src;
                const title = document.getElementById('detailsTitle').textContent;
                const episodeTitle = `${title} - S${currentSeasonNumber}E${episode.episode_number}`;
                
                await window.streamingMode.playStream('tv', currentMediaId, posterPath, episodeTitle, currentSeasonNumber, episode.episode_number);
            } else {
                // Streaming mode OFF - use play.html
                window.location.href = `play.html?id=${currentMediaId}&type=tv&season=${currentSeasonNumber}&episode=${episode.episode_number}`;
            }
        });
        
        episodesGrid.appendChild(card);
    });
}

// Lightbox functionality
function openLightbox(index) {
    currentLightboxIndex = index;
    const lightbox = document.getElementById('lightbox');
    const lightboxImage = document.getElementById('lightboxImage');
    
    lightboxImage.src = `${IMG_BASE_URL}/original${allScreenshots[index].file_path}`;
    lightbox.classList.add('active');
    
    // Prevent body scroll
    document.body.style.overflow = 'hidden';
}

function closeLightbox() {
    const lightbox = document.getElementById('lightbox');
    lightbox.classList.remove('active');
    document.body.style.overflow = 'auto';
}

function nextLightboxImage() {
    currentLightboxIndex = (currentLightboxIndex + 1) % allScreenshots.length;
    document.getElementById('lightboxImage').src = `${IMG_BASE_URL}/original${allScreenshots[currentLightboxIndex].file_path}`;
}

function prevLightboxImage() {
    currentLightboxIndex = (currentLightboxIndex - 1 + allScreenshots.length) % allScreenshots.length;
    document.getElementById('lightboxImage').src = `${IMG_BASE_URL}/original${allScreenshots[currentLightboxIndex].file_path}`;
}

// Loading states
function showLoading() {
    document.getElementById('detailsLoading').style.display = 'flex';
    document.getElementById('detailsContent').style.display = 'none';
}

function hideLoading() {
    document.getElementById('detailsLoading').style.display = 'none';
    document.getElementById('detailsContent').style.display = 'block';
}

function showError(message) {
    document.getElementById('detailsLoading').innerHTML = `
        <div style="text-align: center;">
            <svg viewBox="0 0 24 24" fill="currentColor" style="width: 60px; height: 60px; color: #ef4444; margin-bottom: 20px;">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
            </svg>
            <p style="font-size: 18px; color: rgba(255,255,255,0.7);">${message}</p>
            <button onclick="window.history.back()" style="margin-top: 20px; padding: 12px 24px; background: #8b5cf6; border: none; border-radius: 25px; color: white; cursor: pointer; font-size: 16px;">Go Back</button>
        </div>
    `;
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    // Back button
    const backBtn = document.getElementById('backBtn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            // Check if we came from search results (check sessionStorage)
            const savedSearchState = sessionStorage.getItem('searchState');
            if (savedSearchState) {
                try {
                    const searchState = JSON.parse(savedSearchState);
                    if (searchState.results && searchState.results.length > 0) {
                        // Navigate back to index.html with a flag to restore search
                        sessionStorage.setItem('restoreSearch', 'true');
                        window.location.href = 'index.html';
                        return;
                    }
                } catch (e) {
                    console.error('Error parsing search state:', e);
                }
            }
            // Default: go back in history
            window.history.back();
        });
    }

    // Play Now button
    const playNowBtn = document.getElementById('playNowBtn');
    if (playNowBtn) {
        playNowBtn.addEventListener('click', async () => {
            if (currentMediaType === 'tv') {
                const seasonsSection = document.getElementById('seasonsSection');
                if (seasonsSection) {
                    seasonsSection.scrollIntoView({ behavior: 'smooth' });
                }
            } else {
                // Check streaming mode setting directly from API
                let streamingEnabled = true; // default to ON (scraping)
                try {
                    const res = await fetch('/api/settings');
                    if (res.ok) {
                        const settings = await res.json();
                        streamingEnabled = settings.streamingMode !== false; // default to true
                    }
                } catch (e) {
                    console.warn('[Details] Failed to check streaming mode, defaulting to true');
                }
                
                console.log('[Details] Streaming mode:', streamingEnabled ? 'ON (scraping)' : 'OFF (play.html)');
                
                if (streamingEnabled && window.streamingMode) {
                    // Streaming mode ON - scrape and extract from videasy/anitaro
                    const posterPath = document.getElementById('detailsPoster').src;
                    const title = document.getElementById('detailsTitle').textContent;
                    
                    await window.streamingMode.playStream('movie', currentMediaId, posterPath, title);
                } else {
                    // Streaming mode OFF - use play.html
                    window.location.href = `play.html?id=${currentMediaId}&type=${currentMediaType}`;
                }
            }
        });
    }

    // Slider Navigation
    const setupSliderNav = (gridId, prevBtnId, nextBtnId) => {
        const grid = document.getElementById(gridId);
        const prevBtn = document.getElementById(prevBtnId);
        const nextBtn = document.getElementById(nextBtnId);

        if (grid && prevBtn && nextBtn) {
            prevBtn.addEventListener('click', () => {
                grid.scrollBy({ left: -window.innerWidth * 0.5, behavior: 'smooth' });
            });
            nextBtn.addEventListener('click', () => {
                grid.scrollBy({ left: window.innerWidth * 0.5, behavior: 'smooth' });
            });
        }
    };

    setupSliderNav('screenshotsGrid', 'screenshotsPrev', 'screenshotsNext');
    setupSliderNav('similarGrid', 'similarPrev', 'similarNext');
    setupSliderNav('castSlider', 'castPrev', 'castNext');
    
    // Trailer modal controls
    const trailerModalClose = document.getElementById('trailerModalClose');
    const trailerModal = document.getElementById('trailerModal');
    
    if (trailerModalClose) {
        trailerModalClose.addEventListener('click', closeTrailerModal);
    }
    
    if (trailerModal) {
        trailerModal.addEventListener('click', (e) => {
            if (e.target === trailerModal) {
                closeTrailerModal();
            }
        });
    }
    
    // Lightbox controls
    const lightboxClose = document.getElementById('lightboxClose');
    const lightboxPrev = document.getElementById('lightboxPrev');
    const lightboxNext = document.getElementById('lightboxNext');
    const lightbox = document.getElementById('lightbox');
    
    if (lightboxClose) lightboxClose.addEventListener('click', closeLightbox);
    if (lightboxPrev) lightboxPrev.addEventListener('click', prevLightboxImage);
    if (lightboxNext) lightboxNext.addEventListener('click', nextLightboxImage);
    
    // Close lightbox on background click
    if (lightbox) {
        lightbox.addEventListener('click', (e) => {
            if (e.target === lightbox) {
                closeLightbox();
            }
        });
    }
    
    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        // Lightbox navigation
        if (lightbox.classList.contains('active')) {
            if (e.key === 'Escape') closeLightbox();
            if (e.key === 'ArrowLeft') prevLightboxImage();
            if (e.key === 'ArrowRight') nextLightboxImage();
        }
        
        // Trailer modal
        if (trailerModal.classList.contains('active')) {
            if (e.key === 'Escape') closeTrailerModal();
        }
    });
    
    // Initialize page
    initDetailsPage();
});

// Auto-play from Continue Watching
async function checkAutoPlay() {
    const autoPlay = sessionStorage.getItem('autoPlayStream');
    if (autoPlay === 'true') {
        sessionStorage.removeItem('autoPlayStream');
        
        console.log('[Details] Auto-playing from Continue Watching');
        
        // Check streaming mode setting directly from API
        let streamingEnabled = true; // default to ON (scraping)
        try {
            const res = await fetch('/api/settings');
            if (res.ok) {
                const settings = await res.json();
                streamingEnabled = settings.streamingMode !== false; // default to true
            }
        } catch (e) {
            console.warn('[Details] Failed to check streaming mode, defaulting to true');
        }
        
        console.log('[Details] Streaming mode:', streamingEnabled ? 'ON (scraping)' : 'OFF (play.html)');
        
        if (streamingEnabled && window.streamingMode) {
            // Streaming mode ON - scrape and extract from videasy/anitaro
            const posterPath = document.getElementById('detailsPoster')?.src;
            const title = document.getElementById('detailsTitle')?.textContent;
            
            if (currentMediaType === 'tv') {
                const params = getUrlParams();
                const season = parseInt(params.season);
                const episode = parseInt(params.episode);
                
                if (season && episode) {
                    const episodeTitle = `${title} - S${season} E${episode}`;
                    window.streamingMode.playStream('tv', currentMediaId, posterPath, episodeTitle, season, episode);
                }
            } else {
                window.streamingMode.playStream('movie', currentMediaId, posterPath, title);
            }
        } else {
            // Streaming mode OFF - use play.html
            const params = getUrlParams();
            if (currentMediaType === 'tv') {
                const season = parseInt(params.season);
                const episode = parseInt(params.episode);
                if (season && episode) {
                    window.location.href = `play.html?id=${currentMediaId}&type=tv&season=${season}&episode=${episode}`;
                }
            } else {
                window.location.href = `play.html?id=${currentMediaId}&type=${currentMediaType}`;
            }
        }
    }
}


// ============================================================================
// MY LIST FUNCTIONALITY
// ============================================================================

let isInList = false;

// Check if current item is in my list
async function checkMyListStatus() {
    try {
        const response = await fetch('/api/my-list');
        if (!response.ok) return;
        
        const list = await response.json();
        isInList = list.some(item => item.id === parseInt(currentMediaId) && item.media_type === currentMediaType);
        
        updateMyListButton();
    } catch (error) {
        console.error('[MyList] Error checking status:', error);
    }
}

// Update my list button appearance
function updateMyListButton() {
    const btn = document.getElementById('myListBtn');
    const btnText = document.getElementById('myListBtnText');
    
    if (!btn || !btnText) return;
    
    if (isInList) {
        btnText.textContent = 'Added';
        btn.style.background = 'rgba(139, 92, 246, 0.2)';
        btn.style.borderColor = 'rgba(139, 92, 246, 0.6)';
    } else {
        btnText.textContent = 'My List';
        btn.style.background = '';
        btn.style.borderColor = '';
    }
}

// Toggle my list
async function toggleMyList() {
    const btn = document.getElementById('myListBtn');
    if (!btn) return;
    
    // Disable button during operation
    btn.disabled = true;
    
    try {
        if (isInList) {
            // Remove from list
            const response = await fetch('/api/my-list/remove', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: parseInt(currentMediaId) })
            });
            
            if (!response.ok) throw new Error('Failed to remove from list');
            
            isInList = false;
            showNotification('Removed from My List', 'success');
        } else {
            // Add to list - get current details from the page
            const title = document.getElementById('detailsTitle')?.textContent || 'Unknown';
            const posterImg = document.getElementById('detailsPoster');
            const posterPath = posterImg ? posterImg.src.split('/w500')[1] : null;
            const year = document.getElementById('detailsYear')?.textContent || null;
            const ratingText = document.getElementById('detailsRating')?.textContent || '0';
            const vote_average = parseFloat(ratingText.replace('⭐', '').trim()) || 0;
            
            const item = {
                id: parseInt(currentMediaId),
                media_type: currentMediaType,
                title: title,
                poster_path: posterPath,
                year: year,
                vote_average: vote_average
            };
            
            const response = await fetch('/api/my-list/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(item)
            });
            
            if (!response.ok) throw new Error('Failed to add to list');
            
            isInList = true;
            showNotification('Added to My List', 'success');
        }
        
        updateMyListButton();
    } catch (error) {
        console.error('[MyList] Error toggling:', error);
        showNotification('Failed to update My List', 'error');
    } finally {
        btn.disabled = false;
    }
}

// Show notification
function showNotification(message, type = 'success') {
    // Reuse existing notification system if available
    if (window._showingNotification) return;
    window._showingNotification = true;
    
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        background: ${type === 'success' ? '#10b981' : '#ef4444'};
        color: white;
        padding: 16px 24px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 10001;
        font-size: 14px;
        font-weight: 500;
        animation: slideIn 0.3s ease-out;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => {
            notification.remove();
            window._showingNotification = false;
        }, 300);
    }, 2000);
}

// Initialize my list button
document.addEventListener('DOMContentLoaded', () => {
    const myListBtn = document.getElementById('myListBtn');
    if (myListBtn) {
        myListBtn.addEventListener('click', toggleMyList);
    }
});
