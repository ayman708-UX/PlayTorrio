const express = require('express');
const axios = require('axios');
const cors = require('cors');
const cheerio = require('cheerio');
const path = require('path');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const { app } = require("electron");
const os = require("os");
const fs = require("fs");
const ytmusic = require('youtube-music-api');


const appName = "PlayTorrio"; 
const userDataPath = path.join(os.homedir(), "AppData", "Roaming", appName);

function getSavedManifestUrl() {
    try {
        const file = path.join(userDataPath, "manifest_url.json");
        if (!fs.existsSync(file)) {
            console.log("[AIO] Manifest file not found:", file);
            return null;
        }

        const raw = fs.readFileSync(file, "utf8");
        const parsed = JSON.parse(raw);
        console.log("[AIO] Loaded Manifest:", parsed.manifestUrl);
        
        return parsed.manifestUrl || null;
    } catch (err) {
        console.error("Manifest Read Error:", err);
        return null;
    }
}

// Initialize cache with 1 hour TTL
const gamesCache = new NodeCache({ stdTTL: 3600 });

// Initialize YouTube Music API
const ytMusicApi = new ytmusic();
let ytMusicInitialized = false;

// Initialize YouTube Music API
ytMusicApi.initalize().then(() => {
  ytMusicInitialized = true;
  console.log('[Music] YouTube Music API initialized successfully');
}).catch(err => {
  console.error('[Music] Failed to initialize YouTube Music API:', err);
  ytMusicInitialized = false;
});

// Optional MovieBox fetcher module (from bundled MovieBox API)
let movieboxFetcher = null;
try {
    movieboxFetcher = require('./MovieBox API/fetcher.js');
} catch (_) {
    movieboxFetcher = null;
}

// Export a function that registers all API routes on an existing Express app
function registerApiRoutes(app) {
    // Rate limiting - DISABLED for local use (was: 100 requests per 15 minutes)
    // const limiter = rateLimit({
    //     windowMs: 15 * 60 * 1000, // 15 minutes
    //     max: 100,
    //     message: 'Too many requests from this IP, please try again later.'
    // });
    // app.use(limiter);

// ============================================================================
// COMMON CONSTANTS & HELPERS
// ============================================================================

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
];

function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function createAxiosInstance() {
    return axios.create({
        timeout: 30000,
        headers: {
            'User-Agent': getRandomUserAgent(),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
        }
    });
}

// ============================================================================
// PHOENIX LIVE TV SERVICE
// ============================================================================
app.get('/api/phoenix/stream/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'Match ID is required.' });
        }
        
        console.log(`[PHOENIX] Received match ID: "${id}"`);
        const watchUrl = `https://ntvstream.cx/watch/phoenix/${id}`;
        const axiosInstance = createAxiosInstance();

        // 1. Fetch Watch Page
        console.log(`[PHOENIX] Fetching watch page: ${watchUrl}`);
        const watchPageResponse = await axiosInstance.get(watchUrl);
        const $watch = cheerio.load(watchPageResponse.data);

        // 2. Extract Final Stream URL from embedCodeTextarea
        let finalUrl = '';
        const embedCodeTextarea = $watch('textarea#embedCodeTextarea');
        const embedCode = embedCodeTextarea.val(); // Get the value (content) of the textarea

        if (embedCode) {
            // The content of the textarea is HTML, so we can parse it to find the iframe
            const iframeMatch = embedCode.match(/<iframe[^>]+src="([^"]+)"/);
            if (iframeMatch && iframeMatch[1]) {
                finalUrl = iframeMatch[1];
            }
        }
        
        if (!finalUrl) {
            console.error(`[PHOENIX] Could not find embed code textarea or iframe src in ${watchUrl}`);
            return res.status(404).json({ error: 'Stream embed code not found on watch page.' });
        }

        console.log(`[PHOENIX] Resolved stream URL: ${finalUrl}`);
        res.json({ streamUrl: finalUrl });

    } catch (error) {
        console.error('[PHOENIX] Error:', error.message);
        res.status(500).json({ error: 'Failed to resolve Phoenix stream.', message: error.message });
    }
});

// ============================================================================
// TITAN LIVE TV SERVICE
// ============================================================================
app.get('/api/titan/stream/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'Match ID is required.' });
        }
        
        console.log(`[TITAN] Received match ID: "${id}"`);
        const watchUrl = `https://ntvstream.cx/watch/titan/${id}`;
        const axiosInstance = createAxiosInstance();

        // 1. Fetch Watch Page
        console.log(`[TITAN] Fetching watch page: ${watchUrl}`);
        const watchPageResponse = await axiosInstance.get(watchUrl);
        const $watch = cheerio.load(watchPageResponse.data);

        // 2. Extract Final Stream URL from embedCodeTextarea
        let finalUrl = '';
        const embedCodeTextarea = $watch('textarea#embedCodeTextarea');
        const embedCode = embedCodeTextarea.val(); // Get the value (content) of the textarea

        if (embedCode) {
            // The content of the textarea is HTML, so we can parse it to find the iframe
            const iframeMatch = embedCode.match(/<iframe[^>]+src="([^"]+)"/);
            if (iframeMatch && iframeMatch[1]) {
                finalUrl = iframeMatch[1];
            }
        }
        
        if (!finalUrl) {
            console.error(`[TITAN] Could not find embed code textarea or iframe src in ${watchUrl}`);
            return res.status(404).json({ error: 'Stream embed code not found on watch page.' });
        }

        console.log(`[TITAN] Resolved stream URL: ${finalUrl}`);
        res.json({ streamUrl: finalUrl });

    } catch (error) {
        console.error('[TITAN] Error:', error.message);
        res.status(500).json({ error: 'Failed to resolve Titan stream.', message: error.message });
    }
});

// ============================================================================
// GAMES SERVICE (Steam Underground scraper)
// ============================================================================

// Helper function to get download links from a game page
// ============================================================================
// GAMES SERVICE (SteamRip API)
// ============================================================================

// Constants
const GAMES_API_URL = "https://api.ascendara.app";
const GAMES_BACKUP_CDN = "https://cdn.ascendara.app/files/data.json";

// Helper function to sanitize text
function sanitizeGameText(text) {
    if (!text) return text;
    return text
        .replace(/â€™/g, "'")
        .replace(/â€"/g, "—")
        .replace(/â€œ/g, '"')
        .replace(/â€/g, '"')
        .replace(/Â®/g, '®')
        .replace(/â„¢/g, '™')
        .replace(/Ã©/g, 'é')
        .replace(/Ã¨/g, 'è')
        .replace(/Ã /g, 'à')
        .replace(/Ã´/g, 'ô');
}

// Fetch games from API with caching
async function fetchGamesData(source = 'steamrip') {
    const cacheKey = `games_${source}`;
    const cachedData = gamesCache.get(cacheKey);
    
    if (cachedData) {
        return cachedData;
    }

    let endpoint = `${GAMES_API_URL}/json/games`;
    if (source === 'fitgirl') {
        endpoint = `${GAMES_API_URL}/json/sources/fitgirl/games`;
    }

    try {
        const response = await axios.get(endpoint);
        const data = response.data;

        // Sanitize game titles
        if (data.games) {
            data.games = data.games.map(game => ({
                ...game,
                name: sanitizeGameText(game.name),
                game: sanitizeGameText(game.game),
            }));
        }

        const result = {
            games: data.games || [],
            metadata: {
                apiversion: data.metadata?.apiversion,
                games: data.games?.length || 0,
                getDate: data.metadata?.getDate,
                source: data.metadata?.source || source,
                imagesAvailable: true,
            },
        };

        gamesCache.set(cacheKey, result);
        return result;
    } catch (error) {
        console.warn('Primary Games API failed, trying backup CDN:', error.message);
        
        try {
            const response = await axios.get(GAMES_BACKUP_CDN);
            const data = response.data;

            if (data.games) {
                data.games = data.games.map(game => ({
                    ...game,
                    name: sanitizeGameText(game.name),
                    game: sanitizeGameText(game.game),
                }));
            }

            const result = {
                games: data.games || [],
                metadata: {
                    apiversion: data.metadata?.apiversion,
                    games: data.games?.length || 0,
                    getDate: data.metadata?.getDate,
                    source: data.metadata?.source || source,
                    imagesAvailable: false,
                },
            };

            gamesCache.set(cacheKey, result);
            return result;
        } catch (cdnError) {
            throw new Error('Failed to fetch game data from both primary and backup sources');
        }
    }
}

// Get all games
app.get('/api/games/all', async (req, res) => {
    try {
        const source = req.query.source || 'steamrip';
        const data = await fetchGamesData(source);
        res.json(data);
    } catch (error) {
        res.status(500).json({ 
            error: 'Failed to fetch games', 
            message: error.message 
        });
    }
});

// Get random top games (for carousel/home screen)
app.get('/api/games/random', async (req, res) => {
    try {
        const count = parseInt(req.query.count) || 8;
        const minWeight = parseInt(req.query.minWeight) || 7;
        const source = req.query.source || 'steamrip';
        
        const { games } = await fetchGamesData(source);
        
        // Filter games with high weights and images
        const validGames = games.filter(game => 
            game.weight >= minWeight && game.imgID
        );

        // Shuffle and return requested number of games
        const shuffled = validGames.sort(() => 0.5 - Math.random());
        const result = shuffled.slice(0, count);
        
        res.json({ 
            games: result,
            count: result.length 
        });
    } catch (error) {
        res.status(500).json({ 
            error: 'Failed to fetch random games', 
            message: error.message 
        });
    }
});

// Search games
app.get('/api/games/search/:query', async (req, res) => {
    try {
        const query = req.params.query || '';
        const source = req.query.source || 'steamrip';
        
        if (!query.trim()) {
            return res.json({ games: [], count: 0 });
        }

        const { games } = await fetchGamesData(source);
        const searchTerm = query.toLowerCase();
        
        const results = games.filter(game =>
            game.title?.toLowerCase().includes(searchTerm) ||
            game.game?.toLowerCase().includes(searchTerm) ||
            game.description?.toLowerCase().includes(searchTerm)
        );
        
        res.json({ 
            games: results, 
            count: results.length,
            query: query 
        });
    } catch (error) {
        res.status(500).json({ 
            error: 'Failed to search games', 
            message: error.message 
        });
    }
});

// Get games by category
app.get('/api/games/category/:category', async (req, res) => {
    try {
        const { category } = req.params;
        const source = req.query.source || 'steamrip';
        
        const { games } = await fetchGamesData(source);
        
        const results = games.filter(game =>
            game.category && 
            Array.isArray(game.category) && 
            game.category.includes(category)
        );
        
        res.json({ 
            games: results, 
            count: results.length,
            category: category 
        });
    } catch (error) {
        res.status(500).json({ 
            error: 'Failed to fetch games by category', 
            message: error.message 
        });
    }
});

// Get specific game by image ID
app.get('/api/games/:imgID', async (req, res) => {
    try {
        const { imgID } = req.params;
        const source = req.query.source || 'steamrip';
        
        const { games } = await fetchGamesData(source);
        
        const game = games.find(g => g.imgID === imgID);
        
        if (!game) {
            return res.status(404).json({ 
                error: 'Game not found',
                imgID: imgID 
            });
        }
        
        res.json({ game });
    } catch (error) {
        res.status(500).json({ 
            error: 'Failed to fetch game', 
            message: error.message 
        });
    }
});

// Proxy for game images
app.get('/api/games/image/:imgID', async (req, res) => {
    try {
        const { imgID } = req.params;
        const source = req.query.source || 'steamrip';
        
        let imageUrl;
        if (source === 'fitgirl') {
            imageUrl = `${GAMES_API_URL}/v2/fitgirl/image/${imgID}`;
        } else {
            imageUrl = `${GAMES_API_URL}/v2/image/${imgID}`;
        }
        
        console.log(`[GAMES] Fetching image from: ${imageUrl}`);
        
        const response = await axios.get(imageUrl, { 
            responseType: 'arraybuffer',
            timeout: 10000
        });
        
        res.set('Content-Type', response.headers['content-type'] || 'image/jpeg');
        res.set('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
        res.send(response.data);
    } catch (error) {
        console.error(`[GAMES] Image fetch error for ${req.params.imgID}:`, error.message);
        // Return a 404 instead of JSON error so image onerror handles it
        res.status(404).send('Image not found');
    }
});

// Get all categories
app.get('/api/games/categories', async (req, res) => {
    try {
        const source = req.query.source || 'steamrip';
        const { games } = await fetchGamesData(source);
        
        const categoriesSet = new Set();
        games.forEach(game => {
            if (game.category && Array.isArray(game.category)) {
                game.category.forEach(cat => categoriesSet.add(cat));
            }
        });
        
        const categories = Array.from(categoriesSet).sort();
        
        res.json({ 
            categories,
            count: categories.length 
        });
    } catch (error) {
        res.status(500).json({ 
            error: 'Failed to fetch categories', 
            message: error.message 
        });
    }
});

// Get game covers for search (limited results)
app.get('/api/games/covers', async (req, res) => {
    try {
        const query = req.query.q || '';
        const limit = parseInt(req.query.limit) || 20;
        const source = req.query.source || 'steamrip';
        
        if (!query.trim()) {
            return res.json({ covers: [], count: 0 });
        }

        const { games } = await fetchGamesData(source);
        const searchTerm = query.toLowerCase();
        
        const results = games
            .filter(game => game.game?.toLowerCase().includes(searchTerm))
            .slice(0, limit)
            .map(game => ({
                id: game.game,
                title: game.game,
                imgID: game.imgID,
            }));
        
        res.json({ 
            covers: results, 
            count: results.length,
            query: query 
        });
    } catch (error) {
        res.status(500).json({ 
            error: 'Failed to search covers', 
            message: error.message 
        });
    }
});

// Clear games cache endpoint
app.post('/api/games/cache/clear', (req, res) => {
    gamesCache.flushAll();
    res.json({ 
        message: 'Games cache cleared successfully',
        timestamp: new Date().toISOString()
    });
});

// ============================================================================
// ANIME SERVICE (from anime.js - Nyaa.si scraper)
// ============================================================================

async function anime_scrapePage(query, page = 1) {
    try {
        const url = `https://nyaa.si/?f=0&c=0_0&q=${encodeURIComponent(query)}&s=seeders&o=desc${page > 1 ? `&p=${page}` : ''}`;
        console.log(`Fetching: ${url}`);
        
        const response = await axios.get(url, {
            headers: {
                'User-Agent': getRandomUserAgent()
            }
        });
        
        const $ = cheerio.load(response.data);
        const results = [];
        
        $('tbody tr').each((index, element) => {
            const $row = $(element);
            const titleElement = $row.find('td:nth-child(2) a[href^="/view/"]').last();
            const title = titleElement.attr('title') || titleElement.text().trim();
            const magnetLink = $row.find('a[href^="magnet:"]').attr('href');
            const size = $row.find('td:nth-child(4)').text().trim();
            const seeders = $row.find('td:nth-child(6)').text().trim();
            
            if (title && magnetLink && size) {
                results.push({
                    title,
                    magnetLink,
                    size,
                    seeders: parseInt(seeders) || 0
                });
            }
        });
        
        return results;
    } catch (error) {
        console.error(`Error scraping page ${page}:`, error.message);
        return [];
    }
}

app.get('/anime/api/:query', async (req, res) => {
    try {
        const query = req.params.query;
        console.log(`[ANIME] Searching for: ${query}`);
        
        const [page1Results, page2Results] = await Promise.all([
            anime_scrapePage(query, 1),
            anime_scrapePage(query, 2)
        ]);
        
        const allResults = [...page1Results, ...page2Results];
        
        res.json({
            query,
            totalResults: allResults.length,
            results: allResults
        });
        
    } catch (error) {
        console.error('[ANIME] Error:', error.message);
        res.status(500).json({
            error: 'Failed to fetch data',
            message: error.message
        });
    }
});

app.get('/anime/', (req, res) => {
    res.json({
        message: 'Anime Scraper API',
        usage: 'GET /anime/api/{searchQuery}',
        example: 'http://localhost:6987/anime/api/one%20punch%20man'
    });
});

app.get('/anime/health', (req, res) => {
    res.status(200).send('OK');
});

// ============================================================================
// TORRENTIO SERVICE (from torrentio.js)
// ============================================================================

const torrentio_trackers = [
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://tracker.openbittorrent.com:6969/announce',
    'udp://open.stealth.si:80/announce',
    'udp://tracker.torrent.eu.org:451/announce',
    'udp://tracker.bittor.pw:1337/announce',
    'udp://public.popcorn-tracker.org:6969/announce',
    'udp://tracker.dler.org:6969/announce',
    'udp://exodus.desync.com:6969',
    'udp://open.demonii.com:1337/announce'
].map(tracker => `&tr=${encodeURIComponent(tracker)}`).join('');

function torrentio_parseStreamInfo(title) {
    const seederMatch = title.match(/👤\s*(\d+)/);
    const sizeMatch = title.match(/💾\s*([\d.]+\s*[A-Z]+)/);
    
    return {
        seeders: seederMatch ? parseInt(seederMatch[1]) : 0,
        size: sizeMatch ? sizeMatch[1] : 'Unknown'
    };
}

function torrentio_constructMagnetLink(infoHash, filename) {
    const encodedName = encodeURIComponent(filename);
    return `magnet:?xt=urn:btih:${infoHash}&dn=${encodedName}${torrentio_trackers}`;
}

app.get('/torrentio/api/:imdbid', async (req, res) => {
    try {
        const { imdbid } = req.params;
        
        if (!imdbid.match(/^tt\d+$/)) {
            return res.status(400).json({ error: 'Invalid IMDb ID format. Must be in format: tt1234567' });
        }

        const torrentioUrl = `https://torrentio.strem.fun/providers=yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex/stream/movie/${imdbid}.json`;
        
        const axiosInstance = createAxiosInstance();
        const response = await axiosInstance.get(torrentioUrl);
        
        if (!response.data || !response.data.streams || response.data.streams.length === 0) {
            return res.status(404).json({ error: 'No streams found for this movie' });
        }

        const allStreams = response.data.streams.map(stream => {
            const info = torrentio_parseStreamInfo(stream.title);
            const filename = stream.behaviorHints?.filename || 'movie.mkv';
            const magnetLink = torrentio_constructMagnetLink(stream.infoHash, filename);

            return {
                name: stream.name,
                title: stream.title,
                magnetLink,
                infoHash: stream.infoHash,
                seeders: info.seeders,
                size: info.size,
                filename,
                fileIdx: stream.fileIdx
            };
        });

        res.json({
            imdbid,
            type: 'movie',
            totalStreams: allStreams.length,
            streams: allStreams
        });

    } catch (error) {
        console.error('[TORRENTIO] Error fetching movie:', error.message);
        if (error.response) {
            res.status(error.response.status).json({ error: `Torrentio API error: ${error.response.statusText}` });
        } else {
            res.status(500).json({ error: 'Internal server error', message: error.message });
        }
    }
});

app.get('/torrentio/api/:imdbid/:season/:episode', async (req, res) => {
    try {
        const { imdbid, season, episode } = req.params;
        
        if (!imdbid.match(/^tt\d+$/)) {
            return res.status(400).json({ error: 'Invalid IMDb ID format. Must be in format: tt1234567' });
        }

        if (isNaN(season) || isNaN(episode)) {
            return res.status(400).json({ error: 'Season and episode must be numbers' });
        }

        const torrentioUrl = `https://torrentio.strem.fun/providers=yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex/stream/series/${imdbid}:${season}:${episode}.json`;
        
        const axiosInstance = createAxiosInstance();
        const response = await axiosInstance.get(torrentioUrl);
        
        if (!response.data || !response.data.streams || response.data.streams.length === 0) {
            return res.status(404).json({ error: 'No streams found for this episode' });
        }

        const allStreams = response.data.streams.map(stream => {
            const info = torrentio_parseStreamInfo(stream.title);
            const filename = stream.behaviorHints?.filename || `episode_S${season}E${episode}.mkv`;
            const magnetLink = torrentio_constructMagnetLink(stream.infoHash, filename);

            return {
                name: stream.name,
                title: stream.title,
                magnetLink,
                infoHash: stream.infoHash,
                seeders: info.seeders,
                size: info.size,
                filename,
                fileIdx: stream.fileIdx
            };
        });

        res.json({
            imdbid,
            type: 'tvshow',
            season: parseInt(season),
            episode: parseInt(episode),
            totalStreams: allStreams.length,
            streams: allStreams
        });

    } catch (error) {
        console.error('[TORRENTIO] Error fetching TV show:', error.message);
        if (error.response) {
            res.status(error.response.status).json({ error: `Torrentio API error: ${error.response.statusText}` });
        } else {
            res.status(500).json({ error: 'Internal server error', message: error.message });
        }
    }
});

app.get('/torrentio/', (req, res) => {
    res.json({
        status: 'running',
        endpoints: {
            movies: '/torrentio/api/:imdbid',
            tvshows: '/torrentio/api/:imdbid/:season/:episode'
        },
        examples: {
            movie: '/torrentio/api/tt5950044',
            tvshow: '/torrentio/api/tt13159924/2/1'
        }
    });
});

// ============================================================================
// TORRENTLESS SERVICE (from torrentless.js - UIndex & Knaben)
// ============================================================================

const TORRENTLESS_BASES = ['https://uindex.org', 'http://uindex.org'];
const TORRENTLESS_ALLOWED_HOSTS = new Set(['uindex.org', 'www.uindex.org', 'knaben.org', 'www.knaben.org', 'torrentdownload.info', 'www.torrentdownload.info']);

async function torrentless_searchUIndex(query, { page = 1, category = 0 } = {}) {
    const base = TORRENTLESS_BASES[0];
    const url = new URL(base + '/search.php');
    url.searchParams.set('search', query);
    url.searchParams.set('c', String(category ?? 0));
    if (page && page > 1) url.searchParams.set('page', String(page));

    const html = await torrentless_fetchWithRetries(url.toString());
    const $ = cheerio.load(html);

    const items = [];
    $('table.maintable > tbody > tr').each((_, el) => {
        const row = $(el);
        const tds = row.find('td');
        if (tds.length < 5) return;

        const category = (tds.eq(0).find('a').first().text() || '').trim();
        const magnet = tds.eq(1).find('a[href^="magnet:"]').first().attr('href') || '';
        const titleEl = tds.eq(1).find("a[href^='/details.php']").first();
        const title = titleEl.text().trim();
        const relPageHref = titleEl.attr('href') || '';
        const pageUrl = relPageHref ? new URL(relPageHref, base).toString() : '';
        const age = (tds.eq(1).find('div.sub').first().text() || '').trim();
        const size = (tds.eq(2).text() || '').trim();
        const seeds = parseInt((tds.eq(3).text() || '0').replace(/[^\d]/g, ''), 10) || 0;
        const leechers = parseInt((tds.eq(4).text() || '0').replace(/[^\d]/g, ''), 10) || 0;

        if (title && magnet) {
            items.push({ title, magnet, pageUrl, category, size, seeds, leechers, age });
        }
    });

    let hasNext = false;
    let nextPage = undefined;
    $('a[href*="page="]').each((_, a) => {
        const href = String($(a).attr('href') || '');
        if (href.includes(`page=${page + 1}`)) {
            hasNext = true;
            nextPage = page + 1;
        }
    });

    return { query, page, items, pagination: { hasNext, nextPage } };
}

async function torrentless_searchKnaben(query, { page = 1 } = {}) {
    const base = 'https://knaben.org';
    const path = `/search/${encodeURIComponent(query)}/0/${page}/seeders`;
    const url = base + path;

    const html = await torrentless_fetchWithRetries(url);
    const $ = cheerio.load(html);

    const items = [];
    $('tbody > tr').each((_, el) => {
        const row = $(el);
        const tds = row.find('td');
        if (tds.length < 6) return;

        const category = (tds.eq(0).find('a').first().text() || '').trim();
        const titleAnchor = tds.eq(1).find('a[title]').first();
        const magnetAnchor = tds.eq(1).find('a[href^="magnet:"]').first();
        const title = (titleAnchor.attr('title') || titleAnchor.text() || magnetAnchor.text() || '').trim();
        const magnet = magnetAnchor.attr('href') || '';
        const size = (tds.eq(2).text() || '').trim();
        const dateText = (tds.eq(3).text() || '').trim();
        const seeds = parseInt((tds.eq(4).text() || '0').replace(/[^\d]/g, ''), 10) || 0;
        const leechers = parseInt((tds.eq(5).text() || '0').replace(/[^\d]/g, ''), 10) || 0;
        const httpLink = row.find('a[href^="http"]').last().attr('href') || '';
        const pageUrl = httpLink || url;

        if (title && magnet) {
            items.push({ title, magnet, pageUrl, category, size, seeds, leechers, age: dateText });
        }
    });

    let hasNext = false;
    let nextPage = undefined;
    const nextNeedle = `/${page + 1}/seeders`;
    $('a[href*="/search/"]').each((_, a) => {
        const href = String($(a).attr('href') || '');
        if (href.includes(nextNeedle)) {
            hasNext = true;
            nextPage = page + 1;
        }
    });

    return { query, page, items, pagination: { hasNext, nextPage } };
}

// TorrentDownload.info scraper functions
async function torrentless_searchTorrentDownload(query) {
    try {
        const searchUrl = `https://www.torrentdownload.info/search?q=${encodeURIComponent(query)}`;
        
        const response = await axios.get(searchUrl, {
            timeout: 20000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        });
        
        const $ = cheerio.load(response.data);
        const searchResults = [];
        
        // Find all torrent rows
        $('tr').each((_, element) => {
            const $row = $(element);
            const $nameCell = $row.find('td.tdleft');
            
            if ($nameCell.length > 0) {
                const $link = $nameCell.find('.tt-name a');
                const href = $link.attr('href');
                const title = $link.text().trim();
                
                // Get all td.tdnormal cells
                const tdNormal = $row.find('td.tdnormal');
                // Size is typically the second td.tdnormal (index 1)
                const sizeText = tdNormal.eq(1).text().trim();
                
                const seedsText = $row.find('td.tdseed').text().trim();
                const leechText = $row.find('td.tdleech').text().trim();
                
                if (href && title) {
                    searchResults.push({
                        title,
                        href,
                        sizeText,
                        seedsText,
                        leechText
                    });
                }
            }
        });
        
        console.log(`[TORRENTLESS] TorrentDownload found ${searchResults.length} search results`);
        
        // Fetch magnet links in parallel
        const items = [];
        const resultsWithMagnets = await Promise.all(
            searchResults.map(async (result) => {
                try {
                    const detailUrl = `https://www.torrentdownload.info${result.href}`;
                    const detailResponse = await axios.get(detailUrl, {
                        timeout: 10000,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                        }
                    });
                    
                    const $detail = cheerio.load(detailResponse.data);
                    const magnet = $detail('a.tosa[href^="magnet:"]').attr('href');
                    
                    if (magnet) {
                        return {
                            title: result.title,
                            magnet: magnet,
                            size: result.sizeText,
                            seeds: parseInt(result.seedsText.replace(/,/g, ''), 10) || 0,
                            leechers: parseInt(result.leechText.replace(/,/g, ''), 10) || 0
                        };
                    }
                    return null;
                } catch (err) {
                    return null;
                }
            })
        );
        
        const validResults = resultsWithMagnets.filter(item => item !== null);
        console.log(`[TORRENTLESS] TorrentDownload returning ${validResults.length} items with magnets`);
        
        return { query, page: 1, items: validResults, pagination: { hasNext: false, nextPage: undefined } };
    } catch (error) {
        console.error('[TORRENTLESS] TorrentDownload error:', error?.message || error);
        return { query, page: 1, items: [], pagination: { hasNext: false, nextPage: undefined } };
    }
}

async function torrentless_fetchWithRetries(urlStr) {
    const attempts = [];

    try {
        attempts.push(torrentless_buildRequest(urlStr, {
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
        }));

        attempts.push(torrentless_buildRequest(urlStr, {
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:118.0) Gecko/20100101 Firefox/118.0',
        }));

        try {
            const u = new URL(urlStr);
            u.protocol = u.protocol === 'https:' ? 'http:' : 'https:';
            attempts.push(torrentless_buildRequest(u.toString(), {
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
            }));
        } catch (_) {
            // URL switch failed, skip this attempt
        }
    } catch (e) {
        console.error('[TORRENTLESS] Setup request error:', e.message);
    }

    let lastErr;
    for (const req of attempts) {
        try {
            const response = await req;
            const data = response?.data;
            if (typeof data === 'string' && data.includes('<html')) {
                return data;
            }
            lastErr = new Error(`Invalid response content type: ${typeof data}`);
        } catch (e) {
            lastErr = e;
            console.warn('[TORRENTLESS] Attempt failed:', e.message);
        }
    }
    throw lastErr || new Error('All attempts failed to fetch the page');
}

