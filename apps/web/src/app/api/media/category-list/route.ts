import { NextResponse } from 'next/server';
import { getAllCategoryFolders } from '@/lib/contentLibrary';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const folders = getAllCategoryFolders();
    const totalVideos = folders.reduce((acc, f) => acc + f.videoCount, 0);

    return NextResponse.json({
      success: true,
      totalCategories: folders.length,
      totalVideos,
      categories: folders,
    });
  } catch (error: any) {
    console.error('Error listando videos de categorías:', error);
    return NextResponse.json(
      { error: error.message || 'Error al obtener biblioteca de categorías' },
      { status: 500 }
    );
  }
}
