export interface VideoMetadata {
    contentLength: number;
    contentType: string;
    acceptRanges: boolean;
}

export interface PlayerState {
    isPlaying: boolean;
    isBuffering: boolean;
    currentTime: number;
    duration: number;
    volume: number;
}

export interface StreamStats {
    downloadSpeed: number; // Average Mbps
    liveSpeed: number; // Instant Mbps for latest chunk
    internetSpeed: number | null; // Browser-reported network downlink Mbps
    bufferHealth: number; // Seconds ahead
    totalDownloaded: number; // Bytes
}
