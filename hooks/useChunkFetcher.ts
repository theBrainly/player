import { useState, useCallback, useRef } from 'react';
import { CHUNK_SIZE } from '@/lib/constants';

interface FetchOptions {
    url: string;
    startByte: number;
    endByte?: number;
}

interface ChunkResult {
    data: ArrayBuffer;
    byteLength: number;
    totalBytes: number | null;
    fetchTimeMs: number;
    speedMbps: number;
}

export function useChunkFetcher() {
    const [isFetching, setIsFetching] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [currentSpeedMbps, setCurrentSpeedMbps] = useState(0);
    const totalBytesRef = useRef<number | null>(null);

    const parseContentRange = (header: string | null): number | null => {
        if (!header) return null;
        // Format: "bytes 0-5242879/104857600" or "bytes 0-5242879/*"
        const match = header.match(/bytes\s+\d+-\d+\/(\d+|\*)/);
        if (match && match[1] !== '*') {
            return parseInt(match[1], 10);
        }
        return null;
    };

    const fetchChunk = useCallback(async ({ url, startByte, endByte }: FetchOptions): Promise<ChunkResult> => {
        console.log('[ChunkFetcher] fetchChunk called', { url, startByte, endByte });
        setIsFetching(true);
        setError(null);
        setCurrentSpeedMbps(0);

        const startTime = performance.now();

        try {
            const calculatedEnd = endByte ?? (startByte + CHUNK_SIZE - 1);
            const proxyUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
            console.log('[ChunkFetcher] Fetching from proxy:', proxyUrl);
            console.log('[ChunkFetcher] Range header:', `bytes=${startByte}-${calculatedEnd}`);

            const response = await fetch(proxyUrl, {
                headers: {
                    'Range': `bytes=${startByte}-${calculatedEnd}`
                }
            });

            console.log('[ChunkFetcher] Response received:', {
                status: response.status,
                statusText: response.statusText,
                ok: response.ok
            });

            if (!response.ok) {
                console.error('[ChunkFetcher] ❌ Fetch failed:', response.status, response.statusText);
                throw new Error(`Fetch failed: ${response.statusText}`);
            }

            // Parse Content-Range to get total file size
            const contentRange = response.headers.get('content-range');
            console.log('[ChunkFetcher] Content-Range header:', contentRange);
            const totalBytes = parseContentRange(contentRange);
            console.log('[ChunkFetcher] Parsed total bytes:', totalBytes);
            if (totalBytes !== null) {
                totalBytesRef.current = totalBytes;
            }

            if (!response.body) {
                throw new Error('Response body is not readable');
            }

            const reader = response.body.getReader();
            const chunks: Uint8Array[] = [];
            let totalLength = 0;
            let lastTime = performance.now();
            let lastBytes = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (!value) continue;

                chunks.push(value);
                totalLength += value.length;

                const now = performance.now();
                const elapsedMs = now - lastTime;
                if (elapsedMs >= 200) {
                    const bytesDelta = totalLength - lastBytes;
                    const bytesPerSecond = (bytesDelta / elapsedMs) * 1000;
                    const liveMbps = (bytesPerSecond * 8) / (1024 * 1024);
                    setCurrentSpeedMbps(liveMbps);
                    lastTime = now;
                    lastBytes = totalLength;
                }
            }

            const merged = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
                merged.set(chunk, offset);
                offset += chunk.length;
            }

            const data = merged.buffer;
            const endTime = performance.now();
            const fetchTimeMs = endTime - startTime;

            // Calculate speed in Mbps (megabits per second)
            const bytesPerSecond = (data.byteLength / fetchTimeMs) * 1000;
            const speedMbps = (bytesPerSecond * 8) / (1024 * 1024);

            console.log('[ChunkFetcher] ✅ Chunk fetched successfully:', {
                byteLength: data.byteLength,
                totalBytes: totalBytesRef.current,
                fetchTimeMs: fetchTimeMs.toFixed(2),
                speedMbps: speedMbps.toFixed(2)
            });

            return {
                data,
                byteLength: data.byteLength,
                totalBytes: totalBytesRef.current,
                fetchTimeMs,
                speedMbps
            };

        } catch (err) {
            console.error("Chunk fetch error:", err);
            setError(err instanceof Error ? err.message : 'Unknown fetch error');
            throw err;
        } finally {
            setIsFetching(false);
            setCurrentSpeedMbps(0);
        }
    }, []);

    return { fetchChunk, isFetching, currentSpeedMbps, error, totalBytes: totalBytesRef.current };
}