function torrentless_buildRequest(urlStr, { userAgent }) {
    let origin = undefined;
    try {
        const u = new URL(urlStr);
        origin = u.origin;
    } catch (_) {
        origin = undefined;
    }
    return axios.get(urlStr, {
        timeout: 20000,
        maxRedirects: 5,
        headers: {
            'User-Agent': userAgent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            ...(origin ? { 'Referer': origin + '/', 'Origin': origin } : {}),
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-User': '?1'
        },
        decompress: true,
        validateStatus: () => true, // Accept all status codes to prevent unhandled rejections
    }).then(response => {
        // Check status after receiving response
        if (response.status >= 200 && response.status < 400) {
            return response;
        }
        // For rate limits or other errors, throw with proper message
        if (response.status === 429) {
            const retryAfter = response.headers['retry-after'] || '10';
            throw new Error(`Rate limited (429). Retry after ${retryAfter}s`);
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText || 'Request failed'}`);
    });
}

function torrentless_extractInfoHash(magnet) {
    try {
        const m = /btih:([A-Za-z0-9]{32,40})/i.exec(magnet);
        return m ? m[1].toUpperCase() : '';
    } catch (_) {
        return '';
    }
}

const TORRENTLESS_SEARCH_RATE_WINDOW_MS = 10000;
const torrentless_lastApiByIp = new Map();

function torrentless_apiRateLimiter(req, res, next) {
    // DISABLED - No rate limiting for local use
    next();
    return;
    
    // Original rate limiter code (disabled)
    /*
    try {
        const now = Date.now();
        const ip = req.ip || req.connection?.remoteAddress || 'unknown';
        const last = torrentless_lastApiByIp.get(ip) || 0;
        const diff = now - last;
        if (diff < TORRENTLESS_SEARCH_RATE_WINDOW_MS) {
            const waitMs = TORRENTLESS_SEARCH_RATE_WINDOW_MS - diff;
            const waitSec = Math.ceil(waitMs / 1000);
            res.set('Retry-After', String(waitSec));
            return res.status(429).json({ error: `Too many requests. Try again in ${waitSec}s.` });
        }
        torrentless_lastApiByIp.set(ip, now);
        if (torrentless_lastApiByIp.size > 1000 && Math.random() < 0.01) {
            const cutoff = now - TORRENTLESS_SEARCH_RATE_WINDOW_MS * 2;
            for (const [k, v] of torrentless_lastApiByIp) {
                if (v < cutoff) torrentless_lastApiByIp.delete(k);
            }
        }
        next();
    } catch (e) {
        next();
    }
    */
}

app.get('/torrentless/api/health', (_req, res) => {
    res.json({ ok: true, service: 'torrentless', time: new Date().toISOString() });
});

app.get('/torrentless/api/search', torrentless_apiRateLimiter, async (req, res) => {
    try {
        const q = (req.query.q || '').toString().trim().slice(0, 100);
        if (/^[\p{Cc}\p{Cs}]+$/u.test(q)) {
            return res.status(400).json({ error: 'Invalid query' });
        }
        if (!q) {
            return res.status(400).json({ error: 'Missing query ?q=' });
        }
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);

        const [r1, r2, r3] = await Promise.allSettled([
            torrentless_searchUIndex(q, { page, category: 0 }),
            torrentless_searchKnaben(q, { page }),
            torrentless_searchTorrentDownload(q)
        ]);

        const items1 = r1.status === 'fulfilled' ? (r1.value.items || []) : [];
        const items2 = r2.status === 'fulfilled' ? (r2.value.items || []) : [];
        const items3 = r3.status === 'fulfilled' ? (r3.value.items || []) : [];
        
        console.log(`[TORRENTLESS] Sources: UIndex=${items1.length}, Knaben=${items2.length}, TorrentDownload=${items3.length}`);

        const seen = new Map(); // Changed to Map to track by hash+seeds
        const merged = [];
        function pushUnique(arr) {
            for (const it of arr) {
                const ih = torrentless_extractInfoHash(it.magnet) || it.title.toLowerCase();
                const seedCount = it.seeds || 0;
                // Create unique key combining hash and seed count
                const uniqueKey = `${ih}_${seedCount}`;
                
                if (seen.has(uniqueKey)) continue;
                seen.set(uniqueKey, true);
                
                // Transform to exact format: {name, magnet, size, seeds, leech}
                merged.push({
                    name: it.title,
                    magnet: it.magnet,
                    size: it.size || '',
                    seeds: (it.seeds || 0).toLocaleString('en-US'),
                    leech: (it.leechers || 0).toLocaleString('en-US')
                });
            }
        }
        pushUnique(items1);
        pushUnique(items2);
        pushUnique(items3);

        merged.sort((a, b) => {
            const seedsA = parseInt(a.seeds.replace(/,/g, ''), 10) || 0;
            const seedsB = parseInt(b.seeds.replace(/,/g, ''), 10) || 0;
            const leechA = parseInt(a.leech.replace(/,/g, ''), 10) || 0;
            const leechB = parseInt(b.leech.replace(/,/g, ''), 10) || 0;
            return seedsB - seedsA || leechB - leechA;
        });

        const hasNext = (r1.status === 'fulfilled' && r1.value.pagination?.hasNext) ||
                        (r2.status === 'fulfilled' && r2.value.pagination?.hasNext) || false;
        const out = { query: q, page, items: merged, pagination: { hasNext, nextPage: hasNext ? page + 1 : undefined } };
        res.json(out);
    } catch (err) {
        console.error('[TORRENTLESS] Search error:', err?.message || err);
        const msg = /403/.test(String(err))
            ? 'Blocked by remote site (403). Try again later.'
            : 'Failed to fetch results. Please try again later.';
        res.status(502).json({ error: msg });
    }
});

// TorrentDownload scraper endpoint
app.get('/torrentdownload/api/search', torrentless_apiRateLimiter, async (req, res) => {
    try {
        const q = (req.query.q || '').toString().trim().slice(0, 100);
        if (!q) {
            return res.status(400).json({ error: 'Missing query ?q=' });
        }

        console.log(`[TORRENTDOWNLOAD] Proxying request to torrentscrapernew server for "${q}"`);
        
        // Call the working server at port 3001
        const response = await axios.get(`http://localhost:3001/api/torrent/search/${encodeURIComponent(q)}`, {
            timeout: 60000
        });
        
        const items = response.data || [];
        console.log(`[TORRENTDOWNLOAD] Received ${items.length} results from torrentscrapernew`);
        
        res.json({ query: q, items });
    } catch (err) {
        console.error('[TORRENTDOWNLOAD] Proxy error:', err?.message || err);
        res.status(502).json({ error: 'Failed to fetch results from TorrentDownload scraper.' });
    }
});

app.get('/torrentless/api/proxy', torrentless_apiRateLimiter, async (req, res) => {
    try {
        let url = req.query.url ? req.query.url.toString() : '';
        if (!url) {
            const which = (req.query.site || 'uindex').toString();
            if (which === 'knaben') {
                const base = 'https://knaben.org';
                const p = Number(req.query.page) > 0 ? Number(req.query.page) : 1;
                url = `${base}/search/${encodeURIComponent(req.query.q || '')}/0/${p}/seeders`;
            } else {
                const u = new URL('https://uindex.org/search.php');
                u.searchParams.set('search', req.query.q || '');
                u.searchParams.set('c', String(req.query.c ?? 0));
                if (req.query.page && Number(req.query.page) > 1) {
                    u.searchParams.set('page', String(req.query.page));
                }
                url = u.toString();
            }
        }

        const u = new URL(url);
        if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !TORRENTLESS_ALLOWED_HOSTS.has(u.hostname)) {
            return res.status(400).json({ error: 'URL not allowed' });
        }

        const { data, status, headers } = await axios.get(url, {
            timeout: 20000,
            responseType: 'arraybuffer',
            validateStatus: () => true,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Referer': 'https://uindex.org/',
                'Origin': 'https://uindex.org',
            },
        });

        const ctype = headers['content-type'] || 'text/plain; charset=utf-8';
        res.setHeader('Content-Type', ctype);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Expose-Headers', 'x-proxied-url');
        res.setHeader('x-proxied-url', url);
        res.status(status).send(Buffer.from(data));
    } catch (err) {
        console.error('[TORRENTLESS] Proxy error:', err?.message || err);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.status(502).json({ error: 'Proxy fetch failed' });
    }
});

// ============================================================================
// MOVIEBOX SERVICE (bundled from MovieBox API)
// ============================================================================

// Proxy base (Cloudflare Worker); keep requests limited to moviebox/fmovies
const MOVIEBOX_PROXY_BASE = process.env.MOVIEBOX_PROXY_URL || 'https://movieboxproxy.aymanisthedude1.workers.dev';
function moviebox_withProxy(url) {
    try {
        if (!/^https?:\/\/(moviebox|fmovies)/i.test(url)) return url;
        return `${MOVIEBOX_PROXY_BASE}?url=${encodeURIComponent(url)}`;
    } catch {
        return url;
    }
}

// Search helpers
const MOVIEBOX_SEARCH_BASES = ['https://moviebox.id', 'https://moviebox.ph'];
async function moviebox_fetchSearchHtml(query) {
    let lastErr = null;
    for (const base of MOVIEBOX_SEARCH_BASES) {
        const url = `${base}/web/searchResult?keyword=${encodeURIComponent(query)}`;
        try {
            const resp = await axios.get(moviebox_withProxy(url), {
                timeout: 20000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache',
                    'Referer': base + '/',
                },
                validateStatus: (s) => s >= 200 && s < 500,
            });
            if (resp.status >= 400) {
                lastErr = new Error(`MovieBox search failed with status ${resp.status} @ ${base}`);
                continue;
            }
            return { html: String(resp.data || ''), base };
        } catch (e) {
            lastErr = e;
        }
    }
    throw lastErr || new Error('MovieBox search failed on all bases');
}

function moviebox_slugifyBase(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').trim();
}

async function moviebox_getIdentifiersListFromQuery(query, opts = {}) {
    const offline = !!opts.offline;
    const preferredType = opts.preferredType; // 'movie' | 'tv' | undefined
    const debug = { mode: offline ? 'offline' : 'online' };

    let html = '';
    let queryUsed = query;
    const cleaned = movieboxFetcher && movieboxFetcher.sanitizeQueryName ? movieboxFetcher.sanitizeQueryName(query) : query;

    if (offline) {
        const file = opts.offlineFile || 'moviebox crack.txt';
        html = await fs.readFile(file, 'utf8');
        debug.file = file;
    } else if (movieboxFetcher && movieboxFetcher.fetchMovieboxSearchHtml) {
        html = await movieboxFetcher.fetchMovieboxSearchHtml(cleaned);
        queryUsed = cleaned;
    } else {
        const r = await moviebox_fetchSearchHtml(cleaned);
        html = r.html;
        queryUsed = cleaned;
    }

    const pairs = movieboxFetcher && movieboxFetcher.extractSlugIdPairs ? (movieboxFetcher.extractSlugIdPairs(html, queryUsed) || []) : [];
    const pool = pairs.slice();
    let items = pool.map(p => ({ detailPath: p.slug, subjectId: String(p.id), distance: 0, _type: p.type }));

    const base = moviebox_slugifyBase(queryUsed);
    const baseTokens = base.split('-').filter(Boolean);

    const STOPWORDS = new Set(['arabic','hindi','trailer','cam','ts','tc','screener','korean','turkish','thai','spanish','french','russian','subbed','dubbed','latino','portuguese','vietnamese','indonesian','malay','filipino']);

    function baseNameFromSlug(slug) {
        const m = String(slug).match(/^(.*?)-(?:[A-Za-z0-9]{6,})$/);
        return (m ? m[1] : String(slug)).toLowerCase();
    }

    function scoreSlug(slug) {
        const name = baseNameFromSlug(slug);
        const nameTokens = name.split('-').filter(Boolean);
        const nameJoined = nameTokens.join('-');
        const baseJoined = baseTokens.join('-');
        let s = 0;
        if (nameJoined === baseJoined) s += 200;
        if (nameJoined.startsWith(baseJoined + '-')) s += 300;
        const contiguousIdx = (() => {
            for (let i = 0; i <= nameTokens.length - baseTokens.length; i++) {
                let ok = true;
                for (let j = 0; j < baseTokens.length; j++) {
                    if (nameTokens[i + j] !== baseTokens[j]) { ok = false; break; }
                }
                if (ok) return i;
            }
            return -1;
        })();
        if (contiguousIdx === 0) s += 120; else if (contiguousIdx > 0) s += Math.max(0, 80 - contiguousIdx * 20);
        const setA = new Set(baseTokens);
        const setB = new Set(nameTokens);
        let inter = 0; setA.forEach(t => { if (setB.has(t)) inter++; });
        const jaccard = inter / (new Set([...setA, ...setB]).size || 1);
        s += Math.round(jaccard * 100);
        for (const t of nameTokens) { if (STOPWORDS.has(t)) s -= 200; }
        for (const t of nameTokens) { if (/^20\d{2}$/.test(t)) s += 40; }
        for (const t of nameTokens) { if (t === 'legacy' || t === 'final' || t === 'remastered' || t === 'extended') s += 60; }
        s -= Math.max(0, nameTokens.length - baseTokens.length) * 5;
        return s;
    }

    function contiguousStart(nameTokens, baseTokens) {
        for (let i = 0; i <= nameTokens.length - baseTokens.length; i++) {
            let ok = true;
            for (let j = 0; j < baseTokens.length; j++) {
                if (nameTokens[i + j] !== baseTokens[j]) { ok = false; break; }
            }
            if (ok) return i;
        }
        return -1;
    }

    const strict = items.filter(it => {
        const name = baseNameFromSlug(it.detailPath);
        const nameTokens = name.split('-').filter(Boolean);
        if (baseTokens.length >= 2) {
            return contiguousStart(nameTokens, baseTokens) !== -1;
        }
        return nameTokens.includes(baseTokens[0] || '');
    });
    if (strict.length) items = strict;

    items = items
        .map(it => {
            const baseScore = scoreSlug(it.detailPath);
            const typeBonus = preferredType ? (it._type === preferredType ? 150 : (it._type ? 0 : 60)) : 0;
            return { ...it, _score: baseScore + typeBonus };
        })
        .sort((a, b) => (b._score - a._score) || (a.detailPath.length - b.detailPath.length));

    const slugs = pool.map(p => p.slug);
    const ids = pool.map(p => String(p.id));
    return { items, debug: { ...debug, base, baseTokens, slugsFound: slugs, idsFound: ids, count: items.length } };
}

// FMovies/MovieBox play endpoints
const MOVIEBOX_FALLBACK_HOSTS = [
    'https://fmoviesunblocked.net',
    'https://moviebox.id',
    'https://moviebox.ph',
];

function moviebox_PLAY_URL(base, { subjectId, se = '0', ep = '0', detailPath }) {
    return `${base}/wefeed-h5-bff/web/subject/play?subjectId=${encodeURIComponent(subjectId)}&se=${encodeURIComponent(se)}&ep=${encodeURIComponent(ep)}&detail_path=${encodeURIComponent(detailPath)}`;
}
function moviebox_SPA_URLS(base, { detailPath, subjectId, isTv }) {
    const slug = encodeURIComponent(detailPath);
    const idq = `id=${encodeURIComponent(subjectId)}`;
    const urls = new Set();
    urls.add(`${base}/spa/videoPlayPage/${isTv ? 'tv' : 'movies'}/${slug}?${idq}`);
    urls.add(`${base}/spa/videoPlayPage/${slug}?${idq}`);
    urls.add(`${base}/spa/videoPlayPage/${isTv ? 'tv' : 'movies'}/${slug}?${idq}&lang=en`);
    urls.add(`${base}/spa/videoPlayPage/${slug}?${idq}&type=${isTv ? 'tv' : 'movie'}&lang=en`);
    if (isTv) {
        urls.add(`${base}/spa/videoPlayPage/movies/${slug}?${idq}&type=/tv/detail&lang=en`);
        urls.add(`${base}/spa/videoPlayPage/movies/${slug}?${idq}&type=/tv/detail`);
        urls.add(`${base}/spa/videoPlayPage/${slug}?${idq}&type=/tv/detail&lang=en`);
    } else {
        urls.add(`${base}/spa/videoPlayPage/movies/${slug}?${idq}&type=/movie/detail&lang=en`);
        urls.add(`${base}/spa/videoPlayPage/${slug}?${idq}&type=/movie/detail&lang=en`);
    }
    return Array.from(urls);
}

