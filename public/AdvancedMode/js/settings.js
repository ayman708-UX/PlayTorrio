// Settings Page Logic
const API_BASE = '/api';

// ============================================================================
// Utility Functions
// ============================================================================

function showNotification(message, type = 'success') {
    const container = document.getElementById('notification-container');
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    container.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// ============================================================================
// API Functions
// ============================================================================

async function getSettings() {
    try {
        const response = await fetch(`${API_BASE}/settings`);
        if (response.ok) {
            return await response.json();
        }
    } catch (e) {
        console.error('[Settings] Failed to fetch settings', e);
    }
    return {};
}

async function saveSettings(settings) {
    try {
        const response = await fetch(`${API_BASE}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        return response.ok;
    } catch (e) {
        console.error('[Settings] Failed to save settings', e);
        return false;
    }
}

async function getJackettKey() {
    try {
        const response = await fetch(`${API_BASE}/get-jackett-api-key`);
        if (response.ok) {
            const data = await response.json();
            return data.apiKey || '';
        }
    } catch (e) {
        console.error('[Settings] Failed to fetch Jackett key', e);
    }
    return '';
}

async function setJackettKey(apiKey) {
    try {
        const response = await fetch(`${API_BASE}/set-jackett-api-key`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey })
        });
        return response.ok;
    } catch (e) {
        console.error('[Settings] Failed to save Jackett key', e);
        return false;
    }
}

async function getProwlarrKey() {
    try {
        const response = await fetch(`${API_BASE}/get-prowlarr-api-key`);
        if (response.ok) {
            const data = await response.json();
            return data.apiKey || '';
        }
    } catch (e) {
        console.error('[Settings] Failed to fetch Prowlarr key', e);
    }
    return '';
}

async function setProwlarrKey(apiKey) {
    try {
        const response = await fetch(`${API_BASE}/set-prowlarr-api-key`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey })
        });
        return response.ok;
    } catch (e) {
        console.error('[Settings] Failed to save Prowlarr key', e);
        return false;
    }
}

// ============================================================================
// Stremio Addons
// ============================================================================

async function getStremioAddons() {
    if (window.electronAPI?.addonList) {
        const res = await window.electronAPI.addonList();
        return res.success ? res.addons : [];
    } else {
        // Fallback
        const stored = localStorage.getItem('stremio_addons');
        return stored ? JSON.parse(stored) : [];
    }
}

async function addStremioAddon(url) {
    if (window.electronAPI?.addonInstall) {
        const res = await window.electronAPI.addonInstall(url);
        if (!res.success) throw new Error(res.message);
        return res.addon;
    } else {
        // Fallback: fetch manifest, validate, save to localStorage
        const response = await fetch(url);
        const manifest = await response.json();
        const newAddon = {
            manifestUrl: url,
            url: url,
            id: manifest.id || url,
            name: manifest.name || 'Unknown Addon',
            manifest: manifest,
            baseUrl: url.replace('/manifest.json', ''),
            transportUrl: manifest.transportUrl || url.replace('/manifest.json', '')
        };
        const addons = await getStremioAddons();
        addons.push(newAddon);
        localStorage.setItem('stremio_addons', JSON.stringify(addons));
        return newAddon;
    }
}

async function removeStremioAddon(addonId) {
    if (window.electronAPI?.addonRemove) {
        await window.electronAPI.addonRemove(addonId);
    } else {
        // Fallback: remove from localStorage by ID
        const addons = await getStremioAddons();
        const filtered = addons.filter(a => (a.manifest?.id || a.id) !== addonId);
        localStorage.setItem('stremio_addons', JSON.stringify(filtered));
    }
}

async function renderStremioAddons() {
    const list = document.getElementById('installed-addons-list');
    list.innerHTML = '';
    
    const addons = await getStremioAddons();
    console.log('[Settings] Loaded Stremio addons:', addons);
    
    if (addons.length === 0) {
        list.innerHTML = '<div class="no-addons">No addons installed</div>';
        return;
    }
    
    addons.forEach(addon => {
        const name = addon.name || addon.manifest?.name || 'Unknown Addon';
        const addonId = addon.manifest?.id || addon.id;
        
        const item = document.createElement('div');
        item.className = 'addon-item';
        item.innerHTML = `
            <span class="addon-name">${name}</span>
            <button class="addon-remove-btn" data-id="${addonId}">Remove</button>
        `;
        
        list.appendChild(item);
    });
    
    // Add event listeners to remove buttons
    list.querySelectorAll('.addon-remove-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const addonId = e.target.getAttribute('data-id');
            try {
                await removeStremioAddon(addonId);
                await renderStremioAddons();
                showNotification('Addon removed successfully', 'success');
            } catch (error) {
                console.error('[Settings] Failed to remove addon', error);
                showNotification('Failed to remove addon', 'error');
            }
        });
    });
}

// ============================================================================
// Debrid Settings
// ============================================================================

let debridSettings = {};

async function initDebridUI() {
    const useDebridToggle = document.getElementById('use-debrid-toggle');
    const debridConfigContainer = document.getElementById('debrid-config-container');
    const providerSelect = document.getElementById('debrid-provider-select');
    const rdAuthSection = document.getElementById('rd-auth-section');
    const apiKeySection = document.getElementById('api-key-section');
    const rdLoginBtn = document.getElementById('rd-login-btn');
    const rdStatus = document.getElementById('rd-status');
    const debridApiInput = document.getElementById('debrid-api-input');

    // Load initial state
    debridSettings = await getSettings();
    const useDebrid = !!debridSettings.useDebrid;
    useDebridToggle.checked = useDebrid;
    
    if (useDebrid) {
        debridConfigContainer.classList.add('active');
    }

    if (debridSettings.debridProvider) {
        providerSelect.value = debridSettings.debridProvider;
    }

    const updateUI = (provider) => {
        // Reset specific UI elements
        rdAuthSection.style.display = 'none';
        apiKeySection.style.display = 'none';
        rdStatus.textContent = 'Not logged in';
        rdStatus.className = 'status-badge status-error';
        debridApiInput.value = '';

        if (provider === 'realdebrid') {
            rdAuthSection.style.display = 'block';
            if (debridSettings.debridAuth && debridSettings.debridProvider === 'realdebrid') {
                rdStatus.textContent = 'Logged in';
                rdStatus.className = 'status-badge status-success';
                rdLoginBtn.textContent = 'Logout';
                rdLoginBtn.classList.remove('btn-success');
                rdLoginBtn.style.background = 'rgba(239, 68, 68, 0.2)';
                rdLoginBtn.style.borderColor = 'rgba(239, 68, 68, 0.4)';
                rdLoginBtn.style.color = 'rgba(239, 68, 68, 0.9)';
            } else {
                rdLoginBtn.textContent = 'Login with Real-Debrid';
                rdLoginBtn.classList.add('btn-success');
                rdLoginBtn.style.background = '';
                rdLoginBtn.style.borderColor = '';
                rdLoginBtn.style.color = '';
            }
        } else {
            apiKeySection.style.display = 'block';
            if (debridSettings.debridAuth && debridSettings.debridProvider === provider) {
                debridApiInput.placeholder = 'Saved (Enter new to overwrite)';
            } else {
                debridApiInput.placeholder = 'Enter API Key';
            }
        }
    };

    // Event Listeners
    useDebridToggle.addEventListener('change', (e) => {
        if (e.target.checked) {
            debridConfigContainer.classList.add('active');
        } else {
            debridConfigContainer.classList.remove('active');
        }
        saveSettings({ useDebrid: e.target.checked });
    });

    providerSelect.addEventListener('change', async (e) => {
        const provider = e.target.value;
        debridSettings.debridProvider = provider;
        debridSettings.debridAuth = false;
        updateUI(provider);
        await saveSettings({ debridProvider: provider });
        
        // Refresh settings
        debridSettings = await getSettings();
        updateUI(provider);
    });

    debridApiInput.addEventListener('change', async (e) => {
        const provider = providerSelect.value;
        const key = e.target.value.trim();
        if (!key) return;

        let endpoint = '';
        let body = {};

        if (provider === 'alldebrid') {
            endpoint = '/api/debrid/ad/apikey';
            body = { apikey: key };
        } else if (provider === 'torbox') {
            endpoint = '/api/debrid/tb/token';
            body = { token: key };
        } else if (provider === 'premiumize') {
            endpoint = '/api/debrid/pm/apikey';
            body = { apikey: key };
        }

        if (endpoint) {
            try {
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                if (res.ok) {
                    debridApiInput.value = '';
                    debridApiInput.placeholder = 'Saved!';
                    showNotification('API key saved successfully', 'success');
                    debridSettings = await getSettings();
                } else {
                    showNotification('Failed to save API key', 'error');
                }
            } catch (err) {
                console.error(err);
                showNotification('Error saving API key', 'error');
            }
        }
    });

    rdLoginBtn.addEventListener('click', async () => {
        if (rdLoginBtn.textContent === 'Logout') {
            await fetch('/api/debrid/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: '' })
            });
            
            debridSettings.debridAuth = false;
            updateUI('realdebrid');
            showNotification('Logged out successfully', 'success');
        } else {
            startRDDeviceFlow();
        }
    });

    const startRDDeviceFlow = async () => {
        rdLoginBtn.disabled = true;
        rdLoginBtn.textContent = 'Connecting...';
        try {
            const res = await fetch(`${API_BASE}/debrid/rd/device-code`);
            const data = await res.json();
            
            if (data.user_code) {
                // Copy code to clipboard
                if (window.electronAPI?.copyToClipboard) {
                    window.electronAPI.copyToClipboard(data.user_code);
                } else {
                    navigator.clipboard.writeText(data.user_code);
                }
                
                // Open verification URL
                if (window.electronAPI?.openExternal) {
                    window.electronAPI.openExternal(`https://real-debrid.com/device?code=${data.user_code}`);
                } else {
                    window.open(`https://real-debrid.com/device?code=${data.user_code}`, '_blank');
                }

                rdStatus.textContent = `Code: ${data.user_code} (Copied)`;
                rdLoginBtn.textContent = 'Waiting...';

                // Poll for token
                pollRDToken(data.device_code, data.interval);
            }
        } catch (e) {
            console.error('[Settings] RD Login failed', e);
            rdLoginBtn.textContent = 'Error';
            rdLoginBtn.disabled = false;
            showNotification('Failed to start login flow', 'error');
        }
    };

    const pollRDToken = async (deviceCode, interval) => {
        const pollInterval = setInterval(async () => {
            try {
                const res = await fetch(`${API_BASE}/debrid/rd/poll`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ device_code: deviceCode })
                });
                
                let data = {};
                try {
                    data = await res.json();
                } catch (e) {
                    return;
                }
                
                if (data.success || (res.ok && !data.error)) {
                    clearInterval(pollInterval);
                    debridSettings = await getSettings();
                    updateUI('realdebrid');
                    rdLoginBtn.disabled = false;
                    showNotification('Logged in successfully', 'success');
                } else if (data.error) {
                    const errStr = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
                    if (/expired|invalid|access_denied/i.test(errStr)) {
                        clearInterval(pollInterval);
                        rdLoginBtn.textContent = 'Login Failed';
                        rdLoginBtn.disabled = false;
                        rdStatus.textContent = 'Code expired or invalid';
                        rdStatus.className = 'status-badge status-error';
                        showNotification('Login failed', 'error');
                    }
                }
            } catch (e) {
                // Network error, keep polling
            }
        }, interval * 1000);
    };

    // Initial UI Setup
    updateUI(debridSettings.debridProvider || 'realdebrid');
}

