// Media Downloader Functionality
let currentDownloaderSource = '111477'; // '111477' or 'acermovies'
let isLoadingDownloader = false;

const DOWNLOADER_API_BASE = 'http://localhost:6987';
const TMDB_API_KEY = 'c3515fdc674ea2bd7b514f4bc3616a4a';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// Show Media Downloader Page
function showMediaDownloaderPage() {
    hideAllSections();

    let downloaderSection = document.getElementById('downloaderSection');
    if (!downloaderSection) {
        createDownloaderSection();
    } else {
        downloaderSection.style.setProperty('display', 'block', 'important');
    }
}

// Create Downloader Section Structure
function createDownloaderSection() {
    const mainContent = document.getElementById('mainContent');
    const section = document.createElement('div');
    section.id = 'downloaderSection';
    section.className = 'downloader-section';
    section.innerHTML = `
        <div class="downloader-header">
            <div class="downloader-controls-top">
                <div class="downloader-source-selector">
                    <button class="source-btn active" data-source="111477">111477</button>
                    <button class="source-btn" data-source="acermovies">AcerMovies</button>
                </div>
                <div class="search-container-downloader">
                    <input type="text" id="downloaderSearch" placeholder="Search movies or TV shows...">
                    <button id="downloaderSearchBtn">
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
                    </button>
                </div>
            </div>
            <div id="downloaderSubControls" class="downloader-sub-controls"></div>
        </div>
        <div class="downloader-results" id="downloaderResults"></div>
        <div class="downloader-loader" id="downloaderLoader" style="display: none;">
            <div class="spinner"></div>
        </div>
    `;
    mainContent.appendChild(section);

    // Event Listeners for Sources
    section.querySelectorAll('.source-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('active')) return;
            
            section.querySelectorAll('.source-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            currentDownloaderSource = btn.dataset.source;
            document.getElementById('downloaderResults').innerHTML = '';
            document.getElementById('downloaderSubControls').innerHTML = '';
        });
    });

    // Search
    const searchInput = document.getElementById('downloaderSearch');
    const searchBtn = document.getElementById('downloaderSearchBtn');
    
    const triggerSearch = () => {
        const query = searchInput.value.trim();
        if (query) {
            performDownloaderSearch(query);
        }
    };

    searchBtn.addEventListener('click', triggerSearch);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') triggerSearch();
    });
}

// Perform Search based on source
async function performDownloaderSearch(query) {
    if (isLoadingDownloader) return;
    isLoadingDownloader = true;
    document.getElementById('downloaderLoader').style.display = 'flex';
    document.getElementById('downloaderResults').innerHTML = '';
    document.getElementById('downloaderSubControls').innerHTML = '';

    try {
        if (currentDownloaderSource === '111477') {
            await search111477(query);
        } else {
            await searchAcerMovies(query);
        }
    } catch (error) {
        console.error('Search error:', error);
        document.getElementById('downloaderResults').innerHTML = '<p class="no-results">Error performing search.</p>';
    } finally {
        isLoadingDownloader = false;
        document.getElementById('downloaderLoader').style.display = 'none';
    }
}

// 111477 Search (using TMDB)
async function search111477(query) {
    const response = await fetch(`${TMDB_BASE_URL}/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}`);
    const data = await response.json();
    
    if (data.results && data.results.length > 0) {
        render111477Results(data.results);
    } else {
        document.getElementById('downloaderResults').innerHTML = '<p class="no-results">No results found on TMDB.</p>';
    }
}

function render111477Results(results) {
    const container = document.getElementById('downloaderResults');
    results.forEach(item => {
        if (item.media_type !== 'movie' && item.media_type !== 'tv') return;

        const card = document.createElement('div');
        card.className = 'downloader-card';
        const poster = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://via.placeholder.com/500x750?text=No+Poster';
        const title = item.title || item.name;
        const year = (item.release_date || item.first_air_date || '').split('-')[0];

        card.innerHTML = `
            <div class="downloader-card-poster">
                <img src="${poster}" alt="${title}">
            </div>
            <div class="downloader-card-info">
                <h3 class="downloader-card-title">${title}</h3>
                <p class="downloader-card-meta">${item.media_type.toUpperCase()} • ${year}</p>
            </div>
        `;

        card.addEventListener('click', () => {
            show111477Modal(item);
        });

        container.appendChild(card);
    });
}

