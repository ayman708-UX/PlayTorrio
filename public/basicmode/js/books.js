// Basic Mode Books Logic

const BOOKS_API = window.location.origin;

let currentBooksMode = 'online'; // 'online', 'offline', or 'library'
let booksInitialized = false;

// DOM Elements
let booksGrid, booksLoading, booksEmpty, booksNoResults;
let booksSearchInput, booksSearchBtn;
let booksOnlineBtn, booksOfflineBtn, booksLibraryBtn;

const syncBooksElements = () => {
    booksGrid = document.getElementById('books-grid');
    booksLoading = document.getElementById('books-loading');
    booksEmpty = document.getElementById('books-empty');
    booksNoResults = document.getElementById('books-no-results');
    booksSearchInput = document.getElementById('books-search-input');
    booksSearchBtn = document.getElementById('books-search-btn');
    booksOnlineBtn = document.getElementById('books-online-btn');
    booksOfflineBtn = document.getElementById('books-offline-btn');
    booksLibraryBtn = document.getElementById('books-library-btn');
};

// Search Online Books (Z-Library)
const searchOnlineBooks = async (query) => {
    try {
        const res = await fetch(`${BOOKS_API}/api/zlib/search/${encodeURIComponent(query)}`);
        const data = await res.json();
        if (data.success && data.books) {
            // Filter to only show epub files
            return data.books.filter(book => book.extension === 'epub');
        }
        return [];
    } catch (e) {
        console.error('[Books] Online search failed:', e);
        return [];
    }
};

// Search Offline Books (LibGen)
const searchOfflineBooks = async (query) => {
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
};

// Get download link for a book (called when download button is clicked)
const getBookDownloadLink = async (editionId) => {
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
};

// Helper function to parse file size string to bytes
const parseFileSize = (sizeStr) => {
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
};

// Get read link for online book
const getReadLink = async (bookPath) => {
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
};

// Get library books from local epub folder
const getLibraryBooks = async () => {
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
};

// Format file size
const formatFileSize = (bytes) => {
    if (!bytes) return 'Unknown';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
};

// Create online book card
const createOnlineBookCard = (book) => {
    const card = document.createElement('div');
    card.className = 'group relative bg-gray-800/50 rounded-xl overflow-hidden border border-gray-700/50 hover:border-blue-500/50 transition-all duration-300 hover:shadow-lg hover:shadow-blue-500/10';
    
    card.innerHTML = `
        <div class="aspect-[2/3] relative overflow-hidden bg-gray-900">
            <img src="${book.cover || ''}" alt="${book.title}" class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 150%22><rect fill=%22%231f2937%22 width=%22100%22 height=%22150%22/><text x=%2250%22 y=%2275%22 text-anchor=%22middle%22 fill=%22%236b7280%22 font-size=%2212%22>No Cover</text></svg>'">
            <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <div class="absolute bottom-2 right-2 px-2 py-1 bg-blue-500/90 rounded text-[10px] font-bold text-white uppercase">
                ${book.extension || 'epub'}
            </div>
        </div>
        <div class="p-3">
            <h3 class="text-sm font-semibold text-white truncate mb-1" title="${book.title}">${book.title}</h3>
            <p class="text-xs text-gray-400 truncate mb-3" title="${book.author}">${book.author || 'Unknown Author'}</p>
            <button class="read-now-btn w-full py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-2">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
                </svg>
                Read Now
            </button>
        </div>
    `;
    
    // Handle Read Now click
    const readBtn = card.querySelector('.read-now-btn');
    readBtn.addEventListener('click', async () => {
        readBtn.disabled = true;
        readBtn.innerHTML = '<div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> Loading...';
        
        const readLink = await getReadLink(book.url);
        if (readLink) {
            // Open in default browser
            if (window.electronAPI?.openExternal) {
                window.electronAPI.openExternal(readLink);
            } else {
                window.open(readLink, '_blank');
            }
        } else {
            alert('Failed to get read link. Please try again.');
        }
        
        readBtn.disabled = false;
        readBtn.innerHTML = `
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
            </svg>
            Read Now
        `;
    });
    
    return card;
};

// Get epub download path based on platform
const getEpubDownloadPath = async () => {
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
};

