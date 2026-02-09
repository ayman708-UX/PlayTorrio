// Person/Actor Details Page JavaScript
const API_KEY = 'c3515fdc674ea2bd7b514f4bc3616a4a';
const BASE_URL = 'https://api.themoviedb.org/3';
const IMG_BASE_URL = 'https://image.tmdb.org/t/p';

let currentPersonId = null;
let personPhotos = [];
let currentPhotoIndex = 0;
let allCredits = [];
let currentFilter = 'all';

// Get URL parameters
function getUrlParams() {
    const params = new URLSearchParams(window.location.search);
    return {
        id: params.get('id')
    };
}

// Initialize page
async function initPersonPage() {
    const params = getUrlParams();
    currentPersonId = params.id;
    
    if (!currentPersonId) {
        showError('No person ID provided');
        return;
    }
    
    await loadPersonDetails();
}

// Load person details
async function loadPersonDetails() {
    try {
        showLoading();
        
        // Fetch person details and credits
        const [detailsResponse, creditsResponse, imagesResponse] = await Promise.all([
            fetch(`${BASE_URL}/person/${currentPersonId}?api_key=${API_KEY}`),
            fetch(`${BASE_URL}/person/${currentPersonId}/combined_credits?api_key=${API_KEY}`),
            fetch(`${BASE_URL}/person/${currentPersonId}/images?api_key=${API_KEY}`)
        ]);
        
        const details = await detailsResponse.json();
        const credits = await creditsResponse.json();
        const images = await imagesResponse.json();
        
        displayPersonInfo(details);
        displayPhotos(details, images);
        displayFilmography(credits);
        
        hideLoading();
    } catch (error) {
        console.error('Error loading person details:', error);
        showError('Failed to load person details');
    }
}

// Display person info
function displayPersonInfo(person) {
    document.getElementById('personName').textContent = person.name;
    document.getElementById('knownFor').textContent = person.known_for_department || 'N/A';
    
    const birthday = person.birthday ? new Date(person.birthday).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    }) : 'N/A';
    document.getElementById('birthday').textContent = birthday;
    
    document.getElementById('birthplace').textContent = person.place_of_birth || 'N/A';
    document.getElementById('personBio').textContent = person.biography || 'No biography available.';
}

// Display photos
function displayPhotos(person, images) {
    personPhotos = [];
    
    // Add main profile photo first
    if (person.profile_path) {
        personPhotos.push(person.profile_path);
    }
    
    // Add additional photos
    if (images.profiles && images.profiles.length > 0) {
        images.profiles.forEach(photo => {
            if (photo.file_path && photo.file_path !== person.profile_path) {
                personPhotos.push(photo.file_path);
            }
        });
    }
    
    // Limit to 10 photos
    personPhotos = personPhotos.slice(0, 10);
    
    if (personPhotos.length > 0) {
        showPhoto(0);
    } else {
        document.getElementById('mainPhoto').src = 'https://via.placeholder.com/450x600?text=No+Photo';
        document.getElementById('photoCounter').textContent = '0 / 0';
    }
}

// Show specific photo
function showPhoto(index) {
    if (personPhotos.length === 0) return;
    
    currentPhotoIndex = index;
    const photoPath = `${IMG_BASE_URL}/h632${personPhotos[index]}`;
    document.getElementById('mainPhoto').src = photoPath;
    document.getElementById('photoCounter').textContent = `${index + 1} / ${personPhotos.length}`;
}

// Next photo
function nextPhoto() {
    if (personPhotos.length === 0) return;
    currentPhotoIndex = (currentPhotoIndex + 1) % personPhotos.length;
    showPhoto(currentPhotoIndex);
}

// Previous photo
function prevPhoto() {
    if (personPhotos.length === 0) return;
    currentPhotoIndex = (currentPhotoIndex - 1 + personPhotos.length) % personPhotos.length;
    showPhoto(currentPhotoIndex);
}

// Display filmography
function displayFilmography(credits) {
    // Combine cast credits from movies and TV
    allCredits = [];
    
    if (credits.cast) {
        credits.cast.forEach(credit => {
            allCredits.push({
                ...credit,
                media_type: credit.media_type || 'movie'
            });
        });
    }
    
    // Sort by popularity and release date
    allCredits.sort((a, b) => {
        const dateA = new Date(a.release_date || a.first_air_date || '1900-01-01');
        const dateB = new Date(b.release_date || b.first_air_date || '1900-01-01');
        return dateB - dateA;
    });
    
    filterFilmography('all');
}

// Filter filmography
function filterFilmography(filter) {
    currentFilter = filter;
    
    let filteredCredits = allCredits;
    if (filter === 'movie') {
        filteredCredits = allCredits.filter(c => c.media_type === 'movie');
    } else if (filter === 'tv') {
        filteredCredits = allCredits.filter(c => c.media_type === 'tv');
    }
    
    const grid = document.getElementById('filmographyGrid');
    grid.innerHTML = '';
    
    if (filteredCredits.length === 0) {
        grid.innerHTML = '<p style="color: rgba(255,255,255,0.5); grid-column: 1/-1;">No items found</p>';
        return;
    }
    
    filteredCredits.forEach(credit => {
        const card = createFilmographyCard(credit);
        grid.appendChild(card);
    });
}

// Create filmography card
function createFilmographyCard(credit) {
    const card = document.createElement('div');
    card.className = 'filmography-card';
    
    const title = credit.title || credit.name;
    const releaseDate = credit.release_date || credit.first_air_date;
    const year = releaseDate ? new Date(releaseDate).getFullYear() : 'TBA';
    const rating = credit.vote_average ? credit.vote_average.toFixed(1) : 'N/A';
    const posterPath = credit.poster_path 
        ? `${IMG_BASE_URL}/w342${credit.poster_path}` 
        : 'https://via.placeholder.com/342x513?text=No+Image';
    const character = credit.character || credit.role || '';
    
    card.innerHTML = `
        <div class="filmography-poster">
            <img src="${posterPath}" alt="${title}">
        </div>
        <div class="filmography-info">
            <div class="filmography-title">${title}</div>
            <div class="filmography-meta">
                <span class="filmography-year">${year}</span>
                <span class="filmography-rating">⭐ ${rating}</span>
            </div>
            ${character ? `<div class="filmography-character">as ${character}</div>` : ''}
        </div>
    `;
    
    card.addEventListener('click', () => {
        sessionStorage.setItem('skipIntro', 'true');
        window.location.href = `details.html?id=${credit.id}&type=${credit.media_type}`;
    });
    
    return card;
}

// Loading states
function showLoading() {
    document.getElementById('personLoading').style.display = 'flex';
    document.getElementById('personContent').style.display = 'none';
}

function hideLoading() {
    document.getElementById('personLoading').style.display = 'none';
    document.getElementById('personContent').style.display = 'block';
}

function showError(message) {
    document.getElementById('personLoading').innerHTML = `
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
            window.history.back();
        });
    }
    
    // Photo navigation
    const photoPrev = document.getElementById('photoPrev');
    const photoNext = document.getElementById('photoNext');
    
    if (photoPrev) photoPrev.addEventListener('click', prevPhoto);
    if (photoNext) photoNext.addEventListener('click', nextPhoto);
    
    // Keyboard navigation for photos
    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') prevPhoto();
        if (e.key === 'ArrowRight') nextPhoto();
    });
    
    // Filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            filterFilmography(btn.dataset.filter);
        });
    });
    
    // Initialize page
    initPersonPage();
});
