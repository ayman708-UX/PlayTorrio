// Music Module for Advanced Mode (Redesigned UI)
// Uses the SAME localStorage keys as the main app for shared playlists

// Show Music Page function for AdvancedMode
function showMusicPage() {
    hideAllSections();
    
    let musicSection = document.getElementById('musicSection');
    if (!musicSection) {
        createMusicHTML();
        initMusic();
    } else {
        musicSection.style.setProperty('display', 'block', 'important');
    }
}

// Create Music HTML structure
function createMusicHTML() {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;
    
    // New Glassmorphism Design Structure
    const musicHTML = `
    <div id="musicSection" class="relative z-[70] min-h-screen pb-20 music-main-container">
        <!-- Header Section -->
        <div class="sticky top-0 z-50 glass-panel border-b-0 rounded-b-2xl mx-4 mt-2 px-6 py-4">
            <div class="flex flex-col md:flex-row md:items-center justify-between gap-6">
                
                <!-- Title & Brand -->
                <div class="flex items-center gap-4">
                    <div class="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center shadow-lg shadow-pink-500/20">
                        <svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                    </div>
                    <h2 class="text-3xl font-bold text-white tracking-tight">Music</h2>
                </div>

                <!-- Search Bar -->
                <div class="flex-1 max-w-2xl w-full mx-auto relative group">
                    <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <svg class="w-5 h-5 text-gray-400 group-focus-within:text-pink-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                    </div>
                    <input type="text" id="music-search-input" placeholder="Search for songs, artists, or albums..." 
                        style="background-color: #121212; color: #ffffff;"
                        class="w-full pl-12 pr-12 py-3.5 rounded-xl border border-gray-700 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 transition-all outline-none placeholder-gray-500 text-sm font-medium shadow-lg">
                    <button id="music-search-btn" class="absolute inset-y-0 right-0 pr-3 flex items-center">
                        <div class="p-1.5 rounded-lg bg-gray-800/50 hover:bg-pink-600/20 text-gray-400 hover:text-pink-400 transition-colors cursor-pointer">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
                        </div>
                    </button>
                </div>

                <!-- Navigation Tabs -->
                <div class="flex items-center gap-2 bg-gray-900/40 p-1.5 rounded-xl border border-white/5">
                    <button id="music-my-btn" class="px-4 py-2 rounded-lg text-sm font-medium text-gray-300 hover:text-white hover:bg-white/10 transition-all flex items-center gap-2">
                        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                        <span>Liked</span>
                    </button>
                    <button id="music-my-albums-btn" class="px-4 py-2 rounded-lg text-sm font-medium text-gray-300 hover:text-white hover:bg-white/10 transition-all flex items-center gap-2">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-width="2"/><circle cx="12" cy="12" r="3" stroke-width="2"/></svg>
                        <span>Albums</span>
                    </button>
                    <button id="music-playlists-btn" class="px-4 py-2 rounded-lg text-sm font-medium text-gray-300 hover:text-white hover:bg-white/10 transition-all flex items-center gap-2">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>
                        <span>Playlists</span>
                    </button>
                </div>
            </div>
        </div>

        <!-- Content Area -->
        <div class="p-6 max-w-[1600px] mx-auto">
            
            <!-- Loading State -->
            <div id="music-loading" class="hidden flex flex-col items-center justify-center py-32 animate-in">
                <div class="relative w-20 h-20">
                    <div class="absolute inset-0 rounded-full border-4 border-gray-700"></div>
                    <div class="absolute inset-0 rounded-full border-4 border-t-pink-500 border-r-purple-500 border-b-transparent border-l-transparent animate-spin"></div>
                </div>
                <p class="mt-4 text-gray-400 font-medium tracking-wide">Searching the universe...</p>
            </div>

            <!-- Empty State -->
            <div id="music-empty" class="flex flex-col items-center justify-center text-center py-32 animate-in">
                <div class="w-32 h-32 rounded-full bg-gradient-to-tr from-gray-800 to-gray-900 flex items-center justify-center shadow-2xl mb-8 border border-white/5 relative overflow-hidden group">
                    <div class="absolute inset-0 bg-pink-500/10 blur-xl group-hover:bg-pink-500/20 transition-all duration-500"></div>
                    <svg class="w-16 h-16 text-gray-500 group-hover:text-pink-400 transition-colors duration-300 relative z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/>
                    </svg>
                </div>
                <h3 class="text-3xl font-bold text-white mb-3">Discover Music</h3>
                <p class="text-gray-400 max-w-md mx-auto text-lg">Search for your favorite songs, artists, and albums to start your journey.</p>
            </div>

            <!-- Search Results -->
            <div id="music-results" class="hidden animate-in">
                <div class="flex items-end justify-between mb-8 border-b border-white/5 pb-4">
                    <div>
                        <h3 id="music-results-title" class="text-2xl font-bold text-white">Search Results</h3>
                        <p id="music-results-count" class="text-gray-400 text-sm mt-1">0 found</p>
                    </div>
                </div>
                <div id="music-results-grid" class="music-grid"></div>
            </div>

            <!-- My Music (Liked Songs) -->
            <div id="my-music-section" class="hidden animate-in">
                <div class="flex items-center justify-between mb-8 glass-panel p-6 rounded-2xl">
                    <div class="flex items-center gap-4">
                        <div class="w-16 h-16 rounded-xl bg-gradient-to-br from-pink-600 to-purple-700 flex items-center justify-center shadow-lg">
                            <svg class="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                        </div>
                        <div>
                            <h3 class="text-3xl font-bold text-white">Liked Songs</h3>
                            <p class="text-gray-400 text-sm mt-1">Your personal collection</p>
                        </div>
                    </div>
                    <div class="flex gap-3">
                        <button id="my-music-play-all" class="music-btn-primary px-6 py-2.5 rounded-full text-white font-medium flex items-center gap-2">
                            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg> Play All
                        </button>
                        <button id="my-music-shuffle" class="music-btn-secondary px-6 py-2.5 rounded-full text-white font-medium flex items-center gap-2">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Shuffle
                        </button>
                    </div>
                </div>
                <div id="my-music-grid" class="music-grid"></div>
                <div id="my-music-empty" class="hidden text-center py-20">
                    <p class="text-xl text-gray-400">No liked songs yet. Go explore!</p>
                </div>
            </div>

            <!-- Playlists Section -->
            <div id="playlists-section" class="hidden animate-in">
                <div class="flex items-center justify-between mb-8 glass-panel p-6 rounded-2xl">
                    <div class="flex items-center gap-4">
                        <div class="w-16 h-16 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-600 flex items-center justify-center shadow-lg">
                            <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>
                        </div>
                        <div>
                            <h3 class="text-3xl font-bold text-white">Playlists</h3>
                            <p class="text-gray-400 text-sm mt-1">Your curated mixes</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-3">
                        <input id="new-playlist-name" type="text" placeholder="New Playlist..." class="bg-gray-800/50 border border-gray-600 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500 w-48">
                        <button id="create-playlist-btn" class="bg-blue-600 hover:bg-blue-500 text-white p-2.5 rounded-lg transition-colors">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
                        </button>
                    </div>
                </div>
                <div id="playlists-grid" class="music-grid"></div>
                <div id="playlists-empty" class="hidden text-center py-20">
                    <p class="text-xl text-gray-400">Create your first playlist above.</p>
                </div>
            </div>

            <!-- Playlist Detail View -->
            <div id="playlist-view" class="hidden animate-in">
                <div class="glass-panel p-6 rounded-2xl mb-8">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-6">
                            <button id="playlist-back-btn" class="p-3 rounded-full bg-gray-800 hover:bg-gray-700 text-white transition-colors">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
                            </button>
                            <div>
                                <h3 id="playlist-view-title" class="text-3xl font-bold text-white">Playlist Name</h3>
                                <p class="text-gray-400 text-sm mt-1">Custom Playlist</p>
                            </div>
                        </div>
                        <div class="flex gap-3">
                            <button id="playlist-play-all" class="music-btn-primary px-6 py-2 rounded-full text-white text-sm font-medium">Play All</button>
                            <button id="playlist-shuffle" class="music-btn-secondary px-6 py-2 rounded-full text-white text-sm font-medium">Shuffle</button>
                            <button id="playlist-delete-btn" class="px-6 py-2 rounded-full border border-red-500/30 text-red-400 hover:bg-red-500/10 text-sm font-medium transition-colors">Delete</button>
                        </div>
                    </div>
                </div>
                <div id="playlist-tracks-grid" class="music-grid"></div>
                <div id="playlist-empty" class="hidden text-center py-20">
                    <p class="text-xl text-gray-400">This playlist is empty.</p>
                </div>
            </div>

            <!-- Album Detail View -->
            <div id="album-view" class="hidden animate-in">
                <div class="glass-panel p-8 rounded-3xl mb-8 relative overflow-hidden">
                    <div class="absolute inset-0 bg-gradient-to-r from-black/60 to-transparent z-0"></div>
                    <div class="relative z-10 flex flex-col md:flex-row gap-8 items-end">
                        <img id="album-view-cover" src="" alt="Album" class="w-52 h-52 rounded-2xl shadow-2xl object-cover bg-gray-800">
                        <div class="flex-1 mb-2">
                            <span class="px-3 py-1 rounded-full bg-blue-500/20 text-blue-300 text-xs font-bold uppercase tracking-wider mb-2 inline-block">Album</span>
                            <h3 id="album-view-title" class="text-4xl md:text-5xl font-bold text-white mb-2 leading-tight"></h3>
                            <p id="album-view-artist" class="text-xl text-gray-300 mb-6"></p>
                            
                            <div class="flex items-center gap-4">
                                <button id="album-play-all" class="music-btn-primary w-14 h-14 rounded-full flex items-center justify-center text-white shadow-lg hover:scale-105 transition-transform">
                                    <svg class="w-6 h-6 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                </button>
                                <button id="album-shuffle" class="p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors">
                                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                                </button>
                                <button id="album-save-btn" class="px-6 py-3 rounded-full bg-white/10 hover:bg-white/20 text-white font-medium transition-colors flex items-center gap-2">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>
                                    Save
                                </button>
                            </div>
                        </div>
                        <button id="album-back-btn" class="absolute top-0 right-0 p-3 text-gray-400 hover:text-white transition-colors">
                            <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                        </button>
                    </div>
                </div>
                <div class="glass-panel rounded-2xl overflow-hidden p-2">
                    <div id="album-tracks-grid" class="flex flex-col gap-1"></div>
                </div>
            </div>

            <!-- My Albums Section -->
            <div id="my-albums-section" class="hidden animate-in">
                <div class="flex items-center justify-between mb-8 glass-panel p-6 rounded-2xl">
                    <div class="flex items-center gap-4">
                        <div class="w-16 h-16 rounded-xl bg-gradient-to-br from-indigo-600 to-blue-600 flex items-center justify-center shadow-lg">
                            <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-width="2"/><circle cx="12" cy="12" r="3" stroke-width="2"/></svg>
                        </div>
                        <div>
                            <h3 class="text-3xl font-bold text-white">Saved Albums</h3>
                            <p class="text-gray-400 text-sm mt-1">Full collections you love</p>
                        </div>
                    </div>
                </div>
                <div id="my-albums-grid" class="music-grid"></div>
                <div id="my-albums-empty" class="hidden text-center py-20">
                    <p class="text-xl text-gray-400">No saved albums yet.</p>
                </div>
            </div>
        </div>
    </div>

    <!-- Redesigned Full Screen Player Modal -->
    <div id="music-player-modal" class="fixed inset-0 z-[500] flex items-center justify-center bg-black/95 backdrop-blur-2xl hidden p-4 sm:p-8">
        <div class="w-full max-w-6xl h-full max-h-[800px] flex flex-col md:flex-row gap-8 md:gap-12 items-center justify-center relative">
            
            <button id="music-player-close" class="absolute top-0 right-0 p-4 text-gray-400 hover:text-white transition-colors z-50">
                <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
            <button id="music-player-minimize" class="absolute top-0 right-14 p-4 text-gray-400 hover:text-white transition-colors z-50">
                <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
            </button>

            <!-- Cover Art Section -->
            <div class="flex-1 flex justify-center items-center w-full max-w-md md:max-w-xl aspect-square relative group">
                <div class="absolute inset-0 bg-pink-500/20 blur-3xl rounded-full animate-pulse"></div>
                <img id="music-player-cover" src="" alt="Album Cover" class="w-full h-full object-cover rounded-3xl shadow-2xl border border-white/10 relative z-10">
            </div>

            <!-- Controls Section -->
            <div class="flex-1 w-full max-w-md flex flex-col justify-center gap-8">
                <div class="text-center md:text-left">
                    <h2 id="music-player-title" class="text-4xl font-bold text-white mb-2 leading-tight"></h2>
                    <p id="music-player-artist" class="text-xl text-pink-400 font-medium"></p>
                </div>

                <!-- Progress -->
                <div class="w-full space-y-2">
                    <div id="music-progress-bar" class="slider-container h-2 bg-gray-800 rounded-full cursor-pointer relative group">
                        <div id="music-progress-fill" class="h-full bg-gradient-to-r from-pink-500 to-purple-500 rounded-full relative">
                            <div class="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity transform scale-0 group-hover:scale-100"></div>
                        </div>
                    </div>
                    <div class="flex justify-between text-xs text-gray-400 font-medium font-mono">
                        <span id="music-current-time">0:00</span>
                        <span id="music-total-time">0:00</span>
                    </div>
                </div>

                <!-- Main Buttons -->
                <div class="flex items-center justify-center md:justify-start gap-8">
                    <button id="music-prev-btn" class="text-gray-400 hover:text-white transition-colors transform hover:scale-110">
                        <svg class="w-10 h-10" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
                    </button>
                    <button id="music-play-pause-btn" class="w-20 h-20 rounded-full bg-white text-black hover:scale-105 transition-all shadow-[0_0_30px_rgba(255,255,255,0.3)] flex items-center justify-center">
                        <svg id="music-play-icon" class="w-8 h-8 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                        <svg id="music-pause-icon" class="w-8 h-8 hidden" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                    </button>
                    <button id="music-next-btn" class="text-gray-400 hover:text-white transition-colors transform hover:scale-110">
                        <svg class="w-10 h-10" fill="currentColor" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
                    </button>
                </div>

                <!-- Volume -->
                <div class="flex items-center gap-4 mt-4">
                    <svg class="w-5 h-5 text-gray-500" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>
                    <div id="music-volume-bar" class="slider-container flex-1 h-1.5 bg-gray-800 rounded-full cursor-pointer">
                        <div id="music-volume-fill" class="h-full bg-gray-400 rounded-full" style="width: 100%"></div>
                    </div>
                </div>
            </div>
            
            <audio id="music-audio" preload="auto"></audio>
        </div>
    </div>

    <!-- Mini Player (Bottom Right Float) -->
    <div id="music-mini-player" class="fixed bottom-6 right-6 z-[600] glass-card w-80 rounded-2xl p-4 shadow-2xl hidden border-t border-white/10 flex flex-col gap-3">
        <div class="flex items-center gap-4">
            <!-- Cover Art with Expand Trigger -->
            <div class="relative group cursor-pointer flex-shrink-0" id="mini-player-expand-img">
                <img id="mini-player-cover" src="" alt="" class="w-14 h-14 rounded-xl object-cover bg-gray-800 shadow-md">
                <div class="absolute inset-0 bg-black/40 rounded-xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                     <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/></svg>
                </div>
            </div>
            
            <!-- Text Info (Click to Expand) -->
            <div class="flex-1 min-w-0 cursor-pointer group" id="mini-player-expand-text">
                <p id="mini-player-title" class="text-sm font-bold text-white truncate group-hover:text-pink-400 transition-colors"></p>
                <p id="mini-player-artist" class="text-xs text-pink-400 truncate"></p>
            </div>

            <!-- Controls -->
            <div class="flex items-center gap-2">
                 <button id="mini-play-pause-btn" class="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition-transform shadow-lg">
                    <svg id="mini-play-icon" class="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    <svg id="mini-pause-icon" class="w-4 h-4 hidden" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                </button>
                <!-- Explicit Expand Button -->
                <button id="mini-player-maximize-btn" class="text-gray-400 hover:text-white transition-colors p-1" title="Maximize">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/></svg>
                </button>
            </div>
        </div>
        <div id="mini-progress-bar" class="h-1 bg-gray-700 rounded-full cursor-pointer relative overflow-hidden">
            <div id="mini-progress-fill" class="h-full bg-gradient-to-r from-pink-500 to-purple-500 rounded-full" style="width: 0%"></div>
        </div>
    </div>

    <!-- Playlist Chooser Modal -->
    <div id="music-playlist-chooser" class="fixed inset-0 z-[550] flex items-center justify-center bg-black/80 backdrop-blur-sm hidden p-4">
        <div class="glass-panel w-full max-w-sm rounded-2xl p-6 shadow-2xl border border-white/10">
            <div class="flex items-center justify-between mb-4 border-b border-white/10 pb-3">
                <h3 class="text-xl font-bold text-white">Add to Playlist</h3>
                <button id="playlist-chooser-close" class="text-gray-400 hover:text-white transition-colors">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
            </div>
            <div class="space-y-4">
                <div class="flex gap-2">
                    <input id="chooser-new-playlist" type="text" placeholder="Create new playlist..." class="flex-1 bg-gray-800/50 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
                    <button id="chooser-create-btn" class="bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors">Create</button>
                </div>
                <div id="playlist-chooser-list" class="space-y-2 max-h-60 overflow-y-auto music-scroll pr-1"></div>
                <div id="playlist-chooser-empty" class="hidden text-center text-gray-500 py-4 text-sm">
                    No playlists found.
                </div>
            </div>
        </div>
    </div>
    `;
    
    mainContent.insertAdjacentHTML('beforeend', musicHTML);
}

