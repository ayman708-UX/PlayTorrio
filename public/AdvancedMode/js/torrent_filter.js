// Helper to parse quality from title
const parseQuality = (title) => {
    const t = title.toLowerCase();
    if (t.includes('2160p') || t.includes('4k')) return '4K';
    if (t.includes('1080p')) return '1080p';
    if (t.includes('720p')) return '720p';
    if (t.includes('480p')) return '480p';
    return 'Unknown';
};

// Helper to parse codec
const parseCodec = (title) => {
    const t = title.toLowerCase();
    if (t.includes('x265') || t.includes('hevc')) return 'HEVC';
    if (t.includes('x264') || t.includes('avc')) return 'x264';
    if (t.includes('av1')) return 'AV1';
    return 'h264';
};

// Helper to parse HDR info
const parseHDR = (title) => {
    const t = title.toLowerCase();
    if (t.includes('dv') || t.includes('dolby vision')) return 'Dolby Vision';
    if (t.includes('hdr10+')) return 'HDR10+';
    if (t.includes('hdr')) return 'HDR';
    return null;
};

export function normalizeTitle(title) {
    if (!title) return '';
    return title.toLowerCase()
        .replace(/['":.!?,_+\-\[\]\(\)]/g, ' ') 
        .replace(/\s+/g, ' ')                  
        .trim();
}

export function parseSceneInfo(title) {
    const t = title.toLowerCase();
    
    let season = null;
    let episode = null;
    let isMultiEpisode = false;
    let isSeasonPack = false;
    let isMultiSeason = false;
    let matchIndex = -1;

    if (/s(\d+)\s*-\s*s?(\d+)/i.test(t) || /season\s*\d+\s*-\s*\d+/i.test(t) || /complete\s+series/i.test(t) || /collection/i.test(t) || /anthology/i.test(t)) {
        isMultiSeason = true;
    }

    const multiSxE = /s(\d{1,2})[ ._-]*e(\d{1,3})[ ._-]*-[ ._-]*e?(\d{1,3})/i;
    const multiX = /(\d{1,2})x(\d{1,3})[ ._-]*-[ ._-]*x?(\d{1,3})/i;

    if (multiSxE.test(t) || multiX.test(t)) {
        isMultiEpisode = true;
    }
    
    const sXe = /s(\d{1,2})[ ._-]*e(\d{1,3})/i;
    const x = /\b(\d{1,2})x(\d{1,3})\b/i;
    const written = /season\s*(\d{1,2})\s*episode\s*(\d{1,3})/i;

    let match = t.match(sXe);
    if (match) {
        season = parseInt(match[1], 10);
        episode = parseInt(match[2], 10);
        matchIndex = match.index;
    } else {
        match = t.match(x);
        if (match) {
            season = parseInt(match[1], 10);
            episode = parseInt(match[2], 10);
            matchIndex = match.index;
        } else {
            match = t.match(written);
            if (match) {
                season = parseInt(match[1], 10);
                episode = parseInt(match[2], 10);
                matchIndex = match.index;
            }
        }
    }

    if (season === null) {
        const sOnly = /\bs(\d{1,2})\b/i;
        const sWritten = /season\s*(\d{1,2})\b/i;
        
        let sMatch = t.match(sOnly);
        if (sMatch) {
            season = parseInt(sMatch[1], 10);
            isSeasonPack = true;
            matchIndex = sMatch.index;
        } else {
            sMatch = t.match(sWritten);
            if (sMatch) {
                season = parseInt(sMatch[1], 10);
                isSeasonPack = true;
                matchIndex = sMatch.index;
            }
        }
    }

    if (t.includes('complete') || t.includes('season pack') || t.includes('batch')) {
        if (season !== null && episode === null) isSeasonPack = true;
        if (season !== null && episode !== null) isMultiEpisode = true; 
    }
    
    if (season !== null && episode === null && !isSeasonPack) {
         isSeasonPack = true;
    }

    return { season, episode, isSeasonPack, isMultiEpisode, isMultiSeason, matchIndex };
}

export const filterTorrents = (torrents, metadata) => {
    if (!torrents || !Array.isArray(torrents)) return [];

    const { title: showTitle, type, season: requiredSeason, episode: requiredEpisode, year } = metadata;
    
    if (!showTitle) return torrents;

    const normShowTitle = normalizeTitle(showTitle);
    
    const filtered = torrents.filter(item => {
        if (item.Seeders === 0) return false;

        let cleanTitle = item.Title.replace(/^\[[^\]]+\]\s*/, '');
        const info = parseSceneInfo(cleanTitle); 
        
        // 1. Title matching logic
        if (info.matchIndex > -1) {
            const titlePart = cleanTitle.substring(0, info.matchIndex);
            const normTitlePart = normalizeTitle(titlePart);
            if (!normTitlePart.startsWith(normShowTitle)) return false;
            const suffix = normTitlePart.substring(normShowTitle.length).trim();
            if (suffix.length > 0) return false;
        } else {
             const normItemTitle = normalizeTitle(cleanTitle);
             if (!normItemTitle.startsWith(normShowTitle)) return false;
        }

        // 2. Type specific filtering
        if (type === 'tv') {
            if (requiredSeason && requiredEpisode) {
                const reqS = parseInt(requiredSeason, 10);
                const reqE = parseInt(requiredEpisode, 10);
                
                // Matches exact episode
                if (info.season === reqS && info.episode === reqE && !info.isMultiEpisode && !info.isMultiSeason && !info.isSeasonPack) {
                    return true;
                }
                
                // Matches season pack for the required season
                if (info.season === reqS && info.isSeasonPack && !info.isMultiSeason) {
                    return true;
                }

                return false;
            }
            
            if (requiredSeason && !requiredEpisode) {
                const reqS = parseInt(requiredSeason, 10);
                
                // If only season is required, we want ONLY season packs for that season
                if (info.season !== reqS) return false;
                if (info.isMultiSeason) return false;
                if (info.episode !== null) return false;
                
                return info.isSeasonPack || (info.season !== null && info.episode === null);
            }
        } else {
            // Movie filtering
            if (year) {
                const t = item.Title.toLowerCase();
                if (!t.includes(year)) return false;
            }
        }
        
        return true;
    });

    return filtered.map(t => ({
        id: t.Guid || t.Link,
        title: t.Title,
        size: t.Size ? (t.Size / 1024 / 1024 / 1024).toFixed(2) + ' GB' : 'N/A',
        sizeBytes: parseInt(t.Size) || 0,
        seeders: t.Seeders,
        peers: t.Peers,
        publishDate: t.PublishDate,
        indexer: t.Tracker,
        link: t.Link,
        magnet: t.MagnetUri,
        quality: parseQuality(t.Title),
        codec: parseCodec(t.Title),
        hdr: parseHDR(t.Title)
    })).sort((a, b) => b.seeders - a.seeders);
};