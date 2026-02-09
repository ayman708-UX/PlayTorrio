// Title Bar Controls
(function() {
    'use strict';

    // Check if we're in Electron
    const isElectron = typeof window.electronAPI !== 'undefined';
    
    if (!isElectron) {
        console.log('[TitleBar] Not running in Electron, hiding custom titlebar');
        const titlebar = document.getElementById('customTitlebar');
        if (titlebar) titlebar.style.display = 'none';
        return;
    }

    // Add platform class to body for platform-specific styling
    if (window.electronAPI.platform) {
        document.body.classList.add(`platform-${window.electronAPI.platform}`);
    }

    console.log('[TitleBar] Initializing custom titlebar controls');

    // Get button elements
    const minimizeBtn = document.getElementById('minimizeBtn');
    const maximizeBtn = document.getElementById('maximizeBtn');
    const closeBtn = document.getElementById('closeBtn');
    const titlebar = document.getElementById('customTitlebar');

    // Window control handlers
    if (minimizeBtn) {
        minimizeBtn.addEventListener('click', async () => {
            try {
                await window.electronAPI.minimizeWindow();
            } catch (err) {
                console.error('[TitleBar] Minimize error:', err);
            }
        });
    }

    if (maximizeBtn) {
        maximizeBtn.addEventListener('click', async () => {
            try {
                await window.electronAPI.maximizeWindow();
            } catch (err) {
                console.error('[TitleBar] Maximize error:', err);
            }
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', async () => {
            try {
                await window.electronAPI.closeWindow();
            } catch (err) {
                console.error('[TitleBar] Close error:', err);
            }
        });
    }

    // Listen for maximize state changes
    if (window.electronAPI.onMaximizeChanged) {
        window.electronAPI.onMaximizeChanged((payload) => {
            if (titlebar) {
                if (payload.isMaximized) {
                    titlebar.classList.add('maximized');
                } else {
                    titlebar.classList.remove('maximized');
                }
            }
        });
    }

    // Add hover effects
    const buttons = [minimizeBtn, maximizeBtn, closeBtn];
    buttons.forEach(btn => {
        if (!btn) return;
        
        btn.addEventListener('mouseenter', () => {
            btn.style.transform = 'scale(1.05)';
        });
        
        btn.addEventListener('mouseleave', () => {
            btn.style.transform = 'scale(1)';
        });
    });

    console.log('[TitleBar] Custom titlebar initialized successfully');
})();
