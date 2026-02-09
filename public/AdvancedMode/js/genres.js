// Genres Page Functionality

// Genre Styling and Icons
const genreIcons = {
    28: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`, // Action
    12: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`, // Adventure
    16: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.5 1.5"/><path d="M7 11l-4-4"/></svg>`, // Animation
    35: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>`, // Comedy
    80: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`, // Crime
    99: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`, // Documentary
    18: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21c-4.418 0-8-3.582-8-8s3.582-8 8-8 8 3.582 8 8-3.582 8-8 8z"/><path d="M12 14c-1.657 0-3-1.343-3-3s1.343-3 3-3 3 1.343 3 3-1.343 3-3 3z"/><path d="M7 21l3-4"/><path d="M17 21l-3-4"/></svg>`, // Drama
    10751: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`, // Family
    14: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`, // Fantasy
    36: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`, // History
    27: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 10L9.01 10"/><path d="M15 10L15.01 10"/><path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z"/></svg>`, // Horror
    10402: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`, // Music
    9648: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`, // Mystery
    10749: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`, // Romance
    878: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 2.67-2 3.5 0 1.1.9 2 2 2 .83 0 2.24-.5 3.5-2"/><path d="M12 14c4 0 7.5-3 7.5-7.5S16.5 2 12 2 4.5 2.5 4.5 7s3 7.5 7.5 7.5z"/><path d="M16.5 4.5c1.26-1.5 2.67-2 3.5-2 1.1 0 2 .9 2 2 0 .83-.5 2.24-2 3.5"/></svg>`, // Science Fiction
    10770: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg>`, // TV Movie
    53: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`, // Thriller
    10752: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v7"/><path d="M16 2v7"/><path d="M20 9H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V11a2 2 0 0 0-2-2z"/></svg>`, // War
    37: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h18v18H3z"/><path d="M9 9l6 6"/><path d="M15 9l-6 6"/></svg>`, // Western
    10759: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`, // Action & Adventure (TV)
    10762: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>`, // Kids
    10763: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h10l4 4v10a2 2 0 0 1-2 2z"/><polyline points="14 4 14 8 18 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>`, // News
    10764: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>`, // Reality
    10765: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/></svg>`, // Sci-Fi & Fantasy (TV)
    10766: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 11V7a5 5 0 0 1 10 0v4"/><rect x="3" y="11" width="18" height="11" rx="2"/></svg>`, // Soap
    10767: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>`, // Talk
    10768: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 22v-4"/><path d="M12 6V2"/><path d="M22 12h-4"/><path d="M6 12H2"/></svg>` // War & Politics
};

