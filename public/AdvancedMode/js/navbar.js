// Navbar functionality
const navbar = document.getElementById('navbar');
const contextMenu = document.getElementById('contextMenu');
const contextMenuList = document.getElementById('contextMenuList');
const navbarMenu = document.getElementById('navbarMenu');

// Store navbar item visibility state
let navbarState = {};

// Initialize navbar state
function initNavbarState() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        const id = item.getAttribute('data-id');
        const iconEl = item.querySelector('.nav-icon svg');
        navbarState[id] = {
            visible: true,
            label: item.querySelector('.nav-label').textContent,
            iconSvg: iconEl ? iconEl.outerHTML : ''
        };
    });
    
    // Load saved state from localStorage and merge
    const savedState = localStorage.getItem('navbarState');
    if (savedState) {
        const parsed = JSON.parse(savedState);
        Object.keys(parsed).forEach(id => {
            if (navbarState[id]) {
                navbarState[id].visible = parsed[id].visible;
            }
        });
        applyNavbarState();
    }
}

// Apply navbar state (show/hide items)
function applyNavbarState() {
    Object.keys(navbarState).forEach(id => {
        const item = document.querySelector(`.nav-item[data-id="${id}"]`);
        if (item) {
            item.style.display = navbarState[id].visible ? 'block' : 'none';
        }
    });
}

// Save navbar state to localStorage
function saveNavbarState() {
    localStorage.setItem('navbarState', JSON.stringify(navbarState));
}

// Build context menu
function buildContextMenu() {
    contextMenuList.innerHTML = '';
    
    Object.keys(navbarState).forEach(id => {
        const item = navbarState[id];
        const li = document.createElement('li');
        li.className = 'context-menu-item';
        li.innerHTML = `
            <span class="context-menu-icon">${item.iconSvg || ''}</span>
            <span class="context-menu-label">${item.label}</span>
            <span class="context-menu-check">${item.visible ? '✓' : ''}</span>
        `;
        
        li.addEventListener('click', () => {
            toggleNavbarItem(id);
        });
        
        contextMenuList.appendChild(li);
    });
}

// Toggle navbar item visibility
function toggleNavbarItem(id) {
    navbarState[id].visible = !navbarState[id].visible;
    applyNavbarState();
    buildContextMenu();
    saveNavbarState();
}

// Show context menu
function showContextMenu(x, y) {
    buildContextMenu();
    contextMenu.style.display = 'block';
    
    // Get dimensions after showing
    const menuWidth = contextMenu.offsetWidth;
    const menuHeight = contextMenu.offsetHeight;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    // Adjust horizontal position
    let finalX = x;
    if (x + menuWidth > windowWidth) {
        finalX = windowWidth - menuWidth - 10;
    }
    
    // Adjust vertical position
    let finalY = y;
    if (y + menuHeight > windowHeight) {
        finalY = windowHeight - menuHeight - 10;
    }
    
    contextMenu.style.left = finalX + 'px';
    contextMenu.style.top = finalY + 'px';
}

// Hide context menu
function hideContextMenu() {
    contextMenu.style.display = 'none';
}

// Right-click on navbar items
navbar.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY);
});

// Click outside to close context menu
document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target) && !navbar.contains(e.target)) {
        hideContextMenu();
    }
});

// Refresh button functionality
document.getElementById('refreshBtn').addEventListener('click', () => {
    location.reload();
});

// Clear Cache button functionality
document.addEventListener('click', (e) => {
    const navBtn = e.target.closest('.nav-btn');
    if (navBtn) {
        const navItem = navBtn.closest('.nav-item');
        const itemId = navItem?.getAttribute('data-id');
        
        if (itemId === 'clear-cache') {
            e.preventDefault();
            e.stopPropagation();
            clearCache();
            return;
        }
    }
});

async function clearCache() {
    if (window.electronAPI?.clearCache) {
        try {
            const result = await window.electronAPI.clearCache();
            showNotification(result.message || 'Cache cleared successfully!', result.success ? 'success' : 'error');
            if (result.success) {
                setTimeout(() => location.reload(), 1000);
            }
        } catch (error) {
            console.error('Error clearing cache:', error);
            showNotification('Failed to clear cache', 'error');
        }
    } else {
        showNotification('Cache clearing not available in browser mode', 'info');
    }
}