function moviebox_baseHeaders(forwardHeaders = {}) {
    const ua = forwardHeaders['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
    const h = {
        'User-Agent': ua,
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Ch-Ua': '"Chromium";v="141", "Google Chrome";v="141", ";Not A Brand";v="99"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
    };
    return h;
}

function moviebox_mergeCookies(list) {
    const jar = new Map();
    for (const raw of list) {
        if (!raw) continue;
        const parts = raw.split(/;\s*/);
        for (const p of parts) {
            if (!p) continue;
            const [k, ...rest] = p.split('=');
            if (!k || !rest.length) continue;
            const key = k.trim();
            const val = rest.join('=').trim();
            if (!key || !val) continue;
            if (/^(Path|Domain|Expires|Max-Age|Secure|HttpOnly|SameSite)$/i.test(key)) continue;
            jar.set(key, val);
        }
    }
    return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

function moviebox_safeJson(t) { try { return JSON.parse(t); } catch (_) { return null; } }

async function moviebox_fetchStreamsFromFMovies({ subjectId, detailPath, se = '0', ep = '0', forwardCookie = '', forwardHeaders = {} }) {
    const isTv = String(se) !== '0' || String(ep) !== '0';
    const baseHeadersTemplate = moviebox_baseHeaders(forwardHeaders);
    const tried = [];
    let lastError = null;
    for (const host of MOVIEBOX_FALLBACK_HOSTS) {
        try {
            const playUrl = moviebox_PLAY_URL(host, { subjectId, se, ep, detailPath });
            const directHeaders = { ...baseHeadersTemplate };
            directHeaders['Accept'] = 'application/json, text/plain, */*';
            directHeaders['Origin'] = host;
            const refererUrl = isTv
                ? `${host}/spa/videoPlayPage/movies/${encodeURIComponent(detailPath)}?id=${encodeURIComponent(subjectId)}&type=/tv/detail&lang=en`
                : `${host}/spa/videoPlayPage/movies/${encodeURIComponent(detailPath)}?id=${encodeURIComponent(subjectId)}&lang=en`;
            directHeaders['Referer'] = refererUrl;
            directHeaders['Sec-Fetch-Site'] = 'same-origin';
            directHeaders['Sec-Fetch-Mode'] = 'cors';
            directHeaders['Sec-Fetch-Dest'] = 'empty';
            if (forwardCookie) directHeaders['Cookie'] = forwardCookie;

            let resp = await axios.get(playUrl, { timeout: 20000, headers: directHeaders, validateStatus: s => s >= 200 && s < 500 });
            if (resp.status === 200) {
                const data = typeof resp.data === 'string' ? moviebox_safeJson(resp.data) : resp.data;
                if (data && data.code === 0 && data.data) {
                    const refererHeader = directHeaders['Referer'];
                    const cookieHeader = directHeaders['Cookie'] || '';
                    const uaHeader = directHeaders['User-Agent'];
                    const streams = Array.isArray(data.data.streams) ? data.data.streams.map(s => ({
                        format: s.format,
                        id: String(s.id),
                        url: s.url,
                        resolutions: String(s.resolutions),
                        size: s.size,
                        duration: s.duration,
                        codecName: s.codecName,
                        headers: { referer: refererHeader, cookie: cookieHeader, userAgent: uaHeader }
                    })) : [];
                    return { streams, raw: data, debug: { hostUsed: host, spaUsed: null, tried } };
                }
            }

            let warmCookies = '';
            let usedSpa = '';
            const spaUrls = moviebox_SPA_URLS(host, { detailPath, subjectId, isTv });
            for (const spaUrl of spaUrls) {
                try {
                    const warmHeaders = { ...baseHeadersTemplate };
                    warmHeaders['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
                    warmHeaders['Referer'] = host + '/';
                    const warm = await axios.get(moviebox_withProxy(spaUrl), { timeout: 20000, headers: warmHeaders, validateStatus: s => s >= 200 && s < 500 });
                    const setCookie = warm.headers['set-cookie'];
                    if (Array.isArray(setCookie)) warmCookies = setCookie.map(c => c.split(';')[0]).join('; ');
                    usedSpa = spaUrl;
                    break;
                } catch (e) {
                    tried.push({ host, spa: true, url: spaUrl, err: e?.message || String(e) });
                }
            }

            const headers = { ...baseHeadersTemplate };
            headers['Accept'] = 'application/json, text/plain, */*';
            headers['Origin'] = host;
            headers['Referer'] = usedSpa || (host + '/');
            headers['Sec-Fetch-Site'] = 'same-origin';
            headers['Sec-Fetch-Mode'] = 'cors';
            headers['Sec-Fetch-Dest'] = 'empty';
            const mergedCookie = moviebox_mergeCookies([forwardCookie, warmCookies]);
            if (mergedCookie) headers['Cookie'] = mergedCookie;

            resp = await axios.get(playUrl, { timeout: 20000, headers, validateStatus: s => s >= 200 && s < 500 });
            if (resp.status >= 400) {
                tried.push({ host, spa: false, url: playUrl, status: resp.status });
                lastError = new Error(`fmovies play failed with status ${resp.status} @ ${host}`);
                continue;
            }
            const data = typeof resp.data === 'string' ? moviebox_safeJson(resp.data) : resp.data;
            if (!data || data.code !== 0 || !data.data) {
                tried.push({ host, spa: false, url: playUrl, code: data?.code, note: 'invalid data' });
                lastError = new Error(`fmovies response invalid (code=${data?.code ?? 'n/a'}) @ ${host}`);
                continue;
            }

            const refererHeader = headers['Referer'];
            const cookieHeader = headers['Cookie'] || '';
            const uaHeader = headers['User-Agent'];
            const streams = Array.isArray(data.data.streams) ? data.data.streams.map(s => ({
                format: s.format,
                id: String(s.id),
                url: s.url,
                resolutions: String(s.resolutions),
                size: s.size,
                duration: s.duration,
                codecName: s.codecName,
                headers: {
                    referer: refererHeader,
                    cookie: cookieHeader,
                    userAgent: uaHeader
                }
            })) : [];
            return { streams, raw: data, debug: { hostUsed: host, spaUsed: usedSpa, tried } };
        } catch (e) {
            lastError = e;
        }
    }
    const e = lastError || new Error('All MovieBox/FMovies hosts failed');
    e.tried = tried;
    throw e;
}

// TMDB lookup
const MOVIEBOX_TMDB_API_KEY = 'c3515fdc674ea2bd7b514f4bc3616a4a';
async function moviebox_getTitleForTmdbId(id, preferredType) {
    const order = preferredType === 'tv' ? ['tv', 'movie'] : preferredType === 'movie' ? ['movie', 'tv'] : ['movie', 'tv'];
    let lastError;
    for (const kind of order) {
        try {
            const url = `https://api.themoviedb.org/3/${kind}/${encodeURIComponent(id)}?api_key=${MOVIEBOX_TMDB_API_KEY}&language=en-US`;
            const resp = await axios.get(url, { timeout: 12000, validateStatus: s => s >= 200 && s < 500 });
            if (resp.status === 200 && resp.data) {
                const data = resp.data;
                const title = kind === 'movie' ? (data.title || data.original_title) : (data.name || data.original_name);
                const year = (kind === 'movie' ? data.release_date : data.first_air_date)?.slice(0, 4) || undefined;
                if (title) return { title, kind, year, tmdbId: String(id) };
            }
            lastError = new Error(`TMDB ${kind} lookup failed with status ${resp.status}`);
        } catch (e) { lastError = e; }
    }
    lastError = lastError || new Error('TMDB lookup failed');
    lastError.status = lastError.status || 502;
    throw lastError;
}

// MovieBox routes
async function moviebox_handleSearch(req, res) {
    let { query } = req.params;
    try {
        if (/^\d+$/.test(query)) {
            const preferredType = typeof req.query.type === 'string' ? req.query.type : undefined;
            const { title } = await moviebox_getTitleForTmdbId(query, preferredType);
            query = title;
        }

        const listRes = await moviebox_getIdentifiersListFromQuery(query, {
            offline: req.query.offline === 'true' || req.query.offline === '1',
            offlineFile: 'moviebox crack.txt',
            preferredType: typeof req.query.type === 'string' ? req.query.type : undefined,
        });
        let items = listRes.items || [];

        const mode = (req.query.mode || 'score').toString();
        const base = (listRes.debug && listRes.debug.base) ? String(listRes.debug.base) : moviebox_slugifyBase(query);
        if (mode === 'prefix' || mode === 'contains') {
            const pred = (slug) => {
                const s = String(slug).toLowerCase();
                if (mode === 'prefix') return s.startsWith(base + '-') || s === base;
                return s.includes(base);
            };
            const bySlug = new Map(items.map(it => [it.detailPath, it]));
            const union = new Map();
            for (const it of items) if (pred(it.detailPath)) union.set(it.detailPath, it);
            items = Array.from(union.values());
        }

        if (!items.length) {
            return res.status(404).json({ error: 'No matching items found' });
        }

        const cookie = req.headers['x-cookie'] || req.headers['cookie'] || '';
        const fwd = { 'user-agent': req.headers['user-agent'] };
        const se = req.query.se || '0';
        const ep = req.query.ep || '0';

        const variants = await Promise.all(items.map(async (it) => {
            try {
                const { streams } = await moviebox_fetchStreamsFromFMovies({
                    subjectId: it.subjectId,
                    detailPath: it.detailPath,
                    se, ep,
                    forwardCookie: cookie,
                    forwardHeaders: fwd,
                });
                return { ...it, streams };
            } catch (e) {
                return { ...it, error: e.message };
            }
        }));

        const results = [];
        for (const v of variants) {
            if (Array.isArray(v.streams)) {
                for (const s of v.streams) {
                    results.push({
                        source: v.detailPath,
                        resolutions: s.resolutions,
                        size: String(s.size ?? ''),
                        url: s.url
                    });
                }
            }
        }

        return res.json({ results });
    } catch (err) {
        const status = err.status || 500;
        return res.status(status).json({ error: err.message || 'Unexpected error' });
    }
}

// Health & info routes and TMDB ID endpoints
app.get('/moviebox/health', (_req, res) => {
    res.json({ ok: true, service: 'moviebox', time: new Date().toISOString() });
});

app.get('/moviebox/', (_req, res) => {
    res.json({
        status: 'running',
        endpoints: {
            movie: '/moviebox/:tmdbId',
            tv: '/moviebox/tv/:tmdbId/:season/:episode',
            search: '/moviebox/api/:query (supports ?mode=prefix|contains|score&se=&ep=)',
            health: '/moviebox/health'
        }
    });
});

app.get('/moviebox/:tmdbId', async (req, res) => {
    const { tmdbId } = req.params;
    if (!tmdbId || !/^\d+$/.test(tmdbId)) {
        return res.status(400).json({ ok: false, error: 'Valid numeric TMDB ID is required' });
    }
    try {
        const { title } = await moviebox_getTitleForTmdbId(tmdbId, 'movie');
        const listRes = await moviebox_getIdentifiersListFromQuery(title, {
            offline: req.query.offline === 'true' || req.query.offline === '1',
            offlineFile: 'moviebox crack.txt',
            preferredType: 'movie',
        });
        const items = listRes.items || [];
        if (!items.length) {
            return res.status(404).json({ error: 'No matching items found for this movie' });
        }
        const cookie = req.headers['x-cookie'] || req.headers['cookie'] || '';
        const fwd = { 'user-agent': req.headers['user-agent'] };
        const topOnly = req.query.top === '1';
        const list = topOnly ? items.slice(0, 1) : items;
        const variants = await Promise.all(list.map(async (it) => {
            try {
                const { streams } = await moviebox_fetchStreamsFromFMovies({
                    subjectId: it.subjectId,
                    detailPath: it.detailPath,
                    se: '0', ep: '0',
                    forwardCookie: cookie,
                    forwardHeaders: fwd,
                });
                return { detailPath: it.detailPath, subjectId: it.subjectId, streams };
            } catch (e) {
                return { detailPath: it.detailPath, subjectId: it.subjectId, error: e.message, streams: [] };
            }
        }));
        const results = [];
        for (const v of variants) {
            if (Array.isArray(v.streams)) {
                for (const s of v.streams) {
                    results.push({ source: v.detailPath, resolutions: s.resolutions, size: String(s.size ?? ''), url: s.url });
                }
            }
        }
        return res.json({ results });
    } catch (err) {
        const status = err.status || 500;
        return res.status(status).json({ error: err.message || 'Unexpected error' });
    }
});

app.get('/moviebox/tv/:tmdbId/:season/:episode', async (req, res) => {
    const { tmdbId, season, episode } = req.params;
    if (!tmdbId || !/^\d+$/.test(tmdbId)) return res.status(400).json({ ok: false, error: 'Valid numeric TMDB ID is required' });
    if (!season || !/^\d+$/.test(season)) return res.status(400).json({ ok: false, error: 'Valid season number is required' });
    if (!episode || !/^\d+$/.test(episode)) return res.status(400).json({ ok: false, error: 'Valid episode number is required' });
    try {
        const { title } = await moviebox_getTitleForTmdbId(tmdbId, 'tv');
        const listRes = await moviebox_getIdentifiersListFromQuery(title, {
            offline: req.query.offline === 'true' || req.query.offline === '1',
            offlineFile: 'moviebox crack.txt',
            preferredType: 'tv',
        });
        const items = listRes.items || [];
        if (!items.length) return res.status(404).json({ error: 'No matching items found for this TV show' });
        const cookie = req.headers['x-cookie'] || req.headers['cookie'] || '';
        const fwd = { 'user-agent': req.headers['user-agent'] };
        const topOnly = req.query.top === '1';
        const list = topOnly ? items.slice(0, 1) : items;
        const variants = await Promise.all(list.map(async (it) => {
            try {
                const { streams } = await moviebox_fetchStreamsFromFMovies({
                    subjectId: it.subjectId,
                    detailPath: it.detailPath,
                    se: season, ep: episode,
                    forwardCookie: cookie,
                    forwardHeaders: fwd,
                });
                return { detailPath: it.detailPath, subjectId: it.subjectId, streams };
            } catch (e) {
                return { detailPath: it.detailPath, subjectId: it.subjectId, error: e.message, streams: [] };
            }
        }));
        const results = [];
        for (const v of variants) {
            if (Array.isArray(v.streams)) {
                for (const s of v.streams) {
                    results.push({ source: v.detailPath, resolutions: s.resolutions, size: String(s.size ?? ''), url: s.url });
                }
            }
        }
        return res.json({ results });
    } catch (err) {
        const status = err.status || 500;
        return res.status(status).json({ error: err.message || 'Unexpected error' });
    }
});

// Legacy search endpoints
app.get('/moviebox/api/:query', moviebox_handleSearch);
app.get('/api/moviebox/:query', moviebox_handleSearch);

// ============================================================================
// XDMOVIES SERVICE
// ============================================================================

app.get('/api/xdmovies/:tmdbid', async (req, res) => {
    try {
      const tmdbId = req.params.tmdbid;
      const { type } = req.query;

      if (type === 'tv') {
        return res.status(400).json({ success: false, message: 'XDmovies only supports movies, not TV shows.' });
      }
  
      // First, get the movie URL from the previous endpoint call
      // We'll fetch the xdmovies page URL
      const tmdbResponse = await axios.get(`${lib111477_TMDB_BASE_URL}/movie/${tmdbId}`, {
        params: {
          api_key: lib111477_TMDB_API_KEY
        }
      });
  
      // Check if the request returned a TV show instead (sometimes TMDB API returns TV data even when querying movie endpoint)
      if (tmdbResponse.data.first_air_date && !tmdbResponse.data.release_date) {
        return res.status(400).json({ success: false, message: 'XDmovies is for movies only, not TV shows.' });
      }

      const movieTitle = tmdbResponse.data.title;
      const releaseDate = tmdbResponse.data.release_date;
      const releaseYear = releaseDate ? releaseDate.split('-')[0] : null;
  
      // Get token
      const tokenResponse = await axios.get('https://xdmovies.site/php/get_token.php', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
          'Referer': 'https://xdmovies.site/search.html',
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.6',
          'Accept-Encoding': 'gzip, deflate, br',
          'X-Requested-With': 'XMLHttpRequest'
        }
      });
  
      const token = tokenResponse.data.token;
  
      // Search for the movie
      const xdmoviesResponse = await axios.get('https://xdmovies.site/php/search_api.php', {
        params: {
          query: movieTitle,
          fuzzy: true
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
          'Referer': 'https://xdmovies.site/search.html?q=' + encodeURIComponent(movieTitle),
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.6',
          'Accept-Encoding': 'gzip, deflate, br',
          'Content-Type': 'application/json',
          'X-Auth-Token': token,
          'X-Requested-With': 'XMLHttpRequest',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin'
        }
      });
  
      const results = xdmoviesResponse.data;
      const matchedMovie = results.find(movie => movie.release_year === releaseYear && movie.title.toLowerCase() === movieTitle.toLowerCase());
  
      if (!matchedMovie) {
        return res.json({ success: false, message: 'Movie not found' });
      }
  
      const moviePageUrl = `https://xdmovies.site${matchedMovie.path}`;
  
      // Fetch the movie page
      const pageResponse = await axios.get(moviePageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
          'Referer': 'https://xdmovies.site/',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.6',
          'Accept-Encoding': 'gzip, deflate, br'
        }
      });
  
      const $ = cheerio.load(pageResponse.data);
      const downloads = [];
  
      // Extract download links and sizes
      $('.download-item').each((index, element) => {
        const titleElement = $(element).find('.custom-title');
        const linkElement = $(element).find('.movie-download-btn');
  
        if (titleElement && linkElement) {
          const title = titleElement.text().trim();
          const link = linkElement.attr('href');
          const size = linkElement.text().trim(); // Gets text like "1.20 GB"
  
          if (link && size) {
            downloads.push({
              title: title,
              link: link,
              size: size
            });
          }
        }
      });
  
      if (downloads.length === 0) {
        return res.json({ success: false, message: 'No download links found' });
      }
  
      // Fetch actual download links from each link
      const downloadLinksWithRealLinks = await Promise.all(
        downloads.map(async (download) => {
          try {
            const pageResponse = await axios.get(download.link, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
                'Referer': moviePageUrl,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.6',
                'Accept-Encoding': 'gzip, deflate, br'
              },
              maxRedirects: 5
            });
  
            const $page = cheerio.load(pageResponse.data);
            const downloadBtn = $page('a#download');
            const proxyLink = downloadBtn.attr('href');
  
            let finalLinks = [];
            if (!proxyLink) {
              return {
                title: download.title,
                size: download.size,
                serverLinks: []
              };
            }
  
            // Now fetch the proxy link to get the final download servers
            try {
              const finalPageResponse = await axios.get(proxyLink, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
                  'Referer': 'https://xdmovies.site/',
                  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                  'Accept-Language': 'en-US,en;q=0.8',
                  'Accept-Encoding': 'gzip, deflate, br',
                  'Cookie': 'xyt=1'
                },
                maxRedirects: 5
              });
  
              const $final = cheerio.load(finalPageResponse.data);
              // Extract all download server links
              const serverLinkElements = $final('a.btn.btn-lg.h6');
              for (let i = 0; i < serverLinkElements.length; i++) {
                const element = serverLinkElements[i];
                const link = $final(element).attr('href');
                const fullText = $final(element).text().trim();
                let serverName = 'Unknown Server';
                
                if (fullText.includes('FSL Server')) {
                  serverName = 'FSL Server';
                } else if (fullText.includes('10Gbps')) {
                  serverName = '10Gbps';
                } else if (fullText.includes('PixelServer')) {
                  serverName = 'PixelServer';
                }
  
                // For PixelServer and 10Gbps, follow the link and extract the final download link from <a id="vd"> or meta tags
                let realDownloadLink = link;
                if (serverName.toLowerCase().includes('pixelserver')) {
                  continue; // Skip PixelServer links
                }
                if (serverName.toLowerCase().includes('pixel') || serverName.toLowerCase().includes('10gbps')) {
                  try {
                    const pixelResp = await axios.get(link, {
                      headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
                        'Referer': proxyLink,
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.8',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Cookie': 'xyt=1'
                      },
                      maxRedirects: 5
                    });
                    const $pixel = cheerio.load(pixelResp.data);
                    // Try <a id="vd">
                    const vdLink = $pixel('a#vd').attr('href');
                    if (vdLink) {
                      realDownloadLink = vdLink;
                    } else {
                      // Try meta tags
                      const ogVideo = $pixel('meta[property="og:video"]').attr('content');
                      const ogVideoUrl = $pixel('meta[property="og:video:url"]').attr('content');
                      const ogVideoSecure = $pixel('meta[property="og:video:secure_url"]').attr('content');
                      if (ogVideoSecure) {
                        realDownloadLink = ogVideoSecure;
                      } else if (ogVideoUrl) {
                        realDownloadLink = ogVideoUrl;
                      } else if (ogVideo) {
                        realDownloadLink = ogVideo;
                      }
                    }
                  } catch (err) {
                    // fallback to original link
                  }
                }
                if (realDownloadLink) {
                  finalLinks.push({
                    name: serverName,
                    url: realDownloadLink
                  });
                }
              }
  
              // Handle TRS Server separately
              const trsScript = $final('script:contains("getElementById(\'mega\')")').html();
              if (trsScript) {
                  const match = trsScript.match(/window\.location\.href = '([^']*)'/);
                  if (match && match[1]) {
                      finalLinks.push({
                          name: 'TRS Server',
                          url: match[1]
                      });
                  }
              }
            } catch (error) {
              console.error('Error fetching final links from:', proxyLink, error.message);
            }
  
            return {
              title: download.title,
              size: download.size,
              proxyLink: proxyLink,
              serverLinks: finalLinks
            };
          } catch (error) {
            console.error('Error fetching real link from:', download.link, error.message);
            return {
              title: download.title,
              size: download.size,
              serverLinks: []
            };
          }
        })
      );
  
      res.json({
        success: true,
        movie: matchedMovie.title,
        url: moviePageUrl,
        downloads: downloadLinksWithRealLinks
      });
    } catch (error) {
      console.error('Error scraping xdmovies:', error.message);
      res.status(500).json({ success: false, error: 'Failed to scrape download links' });
    }
});

// ============================================================================
// ACERMOVIES SERVICE
// ============================================================================

const ACERMOVIES_BASE_URL = "https://api.acermovies.fun";

// Simple helper: safe JSON fetch with good error output
async function acermovies_postJson(url, payload) {
    let lastError;
    for (let i = 0; i < 3; i++) {
        try {
            const response = await axios.post(url, payload, {
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                    "Origin": "https://acermovies.fun",
                    "Referer": "https://acermovies.fun/"
                },
                timeout: 0
            });
            return response.data;
        } catch (error) {
            lastError = error;
            if (i < 2) await new Promise(r => setTimeout(r, 1500));
        }
    }

    const err = new Error("Acermovies is currently experiencing upstream instability. Please try again later.");
    err.status = lastError.response?.status;
    err.data = lastError.response?.data;
    throw err;
}

// --- API: SEARCH ---
// /api/acermovies/search/:query
app.get('/api/acermovies/search/:query', async (req, res) => {
  try {
    const query = decodeURIComponent(req.params.query || "").trim();
    if (!query) return res.status(400).json({ error: "Missing search query" });

    const data = await acermovies_postJson(`${ACERMOVIES_BASE_URL}/api/search`, {
      searchQuery: query
    });

    res.json(data);
  } catch (e) {
    res.status(502).json({
      error: "Search failed",
      message: e.message,
      upstreamStatus: e.status || null,
      upstreamData: e.data || null
    });
  }
});

// --- API: SOURCE QUALITY ---
// /api/acermovies/sourceQuality?url=...
app.get('/api/acermovies/sourceQuality', async (req, res) => {
  try {
    const url = (req.query.url || "").trim();
    if (!url) return res.status(400).json({ error: "Missing url" });

    const data = await acermovies_postJson(`${ACERMOVIES_BASE_URL}/api/sourceQuality`, {
      url
    });

    res.json(data);
  } catch (e) {
    res.status(502).json({
      error: "SourceQuality failed",
      message: e.message,
      upstreamStatus: e.status || null,
      upstreamData: e.data || null
    });
  }
});

// --- API: SOURCE EPISODES ---
// /api/acermovies/sourceEpisodes?url=...
app.get('/api/acermovies/sourceEpisodes', async (req, res) => {
  try {
    const url = (req.query.url || "").trim();
    if (!url) return res.status(400).json({ error: "Missing url" });

    const data = await acermovies_postJson(`${ACERMOVIES_BASE_URL}/api/sourceEpisodes`, {
      url
    });

    res.json(data);
  } catch (e) {
    res.status(502).json({
      error: "SourceEpisodes failed",
      message: e.message,
      upstreamStatus: e.status || null,
      upstreamData: e.data || null
    });
  }
});

// --- API: SOURCE URL ---
// /api/acermovies/sourceUrl?url=...&seriesType=movie
app.get('/api/acermovies/sourceUrl', async (req, res) => {
  try {
    const url = (req.query.url || "").trim();
    const seriesType = (req.query.seriesType || "movie").trim();

    if (!url) return res.status(400).json({ error: "Missing url" });

    const data = await acermovies_postJson(`${ACERMOVIES_BASE_URL}/api/sourceUrl`, {
      url,
      seriesType
    });

    res.json(data);
  } catch (e) {
    res.status(502).json({
      error: "SourceUrl failed",
      message: e.message,
      upstreamStatus: e.status || null,
      upstreamData: e.data || null
    });
  }
});


// ============================================================================
// Z-LIBRARY SERVICE (Search & Read Only)
// ============================================================================

// Preserved for otherbook service compatibility
const ZLIB_DOMAINS = [
    'z-library.mn',
    'z-lib.gd',
    'z-lib.io',
    'zlibrary-global.se',
    'booksc.org',       
    '1lib.sk',      
    'z-library.sk',
    'zlibrary.to',
    'z-lib.fm',
    'z-lib.se',
    'z-lib.is',
    'z-lib.org'
];

function zlib_createAxiosInstance() {
    return axios.create({
        timeout: 45000,
        maxRedirects: 5,
        validateStatus: (status) => status >= 200 && status < 400,
        headers: {
            'User-Agent': getRandomUserAgent(),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none'
        }
    });
}

// ============================================================================
// NEW Z-LIBRARY SERVICE (v3.0 - with Challenge Solver)
// ============================================================================

const zlib_crypto = require('crypto');

// Global state to store cookies for Z-Lib
let zlib_globalCookies = 'siteLanguage=en; bsrv=0bf492b2e869251834795b4bb6158ed0';

/**
 * Solves the Z-lib custom challenge
 */