// Show download modal
const showDownloadModal = async (book) => {
    const downloadPath = await getEpubDownloadPath();
    
    // Create modal
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 z-[500] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4';
    modal.innerHTML = `
        <div class="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div class="p-6">
                <div class="flex items-center gap-3 mb-4">
                    <div class="w-10 h-10 bg-purple-500/20 rounded-full flex items-center justify-center">
                        <svg class="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                        </svg>
                    </div>
                    <h3 class="text-lg font-bold text-white">Download Book</h3>
                </div>
                
                <p class="text-gray-300 text-sm mb-4">Please download the file to this location:</p>
                
                <div class="bg-gray-800 rounded-lg p-3 mb-4 border border-gray-700">
                    <code class="text-xs text-purple-400 break-all select-all">${downloadPath}</code>
                </div>
                
                <p class="text-gray-500 text-xs mb-6">This ensures the app can find and read your downloaded books.</p>
                
                <div class="flex gap-3">
                    <button class="cancel-btn flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-lg transition-colors">
                        Cancel
                    </button>
                    <button class="download-now-btn flex-1 py-2.5 bg-purple-600 hover:bg-purple-500 text-white text-sm font-bold rounded-lg transition-colors flex items-center justify-center gap-2">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                        </svg>
                        Download
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Handle cancel
    modal.querySelector('.cancel-btn').addEventListener('click', () => {
        modal.remove();
    });
    
    // Handle click outside
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
    
    // Handle download
    modal.querySelector('.download-now-btn').addEventListener('click', () => {
        // Open download link in default browser
        if (window.electronAPI?.openExternal) {
            window.electronAPI.openExternal(book.downloadlink);
        } else {
            window.open(book.downloadlink, '_blank');
        }
        modal.remove();
    });
};

// Create offline book card
const createOfflineBookCard = (book) => {
    const card = document.createElement('div');
    card.className = 'group relative bg-gray-800/50 rounded-xl overflow-hidden border border-gray-700/50 hover:border-purple-500/50 transition-all duration-300 hover:shadow-lg hover:shadow-purple-500/10';
    
    const authors = Array.isArray(book.author) ? book.author.join(', ') : (book.author || 'Unknown Author');
    
    card.innerHTML = `
        <div class="aspect-[2/3] relative overflow-hidden bg-gray-900 flex items-center justify-center">
            <div class="text-center p-4">
                <svg class="w-12 h-12 mx-auto mb-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
                </svg>
                <p class="text-xs text-gray-500 line-clamp-3">${book.title}</p>
            </div>
            <div class="absolute bottom-2 right-2 px-2 py-1 bg-purple-500/90 rounded text-[10px] font-bold text-white uppercase">
                ${book.fileExtension || 'epub'}
            </div>
            <div class="absolute bottom-2 left-2 px-2 py-1 bg-gray-700/90 rounded text-[10px] text-gray-300">
                ${formatFileSize(book.fileSize)}
            </div>
        </div>
        <div class="p-3">
            <h3 class="text-sm font-semibold text-white truncate mb-1" title="${book.title}">${book.title}</h3>
            <p class="text-xs text-gray-400 truncate mb-1" title="${authors}">${authors}</p>
            <p class="text-[10px] text-gray-500 mb-3">${book.language || 'Unknown'} ${book.year ? '• ' + book.year : ''}</p>
            <button class="download-btn w-full py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-2">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                </svg>
                Download
            </button>
        </div>
    `;
    
    // Handle download click - show modal
    card.querySelector('.download-btn').addEventListener('click', async () => {
        const btn = card.querySelector('.download-btn');
        const originalHTML = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `
            <div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
            Getting link...
        `;
        
        // Fetch download link when button is clicked
        const downloadlink = await getBookDownloadLink(book.editionId);
        
        btn.disabled = false;
        btn.innerHTML = originalHTML;
        
        if (downloadlink) {
            showDownloadModal({ ...book, downloadlink });
        } else {
            alert('Failed to get download link. Please try again.');
        }
    });
    
    return card;
};

// Create library book card
const createLibraryBookCard = (book) => {
    const card = document.createElement('div');
    card.className = 'group relative bg-gray-800/50 rounded-xl overflow-hidden border border-gray-700/50 hover:border-green-500/50 transition-all duration-300 hover:shadow-lg hover:shadow-green-500/10';
    
    card.innerHTML = `
        <div class="aspect-[2/3] relative overflow-hidden bg-gray-900 flex items-center justify-center">
            <div class="text-center p-4">
                <svg class="w-12 h-12 mx-auto mb-2 text-green-500/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
                </svg>
                <p class="text-xs text-gray-400 line-clamp-3">${book.title}</p>
            </div>
            <div class="absolute bottom-2 right-2 px-2 py-1 bg-green-500/90 rounded text-[10px] font-bold text-white uppercase">
                epub
            </div>
            <div class="absolute bottom-2 left-2 px-2 py-1 bg-gray-700/90 rounded text-[10px] text-gray-300">
                ${formatFileSize(book.size)}
            </div>
        </div>
        <div class="p-3">
            <h3 class="text-sm font-semibold text-white truncate mb-3" title="${book.title}">${book.title}</h3>
            <button class="read-now-btn w-full py-2 bg-green-600 hover:bg-green-500 text-white text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-2">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
                </svg>
                Read Now
            </button>
        </div>
    `;
    
    // Handle Read Now click - open in epub reader
    card.querySelector('.read-now-btn').addEventListener('click', () => {
        // Use the global openEpubReader function from epubReader.js
        if (window.openEpubReader) {
            window.openEpubReader(book.path, book.title);
        } else {
            alert('EPUB reader not available');
        }
    });
    
    return card;
};

// Render books
const renderBooks = (books) => {
    if (!booksGrid) return;
    
    booksGrid.innerHTML = '';
    booksEmpty?.classList.add('hidden');
    booksNoResults?.classList.add('hidden');
    
    if (books.length === 0) {
        booksNoResults?.classList.remove('hidden');
        return;
    }
    
    books.forEach(book => {
        let card;
        if (currentBooksMode === 'online') {
            card = createOnlineBookCard(book);
        } else if (currentBooksMode === 'offline') {
            card = createOfflineBookCard(book);
        } else {
            card = createLibraryBookCard(book);
        }
        booksGrid.appendChild(card);
    });
};

// Handle search
const handleBooksSearch = async () => {
    // Library mode doesn't use search - it loads all books
    if (currentBooksMode === 'library') return;
    
    const query = booksSearchInput?.value.trim();
    if (!query) return;
    
    booksGrid.innerHTML = '';
    booksEmpty?.classList.add('hidden');
    booksNoResults?.classList.add('hidden');
    booksLoading?.classList.remove('hidden');
    
    let books = [];
    if (currentBooksMode === 'online') {
        books = await searchOnlineBooks(query);
    } else {
        books = await searchOfflineBooks(query);
    }
    
    booksLoading?.classList.add('hidden');
    renderBooks(books);
};

// Load library books
const loadLibraryBooks = async () => {
    if (booksGrid) booksGrid.innerHTML = '';
    booksEmpty?.classList.add('hidden');
    booksNoResults?.classList.add('hidden');
    booksLoading?.classList.remove('hidden');
    
    const books = await getLibraryBooks();
    
    booksLoading?.classList.add('hidden');
    
    if (books.length === 0) {
        // Show special empty state for library
        if (booksNoResults) {
            booksNoResults.innerHTML = `
                <svg class="w-16 h-16 mx-auto mb-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
                </svg>
                <p class="text-xl mb-2">Your library is empty</p>
                <p class="text-sm text-gray-500">Download books using the Offline tab to add them to your library</p>
            `;
            booksNoResults.classList.remove('hidden');
        }
        return;
    }
    
    renderBooks(books);
};

// Update mode buttons
const updateModeButtons = (mode) => {
    currentBooksMode = mode;
    
    // Reset button styles
    [booksOnlineBtn, booksOfflineBtn, booksLibraryBtn].forEach(btn => {
        if (btn) {
            btn.classList.remove('bg-primary-purple', 'text-white', 'shadow-lg', 'shadow-purple-500/25');
            btn.classList.add('text-gray-400', 'hover:text-white', 'hover:bg-white/5');
        }
    });
    
    // Activate selected button
    let activeBtn;
    if (mode === 'online') activeBtn = booksOnlineBtn;
    else if (mode === 'offline') activeBtn = booksOfflineBtn;
    else activeBtn = booksLibraryBtn;
    
    if (activeBtn) {
        activeBtn.classList.add('bg-primary-purple', 'text-white', 'shadow-lg', 'shadow-purple-500/25');
        activeBtn.classList.remove('text-gray-400', 'hover:text-white', 'hover:bg-white/5');
    }
    
    // Show/hide search based on mode
    const searchContainer = booksSearchInput?.closest('.flex.items-center');
    if (searchContainer) {
        if (mode === 'library') {
            searchContainer.style.display = 'none';
        } else {
            searchContainer.style.display = '';
        }
    }
    
    // Clear results when switching modes
    if (booksGrid) booksGrid.innerHTML = '';
    booksNoResults?.classList.add('hidden');
    
    // For library mode, load books immediately
    if (mode === 'library') {
        loadLibraryBooks();
    } else {
        booksEmpty?.classList.remove('hidden');
    }
};

// Initialize Books
export const initBooks = () => {
    syncBooksElements();
    
    if (booksInitialized) return;
    booksInitialized = true;
    
    // Mode toggle buttons
    booksOnlineBtn?.addEventListener('click', () => updateModeButtons('online'));
    booksOfflineBtn?.addEventListener('click', () => updateModeButtons('offline'));
    booksLibraryBtn?.addEventListener('click', () => updateModeButtons('library'));
    
    // Search
    booksSearchBtn?.addEventListener('click', handleBooksSearch);
    booksSearchInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleBooksSearch();
    });
    
    // Show empty state initially
    booksEmpty?.classList.remove('hidden');
};
