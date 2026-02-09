const BASE_URL = '/api/tmdb';
export const IMAGE_BASE_URL = 'https://image.tmdb.org/t/p';

export const getImageUrl = (path, size = 'w500') => {
  if (!path) return 'https://via.placeholder.com/500x750/1a1a2e/ffffff?text=No+Image';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${IMAGE_BASE_URL}/${size}${path}`;
};

export const fetchFromTMDB = async (endpoint, params = {}) => {
  const url = new URL(`${window.location.origin}${BASE_URL}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, value);
  });

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`TMDB API Error: ${response.status}`);
  }
  return response.json();
};

export const getPopularMovies = () => fetchFromTMDB('/movie/popular');
export const getTrendingMovies = () => fetchFromTMDB('/trending/movie/week');
export const getTopRatedMovies = () => fetchFromTMDB('/movie/top_rated');
export const getPopularTVShows = () => fetchFromTMDB('/tv/popular');
export const getTrendingTVShows = () => fetchFromTMDB('/trending/tv/week');
export const getTopRatedTVShows = () => fetchFromTMDB('/tv/top_rated');

export const getMovieDetails = (id) => 
  fetchFromTMDB(`/movie/${id}`, { append_to_response: 'credits' });

export const getTVShowDetails = (id) => 
  fetchFromTMDB(`/tv/${id}`, { append_to_response: 'credits' });

export const getExternalIds = (id, type) =>
  fetchFromTMDB(`/${type}/${id}/external_ids`);

export const getMovieImages = (id) =>
  fetchFromTMDB(`/movie/${id}/images`);

export const getTVShowImages = (id) =>
  fetchFromTMDB(`/tv/${id}/images`);

export const getEpisodeImages = (tvId, seasonNumber, episodeNumber) =>
  fetchFromTMDB(`/tv/${tvId}/season/${seasonNumber}/episode/${episodeNumber}/images`);

export const getMovieVideos = (id) =>
  fetchFromTMDB(`/movie/${id}/videos`);

export const getTVShowVideos = (id) =>
  fetchFromTMDB(`/tv/${id}/videos`);

export const getSeasonEpisodes = (tvId, seasonNumber) =>
  fetchFromTMDB(`/tv/${tvId}/season/${seasonNumber}`);

export const searchMulti = (query) => 
  fetchFromTMDB('/search/multi', { query, include_adult: false });

export const getDiscover = (type, params = {}) => 
  fetchFromTMDB(`/discover/${type}`, { include_adult: false, sort_by: 'popularity.desc', ...params });

export const getPersonDetails = (id) => 
  fetchFromTMDB(`/person/${id}`);

export const getPersonCredits = (id) => 
  fetchFromTMDB(`/person/${id}/combined_credits`);

export const getGenresList = async () => {
  const [movieGenres, tvGenres] = await Promise.all([
    fetchFromTMDB('/genre/movie/list'),
    fetchFromTMDB('/genre/tv/list')
  ]);
  
  // Merge and dedup by ID
  const map = new Map();
  movieGenres.genres.forEach(g => map.set(g.id, g));
  tvGenres.genres.forEach(g => map.set(g.id, g));
  
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
};

// Find TMDB ID from external ID (like IMDB)
export const findByExternalId = (externalId, externalSource = 'imdb_id') => 
  fetchFromTMDB(`/find/${externalId}`, { external_source: externalSource });