// Storage keys - MUST match main app for cross-compatibility
const MY_MUSIC_KEY = 'pt_my_music_v1';
const PLAYLISTS_KEY = 'pt_playlists_v1';
const MY_ALBUMS_KEY = 'pt_my_albums_v1';

// State
let currentView = 'empty'; // 'empty', 'results', 'my-music', 'playlists', 'playlist-view', 'album-view', 'my-albums'
let currentPlaylistId = null;
let currentAlbumData = null;
let currentAlbumTracks = [];
let musicQueue = [];
let currentQueueIndex = 0;
let isPlaying = false;

// Storage helpers - same as main app
function getMyMusic() {
    try { return JSON.parse(localStorage.getItem(MY_MUSIC_KEY) || '[]'); } catch(_) { return []; }
}

function setMyMusic(arr) {
    try { localStorage.setItem(MY_MUSIC_KEY, JSON.stringify(arr)); } catch(_) {}
}

function getPlaylists() {
    try { return JSON.parse(localStorage.getItem(PLAYLISTS_KEY) || '[]'); } catch(_) { return []; }
}

function setPlaylists(arr) {
    try { localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(arr)); } catch(_) {}
}

function getMyAlbums() {
    try { return JSON.parse(localStorage.getItem(MY_ALBUMS_KEY) || '[]'); } catch(_) { return []; }
}