function showNotification(message, type = 'success') {
    // Add keyframes if not already added
    if (!document.getElementById('notification-keyframes')) {
        const style = document.createElement('style');
        style.id = 'notification-keyframes';
        style.textContent = `
            @keyframes slideIn {
                from {
                    transform: translateX(400px);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            @keyframes slideOut {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(400px);
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);
    }
    
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 50px;
        right: 20px;
        background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
        color: white;
        padding: 16px 24px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 10001;
        font-size: 14px;
        font-weight: 500;
        animation: slideIn 0.3s ease-out;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Hide all main content sections
function hideAllSections() {
    // TMDB / Home related
    const hero = document.getElementById('heroSection');
    const content = document.querySelector('.content-wrapper');
    const spotlight = document.getElementById('spotlightSection');
    if (hero) hero.style.setProperty('display', 'none', 'important');
    if (content) content.style.setProperty('display', 'none', 'important');
    if (spotlight) spotlight.style.setProperty('display', 'none', 'important');

    // Search Page
    const searchPage = document.getElementById('searchPageContainer');
    if (searchPage) searchPage.style.setProperty('display', 'none', 'important');

    // Genres Page
    const genresPage = document.getElementById('genresPageContainer');
    const genreBrowse = document.getElementById('genreBrowsePageContainer');
    if (genresPage) genresPage.style.setProperty('display', 'none', 'important');
    if (genreBrowse) genreBrowse.style.setProperty('display', 'none', 'important');

    // Comics
    const comics = document.getElementById('comicsSection');
    if (comics) comics.style.setProperty('display', 'none', 'important');

    // Manga
    const manga = document.getElementById('mangaSection');
    const mangaWarning = document.getElementById('mangaWarningModal');
    if (manga) manga.style.setProperty('display', 'none', 'important');
    if (mangaWarning) mangaWarning.classList.remove('active');

    // Downloader
    const downloader = document.getElementById('downloaderSection');
    if (downloader) downloader.style.setProperty('display', 'none', 'important');
    
    // Music
    const music = document.getElementById('musicSection');
    if (music) music.style.setProperty('display', 'none', 'important');
    
    // Audiobooks
    const audiobooks = document.getElementById('audiobooksSection');
    if (audiobooks) audiobooks.style.setProperty('display', 'none', 'important');
    
    // Books
    const books = document.getElementById('booksSection');
    if (books) books.style.setProperty('display', 'none', 'important');
    
    // Live TV
    const liveTv = document.getElementById('liveTvSection');
    if (liveTv) liveTv.style.setProperty('display', 'none', 'important');
    
    // Scroll to top
    window.scrollTo(0, 0);
}

// Show Home Page
function showHomePage() {
    hideAllSections();
    const hero = document.getElementById('heroSection');
    const content = document.querySelector('.content-wrapper');
    const spotlight = document.getElementById('spotlightSection');
    if (hero) hero.style.setProperty('display', 'block', 'important');
    if (content) content.style.setProperty('display', 'block', 'important');
    if (spotlight) spotlight.style.setProperty('display', 'block', 'important');
}

// Navigation handlers
document.addEventListener('click', (e) => {
    const navBtn = e.target.closest('.nav-btn');
    if (navBtn) {
        const navItem = navBtn.closest('.nav-item');
        const itemId = navItem?.getAttribute('data-id');
        
        // Skip navigation for action buttons
        if (itemId === 'clear-cache' || itemId === 'refresh') {
            return;
        }
        
        // Show coming soon for games downloader
        if (itemId === 'games-downloader') {
            showNotification('Games Downloader - Coming Soon!', 'info');
            return;
        }
        
        // Update active state
        document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
        if (navItem) navItem.classList.add('active');
        
        // Clear hash when navigating via navbar to prevent sticky genre views
        if (window.location.hash) {
            history.pushState("", document.title, window.location.pathname + window.location.search);
        }
        
        if (itemId === 'search') {
            showSearchPage();
        } else if (itemId === 'home') {
            showHomePage();
        } else if (itemId === 'genres') {
            showGenresPage();
        } else if (itemId === 'comics') {
            showComicsPage();
        } else if (itemId === 'manga') {
            showMangaPage();
        } else if (itemId === 'media-downloader') {
            showMediaDownloaderPage();
        } else if (itemId === 'music') {
            showMusicPage();
        } else if (itemId === 'audiobooks') {
            showAudiobooksPage();
        } else if (itemId === 'books') {
            showBooksPage();
        } else if (itemId === 'live-tv') {
            showLiveTvPage();
        } else if (itemId === 'iptv') {
            window.location.href = 'iptv.html';
        } else if (itemId === 'settings') {
            // Navigate to settings page
            window.location.href = 'settings.html';
        }
    }
});

// Set initial active state
function setInitialActive() {
    const homeItem = document.querySelector('.nav-item[data-id="home"]');
    if (homeItem) homeItem.classList.add('active');
}

// Initialize
initNavbarState();
setInitialActive();

// Settings Modal Functions
function openSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

function closeSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

// Settings Modal Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('close-settings-modal');
    const modal = document.getElementById('settings-modal');
    const streamingToggle = document.getElementById('streaming-mode-toggle');
    
    if (closeBtn) {
        closeBtn.addEventListener('click', closeSettingsModal);
    }
    
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeSettingsModal();
            }
        });
    }
    
    if (streamingToggle && window.streamingMode) {
        // Load current setting
        streamingToggle.checked = window.streamingMode.enabled();
        
        // Save on change
        streamingToggle.addEventListener('change', (e) => {
            window.streamingMode.setEnabled(e.target.checked);
        });
    }
    
    // Initialize streaming mode UI
    if (window.streamingMode && window.streamingMode.init) {
        window.streamingMode.init();
    }
});
