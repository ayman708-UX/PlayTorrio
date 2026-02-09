// Manga Functionality
let currentMangaPage = 1;
let isLoadingManga = false;
let hasMoreManga = true;
let currentMangaSource = 'comix'; // 'comix' or 'weebcentral'
let currentMangaGenre = '';
let currentMangaQuery = '';

const MANGA_API_BASE = 'http://localhost:6987/api';

// Update showMangaPage to use initial load
function showMangaPage() {
    hideAllSections();

    let mangaSection = document.getElementById('mangaSection');
    if (!mangaSection) {
        createMangaSection();
        initialMangaLoad();
    } else {
        mangaSection.style.setProperty('display', 'block', 'important');
    }

    // Show Warning Modal if needed
    showMangaWarning();
}

// Manga Content Warning
function showMangaWarning() {
    if (localStorage.getItem('hideMangaWarning') === 'true') return;

    let warningModal = document.getElementById('mangaWarningModal');
    if (!warningModal) {
        warningModal = document.createElement('div');
        warningModal.id = 'mangaWarningModal';
        warningModal.className = 'warning-modal';
        warningModal.innerHTML = `
            <div class="warning-content">
                <div class="warning-icon">⚠️</div>
                <h2>Content Advisory</h2>
                <p>This section contains titles that may include mature themes, explicit language, and 18+ content. By proceeding, you acknowledge that you are of legal age to view such material.</p>
                <div class="warning-actions">
                    <button class="warning-btn primary" id="dismissWarning">I Understand</button>
                    <button class="warning-btn secondary" id="neverShowWarning">Never Show This Again</button>
                </div>
            </div>
        `;
        document.body.appendChild(warningModal);

        document.getElementById('dismissWarning').addEventListener('click', () => {
            warningModal.classList.remove('active');
        });

        document.getElementById('neverShowWarning').addEventListener('click', () => {
            localStorage.setItem('hideMangaWarning', 'true');
            warningModal.classList.remove('active');
        });
    }

    warningModal.classList.add('active');
}

// Create Manga Section Structure
function createMangaSection() {
    const mainContent = document.getElementById('mainContent');
    const section = document.createElement('div');
    section.id = 'mangaSection';
    section.className = 'manga-section';
    section.innerHTML = `
        <div class="manga-header">
            <div class="manga-controls-top">
                <div class="manga-source-selector">
                    <button class="source-btn active" data-source="comix">Comix</button>
                    <button class="source-btn" data-source="weebcentral">WeebCentral</button>
                </div>
                <div class="search-container-comics">
                    <input type="text" id="mangaSearch" placeholder="Search manga...">
                    <button id="mangaSearchBtn">
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
                    </button>
                </div>
                <button class="saved-comics-btn" id="mangaSavedBtn">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>
                    Saved
                </button>
            </div>
            <div class="manga-controls-bottom">
                <div class="custom-dropdown" id="mangaGenreDropdown" style="display: block;">
                    <div class="custom-dropdown-selection" id="genreSelectionText">All Genres</div>
                    <div class="custom-dropdown-list" id="mangaGenreList">
                        <div class="custom-dropdown-item active" data-value="">All Genres</div>
                    </div>
                </div>
            </div>
        </div>
        <div class="manga-grid" id="mangaGrid"></div>
        <div id="mangaSentinel" style="height: 20px; width: 100%;"></div>
        <div class="manga-loader" id="mangaLoader">
            <div class="spinner"></div>
        </div>
    `;
    mainContent.appendChild(section);

    // Custom Dropdown Logic
    const dropdown = document.getElementById('mangaGenreDropdown');
    const selectionText = document.getElementById('genreSelectionText');
    
    selectionText.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('active');
    });

    document.addEventListener('click', () => {
        dropdown.classList.remove('active');
    });

    // Setup Observer
    setupMangaInfiniteScroll();

    // Event Listeners for Sources
    section.querySelectorAll('.source-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('active')) return;
            
            section.querySelectorAll('.source-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            currentMangaSource = btn.dataset.source;
            document.getElementById('mangaGenreDropdown').style.display = currentMangaSource === 'comix' ? 'block' : 'none';
            
            resetMangaGrid();
            initialMangaLoad();
        });
    });

    // Search
    const searchInput = document.getElementById('mangaSearch');
    const searchBtn = document.getElementById('mangaSearchBtn');
    
    const triggerSearch = () => {
        currentMangaQuery = searchInput.value.trim();
        resetMangaGrid();
        initialMangaLoad();
    };

    searchBtn.addEventListener('click', triggerSearch);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') triggerSearch();
    });

    // Saved Button
    document.getElementById('mangaSavedBtn').addEventListener('click', () => {
        showSavedManga();
    });

    // Load Comix Genres initially
    loadComixGenres();
}

