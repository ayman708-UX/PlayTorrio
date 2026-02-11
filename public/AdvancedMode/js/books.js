// Books Functionality for Advanced Mode
const BOOKS_API = window.location.origin;

let currentBooksMode = 'online'; // 'online', 'offline', or 'library'
let booksInitialized = false;

// Show Books Page
function showBooksPage() {
    hideAllSections();
    
    let booksSection = document.getElementById('booksSection');
    if (!booksSection) {
        createBooksSection();
        booksInitialized = true;
    } else {
        booksSection.style.setProperty('display', 'block', 'important');
    }
}

// Create Books Section
function createBooksSection() {
    const mainContent = document.getElementById('mainContent');
    const section = document.createElement('div');
    section.id = 'booksSection';
    section.className = 'books-section';
    section.innerHTML = `
        <div class="books-header">
            <div class="books-mode-selector">
                <button class="mode-btn active" id="booksOnlineBtn" data-mode="online">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
                    Online
                </button>
                <button class="mode-btn" id="booksOfflineBtn" data-mode="offline">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4c-1.48 0-2.85.43-4.01 1.17l1.46 1.46C10.21 6.23 11.08 6 12 6c3.04 0 5.5 2.46 5.5 5.5v.5H19c1.66 0 3 1.34 3 3 0 1.13-.64 2.11-1.56 2.62l1.45 1.45C23.16 18.16 24 16.68 24 15c0-2.64-2.05-4.78-4.65-4.96zM3 5.27l2.75 2.74C2.56 8.15 0 10.77 0 14c0 3.31 2.69 6 6 6h11.73l2 2L21 20.73 4.27 4 3 5.27zM7.73 10l8 8H6c-2.21 0-4-1.79-4-4s1.79-4 4-4h1.73z"/></svg>
                    Offline
                </button>
                <button class="mode-btn" id="booksLibraryBtn" data-mode="library">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9H9V9h10v2zm-4 4H9v-2h6v2zm4-8H9V5h10v2z"/></svg>
                    Library
                </button>
            </div>
            <div class="search-container-books" id="booksSearchContainer">
                <input type="text" id="booksSearch" placeholder="Search books...">
                <button id="booksSearchBtn">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
                </button>
            </div>
        </div>
        <div class="books-grid" id="booksGrid"></div>
        <div class="books-empty" id="booksEmpty">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/></svg>
            <p>Search for books to get started</p>
        </div>
        <div class="books-loader" id="booksLoader" style="display: none;">
            <div class="spinner"></div>
        </div>
    `;
    mainContent.appendChild(section);

    // Event listeners
    document.getElementById('booksOnlineBtn').addEventListener('click', () => switchBooksMode('online'));
    document.getElementById('booksOfflineBtn').addEventListener('click', () => switchBooksMode('offline'));
    document.getElementById('booksLibraryBtn').addEventListener('click', () => switchBooksMode('library'));
    document.getElementById('booksSearchBtn').addEventListener('click', handleBooksSearch);
    document.getElementById('booksSearch').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleBooksSearch();
    });
}

// Switch Books Mode
function switchBooksMode(mode) {
    currentBooksMode = mode;
    
    // Update button states
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-mode="${mode}"]`).classList.add('active');
    
    // Show/hide search based on mode
    const searchContainer = document.getElementById('booksSearchContainer');
    if (mode === 'library') {
        searchContainer.style.display = 'none';
        loadLibraryBooks();
    } else {
        searchContainer.style.display = '';
        // Clear results
        document.getElementById('booksGrid').innerHTML = '';
        document.getElementById('booksEmpty').style.display = 'flex';
    }
}

// Search Online Books (Z-Library)
async function searchOnlineBooks(query) {
    try {
        const res = await fetch(`${BOOKS_API}/api/zlib/search/${encodeURIComponent(query)}`);
        const data = await res.json();
        if (data.success && data.books) {
            return data.books.filter(book => book.extension === 'epub');
        }
        return [];
    } catch (e) {
        console.error('[Books] Online search failed:', e);
        return [];
    }
}

// Search Offline Books (LibGen)
async function searchOfflineBooks(query) {
    try {
        const res = await fetch(`http://localhost:6987/libgen/search/${encodeURIComponent(query)}`);
        const data = await res.json();
        if (data.results && Array.isArray(data.results)) {
            // Transform libgen results to match expected format (without fetching download links yet)
            const transformedBooks = data.results.map((book) => {
                return {
                    title: book.title,
                    author: book.author,
                    fileExtension: book.format,
                    fileSize: parseFileSize(book.size),
                    language: book.language,
                    year: book.year,
                    editionId: book.editionId, // Store editionId for later download link fetching
                    publisher: book.publisher,
                    pages: book.pages
                };
            });
            return transformedBooks.filter(book => book.fileExtension === 'epub');
        }
        return [];
    } catch (e) {
        console.error('[Books] Offline search failed:', e);
        return [];
    }
}

