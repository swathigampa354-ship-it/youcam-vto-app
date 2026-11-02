import { NextRequest, NextResponse } from 'next/server'
import { createClothVTO } from '@/lib/youcam'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { srcFileId, refFileId, garmentCategory } = body

    if (!srcFileId || !refFileId) {
      return NextResponse.json(
        { error: 'Missing required fields: srcFileId, refFileId' },
        { status: 400 }
      )
    }

    const taskId = await createClothVTO(
      srcFileId,
      refFileId,
      garmentCategory || 'upper_body'
    )

    return NextResponse.json({ taskId })
  } catch (err) {
    console.error('YouCam try-on error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Try-on task creation failed' },
      { status: 500 }
    )
  }
}
