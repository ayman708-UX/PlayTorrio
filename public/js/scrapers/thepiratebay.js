import * as cheerio from 'cheerio';
import fetch from 'node-fetch';

const BASE_URL = 'https://1.piratebays.to';
const MAX_PAGES = 10;

export async function searchThePirateBay(query) {
  try {
    const allResults = [];
    
    // Fetch up to 10 pages
    for (let page = 1; page <= MAX_PAGES; page++) {
      const pageUrl = page === 1 
        ? `${BASE_URL}/s/?q=${encodeURIComponent(query)}&video=on&category=0`
        : `${BASE_URL}/s/page/${page}/?q=${encodeURIComponent(query)}&video=on&category=0`;
      
      console.log(`ThePirateBay: Fetching page ${page} - ${pageUrl}`);
      
      const response = await fetch(pageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      if (response.status !== 200) {
        console.log(`ThePirateBay: Page ${page} returned status ${response.status}, stopping`);
        break;
      }
      
      const html = await response.text();
      const $ = cheerio.load(html);
      
      let pageResults = 0;
      
      // Find all torrent rows
      $('table tr').each((_, elem) => {
        const $row = $(elem);
        
        // Skip header rows
        if ($row.find('th').length > 0) return;
        
        // Get title
        const $titleLink = $row.find('a.detLink');
        const title = $titleLink.text().trim();
        
        // Get magnet link
        const magnetLink = $row.find('a[href^="magnet:"]').attr('href');
        
        if (!title || !magnetLink) return;
        
        // Get all td cells
        const $cells = $row.find('td');
        
        // Structure: [category], [title], [date], [magnet], [size], [seeders], [leechers], [uploader]
        // Size is in td with align="right" (index 4)
        const size = $cells.eq(4).text().trim() || 'Unknown';
        
        // Seeders is in td with align="right" (index 5)
        const seeders = $cells.eq(5).text().trim() || 'Unknown';
        
        allResults.push({
          name: title,
          magnet: magnetLink,
          seeders: seeders,
          size: size,
          source: 'ThePirateBay'
        });
        
        pageResults++;
      });
      
      console.log(`ThePirateBay: Page ${page} found ${pageResults} results`);
      
      // If no results on this page, stop fetching
      if (pageResults === 0) {
        console.log(`ThePirateBay: No results on page ${page}, stopping`);
        break;
      }
    }

    console.log(`ThePirateBay found ${allResults.length} total results`);
    return allResults;
  } catch (error) {
    console.error('ThePirateBay scraper error:', error);
    return [];
  }
}