function setMyAlbums(arr) {
    try { localStorage.setItem(MY_ALBUMS_KEY, JSON.stringify(arr)); } catch(_) {}
}

function addTrackToPlaylist(playlistId, track) {
    const pls = getPlaylists();
    const pl = pls.find(p => p.id === playlistId);
    if (!pl) return false;
    if (!pl.tracks) pl.tracks = [];
    if (!pl.tracks.find(t => t.id === track.id)) {
        pl.tracks.push(track);
        setPlaylists(pls);
        return true;
    }
    return false;
}

// DOM Elements
let musicSection, musicLoading, musicEmpty, musicResults, musicResultsGrid;
let myMusicSection, myMusicGrid, myMusicEmpty;
let playlistsSection, playlistsGrid, playlistsEmpty;
let playlistView, playlistTracksGrid, playlistEmpty, playlistViewTitle;
let musicSearchInput, musicSearchBtn;
let musicPlayerModal, musicMiniPlayer, musicAudio;
let playlistChooser, playlistChooserList;

// Initialize DOM references
function initDOMRefs() {
    musicSection = document.getElementById('musicSection');
    musicLoading = document.getElementById('music-loading');
    musicEmpty = document.getElementById('music-empty');
    musicResults = document.getElementById('music-results');
    musicResultsGrid = document.getElementById('music-results-grid');
    myMusicSection = document.getElementById('my-music-section');
    myMusicGrid = document.getElementById('my-music-grid');
    myMusicEmpty = document.getElementById('my-music-empty');
    playlistsSection = document.getElementById('playlists-section');
    playlistsGrid = document.getElementById('playlists-grid');
    playlistsEmpty = document.getElementById('playlists-empty');
    playlistView = document.getElementById('playlist-view');
    playlistTracksGrid = document.getElementById('playlist-tracks-grid');
    playlistEmpty = document.getElementById('playlist-empty');
    playlistViewTitle = document.getElementById('playlist-view-title');
    musicSearchInput = document.getElementById('music-search-input');
    musicSearchBtn = document.getElementById('music-search-btn');
    musicPlayerModal = document.getElementById('music-player-modal');
    musicMiniPlayer = document.getElementById('music-mini-player');
    musicAudio = document.getElementById('music-audio');
    playlistChooser = document.getElementById('music-playlist-chooser');
    playlistChooserList = document.getElementById('playlist-chooser-list');
}

// Show notification
function showNotification(message, type = 'info') {
    // Use existing notification system if available
    if (window.showNotification) {
        window.showNotification(message, type);
    } else {
        console.log(`[${type}] ${message}`);
    }
}

// Hide all sub-sections
function hideAllSubSections() {
    if (musicEmpty) musicEmpty.classList.add('hidden');
    if (musicResults) musicResults.classList.add('hidden');
    if (myMusicSection) myMusicSection.classList.add('hidden');
    if (playlistsSection) playlistsSection.classList.add('hidden');
    if (playlistView) playlistView.classList.add('hidden');
    if (musicLoading) musicLoading.classList.add('hidden');
    
    const albumView = document.getElementById('album-view');
    const myAlbumsSection = document.getElementById('my-albums-section');
    if (albumView) albumView.classList.add('hidden');
    if (myAlbumsSection) myAlbumsSection.classList.add('hidden');
}

// Show a specific view
function showView(view) {
    hideAllSubSections();
    currentView = view;
    
    switch(view) {
        case 'empty':
            if (musicEmpty) musicEmpty.classList.remove('hidden');
            break;
        case 'results':
            if (musicResults) musicResults.classList.remove('hidden');
            break;
        case 'my-music':
            if (myMusicSection) myMusicSection.classList.remove('hidden');
            renderMyMusic();
            break;
        case 'playlists':
            if (playlistsSection) playlistsSection.classList.remove('hidden');
            renderPlaylists();
            break;
        case 'playlist-view':
            if (playlistView) playlistView.classList.remove('hidden');
            break;
        case 'album-view':
            const albumView = document.getElementById('album-view');
            if (albumView) albumView.classList.remove('hidden');
            break;
        case 'my-albums':
            const myAlbumsSection = document.getElementById('my-albums-section');
            if (myAlbumsSection) myAlbumsSection.classList.remove('hidden');
            renderMyAlbums();
            break;
        case 'loading':
            if (musicLoading) musicLoading.classList.remove('hidden');
            break;
    }
}

