import { NextRequest, NextResponse } from 'next/server';
import { chunkCache, CHUNK_SIZE } from '@/lib/chunkCache';

export const runtime = 'nodejs';
// We use Node.js runtime. This proxy is designed to handle Range requests efficiently.
// Each request is short-lived (handling only a chunk), satisfying Vercel's timeout limits.

const MAX_CHUNK_SIZE = CHUNK_SIZE; // Use the same chunk size as the cache
const TIMEOUT_MS = 25000; // 25 second timeout (Vercel has 30s limit for hobby plan)
const NON_RANGE_STARTUP_MAX_CHUNK = 8; // 8 * 5MB = 40MB startup window
const NON_RANGE_FORWARD_HEADROOM = 2; // allow a small forward look-ahead

// Simple in-memory cache for URL metadata
const urlMetadataCache = new Map<string, {
    supportsRange: boolean;
    contentLength: number;
    contentType: string | null;
    timestamp: number;
    rangeVerified: boolean;
}>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Parse Range header: "bytes=0-5242879" -> { start: 0, end: 5242879 }
function parseRangeHeader(range: string): { start: number; end?: number } | null {
    const match = range.match(/bytes=(\d+)-(\d*)/);
    if (!match) return null;
    return {
        start: parseInt(match[1], 10),
        end: match[2] ? parseInt(match[2], 10) : undefined
    };
}

// Probe URL to check if it supports range requests
async function probeUrlCapabilities(url: string): Promise<{
    supportsRange: boolean;
    contentLength: number;
    contentType: string | null;
    rangeVerified: boolean;
}> {
    const cached = urlMetadataCache.get(url);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        console.log('[Proxy] 📋 Using cached URL metadata:', { supportsRange: cached.supportsRange, contentLength: cached.contentLength, contentType: cached.contentType });
        return {
            supportsRange: cached.supportsRange,
            contentLength: cached.contentLength,
            contentType: cached.contentType,
            rangeVerified: cached.rangeVerified
        };
    }

    try {
        console.log('[Proxy] 🔍 Probing URL capabilities with HEAD request...');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000); // 8 seconds timeout for probe

        const response = await fetch(url, {
            method: 'HEAD',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
            cache: 'no-store', // Don't use cached edge responses for capabilities check
            signal: controller.signal,
        });
        clearTimeout(timeout);

        // If HEAD fails (405 Method Not Allowed, 400 Bad Request, etc.), try GET
        if (!response.ok) {
            console.log('[Proxy] ⚠️ HEAD request returned', response.status, '- retrying with GET range check...');
            // Fallback to testing range support directly which sends a GET
            return { supportsRange: false, contentLength: 0, contentType: null, rangeVerified: false };
        }

        const acceptRanges = response.headers.get('accept-ranges');
        const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
        const contentType = response.headers.get('content-type');
        const supportsRange = acceptRanges === 'bytes';

        console.log('[Proxy] HEAD response:', { acceptRanges, contentLength, supportsRange, contentType });

        // Don't cache if content-type looks like an error (html/text)
        if (contentType && (contentType.includes('text/html') || contentType.includes('text/plain') || contentType.includes('application/json'))) {
            console.warn('[Proxy] ⚠️ Detected non-video content-type:', contentType);
            return { supportsRange: false, contentLength: 0, contentType, rangeVerified: false };
        }

        urlMetadataCache.set(url, { supportsRange, contentLength, contentType, timestamp: Date.now(), rangeVerified: supportsRange });
        return { supportsRange, contentLength, contentType, rangeVerified: supportsRange };
    } catch (error) {
        console.log('[Proxy] HEAD request failed, will detect from GET response:', error);
        return { supportsRange: false, contentLength: 0, contentType: null, rangeVerified: false };
    }
}

// Try a Range request to verify server supports it
async function testRangeSupport(url: string): Promise<boolean> {
    try {
        console.log('[Proxy] 🧪 Testing Range request support...');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Range': 'bytes=0-1024', // Use a larger range (some servers ignore small ranges like 0-1)
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
            cache: 'no-store', // Don't use cached responses
            signal: controller.signal,
        });
        clearTimeout(timeout);

        const supportsRange = response.status === 206;
        console.log('[Proxy] Range test result:', { status: response.status, supportsRange });

        // Abort the rest of the response
        if (response.body) {
            await response.body.cancel();
        }

        return supportsRange;
    } catch (error) {
        console.log('[Proxy] Range test failed:', error);
        return false;
    }
}

