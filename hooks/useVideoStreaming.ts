import { useEffect, useRef, useState, useCallback } from 'react';
import { useChunkFetcher } from './useChunkFetcher';
import { useBufferManager } from './useBufferManager';
import {
    BUFFER_RETAIN_BEHIND_SECONDS,
    CHUNK_SIZE,
    INITIAL_PREBUFFER_PERCENT,
    MAX_BUFFER_AHEAD,
    MAX_INITIAL_PREBUFFER_CHUNKS,
    MIN_INITIAL_PREBUFFER_CHUNKS,
    PLAYBACK_MAX_AHEAD_CHUNKS,
    PLAYBACK_TARGET_AHEAD_CHUNKS
} from '@/lib/constants';
import { StreamStats } from '@/lib/types';

interface UseVideoStreamingProps {
    url: string;
    videoElement: HTMLVideoElement | null;
}

interface StreamingState {
    error: string | null;
    isBuffering: boolean;
    stats: StreamStats;
    totalBytes: number | null;
    attemptFallback: () => void;
}

export function useVideoStreaming({ url, videoElement }: UseVideoStreamingProps): StreamingState {
    const { fetchChunk, isFetching, currentSpeedMbps, error: fetchError } = useChunkFetcher();
    const { isReady, appendBuffer, getBufferedEnd, cleanupPlayedBuffer, error: bufferError, usesDirectSrc, attemptFallback } = useBufferManager({
        videoElement,
        videoUrl: url
    });

    const [totalBytes, setTotalBytes] = useState<number | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [hasStartedPlayback, setHasStartedPlayback] = useState(false);
    const currentByteRef = useRef(0);
    const activeUrlRef = useRef<string | null>(null);

    // Stats tracking
    const [stats, setStats] = useState<StreamStats>({
        downloadSpeed: 0,
        liveSpeed: 0,
        internetSpeed: null,
        bufferHealth: 0,
        totalDownloaded: 0
    });
    const speedSamplesRef = useRef<number[]>([]);

    useEffect(() => {
        if (!videoElement) return;

        const onPlay = () => {
            setIsPlaying(true);
            setHasStartedPlayback(true);
        };
        const onPause = () => setIsPlaying(false);
        const onEnded = () => setIsPlaying(false);

        videoElement.addEventListener('play', onPlay);
        videoElement.addEventListener('pause', onPause);
        videoElement.addEventListener('ended', onEnded);

        return () => {
            videoElement.removeEventListener('play', onPlay);
            videoElement.removeEventListener('pause', onPause);
            videoElement.removeEventListener('ended', onEnded);
        };
    }, [videoElement]);

    // Update buffer health periodically
    useEffect(() => {
        if (!videoElement) return;

        const updateBufferHealth = () => {
            const bufferedEnd = getBufferedEnd();
            const currentTime = videoElement.currentTime;
            const bufferHealth = Math.max(0, bufferedEnd - currentTime);

            setStats(prev => ({
                ...prev,
                bufferHealth
            }));
        };

        const interval = setInterval(updateBufferHealth, 500);
        return () => clearInterval(interval);
    }, [videoElement, getBufferedEnd]);

    useEffect(() => {
        if (typeof navigator === 'undefined') return;

        type NetworkInformationLike = {
            downlink?: number;
            addEventListener?: (type: 'change', listener: () => void) => void;
            removeEventListener?: (type: 'change', listener: () => void) => void;
        };

        const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
        if (!connection) return;

        const updateInternetSpeed = () => {
            const downlink = typeof connection.downlink === 'number' ? connection.downlink : null;
            setStats(prev => ({
                ...prev,
                internetSpeed: downlink
            }));
        };

        updateInternetSpeed();
        connection.addEventListener?.('change', updateInternetSpeed);

        return () => {
            connection.removeEventListener?.('change', updateInternetSpeed);
        };
    }, []);

    const loadNextChunk = useCallback(async () => {
        // Skip chunk loading if using direct src (browser handles streaming)
        if (usesDirectSrc) {
            console.log('[VideoStreaming] Using direct src mode, skipping chunk fetch');
            return;
        }

        if (activeUrlRef.current !== url) {
            activeUrlRef.current = url;
            currentByteRef.current = 0;
            speedSamplesRef.current = [];
            setTotalBytes(null);
            setHasStartedPlayback(false);
            setStats({
                downloadSpeed: 0,
                liveSpeed: 0,
                internetSpeed: null,
                bufferHealth: 0,
                totalDownloaded: 0
            });
        }

        const effectiveTotalBytes = totalBytes;
        const minInitialBufferBytes = MIN_INITIAL_PREBUFFER_CHUNKS * CHUNK_SIZE;
        const maxInitialBufferBytes = MAX_INITIAL_PREBUFFER_CHUNKS * CHUNK_SIZE;
        const dynamicInitialTarget = effectiveTotalBytes
            ? Math.floor(effectiveTotalBytes * INITIAL_PREBUFFER_PERCENT)
            : 3 * CHUNK_SIZE;
        const initialTargetBytes = Math.max(minInitialBufferBytes, Math.min(maxInitialBufferBytes, dynamicInitialTarget));

        let playedBytes = 0;
        if (videoElement && effectiveTotalBytes) {
            const duration = videoElement.duration;
            if (Number.isFinite(duration) && duration > 0) {
                const progress = Math.max(0, Math.min(1, videoElement.currentTime / duration));
                playedBytes = Math.floor(progress * effectiveTotalBytes);
            }
        }
        const aheadBytes = Math.max(0, currentByteRef.current - playedBytes);
        const playbackTargetAheadBytes = PLAYBACK_TARGET_AHEAD_CHUNKS * CHUNK_SIZE;
        const playbackMaxAheadBytes = PLAYBACK_MAX_AHEAD_CHUNKS * CHUNK_SIZE;

        if (isFetching || !url) {
            console.log('[VideoStreaming] Skipping - already fetching or no URL');
            return;
        }
        if (effectiveTotalBytes !== null && currentByteRef.current >= effectiveTotalBytes) {
            console.log('[VideoStreaming] Skipping - already downloaded all bytes');
            return;
        }

        if (!hasStartedPlayback) {
            if (currentByteRef.current >= initialTargetBytes) {
                console.log('[VideoStreaming] Initial prebuffer complete, waiting for playback');
                return;
            }
        } else {
            if (aheadBytes >= playbackMaxAheadBytes) {
                console.log('[VideoStreaming] Sliding window full, waiting for playback progress');
                return;
            }

            if (videoElement) {
                const bufferedEnd = getBufferedEnd();
                const currentTime = videoElement.currentTime;
                const bufferAhead = bufferedEnd - currentTime;
                if (bufferAhead > MAX_BUFFER_AHEAD && aheadBytes >= playbackTargetAheadBytes) {
                    console.log('[VideoStreaming] Enough buffer ahead, pausing downloads');
                    return;
                }
            }
        }

        console.log('[VideoStreaming] 🔄 Initiating chunk fetch at byte:', currentByteRef.current, {
            hasStartedPlayback,
            isPlaying,
            aheadBytes,
            initialTargetBytes
        });
        try {
            const result = await fetchChunk({
                url,
                startByte: currentByteRef.current
            });

            console.log('[VideoStreaming] ✅ Chunk received, appending to buffer');
            appendBuffer(result.data);
            currentByteRef.current += result.byteLength;

            // Update total bytes if we got it from Content-Range
            if (result.totalBytes !== null && effectiveTotalBytes === null) {
                console.log('[VideoStreaming] Total file size discovered:', result.totalBytes);
                setTotalBytes(result.totalBytes);
            }

            // Update speed samples (keep last 5 for averaging)
            speedSamplesRef.current.push(result.speedMbps);
            if (speedSamplesRef.current.length > 5) {
                speedSamplesRef.current.shift();
            }

            // Calculate average speed
            const avgSpeed = speedSamplesRef.current.reduce((a, b) => a + b, 0) / speedSamplesRef.current.length;

            // Update stats
            setStats(prev => ({
                ...prev,
                downloadSpeed: avgSpeed,
                liveSpeed: result.speedMbps,
                totalDownloaded: currentByteRef.current
            }));

            console.log('[VideoStreaming] Stats updated:', {
                downloadSpeed: avgSpeed.toFixed(2),
                totalDownloaded: currentByteRef.current
            });

        } catch (err) {
            console.error('[VideoStreaming] ❌ Error loading chunk:', err);
            // Error managed by fetchError
        }
    }, [isFetching, url, totalBytes, hasStartedPlayback, isPlaying, videoElement, getBufferedEnd, fetchChunk, appendBuffer, usesDirectSrc]);

    // Loop to check buffer status
    useEffect(() => {
        console.log('[VideoStreaming] Buffer loop effect', { isReady, hasUrl: !!url, usesDirectSrc });

        // Skip chunk fetching if using direct src
        if (usesDirectSrc) {
            console.log('[VideoStreaming] Direct src mode - browser handles buffering');
            return;
        }

        if (!isReady || !url) {
            console.log('[VideoStreaming] Buffer loop not starting - not ready or no URL');
            return;
        }

        console.log('[VideoStreaming] ✅ Starting buffer check interval');
        const interval = setInterval(() => {
            loadNextChunk();
            if (hasStartedPlayback && videoElement) {
                cleanupPlayedBuffer(videoElement.currentTime, BUFFER_RETAIN_BEHIND_SECONDS);
            }
        }, 1000);

        return () => {
            console.log('[VideoStreaming] Clearing buffer check interval');
            clearInterval(interval);
        };
    }, [isReady, url, loadNextChunk, usesDirectSrc, hasStartedPlayback, cleanupPlayedBuffer, videoElement]);

    return {
        error: fetchError || bufferError,
        isBuffering: isFetching && !usesDirectSrc,
        stats: {
            ...stats,
            liveSpeed: isFetching ? currentSpeedMbps : stats.liveSpeed
        },
        totalBytes,
        attemptFallback
    };
}
