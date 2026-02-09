// Comics Functionality
let currentComicsPage = 1;
let isLoadingComics = false;
let hasMoreComics = true;
let currentComicId = null;
let currentReaderChapter = null;
let currentReaderPages = [];
let currentReaderPageIndex = 0;
let isReaderFullscreen = false;
let zoomLevel = 1;
let isDragging = false;
let startY;
let scrollTop;

const PROXY_URL = 'http://localhost:6987/comics-proxy?url=';
const COMICS_API_BASE = 'http://localhost:6987/comics';

// Show Comics Page
function showComicsPage() {
    hideAllSections();
    
    // Check if comics section exists, if not create it
    let comicsSection = document.getElementById('comicsSection');
    if (!comicsSection) {
        createComicsSection();
        initialComicsLoad();
    } else {
        comicsSection.style.setProperty('display', 'block', 'important');
    }
}

// Initial Multi-page Load
async function initialComicsLoad() {
    await loadComics(); // Page 1
    if (hasMoreComics) await loadComics(); // Page 2
    if (hasMoreComics) await loadComics(); // Page 3
}

// Create Comics Section Structure
function createComicsSection() {
    const mainContent = document.getElementById('mainContent');
    const section = document.createElement('div');
    section.id = 'comicsSection';
    section.className = 'comics-section';
    section.innerHTML = `
        <div class="comics-header">
            <div class="search-container-comics">
                <input type="text" id="comicsSearch" placeholder="Search comics...">
                <button id="comicsSearchBtn">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
                </button>
            </div>
            <button class="saved-comics-btn" id="comicsSavedBtn">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>
                Saved
            </button>
        </div>
        <div class="comics-grid" id="comicsGrid"></div>
        <div id="comicsSentinel" style="height: 20px; width: 100%;"></div>
        <div class="comics-loader" id="comicsLoader">
            <div class="spinner"></div>
        </div>
    `;
    mainContent.appendChild(section);

    // Setup Observer
    setupComicsInfiniteScroll();

    // Event Listeners for Search and Saved
    const searchInput = document.getElementById('comicsSearch');
    const searchBtn = document.getElementById('comicsSearchBtn');

    searchBtn.addEventListener('click', () => {
        performComicsSearch(searchInput.value);
    });

    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            performComicsSearch(searchInput.value);
        }
    });
    
    // Saved button
    const savedBtn = document.getElementById('comicsSavedBtn');
    if (savedBtn) {
        savedBtn.addEventListener('click', showSavedComics);
    }
}

// Show Saved Comics
function showSavedComics() {
    hasMoreComics = false; // Disable infinite scroll
    document.getElementById('comicsGrid').innerHTML = '';
    
    const saved = getSavedComics();
    if (saved.length === 0) {
        document.getElementById('comicsGrid').innerHTML = '<p class="no-results">No saved comics yet.</p>';
    } else {
        renderComics(saved);
    }
}

// Perform Search
async function performComicsSearch(query) {
    if (!query.trim()) {
        // Reset to default list if search is empty
        currentComicsPage = 1;
        hasMoreComics = true;
        document.getElementById('comicsGrid').innerHTML = '';
        loadComics();
        return;
    }

    isLoadingComics = true;
    hasMoreComics = false; // Disable infinite scroll for search results
    document.getElementById('comicsGrid').innerHTML = '';
    document.getElementById('comicsLoader').style.display = 'flex';

    try {
        const response = await fetch(`${COMICS_API_BASE}/search/${encodeURIComponent(query)}`);
        const data = await response.json();

        if (data.success) {
            if (data.results.length === 0) {
                document.getElementById('comicsGrid').innerHTML = '<p class="no-results">No comics found matching your search.</p>';
            } else {
                renderComics(data.results);
            }
        }
    } catch (error) {
        console.error('Error searching comics:', error);
        document.getElementById('comicsGrid').innerHTML = '<p class="no-results">Error performing search.</p>';
    } finally {
        isLoadingComics = false;
        document.getElementById('comicsLoader').style.display = 'none';
    }
}