function zlib_solveChallenge(body) {
    try {
        // Extract the token array content
        const arrayMatch = body.match(/const a0_0x2a54=\[(.*?)\];/);
        if (!arrayMatch) return null;
        
        const arrayItems = arrayMatch[1].split(',').map(s => s.trim().replace(/['"]/g, ''));
        // Find the long hex token (usually 40 chars)
        const c = arrayItems.find(item => /^[A-F0-9]{40}$/.test(item));
        
        if (!c) return null;

        const n1 = parseInt(c[0], 16);
        let i = 0;
        while (i < 2000000) {
            const hash = zlib_crypto.createHash('sha1').update(c + i).digest();
            if (hash[n1] === 0xb0 && hash[n1 + 1] === 0x0b) {
                return c + i;
            }
            i++;
        }
    } catch (e) {
        console.error('[ZLIB] Error solving challenge:', e);
    }
    return null;
}

/**
 * Generic fetcher with challenge handling
 */
async function zlib_fetchWithRetry(targetUrl, options = {}) {
    // Dynamic import because got-scraping is ESM
    const { gotScraping } = await import('got-scraping');
    
    // Helper to perform the request
    const performRequest = async (cookies) => {
        return gotScraping({
            url: targetUrl,
            headers: {
                'cookie': cookies,
                'referer': 'https://z-library.mn/',
                ...options.headers
            },
            throwHttpErrors: false, // Don't throw on 503 so we can handle it
            ...options
        });
    };

    let response = await performRequest(zlib_globalCookies);

    if (response.statusCode === 503) {
        console.log('[ZLIB] Got 503, attempting to solve challenge...');
        const solvedToken = zlib_solveChallenge(response.body);
        
        if (solvedToken) {
            console.log('[ZLIB] Challenge solved! New c_token:', solvedToken);
            
            // Update global cookies, replacing old c_token and _cookie_
            const cookieParts = zlib_globalCookies.split(';')
                .map(c => c.trim())
                .filter(c => !c.startsWith('c_token=') && !c.startsWith('_cookie_'));
            
            cookieParts.push(`c_token=${solvedToken}`);
            cookieParts.push(`_cookie_${Date.now()}=true`);
            
            zlib_globalCookies = cookieParts.join('; ');
            
            // Retry with new cookie
            response = await performRequest(zlib_globalCookies);
        } else {
            console.log('[ZLIB] Failed to solve challenge from 503 response.');
        }
    }
    
    if (response.statusCode >= 400 && response.statusCode !== 503) {
        console.log(`[ZLIB] Request failed with status ${response.statusCode}`);
    }

    return response;
}

// API Endpoint - Popular Books
app.get('/api/zlib/all', async (req, res) => {
    try {
        const page = req.query.page || 1;
        const targetUrl = `https://z-library.mn/papi/book/mostpopular/mosaic/20/${page}`;
        
        console.log(`[ZLIB] Fetching popular books: ${targetUrl}`);
        const response = await zlib_fetchWithRetry(targetUrl);
        
        // Parse the JSON response body
        let data;
        try {
            data = JSON.parse(response.body);
        } catch (e) {
            console.error('[ZLIB] Failed to parse JSON response for /all');
            data = [];
        }
        res.json(data);

    } catch (error) {
        console.error('[ZLIB] Error fetching data:', error.message);
        res.status(500).json({ error: 'Failed to fetch data from Z-Library' });
    }
});

// Search Endpoint
app.get('/api/zlib/search/:query', async (req, res) => {
    try {
        const query = req.params.query;
        const targetUrl = `https://z-library.mn/s/${encodeURIComponent(query)}`;
        
        console.log(`[ZLIB] Searching: ${targetUrl}`);
        
        let books = [];
        let retries = 0;
        const maxRetries = 3;

        while (books.length === 0 && retries < maxRetries) {
            if (retries > 0) {
                 console.log(`[ZLIB] No books found, retrying... (${retries}/${maxRetries})`);
                 await new Promise(r => setTimeout(r, 1500));
            }
            
            const response = await zlib_fetchWithRetry(targetUrl);
            const $ = cheerio.load(response.body);
            
            $('.resItemBoxBooks z-bookcard').each((i, element) => {
                const card = $(element);
                const href = card.attr('href');
                const title = card.find('div[slot="title"]').text().trim();
                const author = card.find('div[slot="author"]').text().trim();
                const cover = card.find('img').attr('data-src');
                const extension = card.attr('extension');
                
                if (title && href) {
                    books.push({
                        title,
                        author,
                        cover,
                        extension,
                        url: href 
                    });
                }
            });
            
            retries++;
        }

        console.log(`[ZLIB] Found ${books.length} books.`);
        res.json({ success: 1, books: books });

    } catch (error) {
        console.error('[ZLIB] Error searching:', error.message);
        res.status(500).json({ error: 'Failed to search Z-Library' });
    }
});

// Get Read Link Endpoint
app.get('/api/zlib/read-link', async (req, res) => {
    try {
        const bookPath = req.query.path;
        if (!bookPath) {
            return res.status(400).json({ error: 'Path is required' });
        }

        // Extract book ID from path (format: /book/12345/hash/title.html)
        const bookIdMatch = bookPath.match(/\/book\/(\d+)\//);
        const expectedBookId = bookIdMatch ? bookIdMatch[1] : null;

        const targetUrl = `https://z-library.mn${bookPath}`;
        console.log(`[ZLIB] Fetching book details from: ${targetUrl}`);
        console.log(`[ZLIB] Expected book ID: ${expectedBookId}`);

        let readLink = null;
        let downloadLink = null;
        let downloadExtension = null;
        let downloadSize = null;
        let retries = 0;
        const maxRetries = 6;

        while ((!readLink && !downloadLink) && retries < maxRetries) {
            if (retries > 0) {
                 console.log(`[ZLIB] Links not found, retrying... (${retries}/${maxRetries})`);
                 await new Promise(r => setTimeout(r, 1500));
            }

            const response = await zlib_fetchWithRetry(targetUrl);
            const $ = cheerio.load(response.body);
            
            readLink = $('a.reader-link').attr('href');
            
            // Find the download button that matches our expected book ID
            // Look for a.addDownloadedBook with matching data-book_id
            let downloadBtn = null;
            
            if (expectedBookId) {
                // First try to find button with matching book ID
                downloadBtn = $(`a.addDownloadedBook[data-book_id="${expectedBookId}"]`).first();
                console.log(`[ZLIB] Looking for button with book_id=${expectedBookId}, found: ${downloadBtn.length}`);
            }
            
            // Fallback: get the one in .book-details-button:not(.read-online)
            if (!downloadBtn || !downloadBtn.length) {
                downloadBtn = $('.book-details-button:not(.read-online) a.addDownloadedBook').first();
                console.log(`[ZLIB] Fallback selector found: ${downloadBtn.length}`);
            }
            
            if (downloadBtn && downloadBtn.length) {
                const dlHref = downloadBtn.attr('href');
                const btnBookId = downloadBtn.attr('data-book_id');
                console.log(`[ZLIB] Download button href: ${dlHref}, data-book_id: ${btnBookId}`);
                
                if (dlHref && dlHref.startsWith('/dl/')) {
                    downloadLink = `https://z-library.mn${dlHref}`;
                    downloadExtension = downloadBtn.find('.book-property__extension').text().trim();
                    const btnText = downloadBtn.text().trim();
                    const sizeMatch = btnText.match(/(\d+\.?\d*\s*[KMGT]?B)/i);
                    if (sizeMatch) {
                        downloadSize = sizeMatch[1];
                    }
                }
            }
            retries++;
        }

        const result = { success: 0 };
        
        if (readLink) {
            console.log(`[ZLIB] Found read link: ${readLink}`);
            result.success = 1;
            result.readLink = readLink;
        }
        
        if (downloadLink) {
            console.log(`[ZLIB] Found download link: ${downloadLink}`);
            result.success = 1;
            result.downloadLink = downloadLink;
            if (downloadExtension) result.downloadExtension = downloadExtension;
            if (downloadSize) result.downloadSize = downloadSize;
        }
        
        if (result.success === 0) {
            console.log('[ZLIB] No links found.');
            result.error = 'No links found';
        }
        
        res.json(result);

    } catch (error) {
        console.error('[ZLIB] Error getting read link:', error.message);
        res.status(500).json({ error: 'Failed to get read link' });
    }
});

// Backward compatibility / Health Check
app.get('/zlib/health', (req, res) => {
    res.json({ status: 'healthy', version: '3.0 (got-scraping + challenge solver)' });
});

// ============================================================================
// OTHERBOOK SERVICE (from otherbook.js - RandomBook/LibGen)
// ============================================================================

async function otherbook_getCoverByAuthor(authorName, bookTitle = '') {
    try {
        let searchAuthor = authorName;
        if (Array.isArray(authorName)) {
            searchAuthor = authorName[0] || '';
        }
        
        if (!searchAuthor || searchAuthor.trim() === '' || !bookTitle || bookTitle.trim() === '') {
            return null;
        }
        
        console.log(`[OTHERBOOK] Searching Z-Library for cover: "${bookTitle}" by "${searchAuthor}"`);
        
        let searchResults = null;
        let workingDomain = null;

        for (const domain of ZLIB_DOMAINS) {
            try {
                const axiosInstance = zlib_createAxiosInstance();
                const searchUrl = `https://${domain}/s/${encodeURIComponent(bookTitle)}`;
                
                const response = await axiosInstance.get(searchUrl);
                
                if (response.status === 200 && response.data) {
                    searchResults = response.data;
                    workingDomain = domain;
                    break;
                }
            } catch (error) {
                continue;
            }
        }

        if (!searchResults) {
            return null;
        }

        const $ = cheerio.load(searchResults);
        
        let bookElements = [];
        const selectors = ['.book-item', '.resItemBox', '[itemtype*="Book"]', 'a[href*="/book/"]'];
        
        for (const selector of selectors) {
            bookElements = $(selector);
            if (bookElements.length > 0) break;
        }

        if (bookElements.length === 0) {
            return null;
        }

        const covers = [];
        bookElements.each((index, element) => {
            if (index >= 10) return false;
            
            const $book = $(element);
            let coverUrl = null;
            let author = 'Unknown';
            let title = 'Unknown';
            
            const zbookcard = $book.find('z-bookcard').first();
            if (zbookcard.length) {
                const imgElement = zbookcard.find('img').first();
                if (imgElement.length) {
                    coverUrl = imgElement.attr('data-src') || imgElement.attr('src');
                }
                author = zbookcard.find('[slot="author"]').text().trim() || 'Unknown';
                title = zbookcard.find('[slot="title"]').text().trim() || 'Unknown';
            }
            
            if (!coverUrl) {
                const coverElement = $book.find('img[data-src], img[src*="cover"]').first();
                if (coverElement.length) {
                    coverUrl = coverElement.attr('data-src') || coverElement.attr('src');
                }
            }
            
            if (title === 'Unknown') {
                const titleElement = $book.find('h3 a, .book-title a').first();
                if (titleElement.length) {
                    title = titleElement.text().trim();
                }
            }
            
            if (author === 'Unknown') {
                const authorElement = $book.find('.authors a, .author a').first();
                if (authorElement.length) {
                    author = authorElement.text().trim();
                }
            }
            
            if (coverUrl && coverUrl.startsWith('/')) {
                coverUrl = `https://${workingDomain}${coverUrl}`;
            }
            
            if (coverUrl) {
                covers.push({
                    coverUrl: coverUrl,
                    author: author.replace(/\s+/g, ' ').trim(),
                    title: title.replace(/\s+/g, ' ').trim()
                });
            }
        });

        if (covers.length === 0) {
            return null;
        }

        const normalize = (text) => text.toLowerCase().trim().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ');

        const exactMatch = covers.find(book => {
            const titleMatch = book.title && bookTitle && normalize(book.title) === normalize(bookTitle);
            const authorMatch = book.author && searchAuthor && normalize(book.author) === normalize(searchAuthor);
            return titleMatch && authorMatch;
        });
        
        if (exactMatch) {
            return exactMatch.coverUrl;
        }
        
        const partialMatch = covers.find(book => {
            if (!book.title || !book.author || !bookTitle || !searchAuthor) return false;
            const zlibTitle = normalize(book.title);
            const zlibAuthor = normalize(book.author);
            const libgenTitle = normalize(bookTitle);
            const libgenAuthor = normalize(searchAuthor);
            const titleMatch = zlibTitle.includes(libgenTitle) || libgenTitle.includes(zlibTitle);
            const authorMatch = zlibAuthor.includes(libgenAuthor) || libgenAuthor.includes(zlibAuthor);
            return titleMatch && authorMatch;
        });
        
        if (partialMatch) {
            return partialMatch.coverUrl;
        }
        
        return null;
        
    } catch (error) {
        console.error(`[OTHERBOOK] Error searching Z-Library:`, error.message);
        return null;
    }
}

async function otherbook_getActualDownloadLink(bookId) {
    const downloadPageUrl = `https://libgen.download/api/download?id=${bookId}`;
    return downloadPageUrl;
}

async function otherbook_getDownloadLinksInParallel(books, concurrency = 3) {
    const results = [];
    
    for (let i = 0; i < books.length; i += concurrency) {
        const chunk = books.slice(i, i + concurrency);
        
        const chunkPromises = chunk.map(async (book) => {
            const authorForDisplay = Array.isArray(book.author) ? book.author[0] || 'Unknown' : book.author || 'Unknown';
            const actualDownloadLink = await otherbook_getActualDownloadLink(book.id);
            
            const result = {
                id: book.id,
                title: book.title,
                author: book.author,
                description: book.description,
                year: book.year,
                language: book.language,
                fileExtension: book.fileExtension,
                fileSize: book.fileSize,
                downloadlink: actualDownloadLink || `https://libgen.download/api/download?id=${book.id}`
            };
            
            return result;
        });
        
        const chunkResults = await Promise.all(chunkPromises);
        results.push(...chunkResults);
    }
    
    return results;
}

app.get('/otherbook/api/search/:query', async (req, res) => {
    try {
        const { query } = req.params;
        const encodedQuery = encodeURIComponent(query);
        const apiUrl = `https://randombook.org/api/search/by-params?query=${encodedQuery}&collection=libgen&from=0`;
        
        console.log(`[OTHERBOOK] Fetching data from: ${apiUrl}`);
        
        const response = await axios.get(apiUrl);
        
        if (!response.data || !response.data.result || !response.data.result.books) {
            return res.status(404).json({
                success: false,
                message: 'No books found for the given query'
            });
        }
        
        const books = response.data.result.books;
        const limitedBooks = books.slice(0, 15);
        const transformedBooks = await otherbook_getDownloadLinksInParallel(limitedBooks, 3);
        
        const sortedBooks = transformedBooks.sort((a, b) => {
            const aHasCover = a.coverUrl ? 1 : 0;
            const bHasCover = b.coverUrl ? 1 : 0;
            return bHasCover - aHasCover;
        });
        
        res.json({
            success: true,
            query: query,
            totalBooks: sortedBooks.length,
            books: sortedBooks
        });
        
    } catch (error) {
        console.error('[OTHERBOOK] Error fetching data:', error.message);
        
        if (error.response) {
            return res.status(error.response.status).json({
                success: false,
                message: 'External API error',
                error: error.response.data || error.message
            });
        } else if (error.request) {
            return res.status(500).json({
                success: false,
                message: 'No response from external API',
                error: error.message
            });
        } else {
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
                error: error.message
            });
        }
    }
});

app.get('/otherbook/api/download/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const downloadLink = await otherbook_getActualDownloadLink(id);
        
        if (downloadLink) {
            res.json({
                success: true,
                bookId: id,
                downloadlink: downloadLink
            });
        } else {
            res.status(404).json({
                success: false,
                message: 'Could not extract download link',
                bookId: id
            });
        }
        
    } catch (error) {
        console.error('[OTHERBOOK] Error getting download link:', error.message);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

app.get('/otherbook/health', (req, res) => {
    res.json({
        success: true,
        message: 'RandomBook Scraper API is running',
        timestamp: new Date().toISOString()
    });
});

app.get('/otherbook/', (req, res) => {
    res.json({
        success: true,
        message: 'Welcome to RandomBook Scraper API',
        endpoints: {
            search: '/otherbook/api/search/{query}',
            download: '/otherbook/api/download/{bookId}',
            health: '/otherbook/health'
        },
        examples: {
            search: '/otherbook/api/search/The midnight library',
            download: '/otherbook/api/download/98593300'
        }
    });
});

// MOVIEBOX SERVICE removed from this file. The functionality now lives in moviebox.js.

// ============================================================================
// PLEX PROXY API
// ============================================================================

// Plex proxy endpoint to avoid CORS issues
app.all('/api/plex/proxy', async (req, res) => {
    try {
        let targetUrl = req.query.url;
        const authToken = req.query.token;
        
        if (!targetUrl) {
            return res.status(400).json({ error: 'URL parameter is required' });
        }
        
        // Add X-Plex-Token as query parameter if provided
        if (authToken) {
            const urlObj = new URL(targetUrl);
            urlObj.searchParams.set('X-Plex-Token', authToken);
            targetUrl = urlObj.toString();
        }
        
        // Build headers
        const headers = {
            'Accept': 'application/json',
            'X-Plex-Client-Identifier': req.headers['x-plex-client-identifier'] || 'playtorrio-proxy'
        };
        
        // Forward other relevant headers
        if (req.headers['x-plex-product']) headers['X-Plex-Product'] = req.headers['x-plex-product'];
        
        const https = require('https');
        const axiosConfig = {
            method: req.method,
            url: targetUrl,
            headers: headers,
            timeout: 30000,
            validateStatus: () => true, // Don't throw on any status
            // Disable SSL verification for Plex servers with self-signed certificates
            httpsAgent: new https.Agent({
                rejectUnauthorized: false
            })
        };
        
        // Forward body for POST/PUT requests
        if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
            axiosConfig.data = req.body;
        }
        
        console.log('[Plex Proxy] Request to:', targetUrl.replace(/X-Plex-Token=[^&]+/, 'X-Plex-Token=***'));
        
        const response = await axios(axiosConfig);
        
        console.log('[Plex Proxy] Response status:', response.status);
        
        // Forward response headers
        Object.keys(response.headers).forEach(key => {
            if (!['connection', 'transfer-encoding', 'content-encoding'].includes(key.toLowerCase())) {
                res.setHeader(key, response.headers[key]);
            }
        });
        
        // Add CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');
        
        res.status(response.status).send(response.data);
        
    } catch (error) {
        console.error('[Plex Proxy] Error:', error.message);
        if (error.response) {
            console.error('[Plex Proxy] Response status:', error.response.status);
            console.error('[Plex Proxy] Response data:', error.response.data);
        }
        res.status(500).json({ 
            error: 'Proxy request failed', 
            message: error.message,
            details: error.response?.data || error.toString()
        });
    }
});

// ============================================================================
// ROOT ENDPOINT - API INFO
// ============================================================================

app.get('/', (req, res) => {
    res.json({
        message: 'Combined API Server - All Services Available',
        port: PORT,
        services: {
            anime: {
                description: 'Anime torrents from Nyaa.si',
                endpoints: {
                    search: '/anime/api/{query}',
                    info: '/anime/',
                    health: '/anime/health'
                },
                example: 'http://localhost:6987/anime/api/one%20punch%20man'
            },
            torrentio: {
                description: 'Movie & TV show torrents via Torrentio',
                endpoints: {
                    movies: '/torrentio/api/{imdbid}',
                    tvshows: '/torrentio/api/{imdbid}/{season}/{episode}',
                    info: '/torrentio/'
                },
                examples: {
                    movie: 'http://localhost:6987/torrentio/api/tt5950044',
                    tvshow: 'http://localhost:6987/torrentio/api/tt13159924/2/1'
                }
            },
            torrentless: {
                description: 'Torrent search via UIndex & Knaben',
                endpoints: {
                    search: '/torrentless/api/search?q={query}&page={page}',
                    proxy: '/torrentless/api/proxy?url={url}',
                    health: '/torrentless/api/health'
                },
                example: 'http://localhost:6987/torrentless/api/search?q=ubuntu'
            },
            zlib: {
                description: 'Z-Library book search & read links',
                endpoints: {
                    search: '/zlib/search/{query}',
                    details: '/zlib/api/book/details?url={bookUrl}',
                    proxy: '/zlib/api/proxy?url={url}',
                    test: '/zlib/test',
                    health: '/zlib/health'
                },
                example: 'http://localhost:6987/zlib/search/python%20programming'
            },
            xdmovies: {
                description: 'Movie scraper from xdmovies.site (Movies Only)',
                endpoints: {
                    movieByTmdbId: '/api/xdmovies/:tmdbid',
                },
                example: 'http://localhost:6987/api/xdmovies/550',
                note: 'XDmovies supports movies only. TV shows will return an error.'
            },
            otherbook: {
                description: 'Book search via RandomBook/LibGen with covers',
                endpoints: {
                    search: '/otherbook/api/search/{query}',
                    download: '/otherbook/api/download/{bookId}',
                    info: '/otherbook/',
                    health: '/otherbook/health'
                },
                example: 'http://localhost:6987/otherbook/api/search/The%20midnight%20library'
            },
            lib111477: {
                description: 'Movie/TV show directory parser with TMDB integration',
                endpoints: {
                    moviesByName: '/111477/api/movies/{movieName}',
                    movieByTmdbId: '/111477/api/tmdb/movie/{tmdbId}',
                    tvShowInfo: '/111477/api/tmdb/tv/{tmdbId}',
                    tvShowSeason: '/111477/api/tmdb/tv/{tmdbId}/season/{season}',
                    tvShowEpisode: '/111477/api/tmdb/tv/{tmdbId}/season/{season}/episode/{episode}',
                    searchTmdb: '/111477/api/tmdb/search/{query}',
                    searchAndFetch: '/111477/api/tmdb/search/{query}/fetch',
                    parseUrl: 'POST /111477/api/parse',
                    parseBatch: 'POST /111477/api/parse-batch',
                    health: '/111477/health'
                },
                example: 'http://localhost:6987/111477/api/tmdb/movie/550'
            }
        },
        timestamp: new Date().toISOString()
    });
});

// ============================================================================
// 111477 SERVICE - Movie/TV Directory Parser
// ============================================================================

// 111477 Constants
const lib111477_TMDB_API_KEY = 'c3515fdc674ea2bd7b514f4bc3616a4a';
const lib111477_TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// 111477 Helper Functions
async function lib111477_fetchHtml(url) {
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': getRandomUserAgent(),
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            },
            timeout: 30000,
            maxRedirects: 5
        });
        return response.data;
    } catch (error) {
        if (error.response) {
            throw new Error(`HTTP ${error.response.status}: ${error.response.statusText}`);
        } else if (error.request) {
            throw new Error('No response received from server');
        } else {
            throw new Error(`Request error: ${error.message}`);
        }
    }
}

function lib111477_buildMovieUrl(movieName) {
    const baseUrl = 'https://a.111477.xyz/movies/';
    const encodedMovieName = encodeURIComponent(movieName);
    return `${baseUrl}${encodedMovieName}/`;
}

function lib111477_normalizeUrl(url) {
    if (!url) {
        throw new Error('URL is required');
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }
    if (!url.endsWith('/')) {
        url += '/';
    }
    return url;
}

function lib111477_formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function lib111477_extractEpisodeInfo(fileName) {
    const patterns = [
        /S(\d{1,2})E(\d{1,2})/i, /S(\d{1,2})\.E(\d{1,2})/i, /S(\d{1,2})\s*E(\d{1,2})/i,
        /Season\s*(\d+)\s*Episode\s*(\d+)/i, /(\d{1,2})x(\d{1,2})/, /(\d{1,2})\.(\d{1,2})/,
        /Ep(\d+).*S(\d+)/i, /Episode\s*(\d+).*Season\s*(\d+)/i, /S(\d{1,2})-E(\d{1,2})/i,
        /S(\d{1,2})_E(\d{1,2})/i, /(\d{1,2})-(\d{1,2})/, /(\d{1,2})_(\d{1,2})/,
        /(\d{1,2})\s*[xX]\s*(\d{1,2})/, /S(\d{1,2})[^\dE]*(\d{1,2})/i
    ];
    for (const pattern of patterns) {
        const match = fileName.match(pattern);
        if (match) {
            let season, episode;
            if (pattern.source.includes('Ep.*S') || pattern.source.includes('Episode.*Season')) {
                episode = parseInt(match[1]);
                season = parseInt(match[2]);
            } else {
                season = parseInt(match[1]);
                episode = parseInt(match[2]);
            }
            if (season >= 1 && season <= 50 && episode >= 1 && episode <= 500) {
                return {
                    season: season,
                    episode: episode,
                    seasonStr: season.toString().padStart(2, '0'),
                    episodeStr: episode.toString().padStart(2, '0')
                };
            }
        }
    }
    return null;
}

function lib111477_extractMovieName(url, $) {
    const title = $('title').text();
    if (title && title.includes('Index of')) {
        const match = title.match(/Index of \/movies\/(.+)/);
        if (match) {
            return decodeURIComponent(match[1]);
        }
    }
    const urlParts = url.split('/');
    const moviePart = urlParts.find(part => part && part !== 'movies');
    if (moviePart) {
        return decodeURIComponent(moviePart);
    }
    return 'Unknown Movie';
}

function lib111477_extractTvName(url, $) {
    const title = $('title').text();
    if (title && title.includes('Index of')) {
        const match = title.match(/Index of \/tvs\/(.+?)(?:\/Season|$)/);
        if (match) {
            return decodeURIComponent(match[1]);
        }
    }
    const urlParts = url.split('/');
    const tvIndex = urlParts.findIndex(part => part === 'tvs');
    if (tvIndex !== -1 && urlParts[tvIndex + 1]) {
        return decodeURIComponent(urlParts[tvIndex + 1]);
    }
    return 'Unknown TV Show';
}

function lib111477_parseMovieDirectory(html, baseUrl) {
    const $ = cheerio.load(html);
    const files = [];
    const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v'];
    
    // Extract base domain from baseUrl
    const urlObj = new URL(baseUrl);
    const baseDomain = `${urlObj.protocol}//${urlObj.host}`;
    
    $('tr').each((index, element) => {
        const link = $(element).find('a').first();
        const href = link.attr('href');
        const fileName = link.text().trim();
        
        if (!href || fileName.includes('Parent Directory') || href === '../') {
            return;
        }
        
        const hasVideoExtension = videoExtensions.some(ext => fileName.toLowerCase().endsWith(ext));
        
        if (hasVideoExtension) {
            const sizeCell = $(element).find('td[data-sort]');
            const fileSize = sizeCell.attr('data-sort') || '0';
            
            let fileUrl;
            if (href.startsWith('http://') || href.startsWith('https://')) {
                // Absolute URL
                fileUrl = href;
            } else if (href.startsWith('/')) {
                // Root-relative path
                fileUrl = baseDomain + href;
            } else {
                // Relative path - just append the filename to baseUrl
                // Make sure baseUrl ends with /
                const normalizedBase = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
                fileUrl = normalizedBase + encodeURIComponent(fileName);
            }
            
            files.push({
                name: fileName,
                url: fileUrl,
                size: fileSize,
                sizeBytes: parseInt(fileSize),
                sizeFormatted: lib111477_formatFileSize(parseInt(fileSize))
            });
        }
    });
    
    const movieName = lib111477_extractMovieName(baseUrl, $);
    
    return {
        success: true,
        movieName,
        baseUrl,
        fileCount: files.length,
        files: files.sort((a, b) => {
            const sizeA = parseInt(a.size);
            const sizeB = parseInt(b.size);
            if (sizeA !== sizeB) {
                return sizeB - sizeA;
            }
            return a.name.localeCompare(b.name);
        })
    };
}

function lib111477_parseTvDirectory(html, baseUrl, filterSeason = null, filterEpisode = null) {
    const $ = cheerio.load(html);
    const files = [];
    const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v'];
    
    // Extract base domain from baseUrl
    const urlObj = new URL(baseUrl);
    const baseDomain = `${urlObj.protocol}//${urlObj.host}`;
    
    $('tr').each((index, element) => {
        const link = $(element).find('a').first();
        const href = link.attr('href');
        const fileName = link.text().trim();
        
        if (!href || fileName.includes('Parent Directory') || href === '../') {
            return;
        }
        
        const hasVideoExtension = videoExtensions.some(ext => fileName.toLowerCase().endsWith(ext));
        
        if (hasVideoExtension) {
            if (filterSeason !== null && filterEpisode !== null) {
                const episodeInfo = lib111477_extractEpisodeInfo(fileName);
                if (!episodeInfo || episodeInfo.season !== filterSeason || episodeInfo.episode !== filterEpisode) {
                    return;
                }
            }
            
            const sizeCell = $(element).find('td[data-sort]');
            const fileSize = sizeCell.attr('data-sort') || '0';
            
            let fileUrl;
            if (href.startsWith('http://') || href.startsWith('https://')) {
                // Absolute URL
                fileUrl = href;
            } else if (href.startsWith('/')) {
                // Root-relative path
                fileUrl = baseDomain + href;
            } else {
                // Relative path - just append the filename to baseUrl
                // Make sure baseUrl ends with /
                const normalizedBase = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
                fileUrl = normalizedBase + encodeURIComponent(fileName);
            }
            
            const episodeInfo = lib111477_extractEpisodeInfo(fileName);
            files.push({
                name: fileName,
                url: fileUrl,
                size: fileSize,
                sizeBytes: parseInt(fileSize),
                sizeFormatted: lib111477_formatFileSize(parseInt(fileSize)),
                episode: episodeInfo
            });
        }
    });
    
    const tvName = lib111477_extractTvName(baseUrl, $);
    
    return {
        success: true,
        tvName,
        baseUrl,
        fileCount: files.length,
        filterSeason,
        filterEpisode,
        files: files.sort((a, b) => {
            if (a.episode && b.episode) {
                if (a.episode.season !== b.episode.season) {
                    return a.episode.season - b.episode.season;
                }
                if (a.episode.episode !== b.episode.episode) {
                    return a.episode.episode - b.episode.episode;
                }
            }
            const sizeA = parseInt(a.size);
            const sizeB = parseInt(b.size);
            if (sizeA !== sizeB) {
                return sizeB - sizeA;
            }
            return a.name.localeCompare(b.name);
        })
    };
}

async function lib111477_getMovieDetails(tmdbId) {
    try {
        const response = await axios.get(`${lib111477_TMDB_BASE_URL}/movie/${tmdbId}`, {
            params: { api_key: lib111477_TMDB_API_KEY }
        });
        return response.data;
    } catch (error) {
        throw new Error(`Failed to fetch movie details: ${error.message}`);
    }
}

async function lib111477_getTvDetails(tmdbId) {
    try {
        const response = await axios.get(`${lib111477_TMDB_BASE_URL}/tv/${tmdbId}`, {
            params: { api_key: lib111477_TMDB_API_KEY }
        });
        return response.data;
    } catch (error) {
        throw new Error(`Failed to fetch TV show details: ${error.message}`);
    }
}

async function lib111477_searchMovies(query, page = 1) {
    try {
        const response = await axios.get(`${lib111477_TMDB_BASE_URL}/search/movie`, {
            params: { api_key: lib111477_TMDB_API_KEY, query: query, page: page }
        });
        return response.data;
    } catch (error) {
        throw new Error(`Failed to search movies: ${error.message}`);
    }
}

function lib111477_constructMovieName(movie) {
    const title = movie.title || movie.name;
    const year = movie.release_date ? new Date(movie.release_date).getFullYear() : '';
    const cleanTitle = title.replace(/:/g, '');
    return year ? `${cleanTitle} (${year})` : cleanTitle;
}

function lib111477_constructMovieNameWithHyphens(movie) {
    const title = movie.title || movie.name;
    const year = movie.release_date ? new Date(movie.release_date).getFullYear() : '';
    const cleanTitle = title.replace(/:/g, ' -');
    return year ? `${cleanTitle} (${year})` : cleanTitle;
}

function lib111477_getMovieNameVariants(movie) {
    const title = movie.title || movie.name;
    if (title.includes(':')) {
        return [lib111477_constructMovieName(movie), lib111477_constructMovieNameWithHyphens(movie)];
    }
    return [lib111477_constructMovieName(movie)];
}

function lib111477_constructTvName(tv) {
    const title = tv.name || tv.title;
    const cleanTitle = title.replace(/:/g, '');
    return cleanTitle;  // Don't include year for TV shows
}

function lib111477_constructTvNameWithHyphens(tv) {
    const title = tv.name || tv.title;
    const cleanTitle = title.replace(/:/g, ' -');
    return cleanTitle;  // Don't include year for TV shows
}

function lib111477_getTvNameVariants(tv) {
    const title = tv.name || tv.title;
    if (title.includes(':')) {
        return [lib111477_constructTvName(tv), lib111477_constructTvNameWithHyphens(tv)];
    }
    return [lib111477_constructTvName(tv)];
}

function lib111477_constructMovieUrl(movieName) {
    const baseUrl = 'https://a.111477.xyz/movies/';
    const encodedName = encodeURIComponent(movieName);
    return `${baseUrl}${encodedName}/`;
}