// ============================================================================
// Player Settings
// ============================================================================

async function initPlayerUI() {
    const playerTypeSelect = document.getElementById('player-type-select');
    const mpvPathSection = document.getElementById('mpv-path-section');
    const mpvPathInput = document.getElementById('mpv-path-input');
    const browseMpvBtn = document.getElementById('browse-mpv-btn');
    const downloadMpvBtn = document.getElementById('download-mpv-btn');
    
    // Check platform
    let isWindows = false;
    try {
        const platformRes = await fetch('/api/platform');
        const platformData = await platformRes.json();
        isWindows = platformData.platform === 'win32';
    } catch(e) {
        isWindows = false;
    }
    
    // Remove Node MPV option on non-Windows platforms
    if (!isWindows) {
        const nodempvOption = playerTypeSelect.querySelector('option[value="nodempv"]');
        if (nodempvOption) {
            nodempvOption.remove();
        }
    }
    
    // Load initial state
    const settings = await getSettings();
    
    let currentPlayerType = 'html';
    if (settings.playerType) {
        currentPlayerType = settings.playerType;
        if (!isWindows && currentPlayerType === 'nodempv') {
            currentPlayerType = 'html';
        }
    } else if (settings.useNodeMPV && isWindows) {
        currentPlayerType = 'nodempv';
    }
    
    playerTypeSelect.value = currentPlayerType;
    
    const updateMpvPathVisibility = () => {
        if (isWindows && playerTypeSelect.value === 'nodempv') {
            mpvPathSection.style.display = 'block';
        } else {
            mpvPathSection.style.display = 'none';
        }
    };
    updateMpvPathVisibility();
    
    if (mpvPathInput) {
        mpvPathInput.value = settings.mpvPath || '';
    }
    
    playerTypeSelect.addEventListener('change', (e) => {
        const playerType = e.target.value;
        saveSettings({ 
            playerType: playerType,
            useNodeMPV: playerType === 'nodempv'
        });
        updateMpvPathVisibility();
    });
    
    if (mpvPathInput) {
        mpvPathInput.addEventListener('blur', () => {
            saveSettings({ mpvPath: mpvPathInput.value.trim() || null });
        });
        mpvPathInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                mpvPathInput.blur();
            }
        });
    }
    
    if (browseMpvBtn) {
        browseMpvBtn.addEventListener('click', async () => {
            if (window.electronAPI?.pickFile) {
                const result = await window.electronAPI.pickFile({
                    filters: [{ name: 'Executable', extensions: ['exe'] }],
                    title: 'Select mpv.exe'
                });
                if (result && mpvPathInput) {
                    mpvPathInput.value = result;
                    saveSettings({ mpvPath: result });
                }
            } else {
                showNotification('File browser not available', 'error');
            }
        });
    }
    
    if (downloadMpvBtn) {
        downloadMpvBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const mpvUrl = 'https://mpv.io/installation/';
            if (window.electronAPI?.openExternal) {
                window.electronAPI.openExternal(mpvUrl);
            } else {
                window.open(mpvUrl, '_blank');
            }
        });
    }
}