const genreStyles = {
    28: { gradient: 'linear-gradient(135deg, #ff416c 0%, #ff4b2b 100%)' }, // Action
    12: { gradient: 'linear-gradient(135deg, #f7971e 0%, #ffd200 100%)' }, // Adventure
    16: { gradient: 'linear-gradient(135deg, #00b09b 0%, #96c93d 100%)' }, // Animation
    35: { gradient: 'linear-gradient(135deg, #f12711 0%, #f5af19 100%)' }, // Comedy
    80: { gradient: 'linear-gradient(135deg, #373b44 0%, #4286f4 100%)' }, // Crime
    99: { gradient: 'linear-gradient(135deg, #1d976c 0%, #93f9b9 100%)' }, // Documentary
    18: { gradient: 'linear-gradient(135deg, #8e2de2 0%, #4a00e0 100%)' }, // Drama
    10751: { gradient: 'linear-gradient(135deg, #00c6ff 0%, #0072ff 100%)' }, // Family
    14: { gradient: 'linear-gradient(135deg, #da22ff 0%, #9733ee 100%)' }, // Fantasy
    36: { gradient: 'linear-gradient(135deg, #e65c00 0%, #f9d423 100%)' }, // History
    27: { gradient: 'linear-gradient(135deg, #000000 0%, #434343 100%)' }, // Horror
    10402: { gradient: 'linear-gradient(135deg, #ee0979 0%, #ff6a00 100%)' }, // Music
    9648: { gradient: 'linear-gradient(135deg, #4b6cb7 0%, #182848 100%)' }, // Mystery
    10749: { gradient: 'linear-gradient(135deg, #ff00cc 0%, #3333ff 100%)' }, // Romance
    878: { gradient: 'linear-gradient(135deg, #0575e6 0%, #021b79 100%)' }, // Science Fiction
    10770: { gradient: 'linear-gradient(135deg, #7474bf 0%, #348ac7 100%)' }, // TV Movie
    53: { gradient: 'linear-gradient(135deg, #134e5e 0%, #71b280 100%)' }, // Thriller
    10752: { gradient: 'linear-gradient(135deg, #2c3e50 0%, #000000 100%)' }, // War
    37: { gradient: 'linear-gradient(135deg, #4b6cb7 0%, #182848 100%)' }, // Western
    10759: { gradient: 'linear-gradient(135deg, #ff416c 0%, #ff4b2b 100%)' }, // Action & Adventure (TV)
    10762: { gradient: 'linear-gradient(135deg, #00c6ff 0%, #0072ff 100%)' }, // Kids
    10763: { gradient: 'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)' }, // News
    10764: { gradient: 'linear-gradient(135deg, #f12711 0%, #f5af19 100%)' }, // Reality
    10765: { gradient: 'linear-gradient(135deg, #da22ff 0%, #9733ee 100%)' }, // Sci-Fi & Fantasy (TV)
    10766: { gradient: 'linear-gradient(135deg, #ee0979 0%, #ff6a00 100%)' }, // Soap
    10767: { gradient: 'linear-gradient(135deg, #4b6cb7 0%, #182848 100%)' }, // Talk
    10768: { gradient: 'linear-gradient(135deg, #2c3e50 0%, #000000 100%)' }  // War & Politics
};

