'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Play, Pause, Maximize, Volume2, VolumeX, RotateCcw, RotateCw } from 'lucide-react';
import { useVideoStreaming } from '@/hooks/useVideoStreaming';
import { StatsDisplay } from './StatsDisplay';
import { cn } from '@/lib/utils';

interface VideoPlayerProps {
    url: string;
}

export function VideoPlayer({ url }: VideoPlayerProps) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [isWaiting, setIsWaiting] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [showControls, setShowControls] = useState(true);

    // Callback ref to capture video element
    const videoRefCallback = useCallback((node: HTMLVideoElement | null) => {
        console.log('[VideoPlayer] Video ref callback, node:', node ? 'attached' : 'null');
        videoRef.current = node;
        setVideoElement(node);
    }, []);

    // Use the custom hook for streaming logic - now with real stats
    const { error, isBuffering, stats, attemptFallback } = useVideoStreaming({
        url,
        videoElement
    });



    // Auto-fallback on streaming error
    useEffect(() => {
        if (error) {
            console.log('[VideoPlayer] Streaming error detected, attempting fallback...');
            attemptFallback();
        }
    }, [error, attemptFallback]);

    // Log component mount with URL
    useEffect(() => {
        console.log('[VideoPlayer] Component mounted with URL:', url);
        return () => console.log('[VideoPlayer] Component unmounting');
    }, [url]);

    // Track current time and duration
    useEffect(() => {
        if (!videoElement) return;

        const handleTimeUpdate = () => setCurrentTime(videoElement.currentTime);
        const handleDurationChange = () => setDuration(videoElement.duration || 0);
        const handleLoadedMetadata = () => setDuration(videoElement.duration || 0);

        videoElement.addEventListener('timeupdate', handleTimeUpdate);
        videoElement.addEventListener('durationchange', handleDurationChange);
        videoElement.addEventListener('loadedmetadata', handleLoadedMetadata);

        return () => {
            videoElement.removeEventListener('timeupdate', handleTimeUpdate);
            videoElement.removeEventListener('durationchange', handleDurationChange);
            videoElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
        };
    }, [videoElement]);

    // Auto-hide controls
    useEffect(() => {
        if (!isPlaying) return;

        const timeout = setTimeout(() => setShowControls(false), 3000);
        return () => clearTimeout(timeout);
    }, [isPlaying, showControls]);

    const togglePlay = async () => {
        if (!videoElement) {
            console.log('[VideoPlayer] togglePlay - no video element');
            return;
        }

        try {
            if (videoElement.paused) {
                console.log('[VideoPlayer] Attempting to play...');
                await videoElement.play();
                console.log('[VideoPlayer] ✅ Play succeeded');
            } else {
                console.log('[VideoPlayer] Pausing...');
                videoElement.pause();
            }
        } catch (err) {
            console.error('[VideoPlayer] ❌ Play/Pause error:', err);
        }
    };

    const toggleMute = () => {
        const player = videoRef.current;
        if (!player) return;
        player.muted = !player.muted;
        setIsMuted(player.muted);
    };

    const toggleFullscreen = () => {
        if (!containerRef.current) return;
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            containerRef.current.requestFullscreen();
        }
    };

    const skipTime = (seconds: number) => {
        const player = videoRef.current;
        if (!player) return;
        player.currentTime = Math.min(Math.max(player.currentTime + seconds, 0), player.duration || 0);
    };

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Only trigger if we're not typing in an input
            if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

            switch (e.key) {
                case 'ArrowLeft':
                    e.preventDefault();
                    skipTime(-10);
                    setShowControls(true);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    skipTime(10);
                    setShowControls(true);
                    break;
                case ' ':
                case 'k':
                case 'K':
                    e.preventDefault();
                    togglePlay();
                    setShowControls(true);
                    break;
                case 'f':
                case 'F':
                    e.preventDefault();
                    toggleFullscreen();
                    break;
                case 'm':
                case 'M':
                    e.preventDefault();
                    toggleMute();
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [togglePlay, toggleMute, toggleFullscreen]); // Dependencies needed for the closures inside toggle functions if they weren't stable, but usually they are based on refs or state. Better to list them or useCallback them.
    // However, togglePlay depends on videoElement state which changes.
    // To fix stale closures in keyboard listeners without constantly re-binding, we can use refs or just include dependencies.
    // For simplicity given the current structure, adding them to dependency array is safest.


    const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
        const player = videoRef.current;
        if (!player || !duration) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        player.currentTime = pos * duration;
    };

    const formatTime = (seconds: number) => {
        if (!isFinite(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
    const showLoadingOverlay = (isBuffering || isWaiting) && !error;

    return (
        <div className="space-y-4">
            <div
                ref={containerRef}
                className="relative group w-full max-w-5xl mx-auto aspect-video bg-black rounded-xl overflow-hidden glass-panel border border-neon-blue/30 shadow-[0_0_50px_rgba(0,243,255,0.1)]"
                onMouseMove={() => setShowControls(true)}
                onMouseLeave={() => isPlaying && setShowControls(false)}
            >
                <video
                    ref={videoRefCallback}
                    className="w-full h-full object-contain"
                    controls={false}
                    playsInline
                    onClick={togglePlay}
                    onPlay={() => {
                        console.log('[VideoPlayer] onPlay event');
                        setIsPlaying(true);
                        setIsWaiting(false);
                    }}
                    onPause={() => {
                        console.log('[VideoPlayer] onPause event');
                        setIsPlaying(false);
                    }}
                    onError={(e) => {
                        console.error('[VideoPlayer] ❌ Video element error:', e);
                        const video = e.currentTarget;
                        console.error('[VideoPlayer] Video error details:', {
                            error: video.error,
                            networkState: video.networkState,
                            readyState: video.readyState
                        });

                        // Attempt fallback if we encounter a media error (likely codec mismatch)
                        if (video.error && (video.error.code === 3 || video.error.code === 4)) {
                            console.log('[VideoPlayer] Triggering fallback due to decode error');
                            attemptFallback();
                        }
                    }}
                    onLoadStart={() => console.log('[VideoPlayer] onLoadStart')}
                    onLoadedMetadata={() => console.log('[VideoPlayer] onLoadedMetadata - duration:', videoElement?.duration)}
                    onCanPlay={() => {
                        console.log('[VideoPlayer] onCanPlay');
                        setIsWaiting(false);
                    }}
                    onWaiting={() => {
                        console.log('[VideoPlayer] onWaiting (buffering)');
                        setIsWaiting(true);
                    }}
                />

                {/* Loading / Buffering Overlay */}
                {showLoadingOverlay && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/45 pointer-events-none">
                        <div className="w-12 h-12 border-4 border-neon-blue/30 border-t-neon-blue rounded-full animate-spin" />
                        <p className="text-xs font-mono text-neon-blue/90 tracking-wider">
                            Fetching chunks...
                        </p>
                    </div>
                )}

                {/* Cyber Overlay Controls */}
                <div className={cn(
                    "absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent transition-opacity duration-300 pointer-events-none",
                    showControls ? "opacity-100" : "opacity-0"
                )}>
                    {/* Stats - Top Right */}
                    <div className="absolute top-4 right-4 pointer-events-auto">
                        <StatsDisplay stats={stats} />
                    </div>

                    {/* Controls - Bottom */}
                    <div className="absolute bottom-0 left-0 right-0 p-6 space-y-4 pointer-events-auto">
                        {/* Progress Bar */}
                        <div
                            className="relative h-2 bg-gray-800 rounded-full cursor-pointer group/progress"
                            onClick={handleSeek}
                        >
                            {/* Buffered indicator */}
                            <div
                                className="absolute h-full bg-gray-600 rounded-full"
                                style={{ width: `${Math.min(100, (stats.bufferHealth / 30) * 100 + progress)}%` }}
                            />
                            {/* Progress indicator */}
                            <div
                                className="absolute h-full bg-neon-blue rounded-full shadow-[0_0_10px_#00f3ff] transition-all"
                                style={{ width: `${progress}%` }}
                            />
                            {/* Seek handle */}
                            <div
                                className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg opacity-0 group-hover/progress:opacity-100 transition-opacity"
                                style={{ left: `calc(${progress}% - 8px)` }}
                            />
                        </div>

                        {/* Control Buttons */}
                        <div className="flex items-center gap-4">
                            <button
                                onClick={togglePlay}
                                className="p-3 rounded-full bg-neon-blue/10 hover:bg-neon-blue/20 text-neon-blue border border-neon-blue/50 transition-all hover:scale-105"
                            >
                                {isPlaying ? <Pause size={24} /> : <Play size={24} />}
                            </button>

                            {/* Seek Buttons */}
                            <button
                                onClick={() => skipTime(-10)}
                                className="p-2 text-white/70 hover:text-white transition-colors hover:bg-white/10 rounded-full"
                                title="Rewind 10s (Arrow Left)"
                            >
                                <RotateCcw size={20} />
                            </button>
                            <button
                                onClick={() => skipTime(10)}
                                className="p-2 text-white/70 hover:text-white transition-colors hover:bg-white/10 rounded-full"
                                title="Forward 10s (Arrow Right)"
                            >
                                <RotateCw size={20} />
                            </button>

                            <button
                                onClick={toggleMute}
                                className="p-2 text-white/70 hover:text-white transition-colors"
                            >
                                {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
                            </button>

                            {/* Time Display */}
                            <span className="text-white/80 font-mono text-sm">
                                {formatTime(currentTime)} / {formatTime(duration)}
                            </span>

                            <div className="flex-1" />

                            <button
                                onClick={toggleFullscreen}
                                className="text-white/70 hover:text-white transition-colors"
                            >
                                <Maximize size={20} />
                            </button>
                        </div>
                    </div>
                </div>

                {error && (
                    <div className="absolute top-4 left-4 bg-red-900/80 text-white px-4 py-2 rounded-lg border border-red-500 backdrop-blur-md">
                        Source Error: {error}
                    </div>
                )}
            </div>
        </div>
    );
}