// Get download link for a book (called when download button is clicked)
async function getBookDownloadLink(editionId) {
    try {
        const editionRes = await fetch(`http://localhost:6987/libgen/edition/${editionId}`);
        const editionData = await editionRes.json();
        if (editionData.md5) {
            const downloadRes = await fetch(`http://localhost:6987/libgen/download/${editionData.md5}`);
            const downloadData = await downloadRes.json();
            return downloadData.downloadUrl || '';
        }
        return '';
    } catch (err) {
        console.error('[Books] Failed to get download link:', err);
        return '';
    }
}

// Helper function to parse file size string to bytes
function parseFileSize(sizeStr) {
    if (!sizeStr) return 0;
    const match = sizeStr.match(/([\d.]+)\s*([A-Z]+)/i);
    if (!match) return 0;
    
    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    
    const units = {
        'B': 1,
        'KB': 1024,
        'MB': 1024 * 1024,
        'GB': 1024 * 1024 * 1024
    };
    
    return Math.round(value * (units[unit] || 1));
}

// Get library books
async function getLibraryBooks() {
    try {
        const res = await fetch(`${BOOKS_API}/api/books/library`);
        const data = await res.json();
        if (data.success && data.books) {
            return data.books;
        }
        return [];
    } catch (e) {
        console.error('[Books] Failed to get library books:', e);
        return [];
    }
}

// Load library books
async function loadLibraryBooks() {
    const grid = document.getElementById('booksGrid');
    const loader = document.getElementById('booksLoader');
    const empty = document.getElementById('booksEmpty');
    
    grid.innerHTML = '';
    empty.style.display = 'none';
    loader.style.display = 'flex';
    
    const books = await getLibraryBooks();
    
    loader.style.display = 'none';
    
    if (books.length === 0) {
        empty.innerHTML = `
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/></svg>
            <p>Your library is empty</p>
            <p style="font-size: 0.9rem; color: rgba(255,255,255,0.4); margin-top: 10px;">Download books using the Offline tab to add them to your library</p>
        `;
        empty.style.display = 'flex';
        return;
    }
    
    renderBooks(books);
}

// Get read link for online book
async function getReadLink(bookPath) {
    try {
        const res = await fetch(`${BOOKS_API}/api/zlib/read-link?path=${encodeURIComponent(bookPath)}`);
        const data = await res.json();
        if (data.success && data.readLink) {
            return data.readLink;
        }
        return null;
    } catch (e) {
        console.error('[Books] Failed to get read link:', e);
        return null;
    }
}