// Initial Multi-page Load
async function initialMangaLoad() {
    await loadManga(); // Page 1
    if (hasMoreManga && !currentMangaQuery) {
        await loadManga(); // Page 2
        await loadManga(); // Page 3
    }
}

// Setup Intersection Observer for infinite scroll
function setupMangaInfiniteScroll() {
    const sentinel = document.getElementById('mangaSentinel');
    if (!sentinel) return;
    
    const observer = new IntersectionObserver((entries) => {
        const mangaSection = document.getElementById('mangaSection');
        if (entries[0].isIntersecting && 
            !isLoadingManga && 
            hasMoreManga && 
            mangaSection && 
            window.getComputedStyle(mangaSection).display !== 'none') {
            loadManga();
        }
    }, {
        root: null,
        rootMargin: '500px',
        threshold: 0.1
    });
    
    observer.observe(sentinel);
}

function resetMangaGrid() {
    currentMangaPage = 1;
    hasMoreManga = true;
    document.getElementById('mangaGrid').innerHTML = '';
}

// Load Comix Genres
async function loadComixGenres() {
    try {
        const response = await fetch(`${MANGA_API_BASE}/comix/genres`);
        const data = await response.json();
        if (data.status === 'success') {
            const list = document.getElementById('mangaGenreList');
            const selectionText = document.getElementById('genreSelectionText');
            
            Object.entries(data.genres).forEach(([id, name]) => {
                const item = document.createElement('div');
                item.className = 'custom-dropdown-item';
                item.dataset.value = id;
                item.textContent = name;
                
                item.addEventListener('click', () => {
                    list.querySelectorAll('.custom-dropdown-item').forEach(i => i.classList.remove('active'));
                    item.classList.add('active');
                    selectionText.textContent = name;
                    
                    currentMangaGenre = id;
                    resetMangaGrid();
                    initialMangaLoad();
                });
                
                list.appendChild(item);
            });

            const allGenresItem = list.querySelector('[data-value=""]');
            if (allGenresItem) {
                allGenresItem.addEventListener('click', () => {
                    list.querySelectorAll('.custom-dropdown-item').forEach(i => i.classList.remove('active'));
                    allGenresItem.classList.add('active');
                    selectionText.textContent = 'All Genres';
                    currentMangaGenre = '';
                    resetMangaGrid();
                    initialMangaLoad();
                });
            }
        }
    } catch (error) {
        console.error('Error loading genres:', error);
    }
}

