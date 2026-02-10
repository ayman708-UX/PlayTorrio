/**
 * IPTV Functionality for PlayTorrio
 * Handles Xtream Codes API and Playback
 */

class IPTVManager {
    constructor() {
        this.config = JSON.parse(localStorage.getItem('iptv_config')) || null;
        this.userData = null;
        this.categories = { live: [], movie: [], series: [] };
        this.currentView = 'home';
        this.currentCategory = 'all';
        this.allItems = [];
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupGlobalKeyboardShortcuts();
        if (this.config) {
            this.login(this.config);
        } else {
            this.updateLoginUI(false);
        }
    }

    setupGlobalKeyboardShortcuts() {
        // Global Escape key to exit page
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const playerView = document.getElementById('player-view');
                const loginModal = document.getElementById('login-modal');
                
                // If player is open, close it
                if (!playerView.classList.contains('hidden')) {
                    this.closePlayer();
                    e.preventDefault();
                    return;
                }
                
                // If login modal is open, close it
                if (!loginModal.classList.contains('hidden')) {
                    loginModal.classList.add('hidden');
                    e.preventDefault();
                    return;
                }
                
                // Otherwise, go back with skipIntro flag
                sessionStorage.setItem('skipIntro', 'true');
                window.history.back();
                e.preventDefault();
            }
        });
    }

    setupEventListeners() {
        // Back buttons
        document.getElementById('back-btn').addEventListener('click', () => {
            // Set skipIntro flag before navigating back
            sessionStorage.setItem('skipIntro', 'true');
            window.history.back();
        });

        document.getElementById('back-to-home').addEventListener('click', () => {
            this.showView('home');
        });

        document.getElementById('back-to-listing').addEventListener('click', () => {
            this.showView('series');
        });

        // Login Modal
        document.getElementById('login-btn').addEventListener('click', () => {
            document.getElementById('login-modal').classList.remove('hidden');
        });

        document.getElementById('close-login').addEventListener('click', () => {
            document.getElementById('login-modal').classList.add('hidden');
        });

        document.getElementById('logout-btn').addEventListener('click', () => {
            this.logout();
        });

        document.getElementById('submit-login').addEventListener('click', () => {
            const url = document.getElementById('login-url').value.trim();
            const user = document.getElementById('login-user').value.trim();
            const pass = document.getElementById('login-pass').value.trim();
            const m3u = document.getElementById('login-m3u').value.trim();

            if (m3u) {
                // Check if it's a get.php URL (Xtream Codes M3U format)
                if (m3u.includes('get.php')) {
                    // Parse get.php URL to extract credentials
                    try {
                        const urlObj = new URL(m3u);
                        const username = urlObj.searchParams.get('username');
                        const password = urlObj.searchParams.get('password');
                        const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
                        
                        if (username && password) {
                            // Use Xtream Codes API
                            const config = { url: baseUrl, user: username, pass: password };
                            this.login(config);
                            return;
                        }
                    } catch (e) {
                        console.warn('Failed to parse get.php URL, treating as regular M3U');
                    }
                }
                
                // Handle as regular M3U/M3U8 URL
                this.loginWithM3U(m3u);
                return;
            }

            if (!url || !user || !pass) {
                alert('Please enter URL, Username and Password OR M3U URL');
                return;
            }

            const config = { url, user, pass };
            this.login(config);
        });

        // Box clicks
        document.getElementById('box-live').addEventListener('click', () => this.loadListing('live'));
        document.getElementById('box-movies').addEventListener('click', () => this.loadListing('movie'));
        document.getElementById('box-shows').addEventListener('click', () => this.loadListing('series'));

        // Search
        document.getElementById('iptv-search').addEventListener('input', (e) => {
            this.filterItems(e.target.value);
        });

        // Player
        document.getElementById('close-player-btn').addEventListener('click', () => this.closePlayer());
    }

    async login(config) {
        try {
            const loginUrl = `${config.url}/player_api.php?username=${config.user}&password=${config.pass}`;
            const response = await fetch(loginUrl);
            const data = await response.json();

            if (data && data.user_info && data.user_info.auth === 1) {
                this.config = config;
                this.userData = data;
                localStorage.setItem('iptv_config', JSON.stringify(config));
                this.updateLoginUI(true);
                this.updateSubDetails(data);
                document.getElementById('login-modal').classList.add('hidden');
            } else {
                alert('Login failed. Please check your credentials.');
                this.logout();
            }
        } catch (error) {
            console.error('IPTV Login Error:', error);
            alert('Failed to connect to server. Check URL and connectivity.');
        }
    }

    async loginWithM3U(m3uUrl) {
        try {
            // Fetch and parse M3U/M3U8 playlist
            const response = await fetch(m3uUrl);
            const m3uText = await response.text();
            
            const channels = this.parseM3U(m3uText);
            
            if (channels.length === 0) {
                alert('No channels found in M3U file');
                return;
            }

            // Store M3U config
            const config = { type: 'm3u', url: m3uUrl, channels };
            this.config = config;
            this.userData = { user_info: { auth: 1, status: 'Active' } };
            localStorage.setItem('iptv_config', JSON.stringify(config));
            this.updateLoginUI(true);
            document.getElementById('login-modal').classList.add('hidden');
            
            // Show basic sub details
            document.getElementById('sub-details').classList.remove('hidden');
            document.getElementById('sub-status').textContent = 'Active';
            document.getElementById('sub-expiry').textContent = 'N/A';
            document.getElementById('sub-connections').textContent = '1';
            document.getElementById('sub-max').textContent = '1';
        } catch (error) {
            console.error('M3U Login Error:', error);
            alert('Failed to load M3U file. Check URL and connectivity.');
        }
    }

    parseM3U(m3uText) {
        const lines = m3uText.split('\n');
        const channels = [];
        let currentChannel = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            if (line.startsWith('#EXTINF:')) {
                // Parse channel info
                const nameMatch = line.match(/,(.+)$/);
                const logoMatch = line.match(/tvg-logo="([^"]+)"/);
                const groupMatch = line.match(/group-title="([^"]+)"/);
                
                currentChannel = {
                    name: nameMatch ? nameMatch[1] : 'Unknown Channel',
                    stream_icon: logoMatch ? logoMatch[1] : '',
                    category_name: groupMatch ? groupMatch[1] : 'Uncategorized',
                    category_id: groupMatch ? groupMatch[1].toLowerCase().replace(/\s+/g, '-') : 'uncategorized'
                };
            } else if (line && !line.startsWith('#') && currentChannel) {
                // This is the stream URL
                currentChannel.stream_url = line;
                currentChannel.stream_id = channels.length;
                channels.push(currentChannel);
                currentChannel = null;
            }
        }

        return channels;
    }

    logout() {
        this.config = null;
        this.userData = null;
        localStorage.removeItem('iptv_config');
        this.updateLoginUI(false);
        this.showView('home');
        document.getElementById('sub-details').classList.add('hidden');
    }

    updateLoginUI(isLoggedIn) {
        document.getElementById('login-btn').classList.toggle('hidden', isLoggedIn);
        document.getElementById('logout-btn').classList.toggle('hidden', !isLoggedIn);
        document.getElementById('home-view').classList.toggle('opacity-50', !isLoggedIn);
        document.getElementById('home-view').classList.toggle('pointer-events-none', !isLoggedIn);
    }

    updateSubDetails(data) {
        const info = data.user_info;
        document.getElementById('sub-details').classList.remove('hidden');
        document.getElementById('sub-status').textContent = info.status || 'Active';
        
        if (info.exp_date) {
            const date = new Date(parseInt(info.exp_date) * 1000);
            document.getElementById('sub-expiry').textContent = date.toLocaleDateString();
        } else {
            document.getElementById('sub-expiry').textContent = 'Unlimited';
        }
        
        document.getElementById('sub-connections').textContent = info.active_cons || '0';
        document.getElementById('sub-max').textContent = info.max_connections || '1';
    }

    async loadListing(type) {
        if (!this.config) return;
        this.currentView = type;
        this.showView('listing');
        document.getElementById('view-title').textContent = type === 'live' ? 'Live TV' : (type === 'movie' ? 'Movies' : 'TV Shows');
        
        // Show loading
        document.getElementById('item-grid').innerHTML = '<div class="col-span-full text-center py-20"><div class="animate-spin w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div><p>Loading content...</p></div>';
        
        try {
            // Handle M3U config
            if (this.config.type === 'm3u') {
                if (type === 'live') {
                    this.allItems = this.config.channels;
                    
                    // Extract unique categories
                    const uniqueCategories = [...new Set(this.config.channels.map(ch => ch.category_name))];
                    this.categories.live = uniqueCategories.map((name, idx) => ({
                        category_id: name.toLowerCase().replace(/\s+/g, '-'),
                        category_name: name
                    }));
                    
                    this.renderCategories('live');
                    this.renderItems('all');
                } else {
                    // M3U typically only has live channels
                    document.getElementById('item-grid').innerHTML = '<div class="col-span-full text-center py-20 text-white text-opacity-50">M3U playlists typically only contain live channels.</div>';
                }
                return;
            }

            // Load categories first if not loaded (Xtream Codes)
            if (this.categories[type].length === 0) {
                const catAction = type === 'live' ? 'get_live_categories' : (type === 'movie' ? 'get_vod_categories' : 'get_series_categories');
                const catUrl = `${this.config.url}/player_api.php?username=${this.config.user}&password=${this.config.pass}&action=${catAction}`;
                const catRes = await fetch(catUrl);
                this.categories[type] = await catRes.json();
            }
            
            this.renderCategories(type);

            // Load all items for this type
            const itemAction = type === 'live' ? 'get_live_streams' : (type === 'movie' ? 'get_vod_streams' : 'get_series');
            const itemUrl = `${this.config.url}/player_api.php?username=${this.config.user}&password=${this.config.pass}&action=${itemAction}`;
            const itemRes = await fetch(itemUrl);
            this.allItems = await itemRes.json();
            
            this.renderItems('all');
        } catch (error) {
            console.error('Load Listing Error:', error);
            document.getElementById('item-grid').innerHTML = '<div class="col-span-full text-center py-20 text-red-500">Failed to load content.</div>';
        }
    }

    renderCategories(type) {
        const container = document.getElementById('category-list');
        container.innerHTML = `<div class="category-item active" data-id="all">All Categories</div>`;
        
        this.categories[type].forEach(cat => {
            const div = document.createElement('div');
            div.className = 'category-item';
            div.setAttribute('data-id', cat.category_id);
            div.textContent = cat.category_name;
            div.addEventListener('click', () => {
                document.querySelectorAll('.category-item').forEach(el => el.classList.remove('active'));
                div.classList.add('active');
                this.renderItems(cat.category_id);
            });
            container.appendChild(div);
        });
    }

    renderItems(categoryId) {
        this.currentCategory = categoryId;
        const grid = document.getElementById('item-grid');
        grid.innerHTML = '';
        
        const filtered = categoryId === 'all' ? this.allItems : this.allItems.filter(item => item.category_id === categoryId);
        
        if (filtered.length === 0) {
            grid.innerHTML = '<div class="col-span-full text-center py-20 text-white text-opacity-50">No items found in this category.</div>';
            return;
        }

        // Limit rendering for performance if too many
        const toRender = filtered.slice(0, 500);

        toRender.forEach(item => {
            const card = document.createElement('div');
            card.className = `iptv-item ${this.currentView === 'movie' || this.currentView === 'series' ? 'movie' : ''}`;
            
            let imgUrl = item.stream_icon || item.cover || '';
            
            card.innerHTML = `
                <div class="flex-1 overflow-hidden">
                    ${imgUrl ? `<img src="${imgUrl}" loading="lazy" onerror="this.style.display='none'">` : '<div class="no-image-placeholder"><i class="material-icons">tv</i></div>'}
                </div>
                <div class="item-name">${item.name}</div>
            `;
            
            card.addEventListener('click', () => {
                if (this.currentView === 'series') {
                    this.loadSeriesDetail(item);
                } else {
                    this.playItem(item);
                }
            });
            
            grid.appendChild(card);
        });
    }

    filterItems(query) {
        const q = query.toLowerCase();
        const grid = document.getElementById('item-grid');
        const items = grid.querySelectorAll('.iptv-item');
        
        items.forEach(item => {
            const name = item.querySelector('.item-name').textContent.toLowerCase();
            if (name.includes(q)) {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        });
    }

    async loadSeriesDetail(series) {
        this.showView('series-detail');
        document.getElementById('series-title').textContent = series.name;
        document.getElementById('series-poster').src = series.cover || series.stream_icon || '';
        document.getElementById('series-plot').textContent = 'Loading details...';
        document.getElementById('season-list').innerHTML = '';
        document.getElementById('episode-list').innerHTML = '';

        try {
            const url = `${this.config.url}/player_api.php?username=${this.config.user}&password=${this.config.pass}&action=get_series_info&series_id=${series.series_id}`;
            const res = await fetch(url);
            const data = await res.json();
            
            if (data.info && data.info.plot) {
                document.getElementById('series-plot').textContent = data.info.plot;
            } else {
                document.getElementById('series-plot').textContent = 'No description available.';
            }

            const seasons = Object.keys(data.episodes);
            seasons.forEach((s, index) => {
                const btn = document.createElement('button');
                btn.className = `season-btn ${index === 0 ? 'active' : ''}`;
                btn.textContent = `Season ${s}`;
                btn.onclick = () => {
                    document.querySelectorAll('.season-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.renderEpisodes(data.episodes[s]);
                };
                document.getElementById('season-list').appendChild(btn);
            });

            if (seasons.length > 0) {
                this.renderEpisodes(data.episodes[seasons[0]]);
            }
        } catch (error) {
            console.error('Series Detail Error:', error);
        }
    }

    renderEpisodes(episodes) {
        const container = document.getElementById('episode-list');
        container.innerHTML = '';
        
        episodes.forEach(ep => {
            const div = document.createElement('div');
            div.className = 'episode-item';
            div.innerHTML = `
                <span class="episode-number">${ep.episode_num}</span>
                <div class="flex-1">
                    <div class="font-medium">${ep.title || 'Episode ' + ep.episode_num}</div>
                </div>
                <i class="material-icons text-blue-500">play_circle_filled</i>
            `;
            div.onclick = () => this.playItem(ep, 'series');
            container.appendChild(div);
        });
    }

    async playItem(item, typeOverride = null) {
        const type = typeOverride || this.currentView;
        
        let streamUrl = '';

        // Handle M3U channels
        if (this.config.type === 'm3u' && item.stream_url) {
            streamUrl = item.stream_url;
        } else {
            // Xtream Codes
            const id = item.stream_id || item.id;
            if (type === 'live') {
                streamUrl = `${this.config.url}/live/${this.config.user}/${this.config.pass}/${id}.m3u8`;
            } else if (type === 'movie') {
                streamUrl = `${this.config.url}/movie/${this.config.user}/${this.config.pass}/${id}.${item.container_extension || 'mp4'}`;
            } else if (type === 'series') {
                streamUrl = `${this.config.url}/series/${this.config.user}/${this.config.pass}/${id}.${item.container_extension || 'mp4'}`;
            }
        }

        console.log('Playing stream with PlayTorrio Player:', streamUrl);

        // Use PlayTorrioPlayer for all IPTV streams
        try {
            const response = await fetch('/api/playtorrioplayer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    url: streamUrl,
                    tmdbId: null,
                    imdbId: null,
                    seasonNum: null,
                    episodeNum: null,
                    mediaType: type === 'live' ? 'live' : (type === 'movie' ? 'movie' : 'tv'),
                    stopOnClose: false
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                console.log('[IPTV] PlayTorrio player opened successfully');
                // Don't show player view since external player is used
                return;
            } else {
                console.error('[IPTV] PlayTorrio player failed:', result.error);
                alert('Failed to open PlayTorrio player. Make sure it is installed.');
            }
        } catch (error) {
            console.error('[IPTV] PlayTorrio player error:', error);
            alert('Failed to open PlayTorrio player. Error: ' + error.message);
        }
    }

    closePlayer() {
        // Player is external, no cleanup needed
        document.getElementById('player-view').classList.add('hidden');
    }

    showView(view) {
        document.getElementById('home-view').classList.add('hidden');
        document.getElementById('listing-view').classList.add('hidden');
        document.getElementById('series-view').classList.add('hidden');
        
        if (view === 'home') {
            document.getElementById('home-view').classList.remove('hidden');
        } else if (view === 'listing') {
            document.getElementById('listing-view').classList.remove('hidden');
        } else if (view === 'series-detail') {
            document.getElementById('series-view').classList.remove('hidden');
        }
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.iptvManager = new IPTVManager();
});
