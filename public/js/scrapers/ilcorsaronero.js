import * as cheerio from 'cheerio';
import fetch from 'node-fetch';

const BASE_URL = 'https://ilcorsaronero.link';

export async function searchIlCorsaroNero(query) {
  try {
    const encodedQuery = encodeURIComponent(query);
    const searchUrl = `${BASE_URL}/search?q=${encodedQuery}&sort=seeders&order=desc`;
    
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const html = await response.text();
    const $ = cheerio.load(html);

    const torrentPromises = [];
    
    // Find all torrent rows
    $('tbody tr').each((i, elem) => {
      const $row = $(elem);
      
      // Get title and URL
      const $titleLink = $row.find('th a.hover\\:underline');
      const title = $titleLink.text().trim();
      const torrentPath = $titleLink.attr('href');
      
      // Get seeders (green text)
      const seeders = $row.find('td.text-green-500').text().trim() || 'Unknown';
      
      // Get size - it's in the 5th td with tabular-nums class
      const $cells = $row.find('td');
      const size = $cells.eq(4).text().trim() || 'Unknown';
      
      if (title && torrentPath) {
        // Fetch each torrent page to get magnet
        torrentPromises.push(
          fetchTorrentMagnet(BASE_URL + torrentPath, title, seeders, size)
        );
      }
    });

    // Limit to first 50 to avoid overwhelming
    const limitedPromises = torrentPromises.slice(0, 50);
    const results = await Promise.allSettled(limitedPromises);
    
    const validResults = results
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value);

    console.log(`IlCorsaroNero found ${validResults.length} results`);
    return validResults;
  } catch (error) {
    console.error('IlCorsaroNero scraper error:', error);
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
        source: 'IlCorsaroNero'
      };
    }
    
    return null;
  } catch (error) {
    console.error(`Error fetching torrent ${url}:`, error.message);
    return null;
  }
}