// Load Manga Data
async function loadManga() {
    if (isLoadingManga || !hasMoreManga) return;
    
    isLoadingManga = true;
    document.getElementById('mangaLoader').style.display = 'flex';

    let url = '';
    
    if (currentMangaSource === 'comix') {
        if (currentMangaQuery) {
            url = `${MANGA_API_BASE}/comix/manga/search/${encodeURIComponent(currentMangaQuery)}?page=${currentMangaPage}`;
        } else if (currentMangaGenre) {
            url = `${MANGA_API_BASE}/comix/manga/genre/${currentMangaGenre}?page=${currentMangaPage}`;
        } else {
            url = `${MANGA_API_BASE}/comix/manga/all?page=${currentMangaPage}`;
        }
    } else { // WeebCentral
        if (currentMangaQuery) {
            url = `${MANGA_API_BASE}/manga/search?q=${encodeURIComponent(currentMangaQuery)}`;
            hasMoreManga = false; // WeebCentral search URL provided doesn't show page param
        } else {
            url = `${MANGA_API_BASE}/manga/all?page=${currentMangaPage}`;
        }
    }

    try {
        const response = await fetch(url);
        const res = await response.json();
        
        let results = [];
        results = res.data || [];

        if (results.length === 0) {
            hasMoreManga = false;
            if (currentMangaPage === 1) {
                document.getElementById('mangaGrid').innerHTML = '<p class="no-results">No manga found.</p>';
            }
        } else {
            renderMangaGrid(results);
            currentMangaPage++;
        }
    } catch (error) {
        console.error('Error loading manga:', error);
        if (currentMangaPage === 1) {
            document.getElementById('mangaGrid').innerHTML = '<p class="no-results">Error loading data.</p>';
        }
    } finally {
        isLoadingManga = false;
        document.getElementById('mangaLoader').style.display = 'none';
    }
}

// Render Grid
function renderMangaGrid(mangas, isSavedView = false) {
    const grid = document.getElementById('mangaGrid');
    
    mangas.forEach(manga => {
        const card = document.createElement('div');
        card.className = 'manga-card';
        
        // Use provider from manga if available (for saved items), else use current source
        const provider = manga.provider || currentMangaSource;
        const uniqueId = getMangaUniqueId(manga, provider);
        const isSaved = isMangaSaved(uniqueId);
        
        const posterUrl = `http://localhost:6987/comics-proxy?url=${encodeURIComponent(manga.poster)}`;

        card.innerHTML = `
            <div class="manga-poster">
                <img src="${posterUrl}" alt="${manga.name}" loading="lazy">
                <button class="manga-save-btn" style="position: absolute; top: 8px; right: 8px; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: none; cursor: pointer; transition: all 0.3s; ${isSaved ? 'background: #8b5cf6; color: #fff;' : 'background: rgba(0,0,0,0.6); color: rgba(255,255,255,0.7);'}" title="${isSaved ? 'Remove from saved' : 'Save manga'}">
                    <svg style="width: 16px; height: 16px;" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                </button>
            </div>
            <div class="manga-info">
                <h3 class="manga-title">${manga.name}</h3>
            </div>
        `;
        
        // Save button click
        const saveBtn = card.querySelector('.manga-save-btn');
        saveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const wasAdded = toggleSaveManga(manga, provider);
            
            if (wasAdded) {
                saveBtn.style.background = '#8b5cf6';
                saveBtn.style.color = '#fff';
                saveBtn.title = 'Remove from saved';
            } else {
                saveBtn.style.background = 'rgba(0,0,0,0.6)';
                saveBtn.style.color = 'rgba(255,255,255,0.7)';
                saveBtn.title = 'Save manga';
                
                // If in saved view, remove the card
                if (isSavedView) {
                    card.remove();
                    if (grid.children.length === 0) {
                        grid.innerHTML = '<p class="no-results">No saved manga yet.</p>';
                    }
                }
            }
        });
        
        card.addEventListener('click', (e) => {
            if (!e.target.closest('.manga-save-btn')) {
                openMangaModal(manga, provider);
            }
        });
        grid.appendChild(card);
    });
}