const defaultStyle = { gradient: 'linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%)' };
const defaultIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`;

// All genres from TMDB
const allGenres = {
    movie: [
        { id: 28, name: 'Action' },
        { id: 12, name: 'Adventure' },
        { id: 16, name: 'Animation' },
        { id: 35, name: 'Comedy' },
        { id: 80, name: 'Crime' },
        { id: 99, name: 'Documentary' },
        { id: 18, name: 'Drama' },
        { id: 10751, name: 'Family' },
        { id: 14, name: 'Fantasy' },
        { id: 36, name: 'History' },
        { id: 27, name: 'Horror' },
        { id: 10402, name: 'Music' },
        { id: 9648, name: 'Mystery' },
        { id: 10749, name: 'Romance' },
        { id: 878, name: 'Science Fiction' },
        { id: 10770, name: 'TV Movie' },
        { id: 53, name: 'Thriller' },
        { id: 10752, name: 'War' },
        { id: 37, name: 'Western' }
    ],
    tv: [
        { id: 10759, name: 'Action & Adventure' },
        { id: 16, name: 'Animation' },
        { id: 35, name: 'Comedy' },
        { id: 80, name: 'Crime' },
        { id: 99, name: 'Documentary' },
        { id: 18, name: 'Drama' },
        { id: 10751, name: 'Family' },
        { id: 10762, name: 'Kids' },
        { id: 9648, name: 'Mystery' },
        { id: 10763, name: 'News' },
        { id: 10764, name: 'Reality' },
        { id: 10765, name: 'Sci-Fi & Fantasy' },
        { id: 10766, name: 'Soap' },
        { id: 10767, name: 'Talk' },
        { id: 10768, name: 'War & Politics' },
        { id: 37, name: 'Western' }
    ]
};

// Combine and deduplicate genres
const combinedGenres = [...allGenres.movie];
allGenres.tv.forEach(tvGenre => {
    if (!combinedGenres.find(g => g.id === tvGenre.id)) {
        combinedGenres.push(tvGenre);
    }
});

// State for genre browsing
let currentGenre = null;
let currentMediaType = 'all'; // all, movie, tv
let currentPage = 1;
let isLoading = false;
let hasMorePages = true;
let observer = null;

// Show genres page
function showGenresPage() {
    hideAllSections();
    
    // Check if genres page already exists
    let genresPage = document.getElementById('genresPageContainer');
    if (!genresPage) {
        genresPage = document.createElement('div');
        genresPage.id = 'genresPageContainer';
        genresPage.innerHTML = `
            <div class="genres-page">
                <div class="genres-header">
                    <button class="back-btn" id="backToHomeFromGenres" style="margin-bottom: 20px;">
                        <svg viewBox="0 0 24 24" fill="currentColor" style="width: 18px; height: 18px;">
                            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
                        </svg>
                        Back to Home
                    </button>
                    <h1 class="genres-title">Browse by Genre</h1>
                    <p class="genres-subtitle">Explore movies and TV shows by category</p>
                </div>
                <div class="genres-grid" id="genresGrid"></div>
            </div>
        `;
        document.getElementById('mainContent').appendChild(genresPage);
        
        // Add event listener for the new back button
        document.getElementById('backToHomeFromGenres').addEventListener('click', () => {
            // Clear hash
            if (window.location.hash) {
                history.pushState("", document.title, window.location.pathname + window.location.search);
            }
            showHomePage();
        });
        
        populateGenres();
    } else {
        genresPage.style.setProperty('display', 'block', 'important');
    }
    
    window.scrollTo(0, 0);
}

// Populate genres grid
function populateGenres() {
    const genresGrid = document.getElementById('genresGrid');
    genresGrid.innerHTML = '';
    
    combinedGenres.sort((a, b) => a.name.localeCompare(b.name)).forEach((genre, index) => {
        const style = genreStyles[genre.id] || defaultStyle;
        const icon = genreIcons[genre.id] || defaultIcon;
        const genreCard = document.createElement('div');
        genreCard.className = 'genre-card';
        genreCard.style.setProperty('--genre-gradient', style.gradient);
        genreCard.style.animation = `fadeInUp 0.5s ease-out ${index * 0.05}s both`;
        
        genreCard.innerHTML = `
            <div class="genre-card-bg" style="background: ${style.gradient}"></div>
            <div class="genre-card-content">
                <div class="genre-card-icon-wrapper">
                    ${icon}
                </div>
                <h3 class="genre-card-title">${genre.name}</h3>
                <div class="genre-card-indicator">
                    <span>Explore</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M5 12h14M12 5l7 7-7 7"/>
                    </svg>
                </div>
            </div>
        `;
        genreCard.addEventListener('click', () => showGenreBrowse(genre));
        genresGrid.appendChild(genreCard);
    });
}

// Show genre browse page
function showGenreBrowse(genre) {
    currentGenre = genre;
    currentMediaType = 'all';
    currentPage = 1;
    hasMorePages = true;
    isLoading = false;
    
    hideAllSections();
    
    // Check if browse page exists
    let browsePage = document.getElementById('genreBrowsePageContainer');
    if (!browsePage) {
        browsePage = document.createElement('div');
        browsePage.id = 'genreBrowsePageContainer';
        browsePage.innerHTML = `
            <div class="genre-browse-page">
                <div class="genre-browse-header">
                    <div class="genre-browse-title-section">
                        <button class="back-btn" id="backToGenres">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
                            </svg>
                            Back
                        </button>
                        <h1 class="genre-browse-title" id="genreBrowseTitle">${genre.name}</h1>
                    </div>
                    <div class="media-type-filters">
                        <button class="media-type-btn active" data-type="all">All</button>
                        <button class="media-type-btn" data-type="movie">Movies</button>
                        <button class="media-type-btn" data-type="tv">TV Shows</button>
                    </div>
                </div>
                <div class="genre-browse-results" id="genreBrowseResults"></div>
                <!-- Sentinel for Infinite Scroll -->
                <div id="scrollSentinel" style="height: 20px; width: 100%;"></div>
                <div class="loading-indicator" id="loadingIndicator" style="display: none;">
                    <div class="spinner"></div>
                    <p>Loading more...</p>
                </div>
            </div>
        `;
        document.getElementById('mainContent').appendChild(browsePage);
        initGenreBrowse();
    } else {
        browsePage.style.setProperty('display', 'block', 'important');
        document.getElementById('genreBrowseTitle').textContent = genre.name;
        document.getElementById('genreBrowseResults').innerHTML = '';
        document.querySelectorAll('.media-type-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.type === 'all');
        });
    }
    
    // Scroll to top
    window.scrollTo(0, 0);
    
    // Start scroll checking
    setupInfiniteScroll();
    
    // Load first 3 pages immediately to fill screen
    initialGenreLoad();
}

// Initialize genre browse page
function initGenreBrowse() {
    // Back button
    document.getElementById('backToGenres').addEventListener('click', () => {
        disconnectObserver();
        document.getElementById('genreBrowsePageContainer').style.display = 'none';
        window.scrollTo(0, 0);
        showGenresPage();
    });
    
    // Media type filters
    document.querySelectorAll('.media-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.media-type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentMediaType = btn.dataset.type;
            currentPage = 1;
            hasMorePages = true;
            isLoading = false;
            document.getElementById('genreBrowseResults').innerHTML = '';
            window.scrollTo(0, 0);
            loadGenreContent();
        });
    });
}

// Stop scroll checking when leaving genre browse
function cleanupGenreBrowse() {
    disconnectObserver();
}

// Setup Intersection Observer for infinite scroll
function setupInfiniteScroll() {
    disconnectObserver();
    
    const sentinel = document.getElementById('scrollSentinel');
    if (!sentinel) return;
    
    observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && !isLoading && hasMorePages) {
            console.log('👀 Sentinel visible, loading more...');
            loadGenreContent();
        }
    }, {
        root: null,
        rootMargin: '200px',
        threshold: 0.1
    });
    
    observer.observe(sentinel);
}

// Disconnect observer
function disconnectObserver() {
    if (observer) {
        observer.disconnect();
        observer = null;
    }
}

// Initial multi-page load
async function initialGenreLoad() {
    await loadGenreContent(); // Page 1
    if (hasMorePages) await loadGenreContent(); // Page 2
    if (hasMorePages) await loadGenreContent(); // Page 3
}

// Load genre content
async function loadGenreContent() {
    if (isLoading) {
        console.log('⏸️ Already loading, skipping...');
        return;
    }
    
    if (!hasMorePages) {
        console.log('⏸️ No more pages, skipping...');
        return;
    }
    
    console.log(`📥 Loading page ${currentPage} for ${currentGenre.name} (${currentMediaType})`);
    
    isLoading = true;
    const loadingIndicator = document.getElementById('loadingIndicator');
    if (loadingIndicator) loadingIndicator.style.display = 'flex';
    
    try {
        let results = [];
        
        if (currentMediaType === 'all') {
            // Fetch both movies and TV shows
            const [movieData, tvData] = await Promise.all([
                fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&with_genres=${currentGenre.id}&page=${currentPage}`).then(r => r.json()),
                fetch(`${BASE_URL}/discover/tv?api_key=${API_KEY}&with_genres=${currentGenre.id}&page=${currentPage}`).then(r => r.json())
            ]);
            
            const movies = (movieData.results || []).map(m => ({ ...m, media_type: 'movie' }));
            const tvShows = (tvData.results || []).map(t => ({ ...t, media_type: 'tv' }));
            results = [...movies, ...tvShows].sort((a, b) => {
                const ratingA = a.vote_average || 0;
                const ratingB = b.vote_average || 0;
                return ratingB - ratingA;
            });
            
            // Check if we have more pages for either type
            hasMorePages = currentPage < Math.max(movieData.total_pages || 0, tvData.total_pages || 0);
        } else {
            // Fetch specific media type
            const endpoint = currentMediaType === 'movie' ? 'movie' : 'tv';
            const response = await fetch(`${BASE_URL}/discover/${endpoint}?api_key=${API_KEY}&with_genres=${currentGenre.id}&page=${currentPage}`);
            const data = await response.json();
            results = (data.results || []).map(item => ({ ...item, media_type: currentMediaType }));
            hasMorePages = currentPage < (data.total_pages || 0);
        }
        
        console.log(`✅ Loaded ${results.length} items. More pages: ${hasMorePages}`);
        
        displayGenreResults(results);
        currentPage++;
        
    } catch (error) {
        console.error('❌ Error loading genre content:', error);
    } finally {
        isLoading = false;
        if (loadingIndicator) loadingIndicator.style.display = 'none';
    }
}