function show111477Modal(item) {
    let modal = document.getElementById('downloaderModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'downloaderModal';
        modal.className = 'downloader-modal';
        document.body.appendChild(modal);
    }

    const title = item.title || item.name;
    const poster = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://via.placeholder.com/500x750?text=No+Poster';

    modal.innerHTML = `
        <div class="downloader-modal-content">
            <button class="downloader-modal-close">×</button>
            <div class="modal-header-info">
                <img src="${poster}" class="modal-poster-mini">
                <div class="modal-title-area">
                    <h2>${title}</h2>
                    <p class="downloader-card-meta">${item.media_type.toUpperCase()}</p>
                </div>
            </div>
            <div id="modalContentArea">
                ${item.media_type === 'tv' ? `
                    <div class="tv-selector-pretty">
                        <div class="selector-row">
                            <div class="input-group">
                                <label>Season</label>
                                <input type="number" id="seasonInput" value="1" min="1">
                            </div>
                            <div class="input-group">
                                <label>Episode</label>
                                <input type="number" id="episodeInput" value="1" min="1">
                            </div>
                        </div>
                        <button class="fetch-btn-large" id="fetchEpisodeBtn">Fetch Episode</button>
                    </div>
                ` : `
                    <button class="fetch-btn-large" id="fetchMovieBtn">Fetch Movie Links</button>
                `}
                <div id="modalLinksResults" class="modal-links-container"></div>
            </div>
        </div>
    `;

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    modal.querySelector('.downloader-modal-close').onclick = () => {
        modal.classList.remove('active');
        document.body.style.overflow = 'auto';
    };

    if (item.media_type === 'tv') {
        document.getElementById('fetchEpisodeBtn').onclick = () => {
            const s = document.getElementById('seasonInput').value;
            const e = document.getElementById('episodeInput').value;
            fetch111477DownloadLinks('tv', item.id, s, e);
        };
    } else {
        document.getElementById('fetchMovieBtn').onclick = () => {
            fetch111477DownloadLinks('movie', item.id);
        };
    }
}

async function fetch111477DownloadLinks(type, id, season, episode) {
    const resultsContainer = document.getElementById('modalLinksResults');
    resultsContainer.innerHTML = '<div class="downloader-loader"><div class="spinner"></div></div>';
    
    let url = `${DOWNLOADER_API_BASE}/111477/api/tmdb/${type}/${id}`;
    if (type === 'tv') {
        url += `/season/${season}/episode/${episode}`;
    }

    try {
        const response = await fetch(url);
        const data = await response.json();
        render111477ModalLinks(data);
    } catch (error) {
        console.error('Error fetching links:', error);
        resultsContainer.innerHTML = '<p class="no-results">Error fetching download links.</p>';
    }
}

function render111477ModalLinks(data) {
    const container = document.getElementById('modalLinksResults');
    container.innerHTML = '<h3>Links Found</h3>';

    if (!data.success || !data.results || data.results.length === 0) {
        container.innerHTML += '<p class="no-results">No links found for this selection.</p>';
        return;
    }

    data.results.forEach(result => {
        if (!result.files || result.files.length === 0) return;

        result.files.forEach(file => {
            const linkItem = document.createElement('div');
            linkItem.className = 'download-link-item';
            linkItem.style.gridColumn = 'auto'; // Reset for modal
            linkItem.innerHTML = `
                <div class="link-info">
                    <span class="file-name">${file.name}</span>
                    <span class="file-size">${file.sizeFormatted || ''}</span>
                </div>
                <button class="download-btn">Download</button>
            `;
            
            const downloadBtn = linkItem.querySelector('.download-btn');
            downloadBtn.addEventListener('click', () => {
                if (window.electronAPI?.openExternal) {
                    window.electronAPI.openExternal(file.url);
                } else {
                    window.open(file.url, '_blank');
                }
            });
            
            container.appendChild(linkItem);
        });
    });
}

// AcerMovies Search
async function searchAcerMovies(query) {
    const response = await fetch(`${DOWNLOADER_API_BASE}/api/acermovies/search/${encodeURIComponent(query)}`);
    const data = await response.json();
    
    if (data.searchResult && data.searchResult.length > 0) {
        renderAcerMoviesResults(data.searchResult);
    } else {
        document.getElementById('downloaderResults').innerHTML = '<p class="no-results">No results found on AcerMovies.</p>';
    }
}

function renderAcerMoviesResults(results) {
    const container = document.getElementById('downloaderResults');
    results.forEach(item => {
        const card = document.createElement('div');
        card.className = 'downloader-card';
        card.innerHTML = `
            <div class="downloader-card-poster">
                <img src="${item.image}" alt="${item.title}">
            </div>
            <div class="downloader-card-info">
                <h3 class="downloader-card-title">${item.title}</h3>
            </div>
        `;

        card.addEventListener('click', () => fetchAcerMoviesQualities(item.url));
        container.appendChild(card);
    });
}

async function fetchAcerMoviesQualities(url) {
    document.getElementById('downloaderLoader').style.display = 'flex';
    try {
        const response = await fetch(`${DOWNLOADER_API_BASE}/api/acermovies/sourceQuality?url=${encodeURIComponent(url)}`);
        const data = await response.json();
        renderAcerMoviesQualities(data.sourceQualityList, data.meta ? data.meta.type : 'movie');
    } catch (error) {
        console.error('Error fetching qualities:', error);
    } finally {
        document.getElementById('downloaderLoader').style.display = 'none';
    }
}

