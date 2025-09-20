/**
 * Chunk Cache Manager
 * 
 * This module provides intelligent caching for video chunks, especially useful
 * for servers that don't support HTTP Range requests. Instead of re-downloading
 * the entire file for each chunk, we cache downloaded chunks in memory.
 * 
 * Architecture:
 * - Each URL gets a dedicated download session
 * - Chunks are cached as they're downloaded
 * - Subsequent requests for cached chunks are served instantly
 * - Memory is limited to prevent OOM issues
 */

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
const MAX_CACHE_SIZE = 200 * 1024 * 1024; // 200MB max cache per instance
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes TTL
const MAX_CONCURRENT_DOWNLOADS = 2; // Max concurrent full-file downloads

interface CachedChunk {
    data: Uint8Array;
    timestamp: number;
}

interface DownloadSession {
    url: string;
    totalSize: number;
    chunks: Map<number, CachedChunk>; // chunkIndex -> data
    downloadPromise: Promise<void> | null;
    bytesDownloaded: number;
    isComplete: boolean;
    lastAccess: number;
    abortController: AbortController | null;
    windowStartChunkIndex: number;
    desiredChunkIndex: number;
    demandResolver: (() => void) | null;
}

class ChunkCacheManager {
    private sessions: Map<string, DownloadSession> = new Map();
    private totalCacheSize: number = 0;
    private activeDownloads: number = 0;

    /**
     * Get a chunk from cache or trigger download
     */
    async getChunk(url: string, chunkIndex: number, totalSize: number): Promise<Uint8Array | null> {
        let session = this.sessions.get(url);

        if (!session) {
            session = this.createSession(url, totalSize);
            this.sessions.set(url, session);
        }

        session.lastAccess = Date.now();
        this.signalDemand(session, chunkIndex);

        // Check if chunk is already cached
        const cached = session.chunks.get(chunkIndex);
        if (cached) {
            console.log(`[ChunkCache] ✅ Cache HIT for chunk ${chunkIndex} of ${url.substring(0, 50)}...`);
            cached.timestamp = Date.now();
            return cached.data;
        }

        console.log(`[ChunkCache] ❌ Cache MISS for chunk ${chunkIndex}, starting download...`);

        // Start or continue download if not already running
        if (!session.downloadPromise && !session.isComplete) {
            session.downloadPromise = this.downloadFile(session);
        }

        // Wait for the chunk to be available (with timeout)
        try {
            const chunk = await this.waitForChunk(session, chunkIndex, 30000);
            return chunk;
        } catch (error) {
            if (error instanceof Error && error.message === 'CHUNK_PRUNED') {
                console.log(`[ChunkCache] ↺ Restarting stream for backward seek (Chunk ${chunkIndex})`);
                this.abortSession(url);
                // Recursive call will create a new session
                return this.getChunk(url, chunkIndex, totalSize);
            }
            return null;
        }
    }

    /**
     * Check if a chunk is cached
     */
    hasChunk(url: string, chunkIndex: number): boolean {
        const session = this.sessions.get(url);
        return session?.chunks.has(chunkIndex) ?? false;
    }

    /**
     * Get download progress for a URL
     */
    getProgress(url: string): { bytesDownloaded: number; totalSize: number; isComplete: boolean } | null {
        const session = this.sessions.get(url);
        if (!session) return null;
        return {
            bytesDownloaded: session.bytesDownloaded,
            totalSize: session.totalSize,
            isComplete: session.isComplete,
        };
    }

    /**
     * Abort and clean up a specific session
     */
    private abortSession(url: string): void {
        const session = this.sessions.get(url);
        if (!session) return;

        console.log(`[ChunkCache] 🛑 Aborting session for ${url.substring(0, 50)}...`);
        session.abortController?.abort();
        if (session.demandResolver) {
            const resolve = session.demandResolver;
            session.demandResolver = null;
            resolve();
        }

        // Return memory to pool
        for (const chunk of session.chunks.values()) {
            this.totalCacheSize -= chunk.data.length;
        }

        this.sessions.delete(url);
    }

    private createSession(url: string, totalSize: number): DownloadSession {
        return {
            url,
            totalSize,
            chunks: new Map(),
            downloadPromise: null,
            bytesDownloaded: 0,
            isComplete: false,
            lastAccess: Date.now(),
            abortController: null,
            windowStartChunkIndex: 0,
            desiredChunkIndex: 0,
            demandResolver: null,
        };
    }

