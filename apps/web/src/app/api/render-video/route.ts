import { NextRequest, NextResponse } from 'next/server';
import { generateBroadcastReelVideo } from '@/lib/videoGenerator';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { newsId, headline, category, tags, imageUrl, duration } = body;

    if (!headline) {
      return NextResponse.json({ error: 'Headline is required' }, { status: 400 });
    }

    const videoUrl = await generateBroadcastReelVideo({
      newsId: newsId || `video_${Date.now()}`,
      headline,
      category: category || 'NOTICIAS',
      tags,
      imageUrl,
      duration: duration || 12,
    });

    return NextResponse.json({
      success: true,
      videoUrl,
    });
  } catch (error: any) {
    console.error('Error generando video real:', error);
    return NextResponse.json(
      { error: error?.message || 'Error al generar video con FFmpeg' },
      { status: 500 }
    );
  }
}
