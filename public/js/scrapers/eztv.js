import * as cheerio from 'cheerio';
import fetch from 'node-fetch';

const BASE_URL = 'https://eztvx.to';

export async function searchEZTV(query) {
  try {
    const cleanQuery = query.toLowerCase().replace(/\s+/g, '-');
    const searchUrl = `${BASE_URL}/search/${cleanQuery}`;
    
    // POST to show magnet links
    const response = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': searchUrl
      },
      body: 'layout=def_wlinks',
      redirect: 'follow'
    });
    
    const html = await response.text();
    const $ = cheerio.load(html);

    const results = [];

    $('tr[name="hover"]').each((i, elem) => {
      const $row = $(elem);
      
      const title = $row.find('a.epinfo').text().trim();
      const magnetLink = $row.find('a.magnet').attr('href');
      const $cells = $row.find('td');
      const seeders = $row.find('td').last().find('font[color="green"]').text().trim() || 'Unknown';
      // Size is in the 4th td (index 3)
      const size = $cells.eq(3).text().trim() || 'Unknown';

      if (title && magnetLink) {
        results.push({
          name: title,
          magnet: magnetLink,
          seeders: seeders,
          size: size,
          source: 'EZTV'
        });
      }
    });

    console.log(`EZTV found ${results.length} results`);
    return results;
  } catch (error) {
    console.error('EZTV scraper error:', error);
    return [];
  }
}
