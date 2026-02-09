// Basic Mode Jackett Logic - Synchronized with Main App

import { filterTorrents } from './torrent_filter.js';

// Base URL for main application API
const API_BASE = '/api';

export const getJackettKey = async () => {
    try {
        const response = await fetch(`${API_BASE}/get-api-key`);
        const data = await response.json();
        return data.apiKey || '';
    } catch (e) {
        console.error("Failed to fetch Jackett key from server", e);
        return localStorage.getItem('jackett_api_key') || '';
    }
};

export const setJackettKey = async (key) => {
    try {
        const response = await fetch(`${API_BASE}/set-api-key`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey: key })
        });
        const data = await response.json();
        if (data.success) {
            localStorage.setItem('jackett_api_key', key);
            return true;
        }
        return false;
    } catch (e) {
        console.error("Failed to save Jackett key to server", e);
        localStorage.setItem('jackett_api_key', key);
        return true;
    }
};

export const getJackettSettings = async () => {
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

const fetchFromJackett = async (query) => {
    const apiKey = await getJackettKey();
    const settings = await getJackettSettings();
    const jackettUrl = settings.jackettUrl || 'http://127.0.0.1:9117/api/v2.0/indexers/all/results/torznab';
    
    if (!apiKey) return [];

    // Use the proxy we added to server.mjs, passing the custom Jackett URL
    const url = new URL(`${window.location.origin}/api/jackett`);
    url.searchParams.append('apikey', apiKey);
    url.searchParams.append('t', 'search');
    url.searchParams.append('q', query);
    url.searchParams.append('jackettUrl', jackettUrl);
    
    console.log(`[Jackett] Searching with URL: ${jackettUrl}`);
    
    try {
        const response = await fetch(url.toString());
        if (!response.ok) throw new Error(`Jackett API Error: ${response.status}`);
        
        const xmlText = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "text/xml");
        
        return Array.from(xmlDoc.querySelectorAll('item')).map(item => {
            const torznabAttrs = {};
            const attrs = item.getElementsByTagName('torznab:attr');
            for (let i = 0; i < attrs.length; i++) {
                const name = attrs[i].getAttribute('name');
                const value = attrs[i].getAttribute('value');
                if (name) torznabAttrs[name] = value;
            }

            if (Object.keys(torznabAttrs).length === 0) {
                item.querySelectorAll('attr').forEach(attr => {
                    torznabAttrs[attr.getAttribute('name')] = attr.getAttribute('value');
                });
            }

            const title = item.querySelector('title')?.textContent;
            let link = item.querySelector('link')?.textContent;
            let magnet = torznabAttrs['magneturl'] || null;

            if (!magnet && link && link.startsWith('magnet:')) {
                magnet = link;
            }

            return {
                Title: title,
                Guid: item.querySelector('guid')?.textContent,
                Link: link,
                Comments: item.querySelector('comments')?.textContent,
                PublishDate: item.querySelector('pubDate')?.textContent,
                Size: item.querySelector('size')?.textContent || item.querySelector('enclosure')?.getAttribute('length'),
                Description: item.querySelector('description')?.textContent,
                Category: item.querySelector('category')?.textContent,
                Tracker: item.querySelector('prowlarrindexer')?.textContent || item.querySelector('jackettindexer')?.textContent || 'Unknown',
                MagnetUri: magnet,
                Seeders: parseInt(torznabAttrs['seeders']) || 0,
                Peers: parseInt(torznabAttrs['peers']) || 0,
            };
        });
    } catch (error) {
        console.error('Jackett Fetch Failed:', error);
        // Throw a specific error so the UI can detect it
        throw new Error('JACKETT_CONNECTION_ERROR');
    }
};

export const searchJackett = async (queries, metadata = {}) => {
    const queryList = Array.isArray(queries) ? queries : [queries];
    const results = await Promise.all(queryList.map(q => fetchFromJackett(q)));
    
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