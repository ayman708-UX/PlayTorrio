// My List functionality
let myListData = [];

// Show My List Page
function showMyListPage() {
    hideAllSections();
    
    // Check if my list section exists, if not create it
    let myListSection = document.getElementById('myListSection');
    if (!myListSection) {
        createMyListSection();
        loadMyList();
    } else {
        myListSection.style.setProperty('display', 'block', 'important');
    }
}

// Create My List Section Structure
function createMyListSection() {
    const mainContent = document.getElementById('mainContent');
    const section = document.createElement('div');
    section.id = 'myListSection';
    section.className = 'mylist-section';
    section.innerHTML = `
        <div class="mylist-container" style="padding: 80px 40px 40px 40px;">
            <h1 style="font-size: 2.5rem; font-weight: 700; margin-bottom: 30px; color: #fff;">My List</h1>
            
            <div id="mylist-loading" style="display: flex; justify-content: center; align-items: center; min-height: 400px;">
                <div style="width: 50px; height: 50px; border: 4px solid rgba(139, 92, 246, 0.2); border-top-color: #8b5cf6; border-radius: 50%; animation: spin 1s linear infinite;"></div>
            </div>
            
            <div id="mylist-empty" style="display: none; text-align: center; padding: 100px 20px;">
                <svg style="width: 100px; height: 100px; margin: 0 auto 20px; opacity: 0.3;" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/>
                </svg>
                <h2 style="font-size: 1.5rem; color: rgba(255,255,255,0.7); margin-bottom: 10px;">Your list is empty</h2>
                <p style="color: rgba(255,255,255,0.5);">Add movies and TV shows to your list to watch them later</p>
            </div>
            
            <div id="mylist-grid" class="movie-grid" style="display: none; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 20px;">
                <!-- My list items will be inserted here -->
            </div>
        </div>
    `;
    mainContent.appendChild(section);
}

// Load My List from file
async function loadMyList() {
    const loadingEl = document.getElementById('mylist-loading');
    const emptyEl = document.getElementById('mylist-empty');
    const gridEl = document.getElementById('mylist-grid');
    
    try {
        const response = await fetch('/api/my-list');
        if (!response.ok) throw new Error('Failed to load my list');
        
        myListData = await response.json();
        
        if (loadingEl) loadingEl.style.display = 'none';
        
        if (myListData.length === 0) {
            if (emptyEl) emptyEl.style.display = 'block';
            if (gridEl) gridEl.style.display = 'none';
        } else {
            if (emptyEl) emptyEl.style.display = 'none';
            if (gridEl) gridEl.style.display = 'grid';
            renderMyList();
        }
    } catch (error) {
        console.error('[MyList] Error loading:', error);
        if (loadingEl) loadingEl.style.display = 'none';
        if (emptyEl) {
            emptyEl.style.display = 'block';
            emptyEl.innerHTML = `
                <h2 style="font-size: 1.5rem; color: rgba(255,255,255,0.7);">Failed to load list</h2>
                <p style="color: rgba(255,255,255,0.5);">${error.message}</p>
            `;
        }
    }
}

// Render My List items
function renderMyList() {
    const gridEl = document.getElementById('mylist-grid');
    if (!gridEl) return;
    
    gridEl.innerHTML = '';
    
    // Sort by added_date descending (newest first)
    const sortedList = [...myListData].sort((a, b) => 
        new Date(b.added_date) - new Date(a.added_date)
    );
    
    sortedList.forEach(item => {
        const card = document.createElement('div');
        card.className = 'movie-card';
        card.style.cssText = 'cursor: pointer; transition: transform 0.2s; position: relative;';
        
        const posterUrl = item.poster_path 
            ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
            : 'https://via.placeholder.com/500x750?text=No+Poster';
        
        card.innerHTML = `
            <div style="position: relative; aspect-ratio: 2/3; overflow: hidden; border-radius: 8px;">
                <img src="${posterUrl}" 
                     alt="${item.title}" 
                     style="width: 100%; height: 100%; object-fit: cover;"
                     loading="lazy">
                <div style="position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,0.8); padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">
                    ${item.vote_average ? item.vote_average.toFixed(1) : 'N/A'}
                </div>
            </div>
            <div style="padding: 8px 0;">
                <h3 style="font-size: 0.9rem; font-weight: 600; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.title}</h3>
                <p style="font-size: 0.8rem; color: rgba(255,255,255,0.6);">${item.year || 'N/A'}</p>
            </div>
        `;
        
        card.addEventListener('click', () => {
            sessionStorage.setItem('skipIntro', 'true');
            window.location.href = `details.html?type=${item.media_type}&id=${item.id}`;
        });
        
        card.addEventListener('mouseenter', () => {
            card.style.transform = 'scale(1.05)';
        });
        
        card.addEventListener('mouseleave', () => {
            card.style.transform = 'scale(1)';
        });
        
        gridEl.appendChild(card);
    });
}

// Check if item is in my list
async function isInMyList(id) {
    try {
        const response = await fetch('/api/my-list');
        if (!response.ok) return false;
        const list = await response.json();
        return list.some(item => item.id === parseInt(id));
    } catch (error) {
        console.error('[MyList] Error checking:', error);
        return false;
    }
}

// Add item to my list
async function addToMyList(item) {
    try {
        const response = await fetch('/api/my-list/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item)
        });
        
        if (!response.ok) throw new Error('Failed to add to list');
        
        const result = await response.json();
        console.log('[MyList] Added:', result);
        return true;
    } catch (error) {
        console.error('[MyList] Error adding:', error);
        return false;
    }
}

// Remove item from my list
async function removeFromMyList(id) {
    try {
        const response = await fetch('/api/my-list/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: parseInt(id) })
        });
        
        if (!response.ok) throw new Error('Failed to remove from list');
        
        const result = await response.json();
        console.log('[MyList] Removed:', result);
        return true;
    } catch (error) {
        console.error('[MyList] Error removing:', error);
        return false;
    }
}
