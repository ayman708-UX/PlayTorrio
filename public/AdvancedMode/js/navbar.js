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
            // Only apply saved state if the item still exists in the navbar
            if (navbarState[id]) {
                navbarState[id].visible = parsed[id].visible;
            }
        });
    }
    
    // Apply the state (this will show new items that weren't in saved state)
    applyNavbarState();
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
    // Prevent recursion - check if we're already showing a notification
    if (window._showingNotification) return;
    window._showingNotification = true;
    
    try {
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
            setTimeout(() => {
                notification.remove();
                window._showingNotification = false;
            }, 300);
        }, 3000);
    } catch (e) {
        console.error('[Notification] Error:', e);
        window._showingNotification = false;
    }
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

    // Live Sports
    const liveSports = document.getElementById('liveSportsSection');
    if (liveSports) liveSports.style.setProperty('display', 'none', 'important');

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
        
        // Handle Play Magnet button
        if (itemId === 'play-magnet') {
            showPlayMagnetModal();
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
        } else if (itemId === 'live-sports') {
            showLiveSportsPage();
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

// Play Magnet Modal State
let currentMagnetLink = null;
let currentTorrentFiles = null;
let selectedFileIndex = null;
let magnetStreamUrl = null; // Renamed to avoid conflicts with other modules
let currentInfoHash = null;
let isDebridMode = false;

// Play Magnet Modal Functions
function showPlayMagnetModal() {
    const modal = document.getElementById('play-magnet-modal');
    const input = document.getElementById('magnet-link-input');
    if (modal) {
        modal.style.display = 'flex';
        modal.style.position = 'fixed';
        modal.style.top = '0';
        modal.style.left = '0';
        modal.style.width = '100%';
        modal.style.height = '100%';
        modal.style.background = 'rgba(0, 0, 0, 0.8)';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        modal.style.zIndex = '10000';
        if (input) {
            input.value = '';
            setTimeout(() => input.focus(), 100);
        }
    }
}

function hidePlayMagnetModal() {
    const modal = document.getElementById('play-magnet-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function showFileSelectionModal() {
    const modal = document.getElementById('file-selection-modal');
    const loadingState = document.getElementById('file-loading-state');
    const fileList = document.getElementById('file-list-container');
    const actions = document.getElementById('file-modal-actions');
    
    if (modal) {
        // Show modal immediately with loading state
        modal.style.display = 'flex';
        if (loadingState) loadingState.style.display = 'flex';
        if (fileList) fileList.style.display = 'none';
        if (actions) actions.style.display = 'none';
    }
}

function showFileList() {
    const loadingState = document.getElementById('file-loading-state');
    const fileList = document.getElementById('file-list-container');
    
    if (loadingState) loadingState.style.display = 'none';
    if (fileList) fileList.style.display = 'block';
}

async function hideFileSelectionModal() {
    const modal = document.getElementById('file-selection-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    // Clear cache when exiting file selection
    await clearCacheAfterMagnet();
}

async function clearCacheAfterMagnet() {
    try {
        console.log('[Magnet] Clearing cache...');
        // Stop all torrent engines
        await fetch('http://localhost:6987/api/alt-stop-all', { method: 'POST' });
        
        // Clear cache via electron API if available
        if (window.electronAPI?.clearCache) {
            await window.electronAPI.clearCache();
        }
        console.log('[Magnet] Cache cleared');
    } catch (e) {
        console.warn('[Magnet] Failed to clear cache:', e);
    }
}

async function getDebridSettings() {
    try {
        const response = await fetch('/api/settings');
        if (!response.ok) return { useDebrid: false };
        const settings = await response.json();
        return {
            useDebrid: !!settings.useDebrid,
            debridProvider: settings.debridProvider || 'realdebrid',
            debridAuth: settings.debridAuth || null
        };
    } catch (e) {
        console.error('[Debrid] Failed to get settings:', e);
        return { useDebrid: false };
    }
}

// Resolve torrent URL to magnet link (same as play.html)
async function resolveTorrent(url, title) {
    if (!url || !url.startsWith('http')) return url;
    // If it's already a magnet, no need to resolve
    if (url.startsWith('magnet:')) return url;
    try {
        const res = await fetch(`/api/resolve-torrent-file?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title || '')}`);
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            console.error('[resolveTorrent] Server error:', errData.error || res.status);
            return null;
        }
        const data = await res.json();
        if (data.error) {
            console.error('[resolveTorrent] Resolution error:', data.error);
            return null;
        }
        if (data.magnet) {
            return data.magnet;
        }
        console.warn('[resolveTorrent] No magnet returned from resolution');
        return null;
    } catch (err) {
        console.error('[resolveTorrent] Failed to resolve torrent:', err);
        return null;
    }
}

async function handleMagnetPlay() {
    const input = document.getElementById('magnet-link-input');
    let magnetLink = input?.value.trim();
    
    if (!magnetLink) {
        showNotification('Please enter a magnet link', 'error');
        return;
    }
    
    hidePlayMagnetModal();
    
    // Resolve torrent if it's a download URL (same logic as play.html)
    const needsResolution = magnetLink.startsWith('http') && !magnetLink.startsWith('magnet:') && (
        magnetLink.includes('.torrent') ||
        magnetLink.includes('jackett') ||
        magnetLink.includes('prowlarr') ||
        magnetLink.includes('/download/') ||
        magnetLink.includes('/torrent/')
    );
    
    if (needsResolution) {
        showNotification('Resolving torrent...', 'info');
        console.log('[Torrent] Resolving download URL:', magnetLink.substring(0, 100) + '...');
        magnetLink = await resolveTorrent(magnetLink, 'Manual Torrent');
        
        if (!magnetLink) {
            showNotification('Failed to resolve torrent link', 'error');
            return;
        }
        
        if (!magnetLink.startsWith('magnet:')) {
            console.error('[Torrent] Resolution failed to return a magnet link:', magnetLink.substring(0, 100));
            showNotification('Could not extract magnet link from this torrent', 'error');
            return;
        }
        
        console.log('[Torrent] Resolved to magnet:', magnetLink.substring(0, 80) + '...');
    }
    
    // Final validation: ensure we have a magnet link
    if (!magnetLink.startsWith('magnet:')) {
        console.error('[Torrent] Not a magnet link:', magnetLink.substring(0, 100));
        showNotification('Invalid torrent link. Expected a magnet link.', 'error');
        return;
    }
    
    currentMagnetLink = magnetLink;
    
    // Check debrid settings
    const debridSettings = await getDebridSettings();
    
    if (debridSettings.useDebrid && debridSettings.debridAuth) {
        // Use Debrid
        await handleDebridMagnet(magnetLink, debridSettings);
    } else {
        // Use Torrent Engine
        await handleTorrentEngineMagnet(magnetLink);
    }
}

async function handleDebridMagnet(magnetLink, debridSettings) {
    try {
        // Show modal immediately with loading state
        showFileSelectionModal();
        
        console.log('[Debrid] Preparing magnet with provider:', debridSettings.debridProvider);
        
        // Add magnet to debrid using the correct endpoint
        const prepareResponse = await fetch('/api/debrid/prepare', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ magnet: magnetLink })
        });
        
        if (!prepareResponse.ok) {
            throw new Error('Failed to prepare magnet with debrid');
        }
        
        const data = await prepareResponse.json();
        console.log('[Debrid] Prepare response:', data);
        
        if (!data || !data.info) {
            throw new Error('Invalid response from debrid service');
        }
        
        const info = data.info;
        const files = info.files || [];
        
        console.log('[Debrid] Found', files.length, 'files');
        
        currentTorrentFiles = files.map((file, index) => ({
            name: file.path || file.filename || file.name || `File ${file.id || index + 1}`,
            size: file.bytes || file.size || 0,
            index: index,
            id: file.id,
            links: file.links,
            selected: file.selected
        }));
        
        // Store info for later unrestrict
        window._debridInfo = info;
        currentInfoHash = info.id || data.id;
        isDebridMode = true;
        
        if (currentTorrentFiles.length === 0) {
            hideFileSelectionModal();
            showNotification('No files found in torrent', 'error');
            return;
        }
        
        // Display files
        displayFileList(currentTorrentFiles, true);
        showFileList();
        
    } catch (error) {
        console.error('[Debrid] Error:', error);
        hideFileSelectionModal();
        showNotification('Debrid error: ' + error.message, 'error');
    }
}