// Open Manga Modal
async function openMangaModal(mangaData, provider) {
    // Use provider from parameter or manga object or current source
    const actualProvider = provider || mangaData.provider || currentMangaSource;
    const uniqueId = getMangaUniqueId(mangaData, actualProvider);
    
    let modal = document.getElementById('mangaModal');
    if (!modal) {
        createMangaModal();
        modal = document.getElementById('mangaModal');
    }
    
    // Set Modal Content
    const posterUrl = `http://localhost:6987/comics-proxy?url=${encodeURIComponent(mangaData.poster)}`;
    document.getElementById('modalMangaPoster').src = posterUrl;
    document.getElementById('modalMangaTitle').textContent = mangaData.name;
    document.getElementById('modalMangaChaptersList').innerHTML = '<div class="spinner"></div>';
    
    const readFirstBtn = document.getElementById('mangaReadFirstBtn');
    const saveBtn = document.getElementById('mangaSaveBtn');
    
    // Clone to remove old listeners
    const newReadFirst = readFirstBtn.cloneNode(true);
    const newSave = saveBtn.cloneNode(true);
    readFirstBtn.parentNode.replaceChild(newReadFirst, readFirstBtn);
    saveBtn.parentNode.replaceChild(newSave, saveBtn);
    
    // Update save button text
    newSave.textContent = isMangaSaved(uniqueId) ? 'Saved ✓' : 'Save';

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Fetch Chapters
    let chaptersUrl = '';
    if (actualProvider === 'comix') {
        chaptersUrl = `${MANGA_API_BASE}/comix/chapters/${mangaData.hash_id}`;
    } else {
        chaptersUrl = `${MANGA_API_BASE}/manga/chapters?seriesId=${mangaData.seriesId}&latestChapterId=${mangaData.latestChapterId}`;
    }

    try {
        const response = await fetch(chaptersUrl);
        const data = await response.json();
        
        if (data.status === 'success' || data.success) {
            const chapters = data.data || [];
            renderMangaChapters(chapters, mangaData, actualProvider);
            
            newReadFirst.addEventListener('click', () => {
                const first = chapters[chapters.length - 1];
                if (first) {
                    if (actualProvider === 'comix') {
                        openMangaReader(mangaData.hash_id, first.chapter_id, actualProvider);
                    } else {
                        openMangaReader(null, first.id, actualProvider);
                    }
                }
            });

            newSave.addEventListener('click', () => {
                const wasAdded = toggleSaveManga(mangaData, actualProvider);
                newSave.textContent = wasAdded ? 'Saved ✓' : 'Save';
            });
        }
    } catch (error) {
        console.error('Error loading chapters:', error);
    }
}

