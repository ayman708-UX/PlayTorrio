    // ============================================================================
    // ULTIMATE TORRENT SEARCH - Aggregates results from 12 sources
    // ============================================================================
    app.get('/api/ultimate', async (req, res) => {
        const { query } = req.query;
        
        if (!query) {
            return res.status(400).json({ error: 'Query parameter is required' });
        }

        try {
            // Dynamically import all scrapers
            const scraperModules = await Promise.all([
                import('./public/js/scrapers/elitetorrent.js'),
                import('./public/js/scrapers/eztv.js'),
                import('./public/js/scrapers/ilcorsaronero.js'),
                import('./public/js/scrapers/knaben.js'),
                import('./public/js/scrapers/limetorrents.js'),
                import('./public/js/scrapers/megapeer.js'),
                import('./public/js/scrapers/oxtorrent.js'),
                import('./public/js/scrapers/thepiratebay.js'),
                import('./public/js/scrapers/therarbg.js'),
                import('./public/js/scrapers/torrentgalaxy.js'),
                import('./public/js/scrapers/uindex.js'),
                import('./public/js/scrapers/yts.js')
            ]);

            const results = await Promise.allSettled([
                scraperModules[0].searchEliteTorrent(query),
                scraperModules[1].searchEZTV(query),
                scraperModules[2].searchIlCorsaroNero(query),
                scraperModules[3].searchKnaben(query),
                scraperModules[4].searchLimeTorrents(query),
                scraperModules[5].searchMegapeer(query),
                scraperModules[6].searchOxTorrent(query),
                scraperModules[7].searchThePirateBay(query),
                scraperModules[8].searchTheRARBG(query),
                scraperModules[9].searchTorrentGalaxy(query),
                scraperModules[10].searchUIndex(query),
                scraperModules[11].searchYTS(query)
            ]);

            const aggregated = [];
            
            results.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    aggregated.push(...result.value);
                } else {
                    console.error(`Ultimate scraper ${index} failed:`, result.reason);
                }
            });

            // Remove duplicates based on magnet link (infohash)
            const seen = new Set();
            const unique = aggregated.filter(torrent => {
                // Extract infohash from magnet link
                const match = torrent.magnet.match(/btih:([a-fA-F0-9]+)/i);
                if (match) {
                    const infohash = match[1].toUpperCase();
                    if (seen.has(infohash)) {
                        return false;
                    }
                    seen.add(infohash);
                    return true;
                }
                return true; // Keep if we can't extract infohash
            });

            // Sort by seeders (highest to lowest)
            // Convert seeders to numbers, treating "Unknown" as -1
            unique.sort((a, b) => {
                const seedersA = a.seeders === 'Unknown' ? -1 : parseInt(a.seeders.replace(/,/g, '')) || -1;
                const seedersB = b.seeders === 'Unknown' ? -1 : parseInt(b.seeders.replace(/,/g, '')) || -1;
                return seedersB - seedersA;
            });

            res.json({
                query,
                totalResults: unique.length,
                results: unique
            });
        } catch (error) {
            console.error('[Ultimate Search] Error:', error);
            res.status(500).json({ error: error.message });
        }
    });