// Search music via API (same as main app)
async function searchMusic(query) {
    if (!query.trim()) return;
    
    showView('loading');
    
    try {
        const [tracksRes, albumsRes] = await Promise.all([
            fetch(`/api/search?q=${encodeURIComponent(query)}&type=track&limit=30`),
            fetch(`/api/search?q=${encodeURIComponent(query)}&type=album&limit=20`)
        ]);
        
        let tracks = [];
        let albums = [];
        
        if (tracksRes.ok) {
            const tracksData = await tracksRes.json();
            const items = Array.isArray(tracksData?.results) ? tracksData.results : [];
            tracks = items.map(it => ({
                id: it.id,
                title: it.title || it.name || 'Unknown Title',
                artist: it.artists || 'Unknown Artist',
                cover: it.albumArt || ''
            }));
        }
        
        if (albumsRes.ok) {
            const albumsData = await albumsRes.json();
            const items = Array.isArray(albumsData?.results) ? albumsData.results : [];
            albums = items.map(it => ({
                id: it.id,
                name: it.title || it.name || 'Unknown Album',
                artist: it.artists || 'Unknown Artist',
                cover: it.albumArt || '',
                totalTracks: it.totalTracks || 0,
                releaseDate: it.releaseDate || ''
            }));
        }
        
        renderSearchResults(tracks, albums, query);
        showView('results');
    } catch (err) {
        console.error('Music search error:', err);
        showNotification('Failed to search music', 'error');
        showView('empty');
    }
}

// Render search results
function renderSearchResults(tracks, albums = [], query = '') {
    if (!musicResultsGrid) return;
    
    const resultsTitle = document.getElementById('music-results-title');
    const resultsCount = document.getElementById('music-results-count');
    
    if (resultsTitle) resultsTitle.textContent = query ? `Results for "${query}"` : 'Search Results';
    if (resultsCount) resultsCount.textContent = `${tracks.length} songs, ${albums.length} albums`;
    
    musicResultsGrid.innerHTML = '';
    
    // Tracks Header
    if (tracks.length > 0) {
        const tracksHeader = document.createElement('div');
        tracksHeader.className = 'col-span-full mb-4 mt-2 flex items-center gap-3 pb-2 border-b border-white/5';
        tracksHeader.innerHTML = `
            <div class="p-2 rounded-lg bg-pink-500/10 text-pink-500">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/></svg>
            </div>
            <h4 class="text-xl font-semibold text-white">Songs</h4>
        `;
        musicResultsGrid.appendChild(tracksHeader);
        
        tracks.forEach(track => {
            const card = createTrackCard(track);
            musicResultsGrid.appendChild(card);
        });
    }
    
    // Albums Header
    if (albums.length > 0) {
        const albumsHeader = document.createElement('div');
        albumsHeader.className = 'col-span-full mb-4 mt-8 flex items-center gap-3 pb-2 border-b border-white/5';
        albumsHeader.innerHTML = `
             <div class="p-2 rounded-lg bg-blue-500/10 text-blue-500">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-width="2"/><circle cx="12" cy="12" r="3" stroke-width="2"/></svg>
            </div>
            <h4 class="text-xl font-semibold text-white">Albums</h4>
        `;
        musicResultsGrid.appendChild(albumsHeader);
        
        albums.forEach(album => {
            const card = createAlbumCard(album);
            musicResultsGrid.appendChild(card);
        });
    }
    
    if (albums.length === 0 && tracks.length === 0) {
        musicResultsGrid.innerHTML = `
            <div class="col-span-full text-center text-gray-400 py-20 flex flex-col items-center">
                <svg class="w-16 h-16 mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                <p class="text-xl">No results found</p>
                <p class="text-sm mt-2">Try checking your spelling or use different keywords.</p>
            </div>
        `;
    }
}

// Create a track card element (New Glass Style)
function createTrackCard(track) {
    const isSaved = getMyMusic().some(t => t.id === track.id);
    
    const card = document.createElement('div');
    card.className = 'glass-card rounded-2xl p-3 relative group';
    
    const coverUrl = track.cover || track.album?.images?.[0]?.url || 'https://via.placeholder.com/200x200/1a1a2e/ec4899?text=♪';
    const title = track.title || track.name || 'Unknown';
    const artist = track.artist || track.artists?.map(a => a.name).join(', ') || 'Unknown Artist';
    
    card.innerHTML = `
        <div class="relative aspect-square rounded-xl overflow-hidden mb-3">
            <img src="${coverUrl}" alt="${title}" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110">
            <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 backdrop-blur-[2px]">
                <button class="play-btn w-10 h-10 rounded-full bg-pink-600 text-white flex items-center justify-center hover:scale-110 transition-transform shadow-lg" data-id="${track.id}" data-title="${title.replace(/"/g, '&quot;')}" data-artist="${artist.replace(/"/g, '&quot;')}" data-cover="${coverUrl}">
                    <svg class="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                </button>
            </div>
        </div>
        <div>
            <p class="text-sm font-bold text-white truncate leading-tight mb-1" title="${title}">${title}</p>
            <p class="text-xs text-gray-400 truncate hover:text-gray-300 transition-colors">${artist}</p>
            
            <div class="absolute top-4 right-4 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0">
                <button class="heart-btn w-8 h-8 rounded-full ${isSaved ? 'bg-pink-600 text-white' : 'bg-black/60 text-white hover:bg-pink-600'} backdrop-blur-md flex items-center justify-center transition-colors shadow-lg" data-id="${track.id}" data-title="${title.replace(/"/g, '&quot;')}" data-artist="${artist.replace(/"/g, '&quot;')}" data-cover="${coverUrl}">
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                </button>
                <button class="add-playlist-btn w-8 h-8 rounded-full bg-black/60 text-white hover:bg-blue-600 backdrop-blur-md flex items-center justify-center transition-colors shadow-lg" data-id="${track.id}" data-title="${title.replace(/"/g, '&quot;')}" data-artist="${artist.replace(/"/g, '&quot;')}" data-cover="${coverUrl}">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
                </button>
            </div>
        </div>
    `;
    
    // Event listeners
    card.querySelector('.play-btn').addEventListener('click', (e) => {
        const btn = e.currentTarget;
        playTrack({
            id: btn.dataset.id,
            title: btn.dataset.title,
            artist: btn.dataset.artist,
            cover: btn.dataset.cover
        });
    });
    
    card.querySelector('.heart-btn').addEventListener('click', (e) => {
        const btn = e.currentTarget;
        toggleSaveTrack({
            id: btn.dataset.id,
            title: btn.dataset.title,
            artist: btn.dataset.artist,
            cover: btn.dataset.cover
        }, btn);
    });
    
    card.querySelector('.add-playlist-btn').addEventListener('click', (e) => {
        const btn = e.currentTarget;
        openPlaylistChooser({
            id: btn.dataset.id,
            title: btn.dataset.title,
            artist: btn.dataset.artist,
            cover: btn.dataset.cover
        });
    });
    
    return card;
}

