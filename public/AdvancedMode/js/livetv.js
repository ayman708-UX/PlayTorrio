// Live TV Functionality

// Show Live TV Page
function showLiveTvPage() {
    hideAllSections();
    
    // Check if Live TV section exists, if not create it
    let liveTvSection = document.getElementById('liveTvSection');
    if (!liveTvSection) {
        createLiveTvSection();
        liveTvSection = document.getElementById('liveTvSection');
    }
    
    // Always show the section
    if (liveTvSection) {
        liveTvSection.style.setProperty('display', 'block', 'important');
    }
}

// Create Live TV Section Structure
function createLiveTvSection() {
    const mainContent = document.getElementById('mainContent');
    const section = document.createElement('div');
    section.id = 'liveTvSection';
    section.className = 'livetv-section';
    section.innerHTML = `
        <div class="livetv-container">
            <iframe 
                id="liveTvIframe" 
                src="https://iptvplaytorrio.pages.dev" 
                frameborder="0" 
                allowfullscreen
                allow="autoplay; fullscreen; picture-in-picture"
                sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-pointer-lock allow-top-navigation"
            ></iframe>
        </div>
    `;
    mainContent.appendChild(section);
}
