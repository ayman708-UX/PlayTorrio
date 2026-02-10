#!/usr/bin/env node
/**
 * PlayTorrioPlayer Setup Script
 * Downloads and extracts PlayTorrioPlayer for the current platform
 * 
 * Usage: node setup-playtorrioplayer.js
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PLAYER_DIR = path.join(__dirname, 'PlayTorrioPlayer');

const DOWNLOAD_URLS = {
    win32: 'https://github.com/ayman708-UX/PlayTorrioPlayerV2/releases/download/v1.8.67/PlayTorrio-Windows-x64.zip',
    darwin: 'https://github.com/ayman708-UX/PlayTorrioPlayerV2/releases/download/v1.8.67/PlayTorrio-macOS-Universal.zip',
    linux: 'https://github.com/ayman708-UX/PlayTorrioPlayerV2/releases/download/v1.8.67/NipaPlay-1.8.67-Linux-amd64.AppImage'
};

function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        console.log(`Downloading from: ${url}`);
        console.log(`Saving to: ${destPath}`);
        
        const file = fs.createWriteStream(destPath);
        
        const request = (url.startsWith('https') ? https : http).get(url, (response) => {
            // Handle redirects
            if (response.statusCode === 301 || response.statusCode === 302) {
                console.log(`Redirecting to: ${response.headers.location}`);
                file.close();
                fs.unlinkSync(destPath);
                return downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
            }
            
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
                return;
            }
            
            const totalSize = parseInt(response.headers['content-length'], 10);
            let downloadedSize = 0;
            
            response.on('data', (chunk) => {
                downloadedSize += chunk.length;
                if (totalSize) {
                    const percent = ((downloadedSize / totalSize) * 100).toFixed(1);
                    process.stdout.write(`\rDownloading: ${percent}% (${(downloadedSize / 1024 / 1024).toFixed(1)}MB / ${(totalSize / 1024 / 1024).toFixed(1)}MB)`);
                }
            });
            
            response.pipe(file);
            
            file.on('finish', () => {
                file.close();
                console.log('\nDownload complete!');
                resolve(destPath);
            });
        });
        
        request.on('error', (err) => {
            fs.unlink(destPath, () => {});
            reject(err);
        });
    });
}

async function extractZip(zipPath, destDir) {
    console.log(`Extracting ${zipPath} to ${destDir}...`);
    
    // Use platform-specific extraction
    if (process.platform === 'win32') {
        // Use PowerShell on Windows
        execSync(`powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`, { stdio: 'inherit' });
    } else {
        // Use unzip on Mac/Linux
        execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: 'inherit' });
    }
    
    console.log('Extraction complete!');
}

function flattenDirectory(dir) {
    // Check if there's a nested folder with the same name
    const entries = fs.readdirSync(dir);
    
    // Don't flatten if we only have a .app bundle (macOS)
    if (entries.length === 1 && entries[0].endsWith('.app')) {
        console.log(`Found macOS .app bundle: ${entries[0]}, keeping structure intact.`);
        return;
    }
    
    if (entries.length === 1) {
        const nestedPath = path.join(dir, entries[0]);
        const stat = fs.statSync(nestedPath);
        
        if (stat.isDirectory() && !entries[0].endsWith('.app')) {
            console.log(`Found nested directory: ${entries[0]}, flattening...`);
            
            // Move all contents up one level
            const nestedEntries = fs.readdirSync(nestedPath);
            for (const entry of nestedEntries) {
                const src = path.join(nestedPath, entry);
                const dest = path.join(dir, entry);
                
                // Remove destination if it exists
                if (fs.existsSync(dest)) {
                    fs.rmSync(dest, { recursive: true, force: true });
                }
                
                fs.renameSync(src, dest);
            }
            
            // Remove the now-empty nested directory
            fs.rmdirSync(nestedPath);
            console.log('Directory flattened!');
            
            // Recursively check again in case of multiple nesting levels
            flattenDirectory(dir);
        }
    }
}

function setExecutablePermissions(dir) {
    if (process.platform === 'win32') return;
    
    console.log('Setting executable permissions...');
    
    const possibleExecutables = [
        path.join(dir, 'PlayTorrioPlayer'),
        path.join(dir, 'bin', 'PlayTorrioPlayer'),
        path.join(dir, 'PlayTorrioPlayer.app', 'Contents', 'MacOS', 'PlayTorrioPlayer'),
    ];
    
    // Also find any AppImage files
    try {
        const files = fs.readdirSync(dir);
        files.filter(f => f.endsWith('.AppImage')).forEach(f => {
            possibleExecutables.push(path.join(dir, f));
        });
    } catch {}
    
    for (const exe of possibleExecutables) {
        if (fs.existsSync(exe)) {
            try {
                fs.chmodSync(exe, 0o755);
                console.log(`Set executable: ${exe}`);
            } catch (e) {
                console.warn(`Could not set permissions for ${exe}: ${e.message}`);
            }
        }
    }
}

function verifyInstallation() {
    console.log('\nVerifying installation...');
    
    let playerExe = null;
    
    if (process.platform === 'win32') {
        const winExe = path.join(PLAYER_DIR, 'PlayTorrioPlayer.exe');
        if (fs.existsSync(winExe)) playerExe = winExe;
    } else if (process.platform === 'darwin') {
        const possiblePaths = [
            path.join(PLAYER_DIR, 'PlayTorrioPlayer.app', 'Contents', 'MacOS', 'PlayTorrioPlayer'),
            path.join(PLAYER_DIR, 'PlayTorrioPlayer'),
            path.join(PLAYER_DIR, 'bin', 'PlayTorrioPlayer'),
        ];
        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                playerExe = p;
                break;
            }
        }
    } else {
        // Linux - check for AppImage first
        // Check for specific AppImage names from v1.8.67+ release (NipaPlay) and older versions
        const specificAppImages = [
            path.join(PLAYER_DIR, 'NipaPlay-1.8.67-Linux-amd64.AppImage'),  // v1.8.67+
            path.join(PLAYER_DIR, 'NipaPlay-1.8.65-Linux-amd64.AppImage'),  // v1.8.65
            path.join(PLAYER_DIR, 'NipaPlay-1.8.58-Linux-amd64.AppImage'),  // v1.8.58
            path.join(PLAYER_DIR, 'NipaPlay-1.8.47-Linux-amd64.AppImage'),  // v1.8.47
            path.join(PLAYER_DIR, 'NipaPlay-1.8.46-Linux-amd64.AppImage'),  // v1.8.46
            path.join(PLAYER_DIR, 'NipaPlay-1.8.45-Linux-amd64.AppImage'),  // v1.8.45
            path.join(PLAYER_DIR, 'NipaPlay-1.8.44-Linux-amd64.AppImage'),  // v1.8.44
            path.join(PLAYER_DIR, 'PlayTorrio-Linux-x64.AppImage'),  // Older versions
        ];
        
        let foundAppImage = false;
        for (const appImagePath of specificAppImages) {
            if (fs.existsSync(appImagePath)) {
                playerExe = appImagePath;
                foundAppImage = true;
                break;
            }
        }
        
        if (!foundAppImage) {
            // Fall back to searching for any AppImage
            try {
                const files = fs.readdirSync(PLAYER_DIR);
                const appImage = files.find(f => f.endsWith('.AppImage') && (f.includes('PlayTorrio') || f.includes('PlayTorrioPlayer')));
                if (appImage) {
                    playerExe = path.join(PLAYER_DIR, appImage);
                }
            } catch {}
        }
        
        if (!playerExe) {
            const possiblePaths = [
                path.join(PLAYER_DIR, 'bin', 'PlayTorrioPlayer'),
                path.join(PLAYER_DIR, 'PlayTorrioPlayer'),
            ];
            for (const p of possiblePaths) {
                if (fs.existsSync(p)) {
                    playerExe = p;
                    break;
                }
            }
        }
    }
    
    if (playerExe) {
        console.log(`✓ PlayTorrioPlayer found at: ${playerExe}`);
        return true;
    } else {
        console.error('✗ PlayTorrioPlayer executable not found!');
        console.log('Directory contents:');
        try {
            const files = fs.readdirSync(PLAYER_DIR);
            files.forEach(f => console.log(`  - ${f}`));
        } catch (e) {
            console.log(`  Could not read directory: ${e.message}`);
        }
        return false;
    }
}

async function main() {
    const platform = process.platform;
    console.log(`\n=== PlayTorrioPlayer Setup ===`);
    console.log(`Platform: ${platform}`);
    console.log(`Target directory: ${PLAYER_DIR}\n`);
    
    const downloadUrl = DOWNLOAD_URLS[platform];
    if (!downloadUrl) {
        console.error(`Unsupported platform: ${platform}`);
        process.exit(1);
    }
    
    // Create player directory if it doesn't exist
    if (!fs.existsSync(PLAYER_DIR)) {
        fs.mkdirSync(PLAYER_DIR, { recursive: true });
    }
    
    const isAppImage = downloadUrl.endsWith('.AppImage');
    const fileName = path.basename(downloadUrl);
    const downloadPath = path.join(PLAYER_DIR, fileName);
    
    try {
        // Download the file
        await downloadFile(downloadUrl, downloadPath);
        
        if (isAppImage) {
            // For AppImage, just set executable permissions
            console.log('AppImage downloaded, setting permissions...');
            fs.chmodSync(downloadPath, 0o755);
        } else {
            // Extract zip
            await extractZip(downloadPath, PLAYER_DIR);
            
            // Flatten nested directories
            flattenDirectory(PLAYER_DIR);
            
            // Clean up zip file
            fs.unlinkSync(downloadPath);
            console.log('Cleaned up zip file.');
            
            // Set executable permissions
            setExecutablePermissions(PLAYER_DIR);
        }
        
        // Verify installation
        const success = verifyInstallation();
        
        if (success) {
            console.log('\n✓ PlayTorrioPlayer setup complete!\n');
            process.exit(0);
        } else {
            console.error('\n✗ Setup completed but verification failed.\n');
            process.exit(1);
        }
        
    } catch (error) {
        console.error(`\nSetup failed: ${error.message}`);
        process.exit(1);
    }
}

main();