// Create an album card element (New Glass Style)
function createAlbumCard(album) {
    const isSaved = getMyAlbums().some(a => String(a.id) === String(album.id));
    
    const card = document.createElement('div');
    card.className = 'glass-card rounded-2xl p-3 relative group cursor-pointer';
    
    const coverUrl = album.cover || album.albumArt || 'https://via.placeholder.com/200x200/1a1a2e/3b82f6?text=♪';
    const name = album.name || album.title || 'Unknown Album';
    const artist = album.artist || album.artists || 'Unknown Artist';
    
    card.innerHTML = `
        <div class="relative aspect-square rounded-xl overflow-hidden mb-3">
            <img src="${coverUrl}" alt="${name}" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105">
            <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[1px]">
                <button class="open-album-btn w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center hover:scale-110 transition-transform shadow-lg">
                    <svg class="w-6 h-6 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                </button>
            </div>
            <div class="absolute top-2 left-2">
                <span class="px-2 py-1 rounded-md bg-black/60 backdrop-blur-sm text-white text-[10px] font-bold uppercase tracking-wider">Album</span>
            </div>
        </div>
        <div>
            <p class="text-sm font-bold text-white truncate leading-tight mb-1">${name}</p>
            <p class="text-xs text-gray-400 truncate">${artist}</p>
            
             <button class="album-heart-btn absolute top-5 right-5 w-8 h-8 rounded-full ${isSaved ? 'bg-blue-600 text-white' : 'bg-black/60 text-white hover:bg-blue-600'} backdrop-blur-md flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 shadow-lg" data-id="${album.id}">
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
            </button>
        </div>
    `;
    
    const normalizedAlbum = {
        id: album.id,
        name: name,
        artist: artist,
        cover: coverUrl,
        totalTracks: album.totalTracks,
        releaseDate: album.releaseDate || ''
    };
    
    // Open album on click
    card.querySelector('.open-album-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        openAlbum(normalizedAlbum);
    });
    
    card.addEventListener('click', () => openAlbum(normalizedAlbum));
    
    // Save album
    card.querySelector('.album-heart-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSaveAlbum(normalizedAlbum, e.currentTarget);
    });
    
    return card;
}

// Toggle save album
function toggleSaveAlbum(album, btn) {
    const saved = getMyAlbums();
    const exists = saved.find(a => String(a.id) === String(album.id));
    
    if (exists) {
        const filtered = saved.filter(a => String(a.id) !== String(album.id));
        setMyAlbums(filtered);
        
        // Update button visual state if it's the main save button (has text)
        if (btn.id === 'album-save-btn') {
            btn.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg> Save`;
            btn.classList.add('bg-white/10', 'hover:bg-white/20');
            btn.classList.remove('bg-blue-600', 'hover:bg-blue-500');
        } else {
            // It's a card button (icon only)
            btn.classList.remove('bg-blue-600', 'text-white');
            btn.classList.add('bg-black/60', 'text-white', 'hover:bg-blue-600');
        }
        
        showNotification('Removed from Saved Albums', 'info');
        
        if (currentView === 'my-albums') renderMyAlbums();
    } else {
        saved.push(album);
        setMyAlbums(saved);
        
        if (btn.id === 'album-save-btn') {
            btn.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> Saved`;
            btn.classList.remove('bg-white/10', 'hover:bg-white/20');
            btn.classList.add('bg-blue-600', 'hover:bg-blue-500');
        } else {
            btn.classList.add('bg-blue-600', 'text-white');
            btn.classList.remove('bg-black/60', 'hover:bg-blue-600');
        }
        
        showNotification(`Added "${album.name}" to Saved Albums`, 'success');
    }
}

// Open album
async function openAlbum(album) {
    currentAlbumData = album;
    currentAlbumTracks = [];
    
    showView('album-view');
    
    const albumViewTitle = document.getElementById('album-view-title');
    const albumViewArtist = document.getElementById('album-view-artist');
    const albumViewCover = document.getElementById('album-view-cover');
    const albumTracksGrid = document.getElementById('album-tracks-grid');
    
    if (albumViewTitle) albumViewTitle.textContent = album.name || 'Album';
    if (albumViewArtist) albumViewArtist.textContent = album.artist || 'Unknown Artist';
    if (albumViewCover) albumViewCover.src = album.cover || 'https://via.placeholder.com/200x200/1a1a2e/3b82f6?text=♪';
    if (albumTracksGrid) albumTracksGrid.innerHTML = '<div class="text-center py-20 flex flex-col items-center"><div class="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div><p class="text-gray-400">Loading tracks...</p></div>';
    
    try {
        const res = await fetch(`/api/album/${encodeURIComponent(album.id)}/tracks`);
        if (!res.ok) throw new Error('Failed to load album');
        const data = await res.json();
        
        const tracks = Array.isArray(data.tracks) ? data.tracks : [];
        const albumMeta = data.album || {};
        
        if (albumMeta.name && albumViewTitle) albumViewTitle.textContent = albumMeta.name;
        if (albumMeta.artists && albumViewArtist) albumViewArtist.textContent = albumMeta.artists;
        if (albumMeta.albumArt && albumViewCover) albumViewCover.src = albumMeta.albumArt;
        
        // Update Save Button State
        const savedAlbums = getMyAlbums();
        const isSaved = savedAlbums.some(a => String(a.id) === String(album.id));
        const saveBtn = document.getElementById('album-save-btn');
        if (saveBtn) {
            if (isSaved) {
                saveBtn.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> Saved`;
                saveBtn.classList.remove('bg-white/10', 'hover:bg-white/20');
                saveBtn.classList.add('bg-blue-600', 'hover:bg-blue-500');
            } else {
                saveBtn.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg> Save`;
                saveBtn.classList.add('bg-white/10', 'hover:bg-white/20');
                saveBtn.classList.remove('bg-blue-600', 'hover:bg-blue-500');
            }
        }

        currentAlbumTracks = tracks.map((t, idx) => ({
            id: t.id || idx + 1,
            title: t.title || t.name || `Track ${idx + 1}`,
            artist: t.artists || albumMeta.artists || album.artist || 'Unknown Artist',
            cover: albumMeta.albumArt || album.cover || ''
        }));
        
        renderAlbumTracks(tracks, albumMeta.albumArt || album.cover, albumMeta.artists || album.artist);
    } catch (err) {
        console.error('Failed to load album:', err);
        if (albumTracksGrid) albumTracksGrid.innerHTML = '<div class="text-center text-red-400 py-20">Failed to load album tracks</div>';
    }
}

// Render album tracks (List Style)
function renderAlbumTracks(tracks, coverUrl, artistName) {
    const albumTracksGrid = document.getElementById('album-tracks-grid');
    if (!albumTracksGrid) return;
    
    if (tracks.length === 0) {
        albumTracksGrid.innerHTML = '<div class="text-center text-gray-400 py-20 font-light">No tracks found in this album</div>';
        return;
    }
    
    albumTracksGrid.innerHTML = '';
    
    // Header for the track list
    const header = document.createElement('div');
    header.className = 'gap-4 px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-white/10 mb-2';
    header.style.cssText = 'display: grid; grid-template-columns: 50px 2fr 1fr 100px;';
    header.innerHTML = `
        <div class="text-center">#</div>
        <div>Title</div>
        <div>Artist</div>
        <div class="text-right">Actions</div>
    `;
    albumTracksGrid.appendChild(header);
    
    tracks.forEach((track, idx) => {
        const trackId = track.id || idx + 1;
        const title = track.title || track.name || `Track ${idx + 1}`;
        const artist = track.artists || artistName || 'Unknown Artist';
        const isSaved = getMyMusic().some(t => String(t.id) === String(trackId));
        
        const row = document.createElement('div');
        row.className = 'group gap-4 items-center px-4 py-3.5 rounded-xl hover:bg-white/5 transition-all duration-200 cursor-pointer border border-transparent hover:border-white/5';
        row.style.cssText = 'display: grid; grid-template-columns: 50px 2fr 1fr 100px;';
        
        row.innerHTML = `
            <div class="flex justify-center">
                <span class="text-gray-500 font-mono text-sm group-hover:hidden transition-none">${idx + 1}</span>
                <button class="track-play-btn hidden group-hover:flex w-8 h-8 items-center justify-center rounded-full bg-pink-500 text-white shadow-md hover:scale-110 transition-transform" data-idx="${idx}">
                    <svg class="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                </button>
            </div>
            
            <div class="min-w-0 pr-4">
                <p class="text-sm font-bold text-white truncate group-hover:text-pink-400 transition-colors">${title}</p>
            </div>

            <div class="min-w-0">
                <p class="text-sm text-gray-400 truncate">${artist}</p>
            </div>
            
            <div class="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button class="track-heart-btn p-2 rounded-full ${isSaved ? 'text-pink-500 bg-pink-500/10' : 'text-gray-400 hover:text-white hover:bg-white/10'} transition-all" data-id="${trackId}" data-title="${title.replace(/"/g, '&quot;')}" data-artist="${artist.replace(/"/g, '&quot;')}" data-cover="${coverUrl || ''}" title="${isSaved ? 'Remove from Liked' : 'Save to Liked'}">
                     <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                </button>
                <button class="add-playlist-btn p-2 rounded-full text-gray-400 hover:text-blue-400 hover:bg-blue-400/10 transition-all" data-id="${trackId}" data-title="${title.replace(/"/g, '&quot;')}" data-artist="${artist.replace(/"/g, '&quot;')}" data-cover="${coverUrl || ''}" title="Add to Playlist">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
                </button>
            </div>
        `;
        
        // Play track on row click (unless clicking a button)
        row.addEventListener('click', (e) => {
            if (!e.target.closest('button')) {
                const playBtn = row.querySelector('.track-play-btn');
                if (playBtn) playBtn.click();
            }
        });

        row.querySelector('.track-play-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(e.currentTarget.dataset.idx);
            if (currentAlbumTracks.length > 0) {
                playTrack(currentAlbumTracks[idx], currentAlbumTracks, idx);
            }
        });
        
        row.querySelector('.track-heart-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            const btn = e.currentTarget;
            toggleSaveTrack({
                id: btn.dataset.id,
                title: btn.dataset.title,
                artist: btn.dataset.artist,
                cover: btn.dataset.cover
            }, btn);
        });

        row.querySelector('.add-playlist-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            const btn = e.currentTarget;
            openPlaylistChooser({
                id: btn.dataset.id,
                title: btn.dataset.title,
                artist: btn.dataset.artist,
                cover: btn.dataset.cover
            });
        });
        
        albumTracksGrid.appendChild(row);
    });
}

