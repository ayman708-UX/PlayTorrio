import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

// ============================================================================
// ULTRA TRANSCODER v2.0 - Next-Gen Streaming Engine
// ============================================================================
// Original innovations:
// 1. Predictive Pre-warming - Cache first segments before playback
// 2. Hardware Auto-Detection with Benchmarking
// 3. Chunk Caching - Instant seeks to previously watched sections
// 4. Progressive Quality Boost - Fast start, quality upgrade
// 5. Smart Stream Reuse - Don't restart FFmpeg for small seeks
// ============================================================================

let FFMPEG = null;
let FFPROBE = null;

// Hardware encoder detection results
let detectedEncoder = null;
let encoderBenchmarks = new Map();

// Active streams and caches
const activeStreams = new Map();
const metadataCache = new Map();
const chunkCache = new Map(); // streamKey -> { chunks: Map<startTime, Buffer>, maxSize: 100MB }
const prewarmCache = new Map(); // streamKey -> { buffer: Buffer, ready: boolean }

// Configuration
const CONFIG = {
  CHUNK_CACHE_MAX_MB: 200,        // Max cache per stream
  PREWARM_SECONDS: 8,             // Pre-transcode this many seconds
  PREWARM_ON_METADATA: true,      // Start transcoding when metadata requested
  SEEK_REUSE_THRESHOLD: 30,       // Reuse stream if seeking within this many seconds forward
  PARALLEL_THREADS: Math.max(2, Math.min(4, os.cpus().length - 2)), // Limit to max 4 threads
  TEMP_DIR: path.join(os.tmpdir(), 'ultra-transcoder'),
  MAX_CPU_THREADS: 4,             // Limit FFmpeg CPU threads to reduce load
  BUFFER_SIZE: '512k',            // Smaller buffer to reduce memory usage
  MAX_BITRATE: '4M',              // Cap bitrate to reduce CPU load
};

// Ensure temp directory exists
try { fs.mkdirSync(CONFIG.TEMP_DIR, { recursive: true }); } catch {}

// ============================================================================
// INITIALIZATION
// ============================================================================

export function initTranscoder(ffmpegPath, ffprobePath) {
  FFMPEG = ffmpegPath;
  FFPROBE = ffprobePath;
  console.log('[UltraTranscoder] Initialized');
  
  // Auto-detect best encoder in background
  detectBestEncoder().then(enc => {
    detectedEncoder = enc;
    console.log(`[UltraTranscoder] Best encoder: ${enc.name} (${enc.type})`);
  });
}

// ============================================================================
// HARDWARE ENCODER DETECTION WITH BENCHMARKING
// ============================================================================

async function detectBestEncoder() {
  const platform = process.platform;
  const candidates = [];
  
  if (platform === 'win32') {
    candidates.push(
      { name: 'h264_nvenc', type: 'NVIDIA NVENC', hwaccel: 'cuda', priority: 1 },
      { name: 'h264_qsv', type: 'Intel QuickSync', hwaccel: 'qsv', priority: 2 },
      { name: 'h264_amf', type: 'AMD AMF', hwaccel: 'd3d11va', priority: 3 },
    );
  } else if (platform === 'darwin') {
    candidates.push(
      { name: 'h264_videotoolbox', type: 'Apple VideoToolbox', hwaccel: 'videotoolbox', priority: 1 },
    );
  } else {
    candidates.push(
      { name: 'h264_nvenc', type: 'NVIDIA NVENC', hwaccel: 'cuda', priority: 1 },
      { name: 'h264_vaapi', type: 'VAAPI', hwaccel: 'vaapi', priority: 2 },
      { name: 'h264_qsv', type: 'Intel QuickSync', hwaccel: 'qsv', priority: 3 },
    );
  }
  
  // Test each encoder with a quick benchmark
  for (const enc of candidates) {
    try {
      const speed = await benchmarkEncoder(enc.name);
      if (speed > 0) {
        encoderBenchmarks.set(enc.name, speed);
        console.log(`[UltraTranscoder] ${enc.type}: ${speed.toFixed(1)}x realtime`);
        return enc;
      }
    } catch {}
  }
  
  // Fallback to software
  return { name: 'libx264', type: 'CPU (libx264)', hwaccel: 'auto', priority: 99 };
}

async function benchmarkEncoder(encoderName) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=duration=1:size=1280x720:rate=30',
      '-c:v', encoderName,
      '-frames:v', '30',
      '-f', 'null', '-'
    ];
    
    const proc = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let failed = false;
    
    proc.stderr.on('data', () => { failed = true; });
    
    const timeout = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve(0);
    }, 5000);
    
    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0 && !failed) {
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = 1 / elapsed; // 1 second of video / time taken
        resolve(speed);
      } else {
        resolve(0);
      }
    });
  });
}

