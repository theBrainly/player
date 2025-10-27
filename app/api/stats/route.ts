import { NextRequest, NextResponse } from 'next/server';
import { chunkCache } from '@/lib/chunkCache';

export const runtime = 'nodejs';

interface StatsPayload {
    videoUrl: string;
    totalChunks: number;
    totalTime: number; // seconds
    averageSpeed: number; // Mbps
    totalBytes: number;
    seekCount: number;
    timestamp: number;
}

// In-memory store for demo purposes
// In production, use a database or analytics service
const statsStore: StatsPayload[] = [];

export async function POST(req: NextRequest) {
    try {
        const body = await req.json() as StatsPayload;

        // Validate required fields
        if (!body.videoUrl || typeof body.totalChunks !== 'number') {
            return NextResponse.json(
                { error: 'Invalid stats payload' },
                { status: 400 }
            );
        }

        // Add timestamp if not provided
        const statsEntry: StatsPayload = {
            ...body,
            timestamp: body.timestamp || Date.now()
        };

        // Store stats (in-memory for demo)
        statsStore.push(statsEntry);

        // Keep only last 100 entries to prevent memory bloat
        if (statsStore.length > 100) {
            statsStore.shift();
        }

        return NextResponse.json({
            success: true,
            message: 'Stats recorded'
        });

    } catch (error) {
        console.error('Stats API Error:', error);
        return NextResponse.json(
            { error: 'Failed to record stats' },
            { status: 500 }
        );
    }
}

export async function GET() {
    // Return aggregated stats (for admin dashboard)
    const totalSessions = statsStore.length;
    const avgSpeed = statsStore.length > 0
        ? statsStore.reduce((sum, s) => sum + s.averageSpeed, 0) / statsStore.length
        : 0;
    const totalBytesServed = statsStore.reduce((sum, s) => sum + s.totalBytes, 0);

    // Get chunk cache stats
    const cacheStats = chunkCache.getStats();

    return NextResponse.json({
        totalSessions,
        averageSpeed: avgSpeed.toFixed(2),
        totalBytesServed,
        recentSessions: statsStore.slice(-10),
        cache: {
            totalSessions: cacheStats.totalSessions,
            totalCacheSizeMB: (cacheStats.totalCacheSize / 1024 / 1024).toFixed(2),
            activeDownloads: cacheStats.activeDownloads
        }
    });
}