// Render My Albums
function renderMyAlbums() {
    const myAlbumsGrid = document.getElementById('my-albums-grid');
    const myAlbumsEmpty = document.getElementById('my-albums-empty');
    if (!myAlbumsGrid) return;
    
    const albums = getMyAlbums();
    myAlbumsGrid.innerHTML = '';
    
    if (albums.length === 0) {
        if (myAlbumsEmpty) myAlbumsEmpty.classList.remove('hidden');
        return;
    }
    
    if (myAlbumsEmpty) myAlbumsEmpty.classList.add('hidden');
    
    albums.forEach(album => {
        const card = createAlbumCard(album);
        myAlbumsGrid.appendChild(card);
    });
}

// Toggle save track
function toggleSaveTrack(track, btn) {
    const saved = getMyMusic();
    const exists = saved.find(t => t.id === track.id);
    
    if (exists) {
        const filtered = saved.filter(t => t.id !== track.id);
        setMyMusic(filtered);
        
        // Update button style
        if (btn.classList.contains('bg-pink-600')) { // Card style button
             btn.classList.remove('bg-pink-600', 'text-white');
             btn.classList.add('bg-black/60', 'text-white', 'hover:bg-pink-600');
        } else { // List style button
             btn.classList.remove('text-pink-500');
             btn.classList.add('text-gray-400');
        }
       
        showNotification('Removed from Liked Songs', 'info');
        
        if (currentView === 'my-music') renderMyMusic();
    } else {
        saved.push(track);
        setMyMusic(saved);
        
        if (btn.classList.contains('bg-black/60')) { // Card style button
             btn.classList.add('bg-pink-600', 'text-white');
             btn.classList.remove('bg-black/60', 'hover:bg-pink-600');
        } else { // List style button
             btn.classList.add('text-pink-500');
             btn.classList.remove('text-gray-400');
        }

        showNotification(`Added "${track.title}" to Liked Songs`, 'success');
    }
}

// Render My Music
function renderMyMusic() {
    if (!myMusicGrid) return;
    
    const tracks = getMyMusic();
    myMusicGrid.innerHTML = '';
    
    if (tracks.length === 0) {
        if (myMusicEmpty) myMusicEmpty.classList.remove('hidden');
        return;
    }
    
    if (myMusicEmpty) myMusicEmpty.classList.add('hidden');
    
    tracks.forEach(track => {
        const card = createTrackCard(track);
        myMusicGrid.appendChild(card);
    });
}

// Render Playlists
function renderPlaylists() {
    if (!playlistsGrid) return;
    
    const playlists = getPlaylists();
    playlistsGrid.innerHTML = '';
    
    if (playlists.length === 0) {
        if (playlistsEmpty) playlistsEmpty.classList.remove('hidden');
        return;
    }
    
    if (playlistsEmpty) playlistsEmpty.classList.add('hidden');
    
    playlists.forEach(pl => {
        const card = document.createElement('div');
        card.className = 'glass-card rounded-2xl overflow-hidden cursor-pointer group relative';
        
        const trackCount = pl.tracks ? pl.tracks.length : 0;
        const coverUrl = pl.tracks?.[0]?.cover || 'https://via.placeholder.com/200x200/1a1a2e/3b82f6?text=♪';
        
        card.innerHTML = `
            <div class="aspect-square relative">
                <img src="${coverUrl}" alt="${pl.name}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500">
                <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"></div>
                <div class="absolute bottom-0 left-0 p-4 w-full">
                    <p class="text-lg font-bold text-white truncate shadow-black drop-shadow-md">${pl.name}</p>
                    <p class="text-xs text-gray-300">${trackCount} tracks</p>
                </div>
                <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 backdrop-blur-[2px]">
                     <svg class="w-12 h-12 text-white drop-shadow-lg" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                </div>
            </div>
        `;
        
        card.addEventListener('click', () => openPlaylist(pl.id));
        playlistsGrid.appendChild(card);
    });
}

// Open a specific playlist
function openPlaylist(playlistId) {
    const playlists = getPlaylists();
    const pl = playlists.find(p => p.id === playlistId);
    if (!pl) return;
    
    currentPlaylistId = playlistId;
    
    if (playlistViewTitle) playlistViewTitle.textContent = pl.name;
    if (playlistTracksGrid) playlistTracksGrid.innerHTML = '';
    
    if (!pl.tracks || pl.tracks.length === 0) {
        if (playlistEmpty) playlistEmpty.classList.remove('hidden');
    } else {
        if (playlistEmpty) playlistEmpty.classList.add('hidden');
        pl.tracks.forEach(track => {
            const card = createTrackCard(track);
            // Add remove button overlay
            const removeBtn = document.createElement('button');
            removeBtn.className = 'absolute top-2 left-2 p-1.5 rounded-full bg-red-500/80 text-white hover:bg-red-600 transition-colors opacity-0 group-hover:opacity-100 z-20';
            removeBtn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>';
            removeBtn.title = "Remove from playlist";
            
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                removeTrackFromPlaylist(playlistId, track.id);
            });
            
            card.appendChild(removeBtn);
            playlistTracksGrid.appendChild(card);
        });
    }
    
    showView('playlist-view');
}

// Remove track from playlist
function removeTrackFromPlaylist(playlistId, trackId) {
    const playlists = getPlaylists();
    const pl = playlists.find(p => p.id === playlistId);
    if (!pl || !pl.tracks) return;
    
    pl.tracks = pl.tracks.filter(t => t.id !== trackId);
    setPlaylists(playlists);
    openPlaylist(playlistId);
    showNotification('Removed from playlist', 'info');
}

// Create new playlist
function createPlaylist(name) {
    if (!name.trim()) return;
    
    const playlists = getPlaylists();
    const newPlaylist = {
        id: 'pl_' + Date.now(),
        name: name.trim(),
        tracks: [],
        createdAt: new Date().toISOString()
    };
    
    playlists.push(newPlaylist);
    setPlaylists(playlists);
    showNotification(`Created "${name}"`, 'success');
    renderPlaylists();
    
    return newPlaylist;
}

