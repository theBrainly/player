import { useState, useRef, useEffect, useCallback } from 'react';
import { getMimeTypeFromUrl, VIDEO_MIME_TYPES, DEFAULT_VIDEO_MIME_TYPE } from '@/lib/constants';

interface UseBufferManagerOptions {
    videoElement: HTMLVideoElement | null;
    videoUrl?: string;
}

// Formats that cannot be played via MSE and need direct src
const UNSUPPORTED_MSE_FORMATS = ['mkv', 'matroska', 'avi', 'msvideo'];

function isUnsupportedMseFormat(url: string, contentType?: string): boolean {
    // Check content type first (most reliable)
    if (contentType) {
        const ct = contentType.toLowerCase();
        for (const format of UNSUPPORTED_MSE_FORMATS) {
            if (ct.includes(format)) {
                console.log('[BufferManager] Content-Type indicates unsupported format:', contentType);
                return true;
            }
        }
    }

    // Check URL extension as fallback
    try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname.toLowerCase();
        if (pathname.endsWith('.mkv') || pathname.endsWith('.avi')) {
            return true;
        }
    } catch {
        // Ignore URL parse errors
    }

    return false;
}

// Fetch video metadata to check content-type
async function fetchVideoMetadata(url: string): Promise<{ contentType: string | null; contentLength: number | null }> {
    try {
        console.log('[BufferManager] 🔍 Fetching video metadata...');
        const response = await fetch(`/api/metadata?url=${encodeURIComponent(url)}`);
        if (response.ok) {
            const data = await response.json();
            console.log('[BufferManager] Metadata received:', data);
            return {
                contentType: data.contentType,
                contentLength: data.contentLength
            };
        }
    } catch (error) {
        console.error('[BufferManager] Metadata fetch failed:', error);
    }
    return { contentType: null, contentLength: null };
}

