// TMDB API Configuration
const API_KEY = 'c3515fdc674ea2bd7b514f4bc3616a4a';
const BASE_URL = 'https://api.themoviedb.org/3';
const IMG_BASE_URL = 'https://image.tmdb.org/t/p';

// API Endpoints
const endpoints = {
    trending: `${BASE_URL}/trending/movie/week?api_key=${API_KEY}`,
    popular: `${BASE_URL}/movie/popular?api_key=${API_KEY}`,
    topRated: `${BASE_URL}/movie/top_rated?api_key=${API_KEY}`,
    upcoming: `${BASE_URL}/movie/upcoming?api_key=${API_KEY}`
};

// Cache for preloaded data
let cachedMovies = {
    trending: [],
    popular: [],
    topRated: [],
    upcoming: []
};

// Load cached data from localStorage
function loadCachedData() {
    try {
        const cached = localStorage.getItem('playtorrio_movies');
        if (cached) {
            const data = JSON.parse(cached);
            // Check if cache is less than 1 hour old
            if (data.timestamp && (Date.now() - data.timestamp < 3600000)) {
                cachedMovies = data.movies;
                console.log('✅ Loaded movies from cache');
                return true;
            }
        }
    } catch (error) {
        console.error('Error loading cache:', error);
    }
    return false;
}

// Save data to localStorage
function saveCachedData() {
    try {
        const data = {
            movies: cachedMovies,
            timestamp: Date.now()
        };
        localStorage.setItem('playtorrio_movies', JSON.stringify(data));
        console.log('✅ Saved movies to cache');
    } catch (error) {
        console.error('Error saving cache:', error);
    }
}

// Fetch movies from API
async function fetchMovies(endpoint) {
    try {
        const response = await fetch(endpoint);
        const data = await response.json();
        return data.results;
    } catch (error) {
        console.error('Error fetching movies:', error);
        return [];
    }
}

// Preload image
function preloadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(url);
        img.onerror = () => resolve(url); // Resolve anyway to not block
        img.src = url;
    });
}

// Preload all movie data and images during intro
async function preloadMovieData() {
    console.log('🎬 Preloading movies...');
    
    // Try to load from cache first
    if (loadCachedData() && cachedMovies.trending.length > 0) {
        console.log('✅ Using cached movie data');
        return;
    }
    
    try {
        // Fetch all movie data in parallel
        const [trending, popular, topRated, upcoming] = await Promise.all([
            fetchMovies(endpoints.trending),
            fetchMovies(endpoints.popular),
            fetchMovies(endpoints.topRated),
            fetchMovies(endpoints.upcoming)
        ]);
        
        cachedMovies.trending = trending;
        cachedMovies.popular = popular;
        cachedMovies.topRated = topRated;
        cachedMovies.upcoming = upcoming;
        
        // Save to localStorage
        saveCachedData();
        
        console.log('✅ All movies preloaded!');
        
        // Preload images in background (don't wait for them)
        preloadImagesInBackground();
    } catch (error) {
        console.error('Error preloading movies:', error);
    }
}

// Preload images in background without blocking
function preloadImagesInBackground() {
    const allMovies = [...cachedMovies.trending, ...cachedMovies.popular, ...cachedMovies.topRated, ...cachedMovies.upcoming];
    const imageUrls = [];
    
    allMovies.forEach(movie => {
        if (movie.poster_path) {
            imageUrls.push(`${IMG_BASE_URL}/w500${movie.poster_path}`);
        }
        if (movie.backdrop_path) {
            imageUrls.push(`${IMG_BASE_URL}/original${movie.backdrop_path}`);
        }
    });
    
    console.log(`📸 Preloading ${imageUrls.length} images in background...`);
    
    // Preload images without waiting
    imageUrls.forEach(url => {
        const img = new Image();
        img.src = url;
    });
}

// Create hero slide
function createHeroSlide(movie) {
    const slide = document.createElement('div');
    slide.className = 'hero-slide';
    slide.style.backgroundImage = `url(${IMG_BASE_URL}/original${movie.backdrop_path})`;
    
    slide.innerHTML = `
        <div class="hero-overlay"></div>
        <div class="hero-content">
            <h1 class="hero-title">${movie.title}</h1>
            <div class="hero-meta">
                <span class="hero-rating">⭐ ${movie.vote_average.toFixed(1)}</span>
                <span class="hero-year">${new Date(movie.release_date).getFullYear()}</span>
            </div>
            <p class="hero-overview">${movie.overview}</p>
            <div class="hero-buttons">
                <button class="hero-btn primary" onclick="sessionStorage.setItem('skipIntro', 'true'); window.location.href='details.html?id=${movie.id}&type=movie'">▶ Play Now</button>
                <button class="hero-btn secondary">+ My List</button>
            </div>
        </div>
    `;
    
    return slide;
}