function renderAcerMoviesQualities(qualities, type) {
    const container = document.getElementById('downloaderResults');
    container.innerHTML = '<div class="results-header"><button class="back-btn" onclick="document.getElementById(\'downloaderSearchBtn\').click()">← Back to Results</button><h3>Available Qualities</h3></div>';

    qualities.forEach(q => {
        const item = document.createElement('div');
        item.className = 'quality-item';
        item.innerHTML = `
            <div class="quality-info">
                <h4>${q.title}</h4>
                <span class="quality-badge">${q.quality || ''}</span>
            </div>
        `;
        
        const actions = document.createElement('div');
        actions.className = 'quality-actions';

        if (q.batchUrl && q.episodesUrl) {
            const batchBtn = document.createElement('button');
            batchBtn.className = 'action-btn secondary';
            batchBtn.textContent = 'Season Packs';
            batchBtn.onclick = (e) => getAcerMoviesDownloadUrl(q.batchUrl, 'batch', e.target);
            
            const episodesBtn = document.createElement('button');
            episodesBtn.className = 'action-btn primary';
            episodesBtn.textContent = 'Episodes';
            episodesBtn.onclick = () => fetchAcerMoviesEpisodes(q.episodesUrl);
            
            actions.appendChild(batchBtn);
            actions.appendChild(episodesBtn);
        } else if (q.batchUrl) {
            const batchBtn = document.createElement('button');
            batchBtn.className = 'action-btn primary';
            batchBtn.textContent = 'Season Pack';
            batchBtn.onclick = (e) => getAcerMoviesDownloadUrl(q.batchUrl, 'batch', e.target);
            actions.appendChild(batchBtn);
        } else if (q.episodesUrl) {
            const episodesBtn = document.createElement('button');
            episodesBtn.className = 'action-btn primary';
            episodesBtn.textContent = 'Episodes';
            episodesBtn.onclick = () => fetchAcerMoviesEpisodes(q.episodesUrl);
            actions.appendChild(episodesBtn);
        } else if (q.url) {
            const downloadBtn = document.createElement('button');
            downloadBtn.className = 'action-btn primary';
            downloadBtn.textContent = 'Download';
            downloadBtn.onclick = (e) => getAcerMoviesDownloadUrl(q.url, type, e.target);
            actions.appendChild(downloadBtn);
        }

        item.appendChild(actions);
        container.appendChild(item);
    });
}

async function fetchAcerMoviesEpisodes(url) {
    document.getElementById('downloaderLoader').style.display = 'flex';
    try {
        const response = await fetch(`${DOWNLOADER_API_BASE}/api/acermovies/sourceEpisodes?url=${encodeURIComponent(url)}`);
        const data = await response.json();
        renderAcerMoviesEpisodes(data.sourceEpisodes);
    } catch (error) {
        console.error('Error fetching episodes:', error);
    } finally {
        document.getElementById('downloaderLoader').style.display = 'none';
    }
}

function renderAcerMoviesEpisodes(episodes) {
    const container = document.getElementById('downloaderResults');
    container.innerHTML = '<div class="results-header"><button class="back-btn" onclick="document.getElementById(\'downloaderSearchBtn\').click()">← Back to Results</button><h3>Episodes</h3></div>';
    
    episodes.forEach(ep => {
        const item = document.createElement('div');
        item.className = 'episode-download-item';
        item.innerHTML = `
            <span>${ep.title}</span>
            <button class="action-btn primary" onclick="getAcerMoviesDownloadUrl('${ep.link}', 'episode', this)">Fetch Link</button>
        `;
        container.appendChild(item);
    });
}

async function getAcerMoviesDownloadUrl(url, type, button) {
    if (button.classList.contains('ready-to-download')) {
        const downloadUrl = button.dataset.downloadUrl;
        if (window.electronAPI?.openExternal) {
            window.electronAPI.openExternal(downloadUrl);
        } else {
            window.open(downloadUrl, '_blank');
        }
        return;
    }

    const originalText = button.textContent;
    button.textContent = 'Fetching...';
    button.disabled = true;

    try {
        const response = await fetch(`${DOWNLOADER_API_BASE}/api/acermovies/sourceUrl?url=${encodeURIComponent(url)}&seriesType=${type}`);
        const data = await response.json();
        if (data.sourceUrl) {
            button.textContent = 'Download Ready';
            button.dataset.downloadUrl = data.sourceUrl;
            button.classList.add('ready-to-download');
            button.disabled = false;
        } else {
            button.textContent = originalText;
            button.disabled = false;
            alert('Could not find download URL');
        }
    } catch (error) {
        console.error('Error getting download URL:', error);
        button.textContent = originalText;
        button.disabled = false;
    }
}
