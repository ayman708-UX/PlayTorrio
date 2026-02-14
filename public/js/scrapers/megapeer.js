import * as cheerio from 'cheerio';
import fetch from 'node-fetch';

const BASE_URL = 'https://megapeer.vip';

export async function searchMegapeer(query) {
  try {
    // Replace spaces with + for URL
    const encodedQuery = query.replace(/\s+/g, '+');
    const searchUrl = `${BASE_URL}/browse.php?search=${encodedQuery}`;
    
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const html = await response.text();
    const $ = cheerio.load(html);

    const torrentPromises = [];
    
    // Find all torrent rows
    $('tr.table_fon').each((i, elem) => {
      const $row = $(elem);
      
      // Get title and URL
      const $titleLink = $row.find('a.url');
      const title = $titleLink.text().trim();
      const torrentPath = $titleLink.attr('href');
      
      // Get size - it's in the td with align="right"
      const size = $row.find('td[align="right"]').text().trim() || 'Unknown';
      
      // Get seeders (green font after seed.gif)
      const seedersText = $row.find('img[src="/pic/seed.gif"]').next('font').text().trim();
      const seeders = seedersText || 'Unknown';
      
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

    console.log(`Megapeer found ${validResults.length} results`);
    return validResults;
  } catch (error) {
    console.error('Megapeer scraper error:', error);
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
        source: 'Megapeer'
      };
    }
    
    return null;
  } catch (error) {
    console.error(`Error fetching torrent ${url}:`, error.message);
    return null;
  }
}