// Setup Intersection Observer for infinite scroll
function setupComicsInfiniteScroll() {
    const sentinel = document.getElementById('comicsSentinel');
    if (!sentinel) return;
    
    const observer = new IntersectionObserver((entries) => {
        const comicsSection = document.getElementById('comicsSection');
        if (entries[0].isIntersecting && 
            !isLoadingComics && 
            hasMoreComics && 
            comicsSection && 
            window.getComputedStyle(comicsSection).display !== 'none') {
            loadComics();
        }
    }, {
        root: null,
        rootMargin: '500px', // Start loading earlier
        threshold: 0.1
    });
    
    observer.observe(sentinel);
}

// Load Comics
async function loadComics() {
    if (isLoadingComics || !hasMoreComics) return;
    
    isLoadingComics = true;
    document.getElementById('comicsLoader').style.display = 'flex';

    try {
        const response = await fetch(`${COMICS_API_BASE}/all?page=${currentComicsPage}`);
        const data = await response.json();

        if (data.success) {
            if (data.results.length === 0) {
                hasMoreComics = false;
            } else {
                renderComics(data.results);
                currentComicsPage++;
            }
        }
    } catch (error) {
        console.error('Error loading comics:', error);
    } finally {
        isLoadingComics = false;
        document.getElementById('comicsLoader').style.display = 'none';
    }
}

// Render Comics Grid
function renderComics(comics) {
    const grid = document.getElementById('comicsGrid');
    comics.forEach(comic => {
        const card = document.createElement('div');
        card.className = 'comic-card';
        // Extract slug from URL for API calls
        // e.g., https://readcomicsonline.ru/comic/war-wolf-2025 -> war-wolf-2025
        const slug = comic.url.split('/').pop();
        
        // Proxy the poster URL
        const posterUrl = `${PROXY_URL}${encodeURIComponent(comic.poster_url)}`;

        card.innerHTML = `
            <div class="comic-poster">
                <img src="${posterUrl}" alt="${comic.name}" loading="lazy">
                <div class="comic-overlay"></div>
            </div>
            <div class="comic-info">
                <h3 class="comic-title">${comic.name}</h3>
            </div>
        `;
        
        card.addEventListener('click', () => openComicModal(slug, comic));
        grid.appendChild(card);
    });
}

// Open Comic Modal (Chapters)
async function openComicModal(slug, comicData) {
    let modal = document.getElementById('comicModal');
    if (!modal) {
        createComicModal();
        modal = document.getElementById('comicModal');
    }
    
    // Set Modal Content
    const posterUrl = `${PROXY_URL}${encodeURIComponent(comicData.poster_url)}`;
    document.getElementById('modalComicPoster').src = posterUrl;
    document.getElementById('modalComicTitle').textContent = comicData.name;
    document.getElementById('modalChaptersList').innerHTML = '<div class="spinner"></div>';
    
    // Reset buttons
    const readFirstBtn = document.getElementById('readFirstBtn');
    const saveComicBtn = document.getElementById('saveComicBtn');
    
    // Remove old listeners
    const newReadFirstBtn = readFirstBtn.cloneNode(true);
    const newSaveComicBtn = saveComicBtn.cloneNode(true);
    readFirstBtn.parentNode.replaceChild(newReadFirstBtn, readFirstBtn);
    saveComicBtn.parentNode.replaceChild(newSaveComicBtn, saveComicBtn);

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Fetch Chapters
    try {
        const response = await fetch(`${COMICS_API_BASE}/chapters/${slug}`);
        const data = await response.json();
        
        if (data.success) {
            renderChapters(data.chapters, slug);
            
            // "Read First" usually means Chapter 1
            newReadFirstBtn.addEventListener('click', () => {
                const firstChapter = data.chapters.find(c => c.chapter === "1") || data.chapters[data.chapters.length - 1];
                if (firstChapter) {
                    openReader(slug, firstChapter.chapter);
                }
            });

            newSaveComicBtn.addEventListener('click', () => {
                const isSaved = toggleSaveComic(slug, comicData);
                newSaveComicBtn.textContent = isSaved ? 'Saved ✓' : 'Save';
            });
            
            // Update button text based on current state
            newSaveComicBtn.textContent = isComicSaved(slug) ? 'Saved ✓' : 'Save';
        }
    } catch (error) {
        console.error('Error loading chapters:', error);
        document.getElementById('modalChaptersList').innerHTML = '<p>Error loading chapters.</p>';
    }
}

