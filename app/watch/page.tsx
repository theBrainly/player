'use client';

import React, { Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { VideoPlayer } from '@/components/player/VideoPlayer';
import { ArrowLeft } from 'lucide-react';

function WatchContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const url = searchParams.get('url');

    if (!url) {
        return (
            <div className="text-center text-gray-500">
                <p>No video URL provided.</p>
                <button onClick={() => router.push('/')} className="text-neon-blue hover:underline mt-4">Go Back</button>
            </div>
        );
    }

    return (
        <div className="w-full max-w-6xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
            <button
                onClick={() => router.push('/')}
                className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors group"
            >
                <ArrowLeft size={20} className="group-hover:-translate-x-1 transition-transform" />
                Back to Search
            </button>

            <VideoPlayer url={url} />

            <div className="glass-panel p-4 rounded-lg">
                <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-1">Now Playing</h2>
                <p className="text-neon-blue font-mono break-all line-clamp-1">{url}</p>
            </div>
        </div>
    );
}

export default function WatchPage() {
    return (
        <main className="min-h-screen flex flex-col items-center justify-center p-4 md:p-8 relative overflow-hidden">
            <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-neon-purple/10 blur-[150px] rounded-full pointer-events-none" />

            <Suspense fallback={<div className="text-white">Loading player...</div>}>
                <WatchContent />
            </Suspense>
        </main>
    );
}