async function handleTorrentEngineMagnet(magnetLink) {
    try {
        // Show modal immediately with loading state
        showFileSelectionModal();
        
        console.log('[TorrentEngine] Starting with magnet:', magnetLink.substring(0, 80));
        
        // Check which engine is configured
        let engineConfig = { engine: 'stremio' };
        try {
            const configRes = await fetch('/api/torrent-engine/config');
            if (configRes.ok) {
                engineConfig = await configRes.json();
            }
        } catch (e) {
            console.warn('[TorrentEngine] Failed to get engine config, defaulting to stremio');
        }
        
        const isAltEngine = engineConfig.engine !== 'stremio';
        const apiEndpoint = isAltEngine ? '/api/alt-torrent-files' : '/api/torrent-files';
        
        console.log('[TorrentEngine] Using', engineConfig.engine, 'engine via', apiEndpoint);
        
        const response = await fetch(`${apiEndpoint}?magnet=${encodeURIComponent(magnetLink)}`);
        
        console.log('[TorrentEngine] Response status:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('[TorrentEngine] Server error:', errorText);
            throw new Error('Failed to fetch torrent metadata: ' + response.status);
        }
        
        const data = await response.json();
        console.log('[TorrentEngine] Response data:', data);
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        currentTorrentFiles = data.videoFiles || [];
        currentInfoHash = data.infoHash;
        isDebridMode = false;
        
        console.log('[TorrentEngine] Found', currentTorrentFiles.length, 'video files');
        
        if (currentTorrentFiles.length === 0) {
            hideFileSelectionModal();
            showNotification('No video files found in torrent', 'error');
            return;
        }
        
        // Display files
        displayFileList(currentTorrentFiles, false);
        showFileList();
        
    } catch (error) {
        console.error('[TorrentEngine] Error:', error);
        hideFileSelectionModal();
        showNotification('Torrent error: ' + error.message, 'error');
    }
}