// Saved Comics Functions - Shared with basicmode
function getSavedComics() {
    try {
        return JSON.parse(localStorage.getItem('saved_comics') || '[]');
    } catch (e) {
        return [];
    }
}

function setSavedComics(list) {
    localStorage.setItem('saved_comics', JSON.stringify(list));
}

function isComicSaved(slug) {
    return getSavedComics().some(c => c.slug === slug);
}

function toggleSaveComic(slug, data) {
    const list = getSavedComics();
    const idx = list.findIndex(c => c.slug === slug);
    
    if (idx >= 0) {
        list.splice(idx, 1);
        setSavedComics(list);
        return false; // Removed
    } else {
        const comicToSave = { ...data, slug };
        list.unshift(comicToSave);
        setSavedComics(list);
        return true; // Added
    }
}

// Create Comic Modal Structure
function createComicModal() {
    const modal = document.createElement('div');
    modal.id = 'comicModal';
    modal.className = 'comic-modal';
    modal.innerHTML = `
        <div class="comic-modal-content">
            <button class="comic-modal-close" id="closeComicModal">×</button>
            <div class="comic-modal-header">
                <img id="modalComicPoster" class="modal-poster" src="" alt="">
                <div class="modal-info">
                    <h2 id="modalComicTitle"></h2>
                    <div class="modal-actions">
                        <button class="action-btn primary" id="readFirstBtn">Read First</button>
                        <button class="action-btn secondary" id="saveComicBtn">Save</button>
                    </div>
                </div>
            </div>
            <div class="chapters-container">
                <h3>Chapters</h3>
                <div class="chapters-list" id="modalChaptersList"></div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('closeComicModal').addEventListener('click', () => {
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

// Render Chapters List
function renderChapters(chapters, comicSlug) {
    const list = document.getElementById('modalChaptersList');
    list.innerHTML = '';
    
    chapters.forEach(chapter => {
        const item = document.createElement('div');
        item.className = 'chapter-item';
        item.innerHTML = `
            <span class="chapter-name">${chapter.name}</span>
            <span class="chapter-number">#${chapter.chapter}</span>
        `;
        // The chapter ID seems to be the chapter number in the API URL construction
        // e.g. /comics/pages/cruel-universe-2025/7
        item.addEventListener('click', () => openReader(comicSlug, chapter.chapter));
        list.appendChild(item);
    });
}

// Open Reader
async function openReader(comicSlug, chapter) {
    let reader = document.getElementById('comicReader');
    if (!reader) {
        createReader();
        reader = document.getElementById('comicReader');
    }

    // Reset Reader State
    const pagesContainer = document.getElementById('readerPages');
    pagesContainer.innerHTML = '<div class="spinner-large" style="margin: auto;"></div>';
    reader.classList.add('active');
    document.getElementById('comicModal').classList.remove('active'); // Close modal
    
    currentReaderPages = [];
    zoomLevel = 1;
    updateZoom();

    try {
        const response = await fetch(`${COMICS_API_BASE}/pages/${comicSlug}/${chapter}`);
        const data = await response.json();
        
        if (data.success) {
            renderReaderPages(data.pages);
        }
    } catch (error) {
        console.error('Error loading pages:', error);
    }
}

// Create Reader Structure
function createReader() {
    const reader = document.createElement('div');
    reader.id = 'comicReader';
    reader.className = 'comic-reader';
    reader.innerHTML = `
        <div class="reader-toolbar">
            <button class="reader-btn" id="readerClose">Close</button>
            <div class="reader-controls">
                <button class="reader-btn" id="zoomOut">-</button>
                <span id="zoomDisplay">100%</span>
                <button class="reader-btn" id="zoomIn">+</button>
                <button class="reader-btn" id="readerFullscreen">⛶</button>
            </div>
        </div>
        <div class="reader-content" id="readerContent">
            <div class="reader-pages" id="readerPages"></div>
        </div>
    `;
    document.body.appendChild(reader);

    // Controls
    document.getElementById('readerClose').addEventListener('click', closeReader);
    document.getElementById('zoomIn').addEventListener('click', () => { zoomLevel += 0.1; updateZoom(); });
    document.getElementById('zoomOut').addEventListener('click', () => { if(zoomLevel > 0.5) zoomLevel -= 0.1; updateZoom(); });
    document.getElementById('readerFullscreen').addEventListener('click', toggleFullscreen);

    // Drag Scrolling
    const content = document.getElementById('readerContent');
    
    content.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'IMG') e.preventDefault(); // Prevent default image drag
        isDragging = true;
        startY = e.pageY - content.offsetTop;
        scrollTop = content.scrollTop;
        content.style.cursor = 'grabbing';
        content.style.userSelect = 'none'; // Prevent text selection
    });

    window.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            content.style.cursor = 'grab';
            content.style.userSelect = 'auto';
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        // Only scroll if the reader is active
        const reader = document.getElementById('comicReader');
        if (!reader || !reader.classList.contains('active')) return;

        e.preventDefault();
        const y = e.pageY - content.offsetTop;
        const walk = (y - startY) * 1.5;
        const newScrollTop = scrollTop - walk;
        
        // Prevent scrolling past the bottom
        const maxScroll = content.scrollHeight - content.clientHeight;
        content.scrollTop = Math.max(0, Math.min(newScrollTop, maxScroll));
    });

    // Prevent wheel scroll past bottom
    content.addEventListener('wheel', (e) => {
        const maxScroll = content.scrollHeight - content.clientHeight;
        const currentScroll = content.scrollTop;
        
        // If trying to scroll down past the bottom, prevent it
        if (e.deltaY > 0 && currentScroll >= maxScroll) {
            e.preventDefault();
        }
        // If trying to scroll up past the top, prevent it
        if (e.deltaY < 0 && currentScroll <= 0) {
            e.preventDefault();
        }
    }, { passive: false });

    // Keyboard Nav
    document.addEventListener('keydown', (e) => {
        if (!reader.classList.contains('active')) return;
        
        const maxScroll = content.scrollHeight - content.clientHeight;
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const newScroll = Math.min(content.scrollTop + 50, maxScroll);
            content.scrollTop = newScroll;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            const newScroll = Math.max(content.scrollTop - 50, 0);
            content.scrollTop = newScroll;
        }
        if (e.key === 'Escape') closeReader();
    });
}

function renderReaderPages(pages) {
    const container = document.getElementById('readerPages');
    container.innerHTML = '';
    
    pages.forEach(page => {
        const img = document.createElement('img');
        const pageUrl = `${PROXY_URL}${encodeURIComponent(page.url)}`;
        img.src = pageUrl;
        img.className = 'reader-page';
        img.loading = 'lazy';
        container.appendChild(img);
    });
}

function updateZoom() {
    const pages = document.getElementById('readerPages');
    if(pages) {
        pages.style.transform = `scale(${zoomLevel})`;
        document.getElementById('zoomDisplay').textContent = `${Math.round(zoomLevel * 100)}%`;
    }
}

function toggleFullscreen() {
    const elem = document.getElementById('comicReader');
    if (!document.fullscreenElement) {
        elem.requestFullscreen().catch(err => {
            console.error(`Error attempting to enable fullscreen: ${err.message}`);
        });
    } else {
        document.exitFullscreen();
    }
}

function closeReader() {
    document.getElementById('comicReader').classList.remove('active');
    document.body.style.overflow = 'auto';
    if (document.fullscreenElement) {
        document.exitFullscreen();
    }
}
