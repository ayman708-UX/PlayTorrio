import * as cheerio from 'cheerio';
import fetch from 'node-fetch';

const BASE_URL = 'https://torrentgalaxy.one';
const MAX_PAGES = 3;

export async function searchTorrentGalaxy(query) {
  try {
    const allResults = [];
    
    // Fetch up to 3 pages
    for (let page = 1; page <= MAX_PAGES; page++) {
      const pageUrl = page === 1
        ? `${BASE_URL}/get-posts/keywords:${encodeURIComponent(query)}`
        : `${BASE_URL}/get-posts/keywords:${encodeURIComponent(query)}?page=${page}`;
      
      console.log(`TorrentGalaxy: Fetching page ${page}`);
      
      const response = await fetch(pageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      if (response.status !== 200) {
        console.log(`TorrentGalaxy: Page ${page} returned status ${response.status}, stopping`);
        break;
      }
      
      const html = await response.text();
      const $ = cheerio.load(html);
      
      const torrentPromises = [];
      
      // Find all torrent rows
      $('div.tgxtablerow').each((_, elem) => {
        const $row = $(elem);
        
        // Get title and detail URL
        const $titleLink = $row.find('div.tgxtablecell a[href*="/post-detail/"]').first();
        const title = $titleLink.find('b').text().trim() || $titleLink.attr('title');
        const detailPath = $titleLink.attr('href');
        
        // Get size - look for badge with size
        let size = 'Unknown';
        $row.find('span.badge').each((_, badge) => {
          const text = $(badge).text().trim();
          if (text.match(/\d+(\.\d+)?\s*(GB|MB|GiB|MiB|KB|KiB)/i)) {
            size = text;
          }
        });
        
        // Get seeders - green font in Seeders/Leechers span
        let seeders = 'Unknown';
        $row.find('span[title="Seeders/Leechers"]').each((_, span) => {
          const html = $(span).html();
          const match = html.match(/<font\s+color="green"><b>(\d+)<\/b><\/font>/);
          if (match) {
            seeders = match[1];
          }
        });
        
        if (title && detailPath) {
          // Fetch each detail page to get magnet
          torrentPromises.push(
            fetchTorrentMagnet(BASE_URL + detailPath, title, seeders, size)
          );
        }
      });
      
      console.log(`TorrentGalaxy: Page ${page} found ${torrentPromises.length} torrents to fetch`);
      
      // If no results on this page, stop fetching
      if (torrentPromises.length === 0) {
        console.log(`TorrentGalaxy: No results on page ${page}, stopping`);
        break;
      }
      
      // Fetch magnets for this page
      const results = await Promise.allSettled(torrentPromises);
      const validResults = results
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => r.value);
      
      allResults.push(...validResults);
    }

    console.log(`TorrentGalaxy found ${allResults.length} total results`);
    return allResults;
  } catch (error) {
    console.error('TorrentGalaxy scraper error:', error);
    return [];
  }
}

async function fetchTorrentMagnet(url, title, seeders, size) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    // Find magnet link
    const magnetLink = $('a[href^="magnet:"]').attr('href');
    
    if (magnetLink) {
      return {
        name: title,
        magnet: magnetLink,
        seeders: seeders,
        size: size,
        source: 'TorrentGalaxy'
      };
    }
    
    return null;
  } catch (error) {
    console.error(`Error fetching torrent ${url}:`, error.message);
    return null;
  }
}
