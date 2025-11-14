import React, { useState } from 'react';
import { PlayCircle, Link as LinkIcon, AlertCircle } from 'lucide-react';

interface URLInputProps {
    onSubmit: (url: string) => void;
    error?: string | null;
}

export function URLInput({ onSubmit, error }: URLInputProps) {
    const [url, setUrl] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(url);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6 animate-in zoom-in-95 duration-500">
            <div className="glass-panel p-8 rounded-2xl relative group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-neon-blue to-neon-purple opacity-30 group-hover:opacity-50 blur transition duration-500 rounded-2xl -z-10"></div>

                <div className="space-y-2">
                    <label className="text-xs font-semibold text-neon-blue uppercase tracking-widest pl-1">
                        Source URL
                    </label>
                    <div className="relative">
                        <input
                            type="text"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            placeholder="https://example.com/video.mp4"
                            className="w-full bg-black/60 border border-white/10 rounded-lg p-4 pl-12 text-white placeholder:text-gray-600 focus:outline-none focus:border-neon-blue/50 focus:ring-1 focus:ring-neon-blue/50 transition-all font-mono text-sm"
                        />
                        <LinkIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                    </div>
                </div>

                {error && (
                    <div className="flex items-center gap-2 text-red-400 text-sm bg-red-950/30 p-3 rounded border border-red-900/50">
                        <AlertCircle size={14} />
                        {error}
                    </div>
                )}

                <button
                    type="submit"
                    className="w-full bg-white text-black font-bold py-4 rounded-lg hover:bg-neon-blue hover:scale-[1.02] transition-all duration-300 flex items-center justify-center gap-3 shadow-[0_0_20px_rgba(255,255,255,0.2)] hover:shadow-[0_0_30px_rgba(0,243,255,0.4)]"
                >
                    <PlayCircle size={20} />
                    INITIALIZE STREAM
                </button>
            </div>
        </form>
    );
}