function createMangaModal() {
    const modal = document.createElement('div');
    modal.id = 'mangaModal';
    modal.className = 'comic-modal'; // Reuse styles
    modal.innerHTML = `
        <div class="comic-modal-content">
            <button class="comic-modal-close" id="closeMangaModal">×</button>
            <div class="comic-modal-header">
                <img id="modalMangaPoster" class="modal-poster" src="" alt="">
                <div class="modal-info">
                    <h2 id="modalMangaTitle"></h2>
                    <div class="modal-actions">
                        <button class="action-btn primary" id="mangaReadFirstBtn">Read First</button>
                        <button class="action-btn secondary" id="mangaSaveBtn">Save</button>
                    </div>
                </div>
            </div>
            <div class="chapters-container">
                <h3>Chapters</h3>
                <div class="chapters-list" id="modalMangaChaptersList"></div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('closeMangaModal').addEventListener('click', () => {
        modal.classList.remove('active');
        document.body.style.overflow = 'auto';
    });
}

function renderMangaChapters(chapters, mangaData, provider) {
    const list = document.getElementById('modalMangaChaptersList');
    list.innerHTML = '';
    
    chapters.forEach(chapter => {
        const item = document.createElement('div');
        item.className = 'chapter-item';
        
        const name = chapter.name || `Chapter ${chapter.number}`;
        const number = chapter.number || chapter.name.replace('Chapter ', '');

        item.innerHTML = `
            <span class="chapter-name">${name}</span>
            <span class="chapter-number">#${number}</span>
        `;
        
        item.addEventListener('click', () => {
            if (provider === 'comix') {
                openMangaReader(mangaData.hash_id, chapter.chapter_id, provider);
            } else {
                openMangaReader(null, chapter.id, provider);
            }
        });
        list.appendChild(item);
    });
}

// Reader
async function openMangaReader(mangaId, chapterId, provider) {
    const actualProvider = provider || currentMangaSource;
    
    let reader = document.getElementById('comicReader');
    if (!reader) {
        // We reuse the comics reader if possible, but let's ensure it exists
        // Since comics.js is already included, we might just use it
        // but for safety, if it's not there:
        createReader(); // from comics.js if available, else we'd need it here
        reader = document.getElementById('comicReader');
    }

    const pagesContainer = document.getElementById('readerPages');
    pagesContainer.innerHTML = '<div class="spinner-large" style="margin: auto;"></div>';
    reader.classList.add('active');
    
    const mangaModal = document.getElementById('mangaModal');
    if (mangaModal) mangaModal.classList.remove('active');
    
    document.body.style.overflow = 'hidden';

    let pagesUrl = '';
    if (actualProvider === 'comix') {
        pagesUrl = `${MANGA_API_BASE}/comix/manga/chapters/${mangaId}/${chapterId}`;
    } else {
        pagesUrl = `${MANGA_API_BASE}/chapter/pages?chapterId=${chapterId}`;
    }

    try {
        const response = await fetch(pagesUrl);
        const data = await response.json();
        
        if (data.status === 'success' || data.success) {
            renderMangaPages(data.pages);
        }
    } catch (error) {
        console.error('Error loading pages:', error);
    }
}

function renderMangaPages(pages) {
    const container = document.getElementById('readerPages');
    container.innerHTML = '';
    
    pages.forEach(pageUrl => {
        const img = document.createElement('img');
        // Manga pages are strings in the array, load them directly
        img.src = pageUrl;
        img.className = 'reader-page';
        img.loading = 'lazy';
        img.draggable = false; // Prevent default browser drag behavior
        container.appendChild(img);
    });
}

// Saved Manga Functions - Shared with basicmode
const SAVED_MANGA_KEY = 'pt_saved_manga_v1';

function getSavedManga() {
    try {
        return JSON.parse(localStorage.getItem(SAVED_MANGA_KEY) || '[]');
    } catch {
        return [];
    }
}

function setSavedManga(list) {
    localStorage.setItem(SAVED_MANGA_KEY, JSON.stringify(list));
}

function getMangaUniqueId(manga, source) {
    if (source === 'comix') {
        return `comix_${manga.hash_id || manga.manga_id || manga.id}`;
    } else {
        return `weeb_${manga.seriesId || manga.id}`;
    }
}

function isMangaSaved(uniqueId) {
    return getSavedManga().some(m => String(m.uniqueId) === String(uniqueId));
}

function toggleSaveManga(mangaData, source) {
    const uniqueId = getMangaUniqueId(mangaData, source || currentMangaSource);
    const list = getSavedManga();
    const idx = list.findIndex(m => String(m.uniqueId) === String(uniqueId));
    
    if (idx >= 0) {
        list.splice(idx, 1);
        setSavedManga(list);
        return false; // Removed
    } else {
        const mangaToSave = { 
            ...mangaData, 
            uniqueId,
            provider: source || currentMangaSource 
        };
        list.unshift(mangaToSave);
        setSavedManga(list);
        return true; // Added
    }
}

function showSavedManga() {
    resetMangaGrid();
    hasMoreManga = false;
    
    const saved = getSavedManga();
    
    if (saved.length === 0) {
        document.getElementById('mangaGrid').innerHTML = '<p class="no-results">No saved manga yet.</p>';
    } else {
        renderMangaGrid(saved, true); // true = is saved view
    }
}