// Format file size
function formatFileSize(bytes) {
    if (!bytes) return 'Unknown';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

// Get epub download path - expand environment variables
async function getEpubDownloadPath() {
    // Try to get the actual path from Electron
    if (window.electronAPI?.getEpubFolder) {
        try {
            const result = await window.electronAPI.getEpubFolder();
            if (result && result.success && result.path) {
                return result.path;
            }
        } catch (error) {
            console.warn('Failed to get epub folder from Electron:', error);
        }
    }
    
    // Fallback to generic paths
    const platform = navigator.platform.toLowerCase();
    const userAgent = navigator.userAgent.toLowerCase();
    
    if (platform.includes('win') || userAgent.includes('windows')) {
        return '%APPDATA%\\PlayTorrio\\epub';
    } else if (platform.includes('mac') || userAgent.includes('mac')) {
        return '~/Library/Application Support/PlayTorrio/epub';
    } else {
        return '~/.config/PlayTorrio/epub';
    }
}

// Show download modal
async function showDownloadModal(book) {
    const downloadPath = await getEpubDownloadPath();
    
    const modal = document.createElement('div');
    modal.className = 'book-download-modal';
    modal.innerHTML = `
        <div class="book-download-content">
            <h3>Download Book</h3>
            <p>Please download the file to this location:</p>
            <div class="download-path">
                <code>${downloadPath}</code>
            </div>
            <p class="download-note">This ensures the app can find and read your downloaded books.</p>
            <div class="download-actions">
                <button class="cancel-btn">Cancel</button>
                <button class="download-now-btn">Download</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
    
    modal.querySelector('.download-now-btn').addEventListener('click', () => {
        if (window.electronAPI?.openExternal) {
            window.electronAPI.openExternal(book.downloadlink);
        } else {
            window.open(book.downloadlink, '_blank');
        }
        modal.remove();
    });
}

// Render Books
function renderBooks(books) {
    const grid = document.getElementById('booksGrid');
    const empty = document.getElementById('booksEmpty');
    
    grid.innerHTML = '';
    empty.style.display = 'none';
    
    if (books.length === 0) {
        empty.innerHTML = `
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/></svg>
            <p>No books found</p>
        `;
        empty.style.display = 'flex';
        return;
    }
    
    books.forEach(book => {
        const card = document.createElement('div');
        card.className = 'book-card';
        
        if (currentBooksMode === 'online') {
            card.innerHTML = `
                <div class="book-cover">
                    <img src="${book.cover || ''}" alt="${book.title}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 150%22><rect fill=%22%231f2937%22 width=%22100%22 height=%22150%22/><text x=%2250%22 y=%2275%22 text-anchor=%22middle%22 fill=%22%236b7280%22 font-size=%2212%22>No Cover</text></svg>'">
                    <div class="book-badge online">EPUB</div>
                </div>
                <div class="book-info">
                    <h3 class="book-title">${book.title}</h3>
                    <p class="book-author">${book.author || 'Unknown Author'}</p>
                    <button class="book-btn read-btn">Read Now</button>
                </div>
            `;
            
            card.querySelector('.read-btn').addEventListener('click', async () => {
                const btn = card.querySelector('.read-btn');
                btn.disabled = true;
                btn.innerHTML = '<div class="spinner-small"></div> Loading...';
                
                const readLink = await getReadLink(book.url);
                if (readLink) {
                    if (window.electronAPI?.openExternal) {
                        window.electronAPI.openExternal(readLink);
                    } else {
                        window.open(readLink, '_blank');
                    }
                } else {
                    alert('Failed to get read link');
                }
                
                btn.disabled = false;
                btn.innerHTML = 'Read Now';
            });
        } else if (currentBooksMode === 'offline') {
            const authors = Array.isArray(book.author) ? book.author.join(', ') : (book.author || 'Unknown Author');
            
            card.innerHTML = `
                <div class="book-cover no-image">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/></svg>
                    <div class="book-badge offline">EPUB</div>
                    <div class="book-size">${formatFileSize(book.fileSize)}</div>
                </div>
                <div class="book-info">
                    <h3 class="book-title">${book.title}</h3>
                    <p class="book-author">${authors}</p>
                    <p class="book-meta">${book.language || 'Unknown'} ${book.year ? '• ' + book.year : ''}</p>
                    <button class="book-btn download-btn">Download</button>
                </div>
            `;
            
            card.querySelector('.download-btn').addEventListener('click', async () => {
                const btn = card.querySelector('.download-btn');
                const originalText = btn.innerHTML;
                btn.disabled = true;
                btn.innerHTML = '<div class="spinner-small"></div> Getting link...';
                
                // Fetch download link when button is clicked
                const downloadlink = await getBookDownloadLink(book.editionId);
                
                btn.disabled = false;
                btn.innerHTML = originalText;
                
                if (downloadlink) {
                    showDownloadModal({ ...book, downloadlink });
                } else {
                    alert('Failed to get download link. Please try again.');
                }
            });
        } else {
            // Library mode
            card.innerHTML = `
                <div class="book-cover no-image">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/></svg>
                    <div class="book-badge library">EPUB</div>
                    <div class="book-size">${formatFileSize(book.size)}</div>
                </div>
                <div class="book-info">
                    <h3 class="book-title">${book.title}</h3>
                    <button class="book-btn library-btn">Read Now</button>
                </div>
            `;
            
            card.querySelector('.library-btn').addEventListener('click', () => {
                // Use the global openEpubReader function from epubReader.js
                if (window.openEpubReader) {
                    window.openEpubReader(book.path, book.title);
                } else {
                    alert('EPUB reader not available');
                }
            });
        }
        
        grid.appendChild(card);
    });
}

// Handle Search
async function handleBooksSearch() {
    // Library mode doesn't use search
    if (currentBooksMode === 'library') return;
    
    const query = document.getElementById('booksSearch').value.trim();
    if (!query) return;
    
    const grid = document.getElementById('booksGrid');
    const loader = document.getElementById('booksLoader');
    const empty = document.getElementById('booksEmpty');
    
    grid.innerHTML = '';
    empty.style.display = 'none';
    loader.style.display = 'flex';
    
    let books = [];
    if (currentBooksMode === 'online') {
        books = await searchOnlineBooks(query);
    } else {
        books = await searchOfflineBooks(query);
    }
    
    loader.style.display = 'none';
    renderBooks(books);
}
