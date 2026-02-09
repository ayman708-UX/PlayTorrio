// Audiobooks Functionality for Advanced Mode
const AUDIOBOOKS_API = window.location.origin;

let currentAudiobooksPage = 1;
let isLoadingAudiobooks = false;
let hasMoreAudiobooks = true;
let isAudiobooksSearchMode = false;
let currentAudiobook = null;
let currentChapter = null;
let currentStreamUrl = null;

// Audiobooks to filter out
const FILTERED_AUDIOBOOKS = [
    '1001 nights',
    'the fox and the wolf'
];

const shouldFilterAudiobook = (audiobook) => {
    const title = (audiobook.title || '').toLowerCase();
    return FILTERED_AUDIOBOOKS.some(filter => title.includes(filter.toLowerCase()));
};

// Show Audiobooks Page
function showAudiobooksPage() {
    hideAllSections();
    
    let audiobooksSection = document.getElementById('audiobooksSection');
    if (!audiobooksSection) {
        createAudiobooksSection();
        initialAudiobooksLoad();
    } else {
        audiobooksSection.style.setProperty('display', 'block', 'important');
    }
}

// Initial Load
async function initialAudiobooksLoad() {
    await loadAudiobooks();
}

// Create Audiobooks Section
function createAudiobooksSection() {
    const mainContent = document.getElementById('mainContent');
    const section = document.createElement('div');
    section.id = 'audiobooksSection';
    section.className = 'audiobooks-section';
    section.innerHTML = `
        <div class="audiobooks-header">
            <div class="search-container-audiobooks">
                <input type="text" id="audiobooksSearch" placeholder="Search audiobooks...">
                <button id="audiobooksSearchBtn">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
                </button>
            </div>
        </div>
        <div class="audiobooks-grid" id="audiobooksGrid"></div>
        <div class="audiobooks-loader" id="audiobooksLoader">
            <div class="spinner"></div>
        </div>
        <div class="audiobooks-load-more" id="audiobooksLoadMore" style="display: none;">
            <button class="load-more-btn" id="audiobooksLoadMoreBtn">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                Load More
            </button>
        </div>
    `;
    mainContent.appendChild(section);

    const searchInput = document.getElementById('audiobooksSearch');
    const searchBtn = document.getElementById('audiobooksSearchBtn');
    const loadMoreBtn = document.getElementById('audiobooksLoadMoreBtn');

    searchBtn.addEventListener('click', () => {
        performAudiobooksSearch(searchInput.value);
    });

    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            performAudiobooksSearch(searchInput.value);
        }
    });

    loadMoreBtn.addEventListener('click', () => {
        loadMoreAudiobooks();
    });
}

// Fetch all audiobooks
async function fetchAllAudiobooks() {
    try {
        const res = await fetch(`${AUDIOBOOKS_API}/api/audiobooks/all`);
        const data = await res.json();
        if (data.success) return data.data || [];
        return [];
    } catch (e) {
        console.error('[Audiobooks] Fetch all failed:', e);
        return [];
    }
}

// Fetch more audiobooks
async function fetchMoreAudiobooks(page) {
    try {
        const res = await fetch(`${AUDIOBOOKS_API}/api/audiobooks/more/${page}`);
        const data = await res.json();
        if (data.success) return data.data || [];
        return [];
    } catch (e) {
        console.error('[Audiobooks] Fetch more failed:', e);
        return [];
    }
}