function lib111477_constructTvUrl(tvName, season = null) {
    const baseUrl = 'https://a.111477.xyz/tvs/';
    const encodedName = encodeURIComponent(tvName);
    if (season !== null) {
        // Use single digit for seasons 1-9, no padding
        return `${baseUrl}${encodedName}/Season ${season}/`;
    }
    return `${baseUrl}${encodedName}/`;
}

// 111477 API Routes
app.get('/111477/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        tmdbApiKey: lib111477_TMDB_API_KEY ? 'configured' : 'missing'
    });
});

app.get('/111477/api/movies/:movieName', async (req, res) => {
    try {
        const { movieName } = req.params;
        if (!movieName) {
            return res.status(400).json({ success: false, error: 'Movie name is required' });
        }
        const html = await lib111477_fetchHtml(lib111477_buildMovieUrl(movieName));
        const url = lib111477_buildMovieUrl(movieName);
        const result = lib111477_parseMovieDirectory(html, url);
        res.json(result);
    } catch (error) {
        console.error('Error fetching movie:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/111477/api/tmdb/movie/:tmdbId', async (req, res) => {
    try {
        const { tmdbId } = req.params;
        if (!tmdbId || isNaN(tmdbId)) {
            return res.status(400).json({ success: false, error: 'Valid TMDB ID is required' });
        }
        const movie = await lib111477_getMovieDetails(parseInt(tmdbId));
        const nameVariants = lib111477_getMovieNameVariants(movie);
        const results = [];
        let variantsWithContent = 0;
        
        for (let i = 0; i < nameVariants.length; i++) {
            const movieName = nameVariants[i];
            const url = lib111477_constructMovieUrl(movieName);
            const variantLabel = i === 0 ? 'colon_removed' : 'colon_to_hyphen';
            
            try {
                const html = await lib111477_fetchHtml(url);
                const content = lib111477_parseMovieDirectory(html, url);
                
                if (content.fileCount > 0) {
                    variantsWithContent++;
                }
                
                // Build enriched TMDB data
                const enrichedTmdb = {
                    id: movie.id,
                    title: movie.title,
                    originalTitle: movie.original_title,
                    releaseDate: movie.release_date,
                    year: movie.release_date ? new Date(movie.release_date).getFullYear().toString() : '',
                    overview: movie.overview,
                    posterPath: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
                    backdropPath: movie.backdrop_path ? `https://image.tmdb.org/t/p/w1280${movie.backdrop_path}` : null,
                    genres: movie.genres || [],
                    runtime: movie.runtime,
                    imdbId: movie.imdb_id
                };
                
                results.push({
                    success: true,
                    movieName: content.movieName,
                    baseUrl: content.baseUrl,
                    fileCount: content.fileCount,
                    files: content.files,
                    searchVariant: variantLabel,
                    contentFound: content.fileCount > 0,
                    tmdb: enrichedTmdb
                });
            } catch (error) {
                const enrichedTmdb = {
                    id: movie.id,
                    title: movie.title,
                    originalTitle: movie.original_title,
                    releaseDate: movie.release_date,
                    year: movie.release_date ? new Date(movie.release_date).getFullYear().toString() : '',
                    overview: movie.overview,
                    posterPath: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
                    backdropPath: movie.backdrop_path ? `https://image.tmdb.org/t/p/w1280${movie.backdrop_path}` : null,
                    genres: movie.genres || [],
                    runtime: movie.runtime,
                    imdbId: movie.imdb_id
                };
                
                results.push({
                    success: false,
                    movieName: movieName,
                    baseUrl: url,
                    fileCount: 0,
                    files: [],
                    searchVariant: variantLabel,
                    contentFound: false,
                    error: error.message,
                    tmdb: enrichedTmdb
                });
            }
        }
        
        res.json({
            success: true,
            tmdbId: movie.id,
            dualSearchPerformed: nameVariants.length > 1,
            variantsChecked: nameVariants.length,
            variantsWithContent: variantsWithContent,
            results: results
        });
    } catch (error) {
        console.error('Error fetching movie by TMDB ID:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/111477/api/tmdb/tv/:tmdbId', async (req, res) => {
    try {
        const { tmdbId } = req.params;
        if (!tmdbId || isNaN(tmdbId)) {
            return res.status(400).json({ success: false, error: 'Valid TMDB ID is required' });
        }
        const tv = await lib111477_getTvDetails(parseInt(tmdbId));
        const nameVariants = lib111477_getTvNameVariants(tv);
        res.json({
            success: true, tmdb: tv, name: nameVariants[0], variants: nameVariants,
            seasons: tv.number_of_seasons, episodes: tv.number_of_episodes,
            note: 'Use /111477/api/tmdb/tv/:tmdbId/season/:season to get episodes for a specific season'
        });
    } catch (error) {
        console.error('Error fetching TV show by TMDB ID:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/111477/api/tmdb/tv/:tmdbId/season/:season', async (req, res) => {
    try {
        const { tmdbId, season } = req.params;
        if (!tmdbId || isNaN(tmdbId)) {
            return res.status(400).json({ success: false, error: 'Valid TMDB ID is required' });
        }
        if (!season || isNaN(season)) {
            return res.status(400).json({ success: false, error: 'Valid season number is required' });
        }
        const seasonNum = parseInt(season);
        const tv = await lib111477_getTvDetails(parseInt(tmdbId));
        const nameVariants = lib111477_getTvNameVariants(tv);
        const results = [];
        let variantsWithContent = 0;
        
        for (let i = 0; i < nameVariants.length; i++) {
            const tvName = nameVariants[i];
            const url = lib111477_constructTvUrl(tvName, seasonNum);
            const variantLabel = i === 0 ? 'colon_removed' : 'colon_to_hyphen';
            
            try {
                const html = await lib111477_fetchHtml(url);
                const content = lib111477_parseTvDirectory(html, url);
                
                if (content.fileCount > 0) {
                    variantsWithContent++;
                }
                
                const enrichedTmdb = {
                    id: tv.id,
                    name: tv.name,
                    originalName: tv.original_name,
                    firstAirDate: tv.first_air_date,
                    year: tv.first_air_date ? new Date(tv.first_air_date).getFullYear().toString() : '',
                    overview: tv.overview,
                    posterPath: tv.poster_path ? `https://image.tmdb.org/t/p/w500${tv.poster_path}` : null,
                    backdropPath: tv.backdrop_path ? `https://image.tmdb.org/t/p/w1280${tv.backdrop_path}` : null,
                    genres: tv.genres || [],
                    numberOfSeasons: tv.number_of_seasons,
                    numberOfEpisodes: tv.number_of_episodes
                };
                
                results.push({
                    success: true,
                    tvName: content.tvName,
                    baseUrl: content.baseUrl,
                    fileCount: content.fileCount,
                    files: content.files,
                    searchVariant: variantLabel,
                    contentFound: content.fileCount > 0,
                    tmdb: enrichedTmdb
                });
            } catch (error) {
                const enrichedTmdb = {
                    id: tv.id,
                    name: tv.name,
                    originalName: tv.original_name,
                    firstAirDate: tv.first_air_date,
                    year: tv.first_air_date ? new Date(tv.first_air_date).getFullYear().toString() : '',
                    overview: tv.overview,
                    posterPath: tv.poster_path ? `https://image.tmdb.org/t/p/w500${tv.poster_path}` : null,
                    backdropPath: tv.backdrop_path ? `https://image.tmdb.org/t/p/w1280${tv.backdrop_path}` : null,
                    genres: tv.genres || [],
                    numberOfSeasons: tv.number_of_seasons,
                    numberOfEpisodes: tv.number_of_episodes
                };
                
                results.push({
                    success: false,
                    tvName: tvName,
                    baseUrl: url,
                    fileCount: 0,
                    files: [],
                    searchVariant: variantLabel,
                    contentFound: false,
                    error: error.message,
                    tmdb: enrichedTmdb
                });
            }
        }
        
        res.json({
            success: true,
            tmdbId: tv.id,
            season: seasonNum,
            dualSearchPerformed: nameVariants.length > 1,
            variantsChecked: nameVariants.length,
            variantsWithContent: variantsWithContent,
            results: results
        });
    } catch (error) {
        console.error('Error fetching TV show season:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/111477/api/tmdb/tv/:tmdbId/season/:season/episode/:episode', async (req, res) => {
    try {
        const { tmdbId, season, episode } = req.params;
        if (!tmdbId || isNaN(tmdbId)) {
            return res.status(400).json({ success: false, error: 'Valid TMDB ID is required' });
        }
        if (!season || isNaN(season)) {
            return res.status(400).json({ success: false, error: 'Valid season number is required' });
        }
        if (!episode || isNaN(episode)) {
            return res.status(400).json({ success: false, error: 'Valid episode number is required' });
        }
        const seasonNum = parseInt(season);
        const episodeNum = parseInt(episode);
        const tv = await lib111477_getTvDetails(parseInt(tmdbId));
        const nameVariants = lib111477_getTvNameVariants(tv);
        const results = [];
        let variantsWithContent = 0;
        
        for (let i = 0; i < nameVariants.length; i++) {
            const tvName = nameVariants[i];
            const url = lib111477_constructTvUrl(tvName, seasonNum);
            const variantLabel = i === 0 ? 'colon_removed' : 'colon_to_hyphen';
            
            try {
                const html = await lib111477_fetchHtml(url);
                const content = lib111477_parseTvDirectory(html, url, seasonNum, episodeNum);
                
                if (content.fileCount > 0) {
                    variantsWithContent++;
                }
                
                const enrichedTmdb = {
                    id: tv.id,
                    name: tv.name,
                    originalName: tv.original_name,
                    firstAirDate: tv.first_air_date,
                    year: tv.first_air_date ? new Date(tv.first_air_date).getFullYear().toString() : '',
                    overview: tv.overview,
                    posterPath: tv.poster_path ? `https://image.tmdb.org/t/p/w500${tv.poster_path}` : null,
                    backdropPath: tv.backdrop_path ? `https://image.tmdb.org/t/p/w1280${tv.backdrop_path}` : null,
                    genres: tv.genres || [],
                    numberOfSeasons: tv.number_of_seasons,
                    numberOfEpisodes: tv.number_of_episodes
                };
                
                results.push({
                    success: true,
                    tvName: content.tvName,
                    baseUrl: content.baseUrl,
                    season: seasonNum,
                    episode: episodeNum,
                    fileCount: content.fileCount,
                    files: content.files,
                    searchVariant: variantLabel,
                    contentFound: content.fileCount > 0,
                    tmdb: enrichedTmdb
                });
            } catch (error) {
                const enrichedTmdb = {
                    id: tv.id,
                    name: tv.name,
                    originalName: tv.original_name,
                    firstAirDate: tv.first_air_date,
                    year: tv.first_air_date ? new Date(tv.first_air_date).getFullYear().toString() : '',
                    overview: tv.overview,
                    posterPath: tv.poster_path ? `https://image.tmdb.org/t/p/w500${tv.poster_path}` : null,
                    backdropPath: tv.backdrop_path ? `https://image.tmdb.org/t/p/w1280${tv.backdrop_path}` : null,
                    genres: tv.genres || [],
                    numberOfSeasons: tv.number_of_seasons,
                    numberOfEpisodes: tv.number_of_episodes
                };
                
                results.push({
                    success: false,
                    tvName: tvName,
                    baseUrl: url,
                    season: seasonNum,
                    episode: episodeNum,
                    fileCount: 0,
                    files: [],
                    searchVariant: variantLabel,
                    contentFound: false,
                    error: error.message,
                    tmdb: enrichedTmdb
                });
            }
        }
        
        res.json({
            success: true,
            tmdbId: tv.id,
            season: seasonNum,
            episode: episodeNum,
            dualSearchPerformed: nameVariants.length > 1,
            variantsChecked: nameVariants.length,
            variantsWithContent: variantsWithContent,
            results: results
        });
    } catch (error) {
        console.error('Error fetching TV show episode:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/111477/api/tmdb/search/:query', async (req, res) => {
    try {
        const { query } = req.params;
        const { page = 1 } = req.query;
        if (!query) {
            return res.status(400).json({ success: false, error: 'Search query is required' });
        }
        const searches = [];
        const queries = [query];
        if (query.includes(':')) {
            const hyphenQuery = query.replace(/:/g, ' -');
            queries.push(hyphenQuery);
        }
        for (const searchQuery of queries) {
            try {
                const results = await lib111477_searchMovies(searchQuery, parseInt(page));
                searches.push({ query: searchQuery, results: results });
            } catch (error) {
                searches.push({ query: searchQuery, error: error.message });
            }
        }
        res.json({ success: true, originalQuery: query, searches: searches });
    } catch (error) {
        console.error('Error searching TMDB:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/111477/api/tmdb/search/:query/fetch', async (req, res) => {
    try {
        const { query } = req.params;
        const { page = 1 } = req.query;
        if (!query) {
            return res.status(400).json({ success: false, error: 'Search query is required' });
        }
        const searches = [];
        const queries = [query];
        if (query.includes(':')) {
            const hyphenQuery = query.replace(/:/g, ' -');
            queries.push(hyphenQuery);
        }
        for (const searchQuery of queries) {
            try {
                const searchResults = await lib111477_searchMovies(searchQuery, parseInt(page));
                const resultsWithContent = await Promise.all(
                    searchResults.results.map(async (movie) => {
                        const nameVariants = lib111477_getMovieNameVariants(movie);
                        const contentResults = [];
                        for (const movieName of nameVariants) {
                            const url = lib111477_constructMovieUrl(movieName);
                            try {
                                const html = await lib111477_fetchHtml(url);
                                const content = lib111477_parseMovieDirectory(html, url);
                                contentResults.push({ variant: movieName, url: url, content: content });
                            } catch (error) {
                                contentResults.push({ variant: movieName, url: url, error: error.message });
                            }
                        }
                        return { ...movie, variants: nameVariants, contentResults: contentResults };
                    })
                );
                searches.push({ query: searchQuery, results: { ...searchResults, results: resultsWithContent } });
            } catch (error) {
                searches.push({ query: searchQuery, error: error.message });
            }
        }
        res.json({ success: true, originalQuery: query, searches: searches });
    } catch (error) {
        console.error('Error searching and fetching from TMDB:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/111477/api/parse', async (req, res) => {
    try {
        const { url, type = 'movie' } = req.body;
        if (!url) {
            return res.status(400).json({ success: false, error: 'URL is required' });
        }
        const normalizedUrl = lib111477_normalizeUrl(url);
        const html = await lib111477_fetchHtml(normalizedUrl);
        let result;
        if (type === 'tv') {
            result = lib111477_parseTvDirectory(html, normalizedUrl);
        } else {
            result = lib111477_parseMovieDirectory(html, normalizedUrl);
        }
        res.json(result);
    } catch (error) {
        console.error('Error parsing URL:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/111477/api/parse-batch', async (req, res) => {
    try {
        const { urls } = req.body;
        if (!urls || !Array.isArray(urls)) {
            return res.status(400).json({ success: false, error: 'URLs array is required' });
        }
        const results = await Promise.all(
            urls.map(async (item) => {
                try {
                    const { url, type = 'movie' } = item;
                    const normalizedUrl = lib111477_normalizeUrl(url);
                    const html = await lib111477_fetchHtml(normalizedUrl);
                    let result;
                    if (type === 'tv') {
                        result = lib111477_parseTvDirectory(html, normalizedUrl);
                    } else {
                        result = lib111477_parseMovieDirectory(html, normalizedUrl);
                    }
                    return { url: normalizedUrl, type, ...result };
                } catch (error) {
                    return { url: item.url, type: item.type || 'movie', success: false, error: error.message };
                }
            })
        );
        res.json({ success: true, count: results.length, results });
    } catch (error) {
        console.error('Error batch parsing URLs:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Health check for the entire server
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        services: ['anime', 'torrentio', 'torrentless', 'zlib', 'otherbook', '111477', 'realm']
    });
});

// ============================================================================
// REALM ANIME SOURCES
// ============================================================================

const https = require('https');
const zlib = require('zlib');

// Proxy endpoint to handle referer headers for realm streams
app.get('/api/realm/proxy', async (req, res) => {
    const { url, referer } = req.query;
    
    if (!url) {
        return res.status(400).json({ error: 'Missing url parameter' });
    }
    
    try {
        const parsedUrl = new URL(url);
        
        // Determine if this is an HLS playlist or segment
        const isPlaylist = parsedUrl.pathname.includes('.m3u8');
        const isSegment = parsedUrl.pathname.includes('.ts') || parsedUrl.pathname.includes('.aac');
        
        const options = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            headers: {
                'User-Agent': getRandomUserAgent(),
                'Accept': isPlaylist ? 'application/vnd.apple.mpegurl, */*' : '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Connection': 'keep-alive',
            }
        };
        
        // Add referer headers if provided - use for all requests
        const effectiveReferer = referer || parsedUrl.origin;
        if (effectiveReferer) {
            options.headers['Referer'] = effectiveReferer;
            try {
                options.headers['Origin'] = new URL(effectiveReferer).origin;
            } catch (e) {
                options.headers['Origin'] = parsedUrl.origin;
            }
        }
        
        // Forward Range header from client for seeking
        if (req.headers.range) {
            options.headers['Range'] = req.headers.range;
        }
        
        const protocol = parsedUrl.protocol === 'https:' ? https : require('http');
        
        const proxyReq = protocol.request(options, (proxyRes) => {
            // Set status code
            res.status(proxyRes.statusCode);
            
            // For HLS playlists, we need to modify the content to proxy all URLs
            if (isPlaylist && proxyRes.headers['content-type']?.includes('mpegurl')) {
                let data = '';
                
                proxyRes.on('data', (chunk) => {
                    data += chunk.toString();
                });
                
                proxyRes.on('end', () => {
                    // Replace all URLs in the playlist with proxied versions
                    const lines = data.split('\n');
                    const modifiedLines = lines.map(line => {
                        line = line.trim();
                        
                        // Skip empty lines and comments (except URI lines)
                        if (!line || (line.startsWith('#') && !line.includes('URI='))) {
                            return line;
                        }
                        
                        // Handle #EXT-X-KEY lines with URI
                        if (line.startsWith('#EXT-X-KEY') && line.includes('URI=')) {
                            return line.replace(/URI="([^"]+)"/g, (match, uri) => {
                                const absoluteUrl = uri.startsWith('http') ? uri : new URL(uri, url).href;
                                const proxiedUrl = `http://localhost:6987/api/realm/proxy?url=${encodeURIComponent(absoluteUrl)}&referer=${encodeURIComponent(effectiveReferer)}`;
                                return `URI="${proxiedUrl}"`;
                            });
                        }
                        
                        // Handle segment URLs (non-comment lines)
                        if (!line.startsWith('#')) {
                            const absoluteUrl = line.startsWith('http') ? line : new URL(line, url).href;
                            return `http://localhost:6987/api/realm/proxy?url=${encodeURIComponent(absoluteUrl)}&referer=${encodeURIComponent(effectiveReferer)}`;
                        }
                        
                        return line;
                    });
                    
                    const modifiedPlaylist = modifiedLines.join('\n');
                    
                    // Set headers
                    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
                    res.setHeader('Content-Length', Buffer.byteLength(modifiedPlaylist));
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
                    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Authorization');
                    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                    
                    res.send(modifiedPlaylist);
                });
                
                proxyRes.on('error', (err) => {
                    console.error('[Realm Proxy] Playlist error:', err);
                    if (!res.headersSent) {
                        res.status(500).json({ error: 'Playlist processing error' });
                    }
                });
            } else {
                // For non-playlist content, stream directly
                // Forward important headers
                if (proxyRes.headers['content-type']) {
                    res.setHeader('Content-Type', proxyRes.headers['content-type']);
                }
                if (proxyRes.headers['content-length']) {
                    res.setHeader('Content-Length', proxyRes.headers['content-length']);
                }
                if (proxyRes.headers['accept-ranges']) {
                    res.setHeader('Accept-Ranges', proxyRes.headers['accept-ranges']);
                }
                if (proxyRes.headers['content-range']) {
                    res.setHeader('Content-Range', proxyRes.headers['content-range']);
                }
                
                // CORS headers - critical for HLS playback
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Authorization');
                res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
                
                // Cache control
                if (isSegment) {
                    res.setHeader('Cache-Control', 'public, max-age=31536000');
                } else {
                    res.setHeader('Cache-Control', 'no-cache');
                }
                
                // Stream the response directly
                proxyRes.pipe(res);
            }
        });
        
        proxyReq.on('error', (error) => {
            console.error('[Realm Proxy] Request error:', error.message);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Proxy request failed', details: error.message });
            }
        });
        
        // Handle client disconnect
        req.on('close', () => {
            proxyReq.destroy();
        });
        
        req.on('error', () => {
            proxyReq.destroy();
        });
        
        proxyReq.end();
    } catch (error) {
        console.error('[Realm Proxy] Error:', error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

// Realm anime sources endpoint
app.get('/api/realm/:anilistId/:episodeNumber', async (req, res) => {
    const { anilistId, episodeNumber } = req.params;
    
    if (!anilistId || !episodeNumber) {
        return res.status(400).json({ error: 'Missing anilistId or episodeNumber' });
    }
    
    try {
        // List of Realm providers to query for sources.  In addition to the
        // default providers, include additional providers as requested.  These
        // providers use the same Realm API and support streams (and, for some
        // sources, subtitles) in the same format as zencloud.  We leave
        // existing providers unchanged and append new entries here to avoid
        // breaking upstream behaviour.
        const providers = [
            'allmanga',
            'animez',
            'animepahe',
            'zencloud',
            'animepahe-dub',
            'allmanga-dub',
            'hanime-tv',
            // Additional providers added per user request
            'kickassanime',
            'animekai',
            'animekai-dub',
            'anizone'
        ];
        
        const results = {};
        
        const promises = providers.map(provider =>
            fetchFromRealmProvider(provider, parseInt(anilistId), parseInt(episodeNumber))
                .then(data => {
                    results[provider] = data;
                })
                .catch(error => {
                    results[provider] = { error: error.message };
                })
        );
        
        await Promise.all(promises);
        
        res.json(results);
    } catch (error) {
        console.error('[Realm] Error:', error);
        res.status(500).json({ error: error.message });
    }
});

function fetchFromRealmProvider(provider, anilistId, episodeNumber) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            provider: provider,
            anilistId: anilistId,
            episodeNumber: episodeNumber
        });
        
        const options = {
            hostname: 'www.animerealms.org',
            path: '/api/watch',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                'Referer': 'https://www.animerealms.org/en/watch/' + anilistId + '/' + episodeNumber,
                'Origin': 'https://www.animerealms.org',
                'Cookie': '__Host-authjs.csrf-token=78f2694c0cc09f6ce564239018ccc01568c553645944459ef139123511eaa258%7Ce9c67743f1d1a54cf5d25c8a46f1069f92d7d9d1deabdde61e474ae7fde5fb6d; __Secure-authjs.callback-url=https%3A%2F%2Fbeta.animerealms.org',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.7',
                'Accept-Encoding': 'gzip, deflate, br, zstd',
                'sec-ch-ua': '"Chromium";v="142", "Brave";v="142", "Not_A Brand";v="99"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin',
                'sec-gpc': '1',
                'priority': 'u=1, i'
            }
        };
        
        const apiRequest = https.request(options, (apiResponse) => {
            let data = [];
            
            apiResponse.on('data', (chunk) => {
                data.push(chunk);
            });
            
            apiResponse.on('end', () => {
                try {
                    const buffer = Buffer.concat(data);
                    const encoding = apiResponse.headers['content-encoding'];
                    
                    let decompressed;
                    if (encoding === 'gzip') {
                        decompressed = zlib.gunzipSync(buffer);
                    } else if (encoding === 'deflate') {
                        decompressed = zlib.inflateSync(buffer);
                    } else if (encoding === 'br') {
                        decompressed = zlib.brotliDecompressSync(buffer);
                    } else {
                        decompressed = buffer;
                    }
                    
                    const result = JSON.parse(decompressed.toString());
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            });
        });
        
        apiRequest.on('error', (error) => {
            reject(error);
        });
        
        apiRequest.write(postData);
        apiRequest.end();
    });
}

// ============================================================================
// AUDIOBOOKS API (naudios.com)
// ============================================================================

const NAUDIOS_API_KEY = 'NAUDIOS_KEY_2024';
const NAUDIOS_BASE_URL = 'https://naudios.com';
const NAUDIOS_IMG_BASE = 'https://naudios.com/img/thumb';

// Helper to add full poster URLs to audiobook data
function addAudiobookPosters(data) {
    if (data && data.data && Array.isArray(data.data)) {
        data.data = data.data.map(book => ({
            ...book,
            image: book.thumb ? `${NAUDIOS_IMG_BASE}/${book.thumb}` : null,
            post_name: book.id // Use id as post_name for compatibility
        }));
    }
    return data;
}

// Get audiobooks with pagination (infinite scroll)
app.get('/api/audiobooks/all', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 0;
        const apiUrl = `${NAUDIOS_BASE_URL}/API/see_more.php?key=${NAUDIOS_API_KEY}&page=${page}`;
        
        console.log(`[AUDIOBOOKS] Fetching page ${page} from: ${apiUrl}`);
        const response = await axios.get(apiUrl);
        
        const result = addAudiobookPosters(response.data);
        res.json(result);
    } catch (error) {
        console.error('[AUDIOBOOKS] Error fetching:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch audiobooks'
        });
    }
});

// Search audiobooks
app.get('/api/audiobooks/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) {
            return res.status(400).json({ success: false, error: 'Query parameter required' });
        }
        
        const searchUrl = `${NAUDIOS_BASE_URL}/API/search.php?key=${NAUDIOS_API_KEY}&query=${encodeURIComponent(query)}`;
        console.log(`[AUDIOBOOKS] Searching for: ${query}`);
        
        const response = await axios.get(searchUrl);
        const result = addAudiobookPosters(response.data);
        res.json(result);
    } catch (error) {
        console.error('[AUDIOBOOKS] Search error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Search failed'
        });
    }
});

// Load more audiobooks (pagination endpoint)
app.get('/api/audiobooks/more/:page', async (req, res) => {
    try {
        const page = parseInt(req.params.page) || 1;
        const apiUrl = `${NAUDIOS_BASE_URL}/API/see_more.php?key=${NAUDIOS_API_KEY}&page=${page}`;
        
        console.log(`[AUDIOBOOKS] Loading page ${page}`);
        const response = await axios.get(apiUrl);
        
        const result = addAudiobookPosters(response.data);
        res.json(result);
    } catch (error) {
        console.error('[AUDIOBOOKS] Load more error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to load more audiobooks'
        });
    }
});

// Get audiobook details and chapters by ID (using post_name which is actually the id)
app.get('/api/audiobooks/details/:post_name', async (req, res) => {
    try {
        const id = req.params.post_name;
        const bookUrl = `${NAUDIOS_BASE_URL}/watch/${id}`;
        
        console.log(`[AUDIOBOOKS] Fetching details for ID: ${id}`);
        const response = await axios.get(bookUrl, {
            headers: {
                'User-Agent': getRandomUserAgent(),
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            }
        });
        
        const html = response.data;
        const $ = cheerio.load(html);
        
        // Extract basic info
        const title = $('h1, .title, .book-title').first().text().trim();
        const image = $('img.book-cover, .thumbnail img, img[src*="thumb"]').first().attr('src');
        const description = $('.description, .book-description, p').first().text().trim();
        
        res.json({
            success: true,
            data: {
                id,
                title,
                image: image ? (image.startsWith('http') ? image : `${NAUDIOS_BASE_URL}${image}`) : '',
                description,
                url: bookUrl
            }
        });
    } catch (error) {
        console.error('[AUDIOBOOKS] Details error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch details'
        });
    }
});

// Get audiobook chapters by ID (using post_name which is actually the id)
app.get('/api/audiobooks/chapters/:post_name', async (req, res) => {
    try {
        const id = req.params.post_name;
        const bookUrl = `${NAUDIOS_BASE_URL}/watch/${id}`;
        
        console.log(`[AUDIOBOOKS] Fetching chapters for ID: ${id}`);
        const response = await axios.get(bookUrl, {
            headers: {
                'User-Agent': getRandomUserAgent(),
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            }
        });
        
        const html = response.data;
        const $ = cheerio.load(html);
        
        const chapters = [];
        
        // Parse track items from the HTML
        $('.track-item').each((index, element) => {
            const $track = $(element);
            const dataSrc = $track.attr('data-src');
            const title = $track.text().trim();
            
            if (dataSrc && title) {
                chapters.push({
                    chapter_id: dataSrc, // Store the full URL as chapter_id for streaming
                    track: index + 1,
                    name: title,
                    duration: 'Unknown'
                });
            }
        });
        
        res.json({
            success: true,
            post_name: id,
            count: chapters.length,
            data: chapters
        });
    } catch (error) {
        console.error('[AUDIOBOOKS] Chapters error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch chapters'
        });
    }
});

// Stream endpoint - now just returns the direct URL
app.post('/api/audiobooks/stream', async (req, res) => {
    try {
        const { chapterId } = req.body;
        
        if (!chapterId) {
            return res.status(400).json({
                success: false,
                error: 'chapterId is required'
            });
        }
        
        // chapterId is already the full audio URL from naudios
        res.json({
            success: true,
            data: {
                link_mp3: chapterId
            }
        });
    } catch (error) {
        console.error('[AUDIOBOOKS] Stream error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to get stream link'
        });
    }
});

// ============================================================================
// AIOSTREAMS™ TMDB + STREAM FORWARDING MODULE
// ============================================================================

const TMDB_API_KEY = "c3515fdc674ea2bd7b514f4bc3616a4a";
const TMDB_BASE_URL = "https://api.themoviedb.org/3";

// Read Manifest URL saved by Electron (window.electronAPI.manifestWrite)



// Parse manifest URL: /stremio/<uuid>/<token>/manifest.json
function parseManifestUrl(manifestUrl) {
    const match = manifestUrl.match(/\/stremio\/([^/]+)\/([^/]+)\/manifest\.json/);
    if (!match) throw new Error("Invalid manifest URL format");
    return {
        uuid: match[1],
        token: match[2],
        baseUrl: manifestUrl.replace(/\/manifest\.json$/, "")
    };
}

// --------------------------------------------------------------------
// TMDB Endpoints
// --------------------------------------------------------------------

app.get("/aio/movies/popular", async (req, res) => {
    try {
        const response = await axios.get(`${TMDB_BASE_URL}/movie/popular`, {
            params: { api_key: TMDB_API_KEY, language: "en-US", page: req.query.page || 1 }
        });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/aio/tv/popular", async (req, res) => {
    try {
        const response = await axios.get(`${TMDB_BASE_URL}/tv/popular`, {
            params: { api_key: TMDB_API_KEY, language: "en-US", page: req.query.page || 1 }
        });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/aio/search/movie", async (req, res) => {
    try {
        const response = await axios.get(`${TMDB_BASE_URL}/search/movie`, {
            params: { api_key: TMDB_API_KEY, language: "en-US", query: req.query.q, page: 1 }
        });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/aio/search/tv", async (req, res) => {
    try {
        const response = await axios.get(`${TMDB_BASE_URL}/search/tv`, {
            params: { api_key: TMDB_API_KEY, language: "en-US", query: req.query.q, page: 1 }
        });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/aio/tv/:id", async (req, res) => {
    try {
        const response = await axios.get(`${TMDB_BASE_URL}/tv/${req.params.id}`, {
            params: { api_key: TMDB_API_KEY, language: "en-US" }
        });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/aio/tv/:id/season/:season", async (req, res) => {
    try {
        const response = await axios.get(`${TMDB_BASE_URL}/tv/${req.params.id}/season/${req.params.season}`, {
            params: { api_key: TMDB_API_KEY, language: "en-US" }
        });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/aio/:type/:id/external_ids", async (req, res) => {
    try {
        const response = await axios.get(`${TMDB_BASE_URL}/${req.params.type}/${req.params.id}/external_ids`, {
            params: { api_key: TMDB_API_KEY }
        });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --------------------------------------------------------------------
// STREAM FORWARDING FROM AIOSTREAMS (the important part)
// --------------------------------------------------------------------

app.post("/aio/streams", async (req, res) => {
    try {
        let manifestUrl = req.body.manifestUrl || getSavedManifestUrl();
        if (!manifestUrl) return res.status(400).json({ error: "No saved manifest found" });

        const { type, imdbId, season, episode } = req.body;
        const { baseUrl } = parseManifestUrl(manifestUrl);

        let streamId = imdbId;
        if (type === "series" && season && episode) {
            streamId = `${imdbId}:${season}:${episode}`;
        }

        const streamUrl = `${baseUrl}/stream/${type}/${streamId}.json`;
        console.log("[AIO] Streaming from:", streamUrl);

        const response = await axios.get(streamUrl);
        res.json(response.data);

    } catch (error) {
        console.error("AIO /streams error:", error.message);
        res.status(500).json({ error: error.message });
    }
});

app.get("/aio/series/:tmdbId/:season/:episode", async (req, res) => {
    try {
        const { tmdbId, season, episode } = req.params;

        // ---- Load Saved Manifest URL (same as movie) ----
        const savedManifest = await getSavedManifestUrl();
        if (!savedManifest) return res.status(400).json({ error: "No saved manifest found" });

        // ---- Convert TMDB -> IMDB ----
        const external = await axios.get(
            `${TMDB_BASE_URL}/tv/${tmdbId}/external_ids`,
            { params: { api_key: TMDB_API_KEY } }
        );

        const imdbId = external.data.imdb_id;
        if (!imdbId) return res.status(404).json({ error: "IMDb ID not found for this TMDB ID" });

        // ---- Parse Manifest URL ----
        const { baseUrl } = parseManifestUrl(savedManifest);

        // ---- Build Stream URL for SERIES ----
        const streamUrl = `${baseUrl}/stream/series/${imdbId}:${season}:${episode}.json`;

        console.log("[AIOSTREAM SERIES] CALL =>", streamUrl);

        // ---- Fetch & Return Streams ----
        const response = await axios.get(streamUrl);
        res.json({ imdbId, season, episode, streamUrl, streams: response.data });

    } catch (error) {
        console.error("AIO /series ERROR:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================

app.get("/aio/movie/:tmdbId", async (req, res) => {
    try {
        const tmdbId = req.params.tmdbId;

        // ---- Load Saved Manifest URL ----
        const savedManifest = await getSavedManifestUrl();
        if (!savedManifest) return res.status(400).json({ error: "No saved manifest found" });

        // ---- Convert TMDB -> IMDB ----
        const external = await axios.get(
            `${TMDB_BASE_URL}/movie/${tmdbId}/external_ids`,
            { params: { api_key: TMDB_API_KEY } }
        );

        const imdbId = external.data.imdb_id;
        if (!imdbId) return res.status(404).json({ error: "IMDB ID not found for this TMDB ID" });

        // ---- Parse Manifest URL ----
        const { baseUrl } = parseManifestUrl(savedManifest);

        // ---- Build Stream URL ----
        const streamUrl = `${baseUrl}/stream/movie/${imdbId}.json`;
        console.log("[AIOSTREAM] CALL =>", streamUrl);

        // ---- Fetch & Return Streams ----
        const response = await axios.get(streamUrl);
        res.json({ imdbId, streamUrl, streams: response.data });

    } catch (error) {
        console.error("AIO /movie/:tmdbId ERROR:", error.message);
        res.status(500).json({ error: error.message });
    }
});


// ============================================================================
// MANGA SERVICE (WeebCentral scraper)
// ============================================================================

// API endpoint to scrape manga data
app.get('/api/manga/all', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const response = await axios.get(`https://weebcentral.com/latest-updates/${page}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    const mangas = [];

    // Parse each article element
    $('article.bg-base-100').each((index, element) => {
      const $article = $(element);
      
      // Get manga name from data-tip attribute
      const name = $article.attr('data-tip');
      
      // Get poster URL and series ID from the first link
      const $posterLink = $article.find('a').first();
      const seriesPageUrl = $posterLink.attr('href');
      const posterUrl = $article.find('source[type="image/webp"]').attr('srcset') || 
                       $article.find('img').attr('src');
      
      // Extract series ID from series page URL: https://weebcentral.com/series/01JZ0EQ9370BN5XD4GN2SD77N1/...
      const seriesIdMatch = seriesPageUrl?.match(/\/series\/([^\/]+)/);
      const seriesId = seriesIdMatch ? seriesIdMatch[1] : null;
      
      // Get the chapter URL from the second link (latest chapter)
      const $chapterLink = $article.find('a').eq(1);
      const latestChapterUrl = $chapterLink.attr('href');
      const chapterIdMatch = latestChapterUrl?.match(/\/chapters\/([^\/]+)/);
      const chapterId = chapterIdMatch ? chapterIdMatch[1] : null;
      
      if (name && posterUrl && seriesId && chapterId) {
        mangas.push({
          id: index,
          name: name,
          poster: posterUrl,
          seriesId: seriesId,
          latestChapterId: chapterId
        });
      }
    });

    res.json({
      success: true,
      count: mangas.length,
      data: mangas
    });
  } catch (error) {
    console.error('[MANGA] Scraping error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Search API endpoint
app.get('/api/manga/search', async (req, res) => {
  try {
    const query = req.query.q || '';
    if (!query.trim()) {
      return res.json({
        success: true,
        count: 0,
        data: []
      });
    }

    const response = await axios.get('https://weebcentral.com/search/data', {
      params: {
        author: '',
        text: query,
        sort: 'Best Match',
        order: 'Descending',
        official: 'Any',
        anime: 'Any',
        adult: 'Any',
        display_mode: 'Full Display'
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    const mangas = [];

    // Parse search results
    $('article.bg-base-300').each((index, element) => {
      const $article = $(element);
      
      // Get manga name and series info from the link
      const $link = $article.find('a[href*="/series/"]').first();
      const seriesUrl = $link.attr('href');
      const name = $link.attr('href')?.split('/').pop()?.replace(/-/g, ' ').trim() || 
                   $article.find('.line-clamp-1').text().trim();
      
      // Extract series ID from URL: https://weebcentral.com/series/01J76XYBPP2A7D38XGF4PSQVPD/...
      const seriesIdMatch = seriesUrl?.match(/\/series\/([^\/]+)/);
      const seriesId = seriesIdMatch ? seriesIdMatch[1] : null;
      
      // Get poster URL
      const posterUrl = $article.find('source[type="image/webp"]').attr('srcset') || 
                       $article.find('img').attr('src');
      
      // Get latest chapter link if available (might be in the article)
      const $chapterLink = $article.find('a[href*="/chapters/"]').first();
      const latestChapterUrl = $chapterLink.attr('href');
      const latestChapterIdMatch = latestChapterUrl?.match(/\/chapters\/([^\/]+)/);
      const latestChapterId = latestChapterIdMatch ? latestChapterIdMatch[1] : null;
      
      if (name && posterUrl && seriesId) {
        mangas.push({
          id: `${query}-${index}`,
          name: name,
          poster: posterUrl,
          seriesId: seriesId,
          latestChapterId: latestChapterId
        });
      }
    });

    res.json({
      success: true,
      count: mangas.length,
      data: mangas
    });
  } catch (error) {
    console.error('[MANGA] Search error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get chapters for a manga series
app.get('/api/manga/chapters', async (req, res) => {
  try {
    const seriesId = req.query.seriesId;
    let latestChapterId = req.query.latestChapterId;
    
    if (!seriesId) {
      return res.status(400).json({
        success: false,
        error: 'seriesId required'
      });
    }

    // If latestChapterId is not provided or is 'latest', fetch the series page to get it
    if (!latestChapterId || latestChapterId === 'latest') {
      try {
        const seriesPageResponse = await axios.get(`https://weebcentral.com/series/${seriesId}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
          }
        });
        
        const $series = cheerio.load(seriesPageResponse.data);
        const $latestChapterLink = $series('a[href*="/chapters/"]').first();
        const latestChapterUrl = $latestChapterLink.attr('href');
        const latestChapterIdMatch = latestChapterUrl?.match(/\/chapters\/([^\/]+)/);
        latestChapterId = latestChapterIdMatch ? latestChapterIdMatch[1] : null;

        if (!latestChapterId) {
          return res.status(404).json({
            success: false,
            error: 'Could not find latest chapter'
          });
        }
      } catch (error) {
        return res.status(500).json({
          success: false,
          error: 'Failed to fetch series information'
        });
      }
    }

    // Fetch the chapter-select page with the latest chapter
    const url = `https://weebcentral.com/series/${seriesId}/chapter-select?current_chapter=${latestChapterId}&current_page=0`;
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    const chapters = [];

    // Parse chapter list - look for both <button> and <a> elements in the grid
    $('div.grid button, div.grid a').each((index, element) => {
      const $el = $(element);
      const text = $el.text().trim();
      const href = $el.attr('href');
      
      if (text) {
        // For selected button without href, extract chapter ID from current_chapter parameter
        let chapterId = href ? href.split('/').pop() : null;
        
        if (!chapterId && $el.attr('id') === 'selected_chapter') {
          // Extract from the URL query parameter
          const urlObj = new URL(url);
          const currentChapter = urlObj.searchParams.get('current_chapter');
          chapterId = currentChapter;
        }
        
        if (chapterId) {
          chapters.push({
            id: chapterId,
            name: text,
            url: href,
            isSelected: $el.attr('id') === 'selected_chapter'
          });
        }
      }
    });

    res.json({
      success: true,
      count: chapters.length,
      data: chapters
    });
  } catch (error) {
    console.error('[MANGA] Chapters error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Proxy endpoint for manga page images (to bypass CORS)
app.get('/api/proxy-image', async (req, res) => {
  try {
    const imageUrl = req.query.url;
    
    if (!imageUrl) {
      return res.status(400).json({ error: 'url parameter required' });
    }

    const response = await axios.get(imageUrl, {
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
      }
    });

    // Set the correct content type
    res.setHeader('Content-Type', response.headers['content-type']);
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    
    response.data.pipe(res);
  } catch (error) {
    console.error('[MANGA] Proxy image error:', error.message);
    res.status(500).json({ error: 'Failed to fetch image' });
  }
});

// Get pages from a chapter
app.get('/api/chapter/pages', async (req, res) => {
  try {
    const chapterId = req.query.chapterId;
    
    if (!chapterId) {
      return res.status(400).json({
        success: false,
        error: 'chapterId required'
      });
    }

    const url = `https://weebcentral.com/chapters/${chapterId}`;
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    
    // Get the first page URL from preload link
    let firstPageUrl = $('link[rel="preload"][as="image"]').attr('href');
    
    if (!firstPageUrl) {
      return res.status(404).json({
        success: false,
        error: 'No pages found'
      });
    }

    // Extract the base URL and chapter number
    const urlParts = firstPageUrl.split('/');
    const fileName = urlParts[urlParts.length - 1];
    const baseUrl = firstPageUrl.substring(0, firstPageUrl.lastIndexOf('/') + 1);
    
    // Extract chapter number from filename - handle multiple formats
    // Format 1: 123-001.png (traditional format)
    // Format 2: 1.1-001.png or 1.1.1-001.png (decimal format)
    let chapterNum = null;
    let pageFormat = null;
    
    const match1 = fileName.match(/^(\d+)-\d+\.png$/);
    const match2 = fileName.match(/^([\d.]+)-\d+\.png$/);
    
    if (match1) {
      chapterNum = match1[1];
      pageFormat = 'simple'; // 123-001.png
    } else if (match2) {
      chapterNum = match2[1];
      pageFormat = 'decimal'; // 1.1-001.png or 1.1.1-001.png
    }
    
    if (!chapterNum) {
      return res.status(404).json({
        success: false,
        error: 'Could not parse page URL'
      });
    }
    
    let consecutiveFailures = 0;
    const maxFailures = 3;
    let pages = [];
    let i = 1;
    
    // Keep checking pages until 3 consecutive failures (no page limit)
    while (true) {
      const pageNum = String(i).padStart(3, '0');
      const pageUrl = `${baseUrl}${chapterNum}-${pageNum}.png`;
      
      // Try to check if page exists
      let pageExists = false;
      try {
        const checkResponse = await axios.head(pageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
          },
          timeout: 5000
        });
        pageExists = checkResponse.status === 200;
      } catch (error) {
        pageExists = false;
      }
      
      if (pageExists) {
        pages.push(pageUrl);
        consecutiveFailures = 0;
      } else {
        consecutiveFailures++;
        
        // If we've had 3 consecutive failures, stop looking
        if (consecutiveFailures >= maxFailures) {
          console.log(`[MANGA] Chapter ${chapterId}: Found ${pages.length} pages, stopped after ${maxFailures} consecutive failures`);
          break; // Exit loop
        }
      }
      
      i++;
    }

    res.json({
        success: true,
        pages: pages,
        total_pages: pages.length
    });

  } catch (error) {
    console.error('[MANGA] Pages error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ---- MOVIEBOX ASTRA SINGLE ENDPOINT ---- //

const axios = require("axios");
const CryptoJS = require("crypto-js");
const fetch = require("node-fetch").default;

const MOVIEBOX_KEY = "x7k9mPqT2rWvY8zA5bC3nF6hJ2lK4mN9";
const MOVIEBOX_IV = MOVIEBOX_KEY.substring(0, 16);

function movieboxEncrypt(str) {
    const key = CryptoJS.enc.Utf8.parse(MOVIEBOX_KEY);
    const iv = CryptoJS.enc.Utf8.parse(MOVIEBOX_IV);
    let enc = CryptoJS.AES.encrypt(str, key, { iv }).ciphertext.toString(CryptoJS.enc.Base64);
    return enc.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function movieboxGetPlaylist(astraUrl) {
    const resp = await axios.get(astraUrl);
    const list = resp.data;

    return list.map(item => {
        let rawUrl = item.url;

        // decode proxy.vidrock.store/<URL>
        if (rawUrl.includes("proxy.vidrock.store/")) {
            const match = rawUrl.match(/proxy\.vidrock\.store\/(.*?)$/);
            if (match) rawUrl = decodeURIComponent(match[1]);
        }

        // final stream URL = proxied URL (IMPORTANT)
        const proxyUrl = `http://localhost:6987/proxy?url=${encodeURIComponent(rawUrl)}`;

        return {
            resolution: item.resolution,
            url: proxyUrl,   // <--- THIS IS THE ONE YOU PLAY
            rawUrl
        };
    });
}

// ------------------------------------------ //
//    SINGLE ROUTE (MOVIE + TV COMBINED)      //
// ------------------------------------------ //

app.get("/moviebox/:tmdbId/:season?/:episode?", async (req, res) => {
    try {
        const { tmdbId, season, episode } = req.params;

        let encoded;
        let fetchUrl;
        let referer;

        if (!season || !episode) {
            // MOVIE
            encoded = movieboxEncrypt(tmdbId);
            fetchUrl = `https://vidrock.net/api/movie/${encoded}`;
            referer = `https://vidrock.net/movie/${tmdbId}`;
        } else {
            // TV
            encoded = movieboxEncrypt(`${tmdbId}_${season}_${episode}`);
            fetchUrl = `https://vidrock.net/api/tv/${encoded}`;
            referer = `https://vidrock.net/tv/${tmdbId}/${season}/${episode}`;
        }

        const info = await axios.get(fetchUrl, { headers: { Referer: referer } });
        const astra = info.data.Astra;

        if (!astra || !astra.url)
            return res.json({ error: "No Astra source available" });

        const playlist = await movieboxGetPlaylist(astra.url);

        return res.json({
            Astra: {
                language: astra.language,
                flag: astra.flag,
                playlist
            }
        });

    } catch (err) {
        console.error("MovieBox error:", err.message);
        res.status(500).json({ error: "MovieBox failed" });
    }
});

// ---- END MOVIEBOX SINGLE ENDPOINT ---- //

// MOVIEBOX ASTRA - MOVIE
app.get("/api/astra/:tmdbId", async (req, res) => {
    try {
        const tmdbId = req.params.tmdbId;

        const key = "x7k9mPqT2rWvY8zA5bC3nF6hJ2lK4mN9";
        const iv = key.substring(0, 16);

        const enc = require("crypto-js").AES.encrypt(
            tmdbId,
            require("crypto-js").enc.Utf8.parse(key),
            { iv: require("crypto-js").enc.Utf8.parse(iv) }
        ).ciphertext.toString(require("crypto-js").enc.Base64)
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");

        const apiURL = `https://vidrock.net/api/movie/${enc}`;
        const referer = `https://vidrock.net/movie/${tmdbId}`;

        const axios = require("axios");
        const base = await axios.get(apiURL, { headers: { Referer: referer } });

        const astra = base.data.Astra;
        if (!astra || !astra.url) return res.json({ error: "No Astra available" });

        const playlistResp = await axios.get(astra.url);
        const playlist = playlistResp.data;

        const finalPlaylist = playlist.map(p => {
            let raw = p.url;

            if (raw.includes("proxy.vidrock.store")) {
                const m = raw.match(/proxy\.vidrock\.store\/(.*?)$/);
                if (m) raw = decodeURIComponent(m[1]);
            }

            return {
                resolution: p.resolution,
                url: `http://localhost:6987/proxy?url=${encodeURIComponent(raw)}`,
                rawUrl: raw
            };
        });

        res.json({
            Astra: {
                language: astra.language,
                flag: astra.flag,
                playlist: finalPlaylist
            }
        });

    } catch (err) {
        console.log("Astra Movie Error:", err.message);
        res.json({ error: "MovieBox failed" });
    }
});

// MOVIEBOX ASTRA - TV
app.get("/api/tv/:tmdbId/:season/:episode", async (req, res) => {
    try {
        const { tmdbId, season, episode } = req.params;

        const key = "x7k9mPqT2rWvY8zA5bC3nF6hJ2lK4mN9";
        const iv = key.substring(0, 16);

        const combined = `${tmdbId}_${season}_${episode}`;

        const enc = require("crypto-js").AES.encrypt(
            combined,
            require("crypto-js").enc.Utf8.parse(key),
            { iv: require("crypto-js").enc.Utf8.parse(iv) }
        ).ciphertext.toString(require("crypto-js").enc.Base64)
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");

        const axios = require("axios");
        const apiURL = `https://vidrock.net/api/tv/${enc}`;
        const referer = `https://vidrock.net/tv/${tmdbId}/${season}/${episode}`;

        const base = await axios.get(apiURL, { headers: { Referer: referer } });

        const astra = base.data.Astra;
        if (!astra || !astra.url) return res.json({ error: "No Astra available" });

        const playlistResp = await axios.get(astra.url);
        const playlist = playlistResp.data;

        const finalPlaylist = playlist.map(p => {
            let raw = p.url;

            if (raw.includes("proxy.vidrock.store")) {
                const m = raw.match(/proxy\.vidrock\.store\/(.*?)$/);
                if (m) raw = decodeURIComponent(m[1]);
            }

            return {
                resolution: p.resolution,
                url: `http://localhost:6987/proxy?url=${encodeURIComponent(raw)}`,
                rawUrl: raw
            };
        });

        res.json({
            Astra: {
                language: astra.language,
                flag: astra.flag,
                playlist: finalPlaylist
            }
        });

    } catch (err) {
        console.log("Astra TV Error:", err.message);
        res.json({ error: "MovieBox failed" });
    }
});

app.get("/proxy", async (req, res) => {
    const target = req.query.url;
    if (!target) return res.status(400).json({ error: "Missing url parameter" });

    try {
        const proxyHeaders = {
            "User-Agent": req.headers["user-agent"] || "Mozilla/5.0",
            "Accept": "*/*",
            "Referer": "https://fmoviesunblocked.net/",
        };

        if (req.headers["range"]) {
            proxyHeaders["Range"] = req.headers["range"];
        }

        const upstream = await fetch(target, {
            method: "GET",
            headers: proxyHeaders
        });

        const headers = {};
        upstream.headers.forEach((v, k) => { headers[k] = v });

        res.writeHead(upstream.status, headers);
        upstream.body.pipe(res);

    } catch (err) {
        console.error("Proxy error:", err.message);
        res.status(500).json({ error: "Proxy failed" });
    }
});


// ============================================================================
// COMIX SERVICE
// ============================================================================

const COMIX_API_URL = 'http://localhost:6987/api';

// Genre mapping
const COMIX_GENRES = {
  6: 'Action',
  87264: 'Adult',
  7: 'Adventure',
  8: 'Boys Love',
  9: 'Comedy',
  10: 'Crime',
  11: 'Drama',
  87265: 'Ecchi',
  12: 'Fantasy',
  13: 'Girls Love',
  87266: 'Hentai',
  14: 'Historical',
  15: 'Horror',
  16: 'Isekai',
  17: 'Magical Girls',
  87267: 'Mature',
  18: 'Mecha',
  19: 'Medical',
  20: 'Mystery',
  21: 'Philosophical',
  22: 'Psychological',
  23: 'Romance',
  24: 'Sci-Fi',
  25: 'Slice of Life',
  87268: 'Smut',
  26: 'Sports',
  27: 'Superhero',
  28: 'Thriller',
  29: 'Tragedy',
  30: 'Wuxia'
};

app.get('/api/comix/genres', (req, res) => {
  res.json({
    status: 'success',
    genres: COMIX_GENRES
  });
});

app.get('/api/comix/manga/all', async (req, res) => {
    try {
        const page = req.query.page || 1;
        const url = `https://comix.to/api/v2/manga?order[relevance]=desc&genres_mode=or&limit=28&page=${page}`;

        const response = await axios.get(url);
        const mangaList = response.data.result.items.map(manga => ({
            name: manga.title,
            poster: manga.poster.large,
            url: `https://comix.to/title/${manga.hash_id}-${manga.slug}`,
            manga_id: manga.manga_id,
            hash_id: manga.hash_id
        }));

        res.json({
            status: 'success',
            count: mangaList.length,
            page: parseInt(page),
            data: mangaList
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

app.get('/api/comix/manga/genre/:genreId', async (req, res) => {
    try {
        const {
            genreId
        } = req.params;
        const page = req.query.page || 1;
        const url = `https://comix.to/api/v2/manga?order[views_30d]=desc&genres[]=${genreId}&genres_mode=or&limit=28&page=${page}`;

        const response = await axios.get(url);
        const mangaList = response.data.result.items.map(manga => ({
            name: manga.title,
            poster: manga.poster.large,
            url: `https://comix.to/title/${manga.hash_id}-${manga.slug}`,
            manga_id: manga.manga_id,
            hash_id: manga.hash_id
        }));

        res.json({
            status: 'success',
            genre: COMIX_GENRES[genreId] || 'Unknown',
            count: mangaList.length,
            page: parseInt(page),
            data: mangaList
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

app.get('/api/comix/manga/search/:query', async (req, res) => {
    try {
        const {
            query
        } = req.params;
        const page = req.query.page || 1;
        const encodedQuery = encodeURIComponent(query);
        const url = `https://comix.to/api/v2/manga?order[relevance]=desc&keyword=${encodedQuery}&genres_mode=or&limit=28&page=${page}`;

        const response = await axios.get(url);
        const mangaList = response.data.result.items.map(manga => ({
            name: manga.title,
            poster: manga.poster.large,
            url: `https://comix.to/title/${manga.hash_id}-${manga.slug}`,
            manga_id: manga.manga_id,
            hash_id: manga.hash_id
        }));

        res.json({
            status: 'success',
            query: query,
            count: mangaList.length,
            page: parseInt(page),
            data: mangaList
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

app.get('/api/comix/chapters/:hashId', async (req, res) => {
    try {
        const {
            hashId
        } = req.params;
        let allChapters = [];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const url = `https://comix.to/api/v2/manga/${hashId}/chapters?limit=50&page=${page}&order[number]=desc`;
            const response = await axios.get(url);

            if (!response.data.result || !response.data.result.items || response.data.result.items.length === 0) {
                hasMore = false;
            } else {
                allChapters = allChapters.concat(response.data.result.items);
                page++;
                // Add small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        res.json({
            status: 'success',
            hash_id: hashId,
            total_chapters: allChapters.length,
            data: allChapters
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

app.get('/api/comix/manga/chapters/:hashId/:chapterId', async (req, res) => {
    try {
        const {
            hashId,
            chapterId
        } = req.params;
        console.log(`\n=== Getting chapter pages ===`);
        console.log(`Hash ID: ${hashId}`);
        console.log(`Chapter ID: ${chapterId}`);

        // Get manga info
        const mangaInfoUrl = `https://comix.to/api/v2/manga/${hashId}`;
        const mangaResponse = await axios.get(mangaInfoUrl);
        const manga = mangaResponse.data.result;
        const slug = manga.slug;
        const mangaId = manga.manga_id;

        // Get chapter info
        let allChapters = [];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const chaptersUrl = `https://comix.to/api/v2/manga/${hashId}/chapters?limit=50&page=${page}&order[number]=desc`;
            const chaptersResponse = await axios.get(chaptersUrl);

            if (!chaptersResponse.data.result || !chaptersResponse.data.result.items || chaptersResponse.data.result.items.length === 0) {
                hasMore = false;
            } else {
                allChapters = allChapters.concat(chaptersResponse.data.result.items);
                page++;
                // Add small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        let chapter = allChapters.find(ch => ch.chapter_id == chapterId);

        if (!chapter) {
            return res.status(404).json({
                status: 'error',
                message: 'Chapter not found'
            });
        }

        // Construct chapter URL
        const chapterUrl = `https://comix.to/title/${hashId}-${slug}/${chapterId}-chapter-${chapter.number}`;
        console.log(`Fetching chapter page from: ${chapterUrl}`);

        // Fetch the HTML
        const htmlResponse = await axios.get(chapterUrl);
        const html = htmlResponse.data;

        // Extract image URLs from the embedded Next.js data
        // Look for the self.__next_f data that contains the images
        const imageUrls = [];

        // Method 1: Extract from script tags containing self.__next_f
        const scriptMatches = html.match(/self\.__next_f\.push\(\[1,"([^"]+)"\]\)/g);

        if (scriptMatches) {
            scriptMatches.forEach(match => {
                // Extract the JSON string and decode it
                const jsonMatch = match.match(/self\.__next_f\.push\(\[1,"([^"]+)"\]\)/);
                if (jsonMatch && jsonMatch[1]) {
                    const decoded = jsonMatch[1]
                        .replace(/\\"/g, '"')
                        .replace(/\\n/g, '')
                        .replace(/\\\\/g, '\\');

                    // Look for image URLs in the decoded content
                    const imgMatches = decoded.match(/https:\/\/[^"]+\.webp/g);
                    if (imgMatches) {
                        imgMatches.forEach(url => {
                            if (!imageUrls.includes(url)) {
                                imageUrls.push(url);
                            }
                        });
                    }
                }
            });
        }

        // Method 2: Fallback - look for URLs in any script tag
        if (imageUrls.length === 0) {
            const $ = cheerio.load(html);
            $('script').each((i, elem) => {
                const content = $(elem).html();
                if (content) {
                    const matches = content.match(/https:\/\/[^"'\s]+\.webp/g);
                    if (matches) {
                        matches.forEach(url => {
                            if (!imageUrls.includes(url)) {
                                imageUrls.push(url);
                            }
                        });
                    }
                }
            });
        }

        console.log(`Total images found: ${imageUrls.length}`);

        res.json({
            status: 'success',
            manga_id: mangaId,
            hash_id: hashId,
            chapter_id: chapterId,
            chapter_number: chapter.number,
            chapter_name: chapter.name || `Chapter ${chapter.number}`,
            chapter_url: chapterUrl,
            total_pages: imageUrls.length,
            pages: imageUrls
        });

    } catch (error) {
        console.error(`ERROR:`, error.message);
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});


app.get("/comics/all", async (req, res) => {
    try {
        const page = Number(req.query.page) || 1;
        const pageUrl = `https://readcomicsonline.ru/latest-release?page=${page}`;

        const { data } = await axios.get(pageUrl, {
            headers: { "User-Agent": "Mozilla/5.0" }
        });

        const $ = cheerio.load(data);
        const results = [];

        const mangaItems = $(".mangalist .manga-item");

        for (const item of mangaItems) {
            const el = $(item);

            const anchor = el.find("h3.manga-heading a");
            const name = anchor.text().trim();
            const comicUrl = anchor.attr("href");

            if (!comicUrl) continue;

            const slug = comicUrl.split("/comic/")[1];

            // RAW URL — no proxy
            const poster_url = `https://readcomicsonline.ru/uploads/manga/${slug}/cover/cover_250x350.jpg`;

            results.push({ name, url: comicUrl, poster_url });
        }

        res.json({
            success: true,
            page,
            total: results.length,
            results
        });

    } catch (error) {
        console.error("ALL ERROR:", error.message);
        res.status(500).json({
            success: false,
            error: "Failed to scrape comics"
        });
    }
});


app.get("/comics/search/:query", async (req, res) => {
    try {
        const query = req.params.query;
        if (!query) {
            return res.status(400).json({ success: false, error: "Missing search query" });
        }

        const encoded = encodeURIComponent(query);
        const apiUrl = `https://readcomicsonline.ru/search?query=${encoded}`;

        const { data } = await axios.get(apiUrl, {
            headers: { "User-Agent": "Mozilla/5.0" }
        });

        const suggestions = data.suggestions || [];

        const results = suggestions.map(item => {
            const slug = item.data;
            const name = item.value;

            return {
                name,
                url: `https://readcomicsonline.ru/comic/${slug}`,
                poster_url: `https://readcomicsonline.ru/uploads/manga/${slug}/cover/cover_250x350.jpg`
            };
        });

        res.json({ success: true, total: results.length, results });

    } catch (error) {
        console.error("SEARCH ERROR:", error.message);
        res.status(500).json({ success: false, error: "Search failed" });
    }
});


/**
 * /comics/genres/:genreKey
 * Supports:
 *  - /comics/genres/34         (ID)
 *  - /comics/genres/Marvel%20Comics  (Name)
 * Supports ?page=<number> for infinite scroll
 */
app.get("/comics/genres/:genreKey", async (req, res) => {
    try {

        // FULL GENRE MAP (100% COMPLETE)
        const genreMap = {
            "One Shots & TPBs": 17,
            "Marvel Comics": 34,
            "Boom Studios": 35,
            "Dynamite": 36,
            "Rebellion": 37,
            "Dark Horse": 38,
            "IDW": 39,
            "Archie": 40,
            "Graphic India": 41,
            "Darby Pop": 42,
            "Oni Press": 43,
            "Icon Comics": 44,
            "United Plankton": 45,
            "Udon": 46,
            "Image Comics": 47,
            "Valiant": 48,
            "Vertigo": 49,
            "Devils Due": 50,
            "Aftershock Comics": 51,
            "Antartic Press": 52,
            "Action Lab": 53,
            "American Mythology": 54,
            "Zenescope": 55,
            "Top Cow": 56,
            "Hermes Press": 57,
            "451": 58,
            "Black Mask": 59,
            "Chapterhouse Comics": 60,
            "Red 5": 61,
            "Heavy Metal": 62,
            "Bongo": 63,
            "Top Shelf": 64,
            "Bubble": 65,
            "Boundless": 66,
            "Avatar Press": 67,
            "Space Goat Productions": 68,
            "BroadSword Comics": 69,
            "AAM-Markosia": 70,
            "Fantagraphics": 71,
            "Aspen": 72,
            "American Gothic Press": 73,
            "Vault": 74,
            "215 Ink": 75,
            "Abstract Studio": 76,
            "Albatross": 77,
            "ARH Comix": 78,
            "Legendary Comics": 79,
            "Monkeybrain": 80,
            "Joe Books": 81,
            "MAD": 82,
            "Comics Experience": 83,
            "Alterna Comics": 84,
            "Lion Forge": 85,
            "Benitez": 86,
            "Storm King": 87,
            "Sucker": 88,
            "Amryl Entertainment": 89,
            "Ahoy Comics": 90,
            "Mad Cave": 91,
            "Coffin Comics": 92,
            "Magnetic Press": 93,
            "Ablaze": 94,
            "Europe Comics": 95,
            "Humanoids": 96,
            "TKO": 97,
            "Soleil": 98,
            "SAF Comics": 99,
            "Scholastic": 100,
            "AWA Studios": 101,
            "Stranger Comics": 102,
            "Inverse": 103,
            "Virus": 104,
            "Black Panel Press": 105,
            "Scout Comics": 106,
            "Source Point Press": 107,
            "First Second": 108,
            "DSTLRY": 109,
            "Yen Press": 110,
            "Alien Books": 111
        };

        const genreKey = req.params.genreKey;
        const page = Number(req.query.page) || 1;

        // SUPPORT BOTH: numeric ID or genre name
        let categoryId = Number(genreKey);

        if (isNaN(categoryId)) {
            const decoded = decodeURIComponent(genreKey);
            categoryId = genreMap[decoded];
        }

        if (!categoryId) {
            return res.status(400).json({
                success: false,
                error: "Unknown genre (use ID or exact name)"
            });
        }

        // STEP 1 — Fetch advanced-search to get CSRF token + cookie
        const tokenResp = await axios.get("https://readcomicsonline.ru/advanced-search", {
            headers: {
                "User-Agent": "Mozilla/5.0",
                "Accept": "text/html"
            }
        });

        const cookies = tokenResp.headers["set-cookie"] || [];
        const cookieHeader = cookies.map(c => c.split(";")[0]).join("; ");

        const htmlPage = tokenResp.data;
        const $page = cheerio.load(htmlPage);

        let token = $page("input[name='_token']").attr("value");

        // fallback: scrape inline script
        if (!token) {
            const match = htmlPage.match(/['_"]_token['_"]\s*[:=]\s*['"]([^'"]+)['"]/);
            if (match) token = match[1];
        }

        if (!token) {
            return res.status(500).json({
                success: false,
                error: "Failed to extract CSRF token"
            });
        }

        // STEP 2 — Prepare encoded parameters
        const encodedParams = `categories%255B%255D%3D${categoryId}%26release%3D%26author%3D`;

        const formBody =
            `params=${encodedParams}` +
            `&page=${page}` +
            `&_token=${encodeURIComponent(token)}`;

        // STEP 3 — POST request to advSearchFilter
        const response = await axios.post(
            "https://readcomicsonline.ru/advSearchFilter",
            formBody,
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "X-Requested-With": "XMLHttpRequest",
                    "Origin": "https://readcomicsonline.ru",
                    "Referer": "https://readcomicsonline.ru/advanced-search",
                    "Cookie": cookieHeader,
                    "User-Agent": "Mozilla/5.0",
                    "Accept": "*/*"
                }
            }
        );

        const resultsHTML = response.data;
        const $ = cheerio.load(resultsHTML);

        const results = [];

        // PARSE RESULTS
        $(".media").each((_, el) => {
            const name = $(el).find(".media-heading a").text().trim();
            const url = $(el).find(".media-left a").attr("href");

            if (!url) return;

            const slug = url.split("/comic/")[1];

            // RAW IMAGE URL — NO PROXY
            const poster_url =
                `https://readcomicsonline.ru/uploads/manga/${slug}/cover/cover_250x350.jpg`;

            results.push({ name, url, poster_url });
        });

        return res.json({
            success: true,
            genre: genreKey,
            page,
            total: results.length,
            results
        });

    } catch (err) {
        console.log("GENRE ERROR:", err.message);
        return res.status(500).json({
            success: false,
            error: "Genre request failed"
        });
    }
});


/**
 * /comics/chapters/:slug
 * Get all chapter links for a comic
 */
app.get("/comics/chapters/:slug", async (req, res) => {
    try {
        const slug = req.params.slug;

        if (!slug) {
            return res.status(400).json({
                success: false,
                error: "Missing slug"
            });
        }

        const url = `https://readcomicsonline.ru/comic/${slug}`;

        const { data } = await axios.get(url, {
            headers: {
                "User-Agent": "Mozilla/5.0"
            }
        });

        const $ = cheerio.load(data);
        const results = [];

        $("li .chapter-title-rtl a").each((_, el) => {
            const name = $(el).text().trim();
            const chapterUrl = $(el).attr("href");

            if (!chapterUrl) return;

            // Extract the chapter number from the URL
            // Example: /comic/slug/5 → "5"
            // Example: /comic/slug/chapter-12 → "chapter-12"
            const parts = chapterUrl.split("/");
            const chapter = parts[parts.length - 1]; 

            results.push({
                name,
                url: chapterUrl,
                chapter  // <-- FIX: frontend now gets proper chapter value
            });
        });

        res.json({
            success: true,
            total: results.length,
            chapters: results
        });

    } catch (err) {
        console.log("CHAPTERS ERROR:", err.message);
        res.status(500).json({
            success: false,
            error: "Failed to fetch chapters"
        });
    }
});


app.get("/comics/pages/:slug/:chapter", async (req, res) => {
    try {
        const { slug, chapter } = req.params;

        const url = `https://readcomicsonline.ru/comic/${slug}/${chapter}`;

        const { data } = await axios.get(url, {
            headers: { "User-Agent": "Mozilla/5.0" }
        });

        const $ = cheerio.load(data);

        const results = [];
        let pageNumber = 1;

        $("#all img").each((_, el) => {
            let imgUrl = $(el).attr("data-src");
            if (!imgUrl) return;

            imgUrl = imgUrl.trim();

            results.push({
                page: pageNumber++,
                url: imgUrl // RAW URL ONLY
            });
        });

        res.json({ success: true, chapter, total: results.length, pages: results });

    } catch (err) {
        console.log("PAGES ERROR:", err.message);
        res.status(500).json({ success: false, error: "Failed to fetch pages" });
    }
});


app.get("/proxy", async (req, res) => {
    try {
        const target = req.query.url;
        if (!target) return res.status(400).send("Missing url");

        const response = await axios.get(target, {
            responseType: "arraybuffer",
            headers: {
                "Referer": "https://readcomicsonline.ru/",
                "User-Agent": "Mozilla/5.0",
                "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Connection": "keep-alive"
            }
        });

        res.setHeader("Content-Type", response.headers["content-type"]);
        res.send(response.data);

    } catch (err) {
        console.log("PROXY ERROR:", err.message);
        res.status(500).send("Proxy error");
    }
});


app.get("/comics-proxy", async (req, res) => {
    try {
        let target = req.query.url;
        if (!target) return res.status(400).send("Missing url");

        // ReadComicOnline blocks requests unless
        // Referer + User-Agent are set correctly
        const response = await axios.get(target, {
            responseType: "arraybuffer",
            headers: {
                "Referer": "https://readcomicsonline.ru/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
                "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9"
            },
            validateStatus: () => true
        });

        if (!response.data) {
            return res.status(500).json({ error: "Empty response" });
        }

        res.setHeader("Content-Type", response.headers["content-type"] || "image/jpeg");
        res.send(response.data);

    } catch (err) {
        console.log("COMICS PROXY ERROR:", err);
        res.status(500).json({ error: "Comics Proxy failed" });
    }
});


// ============================================================================
// LIBGEN SERVICE
// ============================================================================

// Search endpoint - /libgen/search/:query
app.get('/libgen/search/:query', async (req, res) => {
    try {
        const query = req.params.query;
        if (!query) {
            return res.status(400).json({ error: 'Search query is required' });
        }

        console.log(`[LIBGEN] Searching for: ${query}`);
        
        const searchUrl = `https://libgen.li/index.php?req=${encodeURIComponent(query)}&curtab=f`;
        console.log(`[LIBGEN] URL: ${searchUrl}`);
        
        const axiosInstance = createAxiosInstance();
        
        const response = await axiosInstance.get(searchUrl);
        const $ = cheerio.load(response.data);
        
        const results = [];
        
        // Parse the table rows - libgen uses different table structures
        $('table tbody tr, table tr').each((index, element) => {
            const $row = $(element);
            const $tds = $row.find('td');
            
            // Skip header rows and rows with insufficient columns
            if ($tds.length < 8) return;
            
            // Extract data from the first td (title, series, ISBN)
            const $firstTd = $tds.eq(0);
            
            // Find the title link
            const $titleLink = $firstTd.find('a[href*="edition.php"]').first();
            if (!$titleLink.length) return; // Skip if no title link
            
            const title = $titleLink.text().trim();
            if (!title) return;
            
            const editionHref = $titleLink.attr('href');
            const editionId = editionHref ? editionHref.match(/id=(\d+)/)?.[1] : null;
            if (!editionId) return;
            
            // Get series info from the bold tag
            const series = $firstTd.find('b').first().text().trim();
            
            // Get ISBN from the green font
            const isbn = $firstTd.find('font[color="green"]').text().trim();
            
            // Get file info badge
            const fileId = $firstTd.find('.badge-secondary').text().trim();
            
            // Extract other fields
            const author = $tds.eq(1).text().trim();
            const publisher = $tds.eq(2).text().trim();
            const year = $tds.eq(3).text().trim();
            const language = $tds.eq(4).text().trim();
            const pages = $tds.eq(5).text().trim();
            const size = $tds.eq(6).find('a').text().trim() || $tds.eq(6).text().trim();
            const format = $tds.eq(7).text().trim();
            
            // Get download links from the last td
            const $downloadTd = $tds.eq(8);
            const downloadLinks = [];
            $downloadTd.find('a').each((i, link) => {
                const $link = $(link);
                const href = $link.attr('href');
                const linkTitle = $link.attr('data-original-title') || $link.find('.badge').text().trim();
                if (href) {
                    downloadLinks.push({ title: linkTitle, href });
                }
            });
            
            // Only include epub files
            if (format.toLowerCase() === 'epub' && title && editionId) {
                results.push({
                    title,
                    series,
                    author,
                    publisher,
                    year,
                    language,
                    pages,
                    size,
                    format,
                    isbn,
                    editionId,
                    editionUrl: `https://libgen.li/edition.php?id=${editionId}`,
                    fileId,
                    downloadLinks
                });
            }
        });
        
        console.log(`[LIBGEN] Found ${results.length} epub results`);
        
        res.json({
            query,
            totalResults: results.length,
            results
        });
        
    } catch (error) {
        console.error('[LIBGEN] Search error:', error.message);
        res.status(500).json({
            error: 'Failed to search libgen',
            message: error.message
        });
    }
});

// Get edition details and MD5 hash - /libgen/edition/:editionId
app.get('/libgen/edition/:editionId', async (req, res) => {
    try {
        const { editionId } = req.params;
        if (!editionId) {
            return res.status(400).json({ error: 'Edition ID is required' });
        }

        console.log(`[LIBGEN] Fetching edition: ${editionId}`);
        
        const editionUrl = `https://libgen.li/edition.php?id=${editionId}`;
        const axiosInstance = createAxiosInstance();
        
        const response = await axiosInstance.get(editionUrl);
        const $ = cheerio.load(response.data);
        
        // Extract MD5 hash from the download link
        const adsLink = $('a[href^="ads.php?md5="]').first().attr('href');
        const md5 = adsLink ? adsLink.match(/md5=([a-f0-9]+)/)?.[1] : null;
        
        if (!md5) {
            return res.status(404).json({ error: 'MD5 hash not found for this edition' });
        }
        
        // Extract file info
        const fileInfo = {};
        $('table#tablelibgen tr').each((i, row) => {
            const $row = $(row);
            const $tds = $row.find('td');
            
            if ($tds.length >= 2) {
                const text = $tds.eq(1).text();
                
                // Extract size
                const sizeMatch = text.match(/Size:\s*([^\s]+\s+[^\s]+)/);
                if (sizeMatch) fileInfo.size = sizeMatch[1].trim();
                
                // Extract extension
                const extMatch = text.match(/Extension:\s*(\w+)/);
                if (extMatch) fileInfo.extension = extMatch[1].trim();
                
                // Extract pages
                const pagesMatch = text.match(/Pages:\s*(\d+)/);
                if (pagesMatch) fileInfo.pages = pagesMatch[1].trim();
            }
        });
        
        console.log(`[LIBGEN] Found MD5: ${md5}`);
        
        res.json({
            editionId,
            md5,
            adsUrl: `https://libgen.li/ads.php?md5=${md5}`,
            fileInfo
        });
        
    } catch (error) {
        console.error('[LIBGEN] Edition fetch error:', error.message);
        res.status(500).json({
            error: 'Failed to fetch edition details',
            message: error.message
        });
    }
});

// Get download link - /libgen/download/:md5
app.get('/libgen/download/:md5', async (req, res) => {
    try {
        const { md5 } = req.params;
        if (!md5) {
            return res.status(400).json({ error: 'MD5 hash is required' });
        }

        console.log(`[LIBGEN] Fetching download link for MD5: ${md5}`);
        
        const adsUrl = `https://libgen.li/ads.php?md5=${md5}`;
        const axiosInstance = createAxiosInstance();
        
        const response = await axiosInstance.get(adsUrl);
        const $ = cheerio.load(response.data);
        
        // Extract the GET link from the table
        const downloadLink = $('table#main a[href^="get.php"]').first().attr('href');
        
        if (!downloadLink) {
            return res.status(404).json({ error: 'Download link not found' });
        }
        
        const fullDownloadUrl = `https://libgen.li/${downloadLink}`;
        
        console.log(`[LIBGEN] Found download link: ${fullDownloadUrl}`);
        
        res.json({
            md5,
            downloadUrl: fullDownloadUrl
        });
        
    } catch (error) {
        console.error('[LIBGEN] Download link fetch error:', error.message);
        res.status(500).json({
            error: 'Failed to fetch download link',
            message: error.message
        });
    }
});

// ============================================================================
// ERROR HANDLERS & SERVER STARTUP
// ============================================================================





app.use((error, req, res, next) => {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

} // End of registerApiRoutes function

// ======================= MUSIC API (REWRITTEN) =======================
const qs = require('qs');
const { spawn } = require('child_process');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

// ---- CONFIG ----
const SPOTIFY_CLIENT_ID = '.';
const SPOTIFY_CLIENT_SECRET = '.';

// ---- STATE ----
let spotifyToken = '';
let tokenExpiration = 0;
// Path to yt-dlp binary; will be set in initMusicDeps
let ytDlpPath = null;

// ---- CACHE ----
const urlCache = new Map();
const URL_CACHE_DURATION = 5 * 60 * 1000;
const videoIdCache = new Map(); // Cache video IDs from YouTube Music API

// Store download progress: downloadId -> { progress, filePath, complete, error, proc }
const downloadProgress = new Map();

// ---- SEEDS ----
const SEED_ARTISTS = [
  '06HL4z0CvFAxyc27GXpf02','3TVXtAsR1Inumwj472S9r4','1Xyo4u8uXC1ZmMpatF05PJ',
  '66CXWjxzNUsdJxJ2JdwvnR','4q3ewBCX7sLwd24euuV69X','0EmeFodog0BfCgMzAIvKQp',
  '53XhwfbYqKCa1cC15pYq2q','6eUKZXaKkcviH0Ku9w2n3V','7dGJo4pcD2V6oG8kP0tJRR',
  '3Nrfpe0tUJi4K4DXYWgMUX'
];
const SEED_TRACKS = [
  '11dFghVXANMlKmJXsNCbNl','0VjIjW4GlUZAMYd2vXMi3b','6UelLqGlWMcVH1E5c4H7lY',
  '3n3Ppam7vgaVa1iaRUc9Lp','5ChkMS8OtdzJeqyybCc9R5'
];

// ---- HELPERS ----
const formatDuration = (ms) => {
  if (!ms || isNaN(ms)) return '0:00';
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${min}:${sec.toString().padStart(2, '0')}`;
};

/**
 * Call Deezer API (no auth required)
 * Uses Cloudflare Worker proxy for worldwide access
 * @param {string} url
 * @returns {Promise<any>}
 */
async function callDeezerApi(url) {
  try {
    // Use Cloudflare Worker proxy to bypass geo-restrictions
    const proxyUrl = `https://deezer-proxy.aymanisthedude1.workers.dev/?url=${encodeURIComponent(url)}`;
    const response = await axios.get(proxyUrl, { timeout: 10000 });
    return response.data;
  } catch (err) {
    const message = (err && err.response && err.response.statusText) || err.message || 'Unknown Deezer error';
    throw new Error('Deezer API error: ' + message);
  }
}

/**
 * Format a Deezer track object into the common track structure.
 * Deezer durations are provided in seconds so convert to ms.
 * @param {object} track
 * @returns {object|null}
 */
function formatDeezerTrack(track) {
  if (!track) return null;
  const durationMs = typeof track.duration === 'number' ? track.duration * 1000 : 0;
  return {
    id: track.id,
    title: track.title,
    name: track.title,
    artists: track.artist?.name || 'Unknown Artist',
    channel: track.artist?.name || 'Unknown Artist',
    duration: formatDuration(durationMs),
    albumArt: track.album?.cover_big || track.album?.cover_xl || track.album?.cover || '',
    thumbnail: track.album?.cover_medium || track.album?.cover || '',
    url: track.link || ''
  };
}

/**
 * Format a Deezer album object into the common album structure.
 * @param {object} album
 * @returns {object|null}
 */
function formatDeezerAlbum(album) {
  if (!album) return null;
  return {
    id: album.id,
    name: album.title,
    artists: album.artist?.name || 'Unknown Artist',
    albumArt: album.cover_big || album.cover_xl || album.cover || '',
    releaseDate: album.release_date || '',
    totalTracks: album.nb_tracks || 0,
    url: album.link || ''
  };
}

async function refreshSpotifyToken() {
  if (Date.now() < tokenExpiration - 60000 && spotifyToken) return;
  const response = await axios.post(
    'https://accounts.spotify.com/api/token',
    qs.stringify({ grant_type: 'client_credentials' }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization:
          'Basic ' +
          Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')
      }
    }
  );
  spotifyToken = response.data.access_token;
  tokenExpiration = Date.now() + response.data.expires_in * 1000;
}

async function callSpotifyApi(url) {
  await refreshSpotifyToken();
  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${spotifyToken}` },
    timeout: 10000
  });
  return response.data;
}

function formatTrack(track) {
  if (!track) return null;
  return {
    id: track.id,
    title: track.name,
    name: track.name,
    artists: track.artists?.map(a => a.name).join(', ') || 'Unknown Artist',
    channel: track.artists?.map(a => a.name).join(', ') || 'Unknown Artist',
    duration: formatDuration(track.duration_ms),
    albumArt: track.album?.images?.[0]?.url || '',
    thumbnail: track.album?.images?.[0]?.url || '',
    url: track.external_urls?.spotify || ''
  };
}

function formatAlbum(album) {
  if (!album) return null;
  return {
    id: album.id,
    name: album.name,
    artists: album.artists?.map(a => a.name).join(', ') || 'Unknown Artist',
    albumArt: album.images?.[0]?.url || '',
    releaseDate: album.release_date || '',
    totalTracks: album.total_tracks || 0,
    url: album.external_urls?.spotify || ''
  };
}

// Run yt-dlp with given arguments and return stdout string
function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ytDlpPath, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `yt-dlp exited with code ${code}`));
      }
    });
    proc.on('error', (err) => {
      reject(err);
    });
  });
}

async function getYouTubeAudioUrl(ytMusicSearchQuery, ytDlpSearchQuery, trackId) {
  // Ensure yt-dlp binary is located
  try {
    initMusicDeps();
  } catch (_) {
    // ignore init errors; will be handled when spawning
  }

  // DON'T use cached URLs - always extract fresh
  console.log('[Music] Extracting fresh URL for:', ytMusicSearchQuery);

  // Use ytsearch with official audio/topic keywords - EXACTLY like the working app
  const searchQuery = ytDlpSearchQuery;
  
  // EXACT args from the working app
  const args = [
    searchQuery,
    '--no-check-certificates',
    '--no-warnings',
    '--prefer-free-formats',
    '--extractor-args', 'youtube:player-client=android,web_embedded,web',
    '-J'  // Get JSON output to extract URL and headers
  ];

  console.log('[Music] Running yt-dlp with args:', args.join(' '));
  const output = await runYtDlp(args);
  
  let videoData;
  try {
    const info = JSON.parse(output);
    // Handle playlist entries if search returned a playlist
    videoData = info._type === 'playlist' ? info.entries[0] : info;
  } catch (e) {
    throw new Error('Failed to parse yt-dlp output');
  }

  if (!videoData) {
    throw new Error('No video data found');
  }

  // Find best audio format - EXACTLY like the working app
  let selectedFormat = null;
  if (videoData.formats) {
    // Prefer audio-only formats
    const audioFormats = videoData.formats.filter(f => 
      f.acodec && f.acodec !== 'none' && 
      (!f.vcodec || f.vcodec === 'none') &&
      f.url
    );
    
    if (audioFormats.length > 0) {
      audioFormats.sort((a, b) => (b.abr || 0) - (a.abr || 0));
      selectedFormat = audioFormats[0];
    } else {
      const withAudio = videoData.formats.filter(f => 
        f.acodec && f.acodec !== 'none' && f.url
      );
      if (withAudio.length > 0) {
        withAudio.sort((a, b) => (b.abr || 0) - (a.abr || 0));
        selectedFormat = withAudio[0];
      }
    }
  }

  if (!selectedFormat && videoData.url) {
    selectedFormat = { url: videoData.url, http_headers: videoData.http_headers };
  }

  if (!selectedFormat) {
    throw new Error('Could not extract audio URL');
  }

  console.log('[Music] Stream URL extracted');
  
  return {
    url: selectedFormat.url,
    headers: selectedFormat.http_headers || videoData.http_headers || {}
  };
}

// Sanitize file names for downloads
function sanitizeFileName(name) {
  return name.replace(/[<>:"/\\|?*]+/g, '').trim();
}

// ---- INIT ----
function initMusicDeps() {
  if (ytDlpPath) return;
  const platform = process.platform;
  const folderName = platform === 'win32' ? 'yt' : (platform === 'darwin' ? 'macyt' : 'linyt');
  // Candidate base directories: resourcesPath, app.asar.unpacked, cwd, __dirname
  const baseCandidates = [];
  if (process.resourcesPath) {
    baseCandidates.push(path.join(process.resourcesPath));
    baseCandidates.push(path.join(process.resourcesPath, 'app.asar.unpacked'));
  }
  baseCandidates.push(process.cwd());
  baseCandidates.push(__dirname);
  const binNames = [];
  if (platform === 'win32') {
    binNames.push('yt-dlp.exe');
    binNames.push('yt-dlp_windows.exe');
  } else if (platform === 'darwin') {
    binNames.push('yt-dlp_macos');
    binNames.push('yt-dlp');
  } else {
    binNames.push('yt-dlp_linux');
    binNames.push('yt-dlp');
  }
  for (const base of baseCandidates) {
    for (const bin of binNames) {
      const candidate = path.join(base, folderName, bin);
      try {
        if (fs.existsSync(candidate)) {
          ytDlpPath = candidate;
          console.log('[Music] yt-dlp binary located at:', ytDlpPath);
          return;
        }
      } catch (_) {
        // ignore errors
      }
    }
  }
  // Fallback to /yt for backwards compatibility
  const fallbackFolder = path.join(process.cwd(), 'yt');
  const fallbackNames = ['yt-dlp.exe','yt-dlp','youtube-dl.exe','yt-dlp_windows.exe'];
  for (const bin of fallbackNames) {
    const candidate = path.join(fallbackFolder, bin);
    if (fs.existsSync(candidate)) {
      ytDlpPath = candidate;
      console.log('[Music] yt-dlp binary located at:', ytDlpPath);
      return;
    }
  }
  console.error('[Music] ERROR: yt-dlp binary not found in expected locations. Music features may not work.');
}

// ---- ROUTES ----
function registerMusicApi(app) {
  // Tracks: recommendations using Deezer charts
  app.get('/api/tracks', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit || '20', 10), 50);
      const data = await callDeezerApi(`https://api.deezer.com/chart/0/tracks?limit=${limit}`);
      const items = Array.isArray(data?.data) ? data.data : Array.isArray(data?.tracks?.data) ? data.tracks.data : [];
      const tracks = items.map(formatDeezerTrack).filter(Boolean);
      res.json({ success: true, tracks });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Search for tracks or albums via Deezer
  app.get('/api/search', async (req, res) => {
    try {
      const q = req.query.q;
      const limit = Math.min(parseInt(req.query.limit || '20', 10), 50);
      const type = String(req.query.type || 'track');
      if (!q) {
        return res.status(400).json({ success: false, error: 'Missing query' });
      }
      if (type === 'album') {
        const data = await callDeezerApi(`https://api.deezer.com/search/album?q=${encodeURIComponent(q)}&limit=${limit}`);
        const items = Array.isArray(data?.data) ? data.data : [];
        const results = items.map(formatDeezerAlbum).filter(Boolean);
        return res.json({ success: true, results });
      }
      // default to track search
      const data = await callDeezerApi(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=${limit}`);
      const items = Array.isArray(data?.data) ? data.data : [];
      const results = items.map(formatDeezerTrack).filter(Boolean);
      return res.json({ success: true, results });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Albums listing using Deezer charts
  app.get('/api/albums', async (_req, res) => {
    try {
      const data = await callDeezerApi('https://api.deezer.com/chart/0/albums?limit=20');
      const items = Array.isArray(data?.data) ? data.data : Array.isArray(data?.albums?.data) ? data.albums.data : [];
      const albums = items.map(formatDeezerAlbum).filter(Boolean);
      res.json({ success: true, albums });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Tracks in album via Deezer
  app.get('/api/album/:albumId/tracks', async (req, res) => {
    try {
      const albumId = req.params.albumId;
      const album = await callDeezerApi(`https://api.deezer.com/album/${albumId}`);
      const tracksData = await callDeezerApi(`https://api.deezer.com/album/${albumId}/tracks`);
      const items = Array.isArray(tracksData?.data) ? tracksData.data : [];
      const tracks = items.map((t) => {
        const formatted = formatDeezerTrack(t);
        if (album && formatted) {
          formatted.albumArt = album.cover_big || album.cover_xl || album.cover || formatted.albumArt;
        }
        return formatted;
      }).filter(Boolean);
      res.json({ success: true, album: formatDeezerAlbum(album), tracks });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Provide proxy stream URL (for convenience)
  app.get('/api/stream-url', (req, res) => {
    res.json({ success: true, streamUrl: `/api/proxy-stream?trackId=${req.query.trackId}` });
  });

  // Get direct stream URL (FAST - no proxy overhead)
  app.get('/api/direct-stream-url', async (req, res) => {
    try {
      const trackId = req.query.trackId;
      
      if (!trackId) return res.status(400).json({ error: 'Missing trackId' });
      
      // Get track details to construct search query using Deezer
      let title = '';
      let artistName = '';
      try {
        const trackInfo = await callDeezerApi(`https://api.deezer.com/track/${trackId}`);
        title = trackInfo?.title || '';
        artistName = trackInfo?.artist?.name || '';
      } catch (err) {
        return res.status(400).json({ error: 'Invalid track ID' });
      }
      
      if (!title) {
        return res.status(400).json({ error: 'Invalid track ID' });
      }
      
      // ALWAYS return proxy-stream URL - it handles YouTube properly
      const proxyUrl = `http://localhost:6987/api/proxy-stream?trackId=${encodeURIComponent(trackId)}`;
      
      // Return the proxied URL
      res.json({ 
        success: true, 
        streamUrl: proxyUrl,
        title: title,
        artist: artistName
      });
    } catch (err) {
      console.error('[Music] Direct stream URL error:', err);
      res.status(500).json({ error: 'Failed to get stream URL: ' + err.message });
    }
  });

  // Generic YouTube/yt-dlp URL proxy - fixes 403 errors by proxying with proper headers
  app.get('/api/ytdlp-proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Missing url parameter');
    
    try {
      const https = require('https');
      const http = require('http');
      const { URL } = require('url');
      
      const parsedUrl = new URL(targetUrl);
      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? https : http;
      
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.youtube.com/',
          'Origin': 'https://www.youtube.com',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'identity'
        }
      };
      
      // Forward range header if present
      if (req.headers.range) {
        options.headers['Range'] = req.headers.range;
      }
      
      const proxyReq = client.request(options, (proxyRes) => {
        // Handle redirects
        if (proxyRes.statusCode === 301 || proxyRes.statusCode === 302 || proxyRes.statusCode === 307 || proxyRes.statusCode === 308) {
          const redirectUrl = proxyRes.headers.location;
          if (redirectUrl) {
            return res.redirect(`/api/ytdlp-proxy?url=${encodeURIComponent(redirectUrl)}`);
          }
        }
        
        // Handle errors
        if (proxyRes.statusCode === 403 || proxyRes.statusCode === 404) {
          console.error('[YT Proxy] Error:', proxyRes.statusCode, targetUrl);
          return res.status(proxyRes.statusCode).send(`YouTube returned ${proxyRes.statusCode}`);
        }
        
        // Forward response headers
        res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'video/mp4');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Connection', 'keep-alive');
        
        if (proxyRes.headers['content-length']) {
          res.setHeader('Content-Length', proxyRes.headers['content-length']);
        }
        
        if (proxyRes.headers['content-range']) {
          res.setHeader('Content-Range', proxyRes.headers['content-range']);
          res.status(206);
        } else {
          res.status(proxyRes.statusCode || 200);
        }
        
        // Pipe the stream with proper error handling
        proxyRes.pipe(res, { end: true });
        
        proxyRes.on('error', (err) => {
          console.error('[YT Proxy] Stream error:', err.message);
          if (!res.headersSent) {
            res.status(500).send('Stream error');
          } else {
            res.end();
          }
        });
        
        proxyRes.on('end', () => {
          console.log('[YT Proxy] Stream completed successfully');
        });
      });
      
      proxyReq.on('error', (err) => {
        console.error('[YT Proxy] Request error:', err.message);
        if (!res.headersSent) {
          res.status(500).send('Proxy error: ' + err.message);
        }
      });
      
      req.on('close', () => {
        proxyReq.destroy();
      });
      
      proxyReq.end();
      
    } catch (err) {
      console.error('[YT Proxy] Error:', err.message);
      if (!res.headersSent) {
        res.status(500).send('Proxy error: ' + err.message);
      }
    }
  });

  // Stream audio via yt-dlp; supports Range requests - EXACTLY like the working app
  app.get('/api/proxy-stream', async (req, res) => {
    const trackId = req.query.trackId;
    if (!trackId) return res.status(400).send('Missing trackId');
    
    let attempt = 0;
    const maxAttempts = 2;
    
    while (attempt < maxAttempts) {
      try {
        // Get track details to construct search query using Deezer
        let title = '';
        let artistName = '';
        try {
          const trackInfo = await callDeezerApi(`https://api.deezer.com/track/${trackId}`);
          title = trackInfo?.title || '';
          artistName = trackInfo?.artist?.name || '';
        } catch (err) {
          return res.status(400).send('Invalid track ID');
        }
        
        if (!title) {
          return res.status(400).send('Invalid track ID');
        }
        
        // Construct search queries
        const ytMusicSearchQuery = `${title} ${artistName}`;
        const ytDlpSearchQuery = `ytsearch1:${title} ${artistName} official audio topic`;
        
        console.log(`[Proxy] Attempt ${attempt + 1}: "${title}" by "${artistName}"`);
        
        // Get URL and headers (always fresh)
        const { url: streamUrl, headers: ytHeaders } = await getYouTubeAudioUrl(ytMusicSearchQuery, ytDlpSearchQuery, trackId);
        
        const headers = {
          ...ytHeaders,
          'User-Agent': ytHeaders['User-Agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        };
        
        // Delete problematic headers - EXACTLY like the working app
        delete headers['Host'];
        delete headers['Content-Length'];
        
        if (req.headers.range) {
          headers['Range'] = req.headers.range;
          console.log('[Proxy] Range request:', req.headers.range);
        }
        
        const response = await axios({
          method: 'GET',
          url: streamUrl,
          headers: headers,
          responseType: 'stream',
          timeout: 0, // No timeout - let the stream run as long as needed
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          maxRedirects: 5,
          decompress: false, // Don't decompress, let the client handle it
          httpAgent: new (require('http').Agent)({ keepAlive: true, keepAliveMsecs: 30000 }),
          httpsAgent: new (require('https').Agent)({ keepAlive: true, keepAliveMsecs: 30000 }),
          validateStatus: (status) => status === 200 || status === 206 || status === 416
        });
        
        // If 416, URL likely expired - retry
        if (response.status === 416) {
          console.warn('[Proxy] 416 Range Not Satisfiable - retrying');
          attempt++;
          if (attempt >= maxAttempts) {
            throw new Error('Range not satisfiable after retry');
          }
          continue;
        }
        
        // Success - stream the response
        res.setHeader('Content-Type', response.headers['content-type'] || 'audio/webm');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        if (response.headers['content-length']) {
          res.setHeader('Content-Length', response.headers['content-length']);
          console.log('[Proxy] Total content length:', response.headers['content-length'], 'bytes');
        }
        
        if (response.headers['content-range']) {
          res.setHeader('Content-Range', response.headers['content-range']);
          res.status(206);
          console.log('[Proxy] Serving partial:', response.headers['content-range']);
        } else {
          res.status(200);
          console.log('[Proxy] Serving full stream');
        }
        
        // Track bytes transferred for debugging
        let bytesTransferred = 0;
        response.data.on('data', (chunk) => {
          bytesTransferred += chunk.length;
        });
        
        // Pipe with error handling
        response.data.pipe(res, { end: true });
        
        response.data.on('error', (err) => {
          console.error('[Proxy] Stream error after', bytesTransferred, 'bytes:', err.message);
          if (!res.headersSent) {
            res.status(500).send('Stream error');
          } else {
            res.end();
          }
        });
        
        // Clean up on client disconnect
        req.on('close', () => {
          console.log('[Proxy] Client disconnected after', bytesTransferred, 'bytes');
          if (response.data && !response.data.destroyed) {
            response.data.destroy();
          }
        });
        
        // Handle response end
        response.data.on('end', () => {
          console.log('[Proxy] Stream completed successfully -', bytesTransferred, 'bytes transferred');
        });
        
        return; // Success
        
      } catch (err) {
        console.error(`[Proxy] Attempt ${attempt + 1} failed:`, err.message);
        if (err.response) {
          console.error(`[Proxy] Status: ${err.response.status}`);
        }
        
        attempt++;
        if (attempt >= maxAttempts) {
          console.error('[Proxy] All attempts failed');
          if (!res.headersSent) {
            res.status(500).send('Failed to stream: ' + err.message);
          }
          return;
        }
      }
    }
  });

  // Download MP3
  app.post('/api/music/download', async (req, res) => {
    try {
      const { trackId, songName, artistName, downloadId, cover } = req.body || {};
      if (!trackId || !downloadId) {
        return res.status(400).json({ error: 'Missing trackId or downloadId' });
      }
      // Ensure binary path ready
      initMusicDeps();
      // Determine downloads directory
      let downloadsDir;
      try {
        const electronApp = require('electron').app;
        if (electronApp && typeof electronApp.getPath === 'function') {
          downloadsDir = path.join(electronApp.getPath('userData'), 'music_downloads');
        } else {
          const home = os.homedir();
          downloadsDir = path.join(home, '.playtorrio', 'music_downloads');
        }
      } catch (_) {
        const home = os.homedir();
        downloadsDir = path.join(home, '.playtorrio', 'music_downloads');
      }
      fs.mkdirSync(downloadsDir, { recursive: true });
      // Build sanitized file name
      const cleanName = sanitizeFileName(`${songName || ''} - ${artistName || ''}`.trim() || trackId);
      let filePath = path.join(downloadsDir, `${cleanName}.mp3`);
      let suffix = 1;
      while (fs.existsSync(filePath)) {
        filePath = path.join(downloadsDir, `${cleanName} (${suffix}).mp3`);
        suffix++;
      }
      // Get track info for search (optional) using Deezer
      let title = songName;
      let artists = artistName;
      try {
        const trackInfo = await callDeezerApi(`https://api.deezer.com/track/${trackId}`);
        if (!title) title = trackInfo?.title || '';
        if (!artists) artists = trackInfo?.artist?.name || '';
      } catch (_) {
        // ignore if fails
      }
      // Construct a YouTube search query for the download. Do not append
      // additional qualifiers such as "official audio" so that the search
      // results remain broad; downloads were working correctly before and
      // should continue to do so.
      const searchQuery = `ytsearch1:${title || trackId} ${artists || ''}`;
      // Initialize progress entry
      downloadProgress.delete(downloadId);
      downloadProgress.set(downloadId, { progress: 0, filePath: null, complete: false, proc: null });
      // Spawn yt-dlp to download audio as mp3
      const args = [
        searchQuery,
        '--no-playlist',
        '-x',
        '--audio-format','mp3',
        '--audio-quality','0',
        '-o', filePath,
        '--no-check-certificate',
        '--no-warnings',
        '--prefer-free-formats'
      ];
      const proc = spawn(ytDlpPath, args, { windowsHide: true });
      downloadProgress.get(downloadId).proc = proc;
      proc.stderr.on('data', (data) => {
        const line = data.toString();
        const match = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
        if (match) {
          const pct = parseFloat(match[1]);
          const entry = downloadProgress.get(downloadId);
          if (entry) {
            entry.progress = pct;
          }
        }
      });
      proc.on('close', (code) => {
        const entry = downloadProgress.get(downloadId);
        if (!entry) return;
        if (code === 0) {
          entry.progress = 100;
          entry.complete = true;
          entry.filePath = filePath;
        } else {
          entry.error = true;
        }
      });
      proc.on('error', () => {
        const entry = downloadProgress.get(downloadId);
        if (entry) {
          entry.error = true;
        }
      });
      return res.json({ success: true, downloadId, filePath });
    } catch (err) {
      console.error('[Download] Error:', err.message);
      res.status(500).json({ error: err.message || 'Download failed' });
    }
  });

  // Download progress
  app.get('/api/music/download/progress/:id', (req, res) => {
    const id = req.params.id;
    const entry = downloadProgress.get(id);
    if (!entry) {
      return res.json({ progress: 0, complete: false });
    }
    return res.json({
      progress: entry.progress || 0,
      filePath: entry.filePath || null,
      complete: !!entry.complete,
      error: !!entry.error
    });
  });

  // Cancel download
  app.post('/api/music/download/cancel', (req, res) => {
    const { downloadId } = req.body || {};
    const entry = downloadProgress.get(downloadId);
    if (entry && entry.proc) {
      try {
        entry.proc.kill('SIGKILL');
      } catch (_) {}
      downloadProgress.delete(downloadId);
    }
    return res.json({ success: true });
  });

  // Delete downloaded file
  app.post('/api/music/delete', (req, res) => {
    const { filePath } = req.body || {};
    if (!filePath) {
      return res.status(400).json({ error: 'Missing filePath' });
    }
    try {
      fs.unlinkSync(filePath);
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Delete failed' });
    }
  });

  // Serve downloaded file with Range support
  app.get('/api/music/serve/:encodedPath', (req, res) => {
    let filePath;
    try {
      filePath = decodeURIComponent(req.params.encodedPath);
    } catch (_) {
      filePath = req.params.encodedPath;
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('File not found');
    }
    const stat = fs.statSync(filePath);
    const total = stat.size;
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
      const chunkSize = (end - start) + 1;
      const stream = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'audio/mpeg'
      });
      stream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': total,
        'Content-Type': 'audio/mpeg',
        'Accept-Ranges': 'bytes'
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });

  // Batch existence check (supports POST and GET)
  app.all('/api/music/exists-batch', (req, res) => {
    let filePaths = [];
    if (req.method === 'POST' && req.body) {
      if (Array.isArray(req.body.filePaths)) {
        filePaths = req.body.filePaths;
      } else if (Array.isArray(req.body.paths)) {
        filePaths = req.body.paths;
      } else if (typeof req.body.filePaths === 'string') {
        filePaths = [req.body.filePaths];
      }
    }
    if (filePaths.length === 0) {
      const { paths } = req.query;
      if (paths) {
        filePaths = Array.isArray(paths) ? paths : String(paths).split(',');
      }
    }
    const results = {};
    filePaths.forEach((p) => {
      const decoded = decodeURIComponent(p);
      try {
        results[p] = fs.existsSync(decoded);
      } catch (_) {
        results[p] = false;
      }
    });
    return res.json({ results });
  });

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({
      success: true,
      ffmpegPath: ffmpegInstaller.path,
      ytDlpLoaded: !!ytDlpPath,
      cacheSize: urlCache.size
    });
  });
}
// ======================= END MUSIC API =======================


process.on('unhandledRejection', (reason) => {
    try {
        const msg = reason && reason.stack ? reason.stack : String(reason);
        console.error('Unhandled Rejection:', msg);
    } finally {
        process.exit(1);
    }
});

process.on('uncaughtException', (err) => {
    try {
        console.error('Uncaught Exception:', err && err.stack ? err.stack : err);
    } finally {
        process.exit(1);
    }
});




// Export the function to register routes instead of starting a server
module.exports = {
  registerApiRoutes,
  registerMusicApi,
  initMusicDeps
};