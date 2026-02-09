// Search Page Functionality
const searchState = {
    query: '',
    selectedYears: [],
    selectedGenres: [],
    mediaType: 'all', // all, movie, tv
    results: []
};

// Make searchState globally accessible
window.searchState = searchState;

// Genre list from TMDB
const genres = {
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
        { id: 878, name: 'Sci-Fi' },
        { id: 10770, name: 'TV Movie' },
        { id: 53, name: 'Thriller' },
        { id: 10752, name: 'War' },
        { id: 37, name: 'Western' }
    ]
};

// Generate year options (current year back to 1900)
const currentYear = new Date().getFullYear();
const years = [];
for (let year = currentYear; year >= 1900; year--) {
    years.push(year);
}

// Show search page
function showSearchPage() {
    hideAllSections();
    
    // Check if search page already exists
    let searchPage = document.getElementById('searchPageContainer');
    if (!searchPage) {
        searchPage = document.createElement('div');
        searchPage.id = 'searchPageContainer';
        searchPage.innerHTML = `
            <div class="search-page">
                <div class="search-header">
                    <div class="search-bar-container">
                        <input type="text" id="searchInput" class="search-input" placeholder="Search for movies and TV shows...">
                        <button class="search-btn" id="searchBtn">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                            </svg>
                        </button>
                    </div>
                    
                    <div class="filter-bar">
                        <div class="filter-dropdown">
                            <button class="filter-dropdown-btn" id="typeFilterBtn">
                                <span>Type: All</span>
                                <svg viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M7 10l5 5 5-5z"/>
                                </svg>
                            </button>
                            <div class="filter-dropdown-menu" id="typeFilterMenu">
                                <label class="filter-option">
                                    <input type="radio" name="mediaType" value="all" checked>
                                    <span>All</span>
                                </label>
                                <label class="filter-option">
                                    <input type="radio" name="mediaType" value="movie">
                                    <span>Movies</span>
                                </label>
                                <label class="filter-option">
                                    <input type="radio" name="mediaType" value="tv">
                                    <span>TV Shows</span>
                                </label>
                            </div>
                        </div>

                        <div class="filter-dropdown">
                            <button class="filter-dropdown-btn" id="genreFilterBtn">
                                <span>Genres</span>
                                <svg viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M7 10l5 5 5-5z"/>
                                </svg>
                            </button>
                            <div class="filter-dropdown-menu genre-menu" id="genreFilterMenu"></div>
                        </div>

                        <div class="filter-dropdown">
                            <button class="filter-dropdown-btn" id="yearFilterBtn">
                                <span>Year</span>
                                <svg viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M7 10l5 5 5-5z"/>
                                </svg>
                            </button>
                            <div class="filter-dropdown-menu year-menu" id="yearFilterMenu"></div>
                        </div>

                        <button class="clear-filters-btn" id="clearFilters">Clear Filters</button>
                    </div>
                </div>

                <div class="search-results">
                    <div class="results-header">
                        <h2 class="results-title">Search Results</h2>
                        <span class="results-count" id="resultsCount">0 results</span>
                    </div>
                    <div class="results-grid" id="resultsGrid">
                        <div class="search-placeholder">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                            </svg>
                            <p>Start searching for your favorite movies and TV shows</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.getElementById('mainContent').appendChild(searchPage);
        initializeSearchPage();
    } else {
        searchPage.style.setProperty('display', 'block', 'important');
    }
}

// Initialize search page
function initializeSearchPage() {
    // Populate genre filters
    const genreFilterMenu = document.getElementById('genreFilterMenu');
    genreFilterMenu.innerHTML = ''; // Clear first
    genres.movie.forEach(genre => {
        const label = document.createElement('label');
        label.className = 'filter-option';
        label.innerHTML = `
            <input type="checkbox" value="${genre.id}" data-genre="${genre.name}">
            <span>${genre.name}</span>
        `;
        genreFilterMenu.appendChild(label);
    });

    // Populate year filters (last 50 years)
    const yearFilterMenu = document.getElementById('yearFilterMenu');
    yearFilterMenu.innerHTML = ''; // Clear first
    const recentYears = years.slice(0, 50); // Get last 50 years
    recentYears.forEach(year => {
        const label = document.createElement('label');
        label.className = 'filter-option';
        label.innerHTML = `
            <input type="checkbox" value="${year}">
            <span>${year}</span>
        `;
        yearFilterMenu.appendChild(label);
    });

    // Dropdown toggle functionality
    setupDropdowns();

    // Event listeners
    document.getElementById('searchBtn').addEventListener('click', performSearch);
    document.getElementById('searchInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSearch();
    });

    document.querySelectorAll('input[name="mediaType"]').forEach(radio => {
        radio.addEventListener('change', () => {
            updateFilterLabel('typeFilterBtn', `Type: ${radio.nextElementSibling.textContent}`);
            performSearch();
        });
    });

    document.querySelectorAll('#genreFilterMenu input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            updateGenreLabel();
            performSearch();
        });
    });

    document.querySelectorAll('#yearFilterMenu input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            updateYearLabel();
            performSearch();
        });
    });

    document.getElementById('clearFilters').addEventListener('click', clearFilters);
    
    // Check if we need to restore search results
    const shouldRestore = sessionStorage.getItem('restoreSearch');
    if (shouldRestore === 'true') {
        sessionStorage.removeItem('restoreSearch');
        const savedSearchState = sessionStorage.getItem('searchState');
        if (savedSearchState) {
            try {
                const searchState = JSON.parse(savedSearchState);
                if (searchState.results && searchState.results.length > 0) {
                    // Restore search state
                    window.searchState = searchState;
                    
                    // Show search page and restore results
                    setTimeout(() => {
                        showSearchPage();
                        setTimeout(() => {
                            renderSearchResults(searchState.results);
                            
                            // Restore search input and filters
                            if (searchState.query) {
                                document.getElementById('searchInput').value = searchState.query;
                            }
                        }, 100);
                    }, 50);
                }
            } catch (e) {
                console.error('Error restoring search state:', e);
            }
        }
    }
}

// Update filter button labels
function updateFilterLabel(btnId, text) {
    const btn = document.getElementById(btnId);
    btn.querySelector('span').textContent = text;
}

function updateGenreLabel() {
    const selected = document.querySelectorAll('#genreFilterMenu input:checked');
    const text = selected.length > 0 ? `Genres (${selected.length})` : 'Genres';
    updateFilterLabel('genreFilterBtn', text);
}

function updateYearLabel() {
    const selected = document.querySelectorAll('#yearFilterMenu input:checked');
    const text = selected.length > 0 ? `Year (${selected.length})` : 'Year';
    updateFilterLabel('yearFilterBtn', text);
}

// Setup dropdown menus
function setupDropdowns() {
    const dropdowns = document.querySelectorAll('.filter-dropdown');
    
    dropdowns.forEach(dropdown => {
        const btn = dropdown.querySelector('.filter-dropdown-btn');
        const menu = dropdown.querySelector('.filter-dropdown-menu');
        
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            
            // Close other dropdowns
            document.querySelectorAll('.filter-dropdown-menu').forEach(m => {
                if (m !== menu) m.classList.remove('active');
            });
            
            menu.classList.toggle('active');
        });
    });
    
    // Close dropdowns when clicking outside
    document.addEventListener('click', () => {
        document.querySelectorAll('.filter-dropdown-menu').forEach(menu => {
            menu.classList.remove('active');
        });
    });
    
    // Prevent dropdown from closing when clicking inside
    document.querySelectorAll('.filter-dropdown-menu').forEach(menu => {
        menu.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    });
}

// Perform search
async function performSearch() {
    const query = document.getElementById('searchInput').value.trim();
    const mediaType = document.querySelector('input[name="mediaType"]:checked').value;
    const selectedGenres = Array.from(document.querySelectorAll('#genreFilterMenu input:checked')).map(cb => cb.value);
    const selectedYears = Array.from(document.querySelectorAll('#yearFilterMenu input:checked')).map(cb => cb.value);

    if (!query && selectedGenres.length === 0 && selectedYears.length === 0) {
        return;
    }

    const resultsGrid = document.getElementById('resultsGrid');
    resultsGrid.innerHTML = '<div class="loading">Searching...</div>';

    try {
        let results = [];

        if (query) {
            // Search by query
            const searchUrl = mediaType === 'all' 
                ? `${BASE_URL}/search/multi?api_key=${API_KEY}&query=${encodeURIComponent(query)}`
                : `${BASE_URL}/search/${mediaType}?api_key=${API_KEY}&query=${encodeURIComponent(query)}`;
            
            const response = await fetch(searchUrl);
            const data = await response.json();
            results = data.results || [];
        } else {
            // Discover by filters
            const discoverUrl = mediaType === 'tv' 
                ? `${BASE_URL}/discover/tv?api_key=${API_KEY}`
                : `${BASE_URL}/discover/movie?api_key=${API_KEY}`;
            
            let url = discoverUrl;
            if (selectedGenres.length > 0) {
                url += `&with_genres=${selectedGenres.join(',')}`;
            }
            if (selectedYears.length > 0) {
                // Use the first selected year for filtering
                const year = selectedYears[0];
                url += mediaType === 'tv' ? `&first_air_date_year=${year}` : `&primary_release_year=${year}`;
            }

            const response = await fetch(url);
            const data = await response.json();
            results = data.results || [];
        }

        // Filter results by selected years if multiple
        if (selectedYears.length > 0) {
            results = results.filter(item => {
                const releaseDate = item.release_date || item.first_air_date;
                if (!releaseDate) return false;
                const year = new Date(releaseDate).getFullYear().toString();
                return selectedYears.includes(year);
            });
        }

        // Filter results by media type
        if (mediaType !== 'all') {
            results = results.filter(item => {
                if (mediaType === 'movie') return item.media_type === 'movie' || item.title;
                if (mediaType === 'tv') return item.media_type === 'tv' || item.name;
                return true;
            });
        }

        displayResults(results);
        
        // Save search state globally and to sessionStorage
        window.searchState.results = results;
        window.searchState.query = query;
        window.searchState.selectedGenres = selectedGenres;
        window.searchState.selectedYears = selectedYears;
        window.searchState.mediaType = mediaType;
        
        // Persist to sessionStorage for cross-page access
        sessionStorage.setItem('searchState', JSON.stringify(window.searchState));
    } catch (error) {
        console.error('Search error:', error);
        resultsGrid.innerHTML = '<div class="error">Error performing search. Please try again.</div>';
    }
}

// Render search results (for restoring from details page)
function renderSearchResults(results) {
    displayResults(results);
}

// Make renderSearchResults globally accessible
window.renderSearchResults = renderSearchResults;

// Display search results
function displayResults(results) {
    const resultsGrid = document.getElementById('resultsGrid');
    const resultsCount = document.getElementById('resultsCount');

    resultsCount.textContent = `${results.length} result${results.length !== 1 ? 's' : ''}`;

    if (results.length === 0) {
        resultsGrid.innerHTML = `
            <div class="no-results">
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                </svg>
                <p>No results found</p>
            </div>
        `;
        return;
    }

    resultsGrid.innerHTML = '';
    results.forEach(item => {
        const card = createSearchResultCard(item);
        resultsGrid.appendChild(card);
    });
}

// Create search result card
function createSearchResultCard(item) {
    const card = document.createElement('div');
    card.className = 'search-result-card';

    const title = item.title || item.name;
    const mediaType = item.media_type || (item.title ? 'movie' : 'tv');
    
    // Handle image path based on media type
    let imagePath = item.poster_path || item.profile_path;
    const posterPath = imagePath 
        ? `${IMG_BASE_URL}/w500${imagePath}` 
        : 'https://via.placeholder.com/500x750?text=No+Image';

    // Metadata based on media type
    let metaHTML = '';
    if (mediaType === 'person') {
        const knownFor = item.known_for_department || 'Acting';
        metaHTML = `
            <span class="search-card-type">${knownFor}</span>
            <span class="search-card-type">PERSON</span>
        `;
    } else {
        const releaseDate = item.release_date || item.first_air_date;
        const year = releaseDate ? new Date(releaseDate).getFullYear() : 'N/A';
        const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
        metaHTML = `
            <span class="search-card-year">${year}</span>
            <span class="search-card-rating">⭐ ${rating}</span>
            <span class="search-card-type">${mediaType.toUpperCase()}</span>
        `;
    }

    card.innerHTML = `
        <div class="search-card-poster">
            <img src="${posterPath}" alt="${title}" loading="lazy">
            <div class="search-card-overlay">
                <button class="search-card-btn">More Info</button>
            </div>
        </div>
        <div class="search-card-info">
            <h3 class="search-card-title">${title}</h3>
            <div class="search-card-meta">
                ${metaHTML}
            </div>
        </div>
    `;

    // Add click handler to navigate to the correct page
    card.addEventListener('click', () => {
        sessionStorage.setItem('skipIntro', 'true');
        if (mediaType === 'person') {
            window.location.href = `person.html?id=${item.id}`;
        } else {
            window.location.href = `details.html?id=${item.id}&type=${mediaType}`;
        }
    });

    return card;
}

// Clear all filters
function clearFilters() {
    document.getElementById('searchInput').value = '';
    document.querySelector('input[name="mediaType"][value="all"]').checked = true;
    document.querySelectorAll('#genreFilterMenu input[type="checkbox"]').forEach(cb => cb.checked = false);
    document.querySelectorAll('#yearFilterMenu input[type="checkbox"]').forEach(cb => cb.checked = false);
    
    // Reset labels
    updateFilterLabel('typeFilterBtn', 'Type: All');
    updateFilterLabel('genreFilterBtn', 'Genres');
    updateFilterLabel('yearFilterBtn', 'Year');
    
    const resultsGrid = document.getElementById('resultsGrid');
    resultsGrid.innerHTML = `
        <div class="search-placeholder">
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
            </svg>
            <p>Start searching for your favorite movies and TV shows</p>
        </div>
    `;
    document.getElementById('resultsCount').textContent = '0 results';
}


// Check on page load if we need to restore search
document.addEventListener('DOMContentLoaded', () => {
    const shouldRestore = sessionStorage.getItem('restoreSearch');
    if (shouldRestore === 'true') {
        sessionStorage.removeItem('restoreSearch');
        const savedSearchState = sessionStorage.getItem('searchState');
        if (savedSearchState) {
            try {
                const searchState = JSON.parse(savedSearchState);
                if (searchState.results && searchState.results.length > 0) {
                    // Restore search state
                    window.searchState = searchState;
                    
                    // Show search page and restore results immediately
                    showSearchPage();
                    
                    // Wait for page to be fully rendered
                    setTimeout(() => {
                        // Restore search input
                        const searchInput = document.getElementById('searchInput');
                        if (searchInput && searchState.query) {
                            searchInput.value = searchState.query;
                        }
                        
                        // Display results immediately
                        renderSearchResults(searchState.results);
                        
                        console.log('[Search] Restored search results:', searchState.results.length, 'items');
                    }, 100);
                }
            } catch (e) {
                console.error('Error restoring search state:', e);
            }
        }
    }
});