// Search audiobooks
async function searchAudiobooks(query) {
    try {
        const res = await fetch(`${AUDIOBOOKS_API}/api/audiobooks/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (data.success) return data.data || [];
        return [];
    } catch (e) {
        console.error('[Audiobooks] Search failed:', e);
        return [];
    }
}

// Perform Search
async function performAudiobooksSearch(query) {
    if (!query.trim()) {
        currentAudiobooksPage = 1;
        hasMoreAudiobooks = true;
        isAudiobooksSearchMode = false;
        document.getElementById('audiobooksGrid').innerHTML = '';
        document.getElementById('audiobooksLoadMore').style.display = 'none';
        loadAudiobooks();
        return;
    }

    isLoadingAudiobooks = true;
    isAudiobooksSearchMode = true;
    hasMoreAudiobooks = false;
    document.getElementById('audiobooksGrid').innerHTML = '';
    document.getElementById('audiobooksLoader').style.display = 'flex';
    document.getElementById('audiobooksLoadMore').style.display = 'none';

    try {
        const results = await searchAudiobooks(query);
        if (results.length === 0) {
            document.getElementById('audiobooksGrid').innerHTML = '<p class="no-results">No audiobooks found matching your search.</p>';
        } else {
            renderAudiobooks(results);
        }
    } catch (error) {
        console.error('Error searching audiobooks:', error);
        document.getElementById('audiobooksGrid').innerHTML = '<p class="no-results">Error performing search.</p>';
    } finally {
        isLoadingAudiobooks = false;
        document.getElementById('audiobooksLoader').style.display = 'none';
    }
}

// Remove infinite scroll setup
// setupAudiobooksInfiniteScroll function removed

// Load Audiobooks
async function loadAudiobooks() {
    if (isLoadingAudiobooks || !hasMoreAudiobooks || isAudiobooksSearchMode) return;
    
    isLoadingAudiobooks = true;
    document.getElementById('audiobooksLoader').style.display = 'flex';

    try {
        let audiobooks;
        if (currentAudiobooksPage === 1) {
            // First load - get initial batch
            audiobooks = await fetchAllAudiobooks();
        } else {
            // Subsequent loads - get more pages
            audiobooks = await fetchMoreAudiobooks(currentAudiobooksPage);
        }

        if (audiobooks.length === 0) {
            hasMoreAudiobooks = false;
            document.getElementById('audiobooksLoadMore').style.display = 'none';
        } else {
            renderAudiobooks(audiobooks);
            currentAudiobooksPage++;
            // Show load more button if we got results
            if (!isAudiobooksSearchMode) {
                document.getElementById('audiobooksLoadMore').style.display = 'flex';
            }
        }
    } catch (error) {
        console.error('Error loading audiobooks:', error);
    } finally {
        isLoadingAudiobooks = false;
        document.getElementById('audiobooksLoader').style.display = 'none';
    }
}

// Load More Button Handler
async function loadMoreAudiobooks() {
    if (isAudiobooksSearchMode) return;
    
    const btn = document.getElementById('audiobooksLoadMoreBtn');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner" style="width: 20px; height: 20px; border-width: 2px;"></div> Loading...';
    
    await loadAudiobooks();
    
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg> Load More';
}

// Render Audiobooks
function renderAudiobooks(audiobooks) {
    const grid = document.getElementById('audiobooksGrid');
    const filteredAudiobooks = audiobooks.filter(ab => !shouldFilterAudiobook(ab));
    
    filteredAudiobooks.forEach(audiobook => {
        const card = document.createElement('div');
        card.className = 'audiobook-card';
        
        card.innerHTML = `
            <div class="audiobook-poster">
                <img src="${audiobook.image || ''}" alt="${audiobook.title}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%231f2937%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 fill=%22%236b7280%22 font-size=%2210%22>No Cover</text></svg>'">
                <div class="audiobook-overlay"></div>
                <div class="audiobook-badge">
                    <div class="badge-content">
                        <div class="badge-icon">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 3v9.28c-.47-.17-.97-.28-1.5-.28C8.01 12 6 14.01 6 16.5S8.01 21 10.5 21c2.31 0 4.2-1.75 4.45-4H15V6h4V3h-7zm-1.5 16c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                            </svg>
                        </div>
                        <span class="badge-title">PlayTorrio</span>
                        <span class="badge-subtitle">Audiobooks</span>
                    </div>
                </div>
            </div>
            <div class="audiobook-info">
                <h3 class="audiobook-title">${audiobook.title}</h3>
            </div>
        `;
        
        card.addEventListener('click', () => openAudiobookModal(audiobook));
        grid.appendChild(card);
    });
}

// Fetch chapters
async function fetchChapters(postName) {
    try {
        const res = await fetch(`${AUDIOBOOKS_API}/api/audiobooks/chapters/${postName}`);
        const data = await res.json();
        if (data.success) return data.data || [];
        return [];
    } catch (e) {
        console.error('[Audiobooks] Fetch chapters failed:', e);
        return [];
    }
}

// Open Audiobook Modal
async function openAudiobookModal(audiobook) {
    currentAudiobook = audiobook;
    
    let modal = document.getElementById('audiobookModal');
    if (!modal) {
        createAudiobookModal();
        modal = document.getElementById('audiobookModal');
    }
    
    document.getElementById('modalAudiobookPoster').src = audiobook.image || '';
    document.getElementById('modalAudiobookTitle').textContent = audiobook.title;
    document.getElementById('modalChaptersList').innerHTML = '<div class="spinner"></div>';
    
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    try {
        const chapters = await fetchChapters(audiobook.post_name);
        renderAudiobookChapters(chapters);
    } catch (error) {
        console.error('Error loading chapters:', error);
        document.getElementById('modalChaptersList').innerHTML = '<p>Error loading chapters.</p>';
    }
}

// Create Audiobook Modal
function createAudiobookModal() {
    const modal = document.createElement('div');
    modal.id = 'audiobookModal';
    modal.className = 'audiobook-modal';
    modal.innerHTML = `
        <div class="audiobook-modal-content">
            <button class="audiobook-modal-close" id="closeAudiobookModal">×</button>
            <div class="audiobook-modal-header">
                <img id="modalAudiobookPoster" class="modal-poster" src="" alt="">
                <div class="modal-info">
                    <h2 id="modalAudiobookTitle"></h2>
                </div>
            </div>
            <div class="chapters-container">
                <h3>Chapters</h3>
                <div class="chapters-list" id="modalChaptersList"></div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('closeAudiobookModal').addEventListener('click', () => {
        modal.classList.remove('active');
        document.body.style.overflow = 'auto';
    });
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('active');
            document.body.style.overflow = 'auto';
        }
    });
}