// ============================================================================
// Torrent Engine Settings
// ============================================================================

async function initTorrentEngineUI() {
    const engineSelect = document.getElementById('torrent-engine-select');
    const instancesContainer = document.getElementById('engine-instances-container');
    const instancesSlider = document.getElementById('engine-instances-slider');
    const instanceCountLabel = document.getElementById('instance-count-label');
    const engineDescription = document.getElementById('engine-description');
    
    const descriptions = {
        stremio: "Stremio's engine provides reliable streaming with built-in transcoding support.",
        webtorrent: "WebTorrent uses WebRTC for browser-compatible P2P streaming.",
        torrentstream: "TorrentStream is a lightweight engine optimized for video streaming.",
        hybrid: "Hybrid mode uses BOTH WebTorrent and TorrentStream for maximum speed!"
    };
    
    let currentEngine = 'stremio';
    let currentInstances = 1;
    
    try {
        const engineConfig = await fetch('/api/torrent-engine/config').then(r => r.json());
        if (engineConfig && engineConfig.engine) {
            currentEngine = engineConfig.engine;
            currentInstances = engineConfig.instances || 1;
            console.log(`[Settings] Loaded engine: ${currentEngine}, instances: ${currentInstances}`);
        }
    } catch (e) {
        console.warn('[Settings] Failed to load engine config:', e);
        try {
            const settings = await getSettings();
            if (settings.torrentEngine) {
                currentEngine = settings.torrentEngine;
            }
            if (settings.torrentEngineInstances) {
                currentInstances = settings.torrentEngineInstances;
            }
        } catch (settingsError) {
            console.warn('[Settings] Using default stremio');
        }
    }
    
    engineSelect.value = currentEngine;
    instancesSlider.value = currentInstances;
    instanceCountLabel.textContent = currentInstances;
    
    const updateUI = (engine) => {
        engineDescription.textContent = descriptions[engine] || descriptions.stremio;
        
        if (engine === 'stremio' || engine === 'webtorrent') {
            instancesContainer.style.display = 'none';
        } else {
            instancesContainer.style.display = 'block';
        }
    };
    
    updateUI(engineSelect.value);
    
    engineSelect.addEventListener('change', async (e) => {
        const engine = e.target.value;
        updateUI(engine);
        await saveSettings({ torrentEngine: engine });
        
        try {
            await fetch('/api/torrent-engine/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    engine, 
                    instances: parseInt(instancesSlider.value, 10) 
                })
            });
        } catch (e) {
            console.error('[Settings] Failed to update engine:', e);
        }
    });
    
    instancesSlider.addEventListener('input', (e) => {
        instanceCountLabel.textContent = e.target.value;
    });
    
    instancesSlider.addEventListener('change', async (e) => {
        const instances = parseInt(e.target.value, 10);
        await saveSettings({ torrentEngineInstances: instances });
        
        try {
            await fetch('/api/torrent-engine/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    engine: engineSelect.value, 
                    instances 
                })
            });
        } catch (e) {
            console.error('[Settings] Failed to update instances:', e);
        }
    });
}

