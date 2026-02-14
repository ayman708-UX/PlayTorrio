import * as cheerio from 'cheerio';
import fetch from 'node-fetch';

const BASE_URL = 'https://www.elitetorrent.wf';

export async function searchEliteTorrent(query) {
  try {
    const searchUrl = `${BASE_URL}/?s=${encodeURIComponent(query)}&x=0&y=0`;
    const response = await fetch(searchUrl);
    const html = await response.text();
    const $ = cheerio.load(html);

    const results = [];
    const promises = [];

    // Parse search results
    $('ul.miniboxs li').each((i, elem) => {
      const $elem = $(elem);
      const link = $elem.find('a.nombre').attr('href');
      const title = $elem.find('a.nombre').attr('title') || $elem.find('a.nombre').text().trim();
      const size = $elem.find('.voto1 .dig1').text().trim();
      const quality = $elem.find('.marca.estreno i').last().text().trim();
      const image = $elem.find('img.brighten').attr('data-src');

      if (link && title) {
        // Fetch details for each result
        promises.push(
          fetchTorrentDetails(link, title, size, quality, image)
        );
      }
    });

    const detailsResults = await Promise.allSettled(promises);
    
    detailsResults.forEach(result => {
      if (result.status === 'fulfilled' && result.value) {
        results.push(result.value);
      }
    });

    return results;
  } catch (error) {
    console.error('EliteTorrent scraper error:', error);
    return [];
  }
}

async function fetchTorrentDetails(url, title, sizeFromSearch, quality, image) {
  try {
    const response = await fetch(url);
    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract magnet link
    const magnetLink = $('a[href^="magnet:"]').attr('href');
    const torrentLink = $('a.enlace_torrent[href$=".torrent"]').attr('href');

    if (!magnetLink && !torrentLink) {
      return null;
    }

    // Try to get size from detail page - look for "Tamaño:" in the HTML
    let size = sizeFromSearch;
    
    // Method 1: Look in p.descrip for the size
    const descripText = $('p.descrip').html() || '';
    const sizeMatch = descripText.match(/<b>Tamaño:<\/b>\s*([^<]+)/i);
    if (sizeMatch) {
      size = sizeMatch[1].trim();
    }

    return {
      name: title,
      magnet: magnetLink || null,
      seeders: 'Unknown',
      size: size || 'Unknown',
      source: 'EliteTorrent'
    };
  } catch (error) {
    console.error(`Error fetching details for ${url}:`, error.message);
    return null;
  }
}
