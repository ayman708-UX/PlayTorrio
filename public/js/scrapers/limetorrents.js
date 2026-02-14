import * as cheerio from 'cheerio';
import fetch from 'node-fetch';

const BASE_URL = 'https://www.limetorrents.fun';

export async function searchLimeTorrents(query) {
  try {
    // Replace spaces with %20 for URL encoding
    const encodedQuery = encodeURIComponent(query);
    const searchUrl = `${BASE_URL}/search/all/${encodedQuery}/`;
    
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const html = await response.text();
    const $ = cheerio.load(html);

    const torrentPromises = [];
    
    // Find all torrent rows
    $('table.table2 tr').each((i, elem) => {
      const $row = $(elem);
      
      // Skip header row
      if ($row.find('th').length > 0) return;
      
      // Get title and URL
      const $titleLink = $row.find('.tt-name a[href*="-torrent-"]');
      const title = $titleLink.text().trim();
      const torrentPath = $titleLink.attr('href');
      
      // Get seeders
      const seeders = $row.find('.tdseed').text().trim().replace(/,/g, '') || 'Unknown';
      
      if (title && torrentPath) {
        // Fetch each torrent page to get magnet
        torrentPromises.push(
          fetchTorrentMagnet(BASE_URL + torrentPath, title, seeders)
        );
      }
    });

    // Limit to first 50 to avoid overwhelming
    const limitedPromises = torrentPromises.slice(0, 50);
    const results = await Promise.allSettled(limitedPromises);
    
    const validResults = results
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value);

    console.log(`LimeTorrents found ${validResults.length} results`);
    return validResults;
  } catch (error) {
    console.error('LimeTorrents scraper error:', error);
    return [];
  }
}

async function fetchTorrentMagnet(url, title, seeders) {
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
    
    // Get size from torrent info table - look for "Torrent Size:"
    let size = 'Unknown';
    $('.torrentinfo table tr').each((_, row) => {
      const $row = $(row);
      const $cells = $row.find('td');
      if ($cells.length >= 2) {
        const label = $cells.eq(0).text().trim();
        if (label === 'Torrent Size:') {
          size = $cells.eq(1).text().trim();
        }
      }
    });
    
    if (magnetLink) {
      return {
        name: title,
        magnet: magnetLink,
        seeders: seeders,
        size: size,
        source: 'LimeTorrents'
      };
    }
    
    return null;
  } catch (error) {
    console.error(`Error fetching torrent ${url}:`, error.message);
    return null;
  }
}