export async function GET(req: NextRequest) {
    const searchParams = req.nextUrl.searchParams;
    const targetUrl = searchParams.get('url');

    console.log('[Proxy] 📥 Incoming request for URL:', targetUrl?.substring(0, 100) + '...');

    if (!targetUrl) {
        console.error('[Proxy] ❌ Missing URL parameter');
        return new NextResponse('Missing "url" query parameter', { status: 400 });
    }

    // Get the Range header from the client request
    const rangeHeader = req.headers.get('range') || 'bytes=0-';
    const parsedRange = parseRangeHeader(rangeHeader);
    console.log('[Proxy] Range requested:', rangeHeader, 'parsed:', parsedRange);

    const requestedStart = parsedRange?.start || 0;
    const chunkIndex = Math.floor(requestedStart / CHUNK_SIZE);

    try {

        // First, probe URL capabilities
        const capabilities = await probeUrlCapabilities(targetUrl);
        let { supportsRange, rangeVerified } = capabilities;
        const { contentLength, contentType } = capabilities;

        // If probe failed or says no range support, do a robust GET test
        // We do this even if contentLength is 0 because HEAD might have failed completely
        if (!supportsRange && !rangeVerified) {
            const rangeSupported = await testRangeSupport(targetUrl);

            // If range check succeeded, it might have given us better headers, but we can't easily retrieve them 
            // from testRangeSupport without refactoring. 
            // We'll trust the range support result.
            if (rangeSupported) {
                supportsRange = true;
                rangeVerified = true;

                // If we still don't have content length, we might need one real request to get it
                // But handleRangeRequest will likely handle it
            }

            // Update cache with test result
            // Note: if contentLength is still 0, that's okay, downstream handlers will try their best
            urlMetadataCache.set(targetUrl, {
                supportsRange,
                contentLength,
                contentType,
                timestamp: Date.now(),
                rangeVerified: true
            });
        }

        console.log('[Proxy] URL capabilities:', { supportsRange, contentLength, contentType, requestedChunk: chunkIndex });

        // If server supports Range requests, use direct proxy
        if (supportsRange) {
            return await handleRangeRequest(targetUrl, rangeHeader, parsedRange);
        }

        // Server doesn't support Range - use chunk cache
        console.log('[Proxy] 📦 Using chunk cache for non-Range server');
        return await handleCachedRequest(targetUrl, chunkIndex, contentLength, contentType, parsedRange);

    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            console.error('[Proxy] ⏱️ Request timed out');
            return new NextResponse('Request timeout - server too slow or file too large', { status: 504 });
        }
        console.error('[Proxy] ❌ Proxy Error:', error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}

/**
 * Handle requests to servers that support Range requests
 */
async function handleRangeRequest(
    targetUrl: string,
    rangeHeader: string,
    parsedRange: { start: number; end?: number } | null
): Promise<NextResponse> {
    console.log('[Proxy] 🔄 Direct Range request to upstream...');

    const controller = new AbortController();
    const timeout = setTimeout(() => {
        console.log('[Proxy] ⏱️ Request timeout, aborting...');
        controller.abort();
    }, TIMEOUT_MS);

    try {
        const response = await fetch(targetUrl, {
            headers: {
                Range: rangeHeader,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
            cache: 'no-store',
            signal: controller.signal,
        });

        clearTimeout(timeout);

        console.log('[Proxy] Upstream response:', {
            status: response.status,
            contentType: response.headers.get('content-type'),
            contentLength: response.headers.get('content-length'),
            contentRange: response.headers.get('content-range'),
        });

        if (!response.ok) {
            console.error('[Proxy] ❌ Upstream error:', response.status, response.statusText);
            return new NextResponse(`Upstream Error: ${response.status} ${response.statusText}`, {
                status: response.status,
            });
        }

        // If server returned 206, pass through as-is
        if (response.status === 206) {
            console.log('[Proxy] ✅ Server honored Range request, streaming response');

            const headers = new Headers();
            const headersToForward = [
                'content-type', 'content-length', 'content-range',
                'accept-ranges', 'last-modified', 'etag'
            ];

            response.headers.forEach((value, key) => {
                if (headersToForward.includes(key.toLowerCase())) {
                    headers.set(key, value);
                }
            });

            headers.set('Access-Control-Allow-Origin', '*');
            headers.set('Cache-Control', 'public, max-age=3600');

            return new NextResponse(response.body, {
                status: 206,
                headers: headers,
            });
        }

        // Server returned 200 despite Range header - fall back to cached approach
        console.log('[Proxy] ⚠️ Server returned 200 instead of 206, using cache fallback');
        const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
        const chunkIndex = Math.floor((parsedRange?.start || 0) / CHUNK_SIZE);

        // Cancel this response and use cache
        if (response.body) {
            await response.body.cancel();
        }

        // Update cache to mark this URL as non-range
        const contentType = response.headers.get('content-type');
        urlMetadataCache.set(targetUrl, {
            supportsRange: false,
            contentLength,
            contentType,
            timestamp: Date.now(),
            rangeVerified: true
        });

        return await handleCachedRequest(targetUrl, chunkIndex, contentLength, contentType, parsedRange);
    } catch (error) {
        clearTimeout(timeout);
        throw error;
    }
}

/**
 * Handle requests using chunk cache for non-Range servers
 */
async function handleCachedRequest(
    targetUrl: string,
    chunkIndex: number,
    totalSize: number,
    contentType: string | null,
    parsedRange: { start: number; end?: number } | null
): Promise<NextResponse> {
    console.log('[Proxy] 📦 Fetching chunk', chunkIndex, 'from cache...');

    const isChunkAlreadyCached = chunkCache.hasChunk(targetUrl, chunkIndex);
    const progress = chunkCache.getProgress(targetUrl);
    const downloadedChunkCursor = progress
        ? Math.floor(progress.bytesDownloaded / CHUNK_SIZE)
        : 0;
    const maxReachableChunk = progress
        ? downloadedChunkCursor + NON_RANGE_FORWARD_HEADROOM
        : NON_RANGE_STARTUP_MAX_CHUNK;

    // Non-range sources cannot jump to far offsets efficiently.
    // Reject distant seeks instead of forcing near-full file download.
    if (!isChunkAlreadyCached && chunkIndex > maxReachableChunk) {
        console.warn('[Proxy] ⛔ Rejecting far seek for non-Range source', {
            requestedChunk: chunkIndex,
            maxReachableChunk
        });
        const headers = new Headers();
        headers.set('Accept-Ranges', 'bytes');
        if (totalSize > 0) {
            headers.set('Content-Range', `bytes */${totalSize}`);
        }
        return new NextResponse(
            'Seek too far for non-Range source. Start playback from earlier position first.',
            { status: 416, headers }
        );
    }

    // Check if we already have this chunk cached
    const cachedChunk = await chunkCache.getChunk(targetUrl, chunkIndex, totalSize);

    if (!cachedChunk) {
        console.error('[Proxy] ❌ Failed to get chunk from cache');
        return new NextResponse('Failed to fetch video chunk - please try again', { status: 502 });
    }

    console.log('[Proxy] ✅ Got chunk from cache:', cachedChunk.length, 'bytes');

    // Calculate the actual byte range
    const chunkStartByte = chunkIndex * CHUNK_SIZE;
    const requestedStart = parsedRange?.start || 0;
    const offsetInChunk = requestedStart - chunkStartByte;

    // Extract the portion of the chunk that was requested
    let responseData: Uint8Array;
    if (offsetInChunk > 0 && offsetInChunk < cachedChunk.length) {
        // Client requested data starting mid-chunk
        responseData = cachedChunk.slice(offsetInChunk);
        console.log('[Proxy] Extracted', responseData.length, 'bytes from offset', offsetInChunk);
    } else {
        responseData = cachedChunk;
    }

    // Limit response size to MAX_CHUNK_SIZE
    if (responseData.length > MAX_CHUNK_SIZE) {
        responseData = responseData.slice(0, MAX_CHUNK_SIZE);
    }

    // Build response headers
    const headers = new Headers();
    headers.set('Content-Type', contentType || 'video/mp4'); // Use detected type or default
    headers.set('Content-Length', responseData.length.toString());
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', 'public, max-age=3600');
    headers.set('X-Cache-Status', 'HIT');

    // Add Content-Range header
    const actualStart = requestedStart;
    const actualEnd = actualStart + responseData.length - 1;
    if (totalSize > 0) {
        headers.set('Content-Range', `bytes ${actualStart}-${actualEnd}/${totalSize}`);
    } else {
        headers.set('Content-Range', `bytes ${actualStart}-${actualEnd}/*`);
    }

    return new NextResponse(Buffer.from(responseData), {
        status: 206,
        headers: headers,
    });
}

// Stats endpoint is handled by /api/stats route