export function useBufferManager({ videoElement, videoUrl }: UseBufferManagerOptions) {
    const mediaSourceRef = useRef<MediaSource | null>(null);
    const sourceBufferRef = useRef<SourceBuffer | null>(null);
    const videoElementRef = useRef<HTMLVideoElement | null>(null);
    const [isReady, setIsReady] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [usesDirectSrc, setUsesDirectSrc] = useState(false);
    const [contentType, setContentType] = useState<string | null>(null);
    const queue = useRef<ArrayBuffer[]>([]);
    const processing = useRef(false);
    const objectUrlRef = useRef<string | null>(null);

    useEffect(() => {
        videoElementRef.current = videoElement;
    }, [videoElement]);

    const processQueue = useCallback(() => {
        console.log('[BufferManager] processQueue called', {
            hasSourceBuffer: !!sourceBufferRef.current,
            isUpdating: sourceBufferRef.current?.updating,
            queueLength: queue.current.length
        });

        if (!sourceBufferRef.current || sourceBufferRef.current.updating || queue.current.length === 0) {
            console.log('[BufferManager] processQueue early return - not ready or empty');
            return;
        }

        processing.current = true;
        const chunk = queue.current.shift();

        if (chunk) {
            try {
                console.log('[BufferManager] Appending chunk to SourceBuffer, size:', chunk.byteLength);
                sourceBufferRef.current.appendBuffer(chunk);
            } catch (err) {
                console.error('[BufferManager] SourceBuffer Append Error:', err);
                setError("Buffer append failed");
            }
        }
    }, []);

    // Find a supported MIME type
    const getSupportedMimeType = useCallback((url?: string, detectedContentType?: string | null): string | null => {
        console.log('[BufferManager] getSupportedMimeType called', { url, detectedContentType });

        // Check if format is unsupported by MSE based on content-type
        if (detectedContentType && isUnsupportedMseFormat(url || '', detectedContentType)) {
            console.log('[BufferManager] ⚠️ Content-Type indicates unsupported MSE format');
            return null;
        }

        // Check URL for unsupported format
        if (url && isUnsupportedMseFormat(url)) {
            console.log('[BufferManager] ⚠️ URL indicates unsupported MSE format');
            return null;
        }

        // Try URL-based detection first
        if (url) {
            const detectedMime = getMimeTypeFromUrl(url, detectedContentType || undefined);
            console.log('[BufferManager] Detected MIME type:', detectedMime);

            // Skip unsupported formats
            if (detectedMime.includes('matroska') || detectedMime.includes('msvideo')) {
                console.log('[BufferManager] Detected MIME is not MSE-compatible');
                return null;
            }

            const isSupported = MediaSource.isTypeSupported(detectedMime);
            console.log('[BufferManager] Is detected MIME supported?', isSupported);
            if (isSupported) {
                return detectedMime;
            }
        }

        // Fallback: try common MIME types until one works
        const mimeTypesToTry = [
            DEFAULT_VIDEO_MIME_TYPE,
            VIDEO_MIME_TYPES['mp4'],
            VIDEO_MIME_TYPES['mp4-high'],
            VIDEO_MIME_TYPES['webm'],
            VIDEO_MIME_TYPES['webm-vp9'],
            'video/mp4',
            'video/webm',
        ];

        console.log('[BufferManager] Trying fallback MIME types...');
        for (const mime of mimeTypesToTry) {
            const isSupported = MediaSource.isTypeSupported(mime);
            console.log('[BufferManager] Trying MIME:', mime, '- supported:', isSupported);
            if (isSupported) {
                return mime;
            }
        }

        console.warn('[BufferManager] No supported MIME type found');
        return null;
    }, []);

    // Initialize player - fetch metadata first, then decide MSE vs direct src
    useEffect(() => {
        console.log('[BufferManager] useEffect triggered', { hasVideoElement: !!videoElement, videoUrl });

        const player = videoElementRef.current;
        if (!player || !videoUrl) {
            console.log('[BufferManager] No video element or URL, skipping initialization');
            return;
        }

        queue.current = [];
        processing.current = false;

        const initializePlayer = async () => {
            console.log('[BufferManager] 🚀 Initializing player for:', videoUrl);
            setIsReady(false);
            setUsesDirectSrc(false);
            setError(null);

            // Fetch metadata to get content-type
            const metadata = await fetchVideoMetadata(videoUrl);
            setContentType(metadata.contentType);

            // Check if format needs direct src
            if (isUnsupportedMseFormat(videoUrl, metadata.contentType || undefined)) {
                console.log('[BufferManager] 📺 Using direct proxy URL for unsupported format (MKV/AVI)');
                const proxyUrl = `/api/proxy?url=${encodeURIComponent(videoUrl)}`;
                player.src = proxyUrl;
                setUsesDirectSrc(true);
                setIsReady(true);
                return;
            }

            // Try MSE
            console.log('[BufferManager] Creating new MediaSource');
            const mediaSource = new MediaSource();
            mediaSourceRef.current = mediaSource;
            const objectUrl = URL.createObjectURL(mediaSource);
            objectUrlRef.current = objectUrl;
            console.log('[BufferManager] MediaSource object URL created:', objectUrl);
            player.src = objectUrl;

            const onSourceOpen = () => {
                console.log('[BufferManager] MediaSource sourceopen event fired', {
                    readyState: mediaSource.readyState,
                    sourceBuffersCount: mediaSource.sourceBuffers.length
                });

                if (mediaSource.sourceBuffers.length > 0) {
                    console.log('[BufferManager] SourceBuffers already exist, skipping');
                    return;
                }

                try {
                    const mimeType = getSupportedMimeType(videoUrl, metadata.contentType);

                    if (!mimeType) {
                        console.log('[BufferManager] ⚠️ No supported MIME type, falling back to direct src');
                        const proxyUrl = `/api/proxy?url=${encodeURIComponent(videoUrl)}`;
                        player.src = proxyUrl;
                        setUsesDirectSrc(true);
                        setIsReady(true);
                        return;
                    }

                    console.log('[BufferManager] ✅ Using MIME type:', mimeType);
                    const sb = mediaSource.addSourceBuffer(mimeType);
                    console.log('[BufferManager] ✅ SourceBuffer created successfully');
                    sourceBufferRef.current = sb;

                    sb.addEventListener('updateend', () => {
                        console.log('[BufferManager] SourceBuffer updateend event');
                        processing.current = false;
                        processQueue();
                    });

                    setIsReady(true);
                    console.log('[BufferManager] ✅ Buffer manager is now ready');
                } catch (e) {
                    console.error('[BufferManager] ❌ MSE Init Failed:', e);
                    console.log('[BufferManager] 📺 Falling back to direct proxy URL');
                    const proxyUrl = `/api/proxy?url=${encodeURIComponent(videoUrl)}`;
                    player.src = proxyUrl;
                    setUsesDirectSrc(true);
                    setIsReady(true);
                }
            };

            const onSourceEnded = () => {
                setIsReady(false);
            };

            const onSourceError = () => {
                setError("MediaSource encountered an error");
            };

            mediaSource.addEventListener('sourceopen', onSourceOpen);
            mediaSource.addEventListener('sourceended', onSourceEnded);
            mediaSource.addEventListener('error', onSourceError);
        };

        initializePlayer();

        // Cleanup
        return () => {
            if (mediaSourceRef.current && mediaSourceRef.current.readyState === 'open') {
                try {
                    mediaSourceRef.current.endOfStream();
                } catch {
                    // ignore cleanup errors
                }
            }
            if (objectUrlRef.current) {
                URL.revokeObjectURL(objectUrlRef.current);
                objectUrlRef.current = null;
            }
        };
    }, [videoElement, videoUrl, processQueue, getSupportedMimeType]);

    const appendBuffer = useCallback((buffer: ArrayBuffer) => {
        if (usesDirectSrc) {
            console.log('[BufferManager] Using direct src, skipping buffer append');
            return;
        }

        console.log('[BufferManager] appendBuffer called, buffer size:', buffer.byteLength, 'queue length before:', queue.current.length);
        queue.current.push(buffer);
        processQueue();
    }, [processQueue, usesDirectSrc]);

    const getBufferedEnd = useCallback(() => {
        const player = videoElementRef.current;
        if (!player || player.buffered.length === 0) return 0;
        return player.buffered.end(player.buffered.length - 1);
    }, []);

    const attemptFallback = useCallback(() => {
        console.log('[BufferManager] 🚨 Attempting fallback to direct proxy URL');
        const player = videoElementRef.current;
        if (!player || !videoUrl) return;

        // Cleanup MSE
        if (mediaSourceRef.current && mediaSourceRef.current.readyState === 'open') {
            try {
                mediaSourceRef.current.endOfStream();
            } catch (e) {
                console.error('[BufferManager] Error closing stream:', e);
            }
        }

        // Force direct src
        const proxyUrl = `/api/proxy?url=${encodeURIComponent(videoUrl)}`;
        player.src = proxyUrl;
        setUsesDirectSrc(true);
        setIsReady(true);
        setError(null);
    }, [videoUrl]);

    const cleanupPlayedBuffer = useCallback((currentTime: number, keepBehindSeconds: number) => {
        if (usesDirectSrc) return;

        const player = videoElementRef.current;
        const sourceBuffer = sourceBufferRef.current;
        if (!player || !sourceBuffer || sourceBuffer.updating || processing.current) return;
        if (player.buffered.length === 0) return;

        const safeRemoveUntil = Math.max(0, currentTime - keepBehindSeconds);
        if (safeRemoveUntil <= 0) return;

        for (let i = 0; i < player.buffered.length; i += 1) {
            const start = player.buffered.start(i);
            const end = player.buffered.end(i);
            if (start >= safeRemoveUntil) {
                break;
            }

            const removeEnd = Math.min(end, safeRemoveUntil);
            if (removeEnd - start > 0.25) {
                try {
                    console.log('[BufferManager] 🧹 Removing played buffer range', { start, removeEnd });
                    sourceBuffer.remove(start, removeEnd);
                } catch (error) {
                    console.warn('[BufferManager] Buffer remove failed:', error);
                }
                break;
            }
        }
    }, [usesDirectSrc]);

    return {
        isReady,
        appendBuffer,
        getBufferedEnd,
        cleanupPlayedBuffer,
        attemptFallback,
        error,
        usesDirectSrc,
        contentType
    };
}