function displayFileList(files, isDebrid) {
    const container = document.getElementById('file-list-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    files.forEach((file, index) => {
        const fileDiv = document.createElement('div');
        fileDiv.style.cssText = `
            padding: 16px;
            margin-bottom: 12px;
            background: rgba(255,255,255,0.05);
            border: 2px solid rgba(255,255,255,0.1);
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
        `;
        
        const fileName = file.name || file.path || `File ${index + 1}`;
        const fileSize = file.size ? formatFileSize(file.size) : 'Unknown size';
        
        fileDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="flex: 1;">
                    <div style="color: #fff; font-size: 15px; margin-bottom: 4px;">${fileName}</div>
                    <div style="color: rgba(255,255,255,0.6); font-size: 13px;">${fileSize}</div>
                </div>
                <div style="width: 24px; height: 24px; border: 2px solid rgba(255,255,255,0.3); border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                    <div class="file-check" style="width: 14px; height: 14px; background: #667eea; border-radius: 50%; display: none;"></div>
                </div>
            </div>
        `;
        
        fileDiv.addEventListener('click', () => selectFile(index, fileDiv));
        fileDiv.addEventListener('mouseenter', () => {
            if (selectedFileIndex !== index) {
                fileDiv.style.background = 'rgba(255,255,255,0.08)';
                fileDiv.style.borderColor = 'rgba(255,255,255,0.2)';
            }
        });
        fileDiv.addEventListener('mouseleave', () => {
            if (selectedFileIndex !== index) {
                fileDiv.style.background = 'rgba(255,255,255,0.05)';
                fileDiv.style.borderColor = 'rgba(255,255,255,0.1)';
            }
        });
        
        container.appendChild(fileDiv);
    });
}

async function selectFile(index, fileDiv) {
    // Remove previous selection
    document.querySelectorAll('#file-list-container > div').forEach(div => {
        div.style.background = 'rgba(255,255,255,0.05)';
        div.style.borderColor = 'rgba(255,255,255,0.1)';
        const check = div.querySelector('.file-check');
        if (check) check.style.display = 'none';
    });
    
    // Highlight selected
    fileDiv.style.background = 'rgba(102, 126, 234, 0.2)';
    fileDiv.style.borderColor = 'rgba(102, 126, 234, 0.6)';
    const check = fileDiv.querySelector('.file-check');
    if (check) check.style.display = 'block';
    
    selectedFileIndex = index;
    
    // Get stream link
    if (isDebridMode) {
        await getDebridStreamLink(index);
    } else {
        await getTorrentStreamLink(index);
    }
    
    // Show action buttons
    const actions = document.getElementById('file-modal-actions');
    if (actions) actions.style.display = 'flex';
}

async function getDebridStreamLink(fileIndex) {
    try {
        const debridSettings = await getDebridSettings();
        const file = currentTorrentFiles[fileIndex];
        const info = window._debridInfo;
        
        console.log('[Debrid] Getting stream link for file:', file.name);
        
        // Get the file link (same logic as play.js)
        let fileLink = (file.links && file.links[0]) || null;
        
        // Real-Debrid Fallback: links are in info.links, not per-file
        if (!fileLink && debridSettings.debridProvider === 'realdebrid' && info.links && info.links.length > 0) {
            const selectedFiles = currentTorrentFiles.filter(f => f.selected === 1);
            const linkIndex = selectedFiles.findIndex(f => f.index === fileIndex);
            
            if (linkIndex !== -1 && info.links[linkIndex]) {
                fileLink = info.links[linkIndex];
                console.log(`[Debrid] RD Link matched via selected-index [${linkIndex}]: ${fileLink}`);
            } else {
                console.warn('[Debrid] Target file not found in selected files list or link missing.');
            }
        }
        
        if (!fileLink) {
            throw new Error('No direct link available for this file yet');
        }
        
        // Unrestrict the link
        console.log('[Debrid] Unrestricting link...');
        const response = await fetch('/api/debrid/link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ link: fileLink })
        });
        
        if (!response.ok) {
            throw new Error('Failed to unrestrict link from debrid');
        }
        
        const data = await response.json();
        
        if (!data.url) {
            throw new Error(data.error || 'No stream URL returned from debrid');
        }
        
        magnetStreamUrl = data.url;
        console.log('[Debrid] Stream URL:', magnetStreamUrl);
        
    } catch (error) {
        console.error('[Debrid] Error getting stream link:', error);
        showNotification('Failed to get stream link: ' + error.message, 'error');
    }
}

async function getTorrentStreamLink(fileIndex) {
    try {
        // Check which engine is configured
        let engineConfig = { engine: 'stremio' };
        try {
            const configRes = await fetch('/api/torrent-engine/config');
            if (configRes.ok) {
                engineConfig = await configRes.json();
            }
        } catch (e) {}
        
        const isAltEngine = engineConfig.engine !== 'stremio';
        const streamEndpoint = isAltEngine ? '/api/alt-stream-file' : '/api/stream-file';
        const prepareEndpoint = isAltEngine ? '/api/alt-prepare-file' : '/api/prepare-file';
        
        const file = currentTorrentFiles[fileIndex];
        magnetStreamUrl = `${window.location.origin}${streamEndpoint}?hash=${currentInfoHash}&file=${file.index}`;
        
        // Prepare the file for streaming
        fetch(`${prepareEndpoint}?hash=${currentInfoHash}&file=${file.index}`).catch(() => {});
        
        console.log('[TorrentEngine] Stream URL:', magnetStreamUrl);
        
    } catch (error) {
        console.error('[TorrentEngine] Error getting stream link:', error);
        showNotification('Failed to get stream link', 'error');
    }
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function copyStreamLink() {
    if (!magnetStreamUrl) {
        showNotification('No stream link available', 'error');
        return;
    }
    
    try {
        await navigator.clipboard.writeText(magnetStreamUrl);
        showNotification('Stream link copied to clipboard!', 'success');
    } catch (error) {
        console.error('[Copy] Error:', error);
        showNotification('Failed to copy link', 'error');
    }
}

async function playSelectedFile() {
    if (!magnetStreamUrl) {
        showNotification('No stream link available', 'error');
        return;
    }
    
    try {
        console.log('[Play] Opening stream:', magnetStreamUrl);
        
        // Use PlayTorrioPlayer just like IPTV does
        const response = await fetch('/api/playtorrioplayer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                url: magnetStreamUrl,
                stopOnClose: !isDebridMode // Only stop torrent engine streams, not debrid
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification('Playing...', 'success');
            // Don't close the modal - let user close it manually with back button
        } else {
            throw new Error(result.error || 'Failed to open player');
        }
        
    } catch (error) {
        console.error('[Play] Error:', error);
        showNotification('Failed to play: ' + error.message, 'error');
    }
}

// Play Magnet Modal Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    const cancelBtn = document.getElementById('magnet-cancel-btn');
    const playBtn = document.getElementById('magnet-play-btn');
    const modal = document.getElementById('play-magnet-modal');
    const input = document.getElementById('magnet-link-input');
    
    // File selection modal elements
    const fileModal = document.getElementById('file-selection-modal');
    const fileModalBackBtn = document.getElementById('file-modal-back-btn');
    const fileCopyLinkBtn = document.getElementById('file-copy-link-btn');
    const filePlayBtn = document.getElementById('file-play-btn');
    
    if (cancelBtn) {
        cancelBtn.addEventListener('click', hidePlayMagnetModal);
    }
    
    if (playBtn) {
        playBtn.addEventListener('click', handleMagnetPlay);
    }
    
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                hidePlayMagnetModal();
            }
        });
    }
    
    if (fileModalBackBtn) {
        fileModalBackBtn.addEventListener('click', hideFileSelectionModal);
    }
    
    if (fileModal) {
        // Don't close on background click - force user to use back button
        fileModal.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }
    
    if (fileCopyLinkBtn) {
        fileCopyLinkBtn.addEventListener('click', copyStreamLink);
    }
    
    if (filePlayBtn) {
        filePlayBtn.addEventListener('click', playSelectedFile);
    }
    
    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (modal?.style.display === 'flex') {
                hidePlayMagnetModal();
            }
            if (fileModal?.style.display === 'flex') {
                hideFileSelectionModal();
            }
        }
    });
});