// Display genre results
function displayGenreResults(results) {
    const resultsContainer = document.getElementById('genreBrowseResults');
    
    results.forEach((item, index) => {
        const card = createGenreResultCard(item);
        card.style.animation = `fadeInUp 0.5s ease-out ${index * 0.05}s both`;
        resultsContainer.appendChild(card);
    });
}

// Create genre result card
function createGenreResultCard(item) {
    const card = document.createElement('div');
    card.className = 'genre-result-card';
    
    const title = item.title || item.name;
    const releaseDate = item.release_date || item.first_air_date;
    const year = releaseDate ? new Date(releaseDate).getFullYear() : 'N/A';
    const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
    const lang = item.original_language ? item.original_language.toUpperCase() : 'EN';
    const posterPath = item.poster_path 
        ? `${IMG_BASE_URL}/w500${item.poster_path}` 
        : 'https://via.placeholder.com/500x750?text=No+Image';
    const mediaType = item.media_type || 'movie';
    
    const movieIcon = `<svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px;"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg>`;
    const tvIcon = `<svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px;"><path d="M21 6h-7.59l3.29-3.29L16 2l-4 4-4-4-.71.71L10.59 6H3c-1.1 0-2 .89-2 2v12c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.11-.9-2-2-2zm0 14H3V8h18v12zM9 10v8l7-4z"/></svg>`;
    
    card.innerHTML = `
        <div class="genre-card-poster">
            <img src="${posterPath}" alt="${title}" class="main-poster" loading="lazy">
            <div class="genre-card-full-title">${title}</div>
            <div class="genre-card-overlay">
                <div class="overlay-content">
                    <div class="play-btn-circle">
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    </div>
                    <span class="view-details">View Details</span>
                </div>
            </div>
            <div class="genre-card-badge">
                ${mediaType === 'movie' ? movieIcon : tvIcon}
                <span>${mediaType === 'movie' ? 'MOVIE' : 'TV SHOW'}</span>
            </div>
        </div>
        <div class="genre-card-info">
            <div class="genre-card-header">
                <h3 class="genre-card-title" title="${title}">${title}</h3>
                <span class="genre-card-rating">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
                    ${rating}
                </span>
            </div>
            <div class="genre-card-footer">
                <div class="genre-card-meta-left">
                    <span class="genre-card-year">${year}</span>
                    <span class="genre-card-lang">${lang}</span>
                </div>
                <div class="genre-card-actions">
                    <button class="action-btn quick-play-pill" title="Play Now">
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                        <span>Play</span>
                    </button>
                </div>
            </div>
        </div>
    `;
    
    // Add click handler for details
    card.addEventListener('click', (e) => {
        if (e.target.closest('.quick-play-pill')) {
            e.stopPropagation();
            sessionStorage.setItem('skipIntro', 'true');
            window.location.href = `play.html?id=${item.id}&type=${mediaType}`;
        } else {
            sessionStorage.setItem('skipIntro', 'true');
            window.location.href = `details.html?id=${item.id}&type=${mediaType}`;
        }
    });
    
    return card;
}


// Handle hash navigation for genre links
window.addEventListener('hashchange', handleGenreHash);
window.addEventListener('load', handleGenreHash);

function handleGenreHash() {
    const hash = window.location.hash;
    if (hash.startsWith('#genre-')) {
        const genreId = parseInt(hash.replace('#genre-', ''));
        const genre = combinedGenres.find(g => g.id === genreId);
        if (genre) {
            // Show genres page first
            showGenresPage();
            // Then navigate to the specific genre
            setTimeout(() => {
                showGenreBrowse(genre);
            }, 100);
        }
    }
}