// ============================================================================
// Main Initialization
// ============================================================================

async function init() {
    // Load Streaming Mode setting
    const settings = await getSettings();
    const streamingModeToggle = document.getElementById('streaming-mode-toggle');
    
    console.log('[Settings] Full settings object:', settings);
    console.log('[Settings] streamingMode value:', settings.streamingMode);
    
    // Default to true if not set
    const streamingMode = settings.streamingMode !== undefined ? settings.streamingMode : true;
    streamingModeToggle.checked = streamingMode;
    
    console.log('[Settings] Loaded Streaming Mode:', streamingMode, 'Toggle checked:', streamingModeToggle.checked);
    
    // Event listener for streaming mode
    streamingModeToggle.addEventListener('change', async (e) => {
        const enabled = e.target.checked;
        console.log('[Settings] Streaming Mode toggle changed to:', enabled);
        const saved = await saveSettings({ streamingMode: enabled });
        console.log('[Settings] Save result:', saved);
        
        // Verify it was saved
        const verifySettings = await getSettings();
        console.log('[Settings] Verified streamingMode after save:', verifySettings.streamingMode);
        
        showNotification(`Streaming Mode ${enabled ? 'enabled' : 'disabled'}`, 'success');
        
        // Reload streaming mode in the main app if available
        if (window.streamingMode && window.streamingMode.reload) {
            await window.streamingMode.reload();
        }
    });
    
    // Load Jackett settings
    const jackettKey = await getJackettKey();
    
    const jackettApiInput = document.getElementById('jackett-api-input');
    const jackettUrlInput = document.getElementById('jackett-url-input');
    
    jackettApiInput.value = jackettKey || '';
    if (jackettKey) {
        jackettApiInput.placeholder = 'API Key saved (hidden)';
    }
    jackettUrlInput.value = settings.jackettUrl || '';
    
    console.log('[Settings] Loaded Jackett key:', jackettKey ? '***' + jackettKey.slice(-4) : 'none');
    
    // Load Prowlarr settings
    const prowlarrKey = await getProwlarrKey();
    const prowlarrApiInput = document.getElementById('prowlarr-api-input');
    const prowlarrUrlInput = document.getElementById('prowlarr-url-input');
    
    prowlarrApiInput.value = prowlarrKey || '';
    if (prowlarrKey) {
        prowlarrApiInput.placeholder = 'API Key saved (hidden)';
    }
    prowlarrUrlInput.value = settings.prowlarrUrl || '';
    
    console.log('[Settings] Loaded Prowlarr key:', prowlarrKey ? '***' + prowlarrKey.slice(-4) : 'none');
    
    // Load Stremio addons
    await renderStremioAddons();
    
    // Initialize Debrid UI
    await initDebridUI();
    
    // Initialize Player UI
    await initPlayerUI();
    
    // Initialize Torrent Engine UI
    await initTorrentEngineUI();
    
    // Event Listeners
    document.getElementById('back-btn').addEventListener('click', () => {
        sessionStorage.setItem('skipIntro', 'true');
        window.location.href = 'index.html';
    });
    
    document.getElementById('install-addon-btn').addEventListener('click', async () => {
        const input = document.getElementById('addon-manifest-input');
        const url = input.value.trim();
        
        if (!url) {
            showNotification('Please enter an addon URL', 'error');
            return;
        }
        
        try {
            await addStremioAddon(url);
            await renderStremioAddons();
            input.value = '';
            showNotification('Addon installed successfully', 'success');
        } catch (error) {
            console.error('[Settings] Failed to install addon', error);
            showNotification('Failed to install addon: ' + error.message, 'error');
        }
    });
    
    document.getElementById('save-settings-btn').addEventListener('click', async () => {
        try {
            // Save Jackett
            const jackettKey = jackettApiInput.value.trim();
            const jackettUrl = jackettUrlInput.value.trim();
            
            if (jackettKey) {
                await setJackettKey(jackettKey);
            }
            
            // Save Prowlarr
            const prowlarrKey = prowlarrApiInput.value.trim();
            const prowlarrUrl = prowlarrUrlInput.value.trim();
            
            if (prowlarrKey) {
                await setProwlarrKey(prowlarrKey);
            }
            
            // Save URLs
            await saveSettings({
                jackettUrl: jackettUrl || null,
                prowlarrUrl: prowlarrUrl || null
            });
            
            showNotification('Settings saved successfully', 'success');
        } catch (error) {
            console.error('[Settings] Failed to save settings', error);
            showNotification('Failed to save settings', 'error');
        }
    });
    
    document.getElementById('switch-mode-btn').addEventListener('click', () => {
        if (window.electronAPI?.setPreferredMode) {
            window.electronAPI.setPreferredMode('basic');
        }
        sessionStorage.setItem('skipIntro', 'true');
        window.location.href = '../basicmode/index.html';
    });
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', init);
