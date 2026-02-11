// BookTorrio Module - EPUB Book Search and Download
(function() {
    'use strict';

    let initialized = false;
    let currentDownload = null;

    // Get epub download path - try to get real path from electron
    async function getEpubDownloadPath() {
        // Try to get real path from electron API
        if (window.electronAPI && window.electronAPI.getEpubFolder) {
            try {
                const result = await window.electronAPI.getEpubFolder();
                if (result.success && result.path) {
                    return result.path;
                }
            } catch (e) {
                console.warn('[BookTorrio] Could not get epub folder from electron:', e);
            }
        }
        
        // Fallback message when not running in Electron
        const platform = navigator.platform.toLowerCase();
        const userAgent = navigator.userAgent.toLowerCase();
        
        if (platform.includes('win') || userAgent.includes('windows')) {
            return 'AppData\\Roaming\\PlayTorrio\\epub (in your user folder)';
        } else if (platform.includes('mac') || userAgent.includes('mac')) {
            return '~/Library/Application Support/PlayTorrio/epub';
        } else {
            return '~/.config/PlayTorrio/epub';
        }
    }

    // Format file size helper
    function formatFileSize(bytes) {
        if (!bytes) return 'Unknown';
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }

    // Show download modal with path info
    async function showDownloadModal(book) {
        const downloadPath = await getEpubDownloadPath();
        
        // Remove existing modal if any
        const existingModal = document.getElementById('bookDownloadModal');
        if (existingModal) existingModal.remove();
        
        const modal = document.createElement('div');
        modal.id = 'bookDownloadModal';
        modal.style.cssText = `
            position: fixed; inset: 0; z-index: 10000;
            display: flex; align-items: center; justify-content: center;
            background: rgba(0,0,0,0.85); backdrop-filter: blur(8px); padding: 1rem;
        `;
        
        modal.innerHTML = `
            <div style="background: linear-gradient(145deg, #1a1a2e, #16213e); border: 1px solid rgba(6,182,212,0.3);
                        border-radius: 16px; width: 100%; max-width: 450px; overflow: hidden; box-shadow: 0 25px 50px rgba(0,0,0,0.5);">
                <div style="padding: 1.5rem;">
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 1rem;">
                        <div style="width: 48px; height: 48px; background: rgba(6,182,212,0.2); border-radius: 50%;
                                    display: flex; align-items: center; justify-content: center;">
                            <i class="fas fa-download" style="color: #06b6d4; font-size: 1.25rem;"></i>
                        </div>
                        <h3 style="margin: 0; color: #fff; font-size: 1.25rem; font-weight: 600;">Download Book</h3>
                    </div>
                    
                    <p style="color: #9ca3af; font-size: 0.9rem; margin-bottom: 1rem;">
                        Please download the file to this location:
                    </p>
                    
                    <div style="background: rgba(0,0,0,0.4); border-radius: 10px; padding: 1rem; margin-bottom: 0.5rem;
                                border: 1px solid rgba(6,182,212,0.2); position: relative;">
                        <code id="downloadPathText" style="color: #06b6d4; font-size: 0.85rem; word-break: break-all; display: block; padding-right: 40px;">${downloadPath}</code>
                        <button id="copyPathBtn" style="position: absolute; top: 8px; right: 8px; background: rgba(6,182,212,0.2);
                                border: 1px solid rgba(6,182,212,0.4); border-radius: 6px; padding: 6px 10px; color: #06b6d4;
                                cursor: pointer; font-size: 0.75rem; transition: all 0.2s;" title="Copy path">
                            <i class="fas fa-copy"></i>
                        </button>
                    </div>
                    
                    <p style="color: #6b7280; font-size: 0.8rem; margin-bottom: 1.5rem;">
                        This ensures the app can find and read your downloaded books in the Library tab.
                    </p>
                    
                    <div style="display: flex; gap: 12px;">
                        <button id="cancelDownloadBtn" style="flex: 1; padding: 12px; background: rgba(255,255,255,0.1);
                                border: 1px solid rgba(255,255,255,0.2); border-radius: 10px; color: #fff;
                                font-weight: 500; cursor: pointer; transition: all 0.2s;">
                            Cancel
                        </button>
                        <button id="confirmDownloadBtn" style="flex: 1; padding: 12px; background: linear-gradient(135deg, #06b6d4, #0891b2);
                                border: none; border-radius: 10px; color: #fff; font-weight: 600; cursor: pointer;
                                display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.2s;">
                            <i class="fas fa-download"></i> Download
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Handle copy path
        document.getElementById('copyPathBtn').addEventListener('click', async () => {
            const pathText = document.getElementById('downloadPathText').textContent;
            try {
                await navigator.clipboard.writeText(pathText);
                const btn = document.getElementById('copyPathBtn');
                btn.innerHTML = '<i class="fas fa-check"></i>';
                btn.style.background = 'rgba(34,197,94,0.2)';
                btn.style.borderColor = 'rgba(34,197,94,0.4)';
                btn.style.color = '#22c55e';
                setTimeout(() => {
                    btn.innerHTML = '<i class="fas fa-copy"></i>';
                    btn.style.background = 'rgba(6,182,212,0.2)';
                    btn.style.borderColor = 'rgba(6,182,212,0.4)';
                    btn.style.color = '#06b6d4';
                }, 2000);
            } catch (err) {
                console.error('Failed to copy path:', err);
            }
        });
        
        // Handle cancel
        document.getElementById('cancelDownloadBtn').addEventListener('click', () => modal.remove());
        
        // Handle click outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
        
        // Handle download
        document.getElementById('confirmDownloadBtn').addEventListener('click', () => {
            const url = book.downloadlink || book.downloadUrl;
            if (url) {
                if (window.electronAPI && window.electronAPI.openExternal) {
                    window.electronAPI.openExternal(url);
                } else {
                    window.open(url, '_blank');
                }
            }
            modal.remove();
        });
    }

    // Create search result book card
    function createBookCard(book) {
        const card = document.createElement('div');
        card.className = 'book-card';
        
        const authors = Array.isArray(book.author) ? book.author.join(', ') : (book.author || 'Unknown Author');
        
        card.innerHTML = `
            <div class="book-title">${book.title || 'Unknown Title'}</div>
            <div class="book-author">${authors}</div>
            <div class="book-details">
                <span class="book-tag"><i class="fas fa-calendar"></i> ${book.year || 'N/A'}</span>
                <span class="book-tag"><i class="fas fa-language"></i> ${book.language || 'N/A'}</span>
                <span class="book-tag epub-highlight"><i class="fas fa-file"></i> ${book.fileExtension ? book.fileExtension.toUpperCase() : 'EPUB'}</span>
                <span class="book-tag"><i class="fas fa-hdd"></i> ${formatFileSize(book.fileSize)}</span>
            </div>
            <button class="download-btn">
                <i class="fas fa-download"></i> Download
            </button>
        `;
        
        // Handle download click - show modal
        card.querySelector('.download-btn').addEventListener('click', async () => {
            const btn = card.querySelector('.download-btn');
            const originalHTML = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Getting link...';
            
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
    }

    // Create library book card
    function createLibraryBookCard(book) {
        const card = document.createElement('div');
        card.className = 'book-card';
        
        const defaultCover = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMDZiNmQ0Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIxNHB4IiBmaWxsPSJ3aGl0ZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkJvb2s8L3RleHQ+PC9zdmc+';
        
        card.innerHTML = `
            <img src="${book.coverUrl || defaultCover}" alt="${book.title}" class="book-cover"
                 onerror="this.src='${defaultCover}'">
            <div class="book-title">${book.title || 'Unknown Title'}</div>
            <div class="book-author">${Array.isArray(book.author) ? book.author.join(', ') : (book.author || '')}</div>
            <div class="book-details">
                <span class="book-tag"><i class="fas fa-file"></i> EPUB</span>
                ${book.fileSize ? `<span class="book-tag"><i class="fas fa-hdd"></i> ${formatFileSize(book.fileSize)}</span>` : ''}
            </div>
            <button class="read-btn">
                <i class="fas fa-book-open"></i> Read
            </button>
        `;
        
        // Handle read click - open epub reader
        card.querySelector('.read-btn').addEventListener('click', () => {
            if (window.openEpubReader) {
                window.openEpubReader(book.localPath, book.title);
            } else {
                alert('EPUB reader not available. Please make sure the reader is loaded.');
            }
        });
        
        return card;
    }

    // Search books
    async function searchBooks(query) {
        const resultsContainer = document.getElementById('bookSearchResults');
        const loadingDiv = document.getElementById('bookSearchLoading');
        
        if (!query.trim() || !resultsContainer) return;

        try {
            loadingDiv.style.display = 'block';
            resultsContainer.innerHTML = '';

            const response = await fetch(`http://localhost:6987/libgen/search/${encodeURIComponent(query)}`);
            if (!response.ok) throw new Error('Search failed');

            const data = await response.json();
            loadingDiv.style.display = 'none';

            if (data.results && data.results.length > 0) {
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

                // Filter to show only EPUB files
                const epubBooks = transformedBooks.filter(book => 
                    book.fileExtension && book.fileExtension.toLowerCase() === 'epub'
                );

                if (epubBooks.length === 0) {
                    resultsContainer.innerHTML = `
                        <div class="search-placeholder">
                            <i class="fas fa-file-alt" style="font-size: 3rem; color: #06b6d4; margin-bottom: 1rem;"></i>
                            <h3>No EPUB Books Found</h3>
                            <p>No EPUB books found for "${query}". Try a different search term.</p>
                        </div>
                    `;
                    return;
                }

                resultsContainer.innerHTML = '';
                
                epubBooks.forEach(book => {
                    resultsContainer.appendChild(createBookCard(book));
                });
            } else {
                resultsContainer.innerHTML = `
                    <div class="search-placeholder">
                        <i class="fas fa-search" style="font-size: 3rem; color: #06b6d4; margin-bottom: 1rem;"></i>
                        <h3>No Books Found</h3>
                        <p>No books found for "${query}". Try a different search term.</p>
                    </div>
                `;
            }
        } catch (error) {
            console.error('[BookTorrio] Search error:', error);
            loadingDiv.style.display = 'none';
            resultsContainer.innerHTML = `
                <div class="search-placeholder">
                    <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: #dc3545; margin-bottom: 1rem;"></i>
                    <h3>Search Error</h3>
                    <p>Failed to search for books. Make sure the server is running.</p>
                </div>
            `;
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
            console.error('[BookTorrio] Failed to get download link:', err);
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

    // Load EPUB library
    async function loadEpubLibrary() {
        const libraryContent = document.getElementById('libraryTab');
        if (!libraryContent) return;

        try {
            // Show loading
            libraryContent.innerHTML = `
                <div style="text-align: center; padding: 3rem;">
                    <div class="spinner" style="margin: 0 auto 1rem;"></div>
                    <p style="color: #9ca3af;">Loading library...</p>
                </div>
            `;

            let books = [];
            
            // Try electronAPI first
            if (window.electronAPI && window.electronAPI.getEpubLibrary) {
                const result = await window.electronAPI.getEpubLibrary();
                if (result.success && result.books) {
                    books = result.books;
                }
            } else {
                // Fallback to API
                try {
                    const res = await fetch('http://localhost:6987/api/books/library');
                    const data = await res.json();
                    if (data.success && data.books) {
                        books = data.books;
                    }
                } catch (e) {
                    console.warn('[BookTorrio] API fallback failed:', e);
                }
            }

            if (books.length > 0) {
                libraryContent.innerHTML = '';
                
                // Create a grid container
                const grid = document.createElement('div');
                grid.className = 'books-grid';
                
                books.forEach(book => {
                    grid.appendChild(createLibraryBookCard(book));
                });
                
                libraryContent.appendChild(grid);
            } else {
                const path = await getEpubDownloadPath();
                libraryContent.innerHTML = `
                    <div class="search-placeholder">
                        <i class="fas fa-bookmark" style="font-size: 3rem; color: #06b6d4; margin-bottom: 1rem;"></i>
                        <h3>No Books in Library</h3>
                        <p>Downloaded EPUB books will appear here.</p>
                        <p style="margin-top: 0.5rem; font-size: 0.9rem; color: #6b7280;">
                            Download location: <code style="color: #06b6d4;">${path}</code>
                        </p>
                    </div>
                `;
            }
        } catch (error) {
            console.error('[BookTorrio] Error loading library:', error);
            libraryContent.innerHTML = `
                <div class="search-placeholder">
                    <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: #dc3545; margin-bottom: 1rem;"></i>
                    <h3>Error Loading Library</h3>
                    <p>Could not load your EPUB library. Please try again.</p>
                </div>
            `;
        }
    }

    // Initialize BookTorrio
    function initializeBookTorrio() {
        if (initialized) {
            console.log('[BookTorrio] Already initialized');
            return;
        }

        const searchInput = document.getElementById('bookSearchInput');
        const searchBtn = document.getElementById('searchBooksBtn');
        const searchTabBtn = document.getElementById('searchTabBtn');
        const libraryTabBtn = document.getElementById('libraryTabBtn');
        const searchTab = document.getElementById('searchTab');
        const libraryTab = document.getElementById('libraryTab');

        if (!searchInput || !searchBtn) {
            console.warn('[BookTorrio] Required elements not found');
            return;
        }

        console.log('[BookTorrio] Initializing...');

        // Search event listeners
        searchBtn.addEventListener('click', () => {
            const query = searchInput.value.trim();
            if (query) searchBooks(query);
        });

        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const query = searchInput.value.trim();
                if (query) searchBooks(query);
            }
        });

        // Tab switching
        if (searchTabBtn && libraryTabBtn && searchTab && libraryTab) {
            searchTabBtn.addEventListener('click', () => {
                searchTabBtn.classList.add('active');
                libraryTabBtn.classList.remove('active');
                searchTab.style.display = 'block';
                libraryTab.style.display = 'none';
            });

            libraryTabBtn.addEventListener('click', () => {
                libraryTabBtn.classList.add('active');
                searchTabBtn.classList.remove('active');
                libraryTab.style.display = 'block';
                searchTab.style.display = 'none';
                loadEpubLibrary();
            });
        }

        initialized = true;
        console.log('[BookTorrio] Initialized successfully');
    }

    // Export
    window.initializeBookTorrio = initializeBookTorrio;
    window.showBookDownloadModal = showDownloadModal;

    console.log('[BookTorrio] Module loaded');
})();
