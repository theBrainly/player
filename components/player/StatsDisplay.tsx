import { Activity, Wifi, HardDrive } from 'lucide-react';
import { StreamStats } from '@/lib/types';
import { cn } from '@/lib/utils';

interface StatsDisplayProps {
    stats: StreamStats;
    className?: string;
}

export function StatsDisplay({ stats, className }: StatsDisplayProps) {
    const networkLabel = stats.internetSpeed !== null
        ? `${stats.internetSpeed.toFixed(1)} Mbps Net`
        : 'Net N/A';

    return (
        <div className={cn("grid grid-cols-4 gap-2 text-xs font-mono p-2 bg-black/50 rounded-lg border border-white/10 backdrop-blur-sm", className)}>
            <div className="flex items-center gap-2 text-neon-blue">
                <Wifi size={14} />
                <span>{networkLabel}</span>
            </div>
            <div className="flex items-center gap-2 text-cyan-300">
                <Wifi size={14} />
                <span>{(stats.liveSpeed || 0).toFixed(1)} Mbps Live</span>
            </div>
            <div className="flex items-center gap-2 text-neon-purple">
                <Activity size={14} />
                <span>{(stats.bufferHealth || 0).toFixed(1)}s Buffer</span>
            </div>
            <div className="flex items-center gap-2 text-neon-pink">
                <HardDrive size={14} />
                <span>{((stats.totalDownloaded || 0) / 1024 / 1024).toFixed(1)} MB</span>
            </div>
        </div>
    );
}
