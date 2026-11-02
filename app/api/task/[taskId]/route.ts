import { NextRequest, NextResponse } from 'next/server'
import { pollTaskStatus } from '@/lib/youcam'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params

    if (!taskId) {
      return NextResponse.json({ error: 'Missing taskId' }, { status: 400 })
    }

    const status = await pollTaskStatus(taskId)
    return NextResponse.json(status)
  } catch (err) {
    console.error('YouCam task poll error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Task poll failed' },
      { status: 500 }
    )
  }
}