// Create movie card
function createMovieCard(movie) {
    const card = document.createElement('div');
    card.className = 'movie-card';
    
    const posterPath = movie.poster_path 
        ? `${IMG_BASE_URL}/w500${movie.poster_path}` 
        : 'https://via.placeholder.com/500x750?text=No+Image';
    
    card.innerHTML = `
        <div class="movie-poster">
            <img src="${posterPath}" alt="${movie.title}" loading="lazy">
            <div class="movie-overlay">
                <div class="movie-info">
                    <h3 class="movie-title">${movie.title}</h3>
                    <div class="movie-meta">
                        <span class="movie-rating">⭐ ${movie.vote_average.toFixed(1)}</span>
                        <span class="movie-year">${new Date(movie.release_date).getFullYear()}</span>
                    </div>
                    <p class="movie-description">${movie.overview.substring(0, 150)}${movie.overview.length > 150 ? '...' : ''}</p>
                    <button class="movie-btn">More Info</button>
                </div>
            </div>
        </div>
    `;
    
    // Add click handler to navigate to details page
    card.addEventListener('click', () => {
        sessionStorage.setItem('skipIntro', 'true');
        window.location.href = `details.html?id=${movie.id}&type=movie`;
    });
    
    return card;
}

// Initialize hero slider
let currentHeroIndex = 0;
let heroMovies = [];

async function initHeroSlider() {
    const heroSlider = document.getElementById('heroSlider');
    const heroDots = document.getElementById('heroDots');
    const heroLoading = document.querySelector('.hero-loading');
    
    if (!heroSlider || !heroDots) {
        console.error('❌ Hero elements not found!');
        return;
    }
    
    // Hide loading indicator
    if (heroLoading) heroLoading.style.display = 'none';
    
    // Use cached data
    heroMovies = cachedMovies.trending.slice(0, 5); // Get top 5 for hero
    
    console.log('🎬 Creating hero slides for', heroMovies.length, 'movies');
    
    heroMovies.forEach((movie, index) => {
        const slide = createHeroSlide(movie);
        heroSlider.appendChild(slide);
        
        const dot = document.createElement('span');
        dot.className = 'hero-dot';
        if (index === 0) dot.classList.add('active');
        dot.addEventListener('click', () => goToHeroSlide(index));
        heroDots.appendChild(dot);
    });
    
    showHeroSlide(0);
    console.log('✅ Hero slider initialized');
}

function showHeroSlide(index) {
    const slides = document.querySelectorAll('.hero-slide');
    const dots = document.querySelectorAll('.hero-dot');
    
    slides.forEach((slide, i) => {
        slide.classList.toggle('active', i === index);
    });
    
    dots.forEach((dot, i) => {
        dot.classList.toggle('active', i === index);
    });
    
    currentHeroIndex = index;
}

function goToHeroSlide(index) {
    showHeroSlide(index);
}

function nextHeroSlide() {
    const nextIndex = (currentHeroIndex + 1) % heroMovies.length;
    showHeroSlide(nextIndex);
}

function prevHeroSlide() {
    const prevIndex = (currentHeroIndex - 1 + heroMovies.length) % heroMovies.length;
    showHeroSlide(prevIndex);
}

// Initialize category sliders
async function initCategorySlider(sliderId, cachedData) {
    const slider = document.getElementById(sliderId);
    
    cachedData.forEach(movie => {
        const card = createMovieCard(movie);
        slider.appendChild(card);
    });
    
    // Add scroll buttons
    addScrollButtons(slider);
}

function addScrollButtons(slider) {
    const container = slider.parentElement;
    
    const prevBtn = document.createElement('button');
    prevBtn.className = 'slider-btn prev';
    prevBtn.innerHTML = '‹';
    prevBtn.addEventListener('click', () => {
        slider.scrollBy({ left: -slider.offsetWidth * 0.8, behavior: 'smooth' });
    });
    
    const nextBtn = document.createElement('button');
    nextBtn.className = 'slider-btn next';
    nextBtn.innerHTML = '›';
    nextBtn.addEventListener('click', () => {
        slider.scrollBy({ left: slider.offsetWidth * 0.8, behavior: 'smooth' });
    });
    
    container.appendChild(prevBtn);
    container.appendChild(nextBtn);
}