// Delete playlist
function deletePlaylist(playlistId) {
    const playlists = getPlaylists().filter(p => p.id !== playlistId);
    setPlaylists(playlists);
    showNotification('Playlist deleted', 'info');
    showView('playlists');
}

// Open playlist chooser modal
let pendingTrackForPlaylist = null;

function openPlaylistChooser(track) {
    pendingTrackForPlaylist = track;
    
    if (!playlistChooser) return;
    
    const playlists = getPlaylists();
    const chooserEmpty = document.getElementById('playlist-chooser-empty');
    
    if (playlistChooserList) {
        playlistChooserList.innerHTML = '';
        
        if (playlists.length === 0) {
            if (chooserEmpty) chooserEmpty.classList.remove('hidden');
        } else {
            if (chooserEmpty) chooserEmpty.classList.add('hidden');
            
            playlists.forEach(pl => {
                const item = document.createElement('button');
                item.className = 'w-full p-3 rounded-lg bg-white/5 hover:bg-white/10 text-left transition-colors flex items-center justify-between group';
                item.innerHTML = `
                    <span class="text-white font-medium">${pl.name}</span>
                    <span class="text-xs text-gray-400 group-hover:text-white transition-colors">${pl.tracks?.length || 0} tracks</span>
                `;
                item.addEventListener('click', () => {
                    if (pendingTrackForPlaylist) {
                        const added = addTrackToPlaylist(pl.id, pendingTrackForPlaylist);
                        if (added) {
                            showNotification(`Added to "${pl.name}"`, 'success');
                        } else {
                            showNotification('Already in playlist', 'info');
                        }
                    }
                    closePlaylistChooser();
                });
                playlistChooserList.appendChild(item);
            });
        }
    }
    
    playlistChooser.classList.remove('hidden');
}

function closePlaylistChooser() {
    if (playlistChooser) playlistChooser.classList.add('hidden');
    pendingTrackForPlaylist = null;
}

// Music Player Functions
let currentTrack = null;

async function playTrack(track, queue = null, index = 0) {
    currentTrack = track;
    
    if (queue) {
        musicQueue = queue;
        currentQueueIndex = index;
    } else {
        musicQueue = [track];
        currentQueueIndex = 0;
    }
    
    // Update player UI
    const playerCover = document.getElementById('music-player-cover');
    const playerTitle = document.getElementById('music-player-title');
    const playerArtist = document.getElementById('music-player-artist');
    const miniCover = document.getElementById('mini-player-cover');
    const miniTitle = document.getElementById('mini-player-title');
    const miniArtist = document.getElementById('mini-player-artist');
    const playPauseBtn = document.getElementById('music-play-pause-btn');
    
    const defaultCover = 'https://via.placeholder.com/200x200/1a1a2e/ec4899?text=♪';
    const cover = track.cover || defaultCover;
    
    if (playerCover) playerCover.src = cover;
    if (playerTitle) playerTitle.textContent = track.title || 'Unknown';
    if (playerArtist) playerArtist.textContent = track.artist || 'Unknown Artist';
    if (miniCover) miniCover.src = cover;
    if (miniTitle) miniTitle.textContent = track.title || 'Unknown';
    if (miniArtist) miniArtist.textContent = track.artist || 'Unknown Artist';
    
    if (playPauseBtn) {
        playPauseBtn.innerHTML = '<div class="w-8 h-8 border-4 border-gray-300 border-t-transparent rounded-full animate-spin"></div>';
    }
    
    showMusicPlayer();
    
    const progressFill = document.getElementById('music-progress-fill');
    const miniProgressFill = document.getElementById('mini-progress-fill');
    const currentTime = document.getElementById('music-current-time');
    const totalTime = document.getElementById('music-total-time');
    if (progressFill) progressFill.style.width = '0%';
    if (miniProgressFill) miniProgressFill.style.width = '0%';
    if (currentTime) currentTime.textContent = '0:00';
    if (totalTime) totalTime.textContent = '0:00';
    
    try {
        const res = await fetch(`/api/direct-stream-url?trackId=${encodeURIComponent(track.id)}`);
        if (!res.ok) throw new Error('Failed to get stream URL');
        const data = await res.json();
        
        const streamUrl = data?.streamUrl;
        if (!streamUrl) throw new Error('No stream URL returned');
        
        if (musicAudio) {
            musicAudio.src = streamUrl;
            musicAudio.load();
            await musicAudio.play();
            isPlaying = true;
            updatePlayPauseUI();
        }
    } catch (err) {
        console.error('Play error:', err);
        showNotification('Failed to play track', 'error');
        updatePlayPauseUI();
    }
}

function togglePlayPause() {
    if (!musicAudio) return;
    
    if (musicAudio.paused) {
        musicAudio.play();
        isPlaying = true;
    } else {
        musicAudio.pause();
        isPlaying = false;
    }
    updatePlayPauseUI();
}

function updatePlayPauseUI() {
    const playPauseBtn = document.getElementById('music-play-pause-btn');
    const miniPlayPauseBtn = document.getElementById('mini-play-pause-btn');
    
    if (playPauseBtn) {
        if (isPlaying) {
            playPauseBtn.innerHTML = '<svg class="w-8 h-8 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
        } else {
            playPauseBtn.innerHTML = '<svg class="w-8 h-8 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
        }
    }
    
    if (miniPlayPauseBtn) {
         if (isPlaying) {
            miniPlayPauseBtn.innerHTML = '<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
        } else {
            miniPlayPauseBtn.innerHTML = '<svg class="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
        }
    }
}

function playNext() {
    if (musicQueue.length === 0) return;
    currentQueueIndex = (currentQueueIndex + 1) % musicQueue.length;
    playTrack(musicQueue[currentQueueIndex], musicQueue, currentQueueIndex);
}

function playPrev() {
    if (musicQueue.length === 0) return;
    currentQueueIndex = (currentQueueIndex - 1 + musicQueue.length) % musicQueue.length;
    playTrack(musicQueue[currentQueueIndex], musicQueue, currentQueueIndex);
}

function showMusicPlayer() {
    if (musicPlayerModal) musicPlayerModal.classList.remove('hidden');
    if (musicMiniPlayer) musicMiniPlayer.classList.add('hidden');
}

function hideMusicPlayer() {
    if (musicPlayerModal) musicPlayerModal.classList.add('hidden');
    if (musicMiniPlayer) musicMiniPlayer.classList.add('hidden');
    if (musicAudio) {
        musicAudio.pause();
        musicAudio.currentTime = 0;
        musicAudio.src = '';
    }
    isPlaying = false;
    updatePlayPauseUI();
}

function minimizeMusicPlayer() {
    if (musicPlayerModal) musicPlayerModal.classList.add('hidden');
    if (musicMiniPlayer) musicMiniPlayer.classList.remove('hidden');
}

function expandMusicPlayer() {
    if (musicMiniPlayer) musicMiniPlayer.classList.add('hidden');
    if (musicPlayerModal) musicPlayerModal.classList.remove('hidden');
}

// Format time helper
function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Update progress bar
function updateProgress() {
    if (!musicAudio) return;
    
    const currentTimeEl = document.getElementById('music-current-time');
    const totalTime = document.getElementById('music-total-time');
    const progressFill = document.getElementById('music-progress-fill');
    const miniProgressFill = document.getElementById('mini-progress-fill');
    
    const current = musicAudio.currentTime;
    const duration = musicAudio.duration || 0;
    const percent = duration > 0 ? (current / duration) * 100 : 0;
    
    if (currentTimeEl) currentTimeEl.textContent = formatTime(current);
    if (totalTime) totalTime.textContent = formatTime(duration);
    if (progressFill) progressFill.style.width = `${percent}%`;
    if (miniProgressFill) miniProgressFill.style.width = `${percent}%`;
    
    if (current > 0.1 && isPlaying) updatePlayPauseUI();
}