// Render Audiobook Chapters
function renderAudiobookChapters(chapters) {
    const list = document.getElementById('modalChaptersList');
    if (!list) {
        console.error('[Audiobooks] modalChaptersList element not found!');
        return;
    }
    
    list.innerHTML = '';
    
    console.log('[Audiobooks] Total chapters received:', chapters.length);
    
    const filteredChapters = chapters.filter(ch => !(ch.name === 'welcome' && ch.chapter_id === '0'));
    
    console.log('[Audiobooks] Filtered chapters:', filteredChapters.length);
    
    if (filteredChapters.length === 0) {
        list.innerHTML = '<p class="no-results">No chapters available</p>';
        return;
    }
    
    filteredChapters.forEach((chapter, index) => {
        const item = document.createElement('div');
        item.className = 'chapter-item';
        
        // Display the chapter name prominently, duration is secondary
        const chapterName = chapter.name || `Chapter ${chapter.track || index + 1}`;
        const chapterDuration = chapter.duration && chapter.duration !== 'Unknown' ? chapter.duration : '';
        
        console.log(`[Audiobooks] Rendering chapter ${index + 1}:`, chapterName);
        
        item.innerHTML = `
            <div class="chapter-number">${chapter.track || index + 1}</div>
            <div class="chapter-name">${chapterName}</div>
            ${chapterDuration ? `<div class="chapter-duration">${chapterDuration}</div>` : ''}
        `;
        item.addEventListener('click', () => playAudiobookChapter(chapter));
        list.appendChild(item);
    });
    
    console.log('[Audiobooks] Finished rendering chapters. List innerHTML length:', list.innerHTML.length);
}

