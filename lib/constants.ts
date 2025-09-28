export const CHUNK_SIZE = 10 * 1024 * 1024; // 5MB
export const MAX_BUFFER_AHEAD = 30; // Seconds
export const VERIFICATION_TIMEOUT = 10000; // 10s for API calls
export const INITIAL_PREBUFFER_PERCENT = 0.12; // 12% before playback
export const MIN_INITIAL_PREBUFFER_CHUNKS = 2;
export const MAX_INITIAL_PREBUFFER_CHUNKS = 8;
export const PLAYBACK_TARGET_AHEAD_CHUNKS = 3;
export const PLAYBACK_MAX_AHEAD_CHUNKS = 5;
export const BUFFER_RETAIN_BEHIND_SECONDS = 25;

// MIME type configurations for different video formats
export const VIDEO_MIME_TYPES: Record<string, string> = {
    'mp4': 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
    'mp4-high': 'video/mp4; codecs="avc1.64001f, mp4a.40.2"', // High Profile
    'webm': 'video/webm; codecs="vp8, vorbis"',
    'webm-vp9': 'video/webm; codecs="vp9, opus"',
    'ogg': 'video/ogg; codecs="theora, vorbis"',
    'mov': 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"', // MOV uses same as MP4
    'mkv': 'video/x-matroska', // MKV format (Google Drive uses this)
    'avi': 'video/x-msvideo',
};

// Default MIME type (fallback)
export const DEFAULT_VIDEO_MIME_TYPE = 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';

/**
 * Detect MIME type from URL or Content-Type header
 * @param url - Video URL
 * @param contentType - Optional Content-Type from response headers
 */
export function getMimeTypeFromUrl(url: string, contentType?: string): string {
    // If we have a content-type header, use it
    if (contentType) {
        if (contentType.includes('webm')) return VIDEO_MIME_TYPES['webm'];
        if (contentType.includes('ogg')) return VIDEO_MIME_TYPES['ogg'];
        if (contentType.includes('mkv') || contentType.includes('matroska')) return VIDEO_MIME_TYPES['mkv'];
        if (contentType.includes('avi') || contentType.includes('msvideo')) return VIDEO_MIME_TYPES['avi'];
        if (contentType.includes('mp4') || contentType.includes('video/mp4')) return VIDEO_MIME_TYPES['mp4'];
    }

    // Fallback to URL extension detection
    try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname.toLowerCase();

        if (pathname.endsWith('.webm')) return VIDEO_MIME_TYPES['webm'];
        if (pathname.endsWith('.ogg') || pathname.endsWith('.ogv')) return VIDEO_MIME_TYPES['ogg'];
        if (pathname.endsWith('.mov')) return VIDEO_MIME_TYPES['mov'];
        if (pathname.endsWith('.mkv')) return VIDEO_MIME_TYPES['mkv'];
        if (pathname.endsWith('.avi')) return VIDEO_MIME_TYPES['avi'];
        if (pathname.endsWith('.mp4') || pathname.endsWith('.m4v')) return VIDEO_MIME_TYPES['mp4'];
    } catch {
        // Invalid URL, use default
    }

    return DEFAULT_VIDEO_MIME_TYPE;
}