// Seek to position
function seekTo(e, progressBar) {
    if (!musicAudio || !progressBar) return;
    
    const rect = progressBar.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    musicAudio.currentTime = percent * musicAudio.duration;
}

// Set volume
function setVolume(e, volumeBar) {
    if (!musicAudio || !volumeBar) return;
    
    const rect = volumeBar.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    musicAudio.volume = percent;
    
    const volumeFill = document.getElementById('music-volume-fill');
    if (volumeFill) volumeFill.style.width = `${percent * 100}%`;
}

// Play all tracks from a list
function playAll(tracks, shuffle = false) {
    if (!tracks || tracks.length === 0) {
        showNotification('No tracks to play', 'info');
        return;
    }
    
    let queue = [...tracks];
    if (shuffle) {
        for (let i = queue.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [queue[i], queue[j]] = [queue[j], queue[i]];
        }
    }
    
    playTrack(queue[0], queue, 0);
}


// Initialize Music Module
function initMusic() {
    initDOMRefs();
    
    if (!musicSection) return;
    
    // Search functionality
    if (musicSearchBtn) {
        musicSearchBtn.addEventListener('click', () => {
            const query = musicSearchInput?.value || '';
            searchMusic(query);
        });
    }
    
    if (musicSearchInput) {
        musicSearchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                searchMusic(musicSearchInput.value);
            }
        });
    }
    
    // Header buttons
    const myMusicBtn = document.getElementById('music-my-btn');
    if (myMusicBtn) myMusicBtn.addEventListener('click', () => showView('my-music'));
    
    const myAlbumsBtn = document.getElementById('music-my-albums-btn');
    if (myAlbumsBtn) myAlbumsBtn.addEventListener('click', () => showView('my-albums'));
    
    const playlistsBtn = document.getElementById('music-playlists-btn');
    if (playlistsBtn) playlistsBtn.addEventListener('click', () => showView('playlists'));
    
    // Create playlist
    const createPlaylistBtn = document.getElementById('create-playlist-btn');
    const newPlaylistInput = document.getElementById('new-playlist-name');
    if (createPlaylistBtn && newPlaylistInput) {
        createPlaylistBtn.addEventListener('click', () => {
            createPlaylist(newPlaylistInput.value);
            newPlaylistInput.value = '';
        });
    }
    
    // Playlist controls
    const playlistBackBtn = document.getElementById('playlist-back-btn');
    if (playlistBackBtn) playlistBackBtn.addEventListener('click', () => showView('playlists'));
    
    const playlistDeleteBtn = document.getElementById('playlist-delete-btn');
    if (playlistDeleteBtn) {
        playlistDeleteBtn.addEventListener('click', () => {
            if (currentPlaylistId && confirm('Delete this playlist?')) {
                deletePlaylist(currentPlaylistId);
            }
        });
    }
    
    // Action buttons
    const myMusicPlayAll = document.getElementById('my-music-play-all');
    if (myMusicPlayAll) myMusicPlayAll.addEventListener('click', () => playAll(getMyMusic()));
    
    const myMusicShuffle = document.getElementById('my-music-shuffle');
    if (myMusicShuffle) myMusicShuffle.addEventListener('click', () => playAll(getMyMusic(), true));
    
    const playlistPlayAll = document.getElementById('playlist-play-all');
    if (playlistPlayAll) {
        playlistPlayAll.addEventListener('click', () => {
            const pl = getPlaylists().find(p => p.id === currentPlaylistId);
            if (pl) playAll(pl.tracks || []);
        });
    }
    
    const playlistShuffle = document.getElementById('playlist-shuffle');
    if (playlistShuffle) {
        playlistShuffle.addEventListener('click', () => {
            const pl = getPlaylists().find(p => p.id === currentPlaylistId);
            if (pl) playAll(pl.tracks || [], true);
        });
    }
    
    // Player controls
    const playPauseBtn = document.getElementById('music-play-pause-btn');
    const miniPlayPauseBtn = document.getElementById('mini-play-pause-btn');
    const prevBtn = document.getElementById('music-prev-btn');
    const nextBtn = document.getElementById('music-next-btn');
    const playerClose = document.getElementById('music-player-close');
    const playerMinimize = document.getElementById('music-player-minimize');
    
    // Mini Player Expand Triggers
    const miniExpandImg = document.getElementById('mini-player-expand-img');
    const miniExpandText = document.getElementById('mini-player-expand-text');
    const miniMaximizeBtn = document.getElementById('mini-player-maximize-btn');
    
    if (playPauseBtn) playPauseBtn.addEventListener('click', togglePlayPause);
    if (miniPlayPauseBtn) miniPlayPauseBtn.addEventListener('click', togglePlayPause);
    if (prevBtn) prevBtn.addEventListener('click', playPrev);
    if (nextBtn) nextBtn.addEventListener('click', playNext);
    if (playerClose) playerClose.addEventListener('click', hideMusicPlayer);
    if (playerMinimize) playerMinimize.addEventListener('click', minimizeMusicPlayer);
    
    // Attach expand listeners
    if (miniExpandImg) miniExpandImg.addEventListener('click', expandMusicPlayer);
    if (miniExpandText) miniExpandText.addEventListener('click', expandMusicPlayer);
    if (miniMaximizeBtn) miniMaximizeBtn.addEventListener('click', expandMusicPlayer);
    
    // Progress & Volume
    const progressBar = document.getElementById('music-progress-bar');
    if (progressBar) progressBar.addEventListener('click', (e) => seekTo(e, progressBar));
    
    const miniProgressBar = document.getElementById('mini-progress-bar');
    if (miniProgressBar) miniProgressBar.addEventListener('click', (e) => seekTo(e, miniProgressBar));
    
    const volumeBar = document.getElementById('music-volume-bar');
    if (volumeBar) volumeBar.addEventListener('click', (e) => setVolume(e, volumeBar));
    
    // Audio events
    if (musicAudio) {
        musicAudio.addEventListener('timeupdate', updateProgress);
        musicAudio.addEventListener('ended', playNext);
        musicAudio.addEventListener('play', () => { isPlaying = true; updatePlayPauseUI(); });
        musicAudio.addEventListener('pause', () => { isPlaying = false; updatePlayPauseUI(); });
    }
    
    // Playlist chooser
    const chooserClose = document.getElementById('playlist-chooser-close');
    if (chooserClose) chooserClose.addEventListener('click', closePlaylistChooser);
    
    const chooserCreateBtn = document.getElementById('chooser-create-btn');
    const chooserNewPlaylist = document.getElementById('chooser-new-playlist');
    if (chooserCreateBtn && chooserNewPlaylist) {
        chooserCreateBtn.addEventListener('click', () => {
            const pl = createPlaylist(chooserNewPlaylist.value);
            chooserNewPlaylist.value = '';
            if (pl && pendingTrackForPlaylist) {
                addTrackToPlaylist(pl.id, pendingTrackForPlaylist);
                showNotification(`Added to "${pl.name}"`, 'success');
                closePlaylistChooser();
            } else {
                openPlaylistChooser(pendingTrackForPlaylist);
            }
        });
    }
    
    // Album view controls
    const albumBackBtn = document.getElementById('album-back-btn');
    if (albumBackBtn) albumBackBtn.addEventListener('click', () => showView('results'));
    
    const albumPlayAll = document.getElementById('album-play-all');
    if (albumPlayAll) albumPlayAll.addEventListener('click', () => { if (currentAlbumTracks.length) playAll(currentAlbumTracks); });
    
    const albumShuffle = document.getElementById('album-shuffle');
    if (albumShuffle) albumShuffle.addEventListener('click', () => { if (currentAlbumTracks.length) playAll(currentAlbumTracks, true); });
    
    const albumSaveBtn = document.getElementById('album-save-btn');
    if (albumSaveBtn) {
        albumSaveBtn.addEventListener('click', (e) => {
            if (currentAlbumData) toggleSaveAlbum(currentAlbumData, e.currentTarget);
        });
    }
    
    showView('empty');
}