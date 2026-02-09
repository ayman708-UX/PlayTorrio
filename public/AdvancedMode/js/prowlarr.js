// Basic Mode Prowlarr Logic - Following Jackett pattern

import { filterTorrents } from './torrent_filter.js';

// Base URL for main application API
const API_BASE = '/api';

export const getProwlarrKey = async () => {
    try {
        const response = await fetch(`${API_BASE}/get-prowlarr-api-key`);
        const data = await response.json();
        return data.apiKey || '';
    } catch (e) {
        console.error("Failed to fetch Prowlarr key from server", e);
        return localStorage.getItem('prowlarr_api_key') || '';
    }
};

export const setProwlarrKey = async (key) => {
    try {
        const response = await fetch(`${API_BASE}/set-prowlarr-api-key`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey: key })
        });
        const data = await response.json();
        if (data.success) {
            localStorage.setItem('prowlarr_api_key', key);
            return true;
        }
        return false;
    } catch (e) {
        console.error("Failed to save Prowlarr key to server", e);
        localStorage.setItem('prowlarr_api_key', key);
        return true;
    }
};

export const getProwlarrSettings = async () => {
    try {
        const response = await fetch(`${API_BASE}/settings`);
        if (response.ok) {
            return await response.json();
        }
    } catch (e) {
        console.error("Failed to fetch settings from server", e);
    }
    return {};
};

const fetchFromProwlarr = async (query) => {
    const apiKey = await getProwlarrKey();
    const settings = await getProwlarrSettings();
    const prowlarrUrl = settings.prowlarrUrl || 'http://127.0.0.1:9696';
    
    if (!apiKey) return [];

    // Use the proxy we added to server.mjs
    const url = new URL(`${window.location.origin}/api/prowlarr`);
    url.searchParams.append('apikey', apiKey);
    url.searchParams.append('q', query);
    url.searchParams.append('prowlarrUrl', prowlarrUrl);
    
    console.log(`[Prowlarr] Searching with URL: ${prowlarrUrl}`);
    
    try {
        const response = await fetch(url.toString());
        if (!response.ok) throw new Error(`Prowlarr API Error: ${response.status}`);
        
        const results = await response.json();
        
        // Prowlarr returns JSON array directly
        return results.map(item => {
            return {
                Title: item.title,
                Guid: item.guid,
                Link: item.downloadUrl || item.magnetUrl,
                PublishDate: item.publishDate,
                Size: item.size,
                Description: item.title,
                Category: item.categories?.join(', ') || 'Unknown',
                Tracker: item.indexer || 'Unknown',
                MagnetUri: item.magnetUrl || (item.downloadUrl?.startsWith('magnet:') ? item.downloadUrl : null),
                Seeders: parseInt(item.seeders) || 0,
                Peers: parseInt(item.leechers) || 0,
            };
        });
    } catch (error) {
        console.error('Prowlarr Fetch Failed:', error);
        // Throw a specific error so the UI can detect it
        throw new Error('PROWLARR_CONNECTION_ERROR');
    }
};

export const searchProwlarr = async (queries, metadata = {}) => {
    const queryList = Array.isArray(queries) ? queries : [queries];
    const results = await Promise.all(queryList.map(q => fetchFromProwlarr(q)));
    
    const seen = new Set();
    const merged = [];
    
    results.flat().forEach(item => {
        const id = item.Guid || item.MagnetUri || item.Link;
        if (id && !seen.has(id)) {
            seen.add(id);
            merged.push(item);
        }
    });

    return filterTorrents(merged, metadata);
};