// Create Spotlight Section
function createSpotlight(movie) {
    const section = document.getElementById('spotlightSection');
    if (!section || !movie) return;

    const backdropPath = movie.backdrop_path 
        ? `${IMG_BASE_URL}/original${movie.backdrop_path}` 
        : 'https://via.placeholder.com/1200x600?text=No+Image';

    section.innerHTML = `
        <div class="spotlight-card">
            <div class="spotlight-image">
                <img src="${backdropPath}" alt="${movie.title}">
            </div>
            <div class="spotlight-content">
                <span class="spotlight-label">Editor's Pick</span>
                <h2 class="spotlight-title">${movie.title}</h2>
                <div class="movie-meta" style="justify-content: flex-start; gap: 20px;">
                    <span class="movie-rating">⭐ ${movie.vote_average.toFixed(1)}</span>
                    <span class="movie-year">${new Date(movie.release_date).getFullYear()}</span>
                </div>
                <p class="spotlight-desc">${movie.overview}</p>
                <div class="spotlight-actions">
                    <button class="hero-btn primary" onclick="sessionStorage.setItem('skipIntro', 'true'); window.location.href='details.html?id=${movie.id}&type=movie'">▶ Watch Now</button>
                    <button class="hero-btn secondary">+ Add to List</button>
                </div>
            </div>
        </div>
    `;
}

// Initialize app
async function initApp() {
    console.log('🎬 Initializing app...');
    
    await initHeroSlider();
    await initCategorySlider('trendingSlider', cachedMovies.trending);
    
    // Initialize Originals with exactly 4 movies to make them stand out
    await initCategorySlider('originalsSlider', cachedMovies.popular.slice(10, 14));

    // Initialize Spotlight with a random top-rated movie
    if (cachedMovies.topRated && cachedMovies.topRated.length > 0) {
        const randomSpotlight = cachedMovies.topRated[Math.floor(Math.random() * cachedMovies.topRated.length)];
        createSpotlight(randomSpotlight);
    }

    await initCategorySlider('popularSlider', cachedMovies.popular);
    await initCategorySlider('topRatedSlider', cachedMovies.topRated);
    await initCategorySlider('upcomingSlider', cachedMovies.upcoming);
    
    // Hero navigation
    const heroNext = document.getElementById('heroNext');
    const heroPrev = document.getElementById('heroPrev');
    
    if (heroNext && heroPrev) {
        heroNext.addEventListener('click', nextHeroSlide);
        heroPrev.addEventListener('click', prevHeroSlide);
    }
    
    // Auto-advance hero slider
    setInterval(nextHeroSlide, 5000);
    
    console.log('✅ App initialized!');
}

// Update Listener
if (window.electronAPI && window.electronAPI.onUpdateAvailable) {
    window.electronAPI.onUpdateAvailable((info) => {
        console.log('Update available:', info);
        // Create modal
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-80 backdrop-blur-sm';
        modal.innerHTML = `
            <div class="bg-[#14141f] border border-blue-500/50 rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl transform scale-100 transition-transform duration-300">
                <div class="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mb-6 mx-auto">
                    <svg class="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                </div>
                <h2 class="text-2xl font-bold text-white text-center mb-2">Update Available!</h2>
                <p class="text-gray-400 text-center mb-6">Version <span class="text-white font-bold">${info.version}</span> is ready to download.</p>
                <div class="flex flex-col gap-3">
                    <button id="update-download-btn" class="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2">
                        <span>Download Now</span>
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                    </button>
                    <button id="update-later-btn" class="w-full py-2 text-gray-500 hover:text-gray-300 text-sm font-medium transition-colors">
                        Remind Me Later
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        document.getElementById('update-download-btn').onclick = () => {
             if (window.electronAPI.openExternal) {
                 window.electronAPI.openExternal(info.downloadUrl);
             }
             modal.remove();
        };
        
        document.getElementById('update-later-btn').onclick = () => {
            modal.remove();
        };
    });
}

// Start preloading and initializing
preloadMovieData().then(() => {
    initApp();
});
