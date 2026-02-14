import * as cheerio from 'cheerio';
import fetch from 'node-fetch';

const BASE_URL = 'https://knaben.org';

export async function searchKnaben(query) {
  try {
    const encodedQuery = encodeURIComponent(query);
    const searchUrl = `${BASE_URL}/search/${encodedQuery}/0/1/seeders`;
    
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const html = await response.text();
    const $ = cheerio.load(html);

    const results = [];
    
    // Find all torrent rows
    $('tbody tr').each((i, elem) => {
      const $row = $(elem);
      
      // Get title and magnet from the link
      const $titleLink = $row.find('td.text-wrap a[href^="magnet:"]').first();
      const title = $titleLink.attr('title') || $titleLink.text().trim();
      const magnetLink = $titleLink.attr('href');
      
      // Get all cells - structure is: [checkbox/icon], [title with magnet], [size], [date], [seeders], [leechers], [source]
      const $cells = $row.find('td');
      
      // Size is the td right after the text-wrap td (usually index 2)
      let size = 'Unknown';
      const $titleCell = $row.find('td.text-wrap');
      const $sizeCell = $titleCell.next('td');
      if ($sizeCell.length) {
        size = $sizeCell.text().trim();
      }
      
      // Seeders is typically 3rd from end
      const seeders = $cells.eq($cells.length - 3).text().trim() || 'Unknown';
      
      if (title && magnetLink) {
        results.push({
          name: title,
          magnet: magnetLink,
          seeders: seeders,
          size: size || 'Unknown',
          source: 'Knaben'
        });
      }
    });

    console.log(`Knaben found ${results.length} results`);
    return results;
  } catch (error) {
    console.error('Knaben scraper error:', error);
    return [];
  }
}
