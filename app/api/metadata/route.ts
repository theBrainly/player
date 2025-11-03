import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
    const searchParams = req.nextUrl.searchParams;
    const url = searchParams.get('url');

    if (!url) {
        return new NextResponse('Missing url parameter', { status: 400 });
    }

    try {
        const response = await fetch(url, {
            method: 'HEAD',
            headers: {
                'User-Agent': 'StreamFlow/1.0'
            }
        });

        if (!response.ok) {
            return new NextResponse('Failed to fetch metadata from source', { status: response.status });
        }

        const contentLength = response.headers.get('content-length');
        const contentType = response.headers.get('content-type');
        const acceptRanges = response.headers.get('accept-ranges');

        return NextResponse.json({
            contentLength: contentLength ? parseInt(contentLength, 10) : null,
            contentType,
            acceptRanges: acceptRanges === 'bytes',
            ok: true
        });

    } catch (error) {
        console.error('Metadata fetch error:', error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}