    private signalDemand(session: DownloadSession, chunkIndex: number): void {
        const desiredWithLookahead = chunkIndex + 2;
        session.desiredChunkIndex = Math.max(session.desiredChunkIndex, desiredWithLookahead);
        if (session.demandResolver) {
            const resolve = session.demandResolver;
            session.demandResolver = null;
            resolve();
        }
    }

    private waitForDemand(session: DownloadSession): Promise<void> {
        return new Promise((resolve) => {
            session.demandResolver = resolve;
        });
    }

    private async downloadFile(session: DownloadSession): Promise<void> {
        if (this.activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
            console.log('[ChunkCache] ⏳ Waiting for download slot...');
            await this.waitForDownloadSlot();
        }

        this.activeDownloads++;
        session.abortController = new AbortController();

        try {
            console.log(`[ChunkCache] 🚀 Starting full file download for ${session.url.substring(0, 50)}...`);

            const response = await fetch(session.url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': '*/*',
                    'Accept-Encoding': 'identity;q=1, *;q=0',
                    'Connection': 'keep-alive',
                },
                signal: session.abortController.signal,
            });

            if (!response.ok || !response.body) {
                throw new Error(`Failed to fetch: ${response.status}`);
            }

            const reader = response.body.getReader();
            let buffer = new Uint8Array(0);
            let currentChunkIndex = 0;

            while (true) {
                while (currentChunkIndex > session.desiredChunkIndex && !session.isComplete) {
                    await this.waitForDemand(session);
                }

                const { done, value } = await reader.read();
                if (done) break;

                // Append to buffer
                const newBuffer = new Uint8Array(buffer.length + value.length);
                newBuffer.set(buffer);
                newBuffer.set(value, buffer.length);
                buffer = newBuffer;

                session.bytesDownloaded += value.length;

                // Extract complete chunks from buffer
                while (buffer.length >= CHUNK_SIZE) {
                    const chunkData = buffer.slice(0, CHUNK_SIZE);
                    this.cacheChunk(session, currentChunkIndex, chunkData);
                    buffer = buffer.slice(CHUNK_SIZE);
                    currentChunkIndex++;
                }

                // Cleanup old cache if we're using too much memory
                this.enforceMemoryLimit();
            }

            // Cache remaining data as final chunk
            if (buffer.length > 0) {
                this.cacheChunk(session, currentChunkIndex, buffer);
            }

            session.isComplete = true;
            console.log(`[ChunkCache] ✅ Download complete: ${session.chunks.size} chunks cached`);

        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                console.log('[ChunkCache] Download aborted');
            } else {
                console.error('[ChunkCache] Download error:', error);
            }
        } finally {
            this.activeDownloads--;
            session.downloadPromise = null;
        }
    }

    private cacheChunk(session: DownloadSession, chunkIndex: number, data: Uint8Array): void {
        const chunk: CachedChunk = {
            data: data,
            timestamp: Date.now(),
        };
        session.chunks.set(chunkIndex, chunk);
        this.totalCacheSize += data.length;
        console.log(`[ChunkCache] 📦 Cached chunk ${chunkIndex} (${(data.length / 1024 / 1024).toFixed(2)}MB)`);
    }

    private async waitForChunk(session: DownloadSession, chunkIndex: number, timeoutMs: number): Promise<Uint8Array | null> {
        const startTime = Date.now();
        const chunkStartByte = chunkIndex * CHUNK_SIZE;

        while (Date.now() - startTime < timeoutMs) {
            // Check if chunk was pruned (requested index is before current window)
            if (chunkIndex < session.windowStartChunkIndex) {
                throw new Error('CHUNK_PRUNED');
            }

            // Check if chunk is now available
            const cached = session.chunks.get(chunkIndex);
            if (cached) {
                return cached.data;
            }

            // Check if download has passed this chunk (meaning it's a smaller final chunk)
            if (session.isComplete) {
                // Check if this chunk index exists at all
                if (!session.chunks.has(chunkIndex)) {
                    // This chunk doesn't exist (requested beyond file end)
                    return null;
                }
            }

            // Check if we've downloaded enough bytes
            if (session.bytesDownloaded >= chunkStartByte + CHUNK_SIZE) {
                // We should have this chunk by now, give it a moment
                await new Promise(resolve => setTimeout(resolve, 100));
                const chunk = session.chunks.get(chunkIndex);
                if (chunk) return chunk.data;
            }

            // Wait a bit and check again
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        console.log(`[ChunkCache] ⏱️ Timeout waiting for chunk ${chunkIndex}`);
        return null;
    }

    private async waitForDownloadSlot(): Promise<void> {
        while (this.activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    private enforceMemoryLimit(): void {
        if (this.totalCacheSize <= MAX_CACHE_SIZE) return;

        console.log(`[ChunkCache] 🧹 Cache cleanup triggered: ${(this.totalCacheSize / 1024 / 1024).toFixed(2)}MB > ${(MAX_CACHE_SIZE / 1024 / 1024).toFixed(2)}MB limit`);

        // Phase 1: Clean up inactive sessions completely
        // Find oldest accessed session that isn't currently downloading
        let oldestSession: DownloadSession | null = null;
        let oldestTime = Infinity;

        for (const session of this.sessions.values()) {
            if (session.lastAccess < oldestTime && !session.downloadPromise) {
                oldestTime = session.lastAccess;
                oldestSession = session;
            }
        }

        if (oldestSession) {
            // Remove oldest session's chunks
            let liberated = 0;
            for (const chunk of oldestSession.chunks.values()) {
                liberated += chunk.data.length;
            }
            this.totalCacheSize -= liberated;
            oldestSession.abortController?.abort();
            this.sessions.delete(oldestSession.url);
            console.log(`[ChunkCache] 🗑️ Evicted inactive session for ${oldestSession.url.substring(0, 50)}... (freed ${(liberated / 1024 / 1024).toFixed(2)}MB)`);
            return; // Exit and strict check again on next pass if needed
        }

        // Phase 2: If we're still over limit, meaningful eviction from ACTIVE sessions (sliding window)
        // Find session using most memory
        let heaviestSession: DownloadSession | null = null;
        let maxUsage = 0;

        for (const session of this.sessions.values()) {
            let usage = 0;
            for (const chunk of session.chunks.values()) {
                usage += chunk.data.length;
            }
            if (usage > maxUsage) {
                maxUsage = usage;
                heaviestSession = session;
            }
        }

        if (heaviestSession && heaviestSession.chunks.size > 0) {
            // Get all chunk indices and sort them (oldest/lowest first)
            const indices = Array.from(heaviestSession.chunks.keys()).sort((a, b) => a - b);

            // Should keep at least the last few chunks (buffer) + current stuff
            // We want to delete the *earliest* chunks to create a sliding window

            let evictedCount = 0;
            let liberated = 0;

            // Delete chunks starting from the beginning
            for (const index of indices) {
                if (this.totalCacheSize <= MAX_CACHE_SIZE * 0.9) break; // Aim to get to 90% capacity to prevent thrashing

                const chunk = heaviestSession.chunks.get(index);
                if (chunk) {
                    this.totalCacheSize -= chunk.data.length;
                    liberated += chunk.data.length;
                    heaviestSession.chunks.delete(index);
                    evictedCount++;
                }
            }

            if (evictedCount > 0) {
                // Update window start to the first available chunk index
                // indices is sorted, so if we removed N items (0..N-1), the new start is at index N
                const newStartIndex = indices[evictedCount];
                if (newStartIndex !== undefined) {
                    heaviestSession.windowStartChunkIndex = newStartIndex;
                }

                console.log(`[ChunkCache] ✂️ Pruned ${evictedCount} old chunks from active session (freed ${(liberated / 1024 / 1024).toFixed(2)}MB). Window start: Chunk ${heaviestSession.windowStartChunkIndex}`);
            }
        }
    }

    /**
     * Clean up expired sessions
     */
    cleanup(): void {
        const now = Date.now();
        for (const [url, session] of this.sessions.entries()) {
            if (now - session.lastAccess > CACHE_TTL && !session.downloadPromise) {
                for (const chunk of session.chunks.values()) {
                    this.totalCacheSize -= chunk.data.length;
                }
                session.abortController?.abort();
                this.sessions.delete(url);
                console.log(`[ChunkCache] 🧹 Cleaned up expired session: ${url.substring(0, 50)}...`);
            }
        }
    }

    /**
     * Get cache statistics
     */
    getStats(): { totalSessions: number; totalCacheSize: number; activeDownloads: number } {
        return {
            totalSessions: this.sessions.size,
            totalCacheSize: this.totalCacheSize,
            activeDownloads: this.activeDownloads,
        };
    }
}

// Singleton instance
export const chunkCache = new ChunkCacheManager();

// Cleanup every 5 minutes
if (typeof setInterval !== 'undefined') {
    setInterval(() => chunkCache.cleanup(), 5 * 60 * 1000);
}

export { CHUNK_SIZE };
