import * as cheerio from 'cheerio';
import fetch from 'node-fetch';

const BASE_URL = 'https://uindex.org';

export async function searchUIndex(query) {
  try {
    // c=0 means all categories
    const searchUrl = `${BASE_URL}/search.php?search=${encodeURIComponent(query)}&c=0`;
    
    console.log(`UIndex: Fetching ${searchUrl}`);
    
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (response.status !== 200) {
      console.log(`UIndex: Returned status ${response.status}`);
      return [];
    }
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    const results = [];
    
    // Find all torrent rows
    $('table tr').each((_, elem) => {
      const $row = $(elem);
      
      // Skip header rows
      if ($row.find('th').length > 0) return;
      
      // Get all td cells
      const $cells = $row.find('td');
      if ($cells.length < 5) return;
      
      // Structure: [category], [title with magnet], [size], [seeders], [leechers]
      
      // Get magnet link from the second cell
      const $titleCell = $cells.eq(1);
      const magnetLink = $titleCell.find('a[href^="magnet:"]').attr('href');
      
      // Get title - it's the text of the second link in the cell
      const title = $titleCell.find('a[href*="/details.php"]').text().trim();
      
      // Get size from third cell
      const size = $cells.eq(2).text().trim() || 'Unknown';
      
      // Get seeders from fourth cell (green span)
      const seeders = $cells.eq(3).find('span.g').text().trim() || $cells.eq(3).text().trim() || 'Unknown';
      
      if (title && magnetLink) {
        results.push({
          name: title,
          magnet: magnetLink,
          seeders: seeders.replace(/,/g, ''), // Remove commas from numbers
          size: size,
          source: 'UIndex'
        });
      }
    });

    console.log(`UIndex found ${results.length} results`);
    return results;
  } catch (error) {
    console.error('UIndex scraper error:', error);
    return [];
  }
}
