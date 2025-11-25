'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { URLInput } from '@/components/URLInput';

export default function Home() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const handleStart = (url: string) => {
    if (!url.trim()) {
      setError("Please enter a valid video URL");
      return;
    }
    try {
      new URL(url);
      // Navigate to watch page
      router.push(`/watch?url=${encodeURIComponent(url)}`);
    } catch {
      setError("Invalid URL format");
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 md:p-12 relative overflow-hidden">
      {/* Background Ambience */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-neon-blue/20 blur-[120px] rounded-full pointer-events-none" />

      <div className="z-10 w-full max-w-5xl space-y-12">

        {/* Header */}
        <div className="text-center space-y-4">
          <h1 className="text-6xl md:text-8xl font-bold tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-gray-500 neon-text">
            STREAM FLOW
          </h1>
          <p className="text-gray-400 text-xl font-light tracking-wide">
            VERCEL-OPTIMIZED RANGE PROXY
          </p>
        </div>

        {/* Input Section */}
        <div className="max-w-xl mx-auto">
          <URLInput onSubmit={handleStart} error={error} />

          <div className="mt-8 grid grid-cols-3 gap-4 text-center text-xs text-gray-600 font-mono">
            <div>• NO BUFFERING</div>
            <div>• 10S TIMEOUT PROOF</div>
            <div>• ZERO STORAGE</div>
          </div>
        </div>

      </div>
    </main>
  );
}
