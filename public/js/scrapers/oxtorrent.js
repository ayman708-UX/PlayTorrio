import * as cheerio from 'cheerio';
import fetch from 'node-fetch';

const BASE_URL = 'https://www.oxtorrent.co';

export async function searchOxTorrent(query) {
  try {
    // Step 1: POST to search_torrent which redirects
    const searchUrl = `${BASE_URL}/search_torrent`;
    
    console.log(`OxTorrent: POSTing to ${searchUrl}`);
    
    const response = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `torrentSearch=${encodeURIComponent(query)}`,
      redirect: 'follow'
    });
    
    const html = await response.text();
    const $ = cheerio.load(html);

    console.log(`OxTorrent: Final URL ${response.url}, Status ${response.status}`);
    
    const torrentPromises = [];
    
    // Find all torrent rows in the table
    $('table.table-hover tbody tr').each((_, elem) => {
      const $row = $(elem);
      
      // Get title and URL
      const $titleLink = $row.find('a[href*="/torrent/"]');
      const title = $titleLink.text().trim();
      const torrentPath = $titleLink.attr('href');
      
      // Get size
      const size = $row.find('td').eq(1).text().trim();
      
      // Get seeders
      const seeders = $row.find('td').eq(2).text().trim() || 'Unknown';
      
      if (title && torrentPath) {
        // Fetch each torrent page to get magnet
        torrentPromises.push(
          fetchTorrentMagnet(BASE_URL + torrentPath, title, seeders, size)
        );
      }
    });

    console.log(`OxTorrent: Found ${torrentPromises.length} torrents to fetch`);

    // Limit to first 50 to avoid overwhelming
    const limitedPromises = torrentPromises.slice(0, 50);
    const results = await Promise.allSettled(limitedPromises);
    
    const validResults = results
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value);

    console.log(`OxTorrent found ${validResults.length} results`);
    return validResults;
  } catch (error) {
    console.error('OxTorrent scraper error:', error);
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
    
    // Find magnet link in the download section
    const magnetLink = $('.btn-magnet a[href^="magnet:"]').attr('href');
    
    if (magnetLink) {
      return {
        name: title,
        magnet: magnetLink,
        seeders: seeders,
        size: size,
        source: 'OxTorrent'
      };
    }
    
    return null;
  } catch (error) {
    console.error(`Error fetching torrent ${url}:`, error.message);
    return null;
  }
}
