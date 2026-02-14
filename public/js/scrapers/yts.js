import * as cheerio from 'cheerio';
import fetch from 'node-fetch';

const BASE_URL = 'https://yts.bz';

export async function searchYTS(query) {
  try {
    const searchUrl = `${BASE_URL}/browse-movies/${encodeURIComponent(query)}/all/all/0/latest/0/all`;
    
    console.log(`YTS: Fetching ${searchUrl}`);
    
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (response.status !== 200) {
      console.log(`YTS: Returned status ${response.status}`);
      return [];
    }
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    const moviePromises = [];
    
    // Find all movie cards
    $('div.browse-movie-wrap').each((_, elem) => {
      const $card = $(elem);
      
      // Get movie URL
      const movieUrl = $card.find('a.browse-movie-link').attr('href');
      
      if (movieUrl) {
        moviePromises.push(fetchMovieTorrents(movieUrl));
      }
    });
    
    console.log(`YTS: Found ${moviePromises.length} movies to fetch`);
    
    // Fetch all movie detail pages
    const results = await Promise.allSettled(moviePromises);
    const allTorrents = [];
    
    results.forEach(result => {
      if (result.status === 'fulfilled' && result.value) {
        allTorrents.push(...result.value);
      }
    });

    console.log(`YTS found ${allTorrents.length} total results`);
    return allTorrents;
  } catch (error) {
    console.error('YTS scraper error:', error);
    return [];
  }
}

async function fetchMovieTorrents(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    // Extract movie name from URL (e.g., "superman-2025" from "/movies/superman-2025")
    const urlParts = url.split('/');
    const movieSlug = urlParts[urlParts.length - 1];
    
    const torrents = [];
    
    // Find all torrent options in the modal
    $('.modal-torrent').each((_, elem) => {
      const $torrent = $(elem);
      
      // Get quality (720p, 1080p, 2160p, etc.)
      const quality = $torrent.find('.modal-quality span').text().trim();
      
      // Get type (BluRay, WEB, etc.)
      let type = $torrent.find('p.quality-size').first().text().trim();
      
      // Get size
      const size = $torrent.find('p.quality-size').eq(1).text().trim() || 'Unknown';
      
      // Get magnet link
      const magnetLink = $torrent.find('a.magnet-download[href^="magnet:"]').attr('href');
      
      if (magnetLink && quality) {
        // Construct name: "movie-slug yts quality type"
        const name = `${movieSlug} yts ${quality} ${type}`.trim();
        
        torrents.push({
          name: name,
          magnet: magnetLink,
          seeders: 'Unknown',
          size: size,
          source: 'YTS'
        });
      }
    });
    
    return torrents;
  } catch (error) {
    console.error(`Error fetching movie ${url}:`, error.message);
    return [];
  }
}
