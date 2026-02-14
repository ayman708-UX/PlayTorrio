import * as cheerio from 'cheerio';
import fetch from 'node-fetch';

const BASE_URL = 'https://therarbg.to';
const MAX_PAGES = 3;

export async function searchTheRARBG(query) {
  try {
    const allResults = [];
    
    // Search both Movies and TV categories
    const categories = ['Movies', 'TV'];
    
    for (const category of categories) {
      console.log(`TheRARBG: Searching ${category} category`);
      
      // Fetch up to 10 pages for each category
      for (let page = 1; page <= MAX_PAGES; page++) {
        const pageUrl = page === 1
          ? `${BASE_URL}/get-posts/category:${category}:keywords:${encodeURIComponent(query)}/`
          : `${BASE_URL}/get-posts/category:${category}:keywords:${encodeURIComponent(query)}/?page=${page}`;
        
        console.log(`TheRARBG: Fetching ${category} page ${page}`);
        
        const response = await fetch(pageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        
        if (response.status !== 200) {
          console.log(`TheRARBG: ${category} page ${page} returned status ${response.status}, stopping`);
          break;
        }
        
        const html = await response.text();
        const $ = cheerio.load(html);
        
        const torrentPromises = [];
        
        // Find all torrent rows
        $('tr.list-entry').each((_, elem) => {
          const $row = $(elem);
          
          // Get title and detail URL
          const $titleLink = $row.find('td.cellName a').first();
          const title = $titleLink.text().trim();
          const detailPath = $titleLink.attr('href');
          
          // Get size
          const size = $row.find('td.sizeCell').text().trim() || 'Unknown';
          
          // Get seeders (green color td)
          const seeders = $row.find('td[style*="color: green"]').text().trim() || 'Unknown';
          
          if (title && detailPath) {
            // Fetch each detail page to get magnet
            torrentPromises.push(
              fetchTorrentMagnet(BASE_URL + detailPath, title, seeders, size)
            );
          }
        });
        
        console.log(`TheRARBG: ${category} page ${page} found ${torrentPromises.length} torrents to fetch`);
        
        // If no results on this page, stop fetching this category
        if (torrentPromises.length === 0) {
          console.log(`TheRARBG: No results on ${category} page ${page}, stopping category`);
          break;
        }
        
        // Fetch magnets for this page
        const results = await Promise.allSettled(torrentPromises);
        const validResults = results
          .filter(r => r.status === 'fulfilled' && r.value)
          .map(r => r.value);
        
        allResults.push(...validResults);
      }
    }

    console.log(`TheRARBG found ${allResults.length} total results`);
    return allResults;
  } catch (error) {
    console.error('TheRARBG scraper error:', error);
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
    const magnetLink = $('a.magnet-btn[href^="magnet:"]').attr('href');
    
    if (magnetLink) {
      return {
        name: title,
        magnet: magnetLink,
        seeders: seeders,
        size: size,
        source: 'TheRARBG'
      };
    }
    
    return null;
  } catch (error) {
    console.error(`Error fetching torrent ${url}:`, error.message);
    return null;
  }
}