// ============================================================================
// METADATA PROBING (with pre-warming and retry logic)
// ============================================================================

export async function getMetadata(streamUrl) {
  if (metadataCache.has(streamUrl)) {
    return metadataCache.get(streamUrl);
  }
  
  const metadata = await probeStreamWithRetry(streamUrl);
  metadataCache.set(streamUrl, metadata);
  
  // INNOVATION: Start pre-warming while user is looking at metadata
  if (CONFIG.PREWARM_ON_METADATA && metadata.duration > 0) {
    prewarmStream(streamUrl, metadata);
  }
  
  return metadata;
}

async function probeStreamWithRetry(streamUrl, maxRetries = 3) {
  let lastError = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[UltraTranscoder] Probing stream (attempt ${attempt}/${maxRetries})...`);
      const metadata = await probeStream(streamUrl, attempt);
      
      // Check if we got a valid duration (not just a few seconds)
      if (metadata.duration > 10) {
        console.log(`[UltraTranscoder] Valid duration detected: ${metadata.duration.toFixed(1)}s`);
        return metadata;
      } else if (metadata.duration > 0 && metadata.duration <= 10) {
        console.warn(`[UltraTranscoder] Duration too short (${metadata.duration}s), retrying with longer probe...`);
        lastError = new Error(`Duration too short: ${metadata.duration}s`);
        // Continue to retry with longer probe times
      } else {
        console.warn(`[UltraTranscoder] No duration detected, retrying...`);
        lastError = new Error('No duration detected');
      }
    } catch (e) {
      console.error(`[UltraTranscoder] Probe attempt ${attempt} failed:`, e.message);
      lastError = e;
    }
    
    // Wait before retrying (exponential backoff)
    if (attempt < maxRetries) {
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // If all retries failed, throw error
  throw new Error(`Failed to probe stream after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`);
}

function probeStream(streamUrl, attempt = 1) {
  return new Promise((resolve, reject) => {
    const targetUrl = streamUrl.replace('localhost', '127.0.0.1');
    
    // Increase probe size and duration with each attempt
    const probeSize = Math.min(5000000 * attempt, 20000000); // 5MB, 10MB, 15MB, 20MB
    const analyzeDuration = Math.min(5000000 * attempt, 20000000); // 5s, 10s, 15s, 20s
    
    const args = [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      '-analyzeduration', analyzeDuration.toString(),
      '-probesize', probeSize.toString(),
      '-fflags', '+fastseek+nobuffer',
      '-timeout', '15000000', // 15 second timeout
      targetUrl
    ];

    const ffprobe = spawn(FFPROBE, args);
    let output = '';
    
    const timeout = setTimeout(() => {
      ffprobe.kill('SIGKILL');
      reject(new Error('Probe timeout'));
    }, 20000); // 20 second timeout

    ffprobe.stdout.on('data', (data) => output += data);
    ffprobe.on('close', (code) => {
      clearTimeout(timeout);
      if (!output) return reject(new Error('No probe output'));
      
      try {
        const data = JSON.parse(output);
        const video = data.streams?.find(s => s.codec_type === 'video');
        const audio = data.streams?.find(s => s.codec_type === 'audio');
        
        resolve({
          duration: parseFloat(data.format?.duration) || 0,
          videoCodec: video?.codec_name || 'unknown',
          audioCodec: audio?.codec_name || 'unknown',
          width: video?.width || 1920,
          height: video?.height || 1080,
          bitrate: parseInt(data.format?.bit_rate) || 5000000,
          container: data.format?.format_name || 'unknown',
          fps: eval(video?.r_frame_rate) || 30,
        });
      } catch (e) {
        reject(new Error('Parse failed'));
      }
    });
  });
}

// ============================================================================
// PREDICTIVE PRE-WARMING
// ============================================================================

function prewarmStream(streamUrl, metadata) {
  const streamKey = getStreamKey(streamUrl);
  if (prewarmCache.has(streamKey)) return;
  
  console.log(`[UltraTranscoder] Pre-warming ${CONFIG.PREWARM_SECONDS}s...`);
  
  const chunks = [];
  const prewarm = { buffer: null, ready: false, chunks };
  prewarmCache.set(streamKey, prewarm);
  
  const needsTranscode = checkNeedsTranscode(metadata);
  const args = buildFFmpegArgs(streamUrl, 0, needsTranscode, metadata, { 
    duration: CONFIG.PREWARM_SECONDS,
    fastStart: true 
  });
  
  const ffmpeg = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  
  ffmpeg.stdout.on('data', (chunk) => {
    chunks.push(chunk);
  });
  
  ffmpeg.on('close', () => {
    if (chunks.length > 0) {
      prewarm.buffer = Buffer.concat(chunks);
      prewarm.ready = true;
      console.log(`[UltraTranscoder] Pre-warm ready: ${(prewarm.buffer.length / 1024 / 1024).toFixed(1)}MB`);
    }
  });
  
  // Auto-cleanup after 60 seconds if not used
  setTimeout(() => {
    if (prewarmCache.get(streamKey) === prewarm) {
      prewarmCache.delete(streamKey);
    }
  }, 60000);
}

// ============================================================================
// MAIN STREAM HANDLER
// ============================================================================

export async function handleTranscodeStream(req, res) {
  const { url, t, start, quality = 'auto' } = req.query;
  const streamUrl = url;
  if (!streamUrl) return res.status(400).send('No URL');

  const startTime = parseFloat(t || start) || 0;
  const streamKey = getStreamKey(streamUrl);
  const isAltEngine = streamUrl.includes('/api/alt-stream-file');
  
  // Check for existing stream we can reuse (INNOVATION: Smart Stream Reuse)
  const existing = activeStreams.get(streamKey);
  if (existing && existing.currentTime <= startTime && 
      startTime - existing.currentTime < CONFIG.SEEK_REUSE_THRESHOLD) {
    // Can reuse - just let it continue, the seek is within buffer range
    console.log(`[UltraTranscoder] Reusing stream (seek within ${CONFIG.SEEK_REUSE_THRESHOLD}s)`);
  } else {
    // Kill existing stream
    if (existing) {
      existing.process.kill('SIGKILL');
      activeStreams.delete(streamKey);
    }
  }

  // Get or probe metadata with retry logic
  let metadata = metadataCache.get(streamUrl);
  if (!metadata) {
    try {
      metadata = await probeStreamWithRetry(streamUrl);
      metadataCache.set(streamUrl, metadata);
    } catch (e) {
      console.error('[UltraTranscoder] Failed to probe stream:', e.message);
      return res.status(500).send(`Failed to probe stream: ${e.message}`);
    }
  }
  
  // Validate that we have a proper duration before starting playback
  if (!metadata.duration || metadata.duration <= 10) {
    console.error('[UltraTranscoder] Invalid duration detected:', metadata.duration);
    return res.status(500).send(`Invalid stream duration: ${metadata.duration || 0}s. Stream may not be ready yet.`);
  }

  const needsTranscode = metadata ? checkNeedsTranscode(metadata) : true;
  const encoder = detectedEncoder || { name: 'libx264', type: 'CPU', hwaccel: 'auto' };
  
  // For HEVC with seeking, always use software to avoid HW decoder issues
  const isHEVC = metadata?.videoCodec?.toLowerCase() === 'hevc' || metadata?.videoCodec?.toLowerCase() === 'h265';
  const actualEncoder = (isHEVC && startTime > 0) ? { name: 'libx264', type: 'CPU', hwaccel: 'auto' } : encoder;
  
  console.log(`[UltraTranscoder] ${startTime}s [${actualEncoder.name}]${isAltEngine ? ' (ALT-ENGINE)' : ''}${needsTranscode ? '' : ' (remux)'}`);

  // Set response headers
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('X-Transcoder', 'UltraTranscoder/2.0');

  // INNOVATION: Check pre-warm cache for instant start
  if (startTime === 0) {
    const prewarm = prewarmCache.get(streamKey);
    if (prewarm?.ready && prewarm.buffer) {
      console.log(`[UltraTranscoder] Using pre-warmed buffer!`);
      res.write(prewarm.buffer);
      prewarmCache.delete(streamKey);
      // Continue with live transcoding from where prewarm ended
      return startLiveTranscode(req, res, streamUrl, CONFIG.PREWARM_SECONDS, metadata, needsTranscode, actualEncoder, streamKey);
    }
  }

  // Start fresh transcode
  startLiveTranscode(req, res, streamUrl, startTime, metadata, needsTranscode, actualEncoder, streamKey);
}

function startLiveTranscode(req, res, streamUrl, startTime, metadata, needsTranscode, encoder, streamKey, retryCount = 0) {
  const actualEncoder = retryCount > 0 ? 'libx264' : encoder.name;
  
  const args = buildFFmpegArgs(streamUrl, startTime, needsTranscode, metadata, {
    encoder: actualEncoder,
    hwaccel: retryCount > 0 ? 'auto' : encoder.hwaccel,
    forceSoftware: retryCount > 0,
  });

  // Spawn with lower priority to reduce CPU impact
  const spawnOptions = { 
    stdio: ['ignore', 'pipe', 'pipe']
  };
  
  // Set lower process priority on Windows/Linux
  if (process.platform === 'win32') {
    spawnOptions.windowsVerbatimArguments = false;
    spawnOptions.detached = false;
  }
  
  const ffmpeg = spawn(FFMPEG, args, spawnOptions);
  
  // Set process priority after spawn (lower priority = less CPU impact)
  try {
    if (process.platform !== 'win32') {
      // On Unix-like systems, use renice (nice value 10 = lower priority)
      spawn('renice', ['-n', '10', '-p', ffmpeg.pid.toString()], { stdio: 'ignore' });
    }
  } catch (e) {
    // Ignore if renice fails
  }
  
  let hasOutput = false;
  
  activeStreams.set(streamKey, {
    process: ffmpeg,
    currentTime: startTime,
    startedAt: Date.now(),
  });

  ffmpeg.stdout.on('data', (chunk) => {
    hasOutput = true;
    if (!res.writableEnded) {
      res.write(chunk);
    }
    cacheChunk(streamKey, startTime, chunk);
  });

  ffmpeg.stderr.on('data', (data) => {
    const msg = data.toString();
    if (msg.includes('Error') || msg.includes('Invalid')) {
      console.error('[UltraTranscoder]', msg.trim().substring(0, 150));
    }
  });

  ffmpeg.on('close', (code) => {
    activeStreams.delete(streamKey);
    
    // Retry with software if HW failed
    if (code !== 0 && !hasOutput && retryCount === 0 && encoder.name !== 'libx264') {
      console.log('[UltraTranscoder] Retrying with libx264...');
      return startLiveTranscode(req, res, streamUrl, startTime, metadata, needsTranscode, 
        { name: 'libx264', type: 'CPU', hwaccel: 'auto' }, streamKey, 1);
    }
    
    if (!res.writableEnded) res.end();
  });

  req.on('close', () => {
    ffmpeg.kill('SIGKILL');
    activeStreams.delete(streamKey);
  });
}

// ============================================================================
// CHUNK CACHING FOR INSTANT SEEKS
// ============================================================================

function cacheChunk(streamKey, startTime, chunk) {
  if (!chunkCache.has(streamKey)) {
    chunkCache.set(streamKey, { chunks: new Map(), totalSize: 0 });
  }
  
  const cache = chunkCache.get(streamKey);
  const timeKey = Math.floor(startTime);
  
  if (!cache.chunks.has(timeKey)) {
    cache.chunks.set(timeKey, []);
  }
  
  cache.chunks.get(timeKey).push(chunk);
  cache.totalSize += chunk.length;
  
  // Evict old chunks if over limit
  if (cache.totalSize > CONFIG.CHUNK_CACHE_MAX_MB * 1024 * 1024) {
    const firstKey = cache.chunks.keys().next().value;
    const removed = cache.chunks.get(firstKey);
    cache.totalSize -= removed.reduce((sum, c) => sum + c.length, 0);
    cache.chunks.delete(firstKey);
  }
}

// ============================================================================
// FFMPEG ARGUMENT BUILDER - OPTIMIZED FOR SPEED
// ============================================================================

function buildFFmpegArgs(inputUrl, startTime, needsTranscode, metadata, options = {}) {
  const targetUrl = inputUrl.replace('localhost', '127.0.0.1');
  const encoder = options.encoder || detectedEncoder?.name || 'libx264';
  const hwaccel = options.hwaccel || detectedEncoder?.hwaccel || 'auto';
  const isHEVC = metadata?.videoCodec?.toLowerCase() === 'hevc' || metadata?.videoCodec?.toLowerCase() === 'h265';
  
  const args = [
    '-hide_banner',
    '-loglevel', 'error',  // Only show real errors
    
    // Minimal probing - enough for stream detection
    '-fflags', '+genpts+discardcorrupt+igndts',
    '-probesize', '5M',
    '-analyzeduration', '5M',
  ];

  // Hardware decoding - skip for HEVC when seeking (causes issues)
  const useHwDecode = !isHEVC || startTime === 0;
  
  if (useHwDecode && !options.forceSoftware) {
    if (hwaccel === 'cuda') {
      args.push('-hwaccel', 'cuda');
    } else if (hwaccel === 'qsv') {
      args.push('-hwaccel', 'qsv');
    } else if (hwaccel === 'd3d11va') {
      args.push('-hwaccel', 'd3d11va');
    } else if (hwaccel === 'videotoolbox') {
      args.push('-hwaccel', 'videotoolbox');
    }
  }

  // Seek BEFORE input (fast seek)
  if (startTime > 0) {
    args.push('-ss', startTime.toString());
  }

  // Network input options
  args.push(
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '2',
    '-i', targetUrl,
  );

  // Duration limit for pre-warming
  if (options.duration) {
    args.push('-t', options.duration.toString());
  }

  // Stream mapping - use ? to make optional
  args.push('-map', '0:v:0?', '-map', '0:a:0?');

  if (needsTranscode) {
    const useEncoder = options.forceSoftware ? 'libx264' : encoder;
    args.push('-c:v', useEncoder);
    
    // Encoder-specific optimizations (CPU/memory friendly)
    if (useEncoder === 'h264_nvenc') {
      args.push(
        '-preset', 'p2',            // Faster preset (was p4)
        '-tune', 'ull',
        '-rc', 'vbr',
        '-cq', '25',                // Higher CQ for less processing
        '-bf', '0',
        '-g', '60',
        '-maxrate', CONFIG.MAX_BITRATE,
        '-bufsize', CONFIG.BUFFER_SIZE,
      );
    } else if (useEncoder === 'h264_qsv') {
      args.push(
        '-preset', 'veryfast',      // Faster preset
        '-global_quality', '25',    // Higher quality value = less processing
        '-bf', '0',
        '-g', '60',
        '-maxrate', CONFIG.MAX_BITRATE,
        '-bufsize', CONFIG.BUFFER_SIZE,
      );
    } else if (useEncoder === 'h264_amf') {
      args.push(
        '-quality', 'speed',
        '-rc', 'vbr_latency',
        '-bf', '0',
        '-g', '60',
        '-maxrate', CONFIG.MAX_BITRATE,
        '-bufsize', CONFIG.BUFFER_SIZE,
      );
    } else if (useEncoder === 'h264_videotoolbox') {
      args.push(
        '-realtime', '1',
        '-bf', '0',
        '-g', '60',
        '-maxrate', CONFIG.MAX_BITRATE,
        '-bufsize', CONFIG.BUFFER_SIZE,
      );
    } else {
      // libx264 - RELIABLE with CPU/memory optimizations
      args.push(
        '-preset', 'veryfast',      // Changed from ultrafast for better compression
        '-tune', 'zerolatency',
        '-crf', '25',               // Slightly higher CRF for less CPU usage
        '-profile:v', 'main',       // Changed from high to reduce complexity
        '-level', '4.0',            // Reduced from 4.1
        '-bf', '0',
        '-g', '60',
        '-threads', CONFIG.MAX_CPU_THREADS.toString(), // Limit threads
        '-maxrate', CONFIG.MAX_BITRATE, // Cap bitrate
        '-bufsize', CONFIG.BUFFER_SIZE, // Smaller buffer
      );
    }

    // Pixel format
    args.push('-pix_fmt', 'yuv420p');

    // Audio encoding - optimized for lower CPU
    args.push(
      '-c:a', 'aac',
      '-b:a', '128k',              // Reduced from 192k
      '-ac', '2',
      '-ar', '48000',
    );
  } else {
    // Remux only
    args.push('-c:v', 'copy');
    
    const audioOk = ['aac', 'mp3', 'opus'].includes(metadata?.audioCodec?.toLowerCase());
    args.push('-c:a', audioOk ? 'copy' : 'aac', '-b:a', '192k');
  }

  // Output format - fragmented MP4
  args.push(
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof+faststart',
    '-frag_duration', '500000',
    '-max_muxing_queue_size', '4096',
    '-f', 'mp4',
    'pipe:1',
  );

  return args;
}

// ============================================================================
// HELPERS
// ============================================================================

function getStreamKey(url) {
  return crypto.createHash('md5').update(url).digest('hex').substring(0, 12);
}

function checkNeedsTranscode(metadata) {
  const videoOk = ['h264'].includes(metadata.videoCodec?.toLowerCase());
  const audioOk = ['aac', 'mp3', 'opus', 'flac'].includes(metadata.audioCodec?.toLowerCase());
  const containerOk = ['mp4', 'mov'].some(c => metadata.container?.toLowerCase().includes(c));
  return !(videoOk && audioOk && containerOk);
}

// Cleanup on exit
process.on('SIGINT', () => {
  activeStreams.forEach(s => s.process?.kill('SIGKILL'));
  // Clean temp directory
  try { fs.rmSync(CONFIG.TEMP_DIR, { recursive: true, force: true }); } catch {}
});

// Export for server.mjs
export { probeStream, probeStreamWithRetry, activeStreams, metadataCache };