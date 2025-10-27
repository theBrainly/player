import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge'; // Edge is fine for simple string validation

export async function GET(req: NextRequest) {
    const searchParams = req.nextUrl.searchParams;
    const url = searchParams.get('url');

    if (!url) {
        return NextResponse.json({ valid: false, message: 'URL is required' }, { status: 400 });
    }

    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return NextResponse.json({ valid: false, message: 'Protocol must be http or https' });
        }

        // Basic extension check optional, but HEAD request in metadata is better proof

        return NextResponse.json({ valid: true });
    } catch {
        return NextResponse.json({ valid: false, message: 'Invalid URL format' });
    }
}