// Get stream URL
async function getStreamUrl(chapterId, serverType = 1) {
    try {
        const res = await fetch(`${AUDIOBOOKS_API}/api/audiobooks/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chapterId, serverType })
        });
        const data = await res.json();
        if (data.success && data.data) return data.data;
        return null;
    } catch (e) {
        console.error('[Audiobooks] Get stream failed:', e);
        return null;
    }
}

// Play Audiobook Chapter
async function playAudiobookChapter(chapter) {
    currentChapter = chapter;
    
    let player = document.getElementById('audiobookPlayer');
    if (!player) {
        createAudiobookPlayer();
        player = document.getElementById('audiobookPlayer');
    }

    document.getElementById('playerAudiobookTitle').textContent = currentAudiobook?.title || 'Audiobook';
    document.getElementById('playerChapterName').textContent = chapter.name || `Chapter ${chapter.track}`;
    document.getElementById('playerAudiobookCover').src = currentAudiobook?.image || '';
    
    player.classList.add('active');
    document.getElementById('audiobookModal').classList.remove('active');
    
    const audioElement = document.getElementById('audiobookAudio');
    audioElement.pause();
    
    document.getElementById('playerCurrentTime').textContent = '0:00';
    document.getElementById('playerDuration').textContent = '0:00';
    document.getElementById('playerProgress').style.width = '0%';
    
    const streamData = await getStreamUrl(chapter.chapter_id);
    if (!streamData || !streamData.link_mp3) {
        alert('Failed to get audio stream');
        return;
    }
    
    currentStreamUrl = streamData.link_mp3;
    audioElement.src = currentStreamUrl;
    audioElement.load();
    
    audioElement.addEventListener('canplay', () => {
        audioElement.play();
        updatePlayPauseIcon(true);
    }, { once: true });
    
    audioElement.addEventListener('loadedmetadata', () => {
        document.getElementById('playerDuration').textContent = formatDuration(audioElement.duration);
    }, { once: true });
}

// Create Audiobook Player
function createAudiobookPlayer() {
    const player = document.createElement('div');
    player.id = 'audiobookPlayer';
    player.className = 'audiobook-player';
    player.innerHTML = `
        <div class="player-content">
            <button class="player-close" id="playerCloseBtn">×</button>
            <div class="player-cover-container">
                <img id="playerAudiobookCover" class="player-cover" src="" alt="">
            </div>
            <div class="player-info">
                <h2 id="playerAudiobookTitle"></h2>
                <p id="playerChapterName"></p>
            </div>
            <div class="player-progress-container">
                <div class="player-progress-bar" id="playerProgressBar">
                    <div class="player-progress" id="playerProgress"></div>
                </div>
                <div class="player-time">
                    <span id="playerCurrentTime">0:00</span>
                    <span id="playerDuration">0:00</span>
                </div>
            </div>
            <div class="player-controls">
                <button class="player-btn" id="playerRewind" title="Rewind 10s">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/></svg>
                </button>
                <button class="player-btn player-btn-large" id="playerPlayPause" title="Play/Pause">
                    <svg id="playerPlayIcon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    <svg id="playerPauseIcon" viewBox="0 0 24 24" fill="currentColor" style="display:none;"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                </button>
                <button class="player-btn" id="playerForward" title="Forward 10s">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/></svg>
                </button>
            </div>
            <div class="player-volume-container">
                <button class="player-btn player-btn-small" id="playerMute" title="Mute/Unmute">
                    <svg id="playerVolumeIcon" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
                    <svg id="playerMutedIcon" viewBox="0 0 24 24" fill="currentColor" style="display:none;"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>
                </button>
                <input type="range" id="playerVolume" class="player-volume-slider" min="0" max="100" value="100" title="Volume">
            </div>
            <div class="player-options">
                <select id="playerSpeed" class="player-speed" title="Playback Speed">
                    <option value="0.5">0.5x</option>
                    <option value="0.75">0.75x</option>
                    <option value="1" selected>1x</option>
                    <option value="1.25">1.25x</option>
                    <option value="1.5">1.5x</option>
                    <option value="2">2x</option>
                </select>
                <button class="player-btn player-btn-small" id="playerDownload" title="Download">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2z"/></svg>
                </button>
            </div>
        </div>
        <audio id="audiobookAudio" preload="metadata"></audio>
    `;
    document.body.appendChild(player);

    initPlayerControls();
}

// Format Duration
function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Update Play/Pause Icon
function updatePlayPauseIcon(isPlaying) {
    const playIcon = document.getElementById('playerPlayIcon');
    const pauseIcon = document.getElementById('playerPauseIcon');
    if (isPlaying) {
        playIcon.style.display = 'none';
        pauseIcon.style.display = 'block';
    } else {
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
    }
}

// Initialize Player Controls
function initPlayerControls() {
    const audioElement = document.getElementById('audiobookAudio');
    const playerPlayPause = document.getElementById('playerPlayPause');
    const playerRewind = document.getElementById('playerRewind');
    const playerForward = document.getElementById('playerForward');
    const playerSpeed = document.getElementById('playerSpeed');
    const playerDownload = document.getElementById('playerDownload');
    const playerProgressBar = document.getElementById('playerProgressBar');
    const playerCloseBtn = document.getElementById('playerCloseBtn');
    const playerMute = document.getElementById('playerMute');
    const playerVolume = document.getElementById('playerVolume');
    const playerVolumeIcon = document.getElementById('playerVolumeIcon');
    const playerMutedIcon = document.getElementById('playerMutedIcon');

    playerPlayPause.addEventListener('click', () => {
        if (audioElement.paused) {
            audioElement.play();
            updatePlayPauseIcon(true);
        } else {
            audioElement.pause();
            updatePlayPauseIcon(false);
        }
    });

    playerRewind.addEventListener('click', () => {
        audioElement.currentTime = Math.max(0, audioElement.currentTime - 10);
    });

    playerForward.addEventListener('click', () => {
        audioElement.currentTime = Math.min(audioElement.duration, audioElement.currentTime + 10);
    });

    playerSpeed.addEventListener('change', () => {
        audioElement.playbackRate = parseFloat(playerSpeed.value);
    });

    // Volume controls
    playerMute.addEventListener('click', () => {
        if (audioElement.muted) {
            audioElement.muted = false;
            playerVolumeIcon.style.display = 'block';
            playerMutedIcon.style.display = 'none';
            playerVolume.value = audioElement.volume * 100;
        } else {
            audioElement.muted = true;
            playerVolumeIcon.style.display = 'none';
            playerMutedIcon.style.display = 'block';
        }
    });

    playerVolume.addEventListener('input', (e) => {
        const volume = e.target.value / 100;
        audioElement.volume = volume;
        audioElement.muted = false;
        
        if (volume === 0) {
            playerVolumeIcon.style.display = 'none';
            playerMutedIcon.style.display = 'block';
        } else {
            playerVolumeIcon.style.display = 'block';
            playerMutedIcon.style.display = 'none';
        }
    });

    playerDownload.addEventListener('click', () => {
        if (currentStreamUrl) {
            if (window.electronAPI?.openExternal) {
                window.electronAPI.openExternal(currentStreamUrl);
            } else {
                window.open(currentStreamUrl, '_blank');
            }
        }
    });

    playerProgressBar.addEventListener('click', (e) => {
        const rect = playerProgressBar.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        audioElement.currentTime = percent * audioElement.duration;
    });

    audioElement.addEventListener('timeupdate', () => {
        if (!audioElement.duration) return;
        const percent = (audioElement.currentTime / audioElement.duration) * 100;
        document.getElementById('playerProgress').style.width = `${percent}%`;
        document.getElementById('playerCurrentTime').textContent = formatDuration(audioElement.currentTime);
    });

    audioElement.addEventListener('ended', () => {
        updatePlayPauseIcon(false);
    });

    playerCloseBtn.addEventListener('click', () => {
        audioElement.pause();
        audioElement.src = '';
        document.getElementById('audiobookPlayer').classList.remove('active');
        document.body.style.overflow = 'auto';
    });
}
